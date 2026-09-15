import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ensurePrivateDirectory } from "./private-directory.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function protect() {
  const root = mkdtempSync(join(tmpdir(), "ontrack-permission-process-"));
  roots.push(root);
  // Exercise the Windows subprocess boundary on every host without running PowerShell.
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    return ensurePrivateDirectory(root);
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
}
function result(status: number | null, code?: string) {
  return {
    pid: 1,
    status,
    signal: null,
    output: [],
    stdout: "",
    stderr: "private local path and PowerShell output",
    ...(code
      ? { error: Object.assign(new Error("private details"), { code }) }
      : {}),
  } as ReturnType<typeof spawnSync>;
}

it("reports a bounded permission-check timeout without retrying or exposing subprocess output", () => {
  vi.mocked(spawnSync).mockReturnValue(result(null, "ETIMEDOUT"));
  expect(protect).toThrow(
    "Private On Track directory permission check timed out.",
  );
  expect(spawnSync).toHaveBeenCalledTimes(1);
  expect(vi.mocked(spawnSync).mock.calls[0][2]).toMatchObject({
    timeout: 15_000,
    shell: false,
  });
});

it.each([result(1), result(null, "EACCES")])(
  "fails closed on permission or launch errors without exposing subprocess output",
  (failure) => {
    vi.mocked(spawnSync).mockReturnValue(failure);
    expect(protect).toThrow(
      new Error("Could not establish private On Track directory permissions."),
    );
    expect(spawnSync).toHaveBeenCalledTimes(1);
  },
);

it("returns the canonical directory only after a successful permission check", () => {
  vi.mocked(spawnSync).mockReturnValue(result(0));
  expect(protect()).toBe(realpathSync(roots[0]));
});
