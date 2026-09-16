import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ExampleDetail } from "../../domain/examples.js";
import type { AttachmentStore } from "../chat-service.js";
import {
  insertImportedRecords,
  type ImportedRecords,
} from "../db/project-import.js";
import { exampleFileContent } from "./catalog.js";

export function copyExample(
  database: Database.Database,
  store: AttachmentStore,
  example: ExampleDetail,
  now: number,
): string {
  const id = randomUUID();
  const titles = new Set(
    database.prepare("SELECT title FROM chats").pluck().all(),
  );
  let number = 1;
  let title: string;
  do {
    const suffix = number === 1 ? " (copy)" : ` (copy ${number})`;
    title =
      Array.from(example.title).reduce(
        (prefix, char) =>
          prefix.length + char.length <= 80 - suffix.length
            ? prefix + char
            : prefix,
        "",
      ) + suffix;
    number++;
  } while (titles.has(title));
  const noteIds = new Map(example.notes.map((note) => [note.id, randomUUID()]));
  const records: ImportedRecords = {
    projects: [
      {
        id,
        title,
        accent: example.accent,
        created_at: now,
        updated_at: Math.max(...example.notes.map((n) => n.createdAt)),
        pinned_at: null,
        archived_at: null,
        collapse_long_messages: example.collapseLongMessages ? 1 : 0,
      },
    ],
    notes: example.notes.map((n) => ({
      id: noteIds.get(n.id)!,
      chat_id: id,
      body: n.body,
      sender: n.sender,
      created_at: n.createdAt,
    })),
    enabledLabels: example.enabledLabels.map((label) => ({
      chat_id: id,
      label,
    })),
    noteLabels: example.notes.flatMap((n) =>
      n.labels.map((label) => ({ note_id: noteIds.get(n.id)!, label })),
    ),
    attachments: [],
  };
  const published: string[] = [];
  let committed = false;
  try {
    for (const note of example.notes)
      for (const file of note.attachments ?? []) {
        const attachmentId = randomUUID();
        const result = store.create({
          attachmentId,
          filename: file.filename,
          content: exampleFileContent(file.id),
        });
        published.push(result.storagePath);
        records.attachments.push({
          id: attachmentId,
          note_id: noteIds.get(note.id)!,
          filename: file.filename,
          media_type: file.mediaType,
          storage_path: result.storagePath,
          byte_size: result.byteSize,
          modified_at: result.modifiedAt,
          created_at: now,
        });
      }
    insertImportedRecords(database, records);
    committed = true;
    return id;
  } finally {
    if (!committed)
      for (const path of published) {
        try {
          store.remove(path);
        } catch {
          /* Unreferenced files may remain; never remove existing files. */
        }
      }
  }
}
