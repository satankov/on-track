import type Database from "better-sqlite3";

import type { Chat, Note } from "../../domain/types.js";
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

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    title: row.title,
    accent: row.accent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    chatId: row.chat_id,
    body: row.body,
    createdAt: row.created_at,
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
      this.refreshChatActivity(input.chatId, input.now);

      return this.database
        .prepare("SELECT * FROM notes WHERE id = ?")
        .get(input.id) as NoteRow;
    });

    const row = append();
    return row ? toNote(row) : undefined;
  }

  listNotes(chatId: string): Note[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM notes
         WHERE chat_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(chatId) as NoteRow[];
    return rows.map(toNote);
  }

  updateNote(
    chatId: string,
    noteId: string,
    input: { body?: string; createdAt?: number; now: number },
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
      this.refreshChatActivity(chatId, input.now);

      return this.database
        .prepare("SELECT * FROM notes WHERE id = ? AND chat_id = ?")
        .get(noteId, chatId) as NoteRow;
    });

    const row = update();
    return row ? toNote(row) : undefined;
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
}
