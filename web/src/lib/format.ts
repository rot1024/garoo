// D1 stores created_at as "YYYY-MM-DD HH:MM:SS" in UTC (no zone). Parse it as
// UTC explicitly, then render in the viewer's locale.

export function parseDate(createdAt: string): Date | null {
  if (!createdAt) return null;
  const d = new Date(createdAt.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
}

// Human labels for provider ids stored in D1 (e.g. "twitter" shows as "X").
const PROVIDER_LABELS: Record<string, string> = {
  twitter: "X",
  x: "X",
  pixiv: "pixiv",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider.toLowerCase()] ?? provider;
}

// Twitter appends a t.co short link (to the media/quote) to the body text.
// Strip those for display, then tidy the whitespace they leave behind.
export function stripTcoLinks(text: string): string {
  return text
    .replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Deterministic hue (0-359) from a string, for the solid-colour fallback tile
// used by media-less (text) posts.
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function formatDate(createdAt: string): string {
  const d = parseDate(createdAt);
  if (!d) return createdAt;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
