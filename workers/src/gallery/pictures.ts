import type { Env } from "../types";
import { json } from "./auth";
import {
  normBase,
  normCategory,
  mediaFilename,
  r2Key,
  mediaType,
  contentType,
} from "../stores/r2key";

// Gallery data API over the D1 `pictures` table. D1 is the source of truth for
// category/tags; R2 holds the media. The media keys aren't stored in D1 — we
// reconstruct them from the row (provider/category/screenname/id + the original
// media URLs' extensions) using the exact same layout r2.ts writes with, so the
// gallery reads back precisely what was saved. See stores/r2key.ts.

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

interface Row {
  picture_id: number;
  id: string;
  user_name: string | null;
  user_screenname: string | null;
  user_id: string | null;
  description: string | null;
  provider: string;
  url: string | null;
  created_at: string | null;
  category: string | null;
  label: string | null;
  count: number | null;
  media_url: string | null;
  user_avatar_url: string | null;
  _sortkey?: string | number | null; // computed sort key (list query only)
}

interface MediaDTO {
  key: string;
  type: "photo" | "video";
  index: number;
}

interface PictureDTO {
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
  media: MediaDTO[];
  cursor: string;
}

/** Split the space-joined `label` column into individual tags. */
function splitTags(label: string | null): string[] {
  return (label ?? "").split(/\s+/).filter(Boolean);
}

/** Reconstruct the R2 media keys for a row (empty when the post has no media). */
function reconstructMedia(row: Row, base: string): MediaDTO[] {
  const urls = (row.media_url ?? "").split(",").filter(Boolean);
  if (urls.length === 0) return [];
  const screenname = (row.user_screenname ?? "").toLowerCase();
  const category = normCategory(row.category ?? undefined);
  return urls.map((u, i) => {
    const name = mediaFilename(row.id, u, i, urls.length, screenname);
    return {
      key: r2Key(base, row.provider, category, screenname, name),
      type: mediaType(u),
      index: i,
    };
  });
}

function rowToDto(row: Row, base: string): PictureDTO {
  return {
    pictureId: row.picture_id,
    id: row.id,
    provider: row.provider,
    url: row.url ?? "",
    screenName: row.user_screenname ?? "",
    userName: row.user_name ?? "",
    userId: row.user_id ?? "",
    avatar: row.user_avatar_url ?? "",
    description: row.description ?? "",
    category: row.category ?? "",
    tags: splitTags(row.label),
    createdAt: row.created_at ?? "",
    count: row.count ?? 0,
    media: reconstructMedia(row, base),
    // Cursor keys off whichever sort key the list query computed (_sortkey);
    // falls back to created_at for single-item fetches that don't select it.
    cursor: encodeCursor(
      String(row._sortkey ?? row.created_at ?? ""),
      row.picture_id
    ),
  };
}

// Cursor = base64url("<sortKey> <picture_id>"). Keyset pagination on
// (sortKey, picture_id) -- stable and index-friendly, unlike OFFSET. The
// picture id is the LAST space-separated token, so the key may contain spaces
// (created_at is "YYYY-MM-DD HH:MM:SS") -- split on the last space.
function encodeCursor(key: string, pictureId: number): string {
  return btoa(unescape(encodeURIComponent(`${key} ${pictureId}`)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeCursor(cursor: string): { key: string; pictureId: number } | null {
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const raw = decodeURIComponent(escape(atob(b64)));
    const i = raw.lastIndexOf(" ");
    if (i < 0) return null;
    return { key: raw.slice(0, i), pictureId: Number(raw.slice(i + 1)) };
  } catch {
    return null;
  }
}

/**
 * GET /api/pictures — newest-first (default) list of media posts with keyset
 * pagination and filters: category (repeatable), tag (repeatable, AND), author,
 * provider, media=photo|video|all, q (free text), sort=newest|oldest.
 */
export async function handleList(url: URL, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "D1 not configured" }, 503);
  const base = normBase(env.DROPBOX_BASE_DIR);

  // Sort modes: post date (created_at), registration order (picture_id, i.e.
  // when garoo saved it), or a seeded shuffle (random). All are stable so keyset
  // paging stays consistent: random orders by a deterministic hash of the row id
  // mixed with the seed, so the same seed reproduces the same shuffle.
  const sortParam = url.searchParams.get("sort") ?? "newest";
  const SORTS = ["newest", "oldest", "added_desc", "added_asc", "random"] as const;
  const sort = (SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as (typeof SORTS)[number])
    : "newest";

  // Seeded shuffle. The row's sort value is (picture_id * MULT) % P, where the
  // per-seed MULT is itself spread across [1, P) by a multiply-mod of the seed
  // (computed with BigInt for exactness, then inlined -- it's a plain number, so
  // no injection). Deriving MULT this way means even adjacent seeds produce very
  // different multipliers, so the ordering actually reshuffles for tiny ids too;
  // a bare additive seed does not. P = 2147483647 (prime); id*MULT (<=~1e6 * 2e9
  // = 2e15) stays well within int64.
  const seed = Math.abs(Math.trunc(Number(url.searchParams.get("seed")))) || 0;
  const P = 2147483647n;
  let mult = Number((BigInt(seed) * 2654435761n) % P);
  if (mult === 0) mult = 1;
  const HASH = `((picture_id * ${mult}) % 2147483647)`;

  // Sort key expression + whether it is numeric (how the cursor value is bound)
  // + direction.
  let keyExpr: string;
  let keyNumeric: boolean;
  let desc: boolean;
  switch (sort) {
    case "oldest":
      keyExpr = "created_at"; keyNumeric = false; desc = false; break;
    case "added_desc":
      keyExpr = "picture_id"; keyNumeric = true; desc = true; break;
    case "added_asc":
      keyExpr = "picture_id"; keyNumeric = true; desc = false; break;
    case "random":
      keyExpr = HASH; keyNumeric = true; desc = false; break;
    default: // newest
      keyExpr = "created_at"; keyNumeric = false; desc = true; break;
  }

  const limit = Math.min(
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
    MAX_LIMIT
  );

  // No base media filter: text/media-less posts (e.g. the "_" category) show
  // too, with a solid-colour fallback tile on the client.
  const where: string[] = [];
  const binds: unknown[] = [];

  const categories = url.searchParams.getAll("category").filter(Boolean);
  if (categories.length) {
    where.push(`category IN (${categories.map(() => "?").join(",")})`);
    binds.push(...categories);
  }

  for (const tag of url.searchParams.getAll("tag").filter(Boolean)) {
    // Word-boundary match within the space-joined label, case-insensitive.
    where.push("instr(' ' || lower(label) || ' ', ' ' || lower(?) || ' ') > 0");
    binds.push(tag);
  }

  const providers = url.searchParams.getAll("provider").filter(Boolean);
  if (providers.length) {
    where.push(`provider IN (${providers.map(() => "?").join(",")})`);
    binds.push(...providers);
  }

  const authors = url.searchParams.getAll("author").filter(Boolean);
  if (authors.length) {
    where.push(
      `lower(user_screenname) IN (${authors.map(() => "?").join(",")})`
    );
    binds.push(...authors.map((a) => a.toLowerCase()));
  }

  // Media-type filter. `mediaset` is a comma list of image|video|none. Absent
  // (old links) defaults to image+video (has media). Present -> OR the selected
  // conditions; present-but-empty -> match nothing.
  const mediaset = url.searchParams.get("mediaset");
  if (mediaset === null) {
    where.push("media_url != ''");
  } else {
    const types = mediaset.split(",");
    const conds: string[] = [];
    if (types.includes("image"))
      conds.push("(media_url != '' AND media_url NOT LIKE '%.mp4%')");
    if (types.includes("video")) conds.push("media_url LIKE '%.mp4%'");
    if (types.includes("none")) conds.push("media_url = ''");
    where.push(conds.length ? `(${conds.join(" OR ")})` : "1=0");
  }

  const q = url.searchParams.get("q");
  if (q) {
    where.push(
      "(description LIKE ? OR user_name LIKE ? OR user_screenname LIKE ?)"
    );
    const like = `%${q}%`;
    binds.push(like, like, like);
  }

  const cursorRaw = url.searchParams.get("cursor");
  if (cursorRaw) {
    const c = decodeCursor(cursorRaw);
    if (c) {
      const cmp = desc ? "<" : ">";
      const keyVal: unknown = keyNumeric ? Number(c.key) : c.key;
      // Generic keyset step: strictly after the cursor in (keyExpr, picture_id).
      where.push(
        `(${keyExpr} ${cmp} ? OR (${keyExpr} = ? AND picture_id ${cmp} ?))`
      );
      binds.push(keyVal, keyVal, c.pictureId);
    }
  }

  const dir = desc ? "DESC" : "ASC";
  const orderBy = `${keyExpr} ${dir}, picture_id ${dir}`;
  const whereSql = where.length ? `WHERE ${where.join(" AND ")} ` : "";
  // Also select the sort key so each row's cursor can carry it (needed for the
  // random hash, which isn't otherwise present in the row).
  const sql =
    `SELECT *, (${keyExpr}) AS _sortkey FROM pictures ${whereSql}` +
    `ORDER BY ${orderBy} LIMIT ?`;
  binds.push(limit + 1); // fetch one extra to know if there's a next page

  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<Row>();

  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const items = page.map((r) => rowToDto(r, base));
  const nextCursor = hasMore ? items[items.length - 1].cursor : null;

  return json({ items, nextCursor });
}

/** GET /api/pictures/:provider/:id — a single post (for detail deep-links). */
export async function handleGetOne(
  env: Env,
  provider: string,
  id: string
): Promise<Response> {
  if (!env.DB) return json({ error: "D1 not configured" }, 503);
  const row = await env.DB.prepare(
    "SELECT * FROM pictures WHERE id = ? AND provider = ? LIMIT 1"
  )
    .bind(id, provider)
    .first<Row>();
  if (!row) return json({ error: "not found" }, 404);
  return json({ item: rowToDto(row, normBase(env.DROPBOX_BASE_DIR)) });
}

/**
 * GET /api/facets — distinct categories (with counts), the tag universe (with
 * counts), and providers, for building the filter UI. Tags are aggregated in JS
 * since they're space-joined in a single column; fine at personal scale.
 */
export async function handleFacets(env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "D1 not configured" }, 503);

  const cats = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(category, ''), '') AS category, COUNT(*) AS n
     FROM pictures GROUP BY category ORDER BY n DESC`
  ).all<{ category: string; n: number }>();

  const provs = await env.DB.prepare(
    `SELECT provider, COUNT(*) AS n FROM pictures
     GROUP BY provider ORDER BY n DESC`
  ).all<{ provider: string; n: number }>();

  const authors = await env.DB.prepare(
    `SELECT user_screenname AS screenName, MAX(user_name) AS userName,
            MAX(user_avatar_url) AS avatar, COUNT(*) AS n
     FROM pictures
     WHERE user_screenname IS NOT NULL AND user_screenname != ''
     GROUP BY user_screenname ORDER BY n DESC`
  ).all<{
    screenName: string;
    userName: string | null;
    avatar: string | null;
    n: number;
  }>();

  // Aggregate tags across all labels.
  const labels = await env.DB.prepare(
    `SELECT label FROM pictures WHERE label IS NOT NULL AND label != ''`
  ).all<{ label: string }>();
  const tagCounts = new Map<string, number>();
  for (const { label } of labels.results) {
    for (const t of splitTags(label)) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }
  const tags = [...tagCounts.entries()]
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));

  return json({
    categories: cats.results.map((c) => ({ category: c.category, n: c.n })),
    providers: provs.results.map((p) => ({ provider: p.provider, n: p.n })),
    authors: authors.results.map((a) => ({
      screenName: a.screenName,
      userName: a.userName ?? "",
      avatar: a.avatar ?? "",
      n: a.n,
    })),
    tags,
  });
}

/**
 * PATCH /api/pictures/:provider/:id — edit category and/or tags.
 * D1 is updated in place; on a category change the post's R2 objects are moved
 * from the old category path to the new one (copy + delete, no re-download) so
 * the gallery keeps resolving them. Dropbox/Notion are left to the existing
 * `/reconcile` maintenance flow (D1 is the source of truth).
 */
export async function handlePatch(
  request: Request,
  env: Env,
  provider: string,
  id: string
): Promise<Response> {
  if (!env.DB) return json({ error: "D1 not configured" }, 503);

  let body: { category?: string; tags?: string[] };
  try {
    body = (await request.json()) as { category?: string; tags?: string[] };
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const row = await env.DB.prepare(
    "SELECT * FROM pictures WHERE id = ? AND provider = ? LIMIT 1"
  )
    .bind(id, provider)
    .first<Row>();
  if (!row) return json({ error: "not found" }, 404);

  const sets: string[] = [];
  const binds: unknown[] = [];

  // Category change → move R2 objects first, then persist the new category.
  const wantsCategory =
    typeof body.category === "string" && body.category !== (row.category ?? "");
  if (wantsCategory) {
    const newCategory = body.category as string;
    if (env.R2) {
      await moveCategory(env.R2, normBase(env.DROPBOX_BASE_DIR), row, newCategory);
    }
    sets.push("category = ?");
    binds.push(newCategory);
  }

  if (Array.isArray(body.tags)) {
    const label = body.tags.map((t) => t.trim()).filter(Boolean).join(" ");
    sets.push("label = ?");
    binds.push(label);
  }

  if (sets.length === 0) {
    return json({ item: rowToDto(row, normBase(env.DROPBOX_BASE_DIR)) });
  }

  binds.push(id, provider);
  await env.DB.prepare(
    `UPDATE pictures SET ${sets.join(", ")} WHERE id = ? AND provider = ?`
  )
    .bind(...binds)
    .run();

  const updated = await env.DB.prepare(
    "SELECT * FROM pictures WHERE id = ? AND provider = ? LIMIT 1"
  )
    .bind(id, provider)
    .first<Row>();

  return json({ item: rowToDto(updated ?? row, normBase(env.DROPBOX_BASE_DIR)) });
}

/** Move a post's media from its current category path to `newCategory` in R2. */
async function moveCategory(
  bucket: R2Bucket,
  base: string,
  row: Row,
  newCategory: string
): Promise<void> {
  const oldCat = normCategory(row.category ?? undefined);
  const newCat = normCategory(newCategory);
  if (oldCat === newCat) return;

  const screenname = (row.user_screenname ?? "").toLowerCase();
  const urls = (row.media_url ?? "").split(",").filter(Boolean);
  for (let i = 0; i < urls.length; i++) {
    const name = mediaFilename(row.id, urls[i], i, urls.length, screenname);
    const oldKey = r2Key(base, row.provider, oldCat, screenname, name);
    const newKey = r2Key(base, row.provider, newCat, screenname, name);
    if (oldKey === newKey) continue;
    const existing = await bucket.get(oldKey);
    if (!existing) continue;
    await bucket.put(newKey, existing.body, {
      httpMetadata:
        existing.httpMetadata ?? { contentType: contentType(name) },
    });
    await bucket.delete(oldKey);
    console.log(`gallery: moved ${oldKey} -> ${newKey}`);
  }
}
