import type { Env } from "../types";

/**
 * Small key/value store + single-flight lock backed by D1 (the `state` table).
 *
 * Replaces the KV-backed poll lock and last_message_id. The old poll lock did a
 * KV put + delete every cron minute (1440 + 1440/day), which blew past KV's
 * 1000/day free write/delete quota — poll_lock puts then started failing and
 * took the whole poll (and thus archiving) down with them. D1 writes are 100k/day
 * free, so the same 1-minute cadence fits comfortably.
 */
export class D1State {
  constructor(private readonly db: D1Database) {}

  static fromEnv(env: Env): D1State | null {
    return env.DB ? new D1State(env.DB) : null;
  }

  /** Value for key, or null if absent or expired. */
  async get(key: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        "SELECT value FROM state WHERE key = ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1"
      )
      .bind(key, Date.now())
      .first<{ value: string }>();
    return row?.value ?? null;
  }

  /** Upsert a value (no expiry). */
  async put(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO state (key, value, expires_at) VALUES (?, ?, NULL)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`
      )
      .bind(key, value)
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.db.prepare("DELETE FROM state WHERE key = ?").bind(key).run();
  }

  /**
   * Atomically acquire a lock, returning true only if it was free (absent or
   * expired). The single INSERT..ON CONFLICT is atomic on D1's primary, so two
   * overlapping cron ticks can't both acquire: the loser's UPDATE is guarded out
   * by the WHERE and reports 0 rows changed. `ttlSeconds` is the crash backstop —
   * the lock auto-frees after it even if a run dies before releasing.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const res = await this.db
      .prepare(
        `INSERT INTO state (key, value, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
           WHERE state.expires_at IS NULL OR state.expires_at <= ?`
      )
      .bind(key, String(now), now + ttlSeconds * 1000, now)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }
}
