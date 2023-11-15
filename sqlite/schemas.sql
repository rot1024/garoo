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
  UNIQUE(id, provider)
);
