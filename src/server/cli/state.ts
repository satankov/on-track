import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ensurePrivateDirectory } from "../runtime/private-directory.js";

export const releaseIdSchema = z
  .string()
  .regex(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const runtimeIdSchema = z
  .string()
  .regex(/^node-v\d+\.\d+\.\d+-(darwin|linux|win)-(arm64|x64)$/);
export const installStateSchema = z
  .object({
    protocol: z.literal(1),
    dataDirectory: z.string().refine(isAbsolute),
    port: z.number().int().min(1).max(65535),
  })
  .strict();
export const activeReleaseSchema = z
  .object({
    protocol: z.literal(1),
    releaseId: releaseIdSchema,
    runtimeId: runtimeIdSchema,
  })
  .strict();
export type InstallState = z.infer<typeof installStateSchema>;
export type ActiveRelease = z.infer<typeof activeReleaseSchema>;

export function privateDirectory(path: string): string {
  return ensurePrivateDirectory(path);
}
export function assertRegularFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error("Unsafe installation file.");
}
export function syncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY);
    fsyncSync(fd);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function readJsonFile(path: string): unknown {
  assertRegularFile(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256 * 1024)
      throw new Error("Invalid installation metadata.");
    return JSON.parse(readFileSync(fd, "utf8")) as unknown;
  } finally {
    closeSync(fd);
  }
}
export function writeJsonFile(path: string, value: unknown): void {
  const directory = privateDirectory(dirname(path));
  if (
    existsSync(path) ||
    (() => {
      try {
        lstatSync(path);
        return true;
      } catch {
        return false;
      }
    })()
  )
    assertRegularFile(path);
  const temporary = join(directory, `.ontrack-${randomUUID()}.tmp`);
  const fd = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(fd, JSON.stringify(value) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
    syncDirectory(directory);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
export function writeInstallState(root: string, state: InstallState): void {
  writeJsonFile(join(root, "install.json"), installStateSchema.parse(state));
}
export function readInstallState(root: string): InstallState {
  return installStateSchema.parse(readJsonFile(join(root, "install.json")));
}
export function selectActiveRelease(
  root: string,
  selection: ActiveRelease,
): void {
  writeJsonFile(
    join(root, "active.json"),
    activeReleaseSchema.parse(selection),
  );
}
export function readActiveRelease(root: string): ActiveRelease {
  return activeReleaseSchema.parse(readJsonFile(join(root, "active.json")));
}
export function managedPaths(root: string, selection: ActiveRelease) {
  activeReleaseSchema.parse(selection);
  const releaseDirectory = join(root, "releases", selection.releaseId);
  const runtimeDirectory = join(root, "runtimes", selection.runtimeId);
  return {
    releaseDirectory,
    runtimeDirectory,
    node: join(
      runtimeDirectory,
      process.platform === "win32" ? "node.exe" : "bin/node",
    ),
    entry: join(releaseDirectory, "dist/server/server/main.js"),
    cli: join(releaseDirectory, "dist/server/server/cli/main.js"),
  };
}
export function assertSeparateRoots(
  installRoot: string,
  dataDirectory: string,
): void {
  const inside = (a: string, b: string) => {
    const r = relative(resolve(a), resolve(b));
    return (
      r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r))
    );
  };
  if (inside(installRoot, dataDirectory) || inside(dataDirectory, installRoot))
    throw new Error(
      "Application data and managed runtime folders must be separate.",
    );
}
