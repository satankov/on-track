import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensurePrivateDirectory } from "./private-directory.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));
const roots: string[] = [];
const systemRoot = join(tmpdir(), "threadstr-system-root");
beforeEach(() => vi.stubEnv("SystemRoot", systemRoot));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function protect() {
  const root = mkdtempSync(join(tmpdir(), "threadstr-permission-process-"));
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
    "Private threadstr directory permission check timed out.",
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
      new Error("Could not establish private threadstr directory permissions."),
    );
    expect(spawnSync).toHaveBeenCalledTimes(1);
  },
);

it("returns the canonical directory only after a successful permission check", () => {
  vi.mocked(spawnSync).mockReturnValue(result(0));
  expect(protect()).toBe(realpathSync(roots[0]));
});

it("isolates the system PowerShell module paths before permission-helper startup", () => {
  vi.stubEnv("pSmOdUlEpAtH", "/incompatible/powershell/modules");
  vi.stubEnv("WinPSModulePath", "/incompatible/windows/modules");
  vi.mocked(spawnSync).mockReturnValue(result(0));
  expect(protect()).toBe(realpathSync(roots[0]));
  const home = join(systemRoot, "System32", "WindowsPowerShell", "v1.0");
  const [executable, , options] = vi.mocked(spawnSync).mock.calls[0];
  expect(executable).toBe(join(home, "powershell.exe"));
  expect(options?.env).toMatchObject({
    PSModulePath: join(home, "Modules"),
    WinPSModulePath: join(home, "Modules"),
    ON_TRACK_PRIVATE_DIRECTORY: roots[0],
  });
  expect(
    Object.keys(options?.env ?? {}).filter((key) =>
      ["psmodulepath", "winpsmodulepath"].includes(key.toLowerCase()),
    ),
  ).toEqual(["PSModulePath", "WinPSModulePath"]);
});

it.each([undefined, "relative"])(
  "fails closed before launching with an unsafe system root: %s",
  (root) => {
    vi.stubEnv("SystemRoot", root);
    vi.stubEnv("SYSTEMROOT", root);
    vi.mocked(spawnSync).mockReturnValue(result(0));
    expect(protect).toThrow(
      "Could not locate the system Windows PowerShell installation.",
    );
    expect(spawnSync).not.toHaveBeenCalled();
  },
);
