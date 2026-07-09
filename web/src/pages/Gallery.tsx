import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Moon, Sun, Monitor, SlidersHorizontal, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthContext } from "@/App";
import {
  getFacets,
  listPictures,
  UnauthorizedError,
  type Facets,
  type Picture,
} from "@/lib/api";
import {
  applyTheme,
  getInitialTheme,
  nextTheme,
  type Theme,
} from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Masonry from "@/components/Masonry";
import PictureCard from "@/components/PictureCard";
import FilterBar, {
  DEFAULT_MEDIA_TYPES,
  type Filters,
  type MediaType,
} from "@/components/FilterBar";

const PAGE_SIZE = 40;

const SORT_VALUES = [
  "newest",
  "oldest",
  "added_desc",
  "added_asc",
  "random",
] as const;

const MEDIA_VALUES: MediaType[] = ["image", "video", "none"];

// `mediaset` absent (old links / default) -> image+video; present (even empty
// = show nothing) -> exactly that selection.
function parseMediaset(raw: string | null): MediaType[] {
  if (raw === null) return [...DEFAULT_MEDIA_TYPES];
  return raw.split(",").filter((v): v is MediaType =>
    (MEDIA_VALUES as string[]).includes(v)
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function filtersFromParams(sp: URLSearchParams): Filters {
  const sort = sp.get("sort") ?? "newest";
  return {
    q: sp.get("q") ?? "",
    sort: (SORT_VALUES as readonly string[]).includes(sort)
      ? (sort as Filters["sort"])
      : "newest",
    mediaTypes: parseMediaset(sp.get("mediaset")),
    categories: sp.getAll("category"),
    tags: sp.getAll("tag"),
    providers: sp.getAll("provider"),
    authors: sp.getAll("author"),
    seed: sp.get("seed") ?? "",
  };
}

function paramsFromFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.sort !== "newest") sp.set("sort", f.sort);
  if (!sameSet(f.mediaTypes, DEFAULT_MEDIA_TYPES))
    sp.set("mediaset", f.mediaTypes.join(","));
  for (const c of f.categories) sp.append("category", c);
  for (const t of f.tags) sp.append("tag", t);
  for (const p of f.providers) sp.append("provider", p);
  for (const a of f.authors) sp.append("author", a);
  if (f.sort === "random" && f.seed) sp.set("seed", f.seed);
  return sp;
}

export default function Gallery() {
  const auth = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromParams(searchParams);
  // Serialize filters to a stable key so the fetch effect reruns on any change.
  const filterKey = paramsFromFilters(filters).toString();

  // Mobile: the filter controls are collapsed behind a toggle so the header
  // doesn't grow tall. On lg+ they're always shown inline.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters =
    filters.categories.length +
    filters.tags.length +
    filters.providers.length +
    filters.authors.length +
    (filters.q ? 1 : 0) +
    (sameSet(filters.mediaTypes, DEFAULT_MEDIA_TYPES) ? 0 : 1);

  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  // In "system" mode, re-apply when the OS light/dark preference changes.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const [facets, setFacets] = useState<Facets | null>(null);
  const [items, setItems] = useState<Picture[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const patchFilters = useCallback(
    (patch: Partial<Filters>) => {
      setSearchParams(paramsFromFilters({ ...filters, ...patch }), {
        replace: true,
      });
    },
    [filters, setSearchParams]
  );

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    getFacets()
      .then(setFacets)
      .catch((e) => {
        if (e instanceof UnauthorizedError) auth.onUnauthorized();
      });
  }, [auth]);

  const load = useCallback(
    async (reset: boolean, nextCursor: string | null) => {
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      const id = ++reqId.current;
      try {
        const res = await listPictures({
          sort: filters.sort,
          seed: filters.seed || null,
          mediaTypes: filters.mediaTypes,
          categories: filters.categories,
          tags: filters.tags,
          providers: filters.providers,
          authors: filters.authors,
          q: filters.q || null,
          cursor: reset ? null : nextCursor,
          limit: PAGE_SIZE,
        });
        if (reqId.current !== id) return; // a newer request superseded this one
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.nextCursor);
      } catch (e) {
        if (reqId.current !== id) return;
        if (e instanceof UnauthorizedError) auth.onUnauthorized();
        else setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        if (reqId.current === id) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [auth, filters.sort, filters.seed, filters.mediaTypes, filters.categories, filters.tags, filters.providers, filters.authors, filters.q]
  );

  // Reset + load first page whenever the filters change.
  useEffect(() => {
    setItems([]);
    setCursor(null);
    load(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Load the next page (fired by the masonry's per-column sentinels). A ref
  // guards against the observer firing several times before loadingMore flips,
  // which would append the same page twice.
  const loadingMoreRef = useRef(false);
  const onLoadMore = useCallback(() => {
    if (!cursor || loadingMoreRef.current || loading) return;
    loadingMoreRef.current = true;
    load(false, cursor).finally(() => {
      loadingMoreRef.current = false;
    });
  }, [cursor, loading, load]);

  // Ordered id list handed to each card so the detail modal can page prev/next.
  const navList = items.map((p) => ({ provider: p.provider, id: p.id }));

  return (
    <div className="min-h-screen">
      {/* Sticky header. One row on wide screens (title | filters | actions). On
          mobile the filters collapse behind a toggle so the header stays short. */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          {/* Title doubles as home / clear-all: clicking it resets the filters. */}
          <div className="flex shrink-0 items-baseline gap-2 lg:order-1">
            <button
              onClick={clearFilters}
              title="ホーム / フィルタをクリア"
              aria-label="ホームに戻ってフィルタをクリア"
              className="text-lg font-semibold tracking-tight transition-colors hover:text-muted-foreground"
            >
              garoo
            </button>
            <span className="text-xs text-muted-foreground">
              {!loading && `${items.length}${cursor ? "+" : ""} 件`}
            </span>
          </div>

          {/* Actions: mobile filter toggle (lg:hidden) + theme. */}
          <div className="ml-auto flex shrink-0 items-center gap-1 lg:order-3 lg:ml-0">
            <Button
              variant={filtersOpen ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-label="フィルター"
              aria-expanded={filtersOpen}
              className="relative lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilters > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {activeFilters}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(nextTheme(theme))}
              aria-label={`テーマ: ${theme === "light" ? "ライト" : theme === "dark" ? "ダーク" : "システム"}（クリックで切替）`}
              title={`テーマ: ${theme === "light" ? "ライト" : theme === "dark" ? "ダーク" : "システム"}`}
            >
              {theme === "light" ? (
                <Sun className="h-4 w-4" />
              ) : theme === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Monitor className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Filters: collapsible full-width row on mobile, flexible middle on lg. */}
          <div
            className={cn(
              "w-full min-w-0 lg:order-2 lg:block lg:w-auto lg:flex-1",
              filtersOpen ? "block" : "hidden"
            )}
          >
            <FilterBar filters={filters} facets={facets} onChange={patchFilters} />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-[1800px] px-4 py-4">
        {loading ? (
          <SkeletonGrid />
        ) : error ? (
          <div className="py-24 text-center text-sm text-destructive">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <p className="text-sm">条件に合う投稿がありません</p>
          </div>
        ) : (
          <Masonry
            items={items}
            getKey={(p) => `${p.provider}:${p.id}`}
            onLoadMore={onLoadMore}
          >
            {(p) => <PictureCard picture={p} navList={navList} />}
          </Masonry>
        )}

        {/* Next-page spinner (paging fires from the masonry's column sentinels). */}
        {loadingMore && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </main>
    </div>
  );
}

function SkeletonGrid() {
  const heights = [220, 300, 180, 260, 340, 200, 280, 240, 320, 190, 260, 300];
  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6">
      {heights.map((h, i) => (
        <Skeleton
          key={i}
          className="mb-3 w-full break-inside-avoid rounded-xl"
          style={{ height: h }}
        />
      ))}
    </div>
  );
}
