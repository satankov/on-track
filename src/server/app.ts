import type Database from "better-sqlite3";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Sqlite from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import {
  ChatService,
  InvalidInputError,
  ProjectNotFoundError,
} from "./chat-service.js";
import { openDatabase } from "./db/database.js";
import { SqliteChatRepository } from "./db/repository.js";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from "../domain/validation.js";

interface BuildAppOptions {
  database: Database.Database;
  databasePath?: string;
  idFactory?: () => string;
  clock?: () => number;
}

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;
const DATABASE_TRANSFER_RATE_LIMIT_WINDOW_MS = 60_000;
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

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: MULTIPART_BODY_LIMIT_BYTES });
  let database = options.database;
  let service = new ChatService(
    new SqliteChatRepository(database),
    options.idFactory,
    options.clock,
  );

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  void app.register(multipart, {
    limits: {
      fileSize: MAX_ATTACHMENT_BYTES,
      files: MAX_ATTACHMENTS_PER_MESSAGE,
      parts: MAX_ATTACHMENTS_PER_MESSAGE + 2,
    },
  });

  function isUnsafeHeaderCharacter(character: string): boolean {
    const code = character.charCodeAt(0);
    return (
      code <= 31 || code === 127 || character === '"' || character === "\\"
    );
  }

  function stripControlCharacters(value: string): string {
    return [...value]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join("");
  }

  function sanitizeFilename(filename: string | undefined): string {
    const value = basename(filename || "attachment")
      .split("")
      .map((character) =>
        isUnsafeHeaderCharacter(character) ? "_" : character,
      )
      .join("")
      .trim();
    return value.slice(0, 255) || "attachment";
  }

  function sanitizeMediaType(mediaType: string | undefined): string {
    const value = stripControlCharacters(
      mediaType || "application/octet-stream",
    )
      .trim()
      .slice(0, 255);
    return value || "application/octet-stream";
  }

  function attachmentDispositionFilename(filename: string): string {
    return filename
      .split("")
      .map((character) =>
        isUnsafeHeaderCharacter(character) ? "_" : character,
      )
      .join("");
  }

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
    createdAt?: number;
    keepAttachmentIds: string[];
    attachments: {
      filename: string;
      mediaType: string;
      byteSize: number;
      content: Buffer;
    }[];
  }> {
    let body: string | undefined;
    let createdAt: number | undefined;
    const keepAttachmentIds: string[] = [];
    const attachments = [];
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const content = await part.toBuffer();
          attachments.push({
            filename: sanitizeFilename(part.filename),
            mediaType: sanitizeMediaType(part.mimetype),
            byteSize: content.byteLength,
            content,
          });
          continue;
        }
        if (part.fieldname === "body" && typeof part.value === "string") {
          body = part.value;
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
          keepAttachmentIds.push(part.value);
        }
      }
    } catch {
      throw new InvalidInputError();
    }
    return { body, createdAt, keepAttachmentIds, attachments };
  }

  function removeDatabaseFiles(path: string): void {
    for (const candidate of [
      path,
      `${path}-wal`,
      `${path}-shm`,
      `${path}-journal`,
    ]) {
      rmSync(candidate, { force: true });
    }
  }

  function validateImportedDatabase(path: string): void {
    const raw = new Sqlite(path, { readonly: true, fileMustExist: true });
    try {
      const quickCheck = raw.pragma("quick_check", {
        simple: true,
      }) as string;
      if (quickCheck !== "ok") {
        throw new Error("The selected file failed SQLite integrity checks.");
      }
      const chatTable = raw
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chats'",
        )
        .pluck()
        .get();
      const noteTable = raw
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
        )
        .pluck()
        .get();
      if (!chatTable || !noteTable) {
        throw new Error("The selected file is not an On Track database.");
      }
    } finally {
      raw.close();
    }
    const imported = openDatabase(path);
    try {
      imported.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      imported.close();
    }
  }

  function replaceDatabase(importPath: string): void {
    if (!options.databasePath) {
      throw new Error("Database import is not available in this environment.");
    }

    const databasePath = options.databasePath;
    const rollbackPath = join(
      dirname(databasePath),
      `.on-track-rollback-${randomUUID()}.sqlite`,
    );
    try {
      if (database.open) {
        database.pragma("wal_checkpoint(TRUNCATE)");
        database.close();
      }
      removeDatabaseFiles(rollbackPath);
      if (existsSync(databasePath)) renameSync(databasePath, rollbackPath);
      removeDatabaseFiles(databasePath);
      renameSync(importPath, databasePath);
      database = openDatabase(databasePath);
      service = new ChatService(
        new SqliteChatRepository(database),
        options.idFactory,
        options.clock,
      );
      removeDatabaseFiles(rollbackPath);
    } catch (error) {
      removeDatabaseFiles(databasePath);
      if (existsSync(rollbackPath)) renameSync(rollbackPath, databasePath);
      database = openDatabase(databasePath);
      service = new ChatService(
        new SqliteChatRepository(database),
        options.idFactory,
        options.clock,
      );
      throw error;
    }
  }

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
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError || error instanceof InvalidInputError) {
      return reply.code(400).send({
        code: "invalid_input",
        message: "Please check the submitted values.",
      });
    }
    if (error instanceof ProjectNotFoundError) {
      return reply
        .code(404)
        .send({ code: "not_found", message: error.message });
    }
    if (isDatabaseTransferRateLimitError(error)) {
      return reply.code(429).send({
        code: "rate_limited",
        message: "Database transfer is temporarily rate-limited.",
      });
    }

    app.log.error(error);
    return reply
      .code(500)
      .send({ code: "internal_error", message: "Something went wrong." });
  });

  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/chats", async () => service.listChats());
  app.post("/api/chats", async (request, reply) => {
    const chat = service.createChat(request.body);
    return reply.code(201).send(chat);
  });
  app.get<{ Params: { id: string } }>("/api/chats/:id", async (request) =>
    service.getChat(request.params.id),
  );
  app.patch<{ Params: { id: string } }>("/api/chats/:id", async (request) =>
    service.updateChat(request.params.id, request.body),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/chats/:id",
    async (request, reply) => {
      service.deleteChat(request.params.id);
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/chats/:id/notes",
    async (request, reply) => {
      const note = request.isMultipart()
        ? service.appendNoteWithAttachments(
            request.params.id,
            await parseMultipartNote(request),
          )
        : service.appendNote(request.params.id, request.body);
      return reply.code(201).send(note);
    },
  );
  app.get<{ Params: { id: string; noteId: string; attachmentId: string } }>(
    "/api/chats/:id/notes/:noteId/attachments/:attachmentId",
    async (request, reply) => {
      const attachment = service.getAttachment(
        request.params.id,
        request.params.noteId,
        request.params.attachmentId,
      );
      return reply
        .header("Content-Type", attachment.mediaType)
        .header(
          "Content-Disposition",
          `attachment; filename="${attachmentDispositionFilename(attachment.filename)}"`,
        )
        .send(Buffer.from(attachment.content));
    },
  );
  app.patch<{ Params: { id: string; noteId: string } }>(
    "/api/chats/:id/notes/:noteId",
    async (request) =>
      request.isMultipart()
        ? service.updateNoteWithAttachments(
            request.params.id,
            request.params.noteId,
            await parseMultipartNote(request),
          )
        : service.updateNote(
            request.params.id,
            request.params.noteId,
            request.body,
          ),
  );
  app.delete<{ Params: { id: string; noteId: string } }>(
    "/api/chats/:id/notes/:noteId",
    async (request, reply) => {
      service.deleteNote(request.params.id, request.params.noteId);
      return reply.code(204).send();
    },
  );

  void app.register(async (transferApp) => {
    await transferApp.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => ({
        statusCode: 429,
        code: "rate_limited",
        message: "Database transfer is temporarily rate-limited.",
      }),
    });

    transferApp.get(
      "/api/database/export",
      {
        config: {
          rateLimit: {
            max: 3,
            timeWindow: DATABASE_TRANSFER_RATE_LIMIT_WINDOW_MS,
          },
        },
      },
      async (_request, reply) => {
        if (!options.databasePath) {
          return reply.code(501).send({
            code: "unavailable",
            message: "Database export is unavailable.",
          });
        }
        const exportPath = join(
          dirname(options.databasePath),
          `.on-track-export-${randomUUID()}.sqlite`,
        );
        try {
          await database.backup(exportPath);
          const backup = readFileSync(exportPath);
          return reply
            .header("Content-Type", "application/vnd.sqlite3")
            .header(
              "Content-Disposition",
              `attachment; filename="on-track-${new Date().toISOString().slice(0, 10)}.sqlite"`,
            )
            .send(backup);
        } finally {
          removeDatabaseFiles(exportPath);
        }
      },
    );

    transferApp.put(
      "/api/database/import",
      {
        config: {
          rateLimit: {
            max: 2,
            timeWindow: DATABASE_TRANSFER_RATE_LIMIT_WINDOW_MS,
          },
        },
      },
      async (request, reply) => {
        if (!options.databasePath) {
          return reply.code(501).send({
            code: "unavailable",
            message: "Database import is unavailable.",
          });
        }
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          return reply.code(400).send({
            code: "invalid_database",
            message: "Choose a non-empty On Track database backup.",
          });
        }

        const importPath = join(
          dirname(options.databasePath),
          `.on-track-import-${randomUUID()}.sqlite`,
        );
        try {
          writeFileSync(importPath, request.body, { mode: 0o600 });
          chmodSync(importPath, 0o600);
          validateImportedDatabase(importPath);
          replaceDatabase(importPath);
          removeDatabaseFiles(importPath);
          return reply.code(204).send();
        } catch {
          removeDatabaseFiles(importPath);
          return reply.code(400).send({
            code: "invalid_database",
            message:
              "The selected file is not a valid On Track database backup.",
          });
        }
      },
    );
  });

  app.addHook("onClose", async () => {
    if (database.open) database.close();
  });

  return app;
}
