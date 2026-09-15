import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  readActiveRelease,
  readInstallState,
  selectActiveRelease,
  writeInstallState,
} from "./state.js";
const roots: string[] = [];
const root = () => {
  const r = mkdtempSync(join(tmpdir(), "ontrack-state-"));
  roots.push(r);
  return r;
};
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
it("persists an explicit data directory/port and switches a release pair together", () => {
  const r = root();
  const state = {
    protocol: 1 as const,
    dataDirectory: join(r, "separate-data"),
    port: 4173,
  };
  writeInstallState(r, state);
  expect(readInstallState(r)).toEqual(state);
  selectActiveRelease(r, {
    protocol: 1,
    releaseId: "v0.0.9",
    runtimeId: "node-v24.8.0-darwin-arm64",
  });
  expect(readActiveRelease(r).releaseId).toBe("v0.0.9");
  selectActiveRelease(r, {
    protocol: 1,
    releaseId: "v0.0.10",
    runtimeId: "node-v24.9.0-darwin-arm64",
  });
  expect(readActiveRelease(r)).toEqual({
    protocol: 1,
    releaseId: "v0.0.10",
    runtimeId: "node-v24.9.0-darwin-arm64",
  });
});
it("refuses unsafe version/path input before replacing active state", () => {
  const r = root();
  selectActiveRelease(r, {
    protocol: 1,
    releaseId: "v0.0.9",
    runtimeId: "node-v24.8.0-darwin-arm64",
  });
  expect(() =>
    selectActiveRelease(r, {
      protocol: 1,
      releaseId: "../../foreign",
      runtimeId: "node-v24.8.0-darwin-arm64",
    }),
  ).toThrow();
  expect(readActiveRelease(r).releaseId).toBe("v0.0.9");
});
it("does not follow or overwrite a symlink state file", () => {
  const r = root();
  const outside = join(root(), "outside.json");
  writeFileSync(outside, '{"secret":true}');
  symlinkSync(outside, join(r, "install.json"));
  expect(() => readInstallState(r)).toThrow();
  expect(() =>
    writeInstallState(r, {
      protocol: 1,
      dataDirectory: join(r, "data"),
      port: 4173,
    }),
  ).toThrow();
  expect(readFileSync(outside, "utf8")).toBe('{"secret":true}');
});
