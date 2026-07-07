import type { Env, WebhookPayload, Post, Seed } from "./types";
import { extractSeeds } from "./seed";
import {
  fetchMessages,
  fetchMessagesBefore,
  fetchMessage,
  sendMessage,
  editMessage,
  addReaction,
  removeReaction,
  formatProgress,
  formatSuccess,
  type DiscordMessage,
} from "./discord";
import * as x from "./providers/x";
import { buildStores, backupD1ToDropbox, type Store } from "./stores";
import { D1Store } from "./stores/d1";
import { D1State } from "./stores/state";
import { isText } from "./post";
import { isCommand, processCommand } from "./commands";
import { handleImport } from "./import";
import { handleReconcile } from "./reconcile";

// Poll state lives in D1 (the `state` table via D1State), not KV: the poll lock
// is written + deleted every cron minute, and KV's free tier only allows
// 1000 writes+deletes/day — well under the 1440/day a per-minute cron needs.
const STATE_LAST_MESSAGE_ID = "last_message_id";

// Legacy KV key for the last processed message id, read once to seed D1 on the
// first poll after migration (see runPoll). Removable after that first run.
const KV_LAST_MESSAGE_ID_LEGACY = "last_message_id";

// Single-flight lock so overlapping cron ticks don't double-process. TTL is the
// crash backstop (auto-releases if a run dies before the finally); normal runs
// release it immediately on completion.
const STATE_POLL_LOCK = "poll_lock";
const POLL_LOCK_TTL = 300;

// Timestamp (unix ms) of the last successful D1→Dropbox backup. The backup dumps
// the entire pictures table, so running it on every save is slow (~tens of
// seconds) and grows unbounded; we throttle it to once per BACKUP_MIN_INTERVAL_MS.
const STATE_LAST_BACKUP = "last_backup_at";
const BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

// Reaction added to the original post while importing, removed on completion.
const IMPORTING = "⬇️";

/** Whether unauthenticated HTTP action endpoints are exposed (debug/admin). */
function isDebug(env: Env): boolean {
  return env.DEBUG === "true" || env.DEBUG === "1";
}

/**
 * The bot's own user id, decoded from the first segment of its token (Discord
 * encodes the user id there as base64). Used to skip only our own reply
 * messages while still processing other bot-flagged authors (e.g. the
 * "garoo from mobile" poster). Returns null if the token can't be decoded, in
 * which case we skip nothing extra — our own replies carry no seed URL, so
 * they're dropped by extractSeeds anyway.
 */
function selfBotId(token: string): string | null {
  try {
    let b = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const id = atob(b);
    return /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const debug = isDebug(env);

    // Health check (always available)
    if (url.pathname === "/") {
      return Response.json({
        status: "ok",
        service: "garoo",
        debug,
        // The action endpoints below have no auth, so they are only served when
        // DEBUG mode is on. The production flow runs via the cron trigger.
        endpoints: debug
          ? {
              "/webhook": "POST - Process message and scrape posts",
              "/rescan":
                "GET - Backfill: scan older messages for failed posts and re-process (dry-run unless ?dry=0)",
              "/import-dropbox":
                "GET - Backfill: import existing Dropbox media into R2 (dry-run unless ?dry=0)",
            }
          : {},
      });
    }

    // All other endpoints are unauthenticated debug/admin actions — only
    // exposed when DEBUG mode is enabled (via the DEBUG var/secret).
    if (!debug) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Main webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    // Backfill: re-process posts that previously failed (bot ❌ replies)
    if (url.pathname === "/rescan") {
      return handleRescan(url, env);
    }

    // Backfill: import existing Dropbox media into R2 (dry-run unless ?dry=0)
    if (url.pathname === "/import-dropbox") {
      return handleImport(url, env);
    }

    // Reconcile a store to the normalized D1 categories (dry-run unless ?dry=0)
    if (url.pathname === "/reconcile") {
      return handleReconcile(url, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      // Top-level guard: a throw anywhere in the poll before the per-seed
      // try/catch (a failed Discord fetch, store setup, D1 state access, …)
      // would otherwise be swallowed by waitUntil with zero visibility — the
      // exact "silent failure, nothing in Discord" symptom. Log the outcome and
      // any error so they show in `wrangler tail` / Workers Logs.
      pollDiscord(env)
        .then((r) => {
          if (r.status !== "no_new_messages" && r.status !== "locked") {
            console.log("poll:", JSON.stringify(r));
          }
        })
        .catch((e) => console.error("poll failed:", e))
    );
  },
};

interface PollResult {
  status: string;
  messagesFound: number;
  processed: number;
  lastMessageId?: string;
}

async function pollDiscord(env: Env): Promise<PollResult> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) {
    return { status: "skipped", messagesFound: 0, processed: 0 };
  }

  const state = D1State.fromEnv(env);
  if (!state) {
    // No D1 configured — nowhere to coordinate; run unlocked.
    return runPoll(env, null);
  }

  // Single-flight: atomically acquire the lock and skip if another tick still
  // holds it, so overlapping cron ticks can't re-read the same last_message_id
  // and double-process.
  if (!(await state.acquireLock(STATE_POLL_LOCK, POLL_LOCK_TTL))) {
    return { status: "locked", messagesFound: 0, processed: 0 };
  }

  try {
    return await runPoll(env, state);
  } finally {
    await state.delete(STATE_POLL_LOCK);
  }
}

async function runPoll(
  env: Env,
  state: D1State | null
): Promise<PollResult> {
  // Get last processed message ID from D1. On the first run after migrating off
  // KV, D1 has no value yet — fall back to the old KV value once (a cheap read)
  // so we resume where we left off instead of re-scanning recent messages. Once
  // D1 is seeded below, this KV read never happens again. (Safe to delete the
  // fallback, and the KV key, after the first successful poll.)
  let lastMessageId = state ? await state.get(STATE_LAST_MESSAGE_ID) : null;
  if (!lastMessageId) {
    lastMessageId = await env.KV.get(KV_LAST_MESSAGE_ID_LEGACY);
  }

  // Fetch new messages from Discord (token/channel checked by the caller)
  const messages = await fetchMessages(
    env.DISCORD_BOT_TOKEN!,
    env.DISCORD_CHANNEL_ID!,
    lastMessageId ?? undefined
  );

  if (messages.length === 0) {
    return { status: "no_new_messages", messagesFound: 0, processed: 0 };
  }

  // Messages are returned newest first, so reverse for chronological processing
  const sortedMessages = [...messages].reverse();
  const stores = buildStores(env);

  const canNotify = !!(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID);

  // Our own bot user id, so we skip only *our* progress/outcome replies. We must
  // NOT skip every bot-authored message: posts arrive via "garoo from mobile",
  // which Discord flags as a bot, so a blanket `author.bot` skip silently
  // dropped every archival request (no save, no reaction) while the cursor
  // advanced past them. Derived from the token (no extra config/API call).
  const selfId = selfBotId(env.DISCORD_BOT_TOKEN!);

  let processed = 0;
  let saved = 0;
  for (const message of sortedMessages) {
    // Skip only our own replies (progress/outcome messages), not other bots.
    if (selfId && message.author.id === selfId) continue;

    const content = message.content ?? "";

    // Handle commands (e.g. "garoo login dropbox <code>")
    if (isCommand(content)) {
      await processCommand(content, env, message.id);
      processed++;
      continue;
    }

    // Extract seeds from message
    const seeds = extractSeeds(content);
    if (seeds.length === 0) continue;

    const ch = env.DISCORD_CHANNEL_ID!;
    const token = env.DISCORD_BOT_TOKEN!;

    // Importing: mark the original post while we work.
    if (canNotify) {
      await addReaction(token, ch, message.id, IMPORTING).catch((e) =>
        console.error("reaction failed:", e)
      );
    }

    const results = await processSeeds(seeds, env, stores, message.id);
    saved += results.filter((r) => r.post && !r.skipped).length;
    processed++;

    // Done: remove the importing mark and react with the outcome.
    if (canNotify) {
      await removeReaction(token, ch, message.id, IMPORTING).catch(() => {});
      const emoji = results.some((r) => r.error)
        ? "❌"
        : results.some((r) => r.post && !r.skipped)
          ? "✅"
          : "⏭️";
      await addReaction(token, ch, message.id, emoji).catch((e) =>
        console.error("reaction failed:", e)
      );
    }
  }

  // Save the newest message ID
  const newestMessageId = messages[0].id;
  if (state) await state.put(STATE_LAST_MESSAGE_ID, newestMessageId);

  // Back up D1 to Dropbox after a save, but throttled (see maybeBackupD1).
  if (saved > 0) {
    await maybeBackupD1(env, state);
  }

  return {
    status: "ok",
    messagesFound: messages.length,
    processed,
    lastMessageId: newestMessageId,
  };
}

/**
 * Back up the D1 pictures table to Dropbox, at most once per
 * BACKUP_MIN_INTERVAL_MS (tracked in D1 state). The dump scans the whole table,
 * so this keeps a heavy, ever-growing operation off the per-save critical path.
 * On failure we ping the owner on Discord instead of swallowing it — a silently
 * broken backup is exactly the kind of failure that went unnoticed before.
 */
async function maybeBackupD1(env: Env, state: D1State | null): Promise<void> {
  const now = Date.now();
  const last = state ? Number((await state.get(STATE_LAST_BACKUP)) ?? 0) : 0;
  if (state && now - last < BACKUP_MIN_INTERVAL_MS) return;

  try {
    await backupD1ToDropbox(env);
    if (state) await state.put(STATE_LAST_BACKUP, String(now));
  } catch (e) {
    console.error("D1 backup to Dropbox failed:", e);
    const canNotify = !!(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID);
    if (env.DISCORD_USER_ID) {
      const msg = e instanceof Error ? e.message : String(e);
      await notify(
        env,
        canNotify,
        `<@${env.DISCORD_USER_ID}> ⚠️ D1→Dropbox backup failed: ${msg}`
      );
    }
  }
}

interface SeedResult {
  seed: Seed;
  post?: Post;
  error?: string;
  skipped?: string;
}

/**
 * Fetch each seed's post and save it to every configured store, sending Discord
 * progress/error notifications along the way. When replyTo is given (the poll
 * path), notifications are threaded replies to the original message; the caller
 * signals completion via a reaction. The webhook path passes no replyTo and
 * sends its own completion message.
 */
async function processSeeds(
  seeds: Seed[],
  env: Env,
  stores: Store[],
  replyTo?: string
): Promise<SeedResult[]> {
  const canNotify = !!(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID);
  const results: SeedResult[] = [];

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const index = i + 1;
    const total = seeds.length;

    // Per-seed progress message (shows mid-progress for multi-item posts); its
    // id lets us edit it into the final outcome.
    const progressId = await notify(
      env,
      canNotify,
      formatProgress(index, total, seed),
      replyTo
    );

    const result = await processOneSeed(seed, env, stores);
    results.push(result);

    // Resolve the progress message to its outcome (⬇️ → ✅ / ❌ / ⏭️).
    const emoji = result.error ? "❌" : result.skipped ? "⏭️" : "✅";
    let line = formatProgress(index, total, seed, emoji);
    if (result.error) line += ` — ${result.error}`;
    else if (result.skipped) line += ` — ${result.skipped}`;
    if (progressId) {
      await editMessage(
        env.DISCORD_BOT_TOKEN!,
        env.DISCORD_CHANNEL_ID!,
        progressId,
        line
      ).catch((e) => console.error("edit progress failed:", e));
    }

    // Editing doesn't re-trigger a notification, so ping the owner separately
    // on errors (parity with Go's MentionToUser).
    if (result.error && env.DISCORD_USER_ID) {
      await notify(
        env,
        canNotify,
        `<@${env.DISCORD_USER_ID}> ❌ ${index}/${total}: ${result.error}`,
        replyTo
      );
    }
  }

  return results;
}

/**
 * Fetch a seed's post and save it to every configured store. No Discord
 * notifications — callers (processSeeds / rescan) handle those as needed.
 */
async function processOneSeed(
  seed: Seed,
  env: Env,
  stores: Store[]
): Promise<SeedResult> {
  try {
    const post = await getPostForSeed(seed, env);
    post.category = seed.category;
    post.tags = seed.tags?.length ? seed.tags : undefined;

    // Don't archive media-less posts unless they're the special text category
    // ("_", for saving impressions/comments). Nothing to store otherwise.
    const hasMedia = (post.media?.length ?? 0) > 0;
    if (!hasMedia && !isText(post)) {
      return { seed, post, skipped: "no media" };
    }

    // Capture the previously-stored category (before D1 overwrites it) so R2
    // can relocate existing files on a category change.
    const d1 = D1Store.fromEnv(env);
    const prevCategory = d1
      ? await d1.getCategory(post.id, post.provider)
      : null;
    const prev =
      prevCategory !== null ? { category: prevCategory } : undefined;

    for (const store of stores) {
      await store.save(post, prev);
    }
    return { seed, post };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { seed, error: message };
  }
}

async function getPostForSeed(seed: Seed, env: Env): Promise<Post> {
  if (seed.provider === "twitter") {
    return x.getPost(env.TWITTERAPI_IO_KEY ?? "", seed.url);
  }
  throw new Error(`Unknown provider: ${seed.provider}`);
}

async function notify(
  env: Env,
  canNotify: boolean,
  message: string,
  replyTo?: string
): Promise<string | undefined> {
  if (!canNotify) return undefined;
  try {
    return await sendMessage(
      env.DISCORD_BOT_TOKEN!,
      env.DISCORD_CHANNEL_ID!,
      message,
      replyTo
    );
  } catch (e) {
    console.error("Failed to send notification:", e);
    return undefined;
  }
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  // Parse request body
  let payload: WebhookPayload;
  try {
    payload = (await request.json()) as WebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.content) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  // Extract seeds from message
  const seeds = extractSeeds(payload.content);
  if (seeds.length === 0) {
    return Response.json({ status: "no_seeds", message: "No valid URLs found" });
  }

  const stores = buildStores(env);
  const results = await processSeeds(seeds, env, stores);

  // Completion notification (webhook has no source message to react to).
  const canNotify = !!(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID);
  await notify(env, canNotify, formatSuccess());

  return Response.json({
    status: "ok",
    processed: seeds.length,
    results,
  });
}

/**
 * Backfill: scan older channel messages for the bot's "❌ … failed …" error
 * replies, resolve each referenced original message, and re-process its
 * seed(s) that are not already in D1. Resumable via the returned `nextBefore`
 * cursor. Dry-run by default; pass ?dry=0 to actually re-process.
 */
async function handleRescan(url: URL, env: Env): Promise<Response> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) {
    return Response.json({ error: "Discord not configured" }, { status: 400 });
  }

  const before = url.searchParams.get("before") ?? undefined;
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? "50") || 50,
    100
  );
  const dryParam = url.searchParams.get("dry");
  const dry = dryParam !== "0" && dryParam !== "false"; // default: dry-run

  const messages = await fetchMessagesBefore(
    env.DISCORD_BOT_TOKEN,
    env.DISCORD_CHANNEL_ID,
    before,
    limit
  );

  if (messages.length === 0) {
    return Response.json({
      status: "done",
      scanned: 0,
      message: "no older messages",
    });
  }

  const stores = buildStores(env);
  const d1 = D1Store.fromEnv(env);

  let errorReplies = 0;
  let reprocessed = 0;
  let skipped = 0;
  let noMedia = 0;
  let failed = 0;
  let unresolved = 0;
  const details: unknown[] = [];

  for (const m of messages) {
    if (!m.author?.bot) continue;
    if (!m.content || !m.content.includes("❌")) continue;
    errorReplies++;

    // Resolve the original message this error replied to.
    let original: DiscordMessage | null = m.referenced_message ?? null;
    if (!original && m.message_reference?.message_id) {
      original = await fetchMessage(
        env.DISCORD_BOT_TOKEN,
        env.DISCORD_CHANNEL_ID,
        m.message_reference.message_id
      );
    }
    if (!original?.content) {
      unresolved++;
      continue;
    }

    for (const seed of extractSeeds(original.content)) {
      const id = x.parsePostUrl(seed.url)?.id;
      if (d1 && id && (await d1.has(id, seed.provider))) {
        skipped++;
        continue;
      }
      if (dry) {
        details.push({ would_reprocess: seed.url, category: seed.category });
        continue;
      }
      const r = await processOneSeed(seed, env, stores);
      if (r.skipped) {
        noMedia++;
        details.push({ url: seed.url, skipped: r.skipped });
      } else if (r.error) {
        failed++;
        details.push({ url: seed.url, error: r.error });
      } else {
        reprocessed++;
        details.push({ url: seed.url, ok: true, id: r.post?.id });
      }
    }
  }

  // Oldest message in this batch — pass as ?before= to continue going back.
  const nextBefore = messages[messages.length - 1].id;

  return Response.json({
    status: "ok",
    dry,
    scanned: messages.length,
    errorReplies,
    unresolved,
    skipped,
    noMedia,
    reprocessed,
    failed,
    nextBefore,
    details,
  });
}
