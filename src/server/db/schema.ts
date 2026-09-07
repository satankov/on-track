import {
  check,
  index,
  integer,
  primaryKey,
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
    pinnedAt: integer("pinned_at"),
    collapseLongMessages: integer("collapse_long_messages", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
  },
  (table) => [
    check(
      "chats_title_length",
      sql`length(trim(${table.title})) BETWEEN 1 AND 80`,
    ),
    check("chats_accent_allowed", sql.raw(accentCheck)),
    check(
      "chats_pinned_at_nonnegative",
      sql`${table.pinnedAt} IS NULL OR ${table.pinnedAt} >= 0`,
    ),
    check(
      "chats_collapse_long_messages_boolean",
      sql`${table.collapseLongMessages} IN (0, 1)`,
    ),
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
    sender: text("sender"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check("notes_body_length", sql`length(${table.body}) <= 10000`),
    check(
      "notes_sender_length",
      sql`${table.sender} IS NULL OR (${table.sender} = trim(${table.sender}, ' ' || char(9) || char(10) || char(11) || char(12) || char(13) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279)) AND length(${table.sender}) BETWEEN 1 AND 80)`,
    ),
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

export const chatEnabledLabels = sqliteTable(
  "chat_enabled_labels",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.label] }),
    check(
      "chat_enabled_labels_label_allowed",
      sql`${table.label} IN ('todo', 'decision', 'open-question', 'risk', 'milestone')`,
    ),
  ],
);

export const noteLabels = sqliteTable(
  "note_labels",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.label] }),
    check(
      "note_labels_label_allowed",
      sql`${table.label} IN ('pin', 'attention', 'todo', 'decision', 'open-question', 'risk', 'milestone')`,
    ),
  ],
);
