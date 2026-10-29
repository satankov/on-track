import { RAIL_SECTIONS, type PreferenceInput } from "../domain/preferences.js";
import { isTheme, THEME_STORAGE_KEY } from "./theme.js";
export { RAIL_SECTIONS, type RailSection } from "../domain/preferences.js";
export const SHOW_EXAMPLES_KEY = "on-track-show-examples";
export const COLLAPSED_SECTIONS_KEY = "on-track-collapsed-sections";

/** Read only during the one-time migration. Never write browser preferences. */
export function readLegacyPreferences(): PreferenceInput {
  const result: PreferenceInput = {};
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(theme)) result.theme = theme;
    const examples = localStorage.getItem(SHOW_EXAMPLES_KEY);
    if (examples === "true" || examples === "false")
      result.showExamples = examples === "true";
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
    let sections: unknown;
    try {
      sections = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* Ignore malformed legacy data. */
    }
    if (typeof sections === "object" && sections !== null) {
      for (const key of RAIL_SECTIONS) {
        if (
          Object.hasOwn(sections, key) &&
          typeof (sections as Record<string, unknown>)[key] === "boolean"
        ) {
          result.collapsedSections ??= {};
          result.collapsedSections[key] = (sections as Record<string, boolean>)[
            key
          ];
        }
      }
    }
  } catch {
    /* Browser storage may be blocked; the DB supplies defaults. */
  }
  return result;
}

export function clearLegacyPreferences(): void {
  try {
    for (const key of [
      THEME_STORAGE_KEY,
      SHOW_EXAMPLES_KEY,
      COLLAPSED_SECTIONS_KEY,
    ])
      localStorage.removeItem(key);
  } catch {
    /* DB values remain authoritative if cleanup is blocked. */
  }
}
