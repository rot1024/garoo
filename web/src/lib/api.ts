// Typed client for the gallery Worker API. All requests are same-origin, so the
// HttpOnly session cookie is sent automatically (including by <img>/<video>).

export interface MediaRef {
  key: string;
  type: "photo" | "video";
  index: number;
}

export interface Picture {
  pictureId: number;
  id: string;
  provider: string;
  url: string;
  screenName: string;
  userName: string;
  userId: string;
  avatar: string;
  description: string;
  category: string;
  tags: string[];
  createdAt: string;
  count: number;
  media: MediaRef[];
  cursor: string;
}

export interface Facets {
  categories: { category: string; n: number }[];
  providers: { provider: string; n: number }[];
  authors: { screenName: string; userName: string; avatar: string; n: number }[];
  tags: { tag: string; n: number }[];
}

export type SortMode = "newest" | "oldest" | "added_desc" | "added_asc";

export interface ListParams {
  sort?: SortMode;
  cursor?: string | null;
  categories?: string[];
  tags?: string[];
  providers?: string[];
  authors?: string[];
  media?: "all" | "photo" | "video";
  q?: string | null;
  limit?: number;
}

export interface ListResult {
  items: Picture[];
  nextCursor: string | null;
}

/** Thrown on a 401 so the app can drop back to the login screen. */
export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** URL for a media object, encoding each path segment but preserving slashes. */
export function mediaUrl(key: string): string {
  return "/api/media/" + key.split("/").map(encodeURIComponent).join("/");
}

export async function getSession(): Promise<boolean> {
  try {
    const r = await request<{ authed: boolean }>("/api/session");
    return r.authed;
  } catch {
    return false;
  }
}

export async function login(key: string): Promise<boolean> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ key }),
  });
  return res.ok;
}

export function listPictures(params: ListParams): Promise<ListResult> {
  const q = new URLSearchParams();
  if (params.sort) q.set("sort", params.sort);
  if (params.cursor) q.set("cursor", params.cursor);
  for (const c of params.categories ?? []) q.append("category", c);
  for (const t of params.tags ?? []) q.append("tag", t);
  for (const p of params.providers ?? []) q.append("provider", p);
  for (const a of params.authors ?? []) q.append("author", a);
  if (params.media && params.media !== "all") q.set("media", params.media);
  if (params.q) q.set("q", params.q);
  if (params.limit) q.set("limit", String(params.limit));
  return request<ListResult>(`/api/pictures?${q.toString()}`);
}

export async function getPicture(
  provider: string,
  id: string
): Promise<Picture> {
  const r = await request<{ item: Picture }>(
    `/api/pictures/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`
  );
  return r.item;
}

export function getFacets(): Promise<Facets> {
  return request<Facets>("/api/facets");
}

export async function updatePicture(
  provider: string,
  id: string,
  patch: { category?: string; tags?: string[] }
): Promise<Picture> {
  const r = await request<{ item: Picture }>(
    `/api/pictures/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );
  return r.item;
}
