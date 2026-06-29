import type { Post, Author, Media } from "../types";

const API_BASE = "https://api.twitterapi.io";

interface TwitterApiResponse {
  tweets?: Tweet[];
  status?: string;
  msg?: string;
}

interface Tweet {
  id: string;
  url?: string;
  text?: string;
  createdAt?: string;
  author?: TweetAuthor;
  extendedEntities?: { media?: MediaItem[] };
}

interface TweetAuthor {
  id?: string;
  userName?: string;
  name?: string;
  profilePicture?: string;
  description?: string;
}

interface MediaItem {
  type?: string; // "photo" | "video" | "animated_gif"
  media_url_https?: string;
  video_info?: { variants?: Variant[] };
}

interface Variant {
  bitrate?: number;
  content_type?: string;
  url?: string;
}

/**
 * Parse a Twitter/X post URL
 */
export function parsePostUrl(
  postUrl: string
): { id: string; screenname: string } | null {
  try {
    const url = new URL(postUrl);
    if (url.host !== "twitter.com" && url.host !== "x.com") {
      return null;
    }

    const parts = url.pathname.split("/");
    if (parts.length < 4 || parts[2] !== "status") {
      return null;
    }

    return { id: parts[3], screenname: parts[1] };
  } catch {
    return null;
  }
}

/**
 * Fetch a post from Twitter/X via twitterapi.io
 */
export async function getPost(apiKey: string, postUrl: string): Promise<Post> {
  if (!apiKey) {
    throw new Error("TWITTERAPI_IO_KEY is not configured");
  }

  const parsed = parsePostUrl(postUrl);
  if (!parsed) {
    throw new Error("Invalid X post URL");
  }

  const { id } = parsed;

  const res = await fetch(
    `${API_BASE}/twitter/tweets?tweet_ids=${encodeURIComponent(id)}`,
    { headers: { "X-API-Key": apiKey } }
  );

  if (!res.ok) {
    throw new Error(`twitterapi.io request failed: ${res.status}`);
  }

  const data = (await res.json()) as TwitterApiResponse;
  const tweet = data.tweets?.[0];
  if (!tweet) {
    throw new Error("Post not found");
  }

  const a = tweet.author ?? {};
  const screenname = a.userName ?? parsed.screenname;
  const author: Author = {
    id: a.id ?? "",
    screen_name: screenname,
    name: a.name ?? "",
    description: a.description ?? "",
    avatar: a.profilePicture ?? "",
    provider: "twitter",
  };

  const media = extractMedia(tweet.extendedEntities?.media);

  return {
    id: tweet.id,
    provider: "twitter",
    url: `https://x.com/${screenname}/status/${tweet.id}`,
    timestamp: parseTimestamp(tweet.createdAt),
    content: tweet.text ?? "",
    author,
    media: media.length > 0 ? media : undefined,
  };
}

/**
 * Convert twitterapi.io media entries into standard Media objects.
 * Photos use the large variant; videos/GIFs use the highest-bitrate mp4.
 */
function extractMedia(items?: MediaItem[]): Media[] {
  if (!items) return [];

  const media: Media[] = [];
  for (const item of items) {
    if (item.type === "photo") {
      if (item.media_url_https) {
        media.push({ type: "photo", url: toLargePhoto(item.media_url_https) });
      }
    } else if (item.type === "video" || item.type === "animated_gif") {
      const url = bestMp4(item.video_info?.variants);
      if (url) {
        media.push({ type: "video", url });
      }
    }
  }
  return media;
}

/**
 * Pick the highest-bitrate mp4 variant from a video's variants.
 */
function bestMp4(variants?: Variant[]): string | undefined {
  if (!variants) return undefined;
  let best: Variant | undefined;
  for (const v of variants) {
    if (v.content_type !== "video/mp4" || !v.url) continue;
    if (!best || (v.bitrate ?? 0) > (best.bitrate ?? 0)) {
      best = v;
    }
  }
  return best?.url;
}

/**
 * Add name=large to a pbs.twimg.com photo URL to get the full-size image.
 */
function toLargePhoto(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("name", "large");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Parse twitterapi.io createdAt ("Tue Mar 21 20:50:14 +0000 2006") to ISO 8601.
 */
function parseTimestamp(createdAt?: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}
