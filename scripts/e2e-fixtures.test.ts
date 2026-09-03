import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { stopServer } from "../e2e/fixtures.js";

class DelayedExitChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: NodeJS.Signals[] = [];

  constructor(private readonly exitOn: NodeJS.Signals = "SIGKILL") {
    super();
  }

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (signal === this.exitOn) {
      setTimeout(() => {
        this.signalCode = signal;
        this.emit("exit", null, signal);
      }, 1);
    }
    return true;
  }
}

describe("E2E server lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for a force-killed server to exit before resolving", async () => {
    vi.useFakeTimers();
    const fakeChild = new DelayedExitChild();
    let stopped = false;
    const stopping = stopServer(fakeChild as unknown as ChildProcess).then(
      () => {
        stopped = true;
      },
    );

    await vi.advanceTimersByTimeAsync(3_000);

    expect(fakeChild.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(stopped).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(fakeChild.signalCode).toBe("SIGKILL");
  });

  it("cancels the force-kill timer after graceful exit", async () => {
    vi.useFakeTimers();
    const fakeChild = new DelayedExitChild("SIGTERM");
    const stopping = stopServer(fakeChild as unknown as ChildProcess);

    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    await vi.advanceTimersByTimeAsync(3_000);

    expect(fakeChild.signals).toEqual(["SIGTERM"]);
    expect(fakeChild.signalCode).toBe("SIGTERM");
  });

  it("does not signal a process that already exited", async () => {
    const fakeChild = new DelayedExitChild();
    fakeChild.exitCode = 0;

    await stopServer(fakeChild as unknown as ChildProcess);

    expect(fakeChild.signals).toEqual([]);
  });
});
