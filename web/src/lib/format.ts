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
