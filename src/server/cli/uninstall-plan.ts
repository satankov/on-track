import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { z } from "zod";
import { checkpointPath } from "../runtime/database-checkpoint.js";
import { dispatcherSource, launcherSource } from "./launchers.js";
import { completedSchema, ledgerSchema } from "./retention.js";
import {
  assertRegularFile,
  assertSeparateRoots,
  readActiveRelease,
  readInstallState,
  readJsonFile,
  runtimeIdSchema,
} from "./state.js";

export const UNINSTALL_MARKER = ".on-track-uninstall.json";
export interface Removal {
  path: string;
  directory: boolean;
  dev: number;
  ino: number;
  birthtimeMs: number;
}
export interface UninstallPlan {
  root: string;
  data: string;
  app: Removal[];
  dataFiles: Removal[];
  checkpoints: Removal[];
  directories: string[];
}
export function statIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export function assertUninstallIdle(root: string): void {
  if (statIfPresent(join(root, UNINSTALL_MARKER)))
    throw new Error(
      `An uninstall is pending. Read ${join(root, UNINSTALL_MARKER)} for its cleanup receipt and retry instructions before changing this installation.`,
    );
}
export function safeDirectory(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(path) !== resolve(path)
  )
    throw new Error(`Unsafe uninstall directory: ${path}`);
}
function safeRoot(path: string): void {
  safeDirectory(path);
  const forbidden = [
    parse(path).root,
    homedir(),
    "/usr",
    "/usr/local",
    "/opt",
    "/Applications",
    "/Users",
    "/home",
    "/var",
    "/tmp",
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
  ].filter((v): v is string => Boolean(v));
  if (forbidden.some((value) => resolve(value) === path))
    throw new Error(`Unsafe uninstall root: ${path}`);
}
export function removal(path: string, directory = false): Removal | undefined {
  const stat = statIfPresent(path);
  if (!stat) return undefined;
  safeDirectory(dirname(path));
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
  )
    throw new Error(`Unsafe uninstall artifact: ${path}`);
  return {
    path,
    directory,
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
  };
}
export function assertRemovalIdentity(item: Removal): boolean {
  const now = removal(item.path, item.directory);
  if (!now) return false;
  if (now.dev !== item.dev || now.ino !== item.ino)
    throw new Error(`Uninstall target changed: ${item.path}`);
  return true;
}
function add(list: Removal[], path: string, directory = false) {
  const entry = removal(path, directory);
  if (entry && !list.some((v) => v.path === path)) list.push(entry);
}
function assertRecoveryIdle(data: string): void {
  for (const file of [
    ".on-track-update-journal.json",
    ".on-track-restore-journal.json",
  ])
    if (statIfPresent(join(data, file)))
      throw new Error(
        "Finish the pending update or restore before uninstalling.",
      );
}

/** Read-only, exact inventory. No chmod, locks, recovery or wildcard removal. */
export function planUninstall(
  root: string,
  deleteData: boolean,
): UninstallPlan {
  if (!isAbsolute(root))
    throw new Error("Uninstall requires an absolute runtime path.");
  root = resolve(root);
  safeRoot(root);
  const state = readInstallState(root),
    data = state.dataDirectory;
  safeRoot(data);
  assertSeparateRoots(root, data);
  assertRecoveryIdle(data);
  const active = readActiveRelease(root),
    releases = new Set([active.releaseId]),
    runtimes = new Set([active.runtimeId]),
    ids = new Set<string>();
  for (const parent of ["releases", "runtimes", "bin"])
    if (statIfPresent(join(root, parent))) safeDirectory(join(root, parent));
  const app: Removal[] = [],
    dataFiles: Removal[] = [],
    checkpoints: Removal[] = [];
  const shim = z
    .strictObject({
      protocol: z.literal(1),
      runtimeExecutable: z.string().refine(isAbsolute),
    })
    .parse(readJsonFile(join(root, "shim-runtime.json")));
  const interpreterParts = relative(
    join(root, "runtimes"),
    shim.runtimeExecutable,
  ).split(sep);
  const shimId = runtimeIdSchema.parse(interpreterParts[0]);
  if (!(
    (interpreterParts.length === 3 &&
      interpreterParts[1] === "bin" &&
      interpreterParts[2] === "node") ||
    (interpreterParts.length === 2 && interpreterParts[1] === "node.exe")
  ))
    throw new Error("Unsafe launcher runtime.");
  runtimes.add(shimId);
  if (statIfPresent(join(root, "retention.json"))) {
    const ledger = ledgerSchema.parse(
      readJsonFile(join(root, "retention.json")),
    );
    ledger.releases.forEach((id) => releases.add(id));
    ledger.runtimes.forEach((id) => runtimes.add(id));
    ledger.checkpoints.forEach((id) => ids.add(id));
  }
  if (statIfPresent(join(root, "last-update.json"))) {
    const last = completedSchema.parse(
      readJsonFile(join(root, "last-update.json")),
    );
    if (
      last.candidate.releaseId !== active.releaseId ||
      last.candidate.runtimeId !== active.runtimeId
    )
      throw new Error(
        "Uninstall release record does not match the active installation.",
      );
    for (const id of [last.previous, last.candidate]) {
      releases.add(id.releaseId);
      runtimes.add(id.runtimeId);
    }
    ids.add(last.transactionId);
  }
  for (const id of releases) add(app, join(root, "releases", id), true);
  for (const id of runtimes) add(app, join(root, "runtimes", id), true);
  const dispatcher = join(root, "bin/command.mjs");
  for (const [path, expected] of [
    [dispatcher, dispatcherSource(root)],
    ...["thr", "ontrack"].map((name) => [
      join(root, "bin", process.platform === "win32" ? name + ".cmd" : name),
      launcherSource(shim.runtimeExecutable, dispatcher),
    ]),
  ]) {
    if (!statIfPresent(path)) continue;
    assertRegularFile(path);
    if (lstatSync(path).size > 65536 || readFileSync(path, "utf8") !== expected)
      throw new Error(`Modified or unrelated launcher: ${path}`);
    add(app, path);
  }
  if (statIfPresent(join(root, "logs"))) {
    safeDirectory(join(root, "logs"));
    for (const name of ["server.log", "server.previous.log", "preparation.log"])
      add(app, join(root, "logs", name));
  }
  for (const id of ids) {
    const path = checkpointPath(data, id);
    for (const suffix of ["-wal", "-shm", "-journal"])
      if (statIfPresent(path + suffix))
        throw new Error("An update checkpoint is still in use.");
    add(checkpoints, path);
  }
  if (deleteData) {
    for (const name of [
      "on-track.sqlite",
      "on-track.sqlite-wal",
      "on-track.sqlite-shm",
      "on-track.sqlite-journal",
      ".on-track-instance.json",
    ])
      add(dataFiles, join(data, name));
    if (statIfPresent(join(data, "attachments"))) {
      safeDirectory(join(data, "attachments"));
      add(dataFiles, join(data, "attachments/v1"), true);
    }
  }
  // Metadata last keeps an interrupted POSIX cleanup retryable with this CLI.
  for (const name of [
    "retention.json",
    "last-update.json",
    "shim-runtime.json",
    "active.json",
    "install.json",
  ])
    add(app, join(root, name));
  return {
    root,
    data,
    app,
    dataFiles,
    checkpoints,
    directories: [
      ...["bin", "logs", "staging", "releases", "runtimes"].map((name) =>
        join(root, name),
      ),
      ...(deleteData ? [join(data, "attachments"), data] : []),
      root,
    ],
  };
}
const removalSchema = z.strictObject({
  path: z.string().refine(isAbsolute),
  directory: z.boolean(),
  dev: z.number(),
  ino: z.number(),
  birthtimeMs: z.number(),
});
const planSchema = z.strictObject({
  root: z.string().refine(isAbsolute),
  data: z.string().refine(isAbsolute),
  app: z.array(removalSchema).max(3000),
  dataFiles: z.array(removalSchema).max(10),
  checkpoints: z.array(removalSchema).max(1000),
  directories: z.array(z.string()).max(10),
});
export const uninstallStateSchema = z.strictObject({
  protocol: z.literal(1),
  token: z.uuid(),
  phase: z.enum(["deleting", "runtime-pending"]),
  deleteData: z.boolean(),
  plan: planSchema,
  receipt: z.string().optional(),
});
/** Recovery never trusts a saved arbitrary path list as deletion authority. */
export function readUninstallState(root: string) {
  safeRoot(root);
  const state = uninstallStateSchema.parse(
    readJsonFile(join(root, UNINSTALL_MARKER)),
  );
  const plan = state.plan;
  if (plan.root !== root) throw new Error("Uninstall root changed.");
  safeRoot(plan.data);
  assertSeparateRoots(root, plan.data);
  assertRecoveryIdle(plan.data);
  for (const item of plan.app) {
    const rel = relative(root, item.path).split(sep).join("/");
    const allowed = item.directory
      ? /^(releases\/v\d+\.\d+\.\d+|runtimes\/node-v\d+\.\d+\.\d+-(darwin|linux|win)-(arm64|x64))$/
      : /^(retention\.json|last-update\.json|shim-runtime\.json|active\.json|install\.json|bin\/(command\.mjs|thr(?:\.cmd)?|ontrack(?:\.cmd)?)|logs\/(server\.log|server\.previous\.log|preparation\.log))$/;
    if (!allowed.test(rel))
      throw new Error("Invalid uninstall artifact inventory.");
  }
  for (const item of plan.dataFiles) {
    const rel = relative(plan.data, item.path).split(sep).join("/");
    if (
      !state.deleteData ||
      !(item.directory
        ? rel === "attachments/v1"
        : /^(on-track\.sqlite(?:-wal|-shm|-journal)?|\.on-track-instance\.json)$/.test(
            rel,
          ))
    )
      throw new Error("Invalid data deletion inventory.");
  }
  for (const item of plan.checkpoints)
    if (
      item.directory ||
      !/^\.on-track-update-[a-f0-9-]{36}\.sqlite$/.test(
        relative(plan.data, item.path),
      )
    )
      throw new Error("Invalid checkpoint inventory.");
  plan.directories = [
    ...["bin", "logs", "staging", "releases", "runtimes"].map((name) =>
      join(root, name),
    ),
    ...(state.deleteData ? [join(plan.data, "attachments"), plan.data] : []),
    root,
  ];
  for (const item of [...plan.app, ...plan.dataFiles, ...plan.checkpoints])
    assertRemovalIdentity(item);
  return state;
}
export function retainedPaths(plan: UninstallPlan): string[] {
  return [plan.root, plan.data].flatMap((root) =>
    statIfPresent(root)
      ? readdirSync(root).map((name) => join(root, name))
      : [],
  );
}
