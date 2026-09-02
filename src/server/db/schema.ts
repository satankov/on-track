import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const accentCheck =
  "accent IN ('coral', 'amber', 'moss', 'ocean', 'iris', 'slate')";

export const appMetadata = sqliteTable(
  "app_metadata",
  {
    id: integer("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
  },
  (table) => [
    check("app_metadata_single_row", sql`${table.id} = 1`),
    check("app_metadata_version_positive", sql`${table.schemaVersion} >= 1`),
  ],
);

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    accent: text("accent").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "chats_title_length",
      sql`length(trim(${table.title})) BETWEEN 1 AND 80`,
    ),
    check("chats_accent_allowed", sql.raw(accentCheck)),
    index("chats_activity_idx").on(table.updatedAt, table.id),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check("notes_body_length", sql`length(${table.body}) <= 10000`),
    index("notes_chat_history_idx").on(table.chatId, table.createdAt, table.id),
  ],
);

export const noteAttachments = sqliteTable(
  "note_attachments",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    storagePath: text("storage_path").notNull().unique(),
    byteSize: integer("byte_size").notNull(),
    modifiedAt: integer("modified_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check(
      "note_attachments_filename_length",
      sql`length(trim(${table.filename})) BETWEEN 1 AND 255`,
    ),
    check(
      "note_attachments_media_type_length",
      sql`length(trim(${table.mediaType})) BETWEEN 1 AND 255`,
    ),
    check(
      "note_attachments_storage_path_length",
      sql`length(${table.storagePath}) BETWEEN 1 AND 1024`,
    ),
    check(
      "note_attachments_byte_size_nonnegative",
      sql`${table.byteSize} >= 0`,
    ),
    check(
      "note_attachments_modified_at_nonnegative",
      sql`${table.modifiedAt} >= 0`,
    ),
    index("note_attachments_note_idx").on(
      table.noteId,
      table.createdAt,
      table.id,
    ),
  ],
);
