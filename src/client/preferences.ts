export const SHOW_EXAMPLES_KEY = "on-track-show-examples";
export function readShowExamples(): boolean {
  try {
    return localStorage.getItem(SHOW_EXAMPLES_KEY) !== "false";
  } catch {
    return true;
  }
}
export function persistShowExamples(value: boolean): boolean {
  try {
    localStorage.setItem(SHOW_EXAMPLES_KEY, String(value));
    return true;
  } catch {
    return false;
  }
}

export const RAIL_SECTIONS = [
  "Pinned",
  "Projects",
  "Archive",
  "Examples",
] as const;
export type RailSection = (typeof RAIL_SECTIONS)[number];
export const COLLAPSED_SECTIONS_KEY = "on-track-collapsed-sections";
export function readCollapsedSections(): Record<RailSection, boolean> {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) ?? "null");
  } catch {
    // Missing, malformed, or blocked storage defaults to expanded sections.
  }
  return Object.fromEntries(
    RAIL_SECTIONS.map((section) => [
      section,
      typeof stored === "object" &&
        stored !== null &&
        Object.hasOwn(stored, section) &&
        (stored as Record<string, unknown>)[section] === true,
    ]),
  ) as Record<RailSection, boolean>;
}
export function persistCollapsedSections(
  value: Record<RailSection, boolean>,
): void {
  try {
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(value));
  } catch {
    // Disclosures remain usable for this page when storage is blocked.
  }
}
