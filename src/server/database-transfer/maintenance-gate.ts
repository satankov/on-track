export type MaintenanceOperation = "read" | "mutation" | "export" | "restore";

type TransferOperation = Extract<MaintenanceOperation, "export" | "restore">;

export class MaintenanceBusyError extends Error {
  constructor(
    readonly requestedOperation: MaintenanceOperation,
    readonly blockingOperation: MaintenanceOperation,
  ) {
    super(
      `Database access is temporarily unavailable during ${blockingOperation}.`,
    );
    this.name = "MaintenanceBusyError";
  }
}

export class MaintenanceGate {
  private activeReads = 0;
  private activeMutations = 0;
  private activeTransfer: TransferOperation | undefined;

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
  ): MaintenanceOperation | undefined {
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
  }
}
