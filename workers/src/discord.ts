import type { Seed } from "./types";

/**
 * Send a notification to Discord via webhook
 */
export async function sendNotification(
  webhookUrl: string,
  message: string
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status}`);
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
