import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Round avatar with a simple light-grey fallback: shown when there's no src or
 * the image fails to load (external avatar URLs can 404). Size via className
 * (e.g. "h-6 w-6"). The failed state resets when src changes so paging between
 * posts re-attempts the new avatar.
 */
export function Avatar({
  src,
  alt = "",
  className,
}: {
  src?: string;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <div className={cn("shrink-0 overflow-hidden rounded-full bg-muted", className)}>
      {src && !failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
