import type { Env } from "../types";
import { json, handleSession, requireAuth } from "./auth";
import { handleList, handleFacets, handleGetOne, handlePatch } from "./pictures";
import { handleMedia } from "./media";

// Router for the private gallery API. Mounted on /api/* (which run_worker_first
// in wrangler.toml routes to the Worker before static assets). Returns null for
// non-/api paths so the caller can fall through to the SPA / debug endpoints.
//
// /api/health and /api/session are public; everything else requires the session
// cookie (see auth.ts). This is a separate surface from the DEBUG-gated
// maintenance endpoints — the gallery must work in production with DEBUG off.
export async function handleGallery(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;

  if (path === "/api/health") {
    return json({ status: "ok", service: "garoo-gallery" });
  }
  if (path === "/api/session") {
    return handleSession(request, env);
  }

  // All data/media endpoints below require a valid session cookie.
  const denied = await requireAuth(request, env);
  if (denied) return denied;

  if (path === "/api/pictures" && request.method === "GET") {
    return handleList(url, env);
  }
  if (path === "/api/facets" && request.method === "GET") {
    return handleFacets(env);
  }

  const pic = /^\/api\/pictures\/([^/]+)\/([^/]+)$/.exec(path);
  if (pic) {
    const provider = decodeURIComponent(pic[1]);
    const id = decodeURIComponent(pic[2]);
    if (request.method === "GET") return handleGetOne(env, provider, id);
    if (request.method === "PATCH") return handlePatch(request, env, provider, id);
    return json({ error: "method not allowed" }, 405);
  }

  if (path.startsWith("/api/media/") && request.method === "GET") {
    const key = decodeURIComponent(path.slice("/api/media/".length));
    return handleMedia(request, env, key);
  }

  return json({ error: "not found" }, 404);
}
