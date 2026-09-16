import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { describeRuntime } from "../runtime/build-info.js";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import { recoverManagedRestoreBeforeDatabaseOpen } from "../database-transfer/restore-journal.js";
import { managedStatus, startManaged, stopManaged } from "./process.js";
import { recoverManagedUpdate } from "./update.js";
import { defaultInstallRoot, openLocalBrowser } from "./platform.js";
import { installManaged } from "./install.js";
import { updateFromRelease } from "./distribution.js";
import { selectActiveRelease, writeInstallState } from "./state.js";
import { main } from "./main.js";
const journal = vi.hoisted(() => ({ pending: undefined as unknown }));
vi.mock("node:readline/promises", () => ({ createInterface: vi.fn() }));
vi.mock("../runtime/build-info.js", () => ({ describeRuntime: vi.fn() }));
vi.mock("../runtime/instance-owner.js", () => ({
  acquireInstanceOwner: vi.fn(),
}));
vi.mock("../runtime/update-journal.js", () => ({
  UpdateJournalStore: class {
    read() {
      return journal.pending;
    }
  },
}));
vi.mock("../database-transfer/restore-journal.js", () => ({
  recoverManagedRestoreBeforeDatabaseOpen: vi.fn(),
}));
vi.mock("./process.js", () => ({
  managedStatus: vi.fn(),
  startManaged: vi.fn(),
  stopManaged: vi.fn(),
}));
vi.mock("./update.js", () => ({ recoverManagedUpdate: vi.fn() }));
vi.mock("./platform.js", () => ({
  defaultInstallRoot: vi.fn(),
  openLocalBrowser: vi.fn(),
}));
vi.mock("./install.js", () => ({ installManaged: vi.fn() }));
vi.mock("./distribution.js", () => ({ updateFromRelease: vi.fn() }));
let root: string;
let data: string;
let release = vi.fn<() => void>();
let output: MockInstance<typeof console.log>;
let tty: PropertyDescriptor | undefined;
const ready = {
  state: "ready" as const,
  version: "0.0.9",
  releaseId: "v0.0.9",
  buildId: "a".repeat(64),
  nonce: "nonce",
  url: "http://127.0.0.1:4173",
};
beforeEach(() => {
  vi.clearAllMocks();
  journal.pending = undefined;
  tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: false,
  });
  vi.stubEnv("ON_TRACK_DATA_DIR", undefined);
  vi.stubEnv("ON_TRACK_PORT", undefined);
  vi.stubEnv("ON_TRACK_INSTALL_ROOT", undefined);
  root = realpathSync(mkdtempSync(join(tmpdir(), "threadstr-main-")));
  data = join(root, "data");
  mkdirSync(data);
  writeInstallState(root, { protocol: 1, dataDirectory: data, port: 4173 });
  selectActiveRelease(root, {
    protocol: 1,
    releaseId: "v0.0.9",
    runtimeId: "node-v24.16.0-darwin-arm64",
  });
  vi.mocked(defaultInstallRoot).mockReturnValue(root);
  release = vi.fn();
  vi.mocked(acquireInstanceOwner).mockReturnValue({
    dataDirectory: data,
    release,
  });
  vi.mocked(managedStatus).mockResolvedValue(undefined);
  vi.mocked(startManaged).mockResolvedValue(ready);
  vi.mocked(stopManaged).mockResolvedValue(undefined);
  vi.mocked(openLocalBrowser).mockResolvedValue(undefined);
  vi.mocked(recoverManagedUpdate).mockResolvedValue("none");
  vi.mocked(installManaged).mockResolvedValue(undefined);
  vi.mocked(updateFromRelease).mockResolvedValue(undefined);
  output = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  rmSync(root, { recursive: true, force: true });
});
function printed() {
  return output.mock.calls.map((call) => String(call[0])).join("\n");
}
it("shows offline help and manual alternative without touching installation state", async () => {
  await main(["--help", "--root", join(root, "absent")]);
  expect(printed()).toContain("npm run quickstart");
  expect(printed()).toContain("thr update");
  expect(managedStatus).not.toHaveBeenCalled();
  expect(acquireInstanceOwner).not.toHaveBeenCalled();
});
it("provides data-free build identity and delegates initial setup", async () => {
  vi.mocked(describeRuntime).mockReturnValue({
    protocol: 1,
    version: "0.0.9",
    releaseId: "v0.0.9",
    buildId: "a".repeat(64),
    schemaVersion: 7,
    migrationMarker: 100,
  });
  await main(["--describe-runtime"]);
  expect(JSON.parse(printed()).version).toBe("0.0.9");
  await main(["install", "--root", root, "--no-profile"]);
  expect(installManaged).toHaveBeenCalledWith(root, {
    root,
    "no-profile": true,
  });
  expect(acquireInstanceOwner).not.toHaveBeenCalled();
});
it("explains a missing installation and refuses conflicting saved settings", async () => {
  await expect(main(["run", "--root", join(root, "absent")])).rejects.toThrow(
    /installation guide/,
  );
  vi.stubEnv("ON_TRACK_PORT", "9999");
  await expect(main(["status"])).rejects.toThrow(/saved data and port/);
  vi.stubEnv("ON_TRACK_PORT", undefined);
  vi.stubEnv("ON_TRACK_DATA_DIR", join(root, "other"));
  await expect(main(["run"])).rejects.toThrow(/saved data and port/);
  expect(startManaged).not.toHaveBeenCalled();
});
it("reports the saved installed version when stopped and authenticated state when running", async () => {
  vi.stubEnv("ON_TRACK_INSTALL_ROOT", root);
  await main(["--version"]);
  expect(printed()).toContain("threadstr 0.0.9 (managed): stopped");
  vi.mocked(managedStatus).mockResolvedValue({
    ...ready,
    state: "maintenance",
  });
  await main(["status"]);
  expect(printed()).toContain("0.0.9: maintenance");
  expect(printed()).toContain(ready.url);
  expect(acquireInstanceOwner).not.toHaveBeenCalled();
});
it("tails bounded diagnostics and strips terminal escape controls", async () => {
  await main(["logs"]);
  expect(printed()).toContain("No server diagnostics yet");
  output.mockClear();
  const logs = join(root, "logs");
  mkdirSync(logs);
  writeFileSync(
    join(logs, "server.log"),
    "SECRET-PREFIX" + "x".repeat(70_000) + "\u001b[31mfinal\u0000\n",
  );
  await main(["logs"]);
  expect(printed().length).toBeLessThanOrEqual(65536);
  expect(printed()).not.toContain("SECRET-PREFIX");
  expect(printed()).not.toContain("\u001b");
  expect(printed()).not.toContain("\u0000");
  expect(printed()).toContain("final");
  expect(managedStatus).not.toHaveBeenCalled();
});
it("runs with saved settings and no browser when requested, then releases install ownership", async () => {
  vi.stubEnv("ON_TRACK_DATA_DIR", data);
  vi.stubEnv("ON_TRACK_PORT", "4173");
  await main(["run", "--no-open"]);
  expect(recoverManagedUpdate).toHaveBeenCalledWith(root);
  expect(startManaged).toHaveBeenCalledWith(root);
  expect(openLocalBrowser).not.toHaveBeenCalled();
  expect(printed()).toContain("You can close this terminal");
  expect(acquireInstanceOwner).toHaveBeenCalledWith(root, {
    filename: ".on-track-install-owner.sqlite",
  });
  expect(release).toHaveBeenCalledOnce();
});
it("preserves a healthy server on browser failure and surfaces maintenance or startup failure", async () => {
  vi.mocked(managedStatus).mockResolvedValue(ready);
  vi.mocked(openLocalBrowser).mockRejectedValue(new Error("no browser"));
  await main(["run"]);
  expect(startManaged).not.toHaveBeenCalled();
  expect(stopManaged).not.toHaveBeenCalled();
  expect(printed()).toContain(ready.url);
  vi.mocked(managedStatus).mockResolvedValue({
    ...ready,
    state: "maintenance",
  });
  await expect(main(["run"])).rejects.toThrow(/maintenance/);
  vi.mocked(managedStatus).mockResolvedValue(undefined);
  vi.mocked(startManaged).mockRejectedValue(new Error("startup failed"));
  await expect(main(["run"])).rejects.toThrow("startup failed");
  expect(release).toHaveBeenCalledTimes(3);
});
it("gracefully stops only a running managed instance", async () => {
  await main(["stop"]);
  expect(printed()).toContain("already stopped");
  expect(stopManaged).not.toHaveBeenCalled();
  vi.mocked(managedStatus).mockResolvedValue(ready);
  await main(["stop"]);
  expect(stopManaged).toHaveBeenCalledWith(root);
  expect(printed()).toContain("projects remain saved");
  expect(release).toHaveBeenCalledTimes(2);
});
it("performs noninteractive updates only with --yes and sanitizes progress", async () => {
  vi.mocked(updateFromRelease).mockImplementation(
    async (_root, _version, options) => {
      expect(await options.confirm()).toBe(true);
      options.progress?.("\u001bupdated");
    },
  );
  vi.mocked(managedStatus).mockResolvedValue(ready);
  await main(["update", "v0.0.10", "--yes", "--no-open"]);
  expect(updateFromRelease).toHaveBeenCalledWith(
    root,
    "v0.0.10",
    expect.any(Object),
  );
  expect(printed()).not.toContain("\u001b");
  expect(printed()).toContain("Refresh existing browser tabs");
  expect(openLocalBrowser).not.toHaveBeenCalled();
  expect(createInterface).not.toHaveBeenCalled();
  vi.mocked(updateFromRelease).mockImplementation(
    async (_root, _version, options) => {
      await options.confirm();
    },
  );
  await expect(main(["update"])).rejects.toThrow(
    /Noninteractive updates require --yes/,
  );
  expect(release).toHaveBeenCalledTimes(2);
});
it("closes the interactive confirmation and ignores post-update browser failure", async () => {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  const close = vi.fn();
  const question = vi.fn().mockResolvedValue("yes");
  vi.mocked(createInterface).mockReturnValue({ question, close } as never);
  vi.mocked(updateFromRelease).mockImplementation(
    async (_root, _version, options) => {
      expect(await options.confirm()).toBe(true);
    },
  );
  vi.mocked(managedStatus).mockResolvedValue(ready);
  vi.mocked(openLocalBrowser).mockRejectedValue(new Error("no browser"));
  await main(["update"]);
  expect(close).toHaveBeenCalledOnce();
  expect(openLocalBrowser).toHaveBeenCalledWith(ready.url);
  expect(release).toHaveBeenCalledOnce();
});
it("guards import recovery with data ownership and pending-update exclusion", async () => {
  await main(["maintenance-recover-import"]);
  expect(recoverManagedRestoreBeforeDatabaseOpen).toHaveBeenCalledWith({
    dataDirectory: data,
    databasePath: join(data, "on-track.sqlite"),
  });
  expect(release).toHaveBeenCalledOnce();
  journal.pending = { state: "intent" };
  await expect(main(["maintenance-recover-import"])).rejects.toThrow(
    /pending software update/,
  );
  expect(recoverManagedRestoreBeforeDatabaseOpen).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledTimes(2);
});
