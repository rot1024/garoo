import type { Env, Post } from "../types";
import { D1Store } from "./d1";
import { DropboxStore } from "./dropbox";
import { NotionStore } from "./notion";
import { R2Store } from "./r2";

/** Snapshot of a post's previously-stored state (from D1), passed to save(). */
export interface PrevRecord {
  category?: string;
}

/**
 * A store persists posts. Mirrors garoo.Store (Save) in the Go app.
 * `prev` carries the previously-stored state (if any) so a store can react to
 * changes (e.g. R2 moves files when the category is overwritten).
 */
export interface Store {
  readonly name: string;
  save(post: Post, prev?: PrevRecord): Promise<void>;
}

/**
 * Build the list of configured stores from the environment.
 * Stores without their required config are skipped (parity with the Go app,
 * where each initX returns nil when unconfigured).
 */
export function buildStores(env: Env): Store[] {
  const stores: Store[] = [];

  const d1 = D1Store.fromEnv(env);
  if (d1) stores.push(d1);

  const dropbox = DropboxStore.fromEnv(env);
  if (dropbox) stores.push(dropbox);

  const r2 = R2Store.fromEnv(env);
  if (r2) stores.push(r2);

  const notion = NotionStore.fromEnv(env);
  if (notion) stores.push(notion);

  return stores;
}

/**
 * Back up the D1 pictures table to R2 as a restorable SQL dump at
 * <base>/_backup/garoo.sql. Uses the D1 and R2 bindings directly (~2
 * subrequests, low CPU) — unlike the Dropbox backup below, whose chunked HTTP
 * upload didn't fit the free plan's 50-subrequest budget. Overwrites the single
 * latest snapshot; D1 Time Travel covers point-in-time recovery (7 days on the
 * free plan). Restore with: download the object, then `wrangler d1 execute
 * garoo --remote --file=garoo.sql`. No-op unless both D1 and R2 are configured.
 */
export async function backupD1ToR2(env: Env): Promise<void> {
  const d1 = D1Store.fromEnv(env);
  if (!d1 || !env.R2) return;

  const base = (env.DROPBOX_BASE_DIR ?? "").replace(/^\/+|\/+$/g, "");
  const key = [base, "_backup", "garoo.sql"]
    .filter((s) => s.length > 0)
    .join("/");
  const sql = await d1.exportDump();
  await env.R2.put(key, sql, {
    httpMetadata: { contentType: "application/sql" },
  });
  console.log(`r2: backup saved ${key} (${sql.length} bytes)`);
}

/**
 * Back up the D1 pictures table to Dropbox (<base_dir>/_backup/garoo.sql).
 * Superseded by backupD1ToR2 (the whole-table dump's chunked Dropbox upload
 * didn't fit the free plan's subrequest budget); kept for reference / a future
 * off-site backup path. No-op unless both the D1 and Dropbox stores are configured.
 */
export async function backupD1ToDropbox(env: Env): Promise<void> {
  const d1 = D1Store.fromEnv(env);
  const dropbox = DropboxStore.fromEnv(env);
  if (!d1 || !dropbox) return;

  const sql = await d1.exportDump();
  await dropbox.backup(sql);
}
