import type { Env, Post } from "../types";
import type { Store, PrevRecord } from "./index";
import {
  normBase,
  normCategory,
  mediaFilename,
  r2Key,
  contentType,
} from "./r2key";

/**
 * R2 store. Saves media alongside Dropbox, but with a simpler layout: always
 * <base>/<provider>/<category>/<screenname>/<filename> (author-separated from
 * the start — no root/overflow-move logic). The base mirrors the Dropbox base
 * dir (e.g. "garo") so R2 and Dropbox share the same structure. When a post
 * already in D1 is re-saved with a different category, the existing object is
 * moved to the new path (copy + delete within R2, no re-download).
 */
export class R2Store implements Store {
  readonly name = "r2";

  constructor(
    private readonly bucket: R2Bucket,
    private readonly base: string
  ) {}

  static fromEnv(env: Env): R2Store | null {
    if (!env.R2) return null;
    // Reuse the Dropbox base dir so R2 mirrors the Dropbox layout (e.g. "garo").
    return new R2Store(env.R2, normBase(env.DROPBOX_BASE_DIR));
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
      const newKey = this.key(post.provider, newCat, screenname, name);

      // Category overwrite: move the existing object instead of re-downloading.
      if (categoryChanged) {
        const oldKey = this.key(post.provider, oldCat!, screenname, name);
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

  private key(
    provider: string,
    category: string,
    screenname: string,
    name: string
  ): string {
    return r2Key(this.base, provider, category, screenname, name);
  }
}

async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to download media from ${url}: ${res.status}`);
  }
  return res.arrayBuffer();
}

function filename(post: Post, i: number, screenname: string): string {
  return mediaFilename(
    post.id,
    (post.media ?? [])[i]?.url ?? "",
    i,
    post.media?.length ?? 0,
    screenname
  );
}
