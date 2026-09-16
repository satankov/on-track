import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MaintenanceGate } from "../database-transfer/maintenance-gate.js";
import { requestControl } from "./control-server.js";
import { prepareCommands } from "../cli/launchers.js";
import { selectActiveRelease } from "../cli/state.js";
import { UpdateJournalStore } from "./update-journal.js";
import {
  readInstance,
  startManagedControl,
  type ManagedLaunch,
} from "./managed-server.js";

it.each([false, true])(
  "provisions primary command before activation commit (collision=%s)",
  async (collision) => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "threadstr-activation-")),
    );
    const installRoot = join(root, "install"),
      dataDirectory = join(root, "data");
    const primary = prepareCommands(installRoot);
    rmSync(primary);
    if (collision) writeFileSync(primary, "unrelated");
    const previousBytes = [
      "shim-runtime.json",
      "bin/command.mjs",
      process.platform === "win32" ? "bin/ontrack.cmd" : "bin/ontrack",
    ].map((p) => [p, readFileSync(join(installRoot, p))] as const);
    const transactionId = randomUUID(),
      runtimeId = "node-v24.14.0-darwin-arm64";
    const candidate = {
      releaseId: "v0.0.9",
      runtimeId,
      buildId: "a".repeat(64),
      schemaVersion: 7,
      migrationMarker: 1,
    };
    const launch: ManagedLaunch = {
      installRoot,
      dataDirectory,
      port: 4173,
      version: "0.0.9",
      releaseId: candidate.releaseId,
      buildId: candidate.buildId,
      nonce: randomUUID(),
      token: "b".repeat(64),
      updateTransactionId: transactionId,
    };
    const store = new UpdateJournalStore(dataDirectory);
    store.begin({
      transactionId,
      installRoot,
      previous: { ...candidate, releaseId: "v0.0.8" },
      candidate,
      candidateCredentials: { nonce: launch.nonce, token: launch.token },
    });
    store.markCheckpointReady(transactionId, {
      transactionId,
      sha256: "c".repeat(64),
      size: 1,
      schemaVersion: 7,
      migrationMarker: 1,
    });
    store.markCandidateStarted(transactionId);
    selectActiveRelease(installRoot, {
      protocol: 1,
      releaseId: candidate.releaseId,
      runtimeId,
    });
    const gate = new MaintenanceGate();
    await gate.freezeAndDrain();
    const controller = await startManagedControl({
      launch,
      gate,
      closeServer: async () => {},
    });
    try {
      const instance = readInstance(dataDirectory)!;
      if (collision) {
        await expect(requestControl(instance, "activate")).rejects.toThrow();
        expect(store.require(transactionId).state).toBe("candidate_started");
        expect(gate.isFrozen).toBe(true);
        expect(readFileSync(primary, "utf8")).toBe("unrelated");
      } else {
        expect((await requestControl(instance, "activate")).state).toBe(
          "ready",
        );
        expect(existsSync(primary)).toBe(true);
        expect(store.require(transactionId).state).toBe("committed");
        // A lost acknowledgment must not repeat provisioning after commit.
        writeFileSync(primary, "changed after commit");
        expect((await requestControl(instance, "activate")).state).toBe(
          "ready",
        );
        expect(readFileSync(primary, "utf8")).toBe("changed after commit");
      }
      for (const [p, bytes] of previousBytes)
        expect(readFileSync(join(installRoot, p))).toEqual(bytes);
    } finally {
      await controller.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("resumes after a busy drain, keeps controls available while frozen, and acknowledges stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "threadstr-control-"));
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
