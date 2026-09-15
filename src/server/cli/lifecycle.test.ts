import { expect, it, vi } from "vitest";
import { runManagedWith, stopManagedWith } from "./lifecycle.js";
const status = {
  state: "ready" as const,
  version: "0.0.9",
  buildId: "a".repeat(64),
  releaseId: "v0.0.9",
  nonce: "instance",
  url: "http://127.0.0.1:4173",
};
function adapter(running = false) {
  return {
    status: vi.fn().mockResolvedValue(running ? status : undefined),
    start: vi.fn().mockResolvedValue(status),
    stop: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined),
  };
}
it("opens the existing matching server without launching twice", async () => {
  const a = adapter(true);
  expect(await runManagedWith(a)).toEqual(status);
  expect(a.start).not.toHaveBeenCalled();
  expect(a.open).toHaveBeenCalledWith(status.url);
});
it("waits for readiness and supports headless starts", async () => {
  const a = adapter();
  expect(await runManagedWith(a, false)).toEqual(status);
  expect(a.start).toHaveBeenCalledOnce();
  expect(a.open).not.toHaveBeenCalled();
});
it("keeps a ready server usable when browser opening fails", async () => {
  const a = adapter();
  a.open.mockRejectedValue(new Error("no browser"));
  expect(await runManagedWith(a)).toEqual(status);
  expect(a.stop).not.toHaveBeenCalled();
});
it("does not report a frozen server as ready", async () => {
  const a = adapter(true);
  a.status.mockResolvedValue({ ...status, state: "maintenance" });
  await expect(runManagedWith(a)).rejects.toThrow(/maintenance|update/i);
  expect(a.open).not.toHaveBeenCalled();
});
it("makes stop idempotent and propagates a busy failure", async () => {
  const a = adapter();
  expect(await stopManagedWith(a)).toBe(false);
  expect(a.stop).not.toHaveBeenCalled();
  a.status.mockResolvedValue(status);
  a.stop.mockRejectedValue(new Error("busy"));
  await expect(stopManagedWith(a)).rejects.toThrow("busy");
});
