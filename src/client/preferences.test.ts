// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  readCollapsedSections,
  persistCollapsedSections,
  COLLAPSED_SECTIONS_KEY,
  readShowExamples,
  persistShowExamples,
  SHOW_EXAMPLES_KEY,
} from "./preferences.js";
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it("defaults on and persists a validated visibility preference", () => {
  expect(readShowExamples()).toBe(true);
  localStorage.setItem(SHOW_EXAMPLES_KEY, "invalid");
  expect(readShowExamples()).toBe(true);
  expect(persistShowExamples(false)).toBe(true);
  expect(readShowExamples()).toBe(false);
  expect(persistShowExamples(true)).toBe(true);
  expect(readShowExamples()).toBe(true);
});
it("remains usable when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readShowExamples()).toBe(true);
  expect(persistShowExamples(false)).toBe(false);
});

it("validates stored section flags and round-trips independent choices", () => {
  expect(readCollapsedSections()).toEqual({
    Pinned: false,
    Projects: false,
    Archive: false,
    Examples: false,
  });
  localStorage.setItem(
    COLLAPSED_SECTIONS_KEY,
    '{"Pinned":true,"Projects":"true","Archive":1,"Examples":false}',
  );
  expect(readCollapsedSections()).toEqual({
    Pinned: true,
    Projects: false,
    Archive: false,
    Examples: false,
  });
  const choices = {
    Pinned: true,
    Projects: false,
    Archive: true,
    Examples: true,
  };
  persistCollapsedSections(choices);
  expect(readCollapsedSections()).toEqual(choices);
});
it.each(["bad json", "null", "42", "[]"])(
  "defaults disclosures safely for %s",
  (value) => {
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, value);
    expect(Object.values(readCollapsedSections())).toEqual([
      false,
      false,
      false,
      false,
    ]);
  },
);
it("keeps disclosures usable with blocked storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const defaults = readCollapsedSections();
  expect(Object.values(defaults)).toEqual([false, false, false, false]);
  expect(() => persistCollapsedSections(defaults)).not.toThrow();
});
