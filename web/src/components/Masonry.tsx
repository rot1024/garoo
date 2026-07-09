import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { ReactNode } from "react";

// Responsive column count, matching the Tailwind breakpoints we used before
// (2 / sm:3 / lg:4 / xl:5 / 2xl:6). Viewport-based, like Tailwind's own.
function columnsForWidth(w: number): number {
  if (w >= 1536) return 6;
  if (w >= 1280) return 5;
  if (w >= 1024) return 4;
  if (w >= 640) return 3;
  return 2;
}

function useColumnCount(): number {
  const [cols, setCols] = useState(() =>
    typeof window === "undefined" ? 4 : columnsForWidth(window.innerWidth)
  );
  useEffect(() => {
    const onResize = () => setCols(columnsForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

// Pinterest-style masonry with variable item heights AND row-major reading
// order: item i goes to column (i % columnCount), so newest-first items read
// left-to-right, top-to-bottom (A B / C D / E F) rather than column-by-column.
// CSS `columns` can't do this — it fills each column top-to-bottom first — so we
// distribute into flex columns ourselves. Filtering/sorting animates: entering
// cards fade+scale in, leaving cards fade out, persisting cards ease to place.
//
// Infinite scroll: a sentinel sits at the BOTTOM OF EACH COLUMN, so paging fires
// as soon as the *shortest* column runs out — not only when the tallest one does
// (a single bottom-of-container sentinel would leave the short columns empty and
// require scrolling further to trigger).
export default function Masonry<T>({
  items,
  getKey,
  children,
  onLoadMore,
}: {
  items: T[];
  getKey: (item: T) => string;
  children: (item: T) => ReactNode;
  onLoadMore?: () => void;
}) {
  const cols = useColumnCount();
  const columns: T[][] = Array.from({ length: cols }, () => []);
  items.forEach((item, i) => columns[i % cols].push(item));

  const sentinels = useRef<(HTMLDivElement | null)[]>([]);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMoreRef.current?.();
      },
      { rootMargin: "800px" }
    );
    for (const el of sentinels.current) if (el) io.observe(el);
    return () => io.disconnect();
    // Re-observe when the item count or column count changes (sentinels move).
  }, [items.length, cols]);

  return (
    <LayoutGroup>
      <div className="flex items-start gap-3">
        {columns.map((col, ci) => (
          <div key={ci} className="flex min-w-0 flex-1 flex-col gap-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {col.map((item, i) => (
                <motion.div
                  key={getKey(item)}
                  layout="position"
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94 }}
                  transition={{
                    duration: 0.32,
                    ease: [0.22, 0.61, 0.36, 1],
                    delay: Math.min(i, 14) * 0.012,
                    // Position (layout) shifts — e.g. a tile below one that just
                    // grew after its image loaded — slide with no per-index delay.
                    layout: { duration: 0.3, ease: [0.22, 0.61, 0.36, 1] },
                  }}
                >
                  {children(item)}
                </motion.div>
              ))}
            </AnimatePresence>
            {/* Per-column paging sentinel. */}
            <div
              aria-hidden
              className="h-px w-full"
              ref={(el) => {
                sentinels.current[ci] = el;
              }}
            />
          </div>
        ))}
      </div>
    </LayoutGroup>
  );
}
