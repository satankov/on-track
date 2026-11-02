/** Display copy is independent of schema-9 canonical built-in names. */
export function labelDisplayName(label: { id?: string; name: string }): string {
  return label.id === "open-question" ? "Question" : label.name;
}
