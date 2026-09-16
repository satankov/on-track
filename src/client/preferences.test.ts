// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
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
