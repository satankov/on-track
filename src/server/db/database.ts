import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const CURRENT_SCHEMA_VERSION = 3;
// Keep in sync with the newest `when` value in drizzle/meta/_journal.json.
export const LATEST_BUNDLED_MIGRATION_AT = 1_788_356_400_000;

export function applyBundledMigrations(sqlite: Database.Database): void {
  migrate(drizzle(sqlite), {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
  });
}

export function openDatabase(filename: string): Database.Database {
  const directory = dirname(filename);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const sqlite = new Database(filename);
  chmodSync(filename, 0o600);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  try {
    const attachmentColumns = sqlite
      .prepare("SELECT name FROM pragma_table_info('note_attachments')")
      .pluck()
      .all() as string[];
    if (attachmentColumns.includes("content")) {
      throw new Error(
        "This database uses the obsolete development attachment schema. Reset local data in the On Track data directory before continuing; unreleased BLOB attachments are not migrated.",
      );
    }
    sqlite.pragma("journal_mode = WAL");
    const hasMigrationTable = sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
      )
      .pluck()
      .get();
    if (hasMigrationTable) {
      const latestAppliedMigration = sqlite
        .prepare("SELECT max(created_at) FROM __drizzle_migrations")
        .pluck()
        .get() as number | null;
      if (
        latestAppliedMigration !== null &&
        latestAppliedMigration > LATEST_BUNDLED_MIGRATION_AT
      ) {
        throw new Error(
          "This database contains a newer migration. Upgrade On Track before opening it.",
        );
      }
    }

    applyBundledMigrations(sqlite);
    const schemaVersion = sqlite
      .prepare("SELECT schema_version FROM app_metadata WHERE id = 1")
      .pluck()
      .get() as number | undefined;
    if (schemaVersion === undefined) {
      throw new Error("On Track database schema metadata is missing");
    }
    if (schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        "This database was created by a newer version of On Track. Upgrade the application before opening it.",
      );
    }
    if (schemaVersion < CURRENT_SCHEMA_VERSION) {
      throw new Error("On Track database migrations did not complete");
    }
    for (const sidecar of [`${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(sidecar)) chmodSync(sidecar, 0o600);
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  if (sqlite.pragma("foreign_keys", { simple: true }) !== 1) {
    sqlite.close();
    throw new Error("SQLite foreign-key enforcement is unavailable");
  }

  return sqlite;
}
