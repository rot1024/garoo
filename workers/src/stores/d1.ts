import type { Env, Post } from "../types";
import type { Store } from "./index";

const SCHEMA = `CREATE TABLE IF NOT EXISTS pictures (
  picture_id INTEGER PRIMARY KEY,
  id TEXT NOT NULL,
  user_name TEXT,
  user_screenname TEXT,
  user_id TEXT,
  description TEXT,
  provider TEXT NOT NULL,
  url TEXT,
  created_at TEXT,
  category TEXT,
  label TEXT,
  count INTEGER,
  media_url TEXT,
  user_avatar_url TEXT,
  UNIQUE(id, provider)
);`;

/**
 * D1 store. Mirrors sqlite/store.go: upserts post metadata into the
 * `pictures` table (media URLs joined with commas).
 */
export class D1Store implements Store {
  readonly name = "d1";

  constructor(private readonly db: D1Database) {}

  static fromEnv(env: Env): D1Store | null {
    return env.DB ? new D1Store(env.DB) : null;
  }

  async save(post: Post): Promise<void> {
    const mediaUrls = (post.media ?? []).map((m) => m.url).join(",");
    const label = post.tags?.length ? post.tags.join(" ") : "";

    await this.db
      .prepare(
        `REPLACE INTO pictures
          (id, user_name, user_screenname, user_id, description, provider, url, created_at, category, label, count, media_url, user_avatar_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        post.id,
        post.author.name ?? "",
        post.author.screen_name,
        post.author.id,
        post.content,
        post.provider,
        post.url,
        formatTime(post.timestamp),
        post.category ?? "",
        label,
        post.media?.length ?? 0,
        mediaUrls,
        post.author.avatar ?? ""
      )
      .run();
  }

  /**
   * Export the pictures table as a restorable SQL dump (used by the
   * Dropbox backup in Phase F). Restore with `wrangler d1 execute --file`.
   */
  async exportDump(): Promise<string> {
    const { results } = await this.db
      .prepare("SELECT * FROM pictures ORDER BY picture_id")
      .all<Record<string, unknown>>();

    const lines: string[] = [SCHEMA, ""];
    for (const row of results) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => sqlLiteral(row[c]));
      lines.push(
        `REPLACE INTO pictures (${cols.join(", ")}) VALUES (${vals.join(", ")});`
      );
    }
    return lines.join("\n") + "\n";
  }
}

/** Format an ISO 8601 timestamp as "YYYY-MM-DD HH:MM:SS" (UTC), like sqlite/store.go formatTime. */
function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}
