import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Play, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { mediaUrl, type Picture } from "@/lib/api";
import { hueFromString, stripTcoLinks } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";

// A single masonry tile: the post's first media, with a hover overlay showing
// author + category. Videos render a muted <video> (first frame as poster) with
// a play badge; multi-media posts get a count badge. Media-less (text) posts get
// a solid-colour fallback tile showing the body text. `navList` is the ordered
// list of the currently shown posts, passed through navigation state so the
// detail modal can page prev/next; the current location becomes the modal's
// background so the gallery stays mounted behind it.
export default function PictureCard({
  picture,
  navList,
}: {
  picture: Picture;
  navList: { provider: string; id: string }[];
}) {
  const location = useLocation();
  const [loaded, setLoaded] = useState(false);
  const first = picture.media[0];
  const isVideo = first?.type === "video";
  const linkProps = {
    to: `/p/${encodeURIComponent(picture.provider)}/${encodeURIComponent(picture.id)}`,
    state: { backgroundLocation: location, list: navList },
  };

  // Media-less post → solid-colour text tile (deterministic tint from the id).
  if (!first) {
    const text = stripTcoLinks(picture.description);
    return (
      <Link
        {...linkProps}
        style={{ backgroundColor: `hsl(${hueFromString(picture.id)} 45% 50% / 0.16)` }}
        className="group relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-xl border p-3 shadow-sm transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="line-clamp-6 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
          {text || "(テキスト投稿)"}
        </p>
        <div className="flex items-center gap-2 pt-2">
          <Avatar src={picture.avatar} className="h-5 w-5" />
          <span className="truncate text-xs text-muted-foreground">
            @{picture.screenName}
          </span>
          {picture.category && picture.category !== "_" && (
            <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
              {picture.category}
            </Badge>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      {...linkProps}
      className="group relative block overflow-hidden rounded-xl border bg-muted/40 shadow-sm ring-0 transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {first ? (
        isVideo ? (
          <video
            src={mediaUrl(first.key)}
            muted
            playsInline
            preload="metadata"
            onLoadedData={() => setLoaded(true)}
            className={cn(
              "w-full transition-opacity duration-500",
              loaded ? "opacity-100" : "opacity-0"
            )}
          />
        ) : (
          <img
            src={mediaUrl(first.key)}
            alt={picture.description || picture.screenName}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={cn(
              "w-full transition-opacity duration-500",
              loaded ? "opacity-100" : "opacity-0"
            )}
          />
        )
      ) : (
        <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
          no media
        </div>
      )}

      {/* Top-right badges: video play / multi-count */}
      <div className="pointer-events-none absolute right-2 top-2 flex gap-1">
        {isVideo && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur">
            <Play className="h-3.5 w-3.5 fill-current" />
          </span>
        )}
        {picture.count > 1 && (
          <span className="flex h-6 items-center gap-1 rounded-full bg-black/60 px-2 text-xs font-medium text-white backdrop-blur">
            <Layers className="h-3 w-3" />
            {picture.count}
          </span>
        )}
      </div>

      {/* Hover overlay */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
        <div className="flex items-center gap-2">
          <Avatar src={picture.avatar} className="h-6 w-6" />
          <span className="truncate text-sm font-medium text-white">
            @{picture.screenName}
          </span>
        </div>
        {picture.category && (
          <Badge
            variant="secondary"
            className="mt-2 bg-white/15 text-white hover:bg-white/20"
          >
            {picture.category}
          </Badge>
        )}
      </div>
    </Link>
  );
}
