import type Database from "better-sqlite3";

/** Test-only reconstruction of the shipped schema-7 model. */
export function rewindToSchema7(database: Database.Database): void {
  const version = database
    .prepare("SELECT schema_version FROM app_metadata")
    .pluck()
    .get() as number;
  if (version >= 8) database.exec("DROP TABLE workspace_preferences;");
  database.exec(
    "DELETE FROM __drizzle_migrations WHERE created_at > 1789027200000; UPDATE app_metadata SET schema_version=7;",
  );
}
