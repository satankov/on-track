import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "../domain/validation.js";
import {
  sanitizeAttachmentFilename,
  sanitizeAttachmentMediaType,
} from "./attachment-metadata.js";
import {
  InvalidInputError,
  type ChatService,
  type DraftUploadPart,
} from "./chat-service.js";
import type { MaintenanceGate } from "./database-transfer/maintenance-gate.js";

export function registerDraftRoutes(
  app: FastifyInstance,
  service: () => ChatService,
  gate: MaintenanceGate,
) {
  const path = "/api/chats/:id/draft";
  app.get<{ Params: { id: string } }>(path, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return gate.runRead(() => service().getDraft(request.params.id));
  });
  app.put<{ Params: { id: string } }>(path, async (request) => {
    if (!request.isMultipart()) throw new InvalidInputError();
    return gate.runMutation(() =>
      service().saveDraft(request.params.id, readDraftParts(request)),
    );
  });
  app.post<{ Params: { id: string } }>(
    `${path}/send`,
    { bodyLimit: 1024 },
    async (request, reply) => {
      const note = await gate.runMutation(() =>
        service().sendDraft(request.params.id, request.body),
      );
      return reply.code(201).send(note);
    },
  );
}

/** Finish storing each bounded file before reading the next multipart part. */
async function* readDraftParts(
  request: FastifyRequest,
): AsyncIterable<DraftUploadPart> {
  try {
    const parts = request.parts({
      limits: {
        fields: 1,
        fieldSize: 96 * 1024,
        files: MAX_ATTACHMENTS_PER_MESSAGE,
        fileSize: MAX_ATTACHMENT_BYTES,
        parts: MAX_ATTACHMENTS_PER_MESSAGE + 1,
      },
    });
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "files") {
        const content = await part.toBuffer();
        yield {
          file: {
            filename: sanitizeAttachmentFilename(part.filename),
            mediaType: sanitizeAttachmentMediaType(part.mimetype),
            byteSize: content.byteLength,
            content,
          },
        };
      } else if (
        part.type === "field" &&
        part.fieldname === "draft" &&
        !part.valueTruncated &&
        typeof part.value === "string"
      ) {
        yield { fields: JSON.parse(part.value) };
      } else {
        throw new InvalidInputError();
      }
    }
  } catch {
    throw new InvalidInputError();
  }
}
