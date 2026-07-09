import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface Option {
  value: string;
  label: string;
  count?: number;
  image?: string; // optional leading avatar (e.g. author icon)
}

// Cap how many options render at once. Filtering happens here (not via cmdk's
// built-in filter) so huge lists — e.g. thousands of authors — stay responsive:
// only the matching, capped slice is ever in the DOM.
const RENDER_LIMIT = 300;

// A searchable multi-select backed by a Popover + cmdk list. Used for the
// category / tag / provider / author filters. `selected`/`onChange` are
// controlled by the parent.
export default function MultiSelectFilter({
  label,
  icon,
  options,
  selected,
  onChange,
  searchPlaceholder,
}: {
  label: string;
  icon?: ReactNode;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
}) {
  // `search` is what the input shows; `query` is what we filter by. They differ
  // only mid-IME-composition (`composing`), so kana being converted doesn't
  // filter to "no results" until the word is committed.
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (!composing) setQuery(search);
  }, [search, composing]);

  const set = new Set(selected);
  const toggle = (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  };

  // Selected options first, then those matching the query; capped for the DOM.
  const { shown, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (o: Option) =>
      !q ||
      o.label.toLowerCase().includes(q) ||
      o.value.toLowerCase().includes(q);
    const ranked = [
      ...options.filter((o) => set.has(o.value)),
      ...options.filter((o) => !set.has(o.value) && matches(o)),
    ];
    return { shown: ranked.slice(0, RENDER_LIMIT), hidden: Math.max(0, ranked.length - RENDER_LIMIT) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query, selected.join(",")]);

  return (
    <Popover
      onOpenChange={(o) => {
        if (!o) {
          setSearch("");
          setQuery("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-1.5",
            selected.length > 0 && "border-primary/60 bg-primary/5"
          )}
        >
          {icon}
          {label}
          {selected.length > 0 && (
            <Badge className="ml-0.5 h-5 rounded px-1.5 py-0 text-[11px]">
              {selected.length}
            </Badge>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              // Don't let cmdk act on Enter/arrows used to confirm IME conversion.
              if (e.nativeEvent.isComposing) e.stopPropagation();
            }}
            placeholder={searchPlaceholder ?? `${label}を検索`}
          />
          <CommandList>
            <CommandEmpty>見つかりません</CommandEmpty>
            <CommandGroup>
              {shown.map((o) => {
                const active = set.has(o.value);
                return (
                  <CommandItem
                    key={o.value || "__empty__"}
                    value={`${o.label} ${o.value}`}
                    onSelect={() => toggle(o.value)}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input"
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    {o.image && (
                      <img
                        src={o.image}
                        alt=""
                        loading="lazy"
                        className="h-5 w-5 shrink-0 rounded-full object-cover"
                      />
                    )}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.count != null && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {o.count}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {hidden > 0 && (
              <div className="px-2 py-1.5 text-center text-xs text-muted-foreground">
                他 {hidden} 件 — 検索で絞り込んでください
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
