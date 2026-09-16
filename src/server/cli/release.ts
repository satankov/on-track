import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { z } from "zod";
export const REPOSITORY = "satankov/on-track";
const versionSchema = z
  .string()
  .max(60)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const assetSchema = z.strictObject({
  name: z.string().max(150),
  url: z.string().url(),
  sha256: digest,
  size: z
    .number()
    .int()
    .positive()
    .max(300 * 1024 * 1024),
});
const runtimeSchema = assetSchema.extend({
  version: versionSchema.regex(/^24\./),
});
const manifestSchema = z.strictObject({
  formatVersion: z.literal(1),
  managedProtocol: z.literal(1),
  browserApiProtocol: z.literal(1),
  migrationScope: z.literal("database-only"),
  version: versionSchema,
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  buildId: digest,
  schemaVersion: z.number().int().positive(),
  migrationMarker: z.number().int().nonnegative(),
  minimumUpgradeVersion: versionSchema,
  source: assetSchema,
  sourceFiles: z.record(
    z.string(),
    z.strictObject({
      sha256: digest,
      size: z
        .number()
        .int()
        .nonnegative()
        .max(20 * 1024 * 1024),
    }),
  ),
  runtimes: z.partialRecord(
    z.enum(["darwin-arm64", "darwin-x64", "linux-x64", "win-x64"]),
    runtimeSchema,
  ),
});
export type ManagedReleaseManifest = z.infer<typeof manifestSchema>;
export type ReleaseAsset = z.infer<typeof assetSchema>;
export function safeSourcePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    path
      .split("/")
      .every(
        (part) =>
          /^[a-zA-Z0-9_.@ -]+$/.test(part) &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}
export function compareReleaseVersions(left: string, right: string): number {
  const a = versionSchema.parse(left).split(".").map(BigInt),
    b = versionSchema.parse(right).split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}
export function parseManagedReleaseManifest(
  value: unknown,
): ManagedReleaseManifest {
  const manifest = manifestSchema.parse(value);
  const name = `on-track-v${manifest.version}.zip`;
  if (
    manifest.source.name !== name ||
    manifest.source.url !==
      `https://github.com/${REPOSITORY}/releases/download/v${manifest.version}/${name}`
  )
    throw new Error("Release source does not match the fixed publisher.");
  const files = Object.entries(manifest.sourceFiles),
    seen = new Set<string>();
  let total = 0;
  if (files.length < 1 || files.length > 10_000)
    throw new Error("Invalid source file inventory.");
  for (const [path, file] of files) {
    if (!safeSourcePath(path) || seen.has(path.toLowerCase()))
      throw new Error("Unsafe or ambiguous source archive path.");
    seen.add(path.toLowerCase());
    total += file.size;
  }
  if (total > 100 * 1024 * 1024)
    throw new Error("Source expansion limit exceeded.");
  const runtimes = Object.entries(manifest.runtimes);
  if (!runtimes.length) throw new Error("Release has no supported runtimes.");
  for (const [platform, runtime] of runtimes) {
    const runtimeName = `node-v${runtime.version}-${platform}.${platform.startsWith("win-") ? "zip" : "tar.gz"}`;
    if (
      runtime.name !== runtimeName ||
      ![
        `https://nodejs.org/dist/v${runtime.version}/${runtimeName}`,
        `https://nodejs.org/download/release/v${runtime.version}/${runtimeName}`,
      ].includes(runtime.url)
    )
      throw new Error("Runtime does not match the official Node artifact.");
  }
  if (
    compareReleaseVersions(manifest.minimumUpgradeVersion, manifest.version) > 0
  )
    throw new Error("Invalid upgrade compatibility range.");
  return manifest;
}

function allowedDownload(url: URL): boolean {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    return false;
  if (url.hostname === "github.com")
    return url.pathname.startsWith(`/${REPOSITORY}/releases/download/`);
  if (url.hostname === "api.github.com")
    return url.pathname.startsWith(`/repos/${REPOSITORY}/releases`);
  return [
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
    "nodejs.org",
  ].includes(url.hostname);
}
/** A bounded HTTPS reader; no token, project data, or inherited registry configuration. */
export async function fetchTrusted(
  url: string,
  limit: number,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  let current = new URL(url);
  const signal = AbortSignal.timeout(60_000);
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (!allowedDownload(current))
      throw new Error("Untrusted software download address.");
    const response = await fetcher(current, {
      redirect: "manual",
      signal,
      headers: {
        Accept:
          current.hostname === "api.github.com"
            ? "application/vnd.github+json"
            : "application/octet-stream",
        "User-Agent": "threadstr-Installer",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Invalid software download redirect.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Software download failed (HTTP ${response.status}).`);
    }
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw new Error("Software download exceeds its size limit.");
    }
    if (!response.body) throw new Error("Empty software download.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.length;
        if (size > limit)
          throw new Error("Software download exceeds its size limit.");
        chunks.push(result.value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    return Buffer.concat(chunks, size);
  }
  throw new Error("Too many software download redirects.");
}
export async function downloadVerifiedAsset(
  asset: ReleaseAsset,
  destination: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const bytes = await fetchTrusted(asset.url, asset.size, fetcher);
  if (
    bytes.length !== asset.size ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw new Error("Software checksum verification failed.");
  const file = await open(destination, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(destination);
    throw error;
  } finally {
    await file.close();
  }
}
