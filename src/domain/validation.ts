import { z } from "zod";

export const ACCENTS = [
  "coral",
  "amber",
  "moss",
  "ocean",
  "iris",
  "slate",
] as const;

const titleSchema = z.string().trim().min(1).max(80);
const accentSchema = z.enum(ACCENTS);

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
  body: z.string().trim().min(1).max(10_000),
});

export type Accent = (typeof ACCENTS)[number];
export type CreateChatInput = z.infer<typeof createChatInputSchema>;
export type UpdateChatInput = z.infer<typeof updateChatInputSchema>;
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
