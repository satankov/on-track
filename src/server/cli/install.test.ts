import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installManaged, resolveInstallationData } from "./install.js";
import { describeRuntime } from "../runtime/build-info.js";
import { readActiveRelease, readInstallState } from "./state.js";
import type { ManagedReleaseManifest } from "./release.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "threadstr-install-data-"));
  roots.push(base);
  const data = join(base, "data"),
    root = join(base, "runtime");
  mkdirSync(data);
  return { root, data };
}
it("requires explicit adoption before touching an existing workspace", () => {
  const { root, data } = fixture();
  writeFileSync(join(data, "on-track.sqlite"), "existing");
  expect(() => resolveInstallationData(root, { "data-dir": data })).toThrow(
    /adopt-from/,
  );
  expect(
    resolveInstallationData(root, {
      "data-dir": data,
      "adopt-from": "/trusted-source",
    }),
  ).toBe(data);
});
it("keeps fresh application data separate from runtime storage", () => {
  const { root, data } = fixture();
  expect(resolveInstallationData(root, { "data-dir": data })).toBe(data);
  expect(() =>
    resolveInstallationData(root, { "data-dir": join(root, "projects") }),
  ).toThrow(/separate/);
  expect(() =>
    resolveInstallationData(root, { "data-dir": "relative" }),
  ).toThrow(/absolute/);
});

const boundary = vi.hoisted(() => ({
  spawn: vi.fn(),
  published: vi.fn(),
  build: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  activate: vi.fn(),
  recover: vi.fn(),
  command: vi.fn(),
  browser: vi.fn(),
  select: vi.fn(),
  save: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawnSync: boundary.spawn }));
vi.mock("./distribution.js", async (original) => ({
  ...(await original<typeof import("./distribution.js")>()),
  currentManagedPlatform: () => "darwin-arm64",
  getPublishedManifest: boundary.published,
}));
vi.mock("./build.js", () => ({ buildPreparedSource: boundary.build }));
vi.mock("./process.js", () => ({
  softwareEnvironment: () => ({}),
  startManaged: boundary.start,
  managedStatus: boundary.status,
}));
vi.mock("./update.js", () => ({
  activatePrepared: boundary.activate,
  recoverManagedUpdate: boundary.recover,
}));
vi.mock("./platform.js", () => ({
  installCommand: boundary.command,
  openLocalBrowser: boundary.browser,
}));
vi.mock("./state.js", async (original) => ({
  ...(await original<typeof import("./state.js")>()),
  selectActiveRelease: boundary.select,
  writeInstallState: boundary.save,
}));
const actualState =
  await vi.importActual<typeof import("./state.js")>("./state.js");
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
function sourceFixture(base: string, version: string) {
  const source = join(base, `source-${version}`);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ version }),
    "src/server/db/database.ts": "const CURRENT_SCHEMA_VERSION = 7;",
    "drizzle/meta/_journal.json": JSON.stringify({ entries: [{ when: 1 }] }),
  };
  for (const [name, content] of Object.entries(files)) {
    const target = join(source, name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  mkdirSync(join(source, "dist/server/server/cli"), { recursive: true });
  writeFileSync(join(source, "dist/server/server/cli/main.js"), "manual cli");
  writeFileSync(join(source, "dist/server/server/main.js"), "manual server");
  const description = describeRuntime(source);
  const runtimeName = "node-v24.14.0-darwin-arm64.tar.gz";
  const manifest: ManagedReleaseManifest = {
    formatVersion: 1,
    managedProtocol: 1,
    browserApiProtocol: 1,
    migrationScope: "database-only",
    version,
    minimumUpgradeVersion: "0.0.8",
    commit: "a".repeat(40),
    buildId: description.buildId,
    schemaVersion: 7,
    migrationMarker: 1,
    source: {
      name: `on-track-v${version}.zip`,
      url: `https://github.com/satankov/on-track/releases/download/v${version}/on-track-v${version}.zip`,
      sha256: "c".repeat(64),
      size: 20,
    },
    sourceFiles: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        { sha256: sha(content), size: Buffer.byteLength(content) },
      ]),
    ),
    runtimes: {
      "darwin-arm64": {
        name: runtimeName,
        version: "24.14.0",
        url: `https://nodejs.org/dist/v24.14.0/${runtimeName}`,
        sha256: "e".repeat(64),
        size: 20,
      },
    },
  };
  return { source, description, manifest, files };
}
function preparedInstall() {
  const base = realpathSync(
    mkdtempSync(join(tmpdir(), "threadstr-prepared-install-")),
  );
  roots.push(base);
  const current = sourceFixture(base, "0.0.9");
  const runtime = join(base, "prepared-node");
  mkdirSync(join(runtime, "bin"), { recursive: true });
  writeFileSync(
    join(runtime, process.platform === "win32" ? "node.exe" : "bin/node"),
    "private runtime fixture",
  );
  const manifestFile = join(base, "manifest.json");
  writeFileSync(manifestFile, JSON.stringify(current.manifest));
  const root = join(base, "runtime"),
    data = join(base, "data");
  const options: Record<string, string | boolean> = {
    "release-dir": current.source,
    "runtime-dir": runtime,
    manifest: manifestFile,
    "data-dir": data,
    port: "4189",
    "no-profile": true,
    "no-open": true,
  };
  return { base, current, runtime, root, data, options };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  boundary.spawn.mockImplementation((_command: string, args: string[]) => ({
    status: 0,
    stdout: args.some((arg) => arg.includes("ConvertTo-Json"))
      ? '{"path":"","extensions":""}'
      : "24.14.0\n",
  }));
  boundary.command.mockResolvedValue("fixture-thr");
  boundary.status.mockResolvedValue(undefined);
  boundary.select.mockImplementation(actualState.selectActiveRelease);
  boundary.save.mockImplementation(actualState.writeInstallState);
});
afterEach(() => vi.restoreAllMocks());

it("stores fresh configuration and selection before starting without editing user profiles", async () => {
  const f = preparedInstall();
  boundary.start.mockImplementation(async () => {
    expect(readInstallState(f.root)).toEqual({
      protocol: 1,
      dataDirectory: realpathSync(f.data),
      port: 4189,
    });
    expect(readActiveRelease(f.root).releaseId).toBe("v0.0.9");
  });
  await installManaged(f.root, f.options);
  expect(boundary.start).toHaveBeenCalledExactlyOnceWith(f.root);
  expect(boundary.command).toHaveBeenCalledWith(
    f.root,
    expect.objectContaining({ noProfile: true }),
  );
  expect(boundary.browser).not.toHaveBeenCalled();
  expect(boundary.select.mock.invocationCallOrder[0]).toBeLessThan(
    boundary.save.mock.invocationCallOrder[0],
  );
});
it("keeps initialization retryable if interrupted between selection and final install record", async () => {
  const f = preparedInstall();
  boundary.save.mockImplementationOnce(() => {
    throw new Error("simulated initialization interruption");
  });
  await expect(installManaged(f.root, f.options)).rejects.toThrow(
    /initialization interruption/,
  );
  expect(readActiveRelease(f.root).releaseId).toBe("v0.0.9");
  expect(existsSync(join(f.root, "install.json"))).toBe(false);
  expect(boundary.start).not.toHaveBeenCalled();
  await installManaged(f.root, f.options);
  expect(readInstallState(f.root).port).toBe(4189);
  expect(boundary.start).toHaveBeenCalledTimes(1);
});
it("repeated setup reuses saved configuration and refuses a different requested port", async () => {
  const f = preparedInstall();
  await installManaged(f.root, f.options);
  boundary.start.mockClear();
  await installManaged(f.root, f.options);
  expect(boundary.recover).toHaveBeenCalledWith(f.root);
  expect(boundary.activate).toHaveBeenCalledTimes(1);
  expect(boundary.start).not.toHaveBeenCalled();
  await expect(
    installManaged(f.root, { ...f.options, port: "4190" }),
  ).rejects.toThrow(/different data directory or port/);
  expect(readInstallState(f.root).port).toBe(4189);
});
it("refuses existing projects without adoption before installation state or server changes", async () => {
  const f = preparedInstall();
  mkdirSync(f.data);
  const database = join(f.data, "on-track.sqlite");
  writeFileSync(database, "manual projects");
  await expect(installManaged(f.root, f.options)).rejects.toThrow(
    /Existing projects/,
  );
  expect(readFileSync(database, "utf8")).toBe("manual projects");
  expect(existsSync(join(f.root, "install.json"))).toBe(false);
  expect(boundary.start).not.toHaveBeenCalled();
  expect(boundary.activate).not.toHaveBeenCalled();
});
it("adoption rebuilds verified previous source with the private Node runtime and preserves the manual checkout", async () => {
  const f = preparedInstall();
  const old = sourceFixture(f.base, "0.0.8");
  mkdirSync(join(old.source, "node_modules"));
  const native = join(old.source, "node_modules/native.node");
  writeFileSync(native, "old Node22 native ABI");
  mkdirSync(f.data);
  const database = join(f.data, "on-track.sqlite");
  writeFileSync(database, "manual projects");
  boundary.published.mockResolvedValue(old.manifest);
  boundary.build.mockImplementation(async (runtime: string, source: string) => {
    expect(runtime).toBe(f.runtime);
    expect(source).not.toBe(old.source);
    expect(existsSync(join(source, "node_modules/native.node"))).toBe(false);
    for (const [name, content] of Object.entries(old.files))
      expect(readFileSync(join(source, name), "utf8")).toBe(content);
    mkdirSync(join(source, "node_modules"));
    writeFileSync(
      join(source, "node_modules/native.node"),
      "rebuilt Node24 native ABI",
    );
    mkdirSync(join(source, "dist/server/server/cli"), { recursive: true });
    writeFileSync(
      join(source, "dist/server/server/cli/main.js"),
      "rebuilt cli",
    );
    writeFileSync(join(source, "dist/server/server/main.js"), "rebuilt server");
  });
  boundary.activate.mockImplementation(async () => {
    expect(existsSync(join(f.root, "shim-runtime.json"))).toBe(true);
    expect(existsSync(join(f.root, "bin/command.mjs"))).toBe(true);
    expect(readActiveRelease(f.root).releaseId).toBe("v0.0.8");
    expect(
      readFileSync(
        join(f.root, "releases/v0.0.8/node_modules/native.node"),
        "utf8",
      ),
    ).toBe("rebuilt Node24 native ABI");
  });
  await installManaged(f.root, { ...f.options, "adopt-from": old.source });
  expect(boundary.build).toHaveBeenCalledTimes(1);
  expect(boundary.activate).toHaveBeenCalledWith(
    f.root,
    expect.objectContaining({ releaseId: "v0.0.9" }),
    expect.objectContaining({ forceCheckpoint: true }),
  );
  expect(readFileSync(native, "utf8")).toBe("old Node22 native ABI");
  expect(
    readFileSync(join(old.source, "dist/server/server/cli/main.js"), "utf8"),
  ).toBe("manual cli");
  expect(readFileSync(database, "utf8")).toBe("manual projects");
  expect(boundary.start).not.toHaveBeenCalled();
});
it("failed previous-version rebuild leaves the manual installation and projects untouched", async () => {
  const f = preparedInstall();
  const old = sourceFixture(f.base, "0.0.8");
  boundary.published.mockResolvedValue(old.manifest);
  boundary.build.mockRejectedValue(new Error("Native rebuild unavailable"));
  await expect(
    installManaged(f.root, { ...f.options, "adopt-from": old.source }),
  ).rejects.toThrow(/Native rebuild/);
  expect(existsSync(join(f.root, "install.json"))).toBe(false);
  expect(
    readFileSync(join(old.source, "dist/server/server/cli/main.js"), "utf8"),
  ).toBe("manual cli");
  expect(boundary.activate).not.toHaveBeenCalled();
  expect(boundary.start).not.toHaveBeenCalled();
});
