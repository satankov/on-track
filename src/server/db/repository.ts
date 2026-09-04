import type Database from "better-sqlite3";

import type {
  Chat,
  Note,
  NoteAttachment,
  ProjectPinState,
  StoredNoteAttachment,
} from "../../domain/types.js";
import { MAX_PROJECT_PREVIEW_SOURCE_LENGTH } from "../../domain/types.js";
import {
  CONFIGURABLE_LABELS,
  DEFAULT_ENABLED_LABELS,
  LABELS,
  PERMANENT_LABELS,
  type Accent,
  type ConfigurableLabel,
  type Label,
} from "../../domain/validation.js";

interface ChatRow {
  id: string;
  title: string;
  accent: Accent;
  created_at: number;
  updated_at: number;
  pinned_at: number | null;
}

interface ChatSidebarSummary {
  latestMessagePreview: string | null;
  nextMessageAt: number | null;
  latestAttentionAt: number | null;
  nextAttentionAt: number | null;
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
  storage_path: string;
  byte_size: number;
  modified_at: number;
  created_at: number;
}

function toChat(
  row: ChatRow,
  enabledLabels: ConfigurableLabel[] = [],
  summary: ChatSidebarSummary = {
    latestMessagePreview: null,
    nextMessageAt: null,
    latestAttentionAt: null,
    nextAttentionAt: null,
  },
): Chat {
  return {
    id: row.id,
    title: row.title,
    accent: row.accent,
    enabledLabels,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinnedAt: row.pinned_at,
    ...summary,
  };
}

function toAttachment(row: NoteAttachmentRow): NoteAttachment {
  return {
    id: row.id,
    noteId: row.note_id,
    filename: row.filename,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    modifiedAt: row.modified_at,
    createdAt: row.created_at,
    status: "available",
  };
}

function toStoredAttachment(row: NoteAttachmentRow): StoredNoteAttachment {
  return {
    ...toAttachment(row),
    storagePath: row.storage_path,
  };
}

function toNote(
  row: NoteRow,
  attachments: NoteAttachment[] = [],
  labels: Label[] = [],
): Note {
  return {
    id: row.id,
    chatId: row.chat_id,
    body: row.body,
    createdAt: row.created_at,
    labels,
    attachments,
  };
}

export class InvalidAttachmentSelectionError extends Error {
  constructor() {
    super("An attachment selection does not belong to this message.");
    this.name = "InvalidAttachmentSelectionError";
  }
}

export class SqliteChatRepository {
  constructor(private readonly database: Database.Database) {}

  createChat(input: {
    id: string;
    title: string;
    accent: Accent;
    now: number;
  }): Chat {
    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO chats (id, title, accent, created_at, updated_at)
           VALUES (@id, @title, @accent, @now, @now)`,
        )
        .run(input);
      const insertLabel = this.database.prepare(
        `INSERT INTO chat_enabled_labels (chat_id, label) VALUES (?, ?)`,
      );
      for (const label of DEFAULT_ENABLED_LABELS) {
        insertLabel.run(input.id, label);
      }
    });
    create();

    return this.getChat(input.id, input.now)!;
  }

  listChats(now = Date.now()): Chat[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM chats
         ORDER BY pinned_at IS NULL ASC,
                  pinned_at DESC,
                  CASE WHEN pinned_at IS NULL THEN updated_at END DESC,
                  id ASC`,
      )
      .all() as ChatRow[];
    const labelsByChat = this.listEnabledLabelsForChats(
      rows.map((row) => row.id),
    );
    const summariesByChat = this.listSidebarSummariesForChats(
      rows.map((row) => row.id),
      now,
    );
    return rows.map((row) =>
      toChat(row, labelsByChat.get(row.id) ?? [], summariesByChat.get(row.id)),
    );
  }

  getChat(id: string, now = Date.now()): Chat | undefined {
    const row = this.database
      .prepare("SELECT * FROM chats WHERE id = ?")
      .get(id) as ChatRow | undefined;
    if (!row) return undefined;
    return toChat(
      row,
      this.listEnabledLabels(id),
      this.listSidebarSummariesForChats([id], now).get(id),
    );
  }

  updateChat(
    id: string,
    input: {
      title?: string;
      accent?: Accent;
      enabledLabels?: ConfigurableLabel[];
      now: number;
    },
  ): Chat | undefined {
    const update = this.database.transaction(() => {
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
      if (result.changes === 0) return false;
      if (input.enabledLabels !== undefined) {
        this.database
          .prepare("DELETE FROM chat_enabled_labels WHERE chat_id = ?")
          .run(id);
        const insertLabel = this.database.prepare(
          "INSERT INTO chat_enabled_labels (chat_id, label) VALUES (?, ?)",
        );
        for (const label of input.enabledLabels) insertLabel.run(id, label);
      }
      return true;
    });

    return update() ? this.getChat(id, input.now) : undefined;
  }

  setChatPinned(
    id: string,
    pinned: boolean,
    now: number,
  ): ProjectPinState | undefined {
    this.database
      .prepare(
        pinned
          ? `UPDATE chats
             SET pinned_at = COALESCE(pinned_at, @now)
             WHERE id = @id`
          : `UPDATE chats
             SET pinned_at = NULL
             WHERE id = @id`,
      )
      .run({ id, now });
    const row = this.database
      .prepare("SELECT pinned_at FROM chats WHERE id = ?")
      .get(id) as { pinned_at: number | null } | undefined;
    return row ? { pinnedAt: row.pinned_at } : undefined;
  }

  deleteChat(id: string): { deleted: boolean; storagePaths: string[] } {
    const remove = this.database.transaction(() => {
      const storagePaths = this.database
        .prepare(
          `SELECT note_attachments.storage_path
           FROM note_attachments
           INNER JOIN notes ON notes.id = note_attachments.note_id
           WHERE notes.chat_id = ?
           ORDER BY note_attachments.storage_path`,
        )
        .pluck()
        .all(id) as string[];
      this.database.prepare("DELETE FROM notes WHERE chat_id = ?").run(id);
      const result = this.database
        .prepare("DELETE FROM chats WHERE id = ?")
        .run(id);
      return { deleted: result.changes > 0, storagePaths };
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
      storagePath: string;
      byteSize: number;
      modifiedAt: number;
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
             (id, note_id, filename, media_type, storage_path, byte_size, modified_at, created_at)
             VALUES
             (@id, @noteId, @filename, @mediaType, @storagePath, @byteSize, @modifiedAt, @createdAt)`,
          )
          .run({
            ...attachment,
            noteId: input.id,
            createdAt: attachment.createdAt ?? createdAt,
          });
      }
      this.refreshChatActivity(input.chatId, input.now);

      return this.database
        .prepare("SELECT * FROM notes WHERE id = ?")
        .get(input.id) as NoteRow;
    });

    const row = append();
    return row
      ? toNote(row, this.listAttachments(row.id), this.listNoteLabels(row.id))
      : undefined;
  }

  listNotes(chatId: string): Note[] {
    return this.listStoredNotes(chatId);
  }

  listStoredNotes(
    chatId: string,
  ): Array<
    Omit<Note, "attachments"> & { attachments: StoredNoteAttachment[] }
  > {
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
    const attachmentsByNote = new Map<string, StoredNoteAttachment[]>();
    for (const row of attachmentRows) {
      const current = attachmentsByNote.get(row.note_id) ?? [];
      current.push(toStoredAttachment(row));
      attachmentsByNote.set(row.note_id, current);
    }
    const labelsByNote = this.listLabelsForNotes(rows.map((row) => row.id));
    return rows.map((row) => ({
      ...toNote(row),
      attachments: attachmentsByNote.get(row.id) ?? [],
      labels: labelsByNote.get(row.id) ?? [],
    }));
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
        storagePath: string;
        byteSize: number;
        modifiedAt: number;
        createdAt?: number;
      }[];
    },
  ): { note: Note; removedStoragePaths: string[] } | undefined {
    const update = this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT * FROM notes WHERE id = ? AND chat_id = ?")
        .get(noteId, chatId) as NoteRow | undefined;
      if (!existing) return undefined;
      const existingAttachments = this.listStoredAttachments(noteId);
      if (input.keepAttachmentIds !== undefined) {
        const existingAttachmentIds = new Set(
          existingAttachments.map((attachment) => attachment.id),
        );
        if (
          input.keepAttachmentIds.some(
            (attachmentId) => !existingAttachmentIds.has(attachmentId),
          )
        ) {
          throw new InvalidAttachmentSelectionError();
        }
      }

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
              (id, note_id, filename, media_type, storage_path, byte_size, modified_at, created_at)
               VALUES
               (@id, @noteId, @filename, @mediaType, @storagePath, @byteSize, @modifiedAt, @createdAt)`,
            )
            .run({
              ...attachment,
              noteId,
              createdAt:
                attachment.createdAt ?? input.createdAt ?? existing.created_at,
            });
        }
      }
      this.refreshChatActivity(chatId, input.now);

      const row = this.database
        .prepare("SELECT * FROM notes WHERE id = ? AND chat_id = ?")
        .get(noteId, chatId) as NoteRow;
      const kept = new Set(
        input.keepAttachmentIds ??
          existingAttachments.map((attachment) => attachment.id),
      );
      return {
        row,
        removedStoragePaths: existingAttachments
          .filter((attachment) => !kept.has(attachment.id))
          .map((attachment) => attachment.storagePath),
      };
    });

    const result = update();
    return result
      ? {
          note: toNote(
            result.row,
            this.listAttachments(result.row.id),
            this.listNoteLabels(result.row.id),
          ),
          removedStoragePaths: result.removedStoragePaths,
        }
      : undefined;
  }

  deleteNote(
    chatId: string,
    noteId: string,
  ): { deleted: boolean; storagePaths: string[] } {
    const remove = this.database.transaction(() => {
      const storagePaths = this.listStoredAttachments(noteId).map(
        (attachment) => attachment.storagePath,
      );
      const result = this.database
        .prepare("DELETE FROM notes WHERE id = ? AND chat_id = ?")
        .run(noteId, chatId);
      if (result.changes === 0) return { deleted: false, storagePaths: [] };
      this.refreshChatActivity(chatId);
      return { deleted: true, storagePaths };
    });

    return remove();
  }

  setNoteLabel(
    chatId: string,
    noteId: string,
    label: Label,
    applied: boolean,
  ): Label[] | null | undefined {
    const change = this.database.transaction(() => {
      const noteExists = this.database
        .prepare("SELECT 1 FROM notes WHERE id = ? AND chat_id = ?")
        .pluck()
        .get(noteId, chatId);
      if (!noteExists) return undefined;

      if (applied && !PERMANENT_LABELS.includes(label as never)) {
        const enabled = this.database
          .prepare(
            "SELECT 1 FROM chat_enabled_labels WHERE chat_id = ? AND label = ?",
          )
          .pluck()
          .get(chatId, label);
        if (!enabled) return null;
      }

      if (applied) {
        this.database
          .prepare(
            "INSERT OR IGNORE INTO note_labels (note_id, label) VALUES (?, ?)",
          )
          .run(noteId, label);
      } else {
        this.database
          .prepare("DELETE FROM note_labels WHERE note_id = ? AND label = ?")
          .run(noteId, label);
      }
      return this.listNoteLabels(noteId);
    });
    return change();
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

  updateAttachmentMetadata(
    attachmentId: string,
    byteSize: number,
    modifiedAt: number,
  ): void {
    this.database
      .prepare(
        `UPDATE note_attachments
         SET byte_size = ?, modified_at = ?
         WHERE id = ?`,
      )
      .run(byteSize, modifiedAt, attachmentId);
  }

  listAllAttachmentStoragePaths(): string[] {
    return this.database
      .prepare(
        "SELECT storage_path FROM note_attachments ORDER BY storage_path",
      )
      .pluck()
      .all() as string[];
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

  private listStoredAttachments(noteId: string): StoredNoteAttachment[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM note_attachments
         WHERE note_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(noteId) as NoteAttachmentRow[];
    return rows.map(toStoredAttachment);
  }

  private listEnabledLabels(chatId: string): ConfigurableLabel[] {
    return this.listEnabledLabelsForChats([chatId]).get(chatId) ?? [];
  }

  private listSidebarSummariesForChats(
    chatIds: string[],
    now: number,
  ): Map<string, ChatSidebarSummary> {
    const result = new Map<string, ChatSidebarSummary>();
    for (const chatId of chatIds) {
      result.set(chatId, {
        latestMessagePreview: null,
        nextMessageAt: null,
        latestAttentionAt: null,
        nextAttentionAt: null,
      });
    }
    if (chatIds.length === 0) return result;

    const placeholders = chatIds.map(() => "?").join(", ");
    const latestRows = this.database
      .prepare(
        `SELECT chat_id, substr(body, 1, ?) AS latest_message_preview
         FROM (
           SELECT chat_id, body,
                  row_number() OVER (
                    PARTITION BY chat_id
                    ORDER BY created_at DESC, id DESC
                  ) AS row_number
           FROM notes
           WHERE chat_id IN (${placeholders})
             AND created_at <= ?
         )
         WHERE row_number = 1`,
      )
      .all(MAX_PROJECT_PREVIEW_SOURCE_LENGTH, ...chatIds, now) as Array<{
      chat_id: string;
      latest_message_preview: string;
    }>;
    for (const row of latestRows) {
      result.get(row.chat_id)!.latestMessagePreview =
        row.latest_message_preview;
    }

    const futureMessageRows = this.database
      .prepare(
        `SELECT chat_id, min(created_at) AS next_message_at
         FROM notes
         WHERE created_at > ?
           AND chat_id IN (${placeholders})
         GROUP BY chat_id`,
      )
      .all(now, ...chatIds) as Array<{
      chat_id: string;
      next_message_at: number;
    }>;
    for (const row of futureMessageRows) {
      result.get(row.chat_id)!.nextMessageAt = row.next_message_at;
    }

    const attentionRows = this.database
      .prepare(
        `SELECT notes.chat_id,
                max(CASE WHEN notes.created_at <= ? THEN notes.created_at END)
                  AS latest_attention_at,
                min(CASE WHEN notes.created_at > ? THEN notes.created_at END)
                  AS next_attention_at
         FROM notes
         INNER JOIN note_labels ON note_labels.note_id = notes.id
         WHERE note_labels.label = 'attention'
           AND notes.chat_id IN (${placeholders})
         GROUP BY notes.chat_id`,
      )
      .all(now, now, ...chatIds) as Array<{
      chat_id: string;
      latest_attention_at: number | null;
      next_attention_at: number | null;
    }>;
    for (const row of attentionRows) {
      const summary = result.get(row.chat_id)!;
      summary.latestAttentionAt = row.latest_attention_at;
      summary.nextAttentionAt = row.next_attention_at;
    }
    return result;
  }

  private listEnabledLabelsForChats(
    chatIds: string[],
  ): Map<string, ConfigurableLabel[]> {
    const result = new Map<string, ConfigurableLabel[]>();
    if (chatIds.length === 0) return result;
    const placeholders = chatIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        `SELECT chat_id, label FROM chat_enabled_labels
         WHERE chat_id IN (${placeholders})`,
      )
      .all(...chatIds) as Array<{ chat_id: string; label: ConfigurableLabel }>;
    for (const chatId of chatIds) {
      const selected = new Set(
        rows.filter((row) => row.chat_id === chatId).map((row) => row.label),
      );
      result.set(
        chatId,
        CONFIGURABLE_LABELS.filter((label) => selected.has(label)),
      );
    }
    return result;
  }

  private listNoteLabels(noteId: string): Label[] {
    return this.listLabelsForNotes([noteId]).get(noteId) ?? [];
  }

  private listLabelsForNotes(noteIds: string[]): Map<string, Label[]> {
    const result = new Map<string, Label[]>();
    if (noteIds.length === 0) return result;
    const placeholders = noteIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        `SELECT note_id, label FROM note_labels
         WHERE note_id IN (${placeholders})`,
      )
      .all(...noteIds) as Array<{ note_id: string; label: Label }>;
    for (const noteId of noteIds) {
      const selected = new Set(
        rows.filter((row) => row.note_id === noteId).map((row) => row.label),
      );
      result.set(
        noteId,
        LABELS.filter((label) => selected.has(label)),
      );
    }
    return result;
  }
}
