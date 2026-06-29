import type { Env, Post } from "../types";
import type { Store, PrevRecord } from "./index";

const DEFAULT_CATEGORY = "uncategorized";

/**
 * R2 store. Saves media alongside Dropbox, but with a simpler layout: always
 * <provider>/<category>/<screenname>/<filename> (author-separated from the
 * start — no root/overflow-move logic). When a post already in D1 is re-saved
 * with a different category, the existing object is moved to the new path
 * (copy + delete within R2, no re-download).
 */
export class R2Store implements Store {
  readonly name = "r2";

  constructor(private readonly bucket: R2Bucket) {}

  static fromEnv(env: Env): R2Store | null {
    return env.R2 ? new R2Store(env.R2) : null;
  }

  async save(post: Post, prev?: PrevRecord): Promise<void> {
    const media = post.media ?? [];
    if (media.length === 0) return;

    const screenname = post.author.screen_name.toLowerCase();
    const newCat = normCategory(post.category);
    const oldCat =
      prev?.category !== undefined ? normCategory(prev.category) : undefined;
    const categoryChanged = oldCat !== undefined && oldCat !== newCat;

    for (let i = 0; i < media.length; i++) {
      const name = filename(post, i, screenname);
      const newKey = `${post.provider}/${newCat}/${screenname}/${name}`;

      // Category overwrite: move the existing object instead of re-downloading.
      if (categoryChanged) {
        const oldKey = `${post.provider}/${oldCat}/${screenname}/${name}`;
        const existing = await this.bucket.get(oldKey);
        if (existing) {
          await this.bucket.put(newKey, existing.body, {
            httpMetadata: existing.httpMetadata,
          });
          await this.bucket.delete(oldKey);
          console.log(`r2: moved ${oldKey} -> ${newKey}`);
          continue;
        }
      }

      const data = await download(media[i].url);
      await this.bucket.put(newKey, data, {
        httpMetadata: { contentType: contentType(name) },
      });
      console.log(`r2: saved ${newKey}`);
    }
  }
}

function normCategory(c?: string): string {
  return c && c.length > 0 ? c : DEFAULT_CATEGORY;
}

async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to download media from ${url}: ${res.status}`);
  }
  return res.arrayBuffer();
}

function filename(post: Post, i: number, screenname: string): string {
  const ext = extname((post.media ?? [])[i]?.url ?? "");
  if ((post.media?.length ?? 0) <= 1) {
    return `${screenname}_${post.id}${ext}`;
  }
  return `${screenname}_${post.id}_${i + 1}${ext}`;
}

function extname(url: string): string {
  let p = url;
  try {
    p = new URL(url).pathname;
  } catch {
    // not a URL; use as-is
  }
  const base = p.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

function contentType(name: string): string | undefined {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    default:
      return undefined;
  }
}
