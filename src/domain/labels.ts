import { z } from "zod";

export const PERMANENT_LABELS = ["pin", "attention"] as const;
export const CONFIGURABLE_LABELS = [
  "todo",
  "decision",
  "open-question",
  "risk",
  "milestone",
] as const;
export const LABELS = [...PERMANENT_LABELS, ...CONFIGURABLE_LABELS] as const;
export type BuiltinLabel = (typeof LABELS)[number];
export type Label = BuiltinLabel | `custom-${string}`;
export type ConfigurableLabel =
  (typeof CONFIGURABLE_LABELS)[number] | `custom-${string}`;
export const DEFAULT_ENABLED_LABELS: ConfigurableLabel[] = [
  "todo",
  "milestone",
];
export const MAX_CUSTOM_LABELS = 5;
export const MAX_LABEL_CHARACTERS = 8;
export const LABEL_NAMES: Record<BuiltinLabel, string> = {
  pin: "Pin",
  attention: "Attention",
  todo: "Todo",
  decision: "Decision",
  "open-question": "Open question",
  risk: "Risk",
  milestone: "Milestone",
};
export const LABEL_SYMBOLS: Partial<Record<BuiltinLabel, string>> = {
  risk: "⚠️",
  milestone: "🎖️",
};
export const customLabelIdSchema = z
  .string()
  .max(43)
  .regex(
    /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  )
  .transform((id) => id as `custom-${string}`);
export const labelSchema = z.union([z.enum(LABELS), customLabelIdSchema]);
export const configurableLabelSchema = z.union([
  z.enum(CONFIGURABLE_LABELS),
  customLabelIdSchema,
]);
export function isBuiltinLabel(id: string): id is BuiltinLabel {
  return (LABELS as readonly string[]).includes(id);
}
export function labelNameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export function labelCharacterCount(text: string): number {
  return [...segmenter.segment(text)].length;
}
const forbidden =
  /[\p{Cc}\p{Zl}\p{Zp}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const invisibleOnly = /^[\p{M}\p{Default_Ignorable_Code_Point}\s]*$/u;

export interface ProjectLabel {
  id: Label;
  name: string;
  symbol: string | null;
  enabled: boolean;
  position: number;
  builtin: boolean;
}
export function defaultProjectLabels(
  enabled: readonly string[] = DEFAULT_ENABLED_LABELS,
): ProjectLabel[] {
  return LABELS.map((id, position) => ({
    id,
    name: LABEL_NAMES[id],
    symbol: LABEL_SYMBOLS[id] ?? null,
    enabled: position < 2 || enabled.includes(id),
    position,
    builtin: true,
  }));
}
export function projectLabels(project: {
  labelDefinitions?: ProjectLabel[];
  enabledLabels?: readonly string[];
}): ProjectLabel[] {
  return (
    project.labelDefinitions ?? defaultProjectLabels(project.enabledLabels)
  );
}

const labelInputSchema = z
  .object({
    id: labelSchema.optional(),
    name: z
      .string()
      .max(256)
      .transform((value) => value.trim().normalize("NFC")),
    symbol: z.string().max(64).nullable(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.id && isBuiltinLabel(value.id)) {
      if (
        value.name !== LABEL_NAMES[value.id] ||
        value.symbol !== (LABEL_SYMBOLS[value.id] ?? null) ||
        (PERMANENT_LABELS.includes(value.id as never) && !value.enabled)
      )
        context.addIssue({
          code: "custom",
          message: "Built-in names and symbols cannot change.",
        });
      return;
    }
    if (
      !value.name ||
      forbidden.test(value.name) ||
      invisibleOnly.test(value.name) ||
      labelCharacterCount(value.name) > MAX_LABEL_CHARACTERS
    )
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "Use 1–8 visible characters for the label name.",
      });
    if (
      value.symbol !== null &&
      (forbidden.test(value.symbol) ||
        invisibleOnly.test(value.symbol) ||
        labelCharacterCount(value.symbol) !== 1)
    )
      context.addIssue({
        code: "custom",
        path: ["symbol"],
        message: "Use one symbol or emoji, or leave it empty.",
      });
  });
export const labelConfigurationSchema = z
  .object({
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    labels: z
      .array(labelInputSchema)
      .min(7)
      .max(7 + MAX_CUSTOM_LABELS),
  })
  .strict()
  .superRefine(({ labels }, context) => {
    const ids = labels.flatMap((label) => (label.id ? [label.id] : []));
    if (
      LABELS.some((id) => !ids.includes(id)) ||
      new Set(ids).size !== ids.length ||
      labels[0]?.id !== "pin" ||
      labels[1]?.id !== "attention"
    )
      context.addIssue({
        code: "custom",
        path: ["labels"],
        message: "Keep every built-in label, with Pin and Attention first.",
      });
    const names = labels.map((label) => labelNameKey(label.name));
    if (new Set(names).size !== names.length)
      context.addIssue({
        code: "custom",
        path: ["labels"],
        message: "Label names must be unique in this project.",
      });
  });
export type LabelConfiguration = z.infer<typeof labelConfigurationSchema>;
