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

it("freezes all new operations, drains accepted work, and resumes admission", async () => {
  const gate = new MaintenanceGate();
  const pending = deferred();
  const active = gate.runRead(() => pending.promise);
  const drained = gate.freezeAndDrain(500);
  for (const run of [
    () => gate.runRead(() => 1),
    () => gate.runMutation(() => 1),
    () => gate.runExport(() => 1),
    () => gate.runRestore(() => 1),
  ])
    await expect(run()).rejects.toMatchObject({
      blockingOperation: "maintenance",
    });
  pending.resolve();
  await active;
  await drained;
  gate.resume();
  await expect(gate.runMutation(() => 42)).resolves.toBe(42);
});
it("a drain timeout never releases active work or silently reopens admission", async () => {
  const gate = new MaintenanceGate();
  const pending = deferred();
  const active = gate.runExport(() => pending.promise);
  await expect(gate.freezeAndDrain(1)).rejects.toThrow(/timed out/);
  await expect(gate.runRead(() => 1)).rejects.toThrow(MaintenanceBusyError);
  pending.resolve();
  await active;
  gate.resume();
});

it("drains complete HTTP leases even before domain work has started", async () => {
  const gate = new MaintenanceGate();
  const release = gate.enterRequest();
  let drained = false;
  const pending = gate.freezeAndDrain(500).then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  expect(() => gate.enterRequest()).toThrow(MaintenanceBusyError);
  release();
  release();
  await pending;
  gate.resume();
  const next = gate.enterRequest();
  next();
  await gate.freezeAndDrain(1);
});
