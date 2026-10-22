import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { scheduleWindowsCleanup } from "./uninstall-windows.js";
import type { UninstallPlan } from "./uninstall-plan.js";
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it.skipIf(process.platform === "win32")(
  "starts the helper outside its deletion tree with literal job paths and waits for readiness",
  async () => {
    vi.stubEnv("SystemRoot", "/Windows");
    const plan: UninstallPlan = {
      root: "/runtime with 'quotes'",
      data: "/data",
      app: [],
      dataFiles: [],
      checkpoints: [],
      directories: [],
    };
    vi.mocked(spawn).mockImplementation((_exe, args, options) => {
      const cwd = String(options!.cwd);
      roots.push(cwd);
      expect(cwd).not.toBe(plan.root);
      expect(options).toMatchObject({
        detached: true,
        shell: false,
        stdio: "ignore",
      });
      expect(args).toContain("-File");
      expect(args).not.toContain("-Command");
      const job = JSON.parse(readFileSync(join(cwd, "job.json"), "utf8"));
      expect(job.plan).toEqual(plan);
      expect(job.processes.map((p: { pid: number }) => p.pid)).toEqual([
        process.pid,
        process.ppid,
      ]);
      writeFileSync(join(cwd, "ready"), "ready");
      return Object.assign(new EventEmitter(), { unref: vi.fn() }) as never;
    });
    const receipt = await scheduleWindowsCleanup(
      plan,
      "token",
      "/private/node.exe",
    );
    expect(receipt).toBe(join(roots[0], "result.txt"));
  },
);
it("refuses a missing system PowerShell location", async () => {
  vi.stubEnv("SystemRoot", undefined);
  vi.stubEnv("SYSTEMROOT", undefined);
  await expect(
    scheduleWindowsCleanup({} as UninstallPlan, "token", "node"),
  ).rejects.toThrow(/system PowerShell/);
  expect(spawn).not.toHaveBeenCalled();
});
it.skipIf(process.platform === "win32")(
  "refuses a temporary directory inside an uninstall root",
  async () => {
    vi.stubEnv("SystemRoot", "/Windows");
    await expect(
      scheduleWindowsCleanup(
        { root: realpathSync(tmpdir()), data: "/data" } as UninstallPlan,
        "token",
        "/node",
      ),
    ).rejects.toThrow(/temporary directory outside/);
    expect(spawn).not.toHaveBeenCalled();
  },
);
it.skipIf(process.platform === "win32")(
  "reports a helper spawn failure without claiming completion",
  async () => {
    vi.stubEnv("SystemRoot", "/Windows");
    vi.mocked(spawn).mockImplementation((_exe, _args, options) => {
      roots.push(String(options!.cwd));
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() =>
        child.emit("error", new Error("fixture spawn failure")),
      );
      return child as never;
    });
    await expect(
      scheduleWindowsCleanup(
        { root: "/runtime", data: "/data" } as UninstallPlan,
        "token",
        "/node",
      ),
    ).rejects.toThrow(/did not become ready/);
  },
);
