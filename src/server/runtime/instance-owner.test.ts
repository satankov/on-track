import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import * as ownership from "./instance-owner.js";
const directories: string[] = [];
const releases: Array<() => void> = [];
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "threadstr-owner-"));
  directories.push(dir);
  return dir;
}
afterEach(() => {
  for (const release of releases.splice(0)) release();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it("excludes another owner and retains the reusable lock file after release", () => {
  const dir = directory();
  const owner = ownership.acquireInstanceOwner(dir);
  releases.push(owner.release);
  expect(() => ownership.acquireInstanceOwner(dir)).toThrow(/already in use/);
  owner.release();
  owner.release();
  const next = ownership.acquireInstanceOwner(dir);
  releases.push(next.release);
});
it("excludes a separate process independent of requested HTTP port", () => {
  const dir = directory();
  const owner = ownership.acquireInstanceOwner(dir);
  releases.push(owner.release);
  expect(() => ownership.acquireInstanceOwner(dir)).toThrow(/already in use/);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import Database from 'better-sqlite3'; const db=new Database(process.argv[1]); db.pragma('busy_timeout=0'); try { db.exec('BEGIN EXCLUSIVE'); process.exitCode=42; } catch(error) { if(error.code!=='SQLITE_BUSY') throw error; } finally { db.close(); }`,
      join(dir, ".on-track-owner.sqlite"),
    ],
    { encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
it("rejects a symlink lock without modifying its target", () => {
  const dir = directory();
  const target = join(directory(), "target");
  symlinkSync(target, join(dir, ".on-track-owner.sqlite"));
  expect(() => ownership.acquireInstanceOwner(dir)).toThrow(/regular file/);
});
