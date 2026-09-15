import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import {
  readActiveRelease,
  readJsonFile,
  writeJsonFile,
} from "../cli/state.js";
import { MaintenanceGate } from "../database-transfer/maintenance-gate.js";
import { startControlServer, type ControlStatus } from "./control-server.js";
import { UpdateJournalStore } from "./update-journal.js";

const launchSchema = z.strictObject({
  installRoot: z.string().refine(isAbsolute),
  releaseId: z.string().regex(/^v\d+\.\d+\.\d+$/),
  version: z.string().min(1),
  buildId: z.string().regex(/^[a-f0-9]{64}$/),
  dataDirectory: z.string().refine(isAbsolute),
  port: z.number().int().min(1).max(65535),
  nonce: z.uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  updateTransactionId: z.uuid().optional(),
});
export type ManagedLaunch = z.infer<typeof launchSchema>;
const instanceSchema = launchSchema.extend({
  protocol: z.literal(1),
  mode: z.literal("managed"),
  endpoint: z.string().min(1).max(4096),
  pid: z.number().int().positive(),
});
export type ManagedInstance = z.infer<typeof instanceSchema>;
const INSTANCE = ".on-track-instance.json";
export function parseManagedLaunch(raw: string): ManagedLaunch {
  if (raw.length > 8192)
    throw new Error("Invalid managed launch configuration.");
  return launchSchema.parse(JSON.parse(raw));
}
export function readInstance(
  dataDirectory: string,
): ManagedInstance | undefined {
  const path = join(dataDirectory, INSTANCE);
  try {
    const stat = lstatSync(path);
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
      throw new Error("On Track instance metadata must be private.");
    return instanceSchema.parse(readJsonFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function startManagedControl(options: {
  launch: ManagedLaunch;
  gate: MaintenanceGate;
  closeServer: () => Promise<void>;
  drainTimeoutMs?: number;
}) {
  const { launch, gate } = options;
  let stopping = false;
  let changing = false;
  const directory =
    process.platform === "win32"
      ? undefined
      : mkdtempSync(join(tmpdir(), "ot-"));
  if (directory) chmodSync(directory, 0o700);
  const endpoint = directory
    ? join(directory, "control.sock")
    : `\\\\.\\pipe\\ontrack-${randomUUID()}`;
  const metadata: ManagedInstance = {
    ...launch,
    protocol: 1,
    mode: "managed",
    endpoint,
    pid: process.pid,
  };
  const status = (): ControlStatus => ({
    state: stopping ? "stopping" : gate.isFrozen ? "maintenance" : "ready",
    version: launch.version,
    buildId: launch.buildId,
    releaseId: launch.releaseId,
    nonce: launch.nonce,
    url: `http://127.0.0.1:${launch.port}`,
    ...(launch.updateTransactionId
      ? { updateTransactionId: launch.updateTransactionId }
      : {}),
  });
  const store = new UpdateJournalStore(launch.dataDirectory);
  let server: Awaited<ReturnType<typeof startControlServer>> | undefined;
  try {
    server = await startControlServer(
      metadata,
      async (request) => {
        if (request === "status") return status();
        if (changing || stopping) throw new Error("Server is busy.");
        changing = true;
        try {
          if (typeof request === "object") {
            const update = request.update;
            if (
              update.installRoot !== launch.installRoot ||
              update.previous.buildId !== launch.buildId ||
              update.previous.releaseId !== launch.releaseId
            )
              throw new Error("Update identity mismatch.");
            try {
              await gate.freezeAndDrain(options.drainTimeoutMs);
            } catch (error) {
              gate.resume();
              throw error;
            }
            try {
              const previous = store.read();
              if (previous) {
                if (
                  previous.state !== "committed" ||
                  previous.candidate.buildId !== launch.buildId
                )
                  throw new Error("Pending update needs recovery.");
                const selected = readActiveRelease(launch.installRoot);
                if (selected.releaseId !== launch.releaseId)
                  throw new Error("Active release mismatch.");
                writeJsonFile(join(launch.installRoot, "last-update.json"), {
                  protocol: 1,
                  transactionId: previous.transactionId,
                  previous: previous.previous,
                  candidate: previous.candidate,
                  checkpoint: previous.checkpoint,
                });
                store.clear(previous.transactionId);
              }
              store.begin(update);
            } catch (error) {
              const remaining = store.read();
              if (
                !remaining ||
                (remaining.state === "committed" &&
                  remaining.candidate.buildId === launch.buildId)
              )
                gate.resume();
              throw error;
            }
          } else if (request === "activate") {
            if (!launch.updateTransactionId)
              throw new Error("No candidate activation pending.");
            const selected = readActiveRelease(launch.installRoot);
            const journal = store.require(launch.updateTransactionId);
            if (
              selected.releaseId !== launch.releaseId ||
              selected.runtimeId !== journal.candidate.runtimeId ||
              journal.candidate.buildId !== launch.buildId
            )
              throw new Error("Candidate selection mismatch.");
            if (journal.state !== "committed")
              store.commit(launch.updateTransactionId);
            gate.resume();
          } else if (request === "resume") {
            const journal = store.read();
            if (journal && journal.state !== "committed")
              throw new Error("Pending update prevents resume.");
            gate.resume();
          } else {
            try {
              await gate.freezeAndDrain(options.drainTimeoutMs);
            } catch (error) {
              gate.resume();
              throw error;
            }
            if (request === "stop") {
              stopping = true;
            }
          }
          return status();
        } finally {
          changing = false;
        }
      },
      (request) => {
        if (request === "stop")
          void options.closeServer().catch(() => {
            process.exitCode = 1;
          });
      },
    );
    if (directory) chmodSync(endpoint, 0o600);
    writeJsonFile(join(launch.dataDirectory, INSTANCE), metadata);
    return {
      async close() {
        await server!.close();
        if (readInstance(launch.dataDirectory)?.nonce === launch.nonce)
          rmSync(join(launch.dataDirectory, INSTANCE));
        if (directory) rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (server) await server.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
