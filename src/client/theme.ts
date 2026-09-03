export const THEMES = ["light", "neutral", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "on-track-theme";

export const THEME_COLORS: Record<Theme, string> = {
  light: "#f3f5f7",
  neutral: "#30343a",
  dark: "#111417",
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.includes(value as Theme);
}

export function readStoredTheme(storage?: Storage): Theme {
  try {
    const stored = (storage ?? globalThis.localStorage).getItem(
      THEME_STORAGE_KEY,
    );
    return isTheme(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme, target: Document = document): void {
  target.documentElement.dataset.theme = theme;
  target.documentElement.style.colorScheme =
    theme === "light" ? "light" : "dark";
  target
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

export function persistTheme(theme: Theme, storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage).setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Appearance remains active for this page when browser storage is blocked.
  }
}
