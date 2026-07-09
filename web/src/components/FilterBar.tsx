import { useEffect, useRef, useState } from "react";
import { Search, Tag, FolderOpen, ArrowDownUp, AtSign, Shapes, Shuffle } from "lucide-react";
import type { Facets, SortMode } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MultiSelectFilter from "@/components/MultiSelectFilter";

export type MediaType = "image" | "video" | "none";
export const DEFAULT_MEDIA_TYPES: MediaType[] = ["image", "video"];

export interface Filters {
  q: string;
  sort: SortMode;
  mediaTypes: MediaType[]; // which kinds to show (default: image + video)
  categories: string[];
  tags: string[];
  providers: string[];
  authors: string[]; // screennames; also settable by clicking an author
  seed: string; // shuffle seed; only meaningful when sort === "random"
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  sort: "newest",
  mediaTypes: [...DEFAULT_MEDIA_TYPES],
  categories: [],
  tags: [],
  providers: [],
  authors: [],
  seed: "",
};

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "投稿日（新しい順）" },
  { value: "oldest", label: "投稿日（古い順）" },
  { value: "added_desc", label: "登録日（新しい順）" },
  { value: "added_asc", label: "登録日（古い順）" },
  { value: "random", label: "ランダム" },
];

/** A fresh positive shuffle seed (kept in the URL so paging stays consistent). */
function newSeed(): string {
  return String(Math.floor(Math.random() * 2147483647) + 1);
}

const MEDIA_OPTIONS: { value: MediaType; label: string }[] = [
  { value: "image", label: "画像" },
  { value: "video", label: "動画" },
  { value: "none", label: "メディアなし" },
];

export default function FilterBar({
  filters,
  facets,
  onChange,
}: {
  filters: Filters;
  facets: Facets | null;
  onChange: (patch: Partial<Filters>) => void;
}) {
  // Debounce the search box, and don't fire mid-IME-composition: `composing`
  // gates the effect, so a query only runs once (after compositionend) rather
  // than on every intermediate kana/conversion keystroke.
  const [qLocal, setQLocal] = useState(filters.q);
  const [composing, setComposing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setQLocal(filters.q), [filters.q]);
  useEffect(() => {
    if (composing) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (qLocal !== filters.q) onChange({ q: qLocal });
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal, composing]);

  const catOptions =
    facets?.categories.map((c) => ({
      value: c.category,
      label: c.category || "(未分類)",
      count: c.n,
    })) ?? [];
  const tagOptions =
    facets?.tags.map((t) => ({ value: t.tag, label: t.tag, count: t.n })) ?? [];
  const authorOptions =
    facets?.authors.map((a) => ({
      value: a.screenName,
      // Label carries both name and @handle so the checklist search matches either.
      label: a.userName ? `${a.userName} @${a.screenName}` : `@${a.screenName}`,
      count: a.n,
      image: a.avatar, // always defined for authors -> Avatar shows a grey fallback if empty
    })) ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative min-w-[180px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setComposing(false);
            setQLocal((e.target as HTMLInputElement).value);
          }}
          placeholder="本文・作者を検索…"
          className="pl-8"
        />
      </div>

      {/* Media type ("種類") — a checklist like the others (画像 / 動画 / メディアなし).
          Default shows 画像 + 動画; check メディアなし to include text posts. */}
      <MultiSelectFilter
        label="種類"
        icon={<Shapes className="h-3.5 w-3.5" />}
        options={MEDIA_OPTIONS}
        selected={filters.mediaTypes}
        onChange={(v) => onChange({ mediaTypes: v as MediaType[] })}
      />

      {/* Category / tag / provider checklists — toggled here, no separate chips */}
      <MultiSelectFilter
        label="カテゴリ"
        icon={<FolderOpen className="h-3.5 w-3.5" />}
        options={catOptions}
        selected={filters.categories}
        onChange={(categories) => onChange({ categories })}
      />
      <MultiSelectFilter
        label="タグ"
        icon={<Tag className="h-3.5 w-3.5" />}
        options={tagOptions}
        selected={filters.tags}
        onChange={(tags) => onChange({ tags })}
      />
      <MultiSelectFilter
        label="作者"
        icon={<AtSign className="h-3.5 w-3.5" />}
        options={authorOptions}
        selected={filters.authors}
        onChange={(authors) => onChange({ authors })}
        searchPlaceholder="名前・@IDで検索"
      />

      {/* Sort — picking ランダム mints a seed so paging stays consistent. */}
      <Select
        value={filters.sort}
        onValueChange={(v) =>
          v === "random"
            ? onChange({ sort: "random", seed: filters.seed || newSeed() })
            : onChange({ sort: v as SortMode })
        }
      >
        <SelectTrigger className="w-auto gap-1.5">
          <ArrowDownUp className="h-3.5 w-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Shuffle: switch to random and re-roll the seed to dig up new finds. */}
      <Button
        variant={filters.sort === "random" ? "secondary" : "outline"}
        size="icon"
        onClick={() => onChange({ sort: "random", seed: newSeed() })}
        aria-label="シャッフル"
        title="シャッフル（ランダムに並べ替え）"
      >
        <Shuffle className="h-4 w-4" />
      </Button>
    </div>
  );
}
