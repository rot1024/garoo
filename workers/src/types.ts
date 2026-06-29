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
