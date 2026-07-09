import { Check, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
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
}

// A searchable multi-select backed by a Popover + cmdk list. Used for the
// category and tag filters. `selected`/`onChange` are controlled by the parent.
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
  const set = new Set(selected);
  const toggle = (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  };

  return (
    <Popover>
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
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? `${label}を検索`} />
          <CommandList>
            <CommandEmpty>見つかりません</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
