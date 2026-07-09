import type { Env } from "../types";

// Single-user gallery auth. The user knows GALLERY_KEY (a Worker secret) and
// enters it once; we exchange it for an HttpOnly session cookie so that both
// fetch() calls and <img>/<video> requests (which can't send Authorization
// headers) are authenticated by the browser automatically.
//
// The cookie holds an HMAC-SHA256 derived token, NOT the raw key — only the
// server (which holds GALLERY_KEY) can mint or verify it, and a leaked cookie
// doesn't reveal the key. Verification is stateless: recompute the expected
// token each request and constant-time compare. This is deliberately light —
// one trusted user, no roles, no session store (see the plan discussion).

const COOKIE_NAME = "garoo_session";
const SESSION_MSG = "garoo-gallery-session-v1";
const MAX_AGE = 180 * 24 * 60 * 60; // 180 days

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Dynamic, per-request data (list/facets change as posts are edited) — must
      // not be edge/browser cached, or filters return stale results.
      "cache-control": "no-store",
      ...headers,
    },
  });
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const ck = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", ck, enc.encode(msg));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The session token expected in the cookie, derived from GALLERY_KEY. */
function sessionToken(env: Env): Promise<string> {
  return hmacHex(env.GALLERY_KEY!, SESSION_MSG);
}

/** Length-safe constant-time string compare. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Whether the request carries a valid session cookie. Returns false when
 * GALLERY_KEY is unset (nothing to authenticate against — deny by default).
 */
export async function isAuthed(request: Request, env: Env): Promise<boolean> {
  if (!env.GALLERY_KEY) return false;
  const cookie = getCookie(request, COOKIE_NAME);
  if (!cookie) return false;
  return timingSafeEqual(cookie, await sessionToken(env));
}

/**
 * Gate a gallery request. Returns null when authorized; otherwise a 401 (or 503
 * if the gallery isn't configured) the caller should return directly.
 */
export async function requireAuth(
  request: Request,
  env: Env
): Promise<Response | null> {
  if (!env.GALLERY_KEY) {
    return json({ error: "gallery not configured" }, 503);
  }
  if (await isAuthed(request, env)) return null;
  return json({ error: "unauthorized" }, 401);
}

/**
 * POST /api/session { key } — validate the key, set the session cookie.
 * GET  /api/session       — report whether the current cookie is valid.
 */
export async function handleSession(
  request: Request,
  env: Env
): Promise<Response> {
  if (!env.GALLERY_KEY) {
    return json({ error: "gallery not configured" }, 503);
  }

  if (request.method === "GET") {
    return json({ authed: await isAuthed(request, env) });
  }

  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let key = "";
  try {
    const body = (await request.json()) as { key?: string };
    key = body.key ?? "";
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  if (!timingSafeEqual(key, env.GALLERY_KEY)) {
    return json({ error: "invalid key" }, 401);
  }

  const token = await sessionToken(env);
  // Secure only over https so the cookie still works on http://localhost during
  // `wrangler dev` (browsers drop Secure cookies on insecure origins).
  const secure = new URL(request.url).protocol === "https:";
  const cookie =
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}` +
    (secure ? "; Secure" : "");
  return json({ authed: true }, 200, { "Set-Cookie": cookie });
}
