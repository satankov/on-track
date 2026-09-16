import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), "threadstr-cli-fixture-"));
  roots.push(root);
  const entry = join(root, "unchanged CLI é.mjs");
  writeFileSync(entry, source);
  return entry;
}
const wrapper = resolve("scripts/managed-upgrade-cli.mjs");

test("passes installation arguments once without running the CLI auto-entry branch", () => {
  const entry = fixture(`
    import { pathToFileURL } from 'node:url';
    export async function main(args) { console.log(JSON.stringify(args)); }
    if (import.meta.url === pathToFileURL(process.argv[1]).href) {
      throw new Error('Unexpected automatic entry');
    }
  `);
  const args = ["install", "--root", "Runtime with spaces é", "--no-open"];
  expect(
    JSON.parse(
      execFileSync(process.execPath, [wrapper, entry, ...args], {
        encoding: "utf8",
      }),
    ),
  ).toEqual(args);
});

test("retains the original missing-runtime filesystem stack and fails the fixture", () => {
  const entry = fixture(`
    import { lstatSync } from 'node:fs';
    export async function main(args) { lstatSync(args[0]); }
  `);
  const missing = join(entry, "missing-node.exe");
  const result = spawnSync(process.execPath, [wrapper, entry, missing], {
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("lstat");
  expect(result.stderr).toContain("missing-node.exe");
  expect(result.stderr).toContain("at main");
  expect(result.stderr).toContain("managed-upgrade-cli.mjs");
});
