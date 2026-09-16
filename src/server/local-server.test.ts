import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { startLocalServer } from "./local-server.js";
import { acquireInstanceOwner } from "./runtime/instance-owner.js";
const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "threadstr-startup-"));
  directories.push(dir);
  vi.stubEnv("ON_TRACK_DATA_DIR", dir);
  return dir;
}
it("validates the port before creating or migrating data", async () => {
  const directory = setup();
  vi.stubEnv("ON_TRACK_PORT", "0");
  await expect(startLocalServer()).rejects.toThrow(/ON_TRACK_PORT/);
  expect(existsSync(join(directory, "on-track.sqlite"))).toBe(false);
  expect(existsSync(join(directory, ".on-track-owner.sqlite"))).toBe(false);
});
it("holds ownership before the pre-database guard and releases it after failure", async () => {
  const directory = setup();
  await expect(
    startLocalServer({
      beforeDatabaseOpen: () => {
        expect(() => acquireInstanceOwner(directory)).toThrow(/already in use/);
        throw new Error("pending transaction");
      },
    }),
  ).rejects.toThrow("pending transaction");
  expect(existsSync(join(directory, "on-track.sqlite"))).toBe(false);
  const next = acquireInstanceOwner(directory);
  next.release();
});
