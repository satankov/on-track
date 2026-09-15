import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  requestControl,
  startControlServer,
  type ControlStatus,
} from "./control-server.js";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
it("authenticates nonce and capability before invoking control", async () => {
  const id = randomBytes(16).toString("hex");
  const credentials = {
    endpoint:
      process.platform === "win32"
        ? `\\\\.\\pipe\\ontrack-${id}`
        : join(tmpdir(), `ot-${id}.sock`),
    nonce: id,
    token: randomBytes(32).toString("hex"),
  };
  const commands: string[] = [];
  const status: ControlStatus = {
    state: "ready",
    version: "0.0.9",
    buildId: "abc",
    releaseId: "v0.0.9",
    nonce: id,
    url: "http://127.0.0.1:4173",
  };
  const server = await startControlServer(credentials, async (command) => {
    commands.push(typeof command === "string" ? command : command.command);
    return status;
  });
  closers.push(() => server.close());
  await expect(
    requestControl({ ...credentials, token: "wrong" }, "stop"),
  ).rejects.toThrow(/refused/);
  await expect(
    requestControl({ ...credentials, nonce: "wrong" }, "stop"),
  ).rejects.toThrow(/refused/);
  expect(commands).toEqual([]);
  await expect(requestControl(credentials, "status")).resolves.toEqual(status);
  expect(commands).toEqual(["status"]);
});
