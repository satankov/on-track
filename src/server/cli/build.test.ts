import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { buildEnvironment, buildPreparedSource } from "./build.js";
const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: boundary.spawn,
}));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "threadstr-build-"));
  roots.push(root);
  const runtime = join(root, "node space");
  const source = join(root, "source");
  mkdirSync(source);
  mkdirSync(join(runtime, "bin"), { recursive: true });
  mkdirSync(join(runtime, "lib/node_modules/npm/bin"), { recursive: true });
  for (const path of [
    join(runtime, "bin/node"),
    join(runtime, "node.exe"),
    join(runtime, "lib/node_modules/npm/bin/npm-cli.js"),
  ])
    writeFileSync(path, "");
  mkdirSync(join(runtime, "node_modules/npm/bin"), { recursive: true });
  writeFileSync(join(runtime, "node_modules/npm/bin/npm-cli.js"), "");
  return { root, runtime, source };
}
it("isolates npm configuration and prepends only the private runtime for child builds", () => {
  const f = fixture();
  vi.stubEnv("NODE_OPTIONS", "--require /untrusted");
  vi.stubEnv("npm_config_registry", "https://untrusted.invalid");
  vi.stubEnv("NODE_ENV", "production");
  const env = buildEnvironment(f.runtime, f.root);
  expect(env.NODE_OPTIONS).toBeUndefined();
  expect(env.NODE_ENV).toBeUndefined();
  expect(env.npm_config_registry).toBe("https://registry.npmjs.org/");
  expect(env.npm_config_userconfig).toBe(join(f.root, "npm-user.conf"));
  expect(env.PATH?.split(process.platform === "win32" ? ";" : ":")[0]).toBe(
    process.platform === "win32" ? f.runtime : join(f.runtime, "bin"),
  );
});
it("installs locked development dependencies, builds, and preflights native SQLite with exact private Node and no shell", async () => {
  const f = fixture();
  const calls: Array<{
    file: string;
    args: string[];
    options: Record<string, unknown>;
  }> = [];
  boundary.spawn.mockImplementation((file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
  await buildPreparedSource(f.runtime, f.source, f.root);
  expect(calls).toHaveLength(3);
  expect(calls[0].args.slice(1)).toEqual([
    "ci",
    "--include=dev",
    "--no-audit",
    "--no-fund",
  ]);
  expect(calls[1].args.slice(1)).toEqual(["run", "build"]);
  expect(calls[2].args[0]).toBe("--input-type=module");
  expect(
    calls.every(
      (call) => call.options.shell === false && call.options.cwd === f.source,
    ),
  ).toBe(true);
});
it("stops preparation on dependency failure without running the build", async () => {
  const f = fixture();
  boundary.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 1));
    return child;
  });
  await expect(
    buildPreparedSource(f.runtime, f.source, f.root),
  ).rejects.toThrow(/Preparation failed/);
  expect(boundary.spawn).toHaveBeenCalledTimes(1);
});
