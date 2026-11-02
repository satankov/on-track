import {
  isBuiltinLabel,
  MAX_CUSTOM_LABELS,
  type LabelConfiguration,
} from "../domain/labels.js";

export type LabelDraft = LabelConfiguration["labels"][number] & { key: string };
export function isEmptyLabelDraft(label: LabelDraft): boolean {
  return (
    (!label.id || !isBuiltinLabel(label.id)) &&
    !label.name.trim() &&
    !label.symbol?.trim()
  );
}

/** Keep one stable empty input after the active rows; it never enters the API. */
export function withLabelPlaceholder(
  labels: LabelDraft[],
  preferredKey?: string,
): LabelDraft[] {
  const active = labels.filter((label) => !isEmptyLabelDraft(label));
  const customCount = active.filter(
    (label) => !label.id || !isBuiltinLabel(label.id),
  ).length;
  if (customCount >= MAX_CUSTOM_LABELS) return active;
  const empty = labels.find(
    (label) => label.key === preferredKey && isEmptyLabelDraft(label),
  ) ??
    labels.find(isEmptyLabelDraft) ?? {
      key: `draft-${crypto.randomUUID()}`,
      name: "",
      symbol: null,
      enabled: true,
    };
  return [...active, empty];
}
export function labelConfiguration(
  labels: LabelDraft[],
  revision: number,
): LabelConfiguration {
  return {
    revision,
    labels: labels
      .filter((label) => !isEmptyLabelDraft(label))
      .map(({ id, name, symbol, enabled }) => ({
        id,
        name,
        symbol,
        enabled,
      })),
  };
}
