import type { ProjectLabelRow } from "./project-labels.js";
import type Database from "better-sqlite3";

export interface ImportedProject {
  id: string;
  title: string;
  accent: string;
  created_at: number;
  updated_at: number;
  pinned_at: number | null;
  archived_at: number | null;
  collapse_long_messages: number;
}
export interface ImportedNote {
  id: string;
  chat_id: string;
  body: string;
  sender: string | null;
  created_at: number;
}
export interface ImportedAttachment {
  id: string;
  note_id: string;
  filename: string;
  media_type: string;
  storage_path: string;
  byte_size: number;
  modified_at: number;
  created_at: number;
}
export interface ImportedRecords {
  projects: ImportedProject[];
  notes: ImportedNote[];
  attachments: ImportedAttachment[];
  labelDefinitions: ProjectLabelRow[];
  noteLabels: Array<{ note_id: string; chat_id: string; label: string }>;
}
export function readImportedRecords(
  source: Database.Database,
): ImportedRecords {
  return {
    projects: source
      .prepare(
        "SELECT id,title,accent,created_at,updated_at,pinned_at,archived_at,collapse_long_messages FROM chats ORDER BY id",
      )
      .all() as ImportedProject[],
    notes: source
      .prepare(
        "SELECT id,chat_id,body,sender,created_at FROM notes ORDER BY id",
      )
      .all() as ImportedNote[],
    attachments: source
      .prepare(
        "SELECT id,note_id,filename,media_type,storage_path,byte_size,modified_at,created_at FROM note_attachments ORDER BY id",
      )
      .all() as ImportedAttachment[],
    labelDefinitions: source
      .prepare("SELECT * FROM project_labels ORDER BY chat_id,position")
      .all() as ProjectLabelRow[],
    noteLabels: source
      .prepare("SELECT note_id,chat_id,label FROM note_labels")
      .all() as ImportedRecords["noteLabels"],
  };
}
export function insertImportedRecords(
  database: Database.Database,
  records: ImportedRecords,
): void {
  const project = database.prepare(
    "INSERT INTO chats (id,title,accent,created_at,updated_at,pinned_at,archived_at,collapse_long_messages) VALUES (@id,@title,@accent,@created_at,@updated_at,@pinned_at,@archived_at,@collapse_long_messages)",
  );
  const note = database.prepare(
    "INSERT INTO notes (id,chat_id,body,sender,created_at) VALUES (@id,@chat_id,@body,@sender,@created_at)",
  );
  const file = database.prepare(
    "INSERT INTO note_attachments (id,note_id,filename,media_type,storage_path,byte_size,modified_at,created_at) VALUES (@id,@note_id,@filename,@media_type,@storage_path,@byte_size,@modified_at,@created_at)",
  );
  const definition = database.prepare(
    "INSERT INTO project_labels (chat_id,id,name,name_key,symbol,enabled,position,builtin) VALUES (@chat_id,@id,@name,@name_key,@symbol,@enabled,@position,@builtin)",
  );
  const label = database.prepare(
    "INSERT INTO note_labels (note_id,chat_id,label) VALUES (@note_id,@chat_id,@label)",
  );
  database.transaction(() => {
    for (const row of records.projects) project.run(row);
    for (const row of records.notes) note.run(row);
    for (const row of records.attachments) file.run(row);
    for (const row of records.labelDefinitions) definition.run(row);
    for (const row of records.noteLabels) label.run(row);
  })();
}
