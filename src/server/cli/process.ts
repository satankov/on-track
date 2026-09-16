import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describeRuntime } from "../runtime/build-info.js";
import {
  requestControl,
  type ControlStatus,
} from "../runtime/control-server.js";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import { readInstance, type ManagedLaunch } from "../runtime/managed-server.js";
import {
  assertRegularFile,
  managedPaths,
  privateDirectory,
  readActiveRelease,
  readInstallState,
  type ActiveRelease,
} from "./state.js";

export function softwareEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "SystemRoot",
    "COMSPEC",
    "ComSpec",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

export async function managedStatus(
  root: string,
): Promise<ControlStatus | undefined> {
  const state = readInstallState(root);
  const instance = readInstance(state.dataDirectory);
  if (!instance) return undefined;
  if (instance.installRoot !== root)
    throw new Error(
      "This data directory belongs to another threadstr installation. Stop that instance first.",
    );
  try {
    return await requestControl(instance, "status", 2_000);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ECONNREFUSED") return undefined;
    throw error;
  }
}

export async function waitForDataRelease(
  dataDirectory: string,
  timeout = 20_000,
): Promise<void> {
  const end = Date.now() + timeout;
  while (true) {
    try {
      const owner = acquireInstanceOwner(dataDirectory);
      owner.release();
      return;
    } catch (error) {
      if (!/already in use/.test(String(error))) throw error;
      if (Date.now() >= end)
        throw new Error(
          "threadstr is still busy. No process was forcibly stopped.",
          { cause: error },
        );
      await delay(100);
    }
  }
}

export async function stopManaged(root: string): Promise<void> {
  const state = readInstallState(root);
  const status = await managedStatus(root);
  if (!status) return;
  const instance = readInstance(state.dataDirectory);
  if (
    !instance ||
    instance.installRoot !== root ||
    instance.nonce !== status.nonce
  )
    throw new Error("threadstr instance changed. Run status before retrying.");
  await requestControl(instance, "stop");
  await waitForDataRelease(state.dataDirectory);
}

export interface StartOptions {
  selection?: ActiveRelease;
  updateTransactionId?: string;
  credentials?: { nonce: string; token: string };
  timeoutMs?: number;
}
export async function startManaged(
  root: string,
  options: StartOptions = {},
): Promise<ControlStatus> {
  const state = readInstallState(root);
  const selection = options.selection ?? readActiveRelease(root);
  const paths = managedPaths(root, selection);
  for (const file of [paths.node, paths.entry]) assertRegularFile(file);
  const description = describeRuntime(paths.releaseDirectory);
  if (description.releaseId !== selection.releaseId)
    throw new Error("Installed release identity does not match its selection.");
  const credentials = options.credentials ?? {
    nonce: randomUUID(),
    token: randomBytes(32).toString("hex"),
  };
  const launch: ManagedLaunch = {
    installRoot: root,
    releaseId: selection.releaseId,
    version: description.version,
    buildId: description.buildId,
    dataDirectory: state.dataDirectory,
    port: state.port,
    ...credentials,
    ...(options.updateTransactionId
      ? { updateTransactionId: options.updateTransactionId }
      : {}),
  };
  const logs = privateDirectory(join(root, "logs"));
  const logPath = join(logs, "server.log");
  if (existsSync(logPath)) {
    assertRegularFile(logPath);
    if (statSync(logPath).size > 5 * 1024 * 1024) {
      const old = join(logs, "server.previous.log");
      if (existsSync(old)) assertRegularFile(old);
      renameSync(logPath, old);
    }
  }
  const output = openSync(logPath, "a", 0o600);
  let failure: Error | undefined;
  let exited = false;
  const child = spawn(paths.node, [paths.entry], {
    cwd: paths.releaseDirectory,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", output, output],
    env: {
      ...softwareEnvironment(),
      ON_TRACK_DATA_DIR: state.dataDirectory,
      ON_TRACK_PORT: String(state.port),
      ON_TRACK_MANAGED_LAUNCH: JSON.stringify(launch),
    },
  });
  closeSync(output);
  child.once("error", (error) => {
    failure = error;
  });
  child.once("exit", () => {
    exited = true;
  });
  child.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (failure || exited)
      throw new Error("threadstr could not start. Run thr logs for details.", {
        cause: failure,
      });
    const instance = readInstance(state.dataDirectory);
    if (instance?.nonce === launch.nonce) {
      try {
        const status = await requestControl(instance, "status", 1_000);
        if (status.buildId !== launch.buildId)
          throw new Error("Unexpected running build.");
        return status;
      } catch (error) {
        if (
          !["ENOENT", "ECONNREFUSED"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
    await delay(100);
  }
  throw new Error(
    "Startup is taking longer than expected. Use thr status or logs; the process was not killed.",
  );
}
