import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test as base } from "@playwright/test";

interface LocalApp {
  url: string;
  pid(): number;
  restart(): Promise<void>;
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
  const child = spawn(process.execPath, ["dist/server/server/main.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ON_TRACK_DATA_DIR: dataDirectory,
      ON_TRACK_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
        pid: () => server.pid!,
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
