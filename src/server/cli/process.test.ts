import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeRuntime } from "../runtime/build-info.js";
import { requestControl } from "../runtime/control-server.js";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import { readInstance, type ManagedLaunch } from "../runtime/managed-server.js";
import {
  managedPaths,
  selectActiveRelease,
  writeInstallState,
} from "./state.js";
import {
  managedStatus,
  softwareEnvironment,
  startManaged,
  stopManaged,
  waitForDataRelease,
} from "./process.js";
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn() }));
vi.mock("../runtime/build-info.js", () => ({ describeRuntime: vi.fn() }));
vi.mock("../runtime/control-server.js", () => ({ requestControl: vi.fn() }));
vi.mock("../runtime/instance-owner.js", () => ({
  acquireInstanceOwner: vi.fn(),
}));
vi.mock("../runtime/managed-server.js", () => ({ readInstance: vi.fn() }));
let root: string;
let data: string;
let clock: number;
let child: EventEmitter & {
  unref: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};
let launch: ManagedLaunch | undefined;
const selection = {
  protocol: 1 as const,
  releaseId: "v0.0.9",
  runtimeId: "node-v24.16.0-darwin-arm64",
};
const description = {
  protocol: 1 as const,
  version: "0.0.9",
  releaseId: "v0.0.9",
  buildId: "a".repeat(64),
  schemaVersion: 7,
  migrationMarker: 100,
};
function status() {
  return {
    state: "ready" as const,
    version: description.version,
    releaseId: description.releaseId,
    buildId: description.buildId,
    nonce: launch?.nonce ?? "nonce",
    url: "http://127.0.0.1:4173",
  };
}
function instance() {
  return {
    ...(launch ?? {
      installRoot: root,
      dataDirectory: data,
      port: 4173,
      version: description.version,
      releaseId: description.releaseId,
      buildId: description.buildId,
      nonce: "nonce",
      token: "b".repeat(64),
    }),
    protocol: 1 as const,
    mode: "managed" as const,
    installRoot: root,
    endpoint: "test-ipc",
    pid: 123,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  clock = 0;
  launch = undefined;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.mocked(delay).mockImplementation(async () => {
    clock += 100;
  });
  root = realpathSync(mkdtempSync(join(tmpdir(), "ontrack-process-")));
  data = join(root, "data");
  mkdirSync(data);
  writeInstallState(root, { protocol: 1, dataDirectory: data, port: 4173 });
  selectActiveRelease(root, selection);
  const paths = managedPaths(root, selection);
  for (const file of [paths.node, paths.entry]) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "fixture");
  }
  vi.mocked(describeRuntime).mockReturnValue(description);
  child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
  vi.mocked(spawn).mockImplementation((_node, _args, options) => {
    launch = JSON.parse(options!.env!.ON_TRACK_MANAGED_LAUNCH!);
    return child as never;
  });
  vi.mocked(readInstance).mockImplementation(() =>
    launch ? instance() : undefined,
  );
  vi.mocked(requestControl).mockImplementation(async () => status());
  vi.mocked(acquireInstanceOwner).mockReturnValue({
    dataDirectory: data,
    release: vi.fn(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
it("keeps software child environments free of npm hooks, tokens and Node injection", () => {
  vi.stubEnv("NODE_OPTIONS", "--require bad");
  vi.stubEnv("NPM_TOKEN", "secret");
  vi.stubEnv("npm_config_registry", "https://bad.example");
  vi.stubEnv("PATH", "safe-path");
  const environment = softwareEnvironment();
  expect(environment.PATH).toBe("safe-path");
  expect(environment).not.toHaveProperty("NODE_OPTIONS");
  expect(environment).not.toHaveProperty("NPM_TOKEN");
  expect(environment).not.toHaveProperty("npm_config_registry");
});
it("treats missing or refused metadata as stopped, but refuses a different install owner", async () => {
  expect(await managedStatus(root)).toBeUndefined();
  vi.mocked(readInstance).mockReturnValue({
    ...instance(),
    installRoot: "elsewhere",
  });
  await expect(managedStatus(root)).rejects.toThrow(
    /another On Track installation/,
  );
  expect(requestControl).not.toHaveBeenCalled();
  vi.mocked(readInstance).mockReturnValue(instance());
  for (const code of ["ENOENT", "ECONNREFUSED"]) {
    vi.mocked(requestControl).mockRejectedValueOnce(
      Object.assign(new Error("gone"), { code }),
    );
    expect(await managedStatus(root)).toBeUndefined();
  }
  vi.mocked(requestControl).mockRejectedValueOnce(new Error("unauthenticated"));
  await expect(managedStatus(root)).rejects.toThrow("unauthenticated");
});
it("gracefully stops authenticated ownership and waits for its data lock without killing", async () => {
  vi.mocked(readInstance).mockReturnValue(instance());
  let attempts = 0;
  const release = vi.fn();
  vi.mocked(acquireInstanceOwner).mockImplementation(() => {
    if (attempts++ === 0) throw new Error("already in use");
    return { dataDirectory: data, release };
  });
  await stopManaged(root);
  expect(vi.mocked(requestControl).mock.calls.map((call) => call[1])).toEqual([
    "status",
    "stop",
  ]);
  expect(release).toHaveBeenCalledOnce();
  expect(child.kill).not.toHaveBeenCalled();
});
it("does nothing when stopped and refuses a changed instance before shutdown", async () => {
  await stopManaged(root);
  expect(requestControl).not.toHaveBeenCalled();
  vi.mocked(readInstance)
    .mockReturnValueOnce(instance())
    .mockReturnValueOnce(undefined);
  await expect(stopManaged(root)).rejects.toThrow(/instance changed/);
  expect(vi.mocked(requestControl).mock.calls.map((call) => call[1])).toEqual([
    "status",
  ]);
});
it("reports busy timeout and unrelated ownership failures without forced termination", async () => {
  vi.mocked(acquireInstanceOwner).mockImplementation(() => {
    throw new Error("already in use");
  });
  await expect(waitForDataRelease(data, 50)).rejects.toThrow(
    /No process was forcibly stopped/,
  );
  vi.mocked(acquireInstanceOwner).mockImplementation(() => {
    throw new Error("invalid owner path");
  });
  await expect(waitForDataRelease(data)).rejects.toThrow("invalid owner path");
});
it("launches detached with private logs and waits for matching nonce/build readiness", async () => {
  const result = await startManaged(root, {
    credentials: {
      nonce: "12345678-1234-4234-8234-123456789abc",
      token: "b".repeat(64),
    },
    updateTransactionId: "22345678-1234-4234-8234-123456789abc",
  });
  expect(result).toEqual(status());
  expect(child.unref).toHaveBeenCalledOnce();
  expect(child.kill).not.toHaveBeenCalled();
  const options = vi.mocked(spawn).mock.calls[0][2]!;
  expect(options).toMatchObject({
    cwd: managedPaths(root, selection).releaseDirectory,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", expect.any(Number), expect.any(Number)],
  });
  expect(launch).toMatchObject({
    dataDirectory: data,
    installRoot: root,
    port: 4173,
    updateTransactionId: "22345678-1234-4234-8234-123456789abc",
  });
});
it("ignores stale nonces and retries a startup socket that is not listening yet", async () => {
  let read = 0;
  vi.mocked(readInstance).mockImplementation(() => {
    const current = instance();
    return read++ === 0 ? { ...current, nonce: "old" } : current;
  });
  vi.mocked(requestControl).mockRejectedValueOnce(
    Object.assign(new Error("starting"), { code: "ECONNREFUSED" }),
  );
  await startManaged(root);
  expect(delay).toHaveBeenCalledTimes(2);
  expect(requestControl).toHaveBeenCalledTimes(2);
});
it("rejects build mismatches before spawn or when readiness reports the wrong build", async () => {
  vi.mocked(describeRuntime).mockReturnValueOnce({
    ...description,
    releaseId: "v0.0.8",
  });
  await expect(startManaged(root)).rejects.toThrow(/identity/);
  expect(spawn).not.toHaveBeenCalled();
  vi.mocked(requestControl).mockResolvedValueOnce({
    ...status(),
    buildId: "c".repeat(64),
  });
  await expect(startManaged(root)).rejects.toThrow(/Unexpected running build/);
  expect(child.kill).not.toHaveBeenCalled();
});
it.each(["error", "exit"] as const)(
  "reports early child %s with log guidance",
  async (event) => {
    vi.mocked(readInstance).mockReturnValue(undefined);
    vi.mocked(delay).mockImplementationOnce(async () => {
      clock += 100;
      if (event === "error") child.emit("error", new Error("spawn failed"));
      else child.emit("exit", 1);
    });
    await expect(startManaged(root)).rejects.toThrow(/ontrack logs/);
    expect(child.kill).not.toHaveBeenCalled();
  },
);
it("reports startup timeout while preserving a potentially live server", async () => {
  vi.mocked(readInstance).mockReturnValue(undefined);
  await expect(startManaged(root, { timeoutMs: 50 })).rejects.toThrow(
    /process was not killed/,
  );
  expect(child.kill).not.toHaveBeenCalled();
});
it("rotates bounded logs before launching without exposing previous contents", async () => {
  const logs = join(root, "logs");
  mkdirSync(logs);
  writeFileSync(join(logs, "server.log"), "x".repeat(5 * 1024 * 1024 + 1));
  writeFileSync(join(logs, "server.previous.log"), "old");
  await startManaged(root);
  expect(readFileSync(join(logs, "server.log"), "utf8")).toBe("");
  expect(readFileSync(join(logs, "server.previous.log")).length).toBe(
    5 * 1024 * 1024 + 1,
  );
});

it.each([
  { nonce: "different-instance" },
  { installRoot: "/another-installation" },
])(
  "refuses to stop metadata that changes after status authentication: %j",
  async (changed) => {
    const original = { ...instance(), nonce: "nonce" };
    vi.mocked(readInstance)
      .mockReturnValueOnce(original)
      .mockReturnValueOnce({ ...original, ...changed });
    await expect(stopManaged(root)).rejects.toThrow(/instance changed/);
    expect(vi.mocked(requestControl).mock.calls.map((call) => call[1])).toEqual(
      ["status"],
    );
  },
);
