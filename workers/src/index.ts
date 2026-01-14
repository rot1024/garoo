import type { Env, WebhookPayload, Post } from "./types";
import { extractSeeds } from "./seed";
import {
  sendNotification,
  formatProgress,
  formatSuccess,
  formatError,
} from "./discord";
import * as x from "./providers/x";

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
          "/scrape": "GET - Debug: scrape a single post",
          "/screenshot": "GET - Debug: take screenshot",
        },
      });
    }

    // Main webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
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
};

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

  const results: Array<{ seed: typeof seeds[0]; post?: Post; error?: string }> =
    [];

  // Process each seed
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const index = i + 1;
    const total = seeds.length;

    // Send progress notification
    if (env.DISCORD_WEBHOOK_URL) {
      try {
        await sendNotification(
          env.DISCORD_WEBHOOK_URL,
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
      if (env.DISCORD_WEBHOOK_URL) {
        try {
          await sendNotification(
            env.DISCORD_WEBHOOK_URL,
            formatError(index, total, error as Error)
          );
        } catch (e) {
          console.error("Failed to send error notification:", e);
        }
      }
    }
  }

  // Send completion notification
  if (env.DISCORD_WEBHOOK_URL) {
    try {
      await sendNotification(env.DISCORD_WEBHOOK_URL, formatSuccess());
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
