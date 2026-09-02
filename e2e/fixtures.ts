import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test as base } from "@playwright/test";

interface LocalApp {
  url: string;
  dataDirectory: string;
  pid(): number;
  nativeActionReceipts(): NativeActionReceipt[];
  restart(): Promise<void>;
}

export interface NativeActionReceipt {
  action: "open" | "reveal";
  path: string;
  containingDirectory?: string;
}

interface WorkerFixtures {
  localApp: LocalApp;
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    waitForExit(child),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 3_000),
    ),
  ]);
}

async function startServer(
  port: number,
  dataDirectory: string,
): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "e2e/native-actions-server.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ON_TRACK_DATA_DIR: dataDirectory,
        ON_TRACK_PORT: String(port),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => (output += String(chunk)));
  child.stderr?.on("data", (chunk) => (output += String(chunk)));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Local server exited early:\n${output}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return child;
    } catch {
      // The process has not begun listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  await stopServer(child);
  throw new Error(`Timed out waiting for the local server:\n${output}`);
}

export const test = base.extend<Record<string, never>, WorkerFixtures>({
  localApp: [
    async ({ browserName }, use, workerInfo) => {
      void browserName;
      const port = 4_310 + workerInfo.workerIndex;
      const dataDirectory = mkdtempSync(join(tmpdir(), "on-track-e2e-"));
      let server = await startServer(port, dataDirectory);
      const app: LocalApp = {
        url: `http://127.0.0.1:${port}`,
        dataDirectory,
        pid: () => server.pid!,
        nativeActionReceipts: () => readNativeActionReceipts(dataDirectory),
        restart: async () => {
          await stopServer(server);
          server = await startServer(port, dataDirectory);
        },
      };

      try {
        await use(app);
      } finally {
        await stopServer(server);
        rmSync(dataDirectory, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
});

export { expect };

function readNativeActionReceipts(
  dataDirectory: string,
): NativeActionReceipt[] {
  try {
    return readFileSync(
      join(dataDirectory, ".native-action-receipts.jsonl"),
      "utf8",
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => parseNativeActionReceipt(line));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

function parseNativeActionReceipt(line: string): NativeActionReceipt {
  const value: unknown = JSON.parse(line);
  if (
    typeof value !== "object" ||
    value === null ||
    !("action" in value) ||
    (value.action !== "open" && value.action !== "reveal") ||
    !("path" in value) ||
    typeof value.path !== "string" ||
    ("containingDirectory" in value &&
      typeof value.containingDirectory !== "string")
  ) {
    throw new Error("The E2E native action receipt is malformed.");
  }
  return value as NativeActionReceipt;
}
