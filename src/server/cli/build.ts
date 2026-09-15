import { spawn } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { assertRegularFile, privateDirectory } from "./state.js";

export function buildEnvironment(
  runtimeDirectory: string,
  workspace: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "SYSTEMROOT",
    "ComSpec",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  const bin =
    process.platform === "win32"
      ? runtimeDirectory
      : join(runtimeDirectory, "bin");
  return {
    ...environment,
    PATH: [bin, process.env.PATH ?? ""].join(delimiter),
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_userconfig: join(workspace, "npm-user.conf"),
    npm_config_globalconfig: join(workspace, "npm-global.conf"),
    npm_config_cache: join(workspace, "npm-cache"),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_loglevel: "error",
  };
}

export async function buildPreparedSource(
  runtimeDirectory: string,
  sourceDirectory: string,
  workspace: string,
): Promise<void> {
  privateDirectory(workspace);
  for (const name of ["npm-user.conf", "npm-global.conf"]) {
    const file = join(workspace, name);
    const fd = openSync(file, "wx", 0o600);
    try {
      writeFileSync(fd, "");
    } finally {
      closeSync(fd);
    }
  }
  const node = join(
    runtimeDirectory,
    process.platform === "win32" ? "node.exe" : "bin/node",
  );
  const npm = join(
    runtimeDirectory,
    process.platform === "win32"
      ? "node_modules/npm/bin/npm-cli.js"
      : "lib/node_modules/npm/bin/npm-cli.js",
  );
  assertRegularFile(node);
  assertRegularFile(npm);
  const log = join(workspace, "preparation.log");
  const output = openSync(log, "wx", 0o600);
  async function run(args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(node, args, {
        cwd: sourceDirectory,
        shell: false,
        windowsHide: true,
        env: buildEnvironment(runtimeDirectory, workspace),
        stdio: ["ignore", output, output],
      });
      const timer = setTimeout(
        () => {
          child.kill();
          reject(new Error(`Preparation timed out. See ${log}`));
        },
        15 * 60 * 1000,
      );
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error(`Preparation failed. See ${log}`));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Preparation failed. See ${log}`));
      });
    });
  }
  try {
    await run([npm, "ci", "--include=dev", "--no-audit", "--no-fund"]);
    await run([npm, "run", "build"]);
    await run([
      "--input-type=module",
      "-e",
      "import Database from 'better-sqlite3'; const db = new Database(':memory:'); db.prepare('SELECT 1').get(); db.close();",
    ]);
  } finally {
    closeSync(output);
  }
}
