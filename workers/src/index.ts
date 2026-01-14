import type { Env, WebhookPayload, Post } from "./types";
import { extractSeeds } from "./seed";
import {
  fetchMessages,
  sendMessage,
  formatProgress,
  formatSuccess,
  formatError,
} from "./discord";
import * as x from "./providers/x";

const KV_LAST_MESSAGE_ID = "last_message_id";

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
          "/trigger": "POST - Debug: manually trigger Discord polling",
          "/scrape": "GET - Debug: scrape a single post",
          "/screenshot": "GET - Debug: take screenshot",
        },
      });
    }

    // Main webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    // Debug: manually trigger Discord polling
    if (url.pathname === "/trigger" && request.method === "POST") {
      try {
        const result = await pollDiscord(env);
        return Response.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    // Debug: scrape endpoint
    if (url.pathname === "/scrape") {
      const postUrl = url.searchParams.get("url");
      if (!postUrl) {
        return Response.json(
          { error: "url parameter is required" },
          { status: 400 }
        );
      }

      try {
        const post = await x.getPost(env.BROWSER, postUrl);
        return Response.json(post);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    // Debug: screenshot endpoint
    if (url.pathname === "/screenshot") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return Response.json(
          { error: "url parameter is required" },
          { status: 400 }
        );
      }

      try {
        const screenshot = await x.takeScreenshot(env.BROWSER, targetUrl);
        return new Response(screenshot as unknown as ArrayBuffer, {
          headers: { "Content-Type": "image/png" },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
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

  let processed = 0;
  for (const message of sortedMessages) {
    // Skip bot messages
    if (message.author.bot) continue;

    // Extract seeds from message
    const seeds = extractSeeds(message.content);
    if (seeds.length === 0) continue;

    // Process seeds
    await processSeeds(seeds, env);
    processed++;
  }

  // Save the newest message ID
  const newestMessageId = messages[0].id;
  await env.KV.put(KV_LAST_MESSAGE_ID, newestMessageId);

  return {
    status: "ok",
    messagesFound: messages.length,
    processed,
    lastMessageId: newestMessageId,
  };
}

async function processSeeds(seeds: ReturnType<typeof extractSeeds>, env: Env): Promise<void> {
  const canNotify = env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID;

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const index = i + 1;
    const total = seeds.length;

    // Send progress notification
    if (canNotify) {
      try {
        await sendMessage(
          env.DISCORD_BOT_TOKEN!,
          env.DISCORD_CHANNEL_ID!,
          formatProgress(index, total, seed)
        );
      } catch (e) {
        console.error("Failed to send progress notification:", e);
      }
    }

    try {
      // Get post from provider
      let post: Post;
      if (seed.provider === "twitter") {
        post = await x.getPost(env.BROWSER, seed.url);
      } else {
        throw new Error(`Unknown provider: ${seed.provider}`);
      }

      // Attach category and tags
      post.category = seed.category;
      post.tags = seed.tags?.length ? seed.tags : undefined;

      // TODO: Save to store (Phase 2)
      console.log("Processed post:", post.id);
    } catch (error) {
      // Send error notification
      if (canNotify) {
        try {
          await sendMessage(
            env.DISCORD_BOT_TOKEN!,
            env.DISCORD_CHANNEL_ID!,
            formatError(index, total, error as Error)
          );
        } catch (e) {
          console.error("Failed to send error notification:", e);
        }
      }
    }
  }

  // Send completion notification
  if (canNotify) {
    try {
      await sendMessage(env.DISCORD_BOT_TOKEN!, env.DISCORD_CHANNEL_ID!, formatSuccess());
    } catch (e) {
      console.error("Failed to send success notification:", e);
    }
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

  const canNotify = env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID;
  const results: Array<{ seed: typeof seeds[0]; post?: Post; error?: string }> =
    [];

  // Process each seed
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const index = i + 1;
    const total = seeds.length;

    // Send progress notification
    if (canNotify) {
      try {
        await sendMessage(
          env.DISCORD_BOT_TOKEN!,
          env.DISCORD_CHANNEL_ID!,
          formatProgress(index, total, seed)
        );
      } catch (e) {
        console.error("Failed to send progress notification:", e);
      }
    }

    try {
      // Get post from provider
      let post: Post;
      if (seed.provider === "twitter") {
        post = await x.getPost(env.BROWSER, seed.url);
      } else {
        throw new Error(`Unknown provider: ${seed.provider}`);
      }

      // Attach category and tags
      post.category = seed.category;
      post.tags = seed.tags?.length ? seed.tags : undefined;

      results.push({ seed, post });

      // TODO: Save to store (Phase 2)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      results.push({ seed, error: message });

      // Send error notification
      if (canNotify) {
        try {
          await sendMessage(
            env.DISCORD_BOT_TOKEN!,
            env.DISCORD_CHANNEL_ID!,
            formatError(index, total, error as Error)
          );
        } catch (e) {
          console.error("Failed to send error notification:", e);
        }
      }
    }
  }

  // Send completion notification
  if (canNotify) {
    try {
      await sendMessage(env.DISCORD_BOT_TOKEN!, env.DISCORD_CHANNEL_ID!, formatSuccess());
    } catch (e) {
      console.error("Failed to send success notification:", e);
    }
  }

  return Response.json({
    status: "ok",
    processed: seeds.length,
    results,
  });
}
