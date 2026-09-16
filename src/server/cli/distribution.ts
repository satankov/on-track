import {
  publishedSchema,
  manifestFor,
  type PublishedRelease,
} from "./release-metadata.js";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describeRuntime } from "../runtime/build-info.js";
import { extractRuntime, extractVerifiedSource } from "./archive.js";
import { buildPreparedSource } from "./build.js";
import { retainPrepared } from "./prepared.js";
import {
  compareReleaseVersions,
  downloadVerifiedAsset,
  fetchTrusted,
  REPOSITORY,
  type ManagedReleaseManifest,
} from "./release.js";
import {
  managedPaths,
  privateDirectory,
  readActiveRelease,
  releaseIdSchema,
  assertRegularFile,
} from "./state.js";
import { activatePrepared, type ActivateOptions } from "./update.js";
export function currentManagedPlatform():
  "darwin-arm64" | "darwin-x64" | "linux-x64" | "win-x64" {
  const key = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
  if (
    !["darwin-arm64", "darwin-x64", "linux-x64", "win-x64"].includes(key) ||
    (process.platform === "linux" &&
      !(
        process.report.getReport() as {
          header?: { glibcVersionRuntime?: string };
        }
      ).header?.glibcVersionRuntime)
  )
    throw new Error(
      "Managed setup is unavailable for this platform. Use the manual installation guide.",
    );
  return key as ReturnType<typeof currentManagedPlatform>;
}
async function metadata(url: string): Promise<unknown> {
  return JSON.parse(
    Buffer.from(await fetchTrusted(url, 2 * 1024 * 1024)).toString("utf8"),
  ) as unknown;
}
export async function getPublishedManifest(
  tag: string,
): Promise<ManagedReleaseManifest> {
  releaseIdSchema.parse(tag);
  const published = publishedSchema.parse(
    await metadata(
      `https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`,
    ),
  );
  if (published.tag_name !== tag)
    throw new Error(
      "Requested release identity does not match the publisher response.",
    );
  return manifestFor(published);
}
export async function selectPublishedManifest(
  requested?: string,
  current?: string,
): Promise<ManagedReleaseManifest> {
  const platform = currentManagedPlatform();
  function compatible(manifest: ManagedReleaseManifest) {
    if (!manifest.runtimes[platform])
      throw new Error("This release has no runtime for this platform.");
    if (
      current &&
      (compareReleaseVersions(manifest.version, current) < 0 ||
        compareReleaseVersions(current, manifest.minimumUpgradeVersion) < 0)
    )
      throw new Error(
        "This release cannot update the installed version. Downgrades are not supported.",
      );
    return manifest;
  }
  if (requested) return compatible(await getPublishedManifest(requested));
  const releases: PublishedRelease[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = z
      .array(publishedSchema)
      .parse(
        await metadata(
          `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,
        ),
      );
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const eligible = releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        release.immutable &&
        releaseIdSchema.safeParse(release.tag_name).success &&
        release.assets.some((asset) => asset.name === "managed-release.json"),
    )
    .sort((a, b) =>
      compareReleaseVersions(b.tag_name.slice(1), a.tag_name.slice(1)),
    );
  for (const release of eligible) {
    const manifest = await manifestFor(release);
    if (
      !manifest.runtimes[platform] ||
      (current &&
        compareReleaseVersions(current, manifest.minimumUpgradeVersion) < 0)
    )
      continue;
    return compatible(manifest);
  }
  throw new Error(
    "No compatible managed release is published yet. Manual installation remains available.",
  );
}
export function assertManifestBuild(
  manifest: ManagedReleaseManifest,
  source: string,
): ReturnType<typeof describeRuntime> {
  const description = describeRuntime(source);
  if (
    description.buildId !== manifest.buildId ||
    description.version !== manifest.version ||
    description.schemaVersion !== manifest.schemaVersion ||
    description.migrationMarker !== manifest.migrationMarker
  )
    throw new Error(
      "Built application identity does not match the published release.",
    );
  return description;
}
export async function updateFromRelease(
  root: string,
  requested: string | undefined,
  options: ActivateOptions,
): Promise<void> {
  const current = readActiveRelease(root);
  options.progress?.("Checking published releases…");
  const manifest = await selectPublishedManifest(
    requested,
    current.releaseId.slice(1),
  );
  const runtime = manifest.runtimes[currentManagedPlatform()]!;
  const selection = {
    protocol: 1 as const,
    releaseId: `v${manifest.version}`,
    runtimeId: runtime.name.replace(/\.(tar\.gz|zip)$/, ""),
  };
  if (selection.releaseId === current.releaseId) {
    assertManifestBuild(manifest, managedPaths(root, current).releaseDirectory);
    await activatePrepared(root, current, options);
    return;
  }
  const staging = privateDirectory(join(root, "staging"));
  const workspace = mkdtempSync(join(staging, "prepare-"));
  try {
    options.progress?.(`Downloading threadstr ${manifest.version}…`);
    const archive = join(workspace, manifest.source.name);
    await downloadVerifiedAsset(manifest.source, archive);
    const source = join(workspace, "source");
    await extractVerifiedSource(archive, source, manifest);
    assertManifestBuild(manifest, source);
    let runtimeDirectory = managedPaths(root, selection).runtimeDirectory;
    if (!existsSync(runtimeDirectory)) {
      const archive = join(workspace, runtime.name);
      await downloadVerifiedAsset(runtime, archive);
      runtimeDirectory = await extractRuntime(
        archive,
        join(workspace, "runtime"),
        runtime,
      );
    }
    options.progress?.(
      "Installing dependencies and preparing the application…",
    );
    await buildPreparedSource(runtimeDirectory, source, workspace);
    const description = assertManifestBuild(manifest, source);
    retainPrepared(root, {
      selection,
      description,
      sourceDirectory: source,
      runtimeDirectory,
    });
    await activatePrepared(root, selection, options);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Managed update failed.";
    throw new Error(
      message.replace(
        join(workspace, "preparation.log"),
        join(root, "logs", "preparation.log"),
      ),
      { cause: error },
    );
  } finally {
    // Preserve a bounded diagnostic, then remove only this invocation's staging.
    const log = join(workspace, "preparation.log");
    if (existsSync(log)) {
      const fd = openSync(log, "r");
      try {
        const size = fstatSync(fd).size;
        const bytes = Buffer.alloc(Math.min(size, 64 * 1024));
        readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
        const target = join(
          privateDirectory(join(root, "logs")),
          "preparation.log",
        );
        if (existsSync(target)) assertRegularFile(target);
        writeFileSync(target, bytes, { mode: 0o600 });
      } finally {
        closeSync(fd);
      }
    }
    rmSync(workspace, { recursive: true, force: true });
  }
}
