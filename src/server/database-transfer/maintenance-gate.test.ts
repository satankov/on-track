import { describe, expect, it } from "vitest";

import { MaintenanceBusyError, MaintenanceGate } from "./maintenance-gate.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("database transfer maintenance gate", () => {
  it("allows reads while an export is active", async () => {
    const gate = new MaintenanceGate();
    const release = deferred();
    const exporting = gate.runExport(() => release.promise);

    await expect(gate.runRead(() => "snapshot read")).resolves.toBe(
      "snapshot read",
    );

    release.resolve();
    await exporting;
  });

  it("blocks mutations and a second transfer while export is active", async () => {
    const gate = new MaintenanceGate();
    const release = deferred();
    const exporting = gate.runExport(() => release.promise);

    await expect(gate.runMutation(() => undefined)).rejects.toMatchObject({
      name: "MaintenanceBusyError",
      requestedOperation: "mutation",
      blockingOperation: "export",
    });
    await expect(gate.runExport(() => undefined)).rejects.toMatchObject({
      requestedOperation: "export",
      blockingOperation: "export",
    });
    await expect(gate.runRestore(() => undefined)).rejects.toMatchObject({
      requestedOperation: "restore",
      blockingOperation: "export",
    });

    release.resolve();
    await exporting;
  });

  it("blocks every other access while restore is active", async () => {
    const gate = new MaintenanceGate();
    const release = deferred();
    const restoring = gate.runRestore(() => release.promise);

    for (const [requestedOperation, operation] of [
      ["read", () => gate.runRead(() => undefined)],
      ["mutation", () => gate.runMutation(() => undefined)],
      ["export", () => gate.runExport(() => undefined)],
      ["restore", () => gate.runRestore(() => undefined)],
    ] as const) {
      await expect(operation()).rejects.toMatchObject({
        requestedOperation,
        blockingOperation: "restore",
      });
    }

    release.resolve();
    await restoring;
  });

  it("does not begin export or restore over incompatible active work", async () => {
    const gate = new MaintenanceGate();
    const releaseRead = deferred();
    const reading = gate.runRead(() => releaseRead.promise);

    await expect(gate.runRestore(() => undefined)).rejects.toMatchObject({
      requestedOperation: "restore",
      blockingOperation: "read",
    });

    releaseRead.resolve();
    await reading;

    const releaseMutation = deferred();
    const mutating = gate.runMutation(() => releaseMutation.promise);

    await expect(gate.runExport(() => undefined)).rejects.toMatchObject({
      requestedOperation: "export",
      blockingOperation: "mutation",
    });
    await expect(gate.runRestore(() => undefined)).rejects.toMatchObject({
      requestedOperation: "restore",
      blockingOperation: "mutation",
    });

    releaseMutation.resolve();
    await mutating;
  });

  it("releases leases after synchronous throws and asynchronous rejection", async () => {
    const gate = new MaintenanceGate();

    await expect(
      gate.runExport(() => {
        throw new Error("sync export failure");
      }),
    ).rejects.toThrow("sync export failure");
    await expect(gate.runMutation(() => "after export")).resolves.toBe(
      "after export",
    );

    await expect(
      gate.runRestore(async () => {
        throw new Error("async restore failure");
      }),
    ).rejects.toThrow("async restore failure");
    await expect(gate.runRead(() => "after restore")).resolves.toBe(
      "after restore",
    );
  });

  it("exposes a typed recoverable busy error", async () => {
    const gate = new MaintenanceGate();
    const release = deferred();
    const exporting = gate.runExport(() => release.promise);

    let error: unknown;
    try {
      await gate.runMutation(() => undefined);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MaintenanceBusyError);
    expect((error as MaintenanceBusyError).message).toBe(
      "Database access is temporarily unavailable during export.",
    );

    release.resolve();
    await exporting;
  });
});
