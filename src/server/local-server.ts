import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { buildApp } from "./app.js";
import { resolveDataDirectory } from "./data-directory.js";
import { MaintenanceGate } from "./database-transfer/maintenance-gate.js";
import type { NativeFileActions } from "./native-file-actions.js";
import { openDatabaseAfterRestoreRecovery } from "./startup-database.js";
import { acquireInstanceOwner } from "./runtime/instance-owner.js";
import {
  startManagedControl,
  type ManagedLaunch,
} from "./runtime/managed-server.js";
import { describeRuntime } from "./runtime/build-info.js";
import { assertUpdateStartupAllowed } from "./runtime/update-maintenance.js";

export async function startLocalServer(
  options: {
    nativeFileActions?: NativeFileActions;
    managed?: ManagedLaunch;
    beforeDatabaseOpen?: (dataDirectory: string) => void | Promise<void>;
    deferActivation?: boolean;
    drainTimeoutMs?: number;
  } = {},
): Promise<FastifyInstance> {
  const launch = options.managed;
  const port = launch?.port ?? Number(process.env.ON_TRACK_PORT ?? "4173");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("ON_TRACK_PORT must be an integer between 1 and 65535");
  const description = describeRuntime();
  if (
    launch &&
    (launch.buildId !== description.buildId ||
      launch.releaseId !== description.releaseId ||
      launch.version !== description.version)
  )
    throw new Error("Managed launch does not match this application build.");
  const owner = acquireInstanceOwner(
    launch?.dataDirectory ?? resolveDataDirectory(),
  );
  const dataDirectory = owner.dataDirectory;
  const gate = new MaintenanceGate();
  let database: Database.Database | undefined;
  let app: FastifyInstance | undefined;
  let control: Awaited<ReturnType<typeof startManagedControl>> | undefined;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  try {
    const pending = assertUpdateStartupAllowed(dataDirectory, {
      buildId: description.buildId,
      ...(launch
        ? {
            transactionId: launch.updateTransactionId,
            nonce: launch.nonce,
            token: launch.token,
            installRoot: launch.installRoot,
          }
        : {}),
    });
    await options.beforeDatabaseOpen?.(dataDirectory);
    if (options.deferActivation || pending?.state === "candidate_started")
      await gate.freezeAndDrain();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    if (
      pending?.state === "candidate_started" &&
      existsSync(join(dataDirectory, ".on-track-restore-journal.json"))
    )
      throw new Error(
        "Restore recovery must finish before update candidate startup.",
      );
    database = openDatabaseAfterRestoreRecovery<Database.Database>({
      dataDirectory,
      databasePath,
    });
    if (pending?.state === "candidate_started") {
      const version = database
        .prepare("SELECT schema_version FROM app_metadata WHERE id = 1")
        .pluck()
        .get();
      const marker = database
        .prepare("SELECT max(created_at) FROM __drizzle_migrations")
        .pluck()
        .get();
      if (
        version !== pending.candidate.schemaVersion ||
        marker !== pending.candidate.migrationMarker ||
        database.pragma("integrity_check", { simple: true }) !== "ok" ||
        (database.pragma("foreign_key_check") as unknown[]).length !== 0
      )
        throw new Error("Candidate database validation failed.");
    }
    app = buildApp({
      database,
      databasePath,
      dataDirectory,
      nativeFileActions: options.nativeFileActions,
      maintenanceGate: gate,
      onDatabaseClosed: async () => {
        try {
          await control?.close();
        } finally {
          for (const [signal, handler] of signalHandlers)
            process.off(signal, handler);
          owner.release();
        }
      },
    });
    const clientRoot = resolve(process.cwd(), "dist/client");
    if (existsSync(clientRoot)) {
      await app.register(fastifyStatic, { root: clientRoot, wildcard: false });
      app.setNotFoundHandler((request, reply) =>
        request.url.startsWith("/api/")
          ? reply
              .code(404)
              .send({ code: "not_found", message: "Route not found." })
          : reply.sendFile("index.html"),
      );
    }
    await app.listen({ host: "127.0.0.1", port });
    const running = app;
    if (launch)
      control = await startManagedControl({
        launch: { ...launch, dataDirectory },
        gate,
        closeServer: () => running.close(),
        drainTimeoutMs: options.drainTimeoutMs,
      });
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = () => {
        void (async () => {
          try {
            await gate.freezeAndDrain(options.drainTimeoutMs);
            await running.close();
          } catch {
            gate.resume();
            console.error("threadstr is busy; shutdown was not completed.");
          }
        })();
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    console.log(`threadstr is available at http://127.0.0.1:${port}`);
    return app;
  } catch (error) {
    try {
      await app?.close();
    } finally {
      if (database?.open) database.close();
      owner.release();
    }
    throw error;
  }
}
