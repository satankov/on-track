import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MaintenanceGate } from "../database-transfer/maintenance-gate.js";
import { requestControl } from "./control-server.js";
import {
  readInstance,
  startManagedControl,
  type ManagedLaunch,
} from "./managed-server.js";

it("resumes after a busy drain, keeps controls available while frozen, and acknowledges stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "on-track-control-"));
  const gate = new MaintenanceGate();
  let stopped = false;
  let finishShutdown!: () => void;
  const shutdownAllowed = new Promise<void>((resolve) => {
    finishShutdown = resolve;
  });
  const launch: ManagedLaunch = {
    installRoot: join(root, "install"),
    dataDirectory: root,
    port: 4173,
    version: "0.0.9",
    releaseId: "v0.0.9",
    buildId: "a".repeat(64),
    nonce: randomUUID(),
    token: randomBytes(32).toString("hex"),
  };
  const controller = await startManagedControl({
    launch,
    gate,
    drainTimeoutMs: 5,
    closeServer: async () => {
      await shutdownAllowed;
      stopped = true;
    },
  });
  try {
    const instance = readInstance(root)!;
    const release = gate.enterRequest();
    await expect(requestControl(instance, "stop")).rejects.toThrow(/busy/);
    expect(gate.isFrozen).toBe(false);
    expect(stopped).toBe(false);
    release();
    expect((await requestControl(instance, "freeze")).state).toBe(
      "maintenance",
    );
    expect((await requestControl(instance, "status")).state).toBe(
      "maintenance",
    );
    expect((await requestControl(instance, "resume")).state).toBe("ready");
    await expect(requestControl(instance, "activate")).rejects.toThrow(
      /refused/,
    );
    expect((await requestControl(instance, "stop")).state).toBe("stopping");
    // The acknowledgment is flushed before the asynchronous close completes.
    expect(stopped).toBe(false);
    finishShutdown();
    await expect.poll(() => stopped).toBe(true);
  } finally {
    finishShutdown();
    await controller.close();
    rmSync(root, { recursive: true, force: true });
  }
});
