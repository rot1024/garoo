import type { Env } from "../types";

// Gallery auth via Cloudflare Access (Zero Trust). Access sits in front of the
// Worker's hostname and handles login (e.g. a one-time PIN mailed to the owner,
// or Google). Every request it lets through carries a signed JWT in the
// `Cf-Access-Jwt-Assertion` header (and the `CF_Authorization` cookie), which we
// verify here — so the Worker never trusts a request that didn't pass Access,
// even if the hostname is reached some other way (e.g. a preview URL left open).
//
// Config (both required in production; deny by default when unset):
//   ACCESS_TEAM_DOMAIN  e.g. "myteam.cloudflareaccess.com"
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//
// Local `wrangler dev` (localhost) has no Access in front, so it's allowed
// through without a token.

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

interface Jwk extends JsonWebKey {
  kid: string;
}

const CERTS_TTL_MS = 60 * 60 * 1000; // Access rotates keys infrequently
let certsCache: { issuer: string; at: number; keys: Map<string, CryptoKey> } | null =
  null;

function issuerOf(env: Env): string {
  const d = env.ACCESS_TEAM_DOMAIN!.trim().replace(/\/+$/, "");
  return d.startsWith("https://") ? d : `https://${d}`;
}

async function fetchKeys(issuer: string): Promise<Map<string, CryptoKey>> {
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      )
    );
  }
  return keys;
}

/** Signing key for `kid`, refetching the cert set once on a miss (rotation). */
async function getKey(issuer: string, kid: string): Promise<CryptoKey | undefined> {
  const fresh =
    certsCache && certsCache.issuer === issuer && Date.now() - certsCache.at < CERTS_TTL_MS;
  if (fresh && certsCache!.keys.has(kid)) return certsCache!.keys.get(kid);
  certsCache = { issuer, at: Date.now(), keys: await fetchKeys(issuer) };
  return certsCache.keys.get(kid);
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as T;
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

/** Verify an Access JWT (RS256 signature, issuer, audience, expiry). */
export async function verifyAccessJwt(token: string, env: Env): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
    if (header.alg !== "RS256" || !header.kid) return false;

    const issuer = issuerOf(env);
    const key = await getKey(issuer, header.kid);
    if (!key) return false;
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!ok) return false;

    const claims = decodeJson<{ iss?: string; aud?: string | string[]; exp?: number; nbf?: number }>(
      parts[1]
    );
    const now = Math.floor(Date.now() / 1000);
    const skew = 60;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return (
      claims.iss === issuer &&
      aud.includes(env.ACCESS_AUD!.trim()) &&
      typeof claims.exp === "number" &&
      claims.exp + skew > now &&
      (claims.nbf === undefined || claims.nbf - skew <= now)
    );
  } catch (e) {
    console.error("access jwt verify failed", e);
    return false;
  }
}

function isLocalDev(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function accessConfigured(env: Env): boolean {
  return !!env.ACCESS_TEAM_DOMAIN && !!env.ACCESS_AUD;
}

/** Whether the request passed Cloudflare Access (or is local dev). */
export async function isAuthed(request: Request, env: Env): Promise<boolean> {
  if (isLocalDev(request)) return true;
  if (!accessConfigured(env)) return false;
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    getCookie(request, "CF_Authorization");
  if (!token) return false;
  return verifyAccessJwt(token, env);
}

/**
 * Gate a gallery request. Returns null when authorized; otherwise a 401 (or 503
 * if Access isn't configured) the caller should return directly.
 */
export async function requireAuth(
  request: Request,
  env: Env
): Promise<Response | null> {
  if (await isAuthed(request, env)) return null;
  if (!accessConfigured(env) && !isLocalDev(request)) {
    return json({ error: "gallery not configured" }, 503);
  }
  return json({ error: "unauthorized" }, 401);
}

/** GET /api/session — report whether the request passed Access. */
export async function handleSession(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }
  return json({ authed: await isAuthed(request, env) });
}
