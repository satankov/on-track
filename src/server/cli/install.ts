import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveDataDirectory } from "../data-directory.js";
import { describeRuntime } from "../runtime/build-info.js";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import {
  assertManifestBuild,
  currentManagedPlatform,
  getPublishedManifest,
} from "./distribution.js";
import { installCommand, openLocalBrowser } from "./platform.js";
import { buildPreparedSource } from "./build.js";
import { retainPrepared } from "./prepared.js";
import { managedStatus, softwareEnvironment, startManaged } from "./process.js";
import {
  parseManagedReleaseManifest,
  type ManagedReleaseManifest,
} from "./release.js";
import {
  assertRegularFile,
  assertSeparateRoots,
  managedPaths,
  privateDirectory,
  readInstallState,
  readJsonFile,
  selectActiveRelease,
  writeInstallState,
  type ActiveRelease,
} from "./state.js";
import { activatePrepared, recoverManagedUpdate } from "./update.js";

export function copyPublishedSource(
  manifest: ManagedReleaseManifest,
  source: string,
  destination: string,
): void {
  mkdirSync(destination, { mode: 0o700 });
  for (const [path, expected] of Object.entries(manifest.sourceFiles)) {
    const file = join(source, path);
    assertRegularFile(file);
    const bytes = readFileSync(file);
    if (
      bytes.length !== expected.size ||
      createHash("sha256").update(bytes).digest("hex") !== expected.sha256
    )
      throw new Error(
        "Manual source differs from its published release. Keep that checkout and use the manual upgrade guide.",
      );
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  }
}

export function resolveInstallationData(
  root: string,
  options: Record<string, string | boolean>,
): string {
  const override = options["data-dir"];
  if (
    override !== undefined &&
    (typeof override !== "string" || !isAbsolute(override))
  )
    throw new Error("--data-dir must be an absolute directory.");
  const dataDirectory = resolve(
    typeof override === "string" ? override : resolveDataDirectory(),
  );
  assertSeparateRoots(root, dataDirectory);
  const existing = [
    "on-track.sqlite",
    "on-track.sqlite-wal",
    "attachments",
    ".on-track-update-journal.json",
    ".on-track-restore-journal.json",
  ].some((name) => existsSync(join(dataDirectory, name)));
  if (
    existing &&
    !options["adopt-from"] &&
    !existsSync(join(root, "install.json"))
  )
    throw new Error(
      "Existing projects found. Stop the manual server and use --adopt-from with a published protocol-aware source installation; see the installation guide.",
    );
  return dataDirectory;
}
export async function installManaged(
  root: string,
  options: Record<string, string | boolean>,
): Promise<void> {
  currentManagedPlatform();
  for (const name of ["release-dir", "runtime-dir", "manifest"])
    if (typeof options[name] !== "string" || !isAbsolute(String(options[name])))
      throw new Error(
        `Managed bootstrap requires an absolute --${name}. Use the installation guide.`,
      );
  const source = realpathSync(String(options["release-dir"]));
  const runtimeDirectory = realpathSync(String(options["runtime-dir"]));
  const manifest = parseManagedReleaseManifest(
    readJsonFile(String(options.manifest)),
  );
  const description = assertManifestBuild(manifest, source);
  const runtime = manifest.runtimes[currentManagedPlatform()];
  if (!runtime) throw new Error("This release does not support this platform.");
  const runtimeId = runtime.name.replace(/\.(tar\.gz|zip)$/, "");
  const executable = join(
    runtimeDirectory,
    process.platform === "win32" ? "node.exe" : "bin/node",
  );
  assertRegularFile(executable);
  const version = spawnSync(executable, ["-p", "process.versions.node"], {
    env: softwareEnvironment(),
    shell: false,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (version.status !== 0 || version.stdout.trim() !== runtime.version)
    throw new Error(
      "Prepared Node runtime does not match its release manifest.",
    );
  assertRegularFile(join(source, "dist/server/server/cli/main.js"));
  assertRegularFile(join(source, "dist/server/server/main.js"));
  const dataDirectory = resolveInstallationData(root, options);
  root = privateDirectory(root);
  const lock = acquireInstanceOwner(root, {
    filename: ".on-track-install-owner.sqlite",
  });
  try {
    const selection: ActiveRelease = {
      protocol: 1,
      releaseId: description.releaseId,
      runtimeId,
    };
    if (existsSync(join(root, "install.json"))) {
      const state = readInstallState(root);
      if (
        (options["data-dir"] &&
          realpathSync(dataDirectory) !== state.dataDirectory) ||
        (options.port && Number(options.port) !== state.port)
      )
        throw new Error(
          "Existing managed setup records a different data directory or port. Keep its saved configuration.",
        );
      retainPrepared(root, {
        selection,
        description,
        sourceDirectory: source,
        runtimeDirectory,
      });
      await recoverManagedUpdate(root);
      await activatePrepared(root, selection, { confirm: async () => true });
    } else {
      let previous: ActiveRelease | undefined;
      if (options["adopt-from"]) {
        if (
          typeof options["adopt-from"] !== "string" ||
          !isAbsolute(options["adopt-from"])
        )
          throw new Error(
            "--adopt-from requires an absolute source directory.",
          );
        const oldSource = realpathSync(options["adopt-from"]);
        const oldDescription = describeRuntime(oldSource);
        assertRegularFile(join(oldSource, "dist/server/server/cli/main.js"));
        const published = await getPublishedManifest(oldDescription.releaseId);
        assertManifestBuild(published, oldSource);
        previous = {
          protocol: 1,
          releaseId: oldDescription.releaseId,
          runtimeId,
        };
        // Manual native modules may target Node22. Rebuild only published source
        // files with the private runtime, leaving the manual checkout untouched.
        const stage = mkdtempSync(
          join(privateDirectory(join(root, "staging")), "adopt-"),
        );
        try {
          const preparedSource = join(stage, "source");
          copyPublishedSource(published, oldSource, preparedSource);
          await buildPreparedSource(runtimeDirectory, preparedSource, stage);
          assertManifestBuild(published, preparedSource);
          retainPrepared(root, {
            selection: previous,
            description: oldDescription,
            sourceDirectory: preparedSource,
            runtimeDirectory,
          });
        } finally {
          rmSync(stage, { recursive: true, force: true });
        }
      }
      retainPrepared(root, {
        selection,
        description,
        sourceDirectory: source,
        runtimeDirectory,
      });
      const canonicalData = privateDirectory(dataDirectory);
      assertSeparateRoots(root, canonicalData);
      const owner = acquireInstanceOwner(canonicalData);
      owner.release();
      // The selection is recoverable preparation; install.json is the final
      // initialization record. A crash before it leaves bootstrap retryable.
      selectActiveRelease(root, previous ?? selection);
      writeInstallState(root, {
        protocol: 1,
        dataDirectory: canonicalData,
        port: Number(options.port ?? process.env.ON_TRACK_PORT ?? 4173),
      });
      if (previous)
        await activatePrepared(root, selection, {
          confirm: async () => true,
          forceCheckpoint: true,
        });
      else await startManaged(root);
    }
    const command = await installCommand(root, {
      noProfile: Boolean(options["no-profile"]),
      runtimeExecutable: managedPaths(root, selection).node,
    });
    console.log(
      `On Track is installed. You can close this terminal.\nCommand: ${command}\nOpen a new terminal to use ontrack from PATH.`,
    );
    const status = await managedStatus(root);
    if (status) {
      console.log(status.url);
      if (!options["no-open"]) {
        try {
          await openLocalBrowser(status.url);
        } catch {
          /* The URL remains available when desktop opening is unavailable. */
        }
      }
    }
  } finally {
    lock.release();
  }
}
