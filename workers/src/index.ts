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
import { isText } from "./post";
import { isCommand, processCommand } from "./commands";

const KV_LAST_MESSAGE_ID = "last_message_id";

// Reaction added to the original post while importing, removed on completion.
const IMPORTING = "⬇️";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/") {
      return Response.json({
        status: "ok",
        service: "garoo",
        endpoints: {
          "/webhook": "POST - Process message and scrape posts",
          "/rescan":
            "GET - Backfill: scan older messages for failed posts and re-process (dry-run unless ?dry=0)",
        },
      });
    }

    // Main webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    // Backfill: re-process posts that previously failed (bot ❌ replies)
    if (url.pathname === "/rescan") {
      return handleRescan(url, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(pollDiscord(env));
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

  // Get last processed message ID from KV
  const lastMessageId = await env.KV.get(KV_LAST_MESSAGE_ID);

  // Fetch new messages from Discord
  const messages = await fetchMessages(
    env.DISCORD_BOT_TOKEN,
    env.DISCORD_CHANNEL_ID,
    lastMessageId ?? undefined
  );

  if (messages.length === 0) {
    return { status: "no_new_messages", messagesFound: 0, processed: 0 };
  }

  // Messages are returned newest first, so reverse for chronological processing
  const sortedMessages = [...messages].reverse();
  const stores = buildStores(env);

  const canNotify = !!(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID);

  let processed = 0;
  let saved = 0;
  for (const message of sortedMessages) {
    // Skip bot messages
    if (message.author.bot) continue;

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
  await env.KV.put(KV_LAST_MESSAGE_ID, newestMessageId);

  // Back up D1 to Dropbox when at least one post was saved this cycle.
  if (saved > 0) {
    try {
      await backupD1ToDropbox(env);
    } catch (e) {
      console.error("D1 backup to Dropbox failed:", e);
    }
  }

  return {
    status: "ok",
    messagesFound: messages.length,
    processed,
    lastMessageId: newestMessageId,
  };
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

    for (const store of stores) {
      await store.save(post);
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
