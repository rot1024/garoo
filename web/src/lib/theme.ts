// Minimal theme handling: dark by default (galleries look better dark), stored
// in localStorage, toggled by adding/removing the `dark` class on <html>.

const KEY = "garoo.theme";
export type Theme = "light" | "dark";

export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}
