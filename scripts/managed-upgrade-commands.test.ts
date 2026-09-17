import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  windowsFixtureCommand,
  runWindowsFixtureCommand,
} from "./managed-upgrade-commands.mjs";

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

test("rejects shell metacharacters before launching a process", async () => {
  await expect(
    runWindowsFixtureCommand("ontrack", ["status & echo injected"], {
      cwd: tmpdir(),
      env: process.env,
    }),
  ).rejects.toThrow("Unsupported fixture command");
});

test.runIf(process.platform === "win32")(
  "runs literal launcher arguments with metacharacters in cwd",
  async () => {
    const base = mkdtempSync(join(tmpdir(), "threadstr-command-"));
    const cwd = join(base, "space & (literal) é");
    try {
      mkdirSync(cwd);
      writeFileSync(
        join(cwd, "ontrack.cmd"),
        "@echo off\r\n@echo fixture:%*\r\n",
      );
      const result = await runWindowsFixtureCommand("ontrack", ["status"], {
        cwd,
        env: process.env,
      });
      expect(result.stdout.trim()).toBe("fixture:status");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);
