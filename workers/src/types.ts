// Types aligned with Go garoo/model.go

export type MediaType = "photo" | "video";

export interface Media {
  type: MediaType;
  url: string;
}

export interface Author {
  id: string;
  screen_name: string;
  name?: string;
  description?: string;
  avatar?: string;
  provider: string;
}

export interface Post {
  id: string;
  provider: string;
  url: string;
  timestamp: string; // ISO 8601
  content: string;
  author: Author;
  media?: Media[];
  category?: string;
  tags?: string[];
}

export interface Seed {
  url: string;
  provider: string;
  category?: string;
  tags?: string[];
}

export interface Env {
  KV: KVNamespace;
  // "true"/"1" exposes the unauthenticated HTTP action endpoints (debug/admin).
  DEBUG?: string;

  // Static Assets binding: serves the built gallery SPA (web/dist). Requests
  // under /api/* run the Worker first (run_worker_first in wrangler.toml); all
  // other paths fall through to these assets with SPA fallback.
  ASSETS?: Fetcher;

  // Shared secret gating the private gallery (/api/*, /gallery). The single user
  // enters this key once; the Worker exchanges it for an HttpOnly session cookie.
  // Unrelated to DEBUG — the gallery is a production surface, not a debug action.
  GALLERY_KEY?: string;
  TWITTERAPI_IO_KEY?: string;
  // Kept for the archived browser-based provider (providers/x_browser.ts),
  // which may be revived later. Not used by the active twitterapi.io provider.
  BROWSER?: Fetcher;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CHANNEL_ID?: string;
  // Owner to @-mention on errors (Go: GAROO_DISCORD_USER). Optional.
  DISCORD_USER_ID?: string;

  // D1 database for post metadata (pictures table)
  DB?: D1Database;

  // R2 bucket for media files (saved alongside Dropbox)
  R2?: R2Bucket;

  // Dropbox store (client creds as secrets; token state cached in KV)
  DROPBOX_CLIENT_ID?: string;
  DROPBOX_CLIENT_SECRET?: string;
  DROPBOX_BASE_DIR?: string;

  // Notion store
  NOTION_TOKEN?: string;
  NOTION_POST_DB?: string;
  NOTION_SECONDARY_POST_DB?: string;
  NOTION_AUTHOR_DB?: string;
}

export interface WebhookPayload {
  content: string;
}
