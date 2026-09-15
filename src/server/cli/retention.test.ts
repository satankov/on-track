import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkpointPath } from "../runtime/database-checkpoint.js";
import {
  type UpdateJournal,
  type UpdateReleaseIdentity,
} from "../runtime/update-journal.js";
import { pruneCommitted } from "./retention.js";
import {
  selectActiveRelease,
  writeInstallState,
  writeJsonFile,
} from "./state.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "ontrack-retention-")));
  roots.push(top);
  const root = join(top, "install");
  const data = join(top, "data");
  mkdirSync(data);
  writeInstallState(root, { protocol: 1, dataDirectory: data, port: 4173 });
  return { root, data, top };
}
function identity(n: number): UpdateReleaseIdentity {
  return {
    releaseId: `v0.0.${n}`,
    runtimeId: `node-v24.0.${n}-darwin-arm64`,
    buildId: String(n).repeat(64),
    schemaVersion: 7,
    migrationMarker: 100,
  };
}
function commit(
  f: ReturnType<typeof fixture>,
  from: number,
  to: number,
): UpdateJournal {
  const transactionId = randomUUID();
  const previous = identity(from);
  const candidate = identity(to);
  const journal: UpdateJournal = {
    version: 1,
    state: "committed",
    transactionId,
    installRoot: f.root,
    previous,
    candidate,
    candidateCredentials: { nonce: randomUUID(), token: "a".repeat(64) },
    checkpoint: {
      transactionId,
      sha256: "a".repeat(64),
      size: 3,
      schemaVersion: 7,
      migrationMarker: 100,
    },
  };
  for (const release of [previous, candidate])
    for (const [kind, id] of [
      ["releases", release.releaseId],
      ["runtimes", release.runtimeId],
    ])
      mkdirSync(join(f.root, kind, id), { recursive: true });
  writeFileSync(checkpointPath(f.data, transactionId), "db");
  selectActiveRelease(f.root, {
    protocol: 1,
    releaseId: candidate.releaseId,
    runtimeId: candidate.runtimeId,
  });
  writeJsonFile(join(f.root, "last-update.json"), {
    protocol: 1,
    transactionId,
    previous,
    candidate,
    checkpoint: journal.checkpoint,
  });
  return journal;
}
it("retains active, previous, and shim runtime while pruning only known completed artifacts", () => {
  const f = fixture();
  const first = commit(f, 1, 2);
  writeJsonFile(join(f.root, "shim-runtime.json"), {
    protocol: 1,
    runtimeExecutable: join(
      f.root,
      "runtimes",
      identity(1).runtimeId,
      "bin/node",
    ),
  });
  expect(pruneCommitted(f.root, first)).toEqual([]);
  const unknown = join(f.root, "releases", "v9.9.9");
  mkdirSync(unknown);
  const unknownCheckpoint = checkpointPath(f.data, randomUUID());
  writeFileSync(unknownCheckpoint, "unknown");
  const next = commit(f, 2, 3);
  expect(pruneCommitted(f.root, next)).toEqual([]);
  expect(existsSync(join(f.root, "releases", identity(1).releaseId))).toBe(
    false,
  );
  expect(existsSync(join(f.root, "runtimes", identity(1).runtimeId))).toBe(
    true,
  );
  for (const n of [2, 3])
    expect(existsSync(join(f.root, "releases", identity(n).releaseId))).toBe(
      true,
    );
  expect(existsSync(checkpointPath(f.data, first.transactionId))).toBe(false);
  expect(existsSync(checkpointPath(f.data, next.transactionId))).toBe(true);
  expect(existsSync(unknown)).toBe(true);
  expect(existsSync(unknownCheckpoint)).toBe(true);
});
it("preserves artifacts during a pending or corrupt transaction", () => {
  const f = fixture();
  const first = commit(f, 1, 2);
  pruneCommitted(f.root, first);
  const next = commit(f, 2, 3);
  writeJsonFile(join(f.data, ".on-track-update-journal.json"), {
    ...next,
    state: "candidate_started",
  });
  expect(pruneCommitted(f.root, next).length).toBeGreaterThan(0);
  expect(existsSync(checkpointPath(f.data, first.transactionId))).toBe(true);
  writeFileSync(join(f.data, ".on-track-update-journal.json"), "corrupt");
  expect(pruneCommitted(f.root, next).length).toBeGreaterThan(0);
  expect(existsSync(join(f.root, "releases", identity(1).releaseId))).toBe(
    true,
  );
});
it("refuses a symlink artifact and preserves its external target", () => {
  const f = fixture();
  const first = commit(f, 1, 2);
  pruneCommitted(f.root, first);
  const next = commit(f, 2, 3);
  const old = join(f.root, "releases", identity(1).releaseId);
  rmSync(old, { recursive: true });
  const target = join(f.top, "manual");
  mkdirSync(target);
  writeFileSync(join(target, "important"), "keep");
  symlinkSync(target, old, "junction");
  expect(pruneCommitted(f.root, next).length).toBeGreaterThan(0);
  expect(existsSync(join(target, "important"))).toBe(true);
  expect(existsSync(old)).toBe(true);
});

it("requires a matching durable completion record before deletion", () => {
  const f = fixture();
  const first = commit(f, 1, 2);
  pruneCommitted(f.root, first);
  const next = commit(f, 2, 3);
  writeJsonFile(join(f.root, "last-update.json"), { protocol: 1 });
  expect(pruneCommitted(f.root, next).length).toBeGreaterThan(0);
  expect(existsSync(checkpointPath(f.data, first.transactionId))).toBe(true);
  expect(existsSync(join(f.root, "releases", identity(1).releaseId))).toBe(
    true,
  );
});

it("does not sweep runtimes when the dispatcher interpreter is unknown", () => {
  const f = fixture();
  const first = commit(f, 1, 2);
  pruneCommitted(f.root, first);
  const next = commit(f, 2, 3);
  expect(pruneCommitted(f.root, next)).toEqual([]);
  expect(existsSync(join(f.root, "runtimes", identity(1).runtimeId))).toBe(
    true,
  );
});

it("keeps a known checkpoint when unexpected SQLite sidecars exist", () => {
  const f = fixture();
  const first = commit(f, 1, 2);
  pruneCommitted(f.root, first);
  const next = commit(f, 2, 3);
  const old = checkpointPath(f.data, first.transactionId);
  writeFileSync(old + "-wal", "unknown contents");
  expect(pruneCommitted(f.root, next).length).toBeGreaterThan(0);
  expect(existsSync(old)).toBe(true);
  expect(existsSync(old + "-wal")).toBe(true);
});
