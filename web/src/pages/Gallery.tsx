import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Moon, Sun, LogOut, ImageOff } from "lucide-react";
import { AuthContext } from "@/App";
import {
  getFacets,
  listPictures,
  UnauthorizedError,
  type Facets,
  type Picture,
} from "@/lib/api";
import { applyTheme, getInitialTheme, type Theme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Masonry from "@/components/Masonry";
import PictureCard from "@/components/PictureCard";
import FilterBar, { type Filters } from "@/components/FilterBar";

const PAGE_SIZE = 40;

const SORT_VALUES = ["newest", "oldest", "added_desc", "added_asc"] as const;

function filtersFromParams(sp: URLSearchParams): Filters {
  const sort = sp.get("sort") ?? "newest";
  return {
    q: sp.get("q") ?? "",
    sort: (SORT_VALUES as readonly string[]).includes(sort)
      ? (sort as Filters["sort"])
      : "newest",
    media:
      sp.get("media") === "photo" || sp.get("media") === "video"
        ? (sp.get("media") as Filters["media"])
        : "all",
    categories: sp.getAll("category"),
    tags: sp.getAll("tag"),
    providers: sp.getAll("provider"),
    author: sp.get("author") ?? "",
  };
}

function paramsFromFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.sort !== "newest") sp.set("sort", f.sort);
  if (f.media !== "all") sp.set("media", f.media);
  for (const c of f.categories) sp.append("category", c);
  for (const t of f.tags) sp.append("tag", t);
  for (const p of f.providers) sp.append("provider", p);
  if (f.author) sp.set("author", f.author);
  return sp;
}

export default function Gallery() {
  const auth = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromParams(searchParams);
  // Serialize filters to a stable key so the fetch effect reruns on any change.
  const filterKey = paramsFromFilters(filters).toString();

  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  useEffect(() => applyTheme(theme), [theme]);

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
          media: filters.media,
          categories: filters.categories,
          tags: filters.tags,
          providers: filters.providers,
          author: filters.author || null,
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
    [auth, filters.sort, filters.media, filters.categories, filters.tags, filters.providers, filters.author, filters.q]
  );

  // Reset + load first page whenever the filters change.
  useEffect(() => {
    setItems([]);
    setCursor(null);
    load(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Infinite scroll sentinel.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor && !loadingMore && !loading) {
          load(false, cursor);
        }
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadingMore, loading, load]);

  // Ordered id list handed to each card so the detail modal can page prev/next.
  const navList = items.map((p) => ({ provider: p.provider, id: p.id }));

  return (
    <div className="min-h-screen">
      {/* Sticky header. One row on wide screens (title | filters | actions);
          wraps to two rows below `lg` (title+actions, then filters). */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          {/* Title + count */}
          <div className="flex shrink-0 items-baseline gap-2 lg:order-1">
            <h1 className="text-lg font-semibold tracking-tight">
              garoo<span className="text-muted-foreground"> / gallery</span>
            </h1>
            <span className="text-xs text-muted-foreground">
              {!loading && `${items.length}${cursor ? "+" : ""} 件`}
            </span>
          </div>

          {/* Actions: on the first row's right below lg; trailing on lg */}
          <div className="ml-auto flex shrink-0 items-center gap-1 lg:order-3 lg:ml-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="テーマ切替"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={auth.signOut}
              aria-label="サインアウト"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          {/* Filters: full-width second row below lg; flexible middle on lg */}
          <div className="w-full min-w-0 lg:order-2 lg:w-auto lg:flex-1">
            <FilterBar
              filters={filters}
              facets={facets}
              onChange={patchFilters}
              onClear={clearFilters}
            />
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
          <Masonry items={items} getKey={(p) => `${p.provider}:${p.id}`}>
            {(p) => <PictureCard picture={p} navList={navList} />}
          </Masonry>
        )}

        {/* Infinite-scroll trigger + spinner */}
        <div ref={sentinel} className="h-10" />
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
