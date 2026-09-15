import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { describeRuntime } from "./build-info.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ontrack-build-"));
  roots.push(root);
  mkdirSync(join(root, "src/server/db"), { recursive: true });
  mkdirSync(join(root, "drizzle/meta"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "0.0.9" }),
  );
  writeFileSync(join(root, "package-lock.json"), "{}");
  writeFileSync(
    join(root, "src/server/db/database.ts"),
    "const CURRENT_SCHEMA_VERSION = 7;",
  );
  writeFileSync(
    join(root, "drizzle/meta/_journal.json"),
    JSON.stringify({ entries: [{ when: 123 }] }),
  );
  return root;
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

it("describes a source ZIP build without Git or opening project data", () => {
  const info = describeRuntime(fixture());
  expect(info).toMatchObject({
    protocol: 1,
    version: "0.0.9",
    releaseId: "v0.0.9",
    schemaVersion: 7,
    migrationMarker: 123,
  });
  expect(info.buildId).toMatch(/^[a-f0-9]{64}$/);
});
it("fingerprints source changes deterministically but ignores generated dist files", () => {
  const root = fixture();
  const original = describeRuntime(root).buildId;
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist/generated.js"), "unrelated");
  expect(describeRuntime(root).buildId).toBe(original);
  writeFileSync(join(root, "src/new.ts"), "export const changed = true;");
  expect(describeRuntime(root).buildId).not.toBe(original);
});
