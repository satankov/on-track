import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { isBuiltinLabel, type Label } from "../../domain/labels.js";
import type { Note } from "../../domain/types.js";
import { readProjectLabels } from "./project-labels.js";

type AssignedLabel = {
  note_id: string;
  label: Label;
  name: string;
  symbol: string | null;
  position: number;
  snapshot: number;
};

function readAssignments(
  database: Database.Database,
  scope: "chat" | "note",
  id: string,
): AssignedLabel[] {
  const column = scope === "chat" ? "n.chat_id" : "n.id";
  return database
    .prepare(
      `
    SELECT a.note_id, a.label, p.name, p.symbol, p.position, 0 AS snapshot
    FROM notes n JOIN note_labels a ON a.note_id=n.id
    JOIN project_labels p ON p.chat_id=a.chat_id AND p.id=a.label
    WHERE ${column}=?
    UNION ALL
    SELECT s.note_id, s.label, s.name, s.symbol, s.position, 1 AS snapshot
    FROM notes n JOIN note_label_snapshots s ON s.note_id=n.id
    WHERE ${column}=?
    ORDER BY note_id, snapshot, position, label
  `,
    )
    .all(id, id) as AssignedLabel[];
}

export function readNoteLabelFields(
  database: Database.Database,
  scope: "chat" | "note",
  id: string,
) {
  const groups = new Map<string, Pick<Note, "labels" | "labelSnapshots">>();
  for (const row of readAssignments(database, scope, id)) {
    const fields = groups.get(row.note_id) ?? { labels: [] };
    fields.labels.push(row.label);
    if (row.snapshot) {
      (fields.labelSnapshots ??= []).push({
        id: row.label,
        name: row.name,
        symbol: row.symbol,
        position: row.position,
        builtin: false,
        enabled: false,
      });
    }
    groups.set(row.note_id, fields);
  }
  return groups;
}

export function readTransferLabels(
  database: Database.Database,
  noteId: string,
) {
  return readAssignments(database, "note", noteId);
}

/** Called inside the batch transaction after the destination note exists. */
export function applyTransferLabels(
  database: Database.Database,
  targetChatId: string,
  targetNoteId: string,
  labels: readonly AssignedLabel[],
): void {
  if (!labels.length) return;
  const definitions = readProjectLabels(database, targetChatId);
  const assign = database.prepare(
    "INSERT INTO note_labels(note_id,chat_id,label) VALUES(?,?,?)",
  );
  const snapshot = database.prepare(
    "INSERT INTO note_label_snapshots(note_id,label,name,symbol,position) VALUES(?,?,?,?,?)",
  );
  const used = new Set<Label>();
  for (const [position, label] of labels.entries()) {
    const match = definitions.find((p) =>
      isBuiltinLabel(label.label)
        ? p.id === label.label
        : !p.builtin && p.name === label.name && p.symbol === label.symbol,
    );
    if (match && !used.has(match.id)) {
      assign.run(targetNoteId, targetChatId, match.id);
      used.add(match.id);
    } else {
      // A note-owned identity keeps a conflicting glyph or name independent of local settings.
      snapshot.run(
        targetNoteId,
        `custom-${randomUUID()}`,
        label.name,
        label.symbol,
        position,
      );
    }
  }
}
