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
