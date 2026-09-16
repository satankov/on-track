import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  linkSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { describeRuntime } from "../runtime/build-info.js";
import { retainPrepared } from "./prepared.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "threadstr-retain-"));
  roots.push(base);
  const sourceDirectory = join(base, "source");
  const runtimeDirectory = join(base, "node");
  mkdirSync(join(sourceDirectory, "src/server/db"), { recursive: true });
  mkdirSync(join(sourceDirectory, "drizzle/meta"), { recursive: true });
  mkdirSync(runtimeDirectory);
  writeFileSync(
    join(sourceDirectory, "package.json"),
    JSON.stringify({ version: "0.0.9" }),
  );
  writeFileSync(
    join(sourceDirectory, "src/server/db/database.ts"),
    "const CURRENT_SCHEMA_VERSION = 7;",
  );
  writeFileSync(
    join(sourceDirectory, "drizzle/meta/_journal.json"),
    JSON.stringify({ entries: [{ when: 1 }] }),
  );
  writeFileSync(join(runtimeDirectory, "node.exe"), "runtime");
  return {
    root: join(base, "installed"),
    prepared: {
      selection: {
        protocol: 1 as const,
        releaseId: "v0.0.9",
        runtimeId: "node-v24.14.0-darwin-arm64",
      },
      description: describeRuntime(sourceDirectory),
      sourceDirectory,
      runtimeDirectory,
    },
  };
}
it("retains versioned source/runtime copies without moving the executing bootstrap files", () => {
  const f = fixture();
  expect(retainPrepared(f.root, f.prepared)).toEqual(f.prepared.selection);
  expect(
    readFileSync(join(f.prepared.sourceDirectory, "package.json"), "utf8"),
  ).toContain("0.0.9");
  expect(
    readFileSync(
      join(f.root, "runtimes", f.prepared.selection.runtimeId, "node.exe"),
      "utf8",
    ),
  ).toBe("runtime");
  expect(retainPrepared(f.root, f.prepared)).toEqual(f.prepared.selection);
});

it("copies legitimate npm hardlinks into independent retained regular files", () => {
  const f = fixture();
  const original = join(f.prepared.runtimeDirectory, "node.exe");
  linkSync(original, join(f.prepared.runtimeDirectory, "native-copy"));
  retainPrepared(f.root, f.prepared);
  expect(
    lstatSync(
      join(f.root, "runtimes", f.prepared.selection.runtimeId, "native-copy"),
    ).nlink,
  ).toBe(1);
});
it("retains source and runtime bytes under a Unicode installation path", () => {
  const f = fixture();
  const root = join(f.root, "Runtime with spaces é");
  retainPrepared(root, f.prepared);
  expect(
    readFileSync(join(root, "releases", "v0.0.9", "package.json")),
  ).toEqual(readFileSync(join(f.prepared.sourceDirectory, "package.json")));
  expect(
    readFileSync(
      join(root, "runtimes", f.prepared.selection.runtimeId, "node.exe"),
      "utf8",
    ),
  ).toBe("runtime");
});
it("refuses a different build under an existing release version without replacing it", () => {
  const f = fixture();
  retainPrepared(f.root, f.prepared);
  writeFileSync(
    join(f.prepared.sourceDirectory, "src/server/db/database.ts"),
    "const CURRENT_SCHEMA_VERSION = 8;",
  );
  f.prepared.description = describeRuntime(f.prepared.sourceDirectory);
  expect(() => retainPrepared(f.root, f.prepared)).toThrow(/different build/);
  expect(
    describeRuntime(join(f.root, "releases", f.prepared.selection.releaseId))
      .schemaVersion,
  ).toBe(7);
});
it("rejects prepared symlinks escaping their owned tree", () => {
  const f = fixture();
  symlinkSync(
    join(f.prepared.runtimeDirectory, "node.exe"),
    join(f.prepared.sourceDirectory, "escape"),
  );
  expect(() => retainPrepared(f.root, f.prepared)).toThrow(/outside/);
});
