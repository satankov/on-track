import { z } from "zod";

export const ACCENTS = [
  "coral",
  "amber",
  "moss",
  "ocean",
  "iris",
  "slate",
] as const;

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const titleSchema = z.string().trim().min(1).max(80);
const accentSchema = z.enum(ACCENTS);
const noteBodySchema = z.string().trim().min(1).max(10_000);

export const createChatInputSchema = z.object({
  title: titleSchema,
  accent: accentSchema,
});

export const updateChatInputSchema = z
  .object({
    title: titleSchema.optional(),
    accent: accentSchema.optional(),
  })
  .refine((value) => value.title !== undefined || value.accent !== undefined, {
    message: "Provide a title or accent",
  });

export const createNoteInputSchema = z.object({
  body: noteBodySchema,
  createdAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  files: z
    .array(z.instanceof(File))
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
});

export const updateNoteInputSchema = z
  .object({
    body: noteBodySchema.optional(),
    createdAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    keepAttachmentIds: z
      .array(z.string())
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .optional(),
    files: z
      .array(z.instanceof(File))
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .optional(),
  })
  .refine(
    (value) =>
      value.body !== undefined ||
      value.createdAt !== undefined ||
      value.keepAttachmentIds !== undefined ||
      value.files !== undefined,
    {
      message: "Provide note text or timestamp",
    },
  );

export type Accent = (typeof ACCENTS)[number];
export type CreateChatInput = z.infer<typeof createChatInputSchema>;
export type UpdateChatInput = z.infer<typeof updateChatInputSchema>;
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;
