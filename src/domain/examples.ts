import type { ChatDetail } from "./types.js";
import { z } from "zod";

/** Presentation shared by real projects and app-owned examples. */
export type TimelineContent = Pick<
  ChatDetail,
  "id" | "title" | "accent" | "enabledLabels" | "collapseLongMessages" | "notes"
>;
export interface ExampleSummary {
  kind: "example";
  slug: string;
  revision: number;
  title: string;
  description: string;
  accent: ChatDetail["accent"];
}
export interface ExampleDetail extends ExampleSummary, TimelineContent {}
export const copyExampleInputSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();

export interface CopyExampleResult {
  id: string;
  project?: ChatDetail;
}
