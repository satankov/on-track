import { expect, it } from "vitest";
import { parseArguments } from "./arguments.js";
it("accepts the documented lifecycle commands and explicit release", () => {
  expect(parseArguments(["update", "v0.0.9", "--yes"])).toEqual({
    command: "update",
    version: "v0.0.9",
    options: { yes: true },
  });
  expect(parseArguments(["run", "--no-open"])).toEqual({
    command: "run",
    options: { "no-open": true },
  });
});
it("keeps installation paths as literal values", () => {
  expect(
    parseArguments(["install", "--root", "/a path/$(text)", "--no-profile"])
      .options.root,
  ).toBe("/a path/$(text)");
});
it.each([
  ["update", "main"],
  ["update", "https://example.com"],
  ["update", "v0.0.9;whoami"],
  ["run", "--typo"],
  ["stop", "--root"],
  ["run", "--root", "/a", "--root", "/b"],
  ["install", "--port", "-1"],
  ["run", "extra"],
])("rejects ambiguous or unsupported inputs %s", (...args) => {
  expect(() => parseArguments(args)).toThrow();
});
