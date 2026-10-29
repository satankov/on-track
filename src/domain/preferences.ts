import { z } from "zod";

export const THEMES = ["light", "neutral", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const RAIL_SECTIONS = [
  "Pinned",
  "Projects",
  "Archive",
  "Examples",
] as const;
export type RailSection = (typeof RAIL_SECTIONS)[number];
const collapsedSchema = z
  .object({
    Pinned: z.boolean(),
    Projects: z.boolean(),
    Archive: z.boolean(),
    Examples: z.boolean(),
  })
  .strict();
export const preferencesSchema = z
  .object({
    theme: z.enum(THEMES),
    showExamples: z.boolean(),
    collapsedSections: collapsedSchema,
    initialized: z.boolean(),
  })
  .strict();
export type WorkspacePreferences = z.infer<typeof preferencesSchema>;
export const preferenceInputSchema = z
  .object({
    theme: z.enum(THEMES).optional(),
    showExamples: z.boolean().optional(),
    collapsedSections: collapsedSchema.partial().optional(),
  })
  .strict();
export type PreferenceInput = z.infer<typeof preferenceInputSchema>;
export const DEFAULT_PREFERENCES: WorkspacePreferences = {
  theme: "light",
  showExamples: true,
  initialized: false,
  collapsedSections: {
    Pinned: false,
    Projects: false,
    Archive: false,
    Examples: false,
  },
};

export function mergePreferences(
  current: WorkspacePreferences,
  input: PreferenceInput,
): WorkspacePreferences {
  return {
    ...current,
    ...input,
    collapsedSections: {
      ...current.collapsedSections,
      ...input.collapsedSections,
    },
  };
}
