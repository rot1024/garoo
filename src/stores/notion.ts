import type { Env, Post, Author } from "../types";
import type { Store } from "./index";
import { isText, isSpecialCategory } from "../post";

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const RETRY_COUNT = 2;

// Property names (mirror notion/properties.go).
const P = {
  postTitle: "Name",
  postID: "ID",
  postAuthorName: "Author Name",
  postAuthorID: "Author ID",
  postAuthor: "Author",
  postDescription: "Description",
  postCategory: "Category",
  postLabels: "Tags",
  postProvider: "Provider",
  postURL: "URL",
  postDate: "Date",
  postMedia: "Media",
  postMediaRaw: "Media Raw",
  postIndex: "Index",
  postCount: "Count",
  authorTitle: "Name",
  authorID: "ID",
  authorName: "User Name",
  authorScreenname: "Screenname",
  authorProvider: "Provider",
  authorAvatar: "Avatar",
} as const;

type Json = Record<string, unknown>;

/**
 * Notion store. Faithful port of notion/store.go + notion/properties.go.
 * Non-text posts create one page per media item (deduping the author into the
 * author DB first); text posts ("_" category) create a single page in the
 * secondary post DB.
 */
export class NotionStore implements Store {
  readonly name = "notion";

  constructor(
    private readonly token: string,
    private readonly postDB: string,
    private readonly postDB2: string,
    private readonly authorDB: string
  ) {}

  static fromEnv(env: Env): NotionStore | null {
    if (!env.NOTION_TOKEN || !env.NOTION_POST_DB || !env.NOTION_AUTHOR_DB) {
      return null;
    }
    return new NotionStore(
      env.NOTION_TOKEN,
      env.NOTION_POST_DB,
      env.NOTION_SECONDARY_POST_DB ?? "",
      env.NOTION_AUTHOR_DB
    );
  }

  async save(post: Post): Promise<void> {
    const text = isText(post);
    let authorPageID: string | undefined;

    if (!text) {
      const media = post.media ?? [];
      if (media.length === 0) {
        throw new Error("no media");
      }
      const existing = await this.getAuthor(post.author);
      authorPageID = await this.saveAuthor(post.author, existing);
    }

    const postPageIDs = await this.getPost(post);

    if (postPageIDs.length === 0) {
      if (text) {
        await this.savePost(post, 0, undefined, authorPageID);
      } else {
        const media = post.media ?? [];
        for (let i = 0; i < media.length; i++) {
          await this.savePost(post, i, undefined, authorPageID);
        }
      }
    } else {
      for (let i = 0; i < postPageIDs.length; i++) {
        await this.savePost(post, i, postPageIDs[i], authorPageID);
      }
    }
  }

  /**
   * General reconcile: scan one page of the post DB and update any page whose
   * Category select doesn't match D1 (the source of truth). Idempotent and
   * re-runnable for any future drift. Paginate via the returned nextCursor.
   * Empty/special D1 categories are left as-is (save() doesn't set Category
   * for them).
   */
  async reconcileCategories(
    d1: { getCategories(ids: string[], provider: string): Promise<Map<string, string>> },
    cursor: string | undefined,
    pageSize = 40
  ): Promise<{ scanned: number; updated: number; hasMore: boolean; nextCursor?: string }> {
    const res = await fetch(`${API}/databases/${this.postDB}/query`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(
        cursor ? { page_size: pageSize, start_cursor: cursor } : { page_size: pageSize }
      ),
    });
    if (!res.ok) {
      throw new Error(`notion query failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      results?: Array<{ id: string; properties?: Record<string, any> }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };
    const pages = (data.results ?? []).map((r) => {
      const props = r.properties ?? {};
      const idProp = props[P.postID]?.rich_text?.[0];
      return {
        pageId: r.id,
        postId: idProp?.plain_text ?? idProp?.text?.content ?? "",
        cat: props[P.postCategory]?.select?.name ?? "",
      };
    });
    const ids = [...new Set(pages.map((p) => p.postId).filter((s) => s.length > 0))];
    const d1cats = await d1.getCategories(ids, "twitter");

    let updated = 0;
    for (const p of pages) {
      if (!p.postId) continue;
      const d1cat = d1cats.get(p.postId);
      if (d1cat === undefined || d1cat === "") continue; // not in D1 / special-empty
      if (p.cat === d1cat) continue; // already correct
      try {
        await this.updatePage(p.pageId, { [P.postCategory]: { select: { name: d1cat } } });
        updated++;
      } catch (e) {
        console.error(`notion reconcile failed for ${p.pageId}:`, e);
      }
    }
    return {
      scanned: pages.length,
      updated,
      hasMore: !!data.has_more,
      nextCursor: data.next_cursor ?? undefined,
    };
  }

  // --- author ---

  private async getAuthor(author: Author): Promise<string | undefined> {
    const res = await this.queryDB(this.authorDB, P.authorID, author.id);
    return res[0];
  }

  private async saveAuthor(
    author: Author,
    pageID: string | undefined
  ): Promise<string> {
    const properties = authorProperties(author);
    const page = pageID
      ? await this.updatePage(pageID, properties)
      : await this.createPage(this.authorDB, properties);
    return page;
  }

  // --- post ---

  // if i === 0, the post is handled as text (parity with notion/store.go).
  private async savePost(
    post: Post,
    i: number,
    pageID: string | undefined,
    authorPageID: string | undefined
  ): Promise<void> {
    const properties = postProperties(post, i, authorPageID);
    await retry(RETRY_COUNT, async () => {
      if (pageID) {
        await this.updatePage(pageID, properties);
      } else {
        await this.createPageWithChildren(
          this.postDBFor(post),
          properties,
          blocks(post, i)
        );
      }
    });
  }

  private async getPost(post: Post): Promise<string[]> {
    return this.queryDB(this.postDBFor(post), P.postID, post.id);
  }

  private postDBFor(post: Post): string {
    if (isText(post) && this.postDB2) return this.postDB2;
    return this.postDB;
  }

  // --- Notion REST helpers ---

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    };
  }

  private async queryDB(
    db: string,
    property: string,
    equals: string
  ): Promise<string[]> {
    const data = await retry(RETRY_COUNT, async () => {
      const res = await fetch(`${API}/databases/${db}/query`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          filter: { property, rich_text: { equals } },
        }),
      });
      if (!res.ok) {
        throw new Error(`notion query failed (${res.status}): ${await res.text()}`);
      }
      return (await res.json()) as { results?: Array<{ id: string }> };
    });
    return (data.results ?? []).map((r) => r.id);
  }

  private async createPage(db: string, properties: Json): Promise<string> {
    return this.createPageWithChildren(db, properties, undefined);
  }

  private async createPageWithChildren(
    db: string,
    properties: Json,
    children: Json[] | undefined
  ): Promise<string> {
    const body: Json = { parent: { database_id: db }, properties };
    if (children && children.length > 0) body.children = children;
    const res = await fetch(`${API}/pages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`notion create page failed (${res.status}): ${await res.text()}`);
    }
    const page = (await res.json()) as { id: string };
    return page.id;
  }

  private async updatePage(pageID: string, properties: Json): Promise<string> {
    const res = await fetch(`${API}/pages/${pageID}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      throw new Error(`notion update page failed (${res.status}): ${await res.text()}`);
    }
    const page = (await res.json()) as { id: string };
    return page.id;
  }
}

// --- property / block builders (port of notion/properties.go) ---

function authorProperties(a: Author): Json {
  return {
    [P.authorTitle]: title(a.name ?? ""),
    [P.authorID]: richText(a.id),
    [P.authorName]: richText(a.name ?? ""),
    [P.authorScreenname]: richText(a.screen_name),
    [P.authorProvider]: select(a.provider),
    [P.authorAvatar]: files(a.screen_name, a.avatar ?? ""),
  };
}

// if i === 0, the post is handled as text (media properties only added for i > 0).
function postProperties(
  post: Post,
  i: number,
  authorPageID: string | undefined
): Json {
  const media = post.media ?? [];
  let tags = post.tags ? [...post.tags] : [];
  if (i > 0 && media.length > 0) {
    const m = media[i];
    if (m.type === "video" && !tags.includes("video")) {
      tags.push("video");
    }
  }

  const properties: Json = {
    [P.postTitle]: title(postTitle(post)),
    [P.postID]: richText(post.id),
    [P.postAuthorName]: richText(post.author.name ?? ""),
    [P.postAuthorID]: richText(post.author.id),
    [P.postDescription]: richText(post.content),
    [P.postProvider]: select(post.provider),
    [P.postURL]: { url: post.url },
  };

  // Notion rejects an empty date string; only set Date when we have a timestamp.
  if (post.timestamp) {
    properties[P.postDate] = { date: { start: post.timestamp } };
  }

  if (!isSpecialCategory(post)) {
    properties[P.postCategory] = select(post.category ?? "");
  }

  if (authorPageID) {
    properties[P.postAuthor] = { relation: [{ id: authorPageID }] };
  }

  if (tags.length > 0) {
    properties[P.postLabels] = {
      multi_select: tags.map((t) => ({ name: t })),
    };
  }

  if (i > 0 && media.length > 0) {
    const m = media[i];
    const mediaProp = files(fileName(post, i), m.url);
    properties[P.postMedia] = mediaProp;
    properties[P.postMediaRaw] = mediaProp;
    properties[P.postIndex] = { number: i + 1 };
    properties[P.postCount] = { number: media.length };
  }

  return properties;
}

function blocks(post: Post, i: number): Json[] {
  const media = post.media ?? [];
  const res: Json[] = [];

  if (media.length > 0) {
    const m = media[i];
    if (m.type === "photo") {
      res.push({
        object: "block",
        type: "image",
        image: { type: "external", external: { url: m.url } },
      });
    } else if (m.type === "video") {
      res.push({
        object: "block",
        type: "video",
        video: { type: "external", external: { url: m.url } },
      });
    }
  } else {
    res.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: richTextArray(post.content) },
    });
  }

  res.push({ object: "block", type: "embed", embed: { url: post.url } });
  return res;
}

function postTitle(post: Post): string {
  return `@${post.author.screen_name} ${formatDate(post.timestamp)}`;
}

function fileName(post: Post, i: number): string {
  const media = post.media ?? [];
  const index = media.length > 1 ? `_${i}` : "";
  return `${post.author.screen_name}_${post.id}${index}`;
}

// --- small Notion JSON helpers ---

function richTextArray(s: string): Json[] {
  return [{ type: "text", text: { content: s } }];
}
function title(s: string): Json {
  return { title: richTextArray(s) };
}
function richText(s: string): Json {
  return { rich_text: richTextArray(s) };
}
function select(name: string): Json {
  return { select: { name } };
}
function files(name: string, url: string): Json {
  return {
    files: [{ type: "external", name, external: { url } }],
  };
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

async function retry<T>(n: number, f: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < n; i++) {
    try {
      return await f();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
