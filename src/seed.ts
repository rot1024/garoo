import type { Seed } from "./types";

/**
 * Detect provider from URL
 */
function detectProvider(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.host === "x.com" || parsed.host === "twitter.com") {
      // Check if it's a valid post URL
      const parts = parsed.pathname.split("/");
      if (parts.length >= 4 && parts[2] === "status") {
        return "twitter";
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract seeds from a message content
 * Format: "https://x.com/... [category] [tag1] [tag2] ..."
 * Use "-" for category to skip it
 */
export function extractSeeds(content: string): Seed[] {
  const lines = content.split("\n").map((line) => line.trim());
  const seeds: Seed[] = [];

  for (const line of lines) {
    if (!line.startsWith("http://") && !line.startsWith("https://")) {
      continue;
    }

    const parts = line.split(/\s+/);
    const url = parts[0];
    const provider = detectProvider(url);

    if (!provider) {
      continue;
    }

    let category: string | undefined;
    let tags: string[] = [];

    if (parts.length > 1) {
      // Category is the second part, "-" means no category
      category = parts[1] === "-" ? undefined : parts[1];
    }

    if (parts.length > 2) {
      // Remaining parts are tags
      tags = parts.slice(2);
    }

    seeds.push({ url, provider, category, tags });
  }

  return seeds;
}
