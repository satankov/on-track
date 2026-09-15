export type MaintenanceOperation = "read" | "mutation" | "export" | "restore";

type TransferOperation = Extract<MaintenanceOperation, "export" | "restore">;

export class MaintenanceBusyError extends Error {
  constructor(
    readonly requestedOperation: MaintenanceOperation,
    readonly blockingOperation: MaintenanceOperation | "maintenance",
  ) {
    super(
      `Database access is temporarily unavailable during ${blockingOperation}.`,
    );
    this.name = "MaintenanceBusyError";
  }
}

export class MaintenanceGate {
  private frozen = false;
  private activeRequests = 0;
  private drainListeners = new Set<() => void>();
  private activeReads = 0;
  private activeMutations = 0;
  private activeTransfer: TransferOperation | undefined;

  get isFrozen(): boolean {
    return this.frozen;
  }

  enterRequest(): () => void {
    if (this.frozen) throw new MaintenanceBusyError("read", "maintenance");
    this.activeRequests += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.activeRequests -= 1;
        this.notifyDrain();
      }
    };
  }

  async freezeAndDrain(timeoutMs = 15_000): Promise<void> {
    this.frozen = true;
    if (this.isDrained()) return;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        if (this.isDrained()) {
          clearTimeout(timer);
          this.drainListeners.delete(finish);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        this.drainListeners.delete(finish);
        reject(new Error("Waiting for active operations timed out."));
      }, timeoutMs);
      this.drainListeners.add(finish);
    });
  }

  resume(): void {
    this.frozen = false;
  }
  private isDrained(): boolean {
    return (
      this.activeRequests === 0 &&
      this.activeReads === 0 &&
      this.activeMutations === 0 &&
      !this.activeTransfer
    );
  }
  private notifyDrain(): void {
    for (const notify of this.drainListeners) notify();
  }

  runRead<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    return this.run("read", operation);
  }

  runMutation<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    return this.run("mutation", operation);
  }

  runExport<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    return this.run("export", operation);
  }

  runRestore<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    return this.run("restore", operation);
  }

  private async run<T>(
    requestedOperation: MaintenanceOperation,
    operation: () => T | PromiseLike<T>,
  ): Promise<T> {
    const blockingOperation = this.findBlocker(requestedOperation);
    if (blockingOperation) {
      throw new MaintenanceBusyError(requestedOperation, blockingOperation);
    }

    this.acquire(requestedOperation);
    try {
      return await operation();
    } finally {
      this.release(requestedOperation);
    }
  }

  private findBlocker(
    requestedOperation: MaintenanceOperation,
  ): MaintenanceOperation | "maintenance" | undefined {
    if (this.frozen) return "maintenance";
    if (this.activeTransfer === "restore") return "restore";

    if (requestedOperation === "read") return undefined;
    if (this.activeTransfer === "export") return "export";

    if (requestedOperation === "mutation") return undefined;
    if (this.activeMutations > 0) return "mutation";
    if (requestedOperation === "restore" && this.activeReads > 0) return "read";

    return undefined;
  }

  private acquire(operation: MaintenanceOperation): void {
    if (operation === "read") {
      this.activeReads += 1;
    } else if (operation === "mutation") {
      this.activeMutations += 1;
    } else {
      this.activeTransfer = operation;
    }
  }

  private release(operation: MaintenanceOperation): void {
    if (operation === "read") {
      this.activeReads -= 1;
    } else if (operation === "mutation") {
      this.activeMutations -= 1;
    } else {
      this.activeTransfer = undefined;
    }
    this.notifyDrain();
  }
}
