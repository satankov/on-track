import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";

/** Restore the original attachment table when constructing a pre-draft fixture. */
export function rewindToSchema14(database: Database.Database): void {
  const version = database
    .prepare("SELECT schema_version FROM app_metadata")
    .pluck()
    .get();
  if (version !== 15) return;
  const columns =
    "id,note_id,filename,media_type,storage_path,byte_size,modified_at,created_at";
  const foreignKeys = database.pragma("foreign_keys", { simple: true });
  database.pragma("foreign_keys=OFF"); // Preserve the bundle payload FK during the table rebuild.
  try {
    database.transaction(() => {
      database.exec(`CREATE TEMP TABLE old_files AS SELECT ${columns} FROM note_attachments WHERE note_id IS NOT NULL;
        DROP TABLE note_attachments; DROP TABLE conversation_drafts;`);
      const schema = readFileSync(
        "drizzle/0002_attachment_messages.sql",
        "utf8",
      );
      for (const statement of schema.split("--> statement-breakpoint")) {
        if (
          statement.trim().startsWith("CREATE TABLE `note_attachments`") ||
          statement
            .trim()
            .startsWith("CREATE INDEX `note_attachments_note_idx`")
        )
          database.exec(statement);
      }
      database.exec(`INSERT INTO note_attachments (${columns}) SELECT ${columns} FROM old_files;
        DROP TABLE old_files;
        DELETE FROM __drizzle_migrations WHERE created_at > 1794908242511;
        UPDATE app_metadata SET schema_version=14;`);
    })();
  } finally {
    database.pragma(foreignKeys ? "foreign_keys=ON" : "foreign_keys=OFF");
  }
}

export function rewindToSchema13(database: Database.Database): void {
  rewindToSchema14(database);
  database.exec(`
    DROP TABLE note_label_snapshots;
    DELETE FROM __drizzle_migrations WHERE created_at > 1794905488811;
    UPDATE app_metadata SET schema_version=13;
  `);
}

export function rewindToSchema12(database: Database.Database): void {
  if (
    (database
      .prepare("SELECT schema_version FROM app_metadata")
      .pluck()
      .get() as number) >= 14
  )
    rewindToSchema13(database);
  database.exec(`
    ALTER TABLE chats DROP COLUMN accent_style;
    DELETE FROM __drizzle_migrations WHERE created_at > 1794839960460;
    UPDATE app_metadata SET schema_version=12;
  `);
}

/** Remove the additive v0.2.1 fields when constructing a v0.2.0 fixture. */
export function rewindToSchema11(database: Database.Database): void {
  if (
    Number(
      database.prepare("SELECT schema_version FROM app_metadata").pluck().get(),
    ) >= 13
  )
    rewindToSchema12(database);
  database.exec(`
    ALTER TABLE chats DROP COLUMN manual_alert;
    ALTER TABLE workspace_preferences DROP COLUMN always_show_message_time;
    DELETE FROM __drizzle_migrations WHERE created_at > 1793608243633;
    UPDATE app_metadata SET schema_version=11;
  `);
}

/** Test-only reconstruction of the shipped schema-7 label model. */
export function rewindToSchema7(database: Database.Database): void {
  const version = database
    .prepare("SELECT schema_version FROM app_metadata")
    .pluck()
    .get() as number;
  if (version >= 12) rewindToSchema11(database);
  if (version >= 10) {
    database.exec(
      "DROP TABLE subthread_origins; DROP INDEX chats_project_idx; ALTER TABLE chats DROP COLUMN project_id;",
    );
  }
  if (version >= 9) {
    const enabled = database
      .prepare(
        "SELECT chat_id,id AS label FROM project_labels WHERE builtin=1 AND enabled=1 AND id NOT IN ('pin','attention')",
      )
      .all() as { chat_id: string; label: string }[];
    const assignments = database
      .prepare("SELECT note_id,label FROM note_labels")
      .all() as { note_id: string; label: string }[];
    database.exec(
      "DROP TABLE note_labels; DROP TABLE project_labels; DROP INDEX notes_project_identity; ALTER TABLE chats DROP COLUMN label_configuration_revision;",
    );
    for (const statement of readFileSync(
      "drizzle/0003_project_message_labels.sql",
      "utf8",
    ).split("--> statement-breakpoint")) {
      if (statement.trim().startsWith("CREATE TABLE")) database.exec(statement);
    }
    const insertEnabled = database.prepare(
      "INSERT INTO chat_enabled_labels (chat_id,label) VALUES (@chat_id,@label)",
    );
    for (const row of enabled) insertEnabled.run(row);
    const insertAssignment = database.prepare(
      "INSERT INTO note_labels (note_id,label) VALUES (@note_id,@label)",
    );
    for (const row of assignments) insertAssignment.run(row);
  }
  if (version >= 8) database.exec("DROP TABLE workspace_preferences;");
  database.exec(
    "DELETE FROM __drizzle_migrations WHERE created_at > 1789027200000; UPDATE app_metadata SET schema_version=7;",
  );
}
