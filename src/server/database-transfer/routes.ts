import type Database from "better-sqlite3";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { chmodSync, createReadStream, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import {
  exportOptionsSchema,
  importOptionsSchema,
  type ImportOptions,
  type ImportResult,
  type ProjectSelection,
} from "../../domain/database-transfer.js";
import type { AttachmentStore } from "../chat-service.js";
import type { ManagedAttachmentStore } from "../attachments/managed-attachment-store.js";
import { MaintenanceGate, MaintenanceBusyError } from "./maintenance-gate.js";
import { ManagedRestoreCoordinator } from "./restore-journal.js";
import {
  stageUpload,
  StagedUploadTooLargeError,
  type StagedUpload,
} from "./staged-upload.js";
import {
  createSqliteBackupBundle,
  prepareSqliteBackupBundle,
  validateSqliteBackupBundle,
  readBackupProjects,
  SqliteBackupBundleValidationError,
  DEFAULT_SQLITE_BACKUP_BUNDLE_LIMITS,
} from "./sqlite-backup-bundle.js";
import { backupDigest, mergePreparedProjects } from "./project-import.js";

interface TransferOptions {
  database: () => Database.Database;
  databasePath?: string;
  dataDirectory?: string;
  attachmentStore?: AttachmentStore & Pick<ManagedAttachmentStore, "read">;
  maintenanceGate: MaintenanceGate;
  reopenDatabase: (path: string) => void;
  oldStoragePaths: () => string[];
  exportDirectoryCleanup: (path: string) => void;
  stagedUploadCleanup: (staged: StagedUpload) => void;
  clock?: () => number;
  idFactory?: () => string;
}
function bestEffort(operation: () => void) {
  try {
    operation();
  } catch {
    /* Completed transfers remain authoritative. */
  }
}
const maximumBytes = DEFAULT_SQLITE_BACKUP_BUNDLE_LIMITS.maximumBundleBytes;

export async function registerDatabaseTransferRoutes(
  app: FastifyInstance,
  options: TransferOptions,
) {
  await app.register(rateLimit, {
    global: false,
    keyGenerator: () => "database-transfer",
    errorResponseBuilder: () => ({
      statusCode: 429,
      code: "rate_limited",
      message: "Database transfer is temporarily rate-limited.",
    }),
  });
  const config = (groupId: string, max: number) => ({
    rateLimit: { groupId, max, timeWindow: 60000 },
  });
  let importing = false;
  function available(reply: FastifyReply): boolean {
    if (
      options.databasePath &&
      options.dataDirectory &&
      options.attachmentStore
    )
      return true;
    void reply.code(501).send({
      code: "unavailable",
      message: "Database transfer is unavailable.",
    });
    return false;
  }
  function invalid(error: unknown, reply: FastifyReply) {
    if (
      error instanceof SqliteBackupBundleValidationError ||
      error instanceof StagedUploadTooLargeError ||
      error instanceof TypeError ||
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error &&
        "code" in error &&
        String(error.code).startsWith("FST_"))
    ) {
      return reply.code(400).send({
        code: "invalid_backup",
        message:
          error instanceof SqliteBackupBundleValidationError
            ? "The selected file is not a valid supported threadstr backup bundle."
            : "Check the backup file and project selection, then preview it again.",
      });
    }
    throw error;
  }
  async function exportBackup(request: FastifyRequest, reply: FastifyReply) {
    if (!available(reply)) return;
    const selection: ProjectSelection =
      request.method === "GET"
        ? "all"
        : exportOptionsSchema.parse(request.body).selection;
    const directory = mkdtempSync(
      join(options.dataDirectory!, ".on-track-export-"),
    );
    chmodSync(directory, 0o700);
    const path = join(directory, "backup.on-track-backup");
    try {
      await options.maintenanceGate.runExport(() =>
        createSqliteBackupBundle({
          sourceDatabase: options.database(),
          destinationPath: path,
          attachmentStore: options.attachmentStore!,
          selection,
        }),
      );
      const stream = createReadStream(path);
      stream.once("close", () =>
        bestEffort(() => options.exportDirectoryCleanup(directory)),
      );
      return reply
        .header("Cache-Control", "no-store")
        .header("Content-Type", "application/vnd.on-track.backup+sqlite")
        .header(
          "Content-Disposition",
          `attachment; filename="threadstr-${new Date().toISOString().slice(0, 10)}.on-track-backup"`,
        )
        .send(stream);
    } catch (error) {
      bestEffort(() => options.exportDirectoryCleanup(directory));
      return invalid(error, reply);
    }
  }
  app.route({
    method: ["GET", "POST"],
    url: "/api/database/export",
    bodyLimit: 1024 * 1024,
    config: config("export", 3),
    handler: exportBackup,
  });

  async function upload(
    request: FastifyRequest,
  ): Promise<{ staged: StagedUpload; input?: ImportOptions }> {
    if (
      request.method !== "POST" ||
      request.routeOptions.url === "/api/database/import/preview"
    ) {
      return {
        staged: await stageUpload(
          options.dataDirectory!,
          request.body as AsyncIterable<Uint8Array>,
          { maximumBytes },
        ),
      };
    }
    let staged: StagedUpload | undefined;
    let input: ImportOptions | undefined;
    try {
      for await (const part of request.parts({
        limits: {
          fileSize: maximumBytes,
          files: 1,
          fields: 1,
          parts: 2,
          fieldSize: 1024 * 1024,
        },
      })) {
        if (part.type === "file") {
          if (part.fieldname !== "file" || staged)
            throw new TypeError("Unexpected file.");
          staged = await stageUpload(options.dataDirectory!, part.file, {
            maximumBytes,
          });
          if (part.file.truncated) throw new TypeError("Truncated backup.");
        } else {
          if (
            part.fieldname !== "options" ||
            input ||
            part.valueTruncated ||
            typeof part.value !== "string"
          )
            throw new TypeError("Invalid options.");
          input = importOptionsSchema.parse(JSON.parse(part.value));
        }
      }
      if (!staged || !input)
        throw new TypeError("Choose a backup and import options.");
      return { staged, input };
    } catch (error) {
      if (staged) bestEffort(() => options.stagedUploadCleanup(staged!));
      throw error;
    }
  }
  async function importBackup(request: FastifyRequest, reply: FastifyReply) {
    if (!available(reply)) return;
    if (importing) throw new MaintenanceBusyError("restore", "restore");
    importing = true;
    let staged: StagedUpload | undefined;
    try {
      const uploaded = await upload(request);
      staged = uploaded.staged;
      const manifest = validateSqliteBackupBundle(staged.filePath);
      const digest = await backupDigest(staged.filePath);
      if (request.raw.aborted || reply.raw.destroyed)
        throw new TypeError("Upload interrupted.");
      reply.header("Cache-Control", "no-store");
      if (request.routeOptions.url === "/api/database/import/preview")
        return reply.send({
          digest,
          projects: readBackupProjects(staged.filePath, manifest.schemaVersion),
        });
      const input = uploaded.input;
      if (input && digest !== input.digest)
        throw new TypeError("Backup changed since preview.");
      const mode = input?.mode ?? "replace";
      const result = await options.maintenanceGate.runRestore(() => {
        const coordinator = new ManagedRestoreCoordinator({
          dataDirectory: options.dataDirectory!,
          databasePath: options.databasePath!,
          closeDatabase: () => {
            options.database().pragma("wal_checkpoint(TRUNCATE)");
            options.database().close();
          },
          openDatabase: options.reopenDatabase,
        });
        const workspace = coordinator.createWorkspace();
        prepareSqliteBackupBundle({
          bundlePath: staged!.filePath,
          workspace,
          selection: input?.selection ?? "all",
        });
        if (mode === "merge") {
          try {
            return mergePreparedProjects({
              database: options.database(),
              candidateDatabasePath: workspace.candidateDatabasePath,
              candidateDataDirectory: workspace.candidateDataDirectory,
              dataDirectory: options.dataDirectory!,
              now: (options.clock ?? Date.now)(),
              idFactory: options.idFactory,
            });
          } finally {
            bestEffort(() =>
              rmSync(workspace.stagingDirectory, {
                recursive: true,
                force: true,
              }),
            );
          }
        }
        const count = readBackupProjects(
          workspace.candidateDatabasePath,
          7,
        ).length;
        const oldPaths = options.oldStoragePaths();
        coordinator.activate(workspace.restoreId);
        for (const path of oldPaths)
          bestEffort(() => {
            options.attachmentStore!.remove(path);
          });
        return { importedCount: count, renames: [] } satisfies ImportResult;
      });
      return request.method === "PUT"
        ? reply.code(204).send()
        : reply.send(result);
    } catch (error) {
      return invalid(error, reply);
    } finally {
      importing = false;
      if (staged) bestEffort(() => options.stagedUploadCleanup(staged!));
    }
  }
  app.post(
    "/api/database/import/preview",
    { config: config("preview", 2), bodyLimit: maximumBytes },
    importBackup,
  );
  app.route({
    method: ["PUT", "POST"],
    url: "/api/database/import",
    config: config("import", 2),
    bodyLimit: maximumBytes + 1024 * 1024 + 65536,
    handler: importBackup,
  });
}
