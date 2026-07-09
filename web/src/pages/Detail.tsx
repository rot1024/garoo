import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  type Location,
} from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Check,
  X,
  Plus,
  Save,
  SquareArrowOutUpRight,
} from "lucide-react";
import { AuthContext } from "@/App";
import {
  getFacets,
  getPicture,
  mediaUrl,
  updatePicture,
  UnauthorizedError,
  type Facets,
  type Picture,
} from "@/lib/api";
import { formatDate, providerLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface NavItem {
  provider: string;
  id: string;
}

const UNSAVED_MESSAGE = "未保存の変更があります。破棄してよろしいですか？";

// Directional slide for paging between posts (direction: 1 = next, -1 = prev).
const slideVariants = {
  enter: (d: number) => ({ x: d >= 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d >= 0 ? -40 : 40, opacity: 0 }),
};

/**
 * Post detail. Rendered as a modal over the still-mounted gallery (modal=true,
 * via a backgroundLocation) so home keeps its scroll and filters, or as a
 * standalone page on a direct deep-link. ESC and the ‹ ›/arrow keys move between
 * posts using the ordered list handed over in navigation state. When the edit
 * form has unsaved changes, closing or paging away asks for confirmation first.
 */
export default function Detail({ modal = false }: { modal?: boolean }) {
  const { provider = "", id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useContext(AuthContext);

  const state = (location.state ?? null) as {
    backgroundLocation?: Location;
    list?: NavItem[];
  } | null;
  const background = state?.backgroundLocation;
  const list = state?.list ?? [];

  const idx = list.findIndex((x) => x.provider === provider && x.id === id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  const [picture, setPicture] = useState<Picture | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(true); // drives the Dialog's close animation
  const [direction, setDirection] = useState(1); // 1 = next, -1 = prev (slide dir)

  // Tracked via a ref so the confirm-guard reads the latest value without
  // re-creating the close/goto callbacks (and their keydown listener) each edit.
  const unsavedRef = useRef(false);
  const confirmDiscard = useCallback(
    () => !unsavedRef.current || window.confirm(UNSAVED_MESSAGE),
    []
  );

  const navigateAway = useCallback(() => {
    if (background) navigate(background.pathname + background.search);
    else navigate("/");
  }, [background, navigate]);

  // Modal close: flip `open` so the Dialog plays its exit animation, then leave
  // the route once it has finished. Full-page just navigates.
  const requestClose = useCallback(() => {
    if (!confirmDiscard()) return;
    if (modal) {
      setOpen(false);
      window.setTimeout(navigateAway, 200);
    } else {
      navigateAway();
    }
  }, [confirmDiscard, modal, navigateAway]);

  const goto = useCallback(
    (item: NavItem | null, dir: number) => {
      if (!item || !confirmDiscard()) return;
      setDirection(dir);
      navigate(`/p/${encodeURIComponent(item.provider)}/${encodeURIComponent(item.id)}`, {
        replace: true,
        state: { backgroundLocation: background, list },
      });
    },
    [navigate, background, list, confirmDiscard]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setActive(0);
    unsavedRef.current = false;
    getPicture(provider, id)
      .then((p) => alive && setPicture(p))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof UnauthorizedError) auth.onUnauthorized();
        else setError(e instanceof Error ? e.message : "読み込めませんでした");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [provider, id, auth]);

  useEffect(() => {
    getFacets()
      .then(setFacets)
      .catch(() => {});
  }, []);

  // Keyboard: ←/→ switch posts, Esc closes (Esc only here for the full-page
  // variant — the modal's Dialog handles Esc via onOpenChange). Ignore arrows
  // while an input is focused so text editing still works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (typing) return;
      if (e.key === "ArrowLeft") goto(prev, -1);
      else if (e.key === "ArrowRight") goto(next, 1);
      else if (e.key === "Escape" && !modal) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goto, prev, next, requestClose, modal]);

  const arrows = open && !loading && !error && (
    <ModalArrows
      prev={!!prev}
      next={!!next}
      onPrev={() => goto(prev, -1)}
      onNext={() => goto(next, 1)}
    />
  );

  const body = (
    <Body
      loading={loading}
      error={error}
      picture={picture}
      facets={facets}
      active={active}
      setActive={setActive}
      direction={direction}
      onClose={requestClose}
      onSaved={setPicture}
      onDirtyChange={(d) => (unsavedRef.current = d)}
      onUnauthorized={auth.onUnauthorized}
    />
  );

  if (modal) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
        {arrows}
        <DialogContent
          hideClose
          onInteractOutside={(e) => {
            // Clicking a side arrow (portaled outside the card) must page, not close.
            if ((e.target as HTMLElement).closest("[data-modal-arrow]"))
              e.preventDefault();
          }}
          className="!flex !flex-col h-[92vh] w-[90vw] max-w-[1320px] gap-0 overflow-hidden p-0"
        >
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {arrows}
      {body}
    </div>
  );
}

/** Prev/next arrows pinned to the viewport edges, outside the modal card. */
function ModalArrows({
  prev,
  next,
  onPrev,
  onNext,
}: {
  prev: boolean;
  next: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Portaled to <body>: Radix marks the body pointer-events:none while a modal
  // Dialog is open, so the buttons re-enable pointer events explicitly.
  return createPortal(
    <div className="pointer-events-none fixed inset-y-0 left-0 right-0 z-[60] flex items-center justify-between px-2">
      {prev ? (
        <ArrowButton side="left" onClick={onPrev} label="前の投稿" />
      ) : (
        <span />
      )}
      {next ? (
        <ArrowButton side="right" onClick={onNext} label="次の投稿" />
      ) : (
        <span />
      )}
    </div>,
    document.body
  );
}

function ArrowButton({
  side,
  onClick,
  label,
}: {
  side: "left" | "right";
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      data-modal-arrow
      onClick={onClick}
      aria-label={label}
      className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur transition-colors hover:bg-black/80"
    >
      {side === "left" ? (
        <ChevronLeft className="h-6 w-6" />
      ) : (
        <ChevronRight className="h-6 w-6" />
      )}
    </button>
  );
}

function Body({
  loading,
  error,
  picture,
  facets,
  active,
  setActive,
  direction,
  onClose,
  onSaved,
  onDirtyChange,
  onUnauthorized,
}: {
  loading: boolean;
  error: string | null;
  picture: Picture | null;
  facets: Facets | null;
  active: number;
  setActive: (n: number) => void;
  direction: number;
  onClose: () => void;
  onSaved: (p: Picture) => void;
  onDirtyChange: (dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  // Only show the spinner on the very first load; while paging we keep the
  // previous post visible so the slide transition isn't broken by a spinner.
  if (loading && !picture) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !picture) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error ?? "not found"}</p>
        <Button variant="outline" onClick={onClose}>
          ギャラリーへ
        </Button>
      </div>
    );
  }

  const media = picture.media;
  const current = media[active];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      {/* Close */}
      <button
        onClick={onClose}
        aria-label="閉じる"
        className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Media area — solid letterbox (black in dark, white in light), never grey.
          Paging between posts slides the media in the travel direction. */}
      <div className="relative flex h-[50vh] w-full shrink-0 items-center justify-center overflow-hidden bg-white dark:bg-black lg:h-full lg:w-auto lg:flex-1">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          {current ? (
            current.type === "video" ? (
              <motion.video
                key={current.key}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.2, ease: "easeInOut" }}
                src={mediaUrl(current.key)}
                controls
                playsInline
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <motion.img
                key={current.key}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.2, ease: "easeInOut" }}
                src={mediaUrl(current.key)}
                alt={picture.description || picture.screenName}
                className="max-h-full max-w-full object-contain"
              />
            )
          ) : (
            <div className="p-24 text-sm text-muted-foreground">no media</div>
          )}
        </AnimatePresence>

        {media.length > 1 && (
          <>
            <div className="absolute bottom-2 left-1/2 flex max-w-[90%] -translate-x-1/2 gap-1.5 overflow-x-auto rounded-lg bg-black/50 p-1.5 no-scrollbar">
              {media.map((m, i) => (
                <button
                  key={m.key}
                  onClick={() => setActive(i)}
                  className={cn(
                    "h-12 w-12 shrink-0 overflow-hidden rounded border-2 transition",
                    i === active
                      ? "border-white"
                      : "border-transparent opacity-60 hover:opacity-100"
                  )}
                >
                  {m.type === "video" ? (
                    <video src={mediaUrl(m.key)} muted preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <img src={mediaUrl(m.key)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </button>
              ))}
            </div>
            <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
              {active + 1} / {media.length}
            </div>
          </>
        )}
      </div>

      {/* Sidebar: scrollable info on top, edit form pinned to the bottom so its
          position doesn't shift with the post's body length. */}
      <aside className="flex w-full shrink-0 flex-col border-t lg:w-[380px] lg:border-l lg:border-t-0">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div className="flex items-center gap-3 pr-10">
            <Avatar src={picture.avatar} className="h-11 w-11" />
            <div className="min-w-0">
              {picture.userName && (
                <div className="truncate font-medium">{picture.userName}</div>
              )}
              <Link
                to={`/?author=${encodeURIComponent(picture.screenName)}`}
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                @{picture.screenName}
              </Link>
            </div>
          </div>

          {/* Date links to the original post; the media "open in new tab" link
              sits at the right of this row (kept off the image itself). */}
          <div className="flex items-center gap-2 text-sm">
            {picture.url ? (
              <a
                href={picture.url}
                target="_blank"
                rel="noreferrer"
                title="元の投稿を開く"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
              >
                {formatDate(picture.createdAt)}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span className="text-muted-foreground">
                {formatDate(picture.createdAt)}
              </span>
            )}
            <Badge variant="secondary" className="shrink-0">
              {providerLabel(picture.provider)}
            </Badge>
            {current && (
              <a
                href={mediaUrl(current.key)}
                target="_blank"
                rel="noreferrer"
                title="画像を新しいタブで開く"
                className="ml-auto inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                画像
              </a>
            )}
          </div>

          {picture.description && (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {picture.description}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t p-4">
          <EditPanel
            picture={picture}
            categories={facets?.categories.map((c) => c.category) ?? []}
            onSaved={onSaved}
            onDirtyChange={onDirtyChange}
            onUnauthorized={onUnauthorized}
          />
        </div>
      </aside>
    </div>
  );
}

// Category + tag editor. Category is a free-text field with existing categories
// as suggestions (native datalist); tags are add/remove chips. Saving PATCHes
// the post — a category change moves its R2 media server-side and the returned
// picture carries the new media keys. Reports its dirty state upward so the
// modal can confirm before discarding unsaved edits.
function EditPanel({
  picture,
  categories,
  onSaved,
  onDirtyChange,
  onUnauthorized,
}: {
  picture: Picture;
  categories: string[];
  onSaved: (p: Picture) => void;
  onDirtyChange: (dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  const [category, setCategory] = useState(picture.category);
  const [tags, setTags] = useState<string[]>(picture.tags);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setCategory(picture.category);
    setTags(picture.tags);
  }, [picture]);

  const suggestions = useMemo(
    () => [...new Set(categories.filter(Boolean))].sort(),
    [categories]
  );

  const dirty =
    category !== picture.category ||
    tags.length !== picture.tags.length ||
    tags.some((t, i) => t !== picture.tags[i]);

  // Keep the parent's unsaved-guard in sync; clear it when this panel unmounts.
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const addTag = useCallback((raw: string) => {
    const t = raw.trim();
    if (!t) return;
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput("");
  }, []);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const updated = await updatePicture(picture.provider, picture.id, {
        category,
        tags,
      });
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      if (e instanceof UnauthorizedError) onUnauthorized();
      else setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">カテゴリ</label>
        <Input
          list="category-suggestions"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="(未分類)"
          className="h-8"
        />
        <datalist id="category-suggestions">
          {suggestions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">タグ</label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1 pr-1">
                {t}
                <button
                  onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                  className="rounded-full p-0.5 hover:bg-background/60"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
            placeholder="タグを追加してEnter"
            className="h-8"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => addTag(tagInput)}
            disabled={!tagInput.trim()}
            className="h-8 w-8 shrink-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {err && <p className="text-xs text-destructive">{err}</p>}

      {/* Small, low-emphasis save — only actionable when there are edits. */}
      <div className="flex items-center justify-end gap-2">
        {dirty && !saving && (
          <span className="text-xs text-muted-foreground">未保存</span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={save}
          disabled={!dirty || saving}
          className="h-7 gap-1 px-2.5 text-xs"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saved ? "保存しました" : "保存"}
        </Button>
      </div>
    </div>
  );
}
