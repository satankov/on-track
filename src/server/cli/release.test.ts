import { expect, it } from "vitest";
import {
  compareReleaseVersions,
  fetchTrusted,
  parseManagedReleaseManifest,
} from "./release.js";
export function manifestFixture() {
  return {
    formatVersion: 1,
    managedProtocol: 1,
    browserApiProtocol: 1,
    migrationScope: "database-only",
    version: "0.0.9",
    commit: "a".repeat(40),
    buildId: "b".repeat(64),
    schemaVersion: 7,
    migrationMarker: 1,
    minimumUpgradeVersion: "0.0.8",
    source: {
      name: "on-track-v0.0.9.zip",
      url: "https://github.com/satankov/on-track/releases/download/v0.0.9/on-track-v0.0.9.zip",
      sha256: "c".repeat(64),
      size: 100,
    },
    sourceFiles: { "package.json": { sha256: "d".repeat(64), size: 2 } },
    runtimes: {
      "darwin-arm64": {
        version: "24.14.0",
        name: "node-v24.14.0-darwin-arm64.tar.gz",
        url: "https://nodejs.org/dist/v24.14.0/node-v24.14.0-darwin-arm64.tar.gz",
        sha256: "e".repeat(64),
        size: 100,
      },
    },
  };
}
it("accepts only a complete compatible manifest bound to the fixed publisher", () => {
  expect(parseManagedReleaseManifest(manifestFixture())).toMatchObject({
    version: "0.0.9",
  });
});
it.each([
  "https://evil.invalid/source.zip",
  "https://github.com/other/repo/releases/download/v0.0.9/on-track-v0.0.9.zip",
  "https://github.com/satankov/on-track/releases/download/v0.0.8/on-track-v0.0.9.zip",
])("refuses source substitution %s", (url) => {
  const m = manifestFixture();
  m.source.url = url;
  expect(() => parseManagedReleaseManifest(m)).toThrow();
});
it.each([
  "../escape",
  "/absolute",
  "C:/drive",
  "a\\b",
  "CON.txt",
  "file:stream",
  "a/../b",
  "a. ",
  "a/[glob]",
])("rejects unsafe source archive path %s", (name) => {
  const m = manifestFixture();
  Object.assign(m, {
    sourceFiles: { [name]: { sha256: "f".repeat(64), size: 1 } },
  });
  expect(() => parseManagedReleaseManifest(m)).toThrow();
});
it("rejects filesystem migrations and unknown protocol versions", () => {
  expect(() =>
    parseManagedReleaseManifest({
      ...manifestFixture(),
      migrationScope: "attachments",
    }),
  ).toThrow();
  expect(() =>
    parseManagedReleaseManifest({ ...manifestFixture(), managedProtocol: 2 }),
  ).toThrow();
});
it("compares numeric release versions without lexicographic or prerelease fallbacks", () => {
  expect(compareReleaseVersions("0.0.10", "0.0.9")).toBe(1);
  expect(compareReleaseVersions("1.0.0", "1.0.1")).toBe(-1);
  expect(compareReleaseVersions("1.0.0", "1.0.0")).toBe(0);
  expect(() => compareReleaseVersions("main", "1.0.0")).toThrow();
});
it("refuses downloads redirected away from software distribution hosts", async () => {
  const fetcher = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    })) as typeof fetch;
  await expect(
    fetchTrusted(manifestFixture().source.url, 100, fetcher),
  ).rejects.toThrow(/Untrusted/);
});
it("bounds streamed content even when the server omits its length", async () => {
  const fetcher = (async () => new Response("too much data")) as typeof fetch;
  await expect(
    fetchTrusted(manifestFixture().source.url, 3, fetcher),
  ).rejects.toThrow(/size limit/);
});
