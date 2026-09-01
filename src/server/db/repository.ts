import type Database from "better-sqlite3";

import type {
  Chat,
  Note,
  NoteAttachment,
  StoredNoteAttachment,
} from "../../domain/types.js";
import type { Accent } from "../../domain/validation.js";

interface ChatRow {
  id: string;
  title: string;
  accent: Accent;
  created_at: number;
  updated_at: number;
}

interface NoteRow {
  id: string;
  chat_id: string;
  body: string;
  created_at: number;
}

interface NoteAttachmentRow {
  id: string;
  note_id: string;
  filename: string;
  media_type: string;
  byte_size: number;
  content: Buffer;
  created_at: number;
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    title: row.title,
    accent: row.accent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAttachment(row: NoteAttachmentRow): NoteAttachment {
  return {
    id: row.id,
    noteId: row.note_id,
    filename: row.filename,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

function toStoredAttachment(row: NoteAttachmentRow): StoredNoteAttachment {
  return {
    ...toAttachment(row),
    content: row.content,
  };
}

function toNote(row: NoteRow, attachments: NoteAttachment[] = []): Note {
  return {
    id: row.id,
    chatId: row.chat_id,
    body: row.body,
    createdAt: row.created_at,
    attachments,
  };
}

export class SqliteChatRepository {
  constructor(private readonly database: Database.Database) {}

  createChat(input: {
    id: string;
    title: string;
    accent: Accent;
    now: number;
  }): Chat {
    this.database
      .prepare(
        `INSERT INTO chats (id, title, accent, created_at, updated_at)
         VALUES (@id, @title, @accent, @now, @now)`,
      )
      .run(input);

    return this.getChat(input.id)!;
  }

  listChats(): Chat[] {
    const rows = this.database
      .prepare("SELECT * FROM chats ORDER BY updated_at DESC, id ASC")
      .all() as ChatRow[];
    return rows.map(toChat);
  }

  getChat(id: string): Chat | undefined {
    const row = this.database
      .prepare("SELECT * FROM chats WHERE id = ?")
      .get(id) as ChatRow | undefined;
    return row ? toChat(row) : undefined;
  }

  updateChat(
    id: string,
    input: { title?: string; accent?: Accent; now: number },
  ): Chat | undefined {
    const result = this.database
      .prepare(
        `UPDATE chats
         SET title = COALESCE(@title, title),
             accent = COALESCE(@accent, accent),
             updated_at = @now
         WHERE id = @id`,
      )
      .run({
        id,
        title: input.title ?? null,
        accent: input.accent ?? null,
        now: input.now,
      });

    return result.changes === 0 ? undefined : this.getChat(id);
  }

  deleteChat(id: string): boolean {
    const remove = this.database.transaction(() => {
      this.database.prepare("DELETE FROM notes WHERE chat_id = ?").run(id);
      const result = this.database
        .prepare("DELETE FROM chats WHERE id = ?")
        .run(id);
      return result.changes > 0;
    });

    return remove();
  }

  appendNote(input: {
    id: string;
    chatId: string;
    body: string;
    createdAt?: number;
    now: number;
    attachments?: {
      id: string;
      filename: string;
      mediaType: string;
      byteSize: number;
      content: Uint8Array;
      createdAt?: number;
    }[];
  }): Note | undefined {
    const append = this.database.transaction(() => {
      const chat = this.getChat(input.chatId);
      if (!chat) return undefined;
      const createdAt = input.createdAt ?? input.now;

      this.database
        .prepare(
          `INSERT INTO notes (id, chat_id, body, created_at)
           VALUES (@id, @chatId, @body, @createdAt)`,
        )
        .run({ ...input, createdAt });
      for (const attachment of input.attachments ?? []) {
        this.database
          .prepare(
            `INSERT INTO note_attachments
             (id, note_id, filename, media_type, byte_size, content, created_at)
             VALUES
             (@id, @noteId, @filename, @mediaType, @byteSize, @content, @createdAt)`,
          )
          .run({
            ...attachment,
            noteId: input.id,
            content: Buffer.from(attachment.content),
            createdAt: attachment.createdAt ?? createdAt,
          });
      }
      this.refreshChatActivity(input.chatId, input.now);

      return this.database
        .prepare("SELECT * FROM notes WHERE id = ?")
        .get(input.id) as NoteRow;
    });

    const row = append();
    return row ? toNote(row, this.listAttachments(row.id)) : undefined;
  }

  listNotes(chatId: string): Note[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM notes
         WHERE chat_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(chatId) as NoteRow[];
    const attachmentRows = this.database
      .prepare(
        `SELECT note_attachments.*
         FROM note_attachments
         INNER JOIN notes ON notes.id = note_attachments.note_id
         WHERE notes.chat_id = ?
         ORDER BY note_attachments.created_at ASC, note_attachments.id ASC`,
      )
      .all(chatId) as NoteAttachmentRow[];
    const attachmentsByNote = new Map<string, NoteAttachment[]>();
    for (const row of attachmentRows) {
      const current = attachmentsByNote.get(row.note_id) ?? [];
      current.push(toAttachment(row));
      attachmentsByNote.set(row.note_id, current);
    }
    return rows.map((row) => toNote(row, attachmentsByNote.get(row.id) ?? []));
  }

  updateNote(
    chatId: string,
    noteId: string,
    input: {
      body?: string;
      createdAt?: number;
      now: number;
      keepAttachmentIds?: string[];
      attachments?: {
        id: string;
        filename: string;
        mediaType: string;
        byteSize: number;
        content: Uint8Array;
        createdAt?: number;
      }[];
    },
  ): Note | undefined {
    const update = this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT * FROM notes WHERE id = ? AND chat_id = ?")
        .get(noteId, chatId) as NoteRow | undefined;
      if (!existing) return undefined;

      this.database
        .prepare(
          `UPDATE notes
           SET body = COALESCE(@body, body),
               created_at = COALESCE(@createdAt, created_at)
           WHERE id = @noteId AND chat_id = @chatId`,
        )
        .run({
          noteId,
          chatId,
          body: input.body ?? null,
          createdAt: input.createdAt ?? null,
        });
      if (input.keepAttachmentIds || input.attachments?.length) {
        const kept = input.keepAttachmentIds ?? [];
        if (kept.length > 0) {
          const placeholders = kept.map(() => "?").join(", ");
          this.database
            .prepare(
              `DELETE FROM note_attachments
               WHERE note_id = ?
                 AND id NOT IN (${placeholders})`,
            )
            .run(noteId, ...kept);
        } else {
          this.database
            .prepare("DELETE FROM note_attachments WHERE note_id = ?")
            .run(noteId);
        }
        for (const attachment of input.attachments ?? []) {
          this.database
            .prepare(
              `INSERT INTO note_attachments
               (id, note_id, filename, media_type, byte_size, content, created_at)
               VALUES
               (@id, @noteId, @filename, @mediaType, @byteSize, @content, @createdAt)`,
            )
            .run({
              ...attachment,
              noteId,
              content: Buffer.from(attachment.content),
              createdAt:
                attachment.createdAt ?? input.createdAt ?? existing.created_at,
            });
        }
      }
      this.refreshChatActivity(chatId, input.now);

      return this.database
        .prepare("SELECT * FROM notes WHERE id = ? AND chat_id = ?")
        .get(noteId, chatId) as NoteRow;
    });

    const row = update();
    return row ? toNote(row, this.listAttachments(row.id)) : undefined;
  }

  deleteNote(chatId: string, noteId: string): boolean {
    const remove = this.database.transaction(() => {
      const result = this.database
        .prepare("DELETE FROM notes WHERE id = ? AND chat_id = ?")
        .run(noteId, chatId);
      if (result.changes === 0) return false;
      this.refreshChatActivity(chatId);
      return true;
    });

    return remove();
  }

  private refreshChatActivity(chatId: string, fallbackNow?: number): void {
    const newestNoteAt = this.database
      .prepare("SELECT max(created_at) FROM notes WHERE chat_id = ?")
      .pluck()
      .get(chatId) as number | null;
    this.database
      .prepare(
        `UPDATE chats
         SET updated_at = COALESCE(@newestNoteAt, @fallbackNow, created_at)
         WHERE id = @chatId`,
      )
      .run({
        chatId,
        newestNoteAt,
        fallbackNow: fallbackNow ?? null,
      });
  }

  getAttachment(
    chatId: string,
    noteId: string,
    attachmentId: string,
  ): StoredNoteAttachment | undefined {
    const row = this.database
      .prepare(
        `SELECT note_attachments.*
         FROM note_attachments
         INNER JOIN notes ON notes.id = note_attachments.note_id
         WHERE notes.chat_id = ?
           AND notes.id = ?
           AND note_attachments.id = ?`,
      )
      .get(chatId, noteId, attachmentId) as NoteAttachmentRow | undefined;
    return row ? toStoredAttachment(row) : undefined;
  }

  private listAttachments(noteId: string): NoteAttachment[] {
    const rows = this.database
      .prepare(
        `SELECT *
         FROM note_attachments
         WHERE note_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(noteId) as NoteAttachmentRow[];
    return rows.map(toAttachment);
  }
}
