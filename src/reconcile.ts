import type { Env } from "./types";
import { DropboxStore } from "./stores/dropbox";
import { D1Store } from "./stores/d1";
import { NotionStore } from "./stores/notion";

const PROVIDER = "twitter";
const DEFAULT_CATEGORY = "uncategorized";
const FILENAME_RE = /^(.+)_(\d{15,})(?:_\d+)?\.[A-Za-z0-9]+$/;

/** Canonical folder/category for a D1 category value (empty → uncategorized). */
function canonical(d1cat: string): string {
  return d1cat.length > 0 ? d1cat : DEFAULT_CATEGORY;
}

/** Retry a Dropbox write on 429 (too_many_write_operations) with backoff. */
async function retry429<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (i < tries - 1 && (msg.includes("(429)") || msg.includes("too_many_write"))) {
        await new Promise((r) => setTimeout(r, 600 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

/**
 * General, D1-driven reconcile: scan a store and bring any item whose category
 * doesn't match D1 (the source of truth) into line. Idempotent and re-runnable
 * for any future drift — not tied to a specific rename list.
 *   ?target=r2        — move R2 objects to their D1 category prefix
 *   ?target=dropbox   — move Dropbox files to their D1 category folder
 *   ?target=notion    — update Notion Category select to match D1
 * Paginate via the returned nextCursor; dry-run unless ?dry=0.
 */
export async function handleReconcile(url: URL, env: Env): Promise<Response> {
  const target = url.searchParams.get("target");
  const dry = url.searchParams.get("dry") !== "0" && url.searchParams.get("dry") !== "false";
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const d1 = D1Store.fromEnv(env);
  if (!d1) return Response.json({ error: "D1 required" }, { status: 400 });

  if (target === "r2") {
    if (!env.R2) return Response.json({ error: "R2 not configured" }, { status: 400 });
    const dropbox = DropboxStore.fromEnv(env);
    const base = (dropbox?.baseDirPath() ?? "").replace(/^\/+|\/+$/g, "");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "15") || 15, 50);
    return Response.json(await reconcileR2(env, d1, base, cursor, limit, dry));
  }

  if (target === "dropbox") {
    const dropbox = DropboxStore.fromEnv(env);
    if (!dropbox) return Response.json({ error: "Dropbox not configured" }, { status: 400 });
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "30") || 30, 100);
    return Response.json(await reconcileDropbox(dropbox, d1, cursor, limit, dry));
  }

  if (target === "notion") {
    const notion = NotionStore.fromEnv(env);
    if (!notion) return Response.json({ error: "Notion not configured" }, { status: 400 });
    if (dry) return Response.json({ status: "ok", dry, note: "notion reconcile has no dry mode; pass dry=0" });
    return Response.json({ status: "ok", dry, ...(await notion.reconcileCategories(d1, cursor)) });
  }

  return Response.json({ error: "target must be r2 | dropbox | notion" }, { status: 400 });
}

async function reconcileR2(
  env: Env,
  d1: D1Store,
  base: string,
  cursor: string | undefined,
  limit: number,
  dry: boolean
) {
  const prefix = `${base}/${PROVIDER}/`;
  const listing = await env.R2!.list({ prefix, cursor, limit });

  const items = listing.objects
    .map((o) => {
      const after = o.key.slice(prefix.length); // <cat>/<...>/<file>
      const keyCat = after.slice(0, after.indexOf("/"));
      const filename = after.slice(after.lastIndexOf("/") + 1);
      const m = FILENAME_RE.exec(filename);
      return m ? { key: o.key, keyCat, after, id: m[2] } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const ids = [...new Set(items.map((x) => x.id))];
  const cats = await d1.getCategories(ids, PROVIDER);

  let moved = 0;
  let ok = 0;
  let missing = 0;
  let failed = 0;
  const failedList: Array<{ key: string; error: string }> = [];

  // Decide first (cheap), then move only the drifted with limited concurrency —
  // R2 get→put streams count against the connection limit, so we buffer each
  // object (arrayBuffer closes the get stream) and cap concurrency.
  const drifted: Array<{ it: (typeof items)[number]; canon: string }> = [];
  for (const it of items) {
    const d1cat = cats.get(it.id);
    if (d1cat === undefined) {
      missing++;
      continue;
    }
    const canon = canonical(d1cat);
    if (it.keyCat === canon) ok++;
    else drifted.push({ it, canon });
  }

  if (dry) {
    moved = drifted.length;
  } else {
    const CONC = 4;
    for (let i = 0; i < drifted.length; i += CONC) {
      await Promise.all(
        drifted.slice(i, i + CONC).map(async ({ it, canon }) => {
          try {
            const o = await env.R2!.get(it.key);
            if (!o) {
              ok++; // already moved by a prior run
              return;
            }
            const data = await o.arrayBuffer();
            const newKey = `${prefix}${canon}/${it.after.slice(it.keyCat.length + 1)}`;
            await env.R2!.put(newKey, data, { httpMetadata: o.httpMetadata });
            await env.R2!.delete(it.key);
            moved++;
          } catch (e) {
            failed++;
            if (failedList.length < 10)
              failedList.push({ key: it.key, error: e instanceof Error ? e.message : String(e) });
          }
        })
      );
    }
  }

  return {
    status: "ok",
    dry,
    scanned: listing.objects.length,
    ok,
    moved,
    missing,
    failed,
    failedList,
    hasMore: listing.truncated,
    nextCursor: listing.truncated ? listing.cursor : undefined,
  };
}

async function reconcileDropbox(
  dropbox: DropboxStore,
  d1: D1Store,
  cursor: string | undefined,
  limit: number,
  dry: boolean
) {
  const basePrefix = dropbox.baseDirPath().toLowerCase();
  const base = basePrefix.replace(/^\/+|\/+$/g, "");
  const { files, cursor: nextCursor, hasMore } = await dropbox.listFolder(cursor, limit);

  const items = files
    .map((path) => {
      const filename = path.split("/").filter((s) => s.length > 0).pop() ?? "";
      const m = FILENAME_RE.exec(filename);
      return m ? { path, filename, id: m[2] } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const ids = [...new Set(items.map((x) => x.id))];
  const cats = await d1.getCategories(ids, PROVIDER);

  let moved = 0;
  let deleted = 0;
  let ok = 0;
  let missing = 0;
  let failed = 0;
  const failedList: Array<{ path: string; error: string }> = [];

  // Decide first (cheap), then run Dropbox writes with low concurrency + 429
  // retry — move_v2/delete_v2 share a low write-rate limit.
  const actions: Array<{ path: string; target: string }> = [];
  for (const it of items) {
    const d1cat = cats.get(it.id);
    if (d1cat === undefined) {
      missing++;
      continue;
    }
    const canon = canonical(d1cat);
    if (it.path.toLowerCase().startsWith(`${basePrefix}/${PROVIDER}/${canon.toLowerCase()}/`)) {
      ok++;
      continue;
    }
    actions.push({ path: it.path, target: `/${[base, PROVIDER, canon, it.filename].join("/")}` });
  }

  if (dry) {
    moved = actions.length;
  } else {
    const CONC = 5;
    for (let i = 0; i < actions.length; i += CONC) {
      await Promise.all(
        actions.slice(i, i + CONC).map(async (a) => {
          try {
            await retry429(() => dropbox.moveFile(a.path, a.target));
            moved++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // "to/conflict" → canonical already exists → this is a redundant
            // duplicate; remove it (recoverable from Dropbox trash).
            if (msg.includes("to/conflict")) {
              try {
                await retry429(() => dropbox.deleteFile(a.path));
                deleted++;
              } catch (e2) {
                failed++;
                if (failedList.length < 10)
                  failedList.push({ path: a.path, error: e2 instanceof Error ? e2.message : String(e2) });
              }
            } else {
              failed++;
              if (failedList.length < 10) failedList.push({ path: a.path, error: msg });
            }
          }
        })
      );
    }
  }

  return {
    status: "ok",
    dry,
    scanned: files.length,
    ok,
    moved,
    deleted,
    missing,
    failed,
    failedList,
    hasMore,
    nextCursor,
  };
}
