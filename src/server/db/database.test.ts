import { rewindToSchema7 } from "../../test/legacy-database.js";
import {
  createV010Database,
  readV010Rows,
  V010_FILE,
  V010_MIGRATION_MARKER,
} from "../../test/released-v010.js";
import { DEFAULT_PREFERENCES } from "../../domain/preferences.js";
import { readPreferences } from "./preferences.js";
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
    directory = mkdtempSync(join(tmpdir(), "threadstr-db-"));
    database = openDatabase(join(directory, "on-track.sqlite"));
    repository = new SqliteChatRepository(database);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("upgrades forward-built v0.1.0 data to schema 9 without losing released state on restart", () => {
    const released = createV010Database(join(directory, "released"), {
      missingAttachment: true,
    });
    const before = readV010Rows(released.sqlite);
    expect(
      released.sqlite
        .prepare("SELECT schema_version FROM app_metadata")
        .pluck()
        .get(),
    ).toBe(7);
    expect(
      released.sqlite
        .prepare("SELECT max(created_at) FROM __drizzle_migrations")
        .pluck()
        .get(),
    ).toBe(V010_MIGRATION_MARKER);
    released.sqlite.close();
    for (let restart = 0; restart < 2; restart++) {
      database.close();
      database = openDatabase(released.databasePath);
      repository = new SqliteChatRepository(database);
      expect(readV010Rows(database)).toEqual(before);
      expect(
        database
          .prepare("SELECT schema_version FROM app_metadata")
          .pluck()
          .get(),
      ).toBe(9);
      expect(
        database
          .prepare("SELECT max(created_at) FROM __drizzle_migrations")
          .pluck()
          .get(),
      ).toBe(LATEST_BUNDLED_MIGRATION_AT);
      expect(repository.getChat("release-archive")).toMatchObject({
        enabledLabels: ["risk"],
        labelConfigurationRevision: 0,
        archivedAt: 50,
        pinnedAt: null,
        collapseLongMessages: false,
      });
      const definitions =
        repository.getChat("release-archive")!.labelDefinitions!;
      expect(definitions).toHaveLength(7);
      expect(definitions.find((label) => label.id === "todo")!.enabled).toBe(
        false,
      );
      expect(repository.listNotes("release-archive")[0]!.labels).toEqual([
        "attention",
        "todo",
      ]);
      expect(repository.getChat("release-pinned")!.pinnedAt).toBe(45);
      expect(readPreferences(database)).toEqual(DEFAULT_PREFERENCES);
      expect(
        readFileSync(join(released.dataDirectory, V010_FILE.path), "utf8"),
      ).toBe(V010_FILE.content);
      expect(database.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(database.pragma("foreign_key_check")).toEqual([]);
    }
  });

  it("migrates schema 7 with inactive assignments and enforces project-owned label references", () => {
    repository.createChat({ id: "a", title: "A", accent: "ocean", now: 10 });
    repository.createChat({ id: "b", title: "B", accent: "ocean", now: 10 });
    repository.appendNote({ id: "n", chatId: "a", body: "Keep", now: 20 });
    repository.setNoteLabel("a", "n", "todo", true);
    repository.updateChat("a", { enabledLabels: [], now: 30 });
    rewindToSchema7(database);
    database.close();
    database = openDatabase(join(directory, "on-track.sqlite"));
    repository = new SqliteChatRepository(database);
    expect(repository.listNotes("a")[0]!.labels).toEqual(["todo"]);
    expect(repository.getChat("a")!.enabledLabels).toEqual([]);
    expect(repository.getChat("a")!.labelDefinitions).toHaveLength(7);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(() =>
      database
        .prepare(
          "INSERT INTO note_labels(note_id,chat_id,label) VALUES('n','b','pin')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      database
        .prepare(
          "INSERT INTO note_labels(note_id,chat_id,label) VALUES('n','a','unknown')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("preserves custom enablement when an old client updates built-in labels", () => {
    const chat = repository.createChat({
      id: "a",
      title: "A",
      accent: "ocean",
      now: 10,
    });
    repository.updateChat("a", {
      now: 20,
      labelConfiguration: {
        revision: 0,
        labels: [
          ...chat.labelDefinitions!.map(({ id, name, symbol, enabled }) => ({
            id,
            name,
            symbol,
            enabled,
          })),
          { name: "Review", symbol: null, enabled: true },
        ],
      },
    });
    const updated = repository.updateChat("a", { enabledLabels: [], now: 30 })!;
    expect(
      updated.labelDefinitions!.find((label) => label.name === "Review")!
        .enabled,
    ).toBe(true);
    expect(
      updated.labelDefinitions!.find((label) => label.id === "todo")!.enabled,
    ).toBe(false);
  });

  it("rolls back a stale label configuration and preserves activity for full-form label-only edits", () => {
    const chat = repository.createChat({
      id: "a",
      title: "A",
      accent: "ocean",
      now: 10,
    });
    const labels = chat.labelDefinitions!.map(
      ({ id, name, symbol, enabled }) => ({ id, name, symbol, enabled }),
    );
    const updated = repository.updateChat("a", {
      title: "A",
      accent: "ocean",
      collapseLongMessages: true,
      labelConfiguration: {
        revision: 0,
        labels: [...labels, { name: "Review", symbol: null, enabled: true }],
      },
      now: 40,
    })!;
    expect(updated.updatedAt).toBe(10);
    expect(updated.labelConfigurationRevision).toBe(1);
    expect(() =>
      repository.updateChat("a", {
        title: "Stale",
        labelConfiguration: { revision: 0, labels },
        now: 50,
      }),
    ).toThrow();
    expect(repository.getChat("a")!.title).toBe("A");
    expect(repository.getChat("a")!.labelDefinitions).toHaveLength(8);
  });

  it("removes omitted custom labels and only their assignments atomically", () => {
    const chat = repository.createChat({
      id: "a",
      title: "A",
      accent: "ocean",
      now: 10,
    });
    const builtins = chat.labelDefinitions!.map(
      ({ id, name, symbol, enabled }) => ({ id, name, symbol, enabled }),
    );
    const project = repository.updateChat("a", {
      now: 20,
      labelConfiguration: {
        revision: 0,
        labels: [
          ...builtins,
          { name: "Review", symbol: null, enabled: true },
          { name: "Ready", symbol: null, enabled: true },
        ],
      },
    })!;
    const removed = project.labelDefinitions!.find(
      (label) => label.name === "Review",
    )!;
    const retained = project.labelDefinitions!.find(
      (label) => label.name === "Ready",
    )!;
    repository.appendNote({
      id: "n",
      chatId: "a",
      body: "Keep this message",
      now: 30,
    });
    for (const id of [removed.id, retained.id, "pin"] as const)
      repository.setNoteLabel("a", "n", id, true);
    const config = {
      revision: 1,
      labels: [
        ...builtins,
        {
          id: retained.id,
          name: retained.name,
          symbol: retained.symbol,
          enabled: true,
        },
      ],
    };
    database.exec(
      "CREATE TRIGGER fail_label_update BEFORE UPDATE OF name ON project_labels BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    expect(() =>
      repository.updateChat("a", {
        title: "Changed",
        now: 40,
        labelConfiguration: config,
      }),
    ).toThrow("test rollback");
    expect(repository.getChat("a")!.title).toBe("A");
    expect(repository.listNotes("a")[0]!.labels).toContain(removed.id);
    database.exec("DROP TRIGGER fail_label_update");
    const updated = repository.updateChat("a", {
      now: 40,
      labelConfiguration: config,
    })!;
    expect(updated.labelDefinitions!.map((label) => label.id)).not.toContain(
      removed.id,
    );
    expect(updated.labelConfigurationRevision).toBe(2);
    expect(repository.listNotes("a")[0]).toMatchObject({
      body: "Keep this message",
      labels: ["pin", retained.id],
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(() =>
      repository.updateChat("a", { now: 50, labelConfiguration: config }),
    ).toThrow();
    expect(() =>
      repository.updateChat("a", {
        now: 50,
        labelConfiguration: { revision: 2, labels: builtins.slice(1) },
      }),
    ).toThrow();
    expect(() =>
      repository.updateChat("a", {
        now: 50,
        labelConfiguration: {
          revision: 2,
          labels: [
            ...builtins,
            { id: removed.id, name: "Review", symbol: null, enabled: true },
          ],
        },
      }),
    ).toThrow();
  });

  it("disables schema use of application functions on live connections", () => {
    const calls: string[] = [];
    database.function("application_function", () => {
      calls.push("called");
      return 1;
    });
    database.exec(
      "CREATE VIEW unsafe_view AS SELECT application_function() AS value",
    );
    expect(() => database.prepare("SELECT * FROM unsafe_view").all()).toThrow(
      /unsafe use/i,
    );
    expect(calls).toEqual([]);
  });

  it("persists archive membership with exclusive groups and unchanged content", () => {
    for (const id of ["a", "b", "c", "d"])
      repository.createChat({ id, title: id, accent: "ocean", now: 10 });
    repository.appendNote({
      id: "note",
      chatId: "a",
      body: "Keep me",
      sender: "Maya",
      now: 20,
    });
    expect(repository.getChat("a")?.archivedAt).toBeNull();
    repository.setChatPinned("a", true, 30);
    repository.setChatPinned("d", true, 30);
    expect(repository.setChatArchived("a", true, 40)).toEqual({
      archivedAt: 40,
      pinnedAt: null,
    });
    expect(repository.setChatArchived("a", true, 50)).toEqual({
      archivedAt: 40,
      pinnedAt: null,
    });
    repository.setChatArchived("b", true, 40);
    expect(repository.listChats().map((chat) => chat.id)).toEqual([
      "d",
      "c",
      "a",
      "b",
    ]);
    repository.appendNote({
      id: "new-note",
      chatId: "b",
      body: "Still editable",
      now: 60,
    });
    expect(repository.listChats().map((chat) => chat.id)).toEqual([
      "d",
      "c",
      "a",
      "b",
    ]);
    for (const value of [-1, 1.5, "bad", 9007199254740992]) {
      expect(() =>
        database
          .prepare("UPDATE chats SET archived_at = ? WHERE id = 'a'")
          .run(value),
      ).toThrow();
    }
    expect(() =>
      database.prepare("UPDATE chats SET pinned_at = 1 WHERE id = 'a'").run(),
    ).toThrow();
    expect(repository.setChatArchived("missing", true, 1)).toBeUndefined();
    database.close();
    database = openDatabase(join(directory, "on-track.sqlite"));
    repository = new SqliteChatRepository(database);
    expect(repository.getChat("a")).toMatchObject({
      archivedAt: 40,
      pinnedAt: null,
      updatedAt: 20,
    });
    expect(repository.listNotes("a")[0]).toMatchObject({
      body: "Keep me",
      sender: "Maya",
    });
    expect(repository.setChatArchived("a", false, 70)).toEqual({
      archivedAt: null,
      pinnedAt: null,
    });
    expect(repository.setChatArchived("a", false, 80)).toEqual({
      archivedAt: null,
      pinnedAt: null,
    });
    expect(repository.getChat("a")?.updatedAt).toBe(20);
    expect(repository.listChats().map((chat) => chat.id)).toEqual([
      "d",
      "a",
      "c",
      "b",
    ]);
  });

  it("migrates schema 6 without disturbing pins or notes", () => {
    repository.createChat({
      id: "a",
      title: "Legacy",
      accent: "ocean",
      now: 10,
    });
    repository.setChatPinned("a", true, 20);
    repository.appendNote({
      id: "note",
      chatId: "a",
      body: "Retained",
      sender: "Maya",
      now: 30,
    });
    rewindToSchema7(database);
    database.exec(`ALTER TABLE chats DROP COLUMN archived_at;
      DELETE FROM __drizzle_migrations WHERE created_at = 1789027200000;
      UPDATE app_metadata SET schema_version = 6;`);
    database.close();
    database = openDatabase(join(directory, "on-track.sqlite"));
    repository = new SqliteChatRepository(database);
    expect(repository.getChat("a")).toMatchObject({
      archivedAt: null,
      pinnedAt: 20,
      updatedAt: 30,
    });
    expect(repository.listNotes("a")[0]).toMatchObject({
      body: "Retained",
      sender: "Maya",
    });
  });

  it("migrates an empty database and enforces foreign keys", () => {
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .pluck()
      .all();

    expect(tables).toEqual(
      expect.arrayContaining([
        "chats",
        "notes",
        "note_attachments",
        "__drizzle_migrations",
      ]),
    );
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(
      database
        .prepare("SELECT name FROM pragma_table_info('note_attachments')")
        .pluck()
        .all(),
    ).toEqual([
      "id",
      "note_id",
      "filename",
      "media_type",
      "storage_path",
      "byte_size",
      "modified_at",
      "created_at",
    ]);
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

  it("migrates an existing schema-3 database with project defaults intact", () => {
    const databasePath = join(directory, "on-track.sqlite");
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "Legacy note",
      now: 101,
    });
    database.close();
    const legacy = new Database(databasePath);
    rewindToSchema7(legacy);
    legacy.exec(`
      ALTER TABLE chats DROP COLUMN archived_at;
      ALTER TABLE chats DROP COLUMN collapse_long_messages;
      ALTER TABLE chats DROP COLUMN pinned_at;
      ALTER TABLE notes DROP COLUMN sender;
      UPDATE app_metadata SET schema_version = 3 WHERE id = 1;
      DELETE FROM __drizzle_migrations
      WHERE created_at IN (1788516961034, 1788523044823, 1788566400000, 1789027200000);
    `);
    legacy.close();

    database = openDatabase(databasePath);
    repository = new SqliteChatRepository(database);

    expect(
      database
        .prepare("SELECT schema_version FROM app_metadata WHERE id = 1")
        .pluck()
        .get(),
    ).toBe(9);
    expect(repository.getChat("chat-a")?.pinnedAt).toBeNull();
    expect(repository.getChat("chat-a")?.collapseLongMessages).toBe(true);
    expect(repository.listNotes("chat-a")).toMatchObject([
      { id: "note-a", body: "Legacy note", sender: null },
    ]);
  });

  it("enforces normalized nonblank participant senders at the database boundary", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });

    for (const sender of ["\t", "\u00a0", " Maya Chen", "Maya Chen\u3000"]) {
      expect(() =>
        repository.appendNote({
          id: `note-${sender.codePointAt(0)}`,
          chatId: "chat-a",
          body: "Invalid sender",
          sender,
          now: 101,
        }),
      ).toThrow(/CHECK constraint failed/);
    }
    expect(
      repository.appendNote({
        id: "note-valid",
        chatId: "chat-a",
        body: "Valid sender",
        sender: "Maya\tChen",
        now: 102,
      }),
    ).toMatchObject({ sender: "Maya\tChen" });
  });

  it.runIf(process.platform !== "win32")(
    "restricts the database file to the current user",
    () => {
      const mode = statSync(join(directory, "on-track.sqlite")).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it("creates, customizes, orders, and reopens persisted chats", () => {
    const created = repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    expect(created.collapseLongMessages).toBe(true);
    repository.createChat({
      id: "chat-b",
      title: "Beta",
      accent: "moss",
      now: 200,
    });
    repository.updateChat("chat-a", {
      title: "Alpha launch",
      accent: "ocean",
      collapseLongMessages: false,
      now: 300,
    });

    expect(repository.listChats().map((chat) => chat.id)).toEqual([
      "chat-a",
      "chat-b",
    ]);
    expect(repository.getChat("chat-a")).toMatchObject({
      title: "Alpha launch",
      accent: "ocean",
      collapseLongMessages: false,
    });

    database.close();
    database = openDatabase(join(directory, "on-track.sqlite"));
    repository = new SqliteChatRepository(database);

    expect(repository.getChat("chat-a")).toMatchObject({
      title: "Alpha launch",
      accent: "ocean",
      collapseLongMessages: false,
    });
    expect(() =>
      database
        .prepare(
          "UPDATE chats SET collapse_long_messages = 2 WHERE id = 'chat-a'",
        )
        .run(),
    ).toThrow(/CHECK constraint/);
  });

  it("persists stable project pins and batches sidebar message and Attention summaries", () => {
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
    repository.createChat({
      id: "chat-c",
      title: "Gamma",
      accent: "ocean",
      now: 300,
    });
    repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "Earlier preview",
      createdAt: 400,
      now: 400,
    });
    repository.appendNote({
      id: "note-b",
      chatId: "chat-a",
      body: `${"Latest preview ".repeat(50)}end`,
      createdAt: 400,
      now: 400,
    });
    repository.appendNote({
      id: "note-old-attention",
      chatId: "chat-b",
      body: "Old attention",
      createdAt: 250,
      now: 500,
    });
    repository.appendNote({
      id: "note-future-attention",
      chatId: "chat-b",
      body: "Future attention",
      createdAt: 1_500,
      now: 500,
    });
    repository.setNoteLabel("chat-b", "note-old-attention", "attention", true);
    repository.setNoteLabel(
      "chat-b",
      "note-future-attention",
      "attention",
      true,
    );

    const betaActivity = repository.getChat("chat-b", 500)!.updatedAt;
    expect(repository.setChatPinned("chat-b", true, 600)).toEqual({
      pinnedAt: 600,
    });
    expect(repository.setChatPinned("chat-b", true, 900)).toEqual({
      pinnedAt: 600,
    });
    expect(repository.setChatPinned("chat-a", true, 800)).toEqual({
      pinnedAt: 800,
    });

    const chats = repository.listChats(1_000);
    expect(chats.map((chat) => chat.id)).toEqual([
      "chat-a",
      "chat-b",
      "chat-c",
    ]);
    expect(chats[0]).toMatchObject({
      pinnedAt: 800,
      latestMessagePreview: expect.stringMatching(/^Latest preview/),
      nextMessageAt: null,
      latestAttentionAt: null,
      nextAttentionAt: null,
    });
    expect(chats[0].latestMessagePreview!.length).toBeLessThanOrEqual(512);
    expect(chats[1]).toMatchObject({
      pinnedAt: 600,
      latestMessagePreview: "Old attention",
      nextMessageAt: 1_500,
      latestAttentionAt: 250,
      nextAttentionAt: 1_500,
      updatedAt: betaActivity,
    });
    expect(chats[2]).toMatchObject({
      pinnedAt: null,
      latestMessagePreview: null,
      nextMessageAt: null,
      latestAttentionAt: null,
      nextAttentionAt: null,
    });

    expect(repository.setChatPinned("chat-a", false, 1_000)).toEqual({
      pinnedAt: null,
    });
    expect(repository.listChats(1_000).map((chat) => chat.id)).toEqual([
      "chat-b",
      "chat-a",
      "chat-c",
    ]);
    expect(repository.setChatPinned("missing", true, 1_000)).toBeUndefined();
    expect(() =>
      database
        .prepare("UPDATE chats SET pinned_at = -1 WHERE id = 'chat-a'")
        .run(),
    ).toThrow(/CHECK constraint/);
  });

  it("persists project label settings and scoped multi-label messages", () => {
    const chat = repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.createChat({
      id: "chat-b",
      title: "Beta",
      accent: "moss",
      now: 150,
    });
    repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "Ship the plan",
      now: 200,
    });

    expect(chat.enabledLabels).toEqual(["todo", "milestone"]);
    expect(repository.setNoteLabel("chat-a", "note-a", "pin", true)).toEqual([
      "pin",
    ]);
    expect(repository.setNoteLabel("chat-a", "note-a", "todo", true)).toEqual([
      "pin",
      "todo",
    ]);
    expect(repository.listNotes("chat-a")[0].labels).toEqual(["pin", "todo"]);
    expect(repository.getChat("chat-a")?.updatedAt).toBe(200);

    expect(repository.setNoteLabel("chat-b", "note-a", "pin", true)).toBe(
      undefined,
    );
    expect(repository.setNoteLabel("chat-a", "note-a", "risk", true)).toBe(
      null,
    );

    expect(
      repository.updateChat("chat-a", {
        enabledLabels: ["risk"],
        now: 300,
      })?.enabledLabels,
    ).toEqual(["risk"]);
    expect(repository.listNotes("chat-a")[0].labels).toEqual(["pin", "todo"]);
    expect(repository.setNoteLabel("chat-a", "note-a", "todo", false)).toEqual([
      "pin",
    ]);

    repository.deleteNote("chat-a", "note-a");
    expect(
      database.prepare("SELECT count(*) FROM note_labels").pluck().get(),
    ).toBe(0);
    repository.deleteChat("chat-a");
    expect(
      database
        .prepare("SELECT count(*) FROM project_labels WHERE chat_id = 'chat-a'")
        .pluck()
        .get(),
    ).toBe(0);
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

  it("persists metadata-only attachment rows and returns paths after deletion", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });

    const note = repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "Spec context",
      now: 200,
      attachments: [
        {
          id: "attachment-a",
          filename: "launch-spec.pdf",
          mediaType: "application/pdf",
          storagePath:
            "attachments/v1/namespace-a/attachment-a/launch-spec.pdf",
          byteSize: 4,
          modifiedAt: 190,
          createdAt: 200,
        },
      ],
    });

    expect(note).toMatchObject({
      id: "note-a",
      attachments: [
        {
          id: "attachment-a",
          noteId: "note-a",
          filename: "launch-spec.pdf",
          mediaType: "application/pdf",
          byteSize: 4,
          modifiedAt: 190,
        },
      ],
    });
    expect(repository.listNotes("chat-a")[0]).toMatchObject({
      attachments: [{ filename: "launch-spec.pdf" }],
    });
    expect(
      repository.getAttachment("chat-a", "note-a", "attachment-a"),
    ).toMatchObject({
      filename: "launch-spec.pdf",
      storagePath: "attachments/v1/namespace-a/attachment-a/launch-spec.pdf",
      modifiedAt: 190,
    });

    expect(repository.deleteNote("chat-a", "note-a")).toEqual({
      deleted: true,
      storagePaths: ["attachments/v1/namespace-a/attachment-a/launch-spec.pdf"],
    });
    expect(
      repository.getAttachment("chat-a", "note-a", "attachment-a"),
    ).toBeUndefined();
  });

  it("updates note attachments while returning only newly unreferenced paths", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "Original",
      now: 200,
      attachments: [
        {
          id: "attachment-keep",
          filename: "keep.pdf",
          mediaType: "application/pdf",
          storagePath: "attachments/v1/source/attachment-keep/keep.pdf",
          byteSize: 4,
          modifiedAt: 200,
          createdAt: 200,
        },
        {
          id: "attachment-remove",
          filename: "remove.pdf",
          mediaType: "application/pdf",
          storagePath: "attachments/v1/source/attachment-remove/remove.pdf",
          byteSize: 6,
          modifiedAt: 200,
          createdAt: 200,
        },
      ],
    });

    const updated = repository.updateNote("chat-a", "note-a", {
      body: "Updated",
      createdAt: 250,
      now: 300,
      keepAttachmentIds: ["attachment-keep"],
      attachments: [
        {
          id: "attachment-new",
          filename: "new.pptx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          storagePath: "attachments/v1/source/attachment-new/new.pptx",
          byteSize: 3,
          modifiedAt: 300,
          createdAt: 300,
        },
      ],
    });

    expect(updated).toMatchObject({
      note: {
        body: "Updated",
        attachments: [
          { id: "attachment-keep", filename: "keep.pdf" },
          { id: "attachment-new", filename: "new.pptx" },
        ],
      },
      removedStoragePaths: [
        "attachments/v1/source/attachment-remove/remove.pdf",
      ],
    });
    expect(
      repository.getAttachment("chat-a", "note-a", "attachment-remove"),
    ).toBeUndefined();
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
      note: {
        id: "note-late",
        body: "Moved earlier",
        createdAt: 150,
      },
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

    expect(repository.deleteNote("chat-a", "note-b")).toMatchObject({
      deleted: true,
    });

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

    expect(repository.deleteChat("chat-a")).toMatchObject({ deleted: true });

    expect(repository.getChat("chat-a")).toBeUndefined();
    expect(repository.listNotes("chat-a")).toEqual([]);
    expect(repository.deleteChat("chat-a")).toEqual({
      deleted: false,
      storagePaths: [],
    });
  });

  it("allows zero-byte attachment metadata after an external edit", () => {
    repository.createChat({
      id: "chat-a",
      title: "Alpha",
      accent: "coral",
      now: 100,
    });
    repository.appendNote({
      id: "note-a",
      chatId: "chat-a",
      body: "Mutable",
      now: 200,
      attachments: [
        {
          id: "attachment-a",
          filename: "mutable.txt",
          mediaType: "text/plain",
          storagePath: "attachments/v1/source/attachment-a/mutable.txt",
          byteSize: 0,
          modifiedAt: 250,
          createdAt: 200,
        },
      ],
    });

    expect(
      database
        .prepare(
          "SELECT byte_size, modified_at FROM note_attachments WHERE id = ?",
        )
        .get("attachment-a"),
    ).toEqual({ byte_size: 0, modified_at: 250 });
  });

  it("refuses the obsolete unreleased BLOB attachment schema with reset guidance", () => {
    database.close();
    const path = join(directory, "obsolete.sqlite");
    const obsolete = new Database(path);
    obsolete.exec(`
      CREATE TABLE note_attachments (
        id TEXT PRIMARY KEY NOT NULL,
        note_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        media_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        content BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    obsolete.close();

    expect(() => openDatabase(path)).toThrow(
      /obsolete development attachment schema.*reset.*local data/i,
    );
    database = new Database(join(directory, "on-track.sqlite"));
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
      /newer version of threadstr/,
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
