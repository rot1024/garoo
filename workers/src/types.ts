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
  BROWSER: Fetcher;
  DISCORD_WEBHOOK_URL?: string;
}

export interface WebhookPayload {
  content: string;
}
