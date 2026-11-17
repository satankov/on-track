import type { FastifyInstance } from "fastify";
import {
  ManagedAttachmentChangedError,
  ManagedAttachmentTooLargeError,
  ManagedAttachmentUnavailableError,
} from "./managed-attachment-store.js";
import { AttachmentUnavailableError } from "../chat-service.js";

const MAX_IN_FLIGHT_PREVIEWS = 8;

export function registerPicturePreviewRoute(
  app: FastifyInstance,
  read: (
    chatId: string,
    noteId: string,
    attachmentId: string,
  ) => Promise<
    { content: Buffer; mediaType: "image/jpeg" | "image/png" } | undefined
  >,
): void {
  let inFlight = 0;

  app.get<{ Params: { id: string; noteId: string; attachmentId: string } }>(
    "/api/chats/:id/notes/:noteId/attachments/:attachmentId/preview",
    { exposeHeadRoute: false },
    async (request, reply) => {
      reply
        .header("Cache-Control", "no-store")
        .header("Cross-Origin-Resource-Policy", "same-origin");
      if (
        request.headers["sec-fetch-site"] !== "same-origin" ||
        request.headers["sec-fetch-mode"] !== "no-cors" ||
        request.headers["sec-fetch-dest"] !== "image"
      ) {
        return reply.code(403).send({
          code: "preview_forbidden",
          message: "A local picture request is required.",
        });
      }
      if (inFlight >= MAX_IN_FLIGHT_PREVIEWS) {
        return reply.code(503).send({
          code: "preview_busy",
          message: "Too many pictures are loading.",
        });
      }
      // Retain the slot while the socket still owns the bounded response buffer.
      inFlight++;
      reply.raw.once("close", () => {
        inFlight--;
      });
      try {
        const { id, noteId, attachmentId } = request.params;
        const picture = await read(id, noteId, attachmentId);
        if (!picture) {
          return reply.code(415).send({
            code: "preview_unsupported",
            message: "This file has no supported picture preview.",
          });
        }
        return reply.type(picture.mediaType).send(picture.content);
      } catch (error) {
        if (error instanceof ManagedAttachmentUnavailableError)
          throw new AttachmentUnavailableError(error.status);
        if (error instanceof ManagedAttachmentTooLargeError) {
          return reply.code(413).send({
            code: "preview_too_large",
            message: "Image is too large to preview.",
          });
        }
        if (error instanceof ManagedAttachmentChangedError) {
          return reply.code(409).send({
            code: "preview_changed",
            message: "Image changed while loading.",
          });
        }
        throw error;
      }
    },
  );
}
