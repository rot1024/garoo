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
  message_reference?: { message_id?: string };
  referenced_message?: DiscordMessage | null;
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
 * Fetch messages older than a given message ID (newest-first), for backward
 * scanning of channel history. Used by the /rescan backfill.
 */
export async function fetchMessagesBefore(
  botToken: string,
  channelId: string,
  before?: string,
  limit = 50
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) {
    params.set("before", before);
  }

  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages?${params}`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Discord API failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch a single message by ID (used to resolve an error reply's original
 * message when it is not inlined as referenced_message).
 */
export async function fetchMessage(
  botToken: string,
  channelId: string,
  messageId: string
): Promise<DiscordMessage | null> {
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
}

/**
 * Send a message to a Discord channel via the Bot API. When replyToMessageId is
 * given, the message is sent as a threaded reply to that message (without
 * auto-pinging the replied-to user; explicit <@id> mentions still ping).
 */
export async function sendMessage(
  botToken: string,
  channelId: string,
  message: string,
  replyToMessageId?: string
): Promise<string | undefined> {
  const body: Record<string, unknown> = { content: message };
  if (replyToMessageId) {
    body.message_reference = { message_id: replyToMessageId };
    body.allowed_mentions = { parse: ["users"], replied_user: false };
  }

  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Discord API failed: ${response.status}`);
  }

  const msg = (await response.json()) as { id?: string };
  return msg.id;
}

/**
 * Edit a message's content (used to resolve a progress message into its
 * final ✅ / ❌ / ⏭️ outcome).
 */
export async function editMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  content: string
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    }
  );

  if (!response.ok) {
    throw new Error(`Discord edit failed: ${response.status}`);
  }
}

/**
 * Add an emoji reaction to a message (e.g. ✅ / ❌ on the original post).
 */
export async function addReaction(
  botToken: string,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(
      emoji
    )}/@me`,
    { method: "PUT", headers: { Authorization: `Bot ${botToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Discord reaction failed: ${response.status}`);
  }
}

/**
 * Remove the bot's own emoji reaction from a message.
 */
export async function removeReaction(
  botToken: string,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(
      emoji
    )}/@me`,
    { method: "DELETE", headers: { Authorization: `Bot ${botToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Discord reaction removal failed: ${response.status}`);
  }
}

/**
 * Format a progress/outcome line. The emoji conveys state: ⬇️ in progress,
 * ✅ done, ❌ failed, ⏭️ skipped.
 * Example: "⬇️ 1/3: (provider=twitter category=`art` tags=`tag1,tag2`)"
 */
export function formatProgress(
  index: number,
  total: number,
  seed: Seed,
  emoji = "⬇️"
): string {
  const category = seed.category ? `\`${seed.category}\`` : "-";
  const tags = seed.tags?.length ? `\`${seed.tags.join(",")}\`` : "-";
  return `${emoji} ${index}/${total}: (provider=${seed.provider} category=${category} tags=${tags})`;
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
