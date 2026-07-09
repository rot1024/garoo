import type { Env } from "../types";
import { json } from "./auth";
import { contentType } from "../stores/r2key";

// GET /api/media/<key> — stream a private R2 object to an authenticated user.
// The caller (router) has already checked the session cookie. Supports HTTP
// Range so <video> can seek, and marks responses immutable (media is keyed by
// post id and never rewritten in place) so the browser caches them.

/** Parse a single-range "bytes=start-end" header into an R2 range option. */
function parseRange(header: string): R2Range | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") return { suffix: Number(endStr) }; // last N bytes
  const offset = Number(startStr);
  if (endStr === "") return { offset };
  return { offset, length: Number(endStr) - offset + 1 };
}

export async function handleMedia(
  request: Request,
  env: Env,
  key: string
): Promise<Response> {
  if (!env.R2) return json({ error: "R2 not configured" }, 503);

  // Don't serve outside the media tree: block traversal and the SQL backup dump.
  if (key.includes("..") || key.split("/").includes("_backup")) {
    return json({ error: "forbidden" }, 403);
  }

  const rangeHeader = request.headers.get("Range");
  const range = rangeHeader ? parseRange(rangeHeader) : null;

  const object = await env.R2.get(key, range ? { range } : undefined);
  if (!object) return json({ error: "not found" }, 404);

  const headers = new Headers();
  headers.set(
    "content-type",
    object.httpMetadata?.contentType || contentType(key) || "application/octet-stream"
  );
  headers.set("accept-ranges", "bytes");
  headers.set("etag", object.httpEtag);
  // Auth-gated, so private; immutable because a given key never changes content.
  headers.set("cache-control", "private, max-age=31536000, immutable");

  if (range && object.range) {
    const size = object.size;
    let start = 0;
    let end = size - 1;
    const r = object.range as { offset?: number; length?: number; suffix?: number };
    if (typeof r.suffix === "number") {
      start = size - r.suffix;
    } else {
      if (typeof r.offset === "number") start = r.offset;
      if (typeof r.length === "number") end = start + r.length - 1;
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
