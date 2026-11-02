import {
  CONFIGURABLE_LABELS,
  MAX_CUSTOM_LABELS,
  labelConfigurationSchema,
  configurableLabelSchema,
} from "./labels.js";
export {
  PERMANENT_LABELS,
  CONFIGURABLE_LABELS,
  LABELS,
  DEFAULT_ENABLED_LABELS,
  labelSchema,
  configurableLabelSchema,
  type Label,
  type ConfigurableLabel,
} from "./labels.js";
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
export const MAX_SENDER_NAME_LENGTH = 80;

const titleSchema = z.string().trim().min(1).max(80);
const accentSchema = z.enum(ACCENTS);
export const enabledLabelsSchema = z
  .array(configurableLabelSchema)
  .max(CONFIGURABLE_LABELS.length + MAX_CUSTOM_LABELS)
  .refine((labels) => new Set(labels).size === labels.length, {
    message: "Labels must be unique",
  });
const noteBodySchema = z.string().trim().min(1).max(10_000);
export const senderSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SENDER_NAME_LENGTH);

export const createChatInputSchema = z.object({
  title: titleSchema,
  accent: accentSchema,
});

export const updateChatInputSchema = z
  .object({
    title: titleSchema.optional(),
    accent: accentSchema.optional(),
    enabledLabels: enabledLabelsSchema.optional(),
    labelConfiguration: labelConfigurationSchema.optional(),
    collapseLongMessages: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.enabledLabels === undefined ||
      value.labelConfiguration === undefined,
    {
      message: "Provide either enabled labels or label configuration, not both",
    },
  )
  .refine(
    (value) =>
      value.title !== undefined ||
      value.accent !== undefined ||
      value.enabledLabels !== undefined ||
      value.labelConfiguration !== undefined ||
      value.collapseLongMessages !== undefined,
    { message: "Provide a title, accent, label, or message display setting" },
  );

export const createNoteInputSchema = z.object({
  body: noteBodySchema,
  sender: senderSchema.nullable().optional(),
  createdAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  files: z
    .array(z.instanceof(File))
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
});

export const updateNoteInputSchema = z
  .object({
    body: noteBodySchema.optional(),
    sender: senderSchema.nullable().optional(),
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
      value.sender !== undefined ||
      value.createdAt !== undefined ||
      value.keepAttachmentIds !== undefined ||
      value.files !== undefined,
    {
      message: "Provide note text, sender, or timestamp",
    },
  );

export type Accent = (typeof ACCENTS)[number];
export type CreateChatInput = z.infer<typeof createChatInputSchema>;
export type UpdateChatInput = z.infer<typeof updateChatInputSchema>;
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;
