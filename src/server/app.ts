import { createHomeService, type HomeService } from "./home/service.js";
import { registerHomeRoutes } from "./home/routes.js";
import { registerExampleRoutes } from "./examples/routes.js";
import { ArchivedProjectPinError } from "./db/repository.js";
import type Database from "better-sqlite3";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { ZodError } from "zod";

import {
  AttachmentUnavailableError,
  AttachmentOpenBlockedError,
  ChatService,
  InvalidInputError,
  ProjectNotFoundError,
  type AttachmentStore,
} from "./chat-service.js";
import {
  NativeFileActionFailedError,
  NativeFileActionUnsupportedError,
  SystemNativeFileActions,
  type NativeFileActions,
} from "./native-file-actions.js";
import { ManagedAttachmentStore } from "./attachments/managed-attachment-store.js";
import {
  sanitizeAttachmentFilename,
  sanitizeAttachmentMediaType,
} from "./attachment-metadata.js";
import { openDatabase } from "./db/database.js";
import { SqliteChatRepository } from "./db/repository.js";
import {
  MaintenanceBusyError,
  MaintenanceGate,
} from "./database-transfer/maintenance-gate.js";
import { registerDatabaseTransferRoutes } from "./database-transfer/routes.js";
import type { StagedUpload } from "./database-transfer/staged-upload.js";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from "../domain/validation.js";

interface BuildAppOptions {
  homeService?: HomeService;
  database: Database.Database;
  databasePath?: string;
  dataDirectory?: string;
  attachmentStore?: AttachmentStore & Pick<ManagedAttachmentStore, "read">;
  maintenanceGate?: MaintenanceGate;
  onDatabaseClosed?: () => void | Promise<void>;
  exportDirectoryCleanup?: (path: string) => void;
  stagedUploadCleanup?: (staged: StagedUpload) => void;
  idFactory?: () => string;
  clock?: () => number;
  nativeFileActions?: NativeFileActions;
}

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;
const NATIVE_ACTION_RATE_LIMIT_WINDOW_MS = 60_000;
const MULTIPART_BODY_LIMIT_BYTES = 128 * 1024 * 1024;

function isDatabaseTransferRateLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 429 &&
    "code" in error &&
    error.code === "rate_limited"
  );
}

function isNativeActionRateLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 429 &&
    "code" in error &&
    error.code === "native_action_rate_limited"
  );
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: MULTIPART_BODY_LIMIT_BYTES });
  let database = options.database;
  const dataDirectory =
    options.dataDirectory ??
    (options.databasePath ? dirname(options.databasePath) : undefined);
  const attachmentStore =
    options.attachmentStore ??
    (dataDirectory ? new ManagedAttachmentStore(dataDirectory) : undefined);
  const maintenanceGate = options.maintenanceGate ?? new MaintenanceGate();
  const nativeFileActions =
    options.nativeFileActions ?? new SystemNativeFileActions();
  const exportDirectoryCleanup =
    options.exportDirectoryCleanup ??
    ((path: string) => rmSync(path, { recursive: true, force: true }));
  const stagedUploadCleanup =
    options.stagedUploadCleanup ?? ((staged: StagedUpload) => staged.dispose());
  let repository = new SqliteChatRepository(database);
  let service = createService();

  function createService(): ChatService {
    return new ChatService(
      repository,
      options.idFactory,
      options.clock,
      attachmentStore,
      nativeFileActions,
    );
  }

  function reopenDatabase(databasePath: string): void {
    database = openDatabase(databasePath);
    repository = new SqliteChatRepository(database);
    service = createService();
  }

  app.addContentTypeParser(
    ["application/octet-stream", "application/vnd.on-track.backup+sqlite"],
    (_request, payload, done) => done(null, payload),
  );

  void app.register(multipart, {
    limits: {
      fileSize: MAX_ATTACHMENT_BYTES,
      files: MAX_ATTACHMENTS_PER_MESSAGE,
      parts: MAX_ATTACHMENTS_PER_MESSAGE + 4,
    },
  });

  async function parseMultipartNote(request: {
    parts: () => AsyncIterableIterator<
      | {
          type: "file";
          filename?: string;
          mimetype?: string;
          toBuffer: () => Promise<Buffer>;
        }
      | { type: "field"; fieldname: string; value: unknown }
    >;
  }): Promise<{
    body?: string;
    sender?: string | null;
    createdAt?: number;
    keepAttachmentIds?: string[];
    replaceAttachments?: true;
    attachments: {
      filename: string;
      mediaType: string;
      byteSize: number;
      content: Buffer;
    }[];
  }> {
    let body: string | undefined;
    let sender: string | null | undefined;
    let senderSeen = false;
    let createdAt: number | undefined;
    let keepAttachmentIds: string[] | undefined;
    let replaceAttachments: true | undefined;
    const attachments = [];
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const content = await part.toBuffer();
          attachments.push({
            filename: sanitizeAttachmentFilename(part.filename),
            mediaType: sanitizeAttachmentMediaType(part.mimetype),
            byteSize: content.byteLength,
            content,
          });
          continue;
        }
        if (part.fieldname === "body" && typeof part.value === "string") {
          body = part.value.replace(/\r\n?/g, "\n");
        }
        if (part.fieldname === "sender") {
          if (senderSeen || typeof part.value !== "string") {
            throw new InvalidInputError();
          }
          senderSeen = true;
          sender = part.value === "" ? null : part.value;
        }
        if (part.fieldname === "createdAt") {
          const timestamp = Number(part.value);
          if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
            throw new InvalidInputError();
          }
          createdAt = timestamp;
        }
        if (
          part.fieldname === "keepAttachmentIds" &&
          typeof part.value === "string"
        ) {
          (keepAttachmentIds ??= []).push(part.value);
        }
        if (part.fieldname === "replaceAttachments") {
          if (part.value !== "true") throw new InvalidInputError();
          replaceAttachments = true;
        }
      }
    } catch {
      throw new InvalidInputError();
    }
    return {
      body,
      sender,
      createdAt,
      keepAttachmentIds,
      replaceAttachments,
      attachments,
    };
  }

  const requestLeases = new WeakMap<object, () => void>();
  app.addHook("onResponse", async (request) => {
    requestLeases.get(request)?.();
    requestLeases.delete(request);
  });
  app.addHook("onRequestAbort", async (request) => {
    requestLeases.get(request)?.();
    requestLeases.delete(request);
  });

  app.addHook("onRequest", async (request, reply) => {
    reply
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      )
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY");

    if (!request.url.startsWith("/api/")) return;

    if (!request.headers.host || !LOOPBACK_HOST.test(request.headers.host)) {
      return reply.code(421).send({
        code: "invalid_host",
        message: "Request host is not allowed.",
      });
    }

    const origin = request.headers.origin;
    if (origin && !LOOPBACK_ORIGIN.test(origin)) {
      return reply.code(403).send({
        code: "invalid_origin",
        message: "Request origin is not allowed.",
      });
    }
    if (request.url.split("?")[0] !== "/api/health") {
      requestLeases.set(request, maintenanceGate.enterRequest());
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError || error instanceof InvalidInputError) {
      return reply.code(400).send({
        code: "invalid_input",
        message: "Please check the submitted values.",
      });
    }
    if (error instanceof ArchivedProjectPinError) {
      return reply
        .code(409)
        .send({ code: "project_archived", message: error.message });
    }
    if (error instanceof ProjectNotFoundError) {
      return reply
        .code(404)
        .send({ code: "not_found", message: error.message });
    }
    if (error instanceof AttachmentUnavailableError) {
      return reply.code(409).send({
        code: "attachment_unavailable",
        message: error.message,
        status: error.status,
      });
    }
    if (error instanceof AttachmentOpenBlockedError) {
      return reply.code(409).send({
        code: "attachment_open_blocked",
        message: error.message,
      });
    }
    if (error instanceof NativeFileActionUnsupportedError) {
      return reply.code(501).send({
        code: "native_action_unsupported",
        message: error.message,
      });
    }
    if (error instanceof NativeFileActionFailedError) {
      return reply.code(503).send({
        code: "native_action_failed",
        message: error.message,
      });
    }
    if (error instanceof MaintenanceBusyError) {
      return reply.code(503).send({
        code: "maintenance_busy",
        message: error.message,
      });
    }
    if (isDatabaseTransferRateLimitError(error)) {
      return reply.code(429).send({
        code: "rate_limited",
        message: "Database transfer is temporarily rate-limited.",
      });
    }
    if (isNativeActionRateLimitError(error)) {
      return reply.code(429).send({
        code: "native_action_rate_limited",
        message: "Native file actions are temporarily rate-limited.",
      });
    }

    app.log.error(error);
    return reply
      .code(500)
      .send({ code: "internal_error", message: "Something went wrong." });
  });

  registerHomeRoutes(
    app,
    options.homeService ??
      createHomeService({ version: null, platform: process.platform }),
  );

  app.get("/api/health", async () => ({ status: "ok" }));
  void app.register(async (examples) =>
    registerExampleRoutes(examples, {
      database: () => database,
      detail: (id) => service.getChat(id),
      store: attachmentStore,
      gate: maintenanceGate,
      clock: options.clock ?? Date.now,
    }),
  );

  app.get("/api/chats", async () =>
    maintenanceGate.runRead(() => service.listChats()),
  );
  app.post("/api/chats", async (request, reply) => {
    const chat = await maintenanceGate.runMutation(() =>
      service.createChat(request.body),
    );
    return reply.code(201).send(chat);
  });
  app.get<{ Params: { id: string } }>("/api/chats/:id", async (request) =>
    maintenanceGate.runMutation(() => service.getChat(request.params.id)),
  );
  app.patch<{ Params: { id: string } }>("/api/chats/:id", async (request) =>
    maintenanceGate.runMutation(() =>
      service.updateChat(request.params.id, request.body),
    ),
  );
  app.put<{ Params: { id: string } }>(
    "/api/chats/:id/archive",
    async (request) =>
      maintenanceGate.runMutation(() =>
        service.setChatArchived(request.params.id, true),
      ),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/chats/:id/archive",
    async (request) =>
      maintenanceGate.runMutation(() =>
        service.setChatArchived(request.params.id, false),
      ),
  );
  app.put<{ Params: { id: string } }>("/api/chats/:id/pin", async (request) =>
    maintenanceGate.runMutation(() =>
      service.setChatPinned(request.params.id, true),
    ),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/chats/:id/pin",
    async (request) =>
      maintenanceGate.runMutation(() =>
        service.setChatPinned(request.params.id, false),
      ),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/chats/:id",
    async (request, reply) => {
      await maintenanceGate.runMutation(() =>
        service.deleteChat(request.params.id),
      );
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/chats/:id/notes",
    async (request, reply) => {
      if (!request.isMultipart()) throw new InvalidInputError();
      const parsed = await parseMultipartNote(request);
      const note = await maintenanceGate.runMutation(() =>
        service.appendNote(request.params.id, parsed),
      );
      return reply.code(201).send(note);
    },
  );
  app.patch<{ Params: { id: string; noteId: string } }>(
    "/api/chats/:id/notes/:noteId",
    async (request) => {
      if (!request.isMultipart()) throw new InvalidInputError();
      const parsed = await parseMultipartNote(request);
      return maintenanceGate.runMutation(() =>
        service.updateNote(request.params.id, request.params.noteId, parsed),
      );
    },
  );
  app.delete<{ Params: { id: string; noteId: string } }>(
    "/api/chats/:id/notes/:noteId",
    async (request, reply) => {
      await maintenanceGate.runMutation(() =>
        service.deleteNote(request.params.id, request.params.noteId),
      );
      return reply.code(204).send();
    },
  );
  app.put<{ Params: { id: string; noteId: string; label: string } }>(
    "/api/chats/:id/notes/:noteId/labels/:label",
    async (request) =>
      maintenanceGate.runMutation(() =>
        service.setNoteLabel(
          request.params.id,
          request.params.noteId,
          request.params.label,
          true,
        ),
      ),
  );
  app.delete<{ Params: { id: string; noteId: string; label: string } }>(
    "/api/chats/:id/notes/:noteId/labels/:label",
    async (request) =>
      maintenanceGate.runMutation(() =>
        service.setNoteLabel(
          request.params.id,
          request.params.noteId,
          request.params.label,
          false,
        ),
      ),
  );

  void app.register(async (nativeApp) => {
    await nativeApp.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => ({
        statusCode: 429,
        code: "native_action_rate_limited",
        message: "Native file actions are temporarily rate-limited.",
      }),
    });

    async function nativeRequestPreHandler(
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
      const host = request.headers.host;
      const contentType = request.headers["content-type"]?.split(";", 1)[0];
      if (
        !host ||
        request.headers.origin !== `http://${host}` ||
        request.headers["sec-fetch-site"] !== "same-origin" ||
        request.headers["sec-fetch-mode"] !== "cors" ||
        request.headers["sec-fetch-dest"] !== "empty"
      ) {
        return reply.code(403).send({
          code: "native_action_forbidden",
          message: "Native file action request is not allowed.",
        });
      }
      if (
        contentType !== "application/json" ||
        typeof request.body !== "object" ||
        request.body === null ||
        Array.isArray(request.body) ||
        Object.keys(request.body).length !== 0
      ) {
        return reply.code(400).send({
          code: "invalid_input",
          message: "Please check the submitted values.",
        });
      }
    }

    const nativeRateLimit = nativeApp.rateLimit({
      max: 10,
      timeWindow: NATIVE_ACTION_RATE_LIMIT_WINDOW_MS,
    });
    const routeOptions = {
      preHandler: [nativeRequestPreHandler, nativeRateLimit],
    };

    nativeApp.post<{
      Params: { id: string; noteId: string; attachmentId: string };
    }>(
      "/api/chats/:id/notes/:noteId/attachments/:attachmentId/open",
      routeOptions,
      async (request, reply) => {
        await maintenanceGate.runMutation(() =>
          service.openAttachment(
            request.params.id,
            request.params.noteId,
            request.params.attachmentId,
          ),
        );
        return reply.code(204).send();
      },
    );

    nativeApp.post<{
      Params: { id: string; noteId: string; attachmentId: string };
    }>(
      "/api/chats/:id/notes/:noteId/attachments/:attachmentId/reveal",
      routeOptions,
      async (request, reply) => {
        await maintenanceGate.runMutation(() =>
          service.revealAttachment(
            request.params.id,
            request.params.noteId,
            request.params.attachmentId,
          ),
        );
        return reply.code(204).send();
      },
    );
  });

  void app.register(async (transferApp) => {
    await registerDatabaseTransferRoutes(transferApp, {
      database: () => database,
      databasePath: options.databasePath,
      dataDirectory,
      attachmentStore,
      maintenanceGate,
      reopenDatabase,
      oldStoragePaths: () => repository.listAllAttachmentStoragePaths(),
      exportDirectoryCleanup,
      stagedUploadCleanup,
      clock: options.clock,
      idFactory: options.idFactory,
    });
  });

  app.addHook("onClose", async () => {
    try {
      if (database.open) database.close();
    } finally {
      await options.onDatabaseClosed?.();
    }
  });

  return app;
}
