import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  createHomeService,
  managedCommand,
  type HomeContext,
} from "./service.js";
import type { ManagedReleaseManifest } from "../cli/release.js";
const context: HomeContext = {
  version: "0.0.8",
  buildId: "b".repeat(64),
  platform: "darwin",
  managedPlatform: "darwin-arm64",
  installRoot: "/owned",
  defaultRoot: "/owned",
};
function fixture(version = "0.0.9", minimum = "0.0.8") {
  const manifest: ManagedReleaseManifest = {
    formatVersion: 1,
    managedProtocol: 1,
    browserApiProtocol: 1,
    migrationScope: "database-only",
    version,
    minimumUpgradeVersion: minimum,
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
      "darwin-arm64": {
        version: "24.14.0",
        name: "node-v24.14.0-darwin-arm64.tar.gz",
        url: "https://nodejs.org/dist/v24.14.0/node-v24.14.0-darwin-arm64.tar.gz",
        sha256: "e".repeat(64),
        size: 20,
      },
    },
  };
  const bytes = JSON.stringify(manifest);
  return {
    manifest,
    bytes,
    release: {
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
      immutable: true,
      assets: [
        {
          name: "managed-release.json",
          browser_download_url: `https://github.com/satankov/on-track/releases/download/v${version}/managed-release.json`,
          size: Buffer.byteLength(bytes),
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        },
        {
          name: manifest.source.name,
          browser_download_url: manifest.source.url,
          size: 20,
          digest: `sha256:${manifest.source.sha256}`,
        },
      ],
    },
  };
}
function transport(fixtures = [fixture()]) {
  return vi.fn<typeof fetch>(async (url) => {
    if (String(url).includes("api.github.com"))
      return Response.json(fixtures.map((f) => f.release));
    const match = fixtures.find(
      (f) => String(url) === f.release.assets[0].browser_download_url,
    );
    if (!match) throw Error("Unexpected request: " + url);
    return new Response(match.bytes);
  });
}
it("checks only on request, coalesces and caches results with no software downloads", async () => {
  let now = 1000;
  const fetcher = transport();
  const service = createHomeService(context, { fetcher, clock: () => now });
  expect(service.info).toEqual({ version: "0.0.8", installation: "managed" });
  expect(fetcher).not.toHaveBeenCalled();
  const first = service.check();
  expect(service.check()).toBe(first);
  const result = await first;
  expect(result).toMatchObject({
    status: "available",
    checkedAt: 1000,
    update: {
      version: "0.0.9",
      command: "thr update v0.0.9",
      exactCommand: "'/owned/bin/thr' update v0.0.9",
    },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await service.check();
  expect(fetcher).toHaveBeenCalledTimes(2);
  now += 300001;
  await service.check();
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it("orders numerically and skips prereleases, drafts, incompatible and mutable candidates", async () => {
  const a = fixture("0.0.10", "0.0.10"),
    b = fixture("0.0.9"),
    draft = fixture("0.0.12"),
    pre = fixture("0.0.13"),
    mutable = fixture("0.0.11");
  draft.release.draft = true;
  pre.release.prerelease = true;
  mutable.release.immutable = false;
  const result = await createHomeService(context, {
    fetcher: transport([b, a, draft, pre, mutable]),
  }).check();
  expect(result.releases.map((r) => r.version)).toEqual([
    "0.0.11",
    "0.0.10",
    "0.0.9",
  ]);
  expect(result.update?.version).toBe("0.0.9");
});
it.each(["linux-x64", undefined] as const)(
  "reports incompatible platform %s without proposing an update",
  async (platform) => {
    const result = await createHomeService(
      { ...context, managedPlatform: platform },
      { fetcher: transport() },
    ).check();
    expect(result.status).toBe("incompatible");
    expect(result.update).toBeUndefined();
  },
);
it.each([
  ["0.0.8", "current"],
  ["0.0.7", "ahead"],
])("handles managed version %s", async (version, status) => {
  expect(
    (
      await createHomeService(context, {
        fetcher: transport([fixture(version)]),
      }).check()
    ).status,
  ).toBe(status);
});
it("handles empty, unknown, custom and verified manual builds honestly", async () => {
  expect(
    (await createHomeService(context, { fetcher: transport([]) }).check())
      .status,
  ).toBe("empty");
  expect(
    (
      await createHomeService(
        { ...context, version: null },
        { fetcher: transport() },
      ).check()
    ).status,
  ).toBe("unverified");
  expect(
    (
      await createHomeService(
        { ...context, installRoot: undefined, buildId: "unknown" },
        { fetcher: transport([fixture("0.0.8")]) },
      ).check()
    ).status,
  ).toBe("unverified");
  expect(
    (
      await createHomeService(
        { ...context, installRoot: undefined },
        { fetcher: transport([fixture("0.0.8")]) },
      ).check()
    ).status,
  ).toBe("current");
  const result = await createHomeService(
    { ...context, installRoot: undefined, platform: "win32" },
    { fetcher: transport() },
  ).check();
  expect(result).toMatchObject({
    status: "manual",
    update: { command: "npm.cmd run quickstart", kind: "manual" },
  });
});
it("fails closed on manifest tampering and untrusted redirects", async () => {
  const broken = fixture();
  broken.bytes += " ";
  await expect(
    createHomeService(context, { fetcher: transport([broken]) }).check(),
  ).rejects.toMatchObject({ code: "invalid_release" });
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
  );
  await expect(
    createHomeService(context, { fetcher }).check(),
  ).rejects.toMatchObject({ code: "invalid_release" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds pagination and malformed responses", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(Array.from({ length: 100 }, () => fixture().release)),
  );
  await expect(
    createHomeService(context, { fetcher }).check(),
  ).rejects.toMatchObject({ code: "invalid_release" });
  expect(fetcher).toHaveBeenCalledTimes(5);
  await expect(
    createHomeService(context, {
      fetcher: async () => Response.json({ bad: true }),
    }).check(),
  ).rejects.toMatchObject({ code: "invalid_release" });
});
it("limits candidate manifest work", async () => {
  const fixtures = Array.from({ length: 11 }, (_, i) =>
    fixture(`0.0.${20 + i}`, "0.0.19"),
  );
  const fetcher = transport(fixtures);
  await expect(
    createHomeService(context, { fetcher }).check(),
  ).rejects.toMatchObject({ code: "invalid_release" });
  expect(fetcher).toHaveBeenCalledTimes(11);
});
it("maps throttling and connection failure and does not cache failures", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "retry-after": "120" } }),
    )
    .mockRejectedValueOnce(Error("/secret/path"));
  const service = createHomeService(context, { fetcher });
  await expect(service.check()).rejects.toMatchObject({
    code: "rate_limited",
    retryAfter: 120,
  });
  await expect(service.check()).rejects.toMatchObject({ code: "offline" });
});
it("aborts active transport at the overall deadline and on shutdown", async () => {
  const fetcher: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Error("abort")), {
        once: true,
      });
    });
  await expect(
    createHomeService(context, { fetcher, timeoutMs: 20 }).check(),
  ).rejects.toMatchObject({ code: "timeout" });
  const service = createHomeService(context, { fetcher });
  const pending = service.check();
  service.close();
  await expect(pending).rejects.toMatchObject({ code: "timeout" });
});
it("quotes exact launcher paths and never appends a duplicate root flag", () => {
  expect(
    managedCommand({ ...context, installRoot: "/a b/o'neil/$thing" }, "0.0.9")
      ?.command,
  ).toBe("'/a b/o'\\''neil/$thing/bin/thr' update v0.0.9");
  expect(
    managedCommand(
      { ...context, platform: "win32", installRoot: "C:\\O'Neil\\app" },
      "0.0.9",
    )?.command,
  ).toBe("& 'C:\\O''Neil\\app\\bin\\thr.cmd' update v0.0.9");
  expect(
    managedCommand({ ...context, installRoot: "/x\ncmd" }, "0.0.9"),
  ).toBeUndefined();
  expect(() => managedCommand(context, "bad;cmd")).toThrow();
});
it.each([
  { schemaVersion: 8, migrationMarker: 1 },
  { schemaVersion: 7, migrationMarker: 2 },
])(
  "does not recommend a schema or migration downgrade: %j",
  async (current) => {
    const result = await createHomeService(
      { ...context, ...current },
      { fetcher: transport() },
    ).check();
    expect(result.status).toBe("incompatible");
    expect(result.update).toBeUndefined();
  },
);
it("can check again after a cancelled drain resumes the app", async () => {
  const normal = transport();
  let first = true;
  const fetcher: typeof fetch = (url, init) => {
    if (first) {
      first = false;
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(Error("cancelled")),
          { once: true },
        ),
      );
    }
    return normal(url, init);
  };
  const service = createHomeService(context, { fetcher });
  const pending = service.check();
  service.close();
  await expect(pending).rejects.toMatchObject({ code: "timeout" });
  expect((await service.check()).status).toBe("available");
});
