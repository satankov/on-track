import { z } from "zod";

export const projectSelectionSchema = z.union([
  z.literal("all"),
  z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(10000)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Select each project only once.",
    ),
]);
export type ProjectSelection = z.infer<typeof projectSelectionSchema>;
export const exportOptionsSchema = z.strictObject({
  selection: projectSelectionSchema,
});
export const importOptionsSchema = z.strictObject({
  mode: z.enum(["merge", "replace"]),
  selection: projectSelectionSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;
export interface BackupProject {
  id: string;
  title: string;
  createdAt: number;
  pinnedAt: number | null;
  archivedAt: number | null;
  messageCount: number;
  attachmentCount: number;
}
export interface BackupPreview {
  digest: string;
  projects: BackupProject[];
}
export interface ImportResult {
  importedCount: number;
  renames: Array<{ original: string; renamed: string }>;
}
