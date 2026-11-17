import { z } from "zod";
import type { NoteAttachment } from "./types.js";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_SENDER_NAME_LENGTH,
} from "./validation.js";

export const draftFieldsSchema = z.object({
  body: z.string().max(10_000),
  sender: z.string().max(MAX_SENDER_NAME_LENGTH),
  timestamp: z.union([
    z.literal(""),
    z.iso
      .datetime({ local: true })
      .max(32)
      .refine((value) => !value.endsWith("Z")),
  ]),
  senderOpen: z.boolean(),
  timestampOpen: z.boolean(),
});
export type DraftFields = z.infer<typeof draftFieldsSchema>;
export type DraftAttachment = Pick<
  NoteAttachment,
  "id" | "filename" | "byteSize" | "status"
>;
export interface ConversationDraft extends DraftFields {
  revision: string | null;
  attachments: DraftAttachment[];
}

export const EMPTY_DRAFT_FIELDS: DraftFields = {
  body: "",
  sender: "",
  timestamp: "",
  senderOpen: false,
  timestampOpen: false,
};

export const saveDraftSchema = draftFieldsSchema
  .extend({
    revision: z.uuid().nullable(),
    keepAttachmentIds: z
      .array(z.string().min(1).max(255))
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export const sendDraftSchema = z
  .object({
    revision: z.uuid(),
    createdAt: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();
