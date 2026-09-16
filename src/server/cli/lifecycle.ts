import type { ControlStatus } from "../runtime/control-server.js";
export interface LifecycleAdapter {
  status(): Promise<ControlStatus | undefined>;
  start(): Promise<ControlStatus>;
  stop(): Promise<void>;
  open(url: string): Promise<void>;
}
export async function runManagedWith(
  adapter: LifecycleAdapter,
  open = true,
): Promise<ControlStatus> {
  const status = (await adapter.status()) ?? (await adapter.start());
  if (status.state !== "ready")
    throw new Error(
      "threadstr is in maintenance. Finish or recover the update first.",
    );
  if (open) {
    try {
      await adapter.open(status.url);
    } catch {
      /* A browser failure must not discard a healthy background server. */
    }
  }
  return status;
}
export async function stopManagedWith(
  adapter: LifecycleAdapter,
): Promise<boolean> {
  if (!(await adapter.status())) return false;
  await adapter.stop();
  return true;
}
