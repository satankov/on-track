// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  readLegacyPreferences,
  clearLegacyPreferences,
  COLLAPSED_SECTIONS_KEY,
  SHOW_EXAMPLES_KEY,
} from "./preferences.js";
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it("imports only present, valid legacy values and preserves unrelated storage", () => {
  expect(readLegacyPreferences()).toEqual({});
  localStorage.setItem("on-track-theme", "dark");
  localStorage.setItem(SHOW_EXAMPLES_KEY, "false");
  localStorage.setItem(
    COLLAPSED_SECTIONS_KEY,
    '{"Pinned":true,"Projects":"true","Examples":false}',
  );
  localStorage.setItem("unrelated", "keep");
  expect(readLegacyPreferences()).toEqual({
    theme: "dark",
    showExamples: false,
    collapsedSections: { Pinned: true, Examples: false },
  });
  clearLegacyPreferences();
  expect(readLegacyPreferences()).toEqual({});
  expect(localStorage.getItem("unrelated")).toBe("keep");
});
it.each(["bad json", "null", "42", "[]"])(
  "ignores invalid legacy data: %s",
  (value) => {
    localStorage.setItem("on-track-theme", "invalid");
    localStorage.setItem(SHOW_EXAMPLES_KEY, "invalid");
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, value);
    expect(readLegacyPreferences()).toEqual({});
  },
);
it("tolerates blocked reads and cleanup without writing browser settings", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const write = vi.spyOn(Storage.prototype, "setItem");
  expect(readLegacyPreferences()).toEqual({});
  expect(clearLegacyPreferences).not.toThrow();
  expect(write).not.toHaveBeenCalled();
});
