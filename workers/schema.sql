-- D1 schema for garoo post metadata. Mirrors sqlite/schemas.sql in the Go app.
CREATE TABLE IF NOT EXISTS pictures (
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
  registered_at TEXT,          -- when garoo first saved this post (UTC); NULL for pre-existing rows
  UNIQUE(id, provider)
);

-- Small key/value + single-flight lock (poll_lock, last_message_id). Formerly in
-- KV, but the poll lock cost a KV write + delete every cron minute (1440+1440/day),
-- blowing past KV's 1000/day free write/delete quota. D1 writes are 100k/day free.
-- expires_at is unix ms (NULL = never); used as the poll lock's crash-backstop TTL.
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);
