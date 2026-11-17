import type Database from "better-sqlite3";
import type { StoredNoteAttachment } from "../../domain/types.js";
import {
  applyTransferLabels,
  readTransferLabels,
} from "./message-label-transfer.js";

export class BatchContentsChangedError extends Error {
  constructor() {
    super(
      "The selected attachments changed. Check the messages and try again.",
    );
  }
}

export interface PreparedAttachment {
  source: StoredNoteAttachment;
  target: StoredNoteAttachment;
  verify(): void;
}

/** Keep continuations in the original timeline even when a live note moves. */
export function detachNoteOrigins(
  db: Database.Database,
  sourceChat: string,
  noteIds: string[],
) {
  db.prepare(
    `UPDATE subthread_origins SET
      source_note_created_at = (SELECT created_at FROM notes WHERE id = subthread_origins.source_note_id),
      source_note_position_id = source_note_id, source_note_id = NULL
      WHERE source_chat_id = ? AND source_note_id IN (SELECT value FROM json_each(?))`,
  ).run(sourceChat, JSON.stringify(noteIds));
}

export function moveNote(
  db: Database.Database,
  sourceId: string,
  destination: string,
  noteId: string,
) {
  const labels = readTransferLabels(db, noteId);
  db.prepare("DELETE FROM note_labels WHERE note_id = ?").run(noteId);
  db.prepare("DELETE FROM note_label_snapshots WHERE note_id = ?").run(noteId);
  db.prepare("UPDATE notes SET chat_id = ? WHERE chat_id = ? AND id = ?").run(
    destination,
    sourceId,
    noteId,
  );
  applyTransferLabels(db, destination, noteId, labels);
}

export function copyNote(
  db: Database.Database,
  sourceNoteId: string,
  destination: string,
  newNoteId: string,
  attachments: StoredNoteAttachment[],
  prepared: ReadonlyMap<string, PreparedAttachment>,
) {
  db.prepare(
    `INSERT INTO notes (id, chat_id, body, sender, created_at)
    SELECT ?, ?, body, sender, created_at FROM notes WHERE id = ?`,
  ).run(newNoteId, destination, sourceNoteId);
  applyTransferLabels(
    db,
    destination,
    newNoteId,
    readTransferLabels(db, sourceNoteId),
  );
  const insert = db.prepare(`INSERT INTO note_attachments
      (id, note_id, filename, media_type, storage_path, byte_size, modified_at, created_at, position)
      VALUES (@id, @noteId, @filename, @mediaType, @storagePath, @byteSize, @modifiedAt, @createdAt, @position)`);
  for (const [position, source] of attachments.entries()) {
    const entry = prepared.get(source.id);
    if (
      !entry ||
      entry.source.noteId !== source.noteId ||
      entry.source.storagePath !== source.storagePath ||
      entry.source.filename !== source.filename ||
      entry.source.mediaType !== source.mediaType ||
      entry.source.createdAt !== source.createdAt
    )
      throw new BatchContentsChangedError();
    insert.run({ ...entry.target, noteId: newNoteId, position });
  }
}
