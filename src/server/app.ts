import type Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { ChatService, ProjectNotFoundError } from "./chat-service.js";
import { SqliteChatRepository } from "./db/repository.js";

interface BuildAppOptions {
  database: Database.Database;
  idFactory?: () => string;
  clock?: () => number;
}

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const service = new ChatService(
    new SqliteChatRepository(options.database),
    options.idFactory,
    options.clock,
  );

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
    if (error instanceof ZodError) {
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
  app.post<{ Params: { id: string } }>(
    "/api/chats/:id/notes",
    async (request, reply) => {
      const note = service.appendNote(request.params.id, request.body);
      return reply.code(201).send(note);
    },
  );

  app.addHook("onClose", async () => {
    if (options.database.open) options.database.close();
  });

  return app;
}
