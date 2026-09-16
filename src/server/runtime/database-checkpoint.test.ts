import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../db/database.js";
import { afterEach, expect, it } from "vitest";
import {
  checkpointPath,
  createDatabaseCheckpoint,
  restoreDatabaseCheckpoint,
  validateDatabaseCheckpoint,
} from "./database-checkpoint.js";

const roots: string[] = [];
const connections: Database.Database[] = [];
function fixture() {
  const dataDirectory = mkdtempSync(join(tmpdir(), "threadstr-checkpoint-"));
  roots.push(dataDirectory);
  const databasePath = join(dataDirectory, "on-track.sqlite");
  const sqlite = new Database(databasePath);
  connections.push(sqlite);
  chmodSync(databasePath, 0o600);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(
    "CREATE TABLE app_metadata(id INTEGER PRIMARY KEY, schema_version INTEGER); INSERT INTO app_metadata VALUES(1, 7); CREATE TABLE __drizzle_migrations(created_at INTEGER); INSERT INTO __drizzle_migrations VALUES(1789027200000); CREATE TABLE notes(id TEXT PRIMARY KEY, body TEXT, attachment TEXT); INSERT INTO notes VALUES('note-1', 'Saved WAL content', 'missing.txt')",
  );
  const transactionId = randomUUID();
  return {
    dataDirectory,
    databasePath,
    sqlite,
    transactionId,
    expectedSchemaVersion: 7,
    expectedMigrationMarker: 1789027200000,
  };
}
afterEach(() => {
  for (const connection of connections.splice(0))
    if (connection.open) connection.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("snapshots committed WAL contents without migrations or attachment reads", async () => {
  const options = fixture();
  const attachment = join(options.dataDirectory, "attachment.bin");
  writeFileSync(attachment, "unchanged");
  const checkpoint = await createDatabaseCheckpoint(options);
  expect(checkpoint).toMatchObject({
    transactionId: options.transactionId,
    schemaVersion: 7,
    migrationMarker: 1789027200000,
  });
  expect(checkpoint.sha256).toMatch(/^[a-f0-9]{64}$/);
  const snapshot = new Database(
    join(
      options.dataDirectory,
      `.on-track-update-${options.transactionId}.sqlite`,
    ),
    { readonly: true },
  );
  connections.push(snapshot);
  expect(snapshot.prepare("SELECT * FROM notes").get()).toEqual({
    id: "note-1",
    body: "Saved WAL content",
    attachment: "missing.txt",
  });
  expect(readFileSync(attachment, "utf8")).toBe("unchanged");
  expect(() => snapshot.prepare("SELECT * FROM projects")).toThrow();
});

it.each([
  "after_copy",
  "after_sidecars_removed",
  "after_database_replaced",
] as const)(
  "recovers repeatedly after an interruption at %s",
  async (point) => {
    const options = fixture();
    const checkpoint = await createDatabaseCheckpoint(options);
    options.sqlite.exec(
      "ALTER TABLE notes ADD COLUMN migrated TEXT; UPDATE app_metadata SET schema_version = 8; INSERT INTO __drizzle_migrations VALUES(1789027200001)",
    );
    options.sqlite.close();
    // These represent the terminated candidate's leftovers. No connection is open.
    for (const suffix of ["-wal", "-shm", "-journal"])
      writeFileSync(`${options.databasePath}${suffix}`, "candidate leftovers", {
        mode: 0o600,
      });
    expect(() =>
      restoreDatabaseCheckpoint({
        ...options,
        checkpoint,
        failpoint(current) {
          if (current === point) throw new Error("simulated interruption");
        },
      }),
    ).toThrow("simulated interruption");
    restoreDatabaseCheckpoint({ ...options, checkpoint });
    restoreDatabaseCheckpoint({ ...options, checkpoint });
    const restored = new Database(options.databasePath);
    connections.push(restored);
    expect(restored.prepare("SELECT * FROM notes").get()).toEqual({
      id: "note-1",
      body: "Saved WAL content",
      attachment: "missing.txt",
    });
    expect(
      restored.prepare("SELECT schema_version FROM app_metadata").pluck().get(),
    ).toBe(7);
    expect(existsSync(`${options.databasePath}-wal`)).toBe(false);
    expect(existsSync(`${options.databasePath}-shm`)).toBe(false);
  },
);

it("refuses corrupt snapshots before modifying the live database or sidecars", async () => {
  const options = fixture();
  const checkpoint = await createDatabaseCheckpoint(options);
  options.sqlite.close();
  writeFileSync(
    checkpointPath(options.dataDirectory, checkpoint.transactionId),
    "corrupt",
  );
  const before = readFileSync(options.databasePath);
  writeFileSync(`${options.databasePath}-wal`, "retained", { mode: 0o600 });
  expect(() => restoreDatabaseCheckpoint({ ...options, checkpoint })).toThrow(
    /integrity/,
  );
  expect(readFileSync(options.databasePath)).toEqual(before);
  expect(readFileSync(`${options.databasePath}-wal`, "utf8")).toBe("retained");
});

it("rejects a checkpoint with sidecars even when its main-file hash matches", async () => {
  const options = fixture();
  const checkpoint = await createDatabaseCheckpoint(options);
  writeFileSync(
    `${checkpointPath(options.dataDirectory, checkpoint.transactionId)}-wal`,
    "untrusted",
    { mode: 0o600 },
  );
  expect(() =>
    validateDatabaseCheckpoint(options.dataDirectory, checkpoint),
  ).toThrow(/sidecars/);
});

it("refuses duplicate checkpoints and incorrect schema identities without running migrations", async () => {
  const options = fixture();
  await createDatabaseCheckpoint(options);
  await expect(createDatabaseCheckpoint(options)).rejects.toThrow(/EEXIST/);
  await expect(
    createDatabaseCheckpoint({
      ...options,
      transactionId: randomUUID(),
      expectedSchemaVersion: 8,
    }),
  ).rejects.toThrow(/schema/);
  expect(
    options.sqlite
      .prepare("SELECT schema_version FROM app_metadata")
      .pluck()
      .get(),
  ).toBe(7);
});

it("refuses checkpoint paths outside the owned directory and symbolic-link sidecars", async () => {
  const options = fixture();
  await expect(
    createDatabaseCheckpoint({ ...options, transactionId: "../escape" }),
  ).rejects.toThrow(/identity/);
  await expect(
    createDatabaseCheckpoint({ ...options, dataDirectory: tmpdir() }),
  ).rejects.toThrow(/direct child/);
  const checkpoint = await createDatabaseCheckpoint(options);
  options.sqlite.close();
  const outside = join(options.dataDirectory, "not-a-sidecar");
  writeFileSync(outside, "preserve", { mode: 0o600 });
  symlinkSync(outside, `${options.databasePath}-wal`);
  expect(() => restoreDatabaseCheckpoint({ ...options, checkpoint })).toThrow(
    /Unsafe/,
  );
  expect(readFileSync(outside, "utf8")).toBe("preserve");
});

it("round-trips the actual released schema 6 through bundled schema 7 migration and recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "threadstr-schema-update-"));
  roots.push(directory);
  const migrationsFolder = join(directory, "old-migrations");
  mkdirSync(join(migrationsFolder, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string; when: number }> };
  const oldEntries = journal.entries.filter(
    (entry) => entry.when <= 1788566400000,
  );
  for (const entry of oldEntries)
    copyFileSync(
      join(process.cwd(), "drizzle", `${entry.tag}.sql`),
      join(migrationsFolder, `${entry.tag}.sql`),
    );
  writeFileSync(
    join(migrationsFolder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: oldEntries }),
  );
  const databasePath = join(directory, "on-track.sqlite");
  const old = new Database(databasePath);
  connections.push(old);
  chmodSync(databasePath, 0o600);
  migrate(drizzle(old), { migrationsFolder });
  old.pragma("journal_mode = WAL");
  old.exec(
    "INSERT INTO chats(id,title,accent,created_at,updated_at,pinned_at) VALUES('project','Keep project','ocean',10,20,30); INSERT INTO notes(id,chat_id,body,created_at,sender) VALUES('note','project','Keep sender and message',20,'Alex'); INSERT INTO note_attachments(id,note_id,filename,media_type,storage_path,byte_size,modified_at,created_at) VALUES('missing','note','missing.txt','text/plain','attachments/v1/missing/file.txt',15,20,20)",
  );
  const beforeChat = old.prepare("SELECT * FROM chats").get();
  const beforeNote = old.prepare("SELECT * FROM notes").get();
  const beforeAttachment = old.prepare("SELECT * FROM note_attachments").get();
  const checkpoint = await createDatabaseCheckpoint({
    dataDirectory: directory,
    databasePath,
    transactionId: randomUUID(),
    expectedSchemaVersion: 6,
    expectedMigrationMarker: 1788566400000,
  });
  old.close();
  const candidate = openDatabase(databasePath);
  connections.push(candidate);
  expect(
    candidate.prepare("SELECT schema_version FROM app_metadata").pluck().get(),
  ).toBe(7);
  expect(candidate.prepare("SELECT * FROM notes").get()).toEqual(beforeNote);
  candidate.close();
  restoreDatabaseCheckpoint({
    dataDirectory: directory,
    databasePath,
    checkpoint,
  });
  const restored = new Database(databasePath);
  connections.push(restored);
  expect(
    restored.prepare("SELECT schema_version FROM app_metadata").pluck().get(),
  ).toBe(6);
  expect(restored.prepare("SELECT * FROM chats").get()).toEqual(beforeChat);
  expect(restored.prepare("SELECT * FROM notes").get()).toEqual(beforeNote);
  expect(restored.prepare("SELECT * FROM note_attachments").get()).toEqual(
    beforeAttachment,
  );
});
