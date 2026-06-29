import type { Env } from "./types";
import { DropboxStore } from "./stores/dropbox";
import { D1Store } from "./stores/d1";

const PROVIDER = "twitter";
const DEFAULT_CATEGORY = "uncategorized";
// "<screenname>_<tweetid>[_<n>].<ext>" (tweet ids are >=15 digits for 2014+).
const FILENAME_RE = /^(.+)_(\d{15,})(?:_\d+)?\.[A-Za-z0-9]+$/;

/**
 * Backfill existing Dropbox media into R2. Lists the Dropbox base dir
 * recursively (one page per call, resumable via the returned cursor) and, for
 * each file, derives the post from the filename and reconciles against D1:
 *  - D1 record found  → put into R2 at D1's category (authoritative; fixes a
 *    missed category move). If the Dropbox path's category differs, the file is
 *    recorded as "misplaced" so the Dropbox side can be reconciled later.
 *  - no D1 record     → reported as an orphan (not imported, Dropbox untouched).
 * Dry-run by default; pass ?dry=0 to actually write to R2.
 */
export async function handleImport(url: URL, env: Env): Promise<Response> {
  const dropbox = DropboxStore.fromEnv(env);
  const d1 = D1Store.fromEnv(env);
  if (!dropbox || !env.R2 || !d1) {
    return Response.json(
      { error: "dropbox, R2, and D1 must all be configured" },
      { status: 400 }
    );
  }

  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? "10") || 10,
    100
  );
  const dryParam = url.searchParams.get("dry");
  const dry = dryParam !== "0" && dryParam !== "false";

  const basePrefix = dropbox.baseDirPath().toLowerCase(); // e.g. "/garo"
  const base = basePrefix.replace(/^\/+|\/+$/g, ""); // e.g. "garo"

  const { files, cursor: nextCursor, hasMore } = await dropbox.listFolder(
    cursor,
    limit
  );

  let imported = 0;
  let existing = 0;
  let orphans = 0;
  let misplaced = 0;
  let nonTwitter = 0;
  const orphanList: string[] = [];
  const misplacedList: Array<{ path: string; target: string }> = [];
  const nonTwitterList: string[] = [];

  for (const path of files) {
    // A twitter file is identified by its "<screenname>_<tweetid>" filename,
    // regardless of which folder it sits in (e.g. /garo/unsaved/...). pixiv and
    // other providers don't match and are skipped.
    const filename = path.split("/").filter((s) => s.length > 0).pop() ?? "";
    const m = FILENAME_RE.exec(filename);
    if (!m) {
      nonTwitter++;
      if (nonTwitterList.length < 10) nonTwitterList.push(path);
      continue;
    }
    const screenname = m[1];
    const id = m[2];

    const d1cat = await d1.getCategory(id, PROVIDER);
    if (d1cat === null) {
      orphans++;
      orphanList.push(path);
      continue;
    }
    const category = d1cat.length > 0 ? d1cat : DEFAULT_CATEGORY;

    // R2 key — D1 category is authoritative; always author-separated.
    const key = [base, PROVIDER, category, screenname, filename].join("/");

    // Misplaced = not under the correct *category* folder in Dropbox (e.g. it's
    // in /garo/unsaved/ or an old category). Author-subdir vs category-root
    // doesn't matter. Record it so the Dropbox side can be reconciled later.
    const correctPrefix = `${basePrefix}/${PROVIDER}/${category.toLowerCase()}/`;
    if (!path.toLowerCase().startsWith(correctPrefix)) {
      misplaced++;
      if (misplacedList.length < 50) {
        misplacedList.push({
          path,
          target: `/${[base, PROVIDER, category, filename].join("/")}`,
        });
      }
    }

    if (await env.R2.head(key)) {
      existing++;
      continue;
    }
    if (dry) continue;

    const data = await dropbox.downloadFile(path);
    await env.R2.put(key, data, {
      httpMetadata: { contentType: contentType(filename) },
    });
    imported++;
  }

  return Response.json({
    status: "ok",
    dry,
    scanned: files.length,
    imported,
    existing,
    orphans,
    misplaced,
    nonTwitter,
    hasMore,
    nextCursor,
    orphanList,
    misplacedList,
    nonTwitterList,
  });
}

function contentType(name: string): string | undefined {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    default:
      return undefined;
  }
}
