import type { Seed } from "./types";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  timestamp: string;
}

/**
 * Fetch messages from a Discord channel
 * @param after - Only fetch messages after this message ID (Snowflake)
 */
export async function fetchMessages(
  botToken: string,
  channelId: string,
  after?: string
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (after) {
    params.set("after", after);
  }

  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages?${params}`,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Discord API failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Send a message to Discord channel via Bot API
 */
export async function sendMessage(
  botToken: string,
  channelId: string,
  message: string
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: message,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Discord API failed: ${response.status}`);
  }
}

/**
 * Format progress message
 * Example: "⬇️ 1/3: (provider=twitter category=`art` tags=`tag1,tag2`)"
 */
export function formatProgress(
  index: number,
  total: number,
  seed: Seed
): string {
  const category = seed.category ? `\`${seed.category}\`` : "-";
  const tags = seed.tags?.length ? `\`${seed.tags.join(",")}\`` : "-";
  return `⬇️ ${index}/${total}: (provider=${seed.provider} category=${category} tags=${tags})`;
}

/**
 * Format success message
 */
export function formatSuccess(): string {
  return "✅ DONE!";
}

/**
 * Format error message
 * Example: "❌ 1/3: Post not found (404)"
 */
export function formatError(
  index: number,
  total: number,
  error: Error
): string {
  return `❌ ${index}/${total}: ${error.message}`;
}
