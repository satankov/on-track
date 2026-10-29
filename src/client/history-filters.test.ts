import { expect, it } from "vitest";
import {
  additiveModifier,
  filterKey,
  isApplePlatform,
  selectFilter,
} from "./history-filters.js";
it("uses canonical combination keys and clears All independently of modifiers", () => {
  expect(filterKey(["links", "label:pin"])).toBe(
    filterKey(["label:pin", "links", "links"]),
  );
  expect(selectFilter(["links"], "label:pin")).toEqual(["label:pin"]);
  expect(selectFilter(["links"], "label:pin", true)).toEqual([
    "links",
    "label:pin",
  ]);
  expect(selectFilter(["links"], "links", true)).toEqual([]);
  expect(selectFilter(["links"], "all", true)).toEqual([]);
  expect(filterKey([])).toBe("all");
});
it.each(["MacIntel", "iPad", "iPhone"])("uses Command on %s", (platform) => {
  const apple = isApplePlatform(platform);
  expect(additiveModifier({ metaKey: true, ctrlKey: false }, apple)).toBe(true);
  expect(additiveModifier({ metaKey: false, ctrlKey: true }, apple)).toBe(
    false,
  );
});
it.each(["Win32", "Linux x86_64"])("uses Control on %s", (platform) => {
  const apple = isApplePlatform(platform);
  expect(additiveModifier({ metaKey: false, ctrlKey: true }, apple)).toBe(true);
  expect(additiveModifier({ metaKey: true, ctrlKey: false }, apple)).toBe(
    false,
  );
});
