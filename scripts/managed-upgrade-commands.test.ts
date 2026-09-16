import { expect, test } from "vitest";
import { windowsFixtureCommand } from "./managed-upgrade-commands.mjs";

test.each(["ontrack", "thr"])(
  "runs the actual %s launcher with fixed fixture arguments",
  (name) => {
    expect(windowsFixtureCommand(name, ["--help"])).toBe(
      `.\\${name}.cmd --help`,
    );
    expect(windowsFixtureCommand(name, ["run", "--no-open"])).toBe(
      `.\\${name}.cmd run --no-open`,
    );
  },
);
test("supports both exact and latest baseline updates", () => {
  expect(
    windowsFixtureCommand("ontrack", [
      "update",
      "v99.0.0",
      "--yes",
      "--no-open",
    ]),
  ).toBe(".\\ontrack.cmd update v99.0.0 --yes --no-open");
  expect(
    windowsFixtureCommand("ontrack", ["update", "--yes", "--no-open"]),
  ).toBe(".\\ontrack.cmd update --yes --no-open");
});
test.each([
  ["ontrack & whoami", ["stop"]],
  ["ontrack", ["stop & whoami"]],
  ["ontrack", ["%TEMP%"]],
  ["ontrack", ["C:\\untrusted path\\file.cmd"]],
  ["ontrack", ["--root", "untrusted"]],
  ["ontrack", ["stop\nwhoami"]],
])("rejects non-fixture commands %s %j", (name, argv) => {
  expect(() => windowsFixtureCommand(name, argv)).toThrow(
    "Unsupported fixture command",
  );
});
