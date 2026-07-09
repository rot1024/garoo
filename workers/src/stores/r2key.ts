// Shared R2 key/layout logic, used by both the R2 store (writing media) and the
// gallery API (reconstructing an existing object's key from a D1 row). Keeping
// this in one place means the gallery reads exactly the keys r2.ts wrote — if
// the layout ever changes, both move together.
//
// Layout: <base>/<provider>/<category>/<screenname>/<filename>
//   base       = DROPBOX_BASE_DIR (e.g. "garo"), R2 mirrors the Dropbox tree
//   category   = normCategory(...) ("uncategorized" when empty)
//   screenname = author screen_name, lowercased
//   filename   = "<screenname>_<id>[_<n>].<ext>" (n only for multi-media posts)

export const DEFAULT_CATEGORY = "uncategorized";

/** Category as used in the R2 path — empty/undefined collapses to the default. */
export function normCategory(c?: string): string {
  return c && c.length > 0 ? c : DEFAULT_CATEGORY;
}

/** Normalize a base dir the way R2Store.fromEnv does (strip leading/trailing "/"). */
export function normBase(base?: string): string {
  return (base ?? "").replace(/^\/+|\/+$/g, "");
}

/** The file extension (incl. dot) from a media URL, or "" if none. */
export function extname(url: string): string {
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

/**
 * Filename for media index `i` of a post: "<screenname>_<id>.<ext>" for a
 * single-media post, "<screenname>_<id>_<n>.<ext>" (1-based) for multi-media.
 * `mediaUrl` supplies the extension. Mirrors r2.ts filename().
 */
export function mediaFilename(
  id: string,
  mediaUrl: string,
  i: number,
  total: number,
  screenname: string
): string {
  const ext = extname(mediaUrl);
  if (total <= 1) return `${screenname}_${id}${ext}`;
  return `${screenname}_${id}_${i + 1}${ext}`;
}

/** Join the R2 key from its parts, dropping empty segments (e.g. empty base). */
export function r2Key(
  base: string,
  provider: string,
  category: string,
  screenname: string,
  name: string
): string {
  return [base, provider, category, screenname, name]
    .filter((s) => s.length > 0)
    .join("/");
}

/** Media kind inferred from the file extension (D1 stores no per-media type). */
export function mediaType(url: string): "photo" | "video" {
  return extname(url).toLowerCase() === ".mp4" ? "video" : "photo";
}

/** Guess a Content-Type from a filename/URL extension. */
export function contentType(name: string): string | undefined {
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
