import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  describeRuntime,
  type RuntimeDescription,
} from "../runtime/build-info.js";
import {
  activeReleaseSchema,
  privateDirectory,
  syncDirectory,
  type ActiveRelease,
} from "./state.js";
export interface PreparedRelease {
  selection: ActiveRelease;
  description: RuntimeDescription;
  sourceDirectory: string;
  runtimeDirectory: string;
}
function validateTree(root: string): void {
  function walk(path: string) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(path);
      const target = relative(root, realpathSync(resolve(dirname(path), link)));
      if (
        isAbsolute(link) ||
        isAbsolute(target) ||
        target === ".." ||
        target.startsWith(`..${sep}`)
      )
        throw new Error("Prepared link points outside its owned tree.");
    } else if (stat.isDirectory())
      for (const name of readdirSync(path)) walk(join(path, name));
    // npm packages such as esbuild intentionally hardlink their executables.
    // cpSync copies bytes into independent files; no source inode is retained.
    else if (!stat.isFile())
      throw new Error("Prepared content must contain regular files.");
  }
  walk(root);
}
export function retainPrepared(
  root: string,
  prepared: PreparedRelease,
): ActiveRelease {
  const selection = activeReleaseSchema.parse(prepared.selection);
  if (
    describeRuntime(prepared.sourceDirectory).buildId !==
      prepared.description.buildId ||
    prepared.description.releaseId !== selection.releaseId
  )
    throw new Error("Prepared release identity mismatch.");
  for (const path of [prepared.sourceDirectory, prepared.runtimeDirectory])
    validateTree(realpathSync(path));
  for (const [kind, id, source] of [
    ["releases", selection.releaseId, prepared.sourceDirectory],
    ["runtimes", selection.runtimeId, prepared.runtimeDirectory],
  ]) {
    const directory = privateDirectory(join(root, kind));
    const target = join(directory, id);
    if (existsSync(target)) {
      if (
        lstatSync(target).isSymbolicLink() ||
        !lstatSync(target).isDirectory()
      )
        throw new Error("Unsafe installed directory.");
      if (
        kind === "releases" &&
        describeRuntime(target).buildId !== prepared.description.buildId
      )
        throw new Error("A different build already uses this release version.");
      continue;
    }
    const stage = join(directory, `.staging-${randomUUID()}`);
    cpSync(source, stage, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    privateDirectory(stage);
    renameSync(stage, target);
    syncDirectory(directory);
  }
  return selection;
}
