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

  // Process the page's files concurrently — this is I/O-bound (Dropbox download
  // + R2 put per file), so parallelism is a large speedup. Subrequest count is
  // unchanged (limit keeps it within budget); only wall time drops.
  const outcomes = await Promise.all(
    files.map((path) =>
      processFile(path, env.R2!, dropbox, d1, base, basePrefix, dry)
    )
  );

  let imported = 0;
  let existing = 0;
  let orphans = 0;
  let misplaced = 0;
  let nonTwitter = 0;
  let failed = 0;
  const orphanList: string[] = [];
  const misplacedList: Array<{ path: string; target: string }> = [];
  const nonTwitterList: string[] = [];
  const failedList: Array<{ path: string; error: string }> = [];

  for (const o of outcomes) {
    if (o.misplaced) {
      misplaced++;
      if (misplacedList.length < 50)
        misplacedList.push({ path: o.path, target: o.misplaced });
    }
    switch (o.status) {
      case "imported":
        imported++;
        break;
      case "existing":
        existing++;
        break;
      case "orphan":
        orphans++;
        orphanList.push(o.path);
        break;
      case "nonTwitter":
        nonTwitter++;
        if (nonTwitterList.length < 10) nonTwitterList.push(o.path);
        break;
      case "failed":
        failed++;
        if (failedList.length < 10)
          failedList.push({ path: o.path, error: o.error ?? "" });
        break;
    }
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
    failed,
    hasMore,
    nextCursor,
    orphanList,
    misplacedList,
    nonTwitterList,
    failedList,
  });
}

interface FileOutcome {
  status: "imported" | "existing" | "orphan" | "nonTwitter" | "failed";
  path: string;
  misplaced?: string; // canonical target path, if the file is mis-categorized
  error?: string;
}

async function processFile(
  path: string,
  bucket: R2Bucket,
  dropbox: DropboxStore,
  d1: D1Store,
  base: string,
  basePrefix: string,
  dry: boolean
): Promise<FileOutcome> {
  // A twitter file is identified by its "<screenname>_<tweetid>" filename,
  // regardless of folder (e.g. /garo/unsaved/...). pixiv etc. don't match.
  const filename = path.split("/").filter((s) => s.length > 0).pop() ?? "";
  const m = FILENAME_RE.exec(filename);
  if (!m) return { status: "nonTwitter", path };
  const screenname = m[1];
  const id = m[2];

  try {
    const d1cat = await d1.getCategory(id, PROVIDER);
    if (d1cat === null) return { status: "orphan", path };
    const category = d1cat.length > 0 ? d1cat : DEFAULT_CATEGORY;

    // R2 key — D1 category is authoritative; always author-separated.
    const key = [base, PROVIDER, category, screenname, filename].join("/");

    // Misplaced = not under the correct category folder in Dropbox (author
    // subdir vs category-root doesn't matter). Recorded for later reconcile.
    const correctPrefix = `${basePrefix}/${PROVIDER}/${category.toLowerCase()}/`;
    const misplaced = path.toLowerCase().startsWith(correctPrefix)
      ? undefined
      : `/${[base, PROVIDER, category, filename].join("/")}`;

    if (await bucket.head(key)) return { status: "existing", path, misplaced };
    if (dry) return { status: "imported", path, misplaced }; // would import

    const data = await dropbox.downloadFile(path);
    await bucket.put(key, data, {
      httpMetadata: { contentType: contentType(filename) },
    });
    return { status: "imported", path, misplaced };
  } catch (e) {
    return {
      status: "failed",
      path,
      error: e instanceof Error ? e.message : String(e),
    };
  }
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
