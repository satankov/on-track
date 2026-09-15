import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeRuntime } from "../runtime/build-info.js";
import { selectActiveRelease } from "./state.js";
import {
  currentManagedPlatform,
  getPublishedManifest,
  selectPublishedManifest,
  updateFromRelease,
} from "./distribution.js";
import type { ManagedReleaseManifest } from "./release.js";
const boundary = vi.hoisted(() => ({
  fetch: vi.fn(),
  download: vi.fn(),
  extract: vi.fn(),
  runtime: vi.fn(),
  build: vi.fn(),
  retain: vi.fn(),
  activate: vi.fn(),
}));
vi.mock("./release.js", async (original) => ({
  ...(await original<typeof import("./release.js")>()),
  fetchTrusted: boundary.fetch,
  downloadVerifiedAsset: boundary.download,
}));
vi.mock("./archive.js", () => ({
  extractVerifiedSource: boundary.extract,
  extractRuntime: boundary.runtime,
}));
vi.mock("./build.js", () => ({ buildPreparedSource: boundary.build }));
vi.mock("./prepared.js", () => ({ retainPrepared: boundary.retain }));
vi.mock("./update.js", () => ({ activatePrepared: boundary.activate }));
const roots: string[] = [];
const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function manifest(
  version = "0.0.9",
  minimumUpgradeVersion = "0.0.8",
): ManagedReleaseManifest {
  const platform = currentManagedPlatform();
  const extension = platform.startsWith("win-") ? "zip" : "tar.gz";
  const runtimeName = `node-v24.14.0-${platform}.${extension}`;
  return {
    formatVersion: 1,
    managedProtocol: 1,
    browserApiProtocol: 1,
    migrationScope: "database-only",
    version,
    minimumUpgradeVersion,
    commit: "a".repeat(40),
    buildId: "b".repeat(64),
    schemaVersion: 7,
    migrationMarker: 1,
    source: {
      name: `on-track-v${version}.zip`,
      url: `https://github.com/satankov/on-track/releases/download/v${version}/on-track-v${version}.zip`,
      sha256: "c".repeat(64),
      size: 20,
    },
    sourceFiles: { "package.json": { sha256: "d".repeat(64), size: 2 } },
    runtimes: {
      [platform]: {
        name: runtimeName,
        version: "24.14.0",
        url: `https://nodejs.org/dist/v24.14.0/${runtimeName}`,
        sha256: "e".repeat(64),
        size: 20,
      },
    },
  };
}
function published(m: ManagedReleaseManifest) {
  const bytes = Buffer.from(JSON.stringify(m));
  return {
    tag_name: `v${m.version}`,
    draft: false,
    prerelease: false,
    immutable: true,
    assets: [
      {
        name: "managed-release.json",
        browser_download_url: `https://github.com/satankov/on-track/releases/download/v${m.version}/managed-release.json`,
        size: bytes.length,
        digest: `sha256:${sha(bytes)}`,
      },
      {
        name: m.source.name,
        browser_download_url: m.source.url,
        size: m.source.size,
        digest: `sha256:${m.source.sha256}`,
      },
    ],
  };
}
function feed(
  manifests: ManagedReleaseManifest[],
  releases = manifests.map(published),
) {
  boundary.fetch.mockImplementation(async (url: string) => {
    if (url.includes("?per_page")) return Buffer.from(JSON.stringify(releases));
    const tag = url.match(/\/v(\d+\.\d+\.\d+)(?:\/|$)/)?.[1];
    const index = manifests.findIndex((item) => item.version === tag);
    if (index < 0) throw new Error("Exact release unavailable");
    return Buffer.from(
      JSON.stringify(
        url.endsWith("managed-release.json")
          ? manifests[index]
          : releases.find((item) => item.tag_name === `v${tag}`),
      ),
    );
  });
}
function rootFixture() {
  const root = mkdtempSync(join(tmpdir(), "ontrack-distribution-"));
  roots.push(root);
  selectActiveRelease(root, {
    protocol: 1,
    releaseId: "v0.0.8",
    runtimeId: "node-v24.14.0-darwin-arm64",
  });
  return root;
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("selects exact published releases without substituting a different latest version", async () => {
  const old = manifest("0.0.9"),
    newer = manifest("0.0.10");
  feed([old, newer]);
  expect((await selectPublishedManifest("v0.0.9", "0.0.8")).version).toBe(
    "0.0.9",
  );
  await expect(selectPublishedManifest("v0.0.11", "0.0.8")).rejects.toThrow(
    /Exact release/,
  );
  expect(
    boundary.fetch.mock.calls.every(
      ([url]) =>
        String(url).startsWith(
          "https://api.github.com/repos/satankov/on-track/releases/tags/",
        ) ||
        String(url).startsWith(
          "https://github.com/satankov/on-track/releases/download/",
        ),
    ),
  ).toBe(true);
});
it("finds the newest compatible stable immutable release using numeric versions", async () => {
  const old = manifest("0.0.9"),
    best = manifest("0.0.10"),
    incompatible = manifest("0.0.12", "0.0.11"),
    draft = manifest("0.0.13");
  const releases = [old, draft, incompatible, best].map(published);
  releases[1].draft = true;
  feed([old, draft, incompatible, best], releases);
  expect((await selectPublishedManifest(undefined, "0.0.8")).version).toBe(
    "0.0.10",
  );
});
it.each([{ draft: true }, { prerelease: true }, { immutable: false }])(
  "rejects ineligible exact release %j",
  async (flags) => {
    const m = manifest();
    feed([m], [{ ...published(m), ...flags }]);
    await expect(getPublishedManifest("v0.0.9")).rejects.toThrow(
      /immutable stable/,
    );
  },
);
it("rejects downgrade and unsupported origins before downloading software", async () => {
  const m = manifest();
  feed([m]);
  await expect(selectPublishedManifest("v0.0.9", "0.0.10")).rejects.toThrow(
    /Downgrades/,
  );
  await expect(selectPublishedManifest("v0.0.9", "0.0.7")).rejects.toThrow(
    /cannot update/,
  );
  expect(boundary.download).not.toHaveBeenCalled();
});
it("refuses missing manifest digest and tampered manifest before build or activation", async () => {
  const m = manifest();
  const release = published(m);
  release.assets[0].digest = "";
  feed([m], [release]);
  await expect(getPublishedManifest("v0.0.9")).rejects.toThrow(
    /does not support/,
  );
  const changed = published(m);
  changed.assets[0].digest = `sha256:${"0".repeat(64)}`;
  feed([m], [changed]);
  await expect(getPublishedManifest("v0.0.9")).rejects.toThrow(
    /checksum mismatch/,
  );
  expect(boundary.build).not.toHaveBeenCalled();
  expect(boundary.activate).not.toHaveBeenCalled();
});
it("refuses a published source digest that disagrees with its manifest", async () => {
  const m = manifest();
  const release = published(m);
  release.assets[1].digest = `sha256:${"0".repeat(64)}`;
  feed([m], [release]);
  await expect(getPublishedManifest("v0.0.9")).rejects.toThrow(
    /source asset does not match/,
  );
});
it("download integrity failure leaves active selection usable and clears only its staging", async () => {
  const root = rootFixture(),
    m = manifest();
  feed([m]);
  boundary.download.mockRejectedValue(
    new Error("Software checksum verification failed."),
  );
  await expect(
    updateFromRelease(root, "v0.0.9", { confirm: async () => true }),
  ).rejects.toThrow(/checksum/);
  expect(boundary.extract).not.toHaveBeenCalled();
  expect(boundary.build).not.toHaveBeenCalled();
  expect(boundary.activate).not.toHaveBeenCalled();
  expect(readdirSync(join(root, "staging"))).toEqual([]);
});
it("current published build only ensures activation without downloading or rebuilding", async () => {
  const root = rootFixture();
  const source = join(root, "releases/v0.0.8");
  mkdirSync(join(source, "src/server/db"), { recursive: true });
  mkdirSync(join(source, "drizzle/meta"), { recursive: true });
  writeFileSync(
    join(source, "package.json"),
    JSON.stringify({ version: "0.0.8" }),
  );
  writeFileSync(
    join(source, "src/server/db/database.ts"),
    "const CURRENT_SCHEMA_VERSION = 7;",
  );
  writeFileSync(
    join(source, "drizzle/meta/_journal.json"),
    JSON.stringify({ entries: [{ when: 1 }] }),
  );
  const m = { ...manifest("0.0.8"), ...describeRuntime(source) };
  delete (m as Partial<typeof m>).protocol;
  delete (m as Partial<typeof m>).releaseId;
  feed([m]);
  await updateFromRelease(root, "v0.0.8", { confirm: async () => true });
  expect(boundary.activate).toHaveBeenCalledTimes(1);
  expect(boundary.download).not.toHaveBeenCalled();
  expect(boundary.build).not.toHaveBeenCalled();
});

it("refuses an exact-tag API response naming a different release", async () => {
  const newer = manifest("0.0.10");
  boundary.fetch.mockImplementation(async (url: string) =>
    Buffer.from(
      JSON.stringify(url.includes("/tags/") ? published(newer) : newer),
    ),
  );
  await expect(getPublishedManifest("v0.0.9")).rejects.toThrow(
    /identity|requested|match/i,
  );
});

function writeBuildSource(path: string, version: string) {
  mkdirSync(join(path, "src/server/db"), { recursive: true });
  mkdirSync(join(path, "drizzle/meta"), { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify({ version }));
  writeFileSync(
    join(path, "src/server/db/database.ts"),
    "const CURRENT_SCHEMA_VERSION = 7;",
  );
  writeFileSync(
    join(path, "drizzle/meta/_journal.json"),
    JSON.stringify({ entries: [{ when: 1 }] }),
  );
  return describeRuntime(path);
}
it("prepares source and private runtime before handing a verified release to activation", async () => {
  const root = rootFixture(),
    m = manifest();
  m.buildId = writeBuildSource(
    join(root, "source-template"),
    m.version,
  ).buildId;
  feed([m]);
  boundary.extract.mockImplementation(
    async (_archive: string, destination: string) => {
      writeBuildSource(destination, m.version);
    },
  );
  boundary.runtime.mockImplementation(
    async (_archive: string, destination: string) => {
      mkdirSync(destination);
      return destination;
    },
  );
  boundary.build.mockImplementation(
    async (_runtime: string, source: string) => {
      expect(describeRuntime(source).buildId).toBe(m.buildId);
      expect(boundary.activate).not.toHaveBeenCalled();
    },
  );
  await updateFromRelease(root, "v0.0.9", { confirm: async () => true });
  expect(boundary.download).toHaveBeenCalledTimes(2);
  expect(boundary.build).toHaveBeenCalledTimes(1);
  expect(boundary.retain).toHaveBeenCalledTimes(1);
  expect(boundary.activate).toHaveBeenCalledWith(
    root,
    expect.objectContaining({ releaseId: "v0.0.9" }),
    expect.any(Object),
  );
  expect(boundary.retain.mock.invocationCallOrder[0]).toBeLessThan(
    boundary.activate.mock.invocationCallOrder[0],
  );
  expect(readdirSync(join(root, "staging"))).toEqual([]);
});
it("failed build preserves bounded diagnostics but never activates the candidate", async () => {
  const root = rootFixture(),
    m = manifest();
  m.buildId = writeBuildSource(
    join(root, "source-template"),
    m.version,
  ).buildId;
  feed([m]);
  const runtime = m.runtimes[currentManagedPlatform()]!;
  mkdirSync(
    join(root, "runtimes", runtime.name.replace(/\.(zip|tar\.gz)$/, "")),
    { recursive: true },
  );
  boundary.extract.mockImplementation(
    async (_archive: string, destination: string) => {
      writeBuildSource(destination, m.version);
    },
  );
  boundary.build.mockImplementation(
    async (_runtime: string, _source: string, workspace: string) => {
      writeFileSync(join(workspace, "preparation.log"), "x".repeat(70000));
      throw new Error(`See ${join(workspace, "preparation.log")}`);
    },
  );
  await expect(
    updateFromRelease(root, "v0.0.9", { confirm: async () => true }),
  ).rejects.toThrow(join(root, "logs", "preparation.log"));
  expect(boundary.runtime).not.toHaveBeenCalled();
  expect(boundary.activate).not.toHaveBeenCalled();
  expect(boundary.retain).not.toHaveBeenCalled();
  expect(readFileSync(join(root, "logs/preparation.log")).length).toBe(
    64 * 1024,
  );
  expect(readdirSync(join(root, "staging"))).toEqual([]);
});
