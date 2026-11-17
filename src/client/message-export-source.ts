import type { ProjectLabel } from "../domain/labels.js";
import type { Note } from "../domain/types.js";
import { labelDisplayName } from "./label-display.js";

export interface ExportMessage {
  body: string;
  sender: string | null;
  createdAt: number;
  labels: string[];
  attachmentCount: number;
}

export interface ExportSource {
  titles: string[];
  messages: ExportMessage[];
}

export interface ExportOptions {
  format: "md" | "txt";
  includeLabels: boolean;
  timeZone: string;
}

export function selectedMessageSource(
  titles: string[],
  visibleNotes: Note[],
  selected: ReadonlySet<string>,
  definitions: ProjectLabel[],
): ExportSource {
  return {
    titles,
    messages: visibleNotes
      .filter((note) => selected.has(note.id))
      .map((note) => ({
        body: note.body,
        sender: note.sender,
        createdAt: note.createdAt,
        labels: definitions
          .concat(note.labelSnapshots ?? [])
          .filter((label) => note.labels?.includes(label.id))
          .map(labelDisplayName),
        attachmentCount: note.attachments?.length ?? 0,
      })),
  };
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((s, i) => s === right[i]);
}

// Compare only the values a reader could export. An unrelated refresh may
// allocate fresh objects even when the entire excerpt is unchanged.
export function sameExportSource(left: ExportSource, right: ExportSource) {
  return (
    sameStrings(left.titles, right.titles) &&
    left.messages.length === right.messages.length &&
    left.messages.every((a, i) => {
      const b = right.messages[i];
      return (
        a.body === b.body &&
        a.createdAt === b.createdAt &&
        a.sender === b.sender &&
        a.attachmentCount === b.attachmentCount &&
        sameStrings(a.labels, b.labels)
      );
    })
  );
}
