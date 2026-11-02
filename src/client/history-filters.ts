export type FilterId = "attachments" | "links" | `label:${string}`;
export type HistoryFilter = readonly FilterId[];

export function filterKey(filters: HistoryFilter): string {
  return filters.length ? JSON.stringify([...new Set(filters)].sort()) : "all";
}

export function selectFilter(
  current: HistoryFilter,
  selected: FilterId | "all",
  multiple = false,
): HistoryFilter {
  if (selected === "all") return [];
  if (!multiple) return [selected];
  return current.includes(selected)
    ? current.filter((value) => value !== selected)
    : [...current, selected];
}

export function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function additiveModifier(
  event: { metaKey: boolean; ctrlKey: boolean },
  apple: boolean,
): boolean {
  return apple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}
