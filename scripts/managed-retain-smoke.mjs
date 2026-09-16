import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retainPrepared } from "../dist/server/server/cli/prepared.js";
import { describeRuntime } from "../dist/server/server/runtime/build-info.js";

// Run with the published release's pinned Node, not just the CI host's Node.
// Both copies must preserve bytes at the intended Unicode destination.
const base = mkdtempSync(join(tmpdir(), "threadstr-retain-smoke-"));
try {
  const source = join(base, "source");
  const runtime = join(base, "runtime");
  const root = join(base, "Runtime with spaces é");
  mkdirSync(join(source, "src/server/db"), { recursive: true });
  mkdirSync(join(source, "drizzle/meta"), { recursive: true });
  mkdirSync(runtime);
  writeFileSync(
    join(source, "package.json"),
    JSON.stringify({ version: "0.0.9" }),
  );
  writeFileSync(
    join(source, "src/server/db/database.ts"),
    "const CURRENT_SCHEMA_VERSION = 7;",
  );
  writeFileSync(
    join(source, "drizzle/meta/_journal.json"),
    JSON.stringify({ entries: [{ when: 1 }] }),
  );
  writeFileSync(join(runtime, "node.exe"), "retained runtime bytes");
  const selection = {
    protocol: 1,
    releaseId: "v0.0.9",
    runtimeId: "node-v24.14.0-win-x64",
  };
  retainPrepared(root, {
    selection,
    description: describeRuntime(source),
    sourceDirectory: source,
    runtimeDirectory: runtime,
  });
  assert.deepEqual(
    readFileSync(join(root, "releases", selection.releaseId, "package.json")),
    readFileSync(join(source, "package.json")),
  );
  assert.equal(
    readFileSync(
      join(root, "runtimes", selection.runtimeId, "node.exe"),
      "utf8",
    ),
    "retained runtime bytes",
  );
  console.log(
    `Retained Unicode source/runtime bytes passed on Node ${process.versions.node} (${process.platform}).`,
  );
} finally {
  rmSync(base, { recursive: true, force: true });
}
