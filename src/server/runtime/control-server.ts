import type { BeginUpdate } from "./update-journal.js";
import { timingSafeEqual } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";

export type ControlCommand =
  "status" | "stop" | "freeze" | "resume" | "activate";
export type ControlRequest =
  ControlCommand | { command: "prepare-update"; update: BeginUpdate };
export interface ControlCredentials {
  endpoint: string;
  nonce: string;
  token: string;
}
export interface ControlStatus {
  state: "ready" | "maintenance" | "stopping";
  version: string;
  buildId: string;
  releaseId: string;
  nonce: string;
  url: string;
  updateTransactionId?: string;
}
const COMMANDS = new Set(["status", "stop", "freeze", "resume", "activate"]);
const LIMIT = 8192;
function matches(left: unknown, right: string): boolean {
  return (
    typeof left === "string" &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export async function startControlServer(
  credentials: ControlCredentials,
  handle: (command: ControlRequest) => Promise<ControlStatus>,
  afterResponse?: (command: ControlRequest) => void,
) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.setTimeout(20_000, () => socket.destroy());
    let received = Buffer.alloc(0);
    let handled = false;
    socket.on("data", (chunk) => {
      if (handled) return;
      received = Buffer.concat([received, chunk]);
      if (received.length > LIMIT) {
        handled = true;
        socket.destroy();
        return;
      }
      const newline = received.indexOf(10);
      if (newline < 0) return;
      handled = true;
      void (async () => {
        try {
          const input = JSON.parse(
            received.subarray(0, newline).toString("utf8"),
          );
          if (
            !matches(input.nonce, credentials.nonce) ||
            !matches(input.token, credentials.token) ||
            (!COMMANDS.has(input.command) && input.command !== "prepare-update")
          )
            throw new Error("Invalid control request.");
          const command: ControlRequest =
            input.command === "prepare-update"
              ? { command: "prepare-update", update: input.update }
              : input.command;
          const result = await handle(command);
          socket.end(JSON.stringify({ ok: true, result }) + "\n", () =>
            afterResponse?.(command),
          );
        } catch {
          socket.end(
            JSON.stringify({
              ok: false,
              error: "Control request refused or the server is busy.",
            }) + "\n",
          );
        }
      })();
    });
  });
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(credentials.endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export async function requestControl(
  credentials: ControlCredentials,
  command: ControlRequest,
  timeoutMs = 20_000,
): Promise<ControlStatus> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(credentials.endpoint);
    let received = Buffer.alloc(0);
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () =>
      fail(new Error("threadstr control request timed out.")),
    );
    socket.on("error", fail);
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({
          nonce: credentials.nonce,
          token: credentials.token,
          ...(typeof command === "string" ? { command } : command),
        }) + "\n",
      ),
    );
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length > LIMIT) {
        fail(new Error("Invalid control response."));
        return;
      }
      const newline = received.indexOf(10);
      if (newline < 0) return;
      try {
        const response = JSON.parse(
          received.subarray(0, newline).toString("utf8"),
        );
        if (!response.ok || response.result?.nonce !== credentials.nonce)
          throw new Error("Control request refused or the server is busy.");
        resolve(response.result);
        socket.destroy();
      } catch (error) {
        fail(error as Error);
      }
    });
    socket.on("end", () => {
      if (received.indexOf(10) < 0)
        fail(new Error("threadstr control connection closed."));
    });
  });
}
