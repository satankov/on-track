import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LATEST_BUNDLED_MIGRATION_AT, openDatabase } from "./database.js";
import { SqliteChatRepository } from "./repository.js";

describe("SQLite project-chat persistence", () => {
  let directory: string;
  let database: Database.Database;
  let repository: SqliteChatRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "on-track-db-"));
    database = openDatabase(join(directory, "on-track.sqlite"));
    repository = new SqliteChatRepository(database);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("migrates an empty database and enforces foreign keys", () => {
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .pluck()
      .all();

    expect(tables).toEqual(
      expect.arrayContaining(["chats", "notes", "__drizzle_migrations"]),
    );
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() =>
      database
        .prepare(
          "INSERT INTO notes (id, chat_id, body, created_at) VALUES (?, ?, ?, ?)",
        )
        .run("note-orphan", "missing", "No parent", 1),
    ).toThrow(/FOREIGN KEY/);
  });

  it("keeps the runtime migration ceiling aligned with the bundled journal", () => {
    const journal = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "drizzle/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: Array<{ when: number }> };
    expect(Math.max(...journal.entries.map((entry) => entry.when))).toBe(
      LATEST_BUNDLED_MIGRATION_AT,
    );
  });

  it.runIf(process.platform !== "win32")(
    "restricts the database file to the current user",
    () => {
      const mode = statSync(join(directory, "on-track.sqlite")).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it("creates, customizes, orders, and reopens persisted chats", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.createChat({
      id: "chat-b",
      title: "Beta",
      accent: "moss",
      now: 200,
    });
    repository.updateChat("chat-a", {
      title: "Alpha launch",
      accent: "ocean",
      now: 300,
    });

    expect(repository.listChats().map((chat) => chat.id)).toEqual([
      "chat-a",
      "chat-b",
    ]);
    expect(repository.getChat("chat-a")).toMatchObject({
      title: "Alpha launch",
      accent: "ocean",
    });

    database.close();
    database = openDatabase(join(directory, "on-track.sqlite"));
    repository = new SqliteChatRepository(database);

    expect(repository.getChat("chat-a")).toMatchObject({
      title: "Alpha launch",
      accent: "ocean",
    });
  });

  it("appends notes in deterministic order and advances chat activity atomically", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.appendNote({
      id: "note-b",
      chatId: "chat-a",
      body: "Second ID",
      now: 200,
    });
    repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "First ID",
      now: 200,
    });

    expect(repository.listNotes("chat-a").map((note) => note.id)).toEqual([
      "note-a",
      "note-b",
    ]);
    expect(repository.getChat("chat-a")?.updatedAt).toBe(200);

    database.exec(`
      CREATE TRIGGER reject_chat_update
      BEFORE UPDATE ON chats
      BEGIN
        SELECT RAISE(ABORT, 'forced update failure');
      END;
    `);

    expect(() =>
      repository.appendNote({
        id: "note-c",
        chatId: "chat-a",
        body: "Rollback me",
        now: 300,
      }),
    ).toThrow(/forced update failure/);
    expect(repository.listNotes("chat-a").map((note) => note.id)).not.toContain(
      "note-c",
    );
    expect(repository.getChat("chat-a")?.updatedAt).toBe(200);
  });

  it("appends a note with a custom past timestamp without rolling back project activity", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.appendNote({
      id: "note-current",
      chatId: "chat-a",
      body: "Current",
      now: 500,
    });

    const backfilled = repository.appendNote({
      id: "note-past",
      chatId: "chat-a",
      body: "Past",
      createdAt: 200,
      now: 700,
    });

    expect(backfilled).toMatchObject({ id: "note-past", createdAt: 200 });
    expect(repository.listNotes("chat-a").map((note) => note.id)).toEqual([
      "note-past",
      "note-current",
    ]);
    expect(repository.getChat("chat-a")?.updatedAt).toBe(500);
  });

  it("updates note body and timestamp while preserving deterministic ordering", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.appendNote({
      id: "note-late",
      chatId: "chat-a",
      body: "Later",
      now: 300,
    });
    repository.appendNote({
      id: "note-early",
      chatId: "chat-a",
      body: "Earlier",
      now: 200,
    });

    const updated = repository.updateNote("chat-a", "note-late", {
      body: "Moved earlier",
      createdAt: 150,
      now: 400,
    });

    expect(updated).toMatchObject({
      id: "note-late",
      body: "Moved earlier",
      createdAt: 150,
    });
    expect(repository.listNotes("chat-a").map((note) => note.id)).toEqual([
      "note-late",
      "note-early",
    ]);
    expect(repository.getChat("chat-a")?.updatedAt).toBe(200);
  });

  it("deletes notes and rolls chat activity back to the newest remaining item", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "First",
      now: 200,
    });
    repository.appendNote({
      id: "note-b",
      chatId: "chat-a",
      body: "Second",
      now: 300,
    });

    expect(repository.deleteNote("chat-a", "note-b")).toBe(true);

    expect(repository.listNotes("chat-a").map((note) => note.id)).toEqual([
      "note-a",
    ]);
    expect(repository.getChat("chat-a")?.updatedAt).toBe(200);
  });

  it("deletes a chat and its notes atomically", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "First",
      now: 200,
    });

    expect(repository.deleteChat("chat-a")).toBe(true);

    expect(repository.getChat("chat-a")).toBeUndefined();
    expect(repository.listNotes("chat-a")).toEqual([]);
    expect(repository.deleteChat("chat-a")).toBe(false);
  });

  it("rejects invalid rows at the database boundary", () => {
    expect(() =>
      database
        .prepare(
          "INSERT INTO chats (id, title, accent, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("invalid", "", "neon", 1, 1),
    ).toThrow(/CHECK constraint/);
  });

  it("refuses to open a database created by a newer schema version", () => {
    const hasMetadata = database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_metadata'",
      )
      .pluck()
      .get();
    if (!hasMetadata) {
      database.exec(`
        CREATE TABLE app_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL
        );
      `);
    }
    database
      .prepare(
        "INSERT OR REPLACE INTO app_metadata (id, schema_version) VALUES (1, 999)",
      )
      .run();
    database.close();

    expect(() => openDatabase(join(directory, "on-track.sqlite"))).toThrow(
      /newer version of On Track/,
    );
    database = new Database(join(directory, "on-track.sqlite"));
  });

  it("refuses an applied migration newer than the bundled migration journal", () => {
    database
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      )
      .run("future-migration", 9_999_999_999_999);
    database.close();

    expect(() => openDatabase(join(directory, "on-track.sqlite"))).toThrow(
      /newer migration/,
    );
    database = new Database(join(directory, "on-track.sqlite"));
  });
});
