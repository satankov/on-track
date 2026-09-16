import { posix, win32 } from "node:path";
import { z } from "zod";
import type { HomeCheck, HomeInfo } from "../../domain/home.js";
import {
  compareReleaseVersions,
  fetchTrusted,
  REPOSITORY,
} from "../cli/release.js";
import {
  manifestFor,
  publishedSchema,
  type PublishedRelease,
} from "../cli/release-metadata.js";
import { releaseIdSchema } from "../cli/state.js";

export interface HomeContext {
  version: string | null;
  buildId?: string;
  schemaVersion?: number;
  migrationMarker?: number;
  platform: string;
  managedPlatform?: "darwin-arm64" | "darwin-x64" | "linux-x64" | "win-x64";
  installRoot?: string;
  defaultRoot?: string;
}
export class HomeCheckError extends Error {
  constructor(
    public code: "offline" | "timeout" | "invalid_release" | "rate_limited",
    public retryAfter = 60,
  ) {
    super(
      {
        offline: "Could not reach GitHub. Check your connection and try again.",
        timeout: "GitHub took too long to respond. Try again.",
        invalid_release:
          "Release information could not be verified. Try again later.",
        rate_limited:
          "Release checks are temporarily limited. Please try again later.",
      }[code],
    );
  }
}
export function managedCommand(
  context: HomeContext,
  version: string,
): HomeCheck["update"] {
  releaseIdSchema.parse(`v${version}`);
  const root = context.installRoot;
  if (
    !root ||
    Array.from(root).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return undefined;
  const windows = context.platform === "win32";
  const path = (windows ? win32 : posix).join(
    root,
    "bin",
    windows ? "thr.cmd" : "thr",
  );
  const quoted = windows
    ? `& '${path.replaceAll("'", "''")}'`
    : `'${path.replaceAll("'", "'\\''")}'`;
  const exactCommand = `${quoted} update v${version}`;
  return {
    version,
    kind: "managed",
    command:
      root === context.defaultRoot ? `thr update v${version}` : exactCommand,
    exactCommand,
  };
}
export function createHomeService(
  context: HomeContext,
  options: {
    fetcher?: typeof fetch;
    clock?: () => number;
    timeoutMs?: number;
  } = {},
) {
  const clock = options.clock ?? Date.now;
  let activeRequest: AbortController | undefined;
  let cache: HomeCheck | undefined;
  let pending: Promise<HomeCheck> | undefined;
  const info: HomeInfo = {
    version: context.version,
    installation: context.installRoot ? "managed" : "manual",
  };
  async function lookup(): Promise<HomeCheck> {
    activeRequest = new AbortController();
    const signal = AbortSignal.any([
      activeRequest.signal,
      AbortSignal.timeout(options.timeoutMs ?? 12_000),
    ]);
    const fetcher: typeof fetch = async (url, init) => {
      const host = new URL(String(url)).hostname;
      if (
        ![
          "github.com",
          "api.github.com",
          "release-assets.githubusercontent.com",
          "objects.githubusercontent.com",
        ].includes(host)
      )
        throw new HomeCheckError("invalid_release");
      let response: Response;
      try {
        response = await (options.fetcher ?? fetch)(url, { ...init, signal });
      } catch {
        throw new HomeCheckError(signal.aborted ? "timeout" : "offline");
      }
      if (
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0")
      ) {
        const seconds = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        throw new HomeCheckError(
          "rate_limited",
          Number.isFinite(seconds) && seconds > 0
            ? Math.min(seconds, 3600)
            : 60,
        );
      }
      return response;
    };
    const read: typeof fetchTrusted = (url, limit) =>
      fetchTrusted(url, limit, fetcher);
    try {
      const releases: PublishedRelease[] = [];
      for (let page = 1; page <= 5; page++) {
        const bytes = await read(
          `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,
          2 * 1024 * 1024,
        );
        const batch = z
          .array(publishedSchema)
          .max(100)
          .parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
        releases.push(...batch);
        if (batch.length < 100) break;
        if (page === 5) throw new HomeCheckError("invalid_release");
      }
      const stable = releases
        .filter(
          (r) =>
            !r.draft &&
            !r.prerelease &&
            releaseIdSchema.safeParse(r.tag_name).success,
        )
        .sort((a, b) =>
          compareReleaseVersions(b.tag_name.slice(1), a.tag_name.slice(1)),
        );
      const result: HomeCheck = {
        checkedAt: clock(),
        status: "empty",
        releases: stable.slice(0, 5).map((r) => ({
          version: r.tag_name.slice(1),
          url: `https://github.com/${REPOSITORY}/releases/tag/${r.tag_name}`,
        })),
      };
      if (!stable.length) return result;
      if (!context.version) return { ...result, status: "unverified" };
      const latest = stable[0].tag_name.slice(1);
      const newer = compareReleaseVersions(latest, context.version) > 0;
      if (!context.installRoot) {
        const same = stable.find((r) => r.tag_name === `v${context.version}`);
        const verified =
          same?.immutable &&
          same.assets.some((a) => a.name === "managed-release.json") &&
          (await manifestFor(same, read)).buildId === context.buildId;
        return {
          ...result,
          status: newer
            ? "manual"
            : verified
              ? compareReleaseVersions(latest, context.version) < 0
                ? "ahead"
                : "current"
              : "unverified",
          ...(newer
            ? {
                update: {
                  version: latest,
                  kind: "manual" as const,
                  command:
                    context.platform === "win32"
                      ? "npm.cmd run quickstart"
                      : "npm run quickstart",
                },
              }
            : {}),
        };
      }
      if (!newer)
        return {
          ...result,
          status:
            compareReleaseVersions(latest, context.version) < 0
              ? "ahead"
              : "current",
        };
      if (!context.managedPlatform)
        return { ...result, status: "incompatible" };
      let count = 0;
      for (const release of stable) {
        if (
          compareReleaseVersions(release.tag_name.slice(1), context.version) <=
          0
        )
          break;
        if (
          !release.immutable ||
          !release.assets.some((a) => a.name === "managed-release.json")
        )
          continue;
        if (++count > 10) throw new HomeCheckError("invalid_release");
        const manifest = await manifestFor(release, read);
        if (
          !manifest.runtimes[context.managedPlatform] ||
          manifest.schemaVersion < (context.schemaVersion ?? 0) ||
          manifest.migrationMarker < (context.migrationMarker ?? 0) ||
          compareReleaseVersions(
            context.version,
            manifest.minimumUpgradeVersion,
          ) < 0
        )
          continue;
        const update = managedCommand(context, manifest.version);
        return {
          ...result,
          status: update ? "available" : "incompatible",
          ...(update ? { update } : {}),
        };
      }
      return { ...result, status: "incompatible" };
    } catch (error) {
      if (error instanceof HomeCheckError) throw error;
      throw new HomeCheckError(signal.aborted ? "timeout" : "invalid_release");
    }
  }
  return {
    info,
    close: () => activeRequest?.abort(),
    check(): Promise<HomeCheck> {
      if (cache && clock() - cache.checkedAt < 300_000)
        return Promise.resolve(cache);
      pending ??= lookup()
        .then((result) => {
          cache = result;
          return result;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}
export type HomeService = ReturnType<typeof createHomeService>;
