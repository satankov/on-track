import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { EMPTY_DRAFT_FIELDS, type DraftFields } from "../../domain/drafts.js";

export class DraftConflictError extends Error {
  constructor() {
    super(
      "This draft changed in another window. Your unsaved changes are still in the composer.",
    );
  }
}
export class DraftFileSelectionError extends Error {}

type InstalledFile = {
  id: string;
  filename: string;
  mediaType: string;
  storagePath: string;
  byteSize: number;
  modifiedAt: number;
  createdAt: number;
};

interface StoredDraft extends DraftFields {
  revision: string | null;
  attachments: Pick<
    InstalledFile,
    "id" | "filename" | "storagePath" | "byteSize"
  >[];
}

export class DraftRepository {
  constructor(private readonly db: Database.Database) {}

  read(chatId: string): StoredDraft | undefined {
    const row = this.db
      .prepare(
        `SELECT d.revision, d.body, d.sender, d.timestamp,
      d.sender_open AS senderOpen, d.timestamp_open AS timestampOpen
      FROM chats c LEFT JOIN conversation_drafts d ON d.chat_id=c.id WHERE c.id=?`,
      )
      .get(chatId) as
      | (Omit<DraftFields, "senderOpen" | "timestampOpen"> & {
          revision: string | null;
          senderOpen: number;
          timestampOpen: number;
        })
      | undefined;
    if (!row) return;
    if (!row.revision)
      return { ...EMPTY_DRAFT_FIELDS, revision: null, attachments: [] };
    const attachments = this.db
      .prepare(
        `SELECT id,filename,storage_path AS storagePath,byte_size AS byteSize
      FROM note_attachments WHERE draft_chat_id=? ORDER BY position, id`,
      )
      .all(chatId) as StoredDraft["attachments"];
    return {
      ...row,
      senderOpen: Boolean(row.senderOpen),
      timestampOpen: Boolean(row.timestampOpen),
      attachments,
    };
  }

  save(
    chatId: string,
    fields: DraftFields & {
      revision: string | null;
      keepAttachmentIds: string[];
    },
    files: InstalledFile[],
  ) {
    return this.db
      .transaction(() => {
        const current = this.read(chatId);
        if (!current) return;
        if (current.revision !== fields.revision)
          throw new DraftConflictError();
        const retained = new Set(fields.keepAttachmentIds);
        if (
          fields.keepAttachmentIds.some(
            (id) => !current.attachments.some((file) => file.id === id),
          )
        )
          throw new DraftFileSelectionError();
        this.writeFields(chatId, fields);
        const removed = current.attachments.filter(
          (file) => !retained.has(file.id),
        );
        const detach = this.db.prepare(
          "DELETE FROM note_attachments WHERE draft_chat_id=? AND id=?",
        );
        for (const file of removed) detach.run(chatId, file.id);
        const order = this.db.prepare(
          "UPDATE note_attachments SET position=? WHERE draft_chat_id=? AND id=?",
        );
        fields.keepAttachmentIds.forEach((id, position) =>
          order.run(position, chatId, id),
        );
        const insert = this.db.prepare(`INSERT INTO note_attachments
        (id,draft_chat_id,position,filename,media_type,storage_path,byte_size,modified_at,created_at)
        VALUES (@id,@chatId,@position,@filename,@mediaType,@storagePath,@byteSize,@modifiedAt,@createdAt)`);
        files.forEach((file, idx) =>
          insert.run({ ...file, chatId, position: retained.size + idx }),
        );
        return removed.map((file) => file.storagePath);
      })
      .immediate();
  }

  consume(
    chatId: string,
    revision: string,
    insertNote: (draft: StoredDraft) => void,
  ) {
    return this.db
      .transaction(() => {
        const current = this.read(chatId);
        if (!current) return;
        if (current.revision !== revision) {
          // The consumed revision is the sent message ID, so a lost acknowledgement
          // can be replayed without sending a duplicate or touching a newer draft.
          if (
            current.revision &&
            this.db
              .prepare("SELECT 1 FROM notes WHERE id=? AND chat_id=?")
              .get(revision, chatId)
          )
            return { draftRevision: current.revision, replayed: true as const };
          throw new DraftConflictError();
        }
        insertNote(current);
        this.db
          .prepare(
            "UPDATE note_attachments SET draft_chat_id=NULL,note_id=? WHERE draft_chat_id=?",
          )
          .run(revision, chatId);
        return { draftRevision: this.writeFields(chatId, EMPTY_DRAFT_FIELDS) };
      })
      .immediate();
  }

  private writeFields(chatId: string, fields: DraftFields) {
    const revision = randomUUID();
    this.db
      .prepare(
        `INSERT INTO conversation_drafts(chat_id,revision,body,sender,timestamp,sender_open,timestamp_open)
      VALUES (@chatId,@revision,@body,@sender,@timestamp,@senderOpen,@timestampOpen)
      ON CONFLICT(chat_id) DO UPDATE SET revision=excluded.revision, body=excluded.body, sender=excluded.sender,
      timestamp=excluded.timestamp, sender_open=excluded.sender_open, timestamp_open=excluded.timestamp_open`,
      )
      .run({
        ...fields,
        chatId,
        revision,
        senderOpen: Number(fields.senderOpen),
        timestampOpen: Number(fields.timestampOpen),
      });
    return revision;
  }
}
