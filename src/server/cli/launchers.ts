import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  fchmodSync,
  linkSync,
  unlinkSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  privateDirectory,
  readJsonFile,
  syncDirectory,
  writeJsonFile,
} from "./state.js";

// The dispatcher and legacy shell bytes deliberately match v0.0.8. Both names
// select active.json, so a new alias remains valid after old-client rollback.
export function dispatcherSource(root: string): string {
  return `import {readFileSync} from 'node:fs';\nimport {join} from 'node:path';\nimport {spawnSync} from 'node:child_process';\nconst root=${JSON.stringify(root)};\nconst a=JSON.parse(readFileSync(join(root,'active.json'),'utf8'));\nif(a.protocol!==1||!/^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/.test(a.releaseId)||!/^node-v24\\.\\d+\\.\\d+-(darwin|linux|win)-(arm64|x64)$/.test(a.runtimeId))throw Error('Invalid managed selection');\nconst node=join(root,'runtimes',a.runtimeId,process.platform==='win32'?'node.exe':'bin/node');\nconst cwd=join(root,'releases',a.releaseId);\nconst result=spawnSync(node,[join(cwd,'dist/server/server/cli/main.js'),...process.argv.slice(2),'--root',root],{cwd,stdio:'inherit',shell:false});\nif(result.error)throw result.error;\nprocess.exitCode=result.status??1;\n`;
}

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function launcherSource(
  interpreter: string,
  dispatcher: string,
  platform = process.platform,
): string {
  if (platform === "win32") {
    if (/[\r\n%!"]/u.test(interpreter + dispatcher))
      throw new Error("Unsupported Windows command path.");
    return `@echo off\r\nsetlocal\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\n"${interpreter}" "${dispatcher}" %*\r\n`;
  }
  return (
    "#!/bin/sh\nunset NODE_OPTIONS NODE_PATH\nexec " +
    quote(interpreter) +
    " " +
    quote(dispatcher) +
    ' "$@"\n'
  );
}
function conflict(path: string): never {
  throw new Error(
    `Command conflict or unsafe file: ${path}. Resolve the unrelated command explicitly and retry. Existing ontrack remains available; no conflicting command was replaced.`,
  );
}
function statIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function ownedOrAbsent(path: string, expected: string, mode?: number): boolean {
  const stat = statIfPresent(path);
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
    conflict(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = fstatSync(fd);
    const bytes = Buffer.alloc(64 * 1024 + 1);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (
      !current.isFile() ||
      current.size > 64 * 1024 ||
      bytes.subarray(0, length).toString("utf8") !== expected
    )
      conflict(path);
    // link() atomically publishes without replacing an existing name. Recover
    // only its one exact staging link if interrupted before unlinking it.
    if (current.nlink === 2) {
      const prefix = basename(path) + ".thr-stage-";
      const stages = readdirSync(dirname(path))
        .filter(
          (name) =>
            name.startsWith(prefix) &&
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
              name.slice(prefix.length),
            ),
        )
        .filter((name) => {
          const stage = lstatSync(join(dirname(path), name));
          return (
            stage.isFile() &&
            !stage.isSymbolicLink() &&
            stage.dev === current.dev &&
            stage.ino === current.ino &&
            stage.nlink === 2
          );
        });
      if (stages.length !== 1) conflict(path);
      unlinkSync(join(dirname(path), stages[0]));
      syncDirectory(dirname(path));
    }
    if (fstatSync(fd).nlink !== 1) conflict(path);
    if (mode !== undefined && process.platform !== "win32") {
      fchmodSync(fd, mode);
      fsyncSync(fd);
    }
  } finally {
    closeSync(fd);
  }
  return true;
}
function createOwned(path: string, bytes: string, mode: number): void {
  if (ownedOrAbsent(path, bytes, mode)) return;
  const temporary = path + ".thr-stage-" + randomUUID();
  const fd = openSync(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    mode,
  );
  try {
    try {
      writeFileSync(fd, bytes);
      if (process.platform !== "win32") fchmodSync(fd, mode);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!ownedOrAbsent(path, bytes, mode))
        throw new Error(
          "Command path changed during setup. Retry the installation.",
          { cause: error },
        );
    }
  } finally {
    unlinkSync(temporary);
    syncDirectory(dirname(path));
  }
}

export function windowsSearchConfig(): { path: string; extensions: string } {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !isAbsolute(systemRoot))
    throw new Error("Cannot inspect Windows command search paths.");
  const powershellHome = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
  );
  // Establish the matching system modules before PowerShell initializes. A
  // managed child has a reduced environment; a PowerShell 7 parent may instead
  // supply incompatible modules. Neither should affect command collision checks.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !["psmodulepath", "winpsmodulepath"].includes(key.toLowerCase()),
    ),
  );
  environment.PSModulePath = join(powershellHome, "Modules");
  environment.WinPSModulePath = environment.PSModulePath;
  const result = spawnSync(
    join(powershellHome, "powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $env:PSModulePath=[System.IO.Path]::Combine($PSHOME,'Modules'); [pscustomobject]@{path=[Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine')); extensions=([Environment]::GetEnvironmentVariable('PATHEXT','User')+';'+[Environment]::GetEnvironmentVariable('PATHEXT','Machine'))} | ConvertTo-Json -Compress",
    ],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      env: environment,
    },
  );
  if (result.status !== 0)
    throw new Error(
      `Cannot inspect Windows command search paths (${(result.error as NodeJS.ErrnoException | undefined)?.code ?? `exit ${result.status ?? "unknown"}`}).`,
    );
  const config: unknown = JSON.parse(result.stdout);
  if (
    !config ||
    typeof config !== "object" ||
    !("path" in config) ||
    typeof config.path !== "string" ||
    !("extensions" in config) ||
    typeof config.extensions !== "string"
  )
    throw new Error("Invalid Windows command search configuration.");
  return { path: config.path, extensions: config.extensions };
}

/** Inspect without executing or sourcing any user command/profile. */
export function checkCommandPath(root: string, expected: string): void {
  const windows = process.platform === "win32";
  const bin = join(root, "bin");
  const command = windows ? "thr.cmd" : "thr";
  const registered = windows ? windowsSearchConfig() : undefined;
  const directories = new Set(
    [
      bin,
      process.env.PATH ?? "",
      ...(registered ? [registered.path, process.cwd()] : []),
    ]
      .join(windows ? ";" : ":")
      .split(windows ? ";" : ":")
      .map((p) => resolve(p.replace(/^"|"$/g, ""))),
  );
  const suffixes = new Set([
    "",
    ".cmd",
    ".exe",
    ".com",
    ".bat",
    ".ps1",
    ".vbs",
    ".vbe",
    ".js",
    ".jse",
    ".wsf",
    ".wsh",
    ".msc",
    ...(registered?.extensions ?? "").toLowerCase().split(";"),
    ...(process.env.PATHEXT ?? "").toLowerCase().split(";"),
  ]);
  for (const directory of directories) {
    let names: string[];
    try {
      names = windows
        ? readdirSync(directory).filter(
            (n) =>
              n.toLowerCase().startsWith("thr") &&
              suffixes.has(n.slice(3).toLowerCase()),
          )
        : ["thr"];
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        continue;
      throw error;
    }
    for (const name of names) {
      const file = join(directory, name),
        stat = statIfPresent(file);
      if (!stat) continue;
      // Ignore non-executable POSIX regular files: shells cannot resolve them.
      if (!windows && stat.isFile() && (stat.mode & 0o111) === 0) continue;
      const ownDirectory =
        statIfPresent(bin) && realpathSync(directory) === realpathSync(bin);
      if (
        ownDirectory &&
        name.toLowerCase() === command &&
        ownedOrAbsent(file, expected)
      )
        continue;
      conflict(file);
    }
  }
}

function commandContext(root: string, runtimeExecutable?: string) {
  root = privateDirectory(root);
  const metadata = join(root, "shim-runtime.json");
  const hasSaved = Boolean(statIfPresent(metadata));
  const saved = hasSaved
    ? (readJsonFile(metadata) as {
        protocol?: unknown;
        runtimeExecutable?: unknown;
      })
    : undefined;
  if (
    hasSaved &&
    (!saved ||
      saved.protocol !== 1 ||
      typeof saved.runtimeExecutable !== "string" ||
      !isAbsolute(saved.runtimeExecutable))
  )
    throw new Error("Invalid managed dispatcher runtime.");
  const interpreter = saved
    ? (saved.runtimeExecutable as string)
    : (runtimeExecutable ?? process.execPath);
  const bin = join(root, "bin"),
    dispatcher = join(bin, "command.mjs");
  const source = launcherSource(interpreter, dispatcher);
  return {
    root,
    metadata,
    saved,
    interpreter,
    bin,
    dispatcher,
    source,
    command: join(bin, process.platform === "win32" ? "thr.cmd" : "thr"),
    alias: join(bin, process.platform === "win32" ? "ontrack.cmd" : "ontrack"),
  };
}

/** No selection, profile or shared launcher state is changed by preflight. */
export function preflightCommands(
  root: string,
  runtimeExecutable?: string,
): void {
  const c = commandContext(root, runtimeExecutable);
  if (statIfPresent(c.bin)) privateDirectory(c.bin);
  ownedOrAbsent(c.dispatcher, dispatcherSource(c.root));
  ownedOrAbsent(c.alias, c.source);
  ownedOrAbsent(c.command, c.source);
  checkCommandPath(c.root, c.source);
}

/** Prepare new/adopted roots before activation; existing dispatcher bytes stay intact. */
export function prepareCommands(
  root: string,
  runtimeExecutable?: string,
): string {
  preflightCommands(root, runtimeExecutable);
  const c = commandContext(root, runtimeExecutable);
  privateDirectory(c.bin);
  if (!c.saved)
    writeJsonFile(c.metadata, {
      protocol: 1,
      runtimeExecutable: c.interpreter,
    });
  createOwned(c.dispatcher, dispatcherSource(c.root), 0o600);
  createOwned(c.alias, c.source, 0o700);
  createOwned(c.command, c.source, 0o700);
  return c.command;
}

/** Called only during authenticated, uncommitted activation. No profile writes. */
export function provisionPrimaryCommand(root: string): void {
  const c = commandContext(root);
  if (
    !c.saved ||
    !ownedOrAbsent(c.dispatcher, dispatcherSource(c.root)) ||
    !ownedOrAbsent(c.alias, c.source)
  )
    throw new Error(
      "Managed dispatcher is missing. Rerun the threadstr installer in the same runtime root.",
    );
  preflightCommands(root);
  createOwned(c.command, c.source, 0o700);
}
