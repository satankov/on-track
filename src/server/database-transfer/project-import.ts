import { randomUUID, createHash } from "node:crypto";
import { createReadStream, utimesSync } from "node:fs";
import Database from "better-sqlite3";
import type { ImportResult } from "../../domain/database-transfer.js";
import { ManagedAttachmentStore } from "../attachments/managed-attachment-store.js";
import {
  readImportedRecords,
  insertImportedRecords,
} from "../db/project-import.js";

export async function backupDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function allocateImportedTitles(
  projects: Array<{ id: string; title: string }>,
  existing: string[],
  now: number,
): Map<string, string> {
  const reserved = new Set(existing);
  const result = new Map<string, string>();
  const conflicts: Array<{ id: string; title: string }> = [];
  const ordered = [...projects].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const project of ordered) {
    if (reserved.has(project.title)) conflicts.push(project);
    else {
      reserved.add(project.title);
      result.set(project.id, project.title);
    }
  }
  const timestamp =
    new Date(now)
      .toISOString()
      .slice(0, 19)
      .replace("T", "_")
      .replaceAll(":", "-") + "Z";
  for (const project of conflicts) {
    let counter = 1;
    let title: string;
    do {
      const suffix = `_${timestamp}${counter === 1 ? "" : `_${counter}`}`;
      let prefix = "";
      for (const char of project.title) {
        if (prefix.length + char.length + suffix.length > 80) break;
        prefix += char;
      }
      title = prefix + suffix;
      counter++;
    } while (reserved.has(title));
    reserved.add(title);
    result.set(project.id, title);
  }
  return result;
}

export function mergePreparedProjects(options: {
  database: Database.Database;
  candidateDatabasePath: string;
  candidateDataDirectory: string;
  dataDirectory: string;
  now: number;
  idFactory?: () => string;
}): ImportResult {
  const source = new Database(options.candidateDatabasePath, {
    readonly: true,
    fileMustExist: true,
  });
  let records;
  try {
    records = readImportedRecords(source);
  } finally {
    source.close();
  }
  const occupied = new Set(
    options.database
      .prepare(
        "SELECT id FROM chats UNION SELECT id FROM notes UNION SELECT id FROM note_attachments",
      )
      .pluck()
      .all() as string[],
  );
  for (const row of [
    ...records.projects,
    ...records.notes,
    ...records.attachments,
  ])
    occupied.add(row.id);
  const factory = options.idFactory ?? randomUUID;
  const fresh = () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = factory();
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) && !occupied.has(id)) {
        occupied.add(id);
        return id;
      }
    }
    throw new Error("Could not allocate an import identity.");
  };
  const titles = allocateImportedTitles(
    records.projects,
    options.database
      .prepare("SELECT title FROM chats")
      .pluck()
      .all() as string[],
    options.now,
  );
  const projectIds = new Map(records.projects.map((row) => [row.id, fresh()]));
  const noteIds = new Map(records.notes.map((row) => [row.id, fresh()]));
  const attachmentIds = new Map(
    records.attachments.map((row) => [row.id, fresh()]),
  );
  const result: ImportResult = {
    importedCount: records.projects.length,
    renames: records.projects
      .filter((row) => titles.get(row.id) !== row.title)
      .map((row) => ({ original: row.title, renamed: titles.get(row.id)! })),
  };
  const sourceStore = new ManagedAttachmentStore(
    options.candidateDataDirectory,
  );
  const targetStore = new ManagedAttachmentStore(options.dataDirectory);
  const published: string[] = [];
  let committed = false;
  try {
    const attachments = records.attachments.map((row) => {
      const read = sourceStore.read(row.storage_path);
      const file = targetStore.create({
        attachmentId: attachmentIds.get(row.id)!,
        filename: row.filename,
        content: read.content,
      });
      published.push(file.storagePath);
      const path = targetStore.resolveAvailablePath(file.storagePath);
      utimesSync(path, new Date(row.modified_at), new Date(row.modified_at));
      const observed = targetStore.observe(file.storagePath);
      if (
        observed.status !== "available" ||
        observed.byteSize === undefined ||
        observed.modifiedAt === undefined
      )
        throw new Error("Imported attachment became unavailable.");
      return {
        ...row,
        id: attachmentIds.get(row.id)!,
        note_id: noteIds.get(row.note_id)!,
        storage_path: file.storagePath,
        byte_size: observed.byteSize,
        modified_at: observed.modifiedAt,
      };
    });
    insertImportedRecords(options.database, {
      projects: records.projects.map((row) => ({
        ...row,
        id: projectIds.get(row.id)!,
        title: titles.get(row.id)!,
      })),
      notes: records.notes.map((row) => ({
        ...row,
        id: noteIds.get(row.id)!,
        chat_id: projectIds.get(row.chat_id)!,
      })),
      attachments,
      enabledLabels: records.enabledLabels.map((row) => ({
        ...row,
        chat_id: projectIds.get(row.chat_id)!,
      })),
      noteLabels: records.noteLabels.map((row) => ({
        ...row,
        note_id: noteIds.get(row.note_id)!,
      })),
    });
    committed = true;
    return result;
  } finally {
    if (!committed)
      for (const path of published) {
        try {
          targetStore.remove(path);
        } catch {
          /* Unreferenced files may remain; existing files are never removed. */
        }
      }
  }
}
