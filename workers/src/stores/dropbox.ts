import type { Env, Post } from "../types";
import type { Store } from "./index";

const API = "https://api.dropboxapi.com";
const CONTENT = "https://content.dropboxapi.com";
const KV_TOKEN_KEY = "dropbox_token";
const MAX_ROOT_FILES_PER_AUTHOR = 5;
const DEFAULT_CATEGORY = "uncategorized";

interface TokenState {
  access_token?: string;
  refresh_token: string;
  expiry_ms?: number;
}

interface DropboxListResult {
  entries?: Array<{ [".tag"]?: string; path_lower?: string }>;
  cursor?: string;
  has_more?: boolean;
}

/**
 * Dropbox store. Faithful port of dropbox/store.go + auth.go.
 *
 * Auth: an OAuth2 token state ({access_token, refresh_token, expiry_ms}) is
 * kept in KV under "dropbox_token". The refresh_token must be seeded once
 * (extracted from the Go app's pinned "CONFIG:" Discord message); the access
 * token is refreshed on demand and written back to KV.
 *
 * Layout: <base_dir>/<provider>/<category>/ with per-author subdirectories,
 * moving files out of the root once an author exceeds 5 files there.
 */
export class DropboxStore implements Store {
  readonly name = "dropbox";

  constructor(
    private readonly kv: KVNamespace,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly baseDir: string
  ) {}

  static fromEnv(env: Env): DropboxStore | null {
    if (
      !env.KV ||
      !env.DROPBOX_CLIENT_ID ||
      !env.DROPBOX_CLIENT_SECRET ||
      !env.DROPBOX_BASE_DIR
    ) {
      return null;
    }
    return new DropboxStore(
      env.KV,
      env.DROPBOX_CLIENT_ID,
      env.DROPBOX_CLIENT_SECRET,
      env.DROPBOX_BASE_DIR
    );
  }

  async save(post: Post): Promise<void> {
    const media = post.media ?? [];
    if (media.length === 0) {
      console.log("dropbox: no media");
      return;
    }

    // Look up the author dir; if present, save there.
    const authorDir = this.dirpathWithAuthorName(post);
    if (await this.folderExists(authorDir)) {
      console.log(`dropbox: found author dir ${authorDir}`);
      await this.savePostTo(post, authorDir);
      return;
    }

    // Create the root dir if needed.
    const rootDir = this.dirpath(post);
    if (!(await this.folderExists(rootDir))) {
      console.log(`dropbox: creating root dir ${rootDir}`);
      await this.createDir(rootDir);
    }

    // List the root dir and keep only this author's files.
    let files = await this.readdir(rootDir);
    files = extractFilesByScreenName(files, post.author.screen_name);

    // Too many of this author's files in the root → move them to a subdir.
    if (files.length + media.length > MAX_ROOT_FILES_PER_AUTHOR) {
      // NOTE: parity with dropbox/store.go — the new dir uses the raw
      // screenname (not lowercased, unlike dirpathWithAuthorName).
      const newDir = joinPath(rootDir, post.author.screen_name);
      console.log(
        `dropbox: too many files in root (${files.length}+${media.length}>${MAX_ROOT_FILES_PER_AUTHOR}); moving ${files.length} file(s) to ${newDir}`
      );
      await this.createDir(newDir);
      await this.moveFiles(files, newDir);
      console.log(`dropbox: moved ${files.length} file(s) to ${newDir}`);
      await this.savePostTo(post, newDir);
      return;
    }

    console.log(`dropbox: saving to root dir ${rootDir}`);
    await this.savePostTo(post, rootDir);
  }

  private async savePostTo(post: Post, dir: string): Promise<void> {
    const media = post.media ?? [];
    for (let i = 0; i < media.length; i++) {
      const dest = joinPath(dir, filename(post, i));
      const data = await this.download(media[i].url);
      await this.upload(dest, data);
      console.log(`dropbox: saved ${i + 1}/${media.length} ${dest}`);
    }
  }

  // --- Dropbox HTTP API ---

  private async folderExists(path: string): Promise<boolean> {
    const res = await this.rpc("/2/files/get_metadata", { path });
    if (res.ok) {
      const meta = (await res.json()) as { [".tag"]?: string };
      return meta[".tag"] === "folder";
    }
    const err = (await res.json().catch(() => null)) as {
      error?: { path?: { [".tag"]?: string } };
    } | null;
    if (res.status === 409 && err?.error?.path?.[".tag"] === "not_found") {
      return false;
    }
    throw new Error(
      `dropbox get_metadata failed (${res.status}): ${JSON.stringify(err)}`
    );
  }

  private async readdir(path: string): Promise<string[]> {
    const result: string[] = [];
    let data = await this.rpcJson<{
      entries?: Array<{ [".tag"]?: string; path_lower?: string }>;
      cursor?: string;
      has_more?: boolean;
    }>("/2/files/list_folder", { path });

    for (;;) {
      for (const e of data.entries ?? []) {
        if (e[".tag"] === "file" && e.path_lower) result.push(e.path_lower);
      }
      if (!data.has_more || !data.cursor) break;
      data = await this.rpcJson("/2/files/list_folder/continue", {
        cursor: data.cursor,
      });
    }
    return result;
  }

  private async createDir(path: string): Promise<void> {
    await this.rpcJson("/2/files/create_folder_v2", { path });
  }

  private async moveFiles(files: string[], dest: string): Promise<void> {
    for (const f of files) {
      const to = joinPath(dest, basename(f));
      await this.rpcJson("/2/files/move_v2", { from_path: f, to_path: to });
    }
  }

  private async download(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`failed to download media from ${url}: ${res.status}`);
    }
    return res.arrayBuffer();
  }

  /** Upload the D1 SQL dump as a backup file under <base_dir>/_backup/garoo.sql. */
  async backup(sql: string): Promise<void> {
    const path = joinPath(this.baseDir, "_backup", "garoo.sql");
    await this.upload(path, new TextEncoder().encode(sql).buffer as ArrayBuffer);
  }

  private async upload(path: string, data: ArrayBuffer): Promise<void> {
    const token = await this.accessToken();
    const res = await fetch(`${CONTENT}/2/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": apiArg({ path, mode: "overwrite", mute: true }),
      },
      body: data,
    });
    if (!res.ok) {
      throw new Error(`dropbox upload failed (${res.status}): ${await res.text()}`);
    }
  }

  private async rpc(endpoint: string, body: unknown): Promise<Response> {
    const token = await this.accessToken();
    return fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  private async rpcJson<T>(endpoint: string, body: unknown): Promise<T> {
    const res = await this.rpc(endpoint, body);
    if (!res.ok) {
      throw new Error(
        `dropbox ${endpoint} failed (${res.status}): ${await res.text()}`
      );
    }
    return (await res.json()) as T;
  }

  // --- Listing / download (used by the Dropbox → R2 import) ---

  /** The configured base dir, normalized with a leading slash (e.g. "/garo"). */
  baseDirPath(): string {
    return joinPath(this.baseDir);
  }

  /**
   * Recursively list files under the base dir, one page at a time. Pass the
   * returned cursor back to continue. `limit` bounds entries per page so a
   * single import invocation stays within the subrequest budget.
   */
  async listFolder(
    cursor?: string,
    limit = 100
  ): Promise<{ files: string[]; cursor: string; hasMore: boolean }> {
    const data = cursor
      ? await this.rpcJson<DropboxListResult>("/2/files/list_folder/continue", {
          cursor,
        })
      : await this.rpcJson<DropboxListResult>("/2/files/list_folder", {
          path: this.baseDirPath(),
          recursive: true,
          limit,
        });

    const files = (data.entries ?? [])
      .filter((e) => e[".tag"] === "file" && e.path_lower)
      .map((e) => e.path_lower as string);

    return { files, cursor: data.cursor ?? "", hasMore: !!data.has_more };
  }

  /** Move a Dropbox file from one path to another (used by category reconcile). */
  async moveFile(from: string, to: string): Promise<void> {
    await this.rpcJson("/2/files/move_v2", { from_path: from, to_path: to });
  }

  /** Delete a Dropbox file (recoverable from Dropbox trash for 30 days). */
  async deleteFile(path: string): Promise<void> {
    await this.rpcJson("/2/files/delete_v2", { path });
  }

  /** Download a Dropbox file's bytes by its path. */
  async downloadFile(path: string): Promise<ArrayBuffer> {
    const token = await this.accessToken();
    const res = await fetch(`${CONTENT}/2/files/download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": apiArg({ path }),
      },
    });
    if (!res.ok) {
      throw new Error(
        `dropbox download failed (${res.status}): ${await res.text()}`
      );
    }
    return res.arrayBuffer();
  }

  // --- OAuth login (garoo login dropbox <code>) ---

  /** Dropbox authorize URL; no redirect_uri, so Dropbox shows the code to copy. */
  authUrl(): string {
    const p = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      token_access_type: "offline",
    });
    return `https://www.dropbox.com/oauth2/authorize?${p.toString()}`;
  }

  /** Exchange an authorization code for tokens and store the refresh token in KV. */
  async exchangeCode(code: string): Promise<void> {
    const res = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `dropbox token exchange failed (${res.status}): ${await res.text()}`
      );
    }
    const tok = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    if (!tok.refresh_token) {
      throw new Error("no refresh_token in response");
    }
    const state: TokenState = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expiry_ms: Date.now() + tok.expires_in * 1000,
    };
    await this.kv.put(KV_TOKEN_KEY, JSON.stringify(state));
  }

  // --- Auth (KV-backed OAuth2 refresh) ---

  private async accessToken(): Promise<string> {
    const raw = await this.kv.get(KV_TOKEN_KEY);
    if (!raw) {
      throw new Error(
        `dropbox: no token in KV; seed "${KV_TOKEN_KEY}" with {"refresh_token":"..."}`
      );
    }
    const state = JSON.parse(raw) as TokenState;

    // Reuse the cached access token while it is still valid (60s margin).
    if (
      state.access_token &&
      state.expiry_ms &&
      state.expiry_ms > Date.now() + 60_000
    ) {
      return state.access_token;
    }

    if (!state.refresh_token) {
      throw new Error("dropbox: token state in KV has no refresh_token");
    }

    const res = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: state.refresh_token,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `dropbox token refresh failed (${res.status}): ${await res.text()}`
      );
    }
    const tok = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    const next: TokenState = {
      access_token: tok.access_token,
      refresh_token: state.refresh_token,
      expiry_ms: Date.now() + tok.expires_in * 1000,
    };
    await this.kv.put(KV_TOKEN_KEY, JSON.stringify(next));
    return tok.access_token;
  }

  // --- Path helpers (port of dropbox/store.go) ---

  private dirpath(post: Post): string {
    const cat = post.category && post.category.length > 0 ? post.category : DEFAULT_CATEGORY;
    return joinPath(this.baseDir, post.provider, cat);
  }

  private dirpathWithAuthorName(post: Post): string {
    return joinPath(this.dirpath(post), post.author.screen_name.toLowerCase());
  }
}

/** Build a leading-slash, single-separator Dropbox path from parts (port of path.Join usage). */
function joinPath(...parts: string[]): string {
  const joined = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0)
    .join("/");
  return "/" + joined;
}

function basename(p: string): string {
  const parts = p.split("/").filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? "";
}

function extname(url: string): string {
  let p = url;
  try {
    p = new URL(url).pathname;
  } catch {
    // not a URL; use as-is
  }
  const base = p.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

function filename(post: Post, i: number): string {
  const screenname = post.author.screen_name.toLowerCase();
  const media = post.media ?? [];
  const ext = extname(media[i].url);
  if (media.length === 1) {
    return `${screenname}_${post.id}${ext}`;
  }
  return `${screenname}_${post.id}_${i + 1}${ext}`;
}

function extractFilesByScreenName(files: string[], screenname: string): string[] {
  const prefix = screenname.toLowerCase() + "_";
  return files.filter((f) => basename(f).toLowerCase().startsWith(prefix));
}


/** JSON for the Dropbox-API-Arg header: escape non-ASCII so the header stays valid ASCII. */
function apiArg(obj: unknown): string {
  const json = JSON.stringify(obj);
  let out = "";
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    out +=
      code > 0x7f
        ? "\\u" + code.toString(16).padStart(4, "0")
        : json[i];
  }
  return out;
}
