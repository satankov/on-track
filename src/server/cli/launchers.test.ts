import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  linkSync,
  existsSync,
  chmodSync,
  realpathSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { installCommand } from "./platform.js";
import { randomUUID } from "node:crypto";
import { checkCommandPath } from "./launchers.js";

const roots: string[] = [];
const failures = vi.hoisted(() => ({ write: false, exists: false }));
const windowsSearch = vi.hoisted(() => ({
  registeredPath: undefined as string | undefined,
  output: undefined as string | undefined,
}));
vi.mock("node:child_process", async (original) => {
  const child = await original<typeof import("node:child_process")>();
  return {
    ...child,
    spawnSync: (...args: Parameters<typeof child.spawnSync>) => {
      const [command, arguments_, options] = args;
      if (windowsSearch.registeredPath && Array.isArray(arguments_)) {
        const scriptIndex = arguments_.indexOf("-Command") + 1;
        const script = arguments_[scriptIndex];
        const registeredPath =
          "[Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine'))";
        if (scriptIndex > 0 && script?.includes(registeredPath)) {
          const modified = [...arguments_];
          modified[scriptIndex] =
            "[Console]::OutputEncoding=[System.Text.Encoding]::ASCII; " +
            script.replace(
              registeredPath,
              "'" + windowsSearch.registeredPath.replaceAll("'", "''") + "'",
            );
          const result = child.spawnSync(command, modified, options);
          windowsSearch.output = String(result.stdout);
          return result;
        }
      }
      return child.spawnSync(...args);
    },
  };
});
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    linkSync: (...args: Parameters<typeof fs.linkSync>) => {
      if (failures.exists) {
        failures.exists = false;
        throw Object.assign(new Error("injected race"), { code: "EEXIST" });
      }
      return fs.linkSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (
        failures.write &&
        typeof args[1] === "string" &&
        args[1].startsWith("#!/bin/sh")
      ) {
        failures.write = false;
        fs.writeFileSync(args[0], "partial");
        throw new Error("simulated disk-full write");
      }
      return fs.writeFileSync(...args);
    },
  };
});
function fixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "threadstr-launchers-")),
  );
  roots.push(root);
  return root;
}
afterEach(() => {
  failures.write = false;
  failures.exists = false;
  windowsSearch.registeredPath = undefined;
  windowsSearch.output = undefined;
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test.skipIf(process.platform !== "win32")(
  "detects a registered Unicode PATH collision through real PowerShell serialization",
  () => {
    const root = fixture();
    const directory = join(fixture(), "Команды 日本語 — café");
    mkdirSync(directory);
    const conflictingCommand = join(directory, "thr.exe");
    writeFileSync(conflictingCommand, "unrelated");
    // Substitute only the registry lookup, without changing the user's registry
    // or PATH. The production script and real PowerShell perform serialization.
    windowsSearch.registeredPath = directory;
    expect(() => checkCommandPath(root, "unused")).toThrow(conflictingCommand);
    expect(JSON.parse(windowsSearch.output!).path).toBe(directory);
    expect(readFileSync(conflictingCommand, "utf8")).toBe("unrelated");
  },
);

test.skipIf(process.platform === "win32")(
  "retries a failed launcher write without leaving a partial command",
  async () => {
    const root = fixture();
    failures.write = true;
    await expect(installCommand(root, { noProfile: true })).rejects.toThrow(
      /disk-full/,
    );
    await expect(installCommand(root, { noProfile: true })).resolves.toBe(
      join(root, "bin", "thr"),
    );
  },
);
test.skipIf(process.platform === "win32")(
  "repairs execute permission only for a byte-verified owned launcher",
  async () => {
    const root = fixture();
    const command = await installCommand(root, { noProfile: true });
    chmodSync(command, 0o600);
    await installCommand(root, { noProfile: true });
    expect(statSync(command).mode & 0o777).toBe(0o700);
  },
);
test("recovers interrupted no-clobber publication without accepting arbitrary hardlinks", async () => {
  const root = fixture();
  const command = await installCommand(root, { noProfile: true });
  linkSync(command, command + ".thr-stage-" + randomUUID());
  await expect(installCommand(root, { noProfile: true })).resolves.toBe(
    command,
  );
  expect(statSync(command).nlink).toBe(1);
  linkSync(command, join(root, "unrelated-link"));
  await expect(installCommand(root, { noProfile: true })).rejects.toThrow(
    /conflict|unsafe/i,
  );
  expect(existsSync(join(root, "unrelated-link"))).toBe(true);
});
test("installs thr as primary and preserves ontrack as an identical dispatcher alias", async () => {
  const root = fixture();
  const command = await installCommand(root, { noProfile: true });
  expect(basename(command)).toBe(
    process.platform === "win32" ? "thr.cmd" : "thr",
  );
  const old = join(
    root,
    "bin",
    process.platform === "win32" ? "ontrack.cmd" : "ontrack",
  );
  expect(readFileSync(old, "utf8")).toBe(readFileSync(command, "utf8"));
  const before = readFileSync(join(root, "shim-runtime.json"));
  await installCommand(root, { noProfile: true });
  expect(readFileSync(join(root, "shim-runtime.json"))).toEqual(before);
});
test.each([null, false, {}, { protocol: 2, runtimeExecutable: "/missing" }])(
  "refuses malformed saved dispatcher state %j",
  async (value) => {
    const root = fixture();
    const path = join(root, "shim-runtime.json");
    writeFileSync(path, JSON.stringify(value));
    await expect(installCommand(root, { noProfile: true })).rejects.toThrow(
      /dispatcher/,
    );
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(value);
  },
);
test("does not report success if an EEXIST target disappears before validation", async () => {
  const root = fixture();
  failures.exists = true;
  await expect(installCommand(root, { noProfile: true })).rejects.toThrow(
    /changed.*Retry/,
  );
  await expect(installCommand(root, { noProfile: true })).resolves.toMatch(
    /thr(?:\.cmd)?$/,
  );
});
test.skipIf(process.platform === "win32")(
  "new launchers remain executable with a restrictive umask",
  async () => {
    const root = fixture();
    const original = process.umask(0o077);
    try {
      const command = await installCommand(root, { noProfile: true });
      expect(statSync(command).mode & 0o777).toBe(0o700);
    } finally {
      process.umask(original);
    }
  },
);
test
  .skipIf(process.platform !== "win32")
  .each(["thr.exe", "THR.COM", "thr.ps1", "thr.VBS", "thr.JS"])(
  "rejects destination %s before adding runtime bin to PATH",
  async (filename) => {
    const root = fixture();
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", filename), "unrelated");
    await expect(installCommand(root, { noProfile: true })).rejects.toThrow(
      /conflict/i,
    );
    expect(readFileSync(join(root, "bin", filename), "utf8")).toBe("unrelated");
  },
);
test.each(["file", "symlink", "dangling", "hardlink", "directory"])(
  "refuses an unrelated %s at the command target before overwriting anything",
  async (kind) => {
    const root = fixture();
    mkdirSync(join(root, "bin"));
    const command = join(
      root,
      "bin",
      process.platform === "win32" ? "thr.cmd" : "thr",
    );
    const other = join(root, "other");
    writeFileSync(other, "unrelated");
    if (kind === "directory") mkdirSync(command);
    else if (kind === "symlink" || kind === "dangling")
      symlinkSync(kind === "dangling" ? join(root, "missing") : other, command);
    else if (kind === "hardlink") linkSync(other, command);
    else writeFileSync(command, "unrelated");
    await expect(installCommand(root, { noProfile: true })).rejects.toThrow(
      /conflict|unsafe/i,
    );
    expect(readFileSync(other, "utf8")).toBe("unrelated");
    expect(existsSync(join(root, "shim-runtime.json"))).toBe(false);
  },
);
test("does not shadow an unrelated PATH command even when runtime bin precedes it", async () => {
  const root = fixture(),
    other = fixture();
  writeFileSync(
    join(other, process.platform === "win32" ? "thr.exe" : "thr"),
    "unrelated",
    { mode: 0o700 },
  );
  vi.stubEnv(
    "PATH",
    [join(root, "bin"), other, process.env.PATH ?? ""].join(
      process.platform === "win32" ? ";" : ":",
    ),
  );
  await expect(installCommand(root, { noProfile: true })).rejects.toThrow(
    /conflict/i,
  );
  expect(existsSync(join(root, "bin", "thr"))).toBe(false);
});
