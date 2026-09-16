import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import rateLimit from "@fastify/rate-limit";
import { copyExampleInputSchema } from "../../domain/examples.js";
import type { ChatDetail } from "../../domain/types.js";
import type { AttachmentStore } from "../chat-service.js";
import type { MaintenanceGate } from "../database-transfer/maintenance-gate.js";
import { getExample, listExamples } from "./catalog.js";
import { copyExample } from "./service.js";

export async function registerExampleRoutes(
  app: FastifyInstance,
  options: {
    database: () => Database.Database;
    detail: (id: string) => ChatDetail;
    store?: AttachmentStore;
    gate: MaintenanceGate;
    clock: () => number;
  },
) {
  app.get("/api/examples", async () => listExamples());
  app.get<{ Params: { slug: string } }>(
    "/api/examples/:slug",
    async (request, reply) => {
      const example = getExample(request.params.slug);
      return example ?? reply.code(404).send({ message: "Example not found." });
    },
  );
  await app.register(async (copies) => {
    await copies.register(rateLimit, {
      max: 3,
      timeWindow: 60_000,
      keyGenerator: () => "example-copies",
    });
    copies.setErrorHandler((error, _request, reply) => {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 429 || status === 413)
        return reply.code(status).send({
          message:
            status === 429
              ? "Example copying is temporarily rate-limited. Try again in a minute."
              : "The copy request is too large.",
        });
      throw error;
    });
    copies.post<{ Params: { slug: string } }>(
      "/api/examples/:slug/copies",
      { bodyLimit: 1024 },
      async (request, reply) => {
        const { revision } = copyExampleInputSchema.parse(request.body);
        const example = getExample(request.params.slug);
        if (!example)
          return reply.code(404).send({ message: "Example not found." });
        if (revision !== example.revision)
          return reply.code(409).send({
            message:
              "This example has been updated. Reopen it before creating a copy.",
          });
        if (!options.store)
          return reply
            .code(503)
            .send({ message: "Example files are unavailable." });
        return options.gate.runMutation(() => {
          const id = copyExample(
            options.database(),
            options.store!,
            example,
            options.clock(),
          );
          reply.code(201);
          // Once the insert committed, a refresh failure must not imply rollback.
          try {
            return { id, project: options.detail(id) };
          } catch {
            return { id };
          }
        });
      },
    );
  });
}
