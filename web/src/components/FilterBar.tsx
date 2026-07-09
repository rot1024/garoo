import { useEffect, useRef, useState } from "react";
import { Search, Tag, FolderOpen, ArrowDownUp, AtSign, Shapes } from "lucide-react";
import type { Facets, SortMode } from "@/lib/api";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MultiSelectFilter from "@/components/MultiSelectFilter";

export interface Filters {
  q: string;
  sort: SortMode;
  media: "all" | "photo" | "video";
  categories: string[];
  tags: string[];
  providers: string[];
  authors: string[]; // screennames; also settable by clicking an author
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  sort: "newest",
  media: "all",
  categories: [],
  tags: [],
  providers: [],
  authors: [],
};

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "投稿日（新しい順）" },
  { value: "oldest", label: "投稿日（古い順）" },
  { value: "added_desc", label: "登録日（新しい順）" },
  { value: "added_asc", label: "登録日（古い順）" },
];

const MEDIA_OPTIONS: { value: Filters["media"]; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "photo", label: "写真" },
  { value: "video", label: "動画" },
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

      {/* Media type ("種類") — icon + label to match the other filters; shows the
          title when unfiltered (all), the chosen kind otherwise. */}
      <Select
        value={filters.media}
        onValueChange={(v) => onChange({ media: v as Filters["media"] })}
      >
        <SelectTrigger className="w-auto gap-1.5" aria-label="種類">
          <Shapes className="h-3.5 w-3.5" />
          {filters.media === "all"
            ? "種類"
            : MEDIA_OPTIONS.find((o) => o.value === filters.media)?.label}
        </SelectTrigger>
        <SelectContent>
          {MEDIA_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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

      {/* Sort */}
      <Select
        value={filters.sort}
        onValueChange={(v) => onChange({ sort: v as SortMode })}
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
    </div>
  );
}
