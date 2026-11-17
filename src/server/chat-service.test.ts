import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedAttachmentStore } from "./attachments/managed-attachment-store.js";
import {
  ChatService,
  AttachmentOpenBlockedError,
  type AttachmentStore,
  InvalidInputError,
} from "./chat-service.js";
import type { NativeFileActions } from "./native-file-actions.js";
import {
  NativeFileActionFailedError,
  NativeFileActionUnsupportedError,
} from "./native-file-actions.js";
import { openDatabase } from "./db/database.js";
import { SqliteChatRepository } from "./db/repository.js";

describe("managed attachment service lifecycle", () => {
  let directory: string;
  let database: ReturnType<typeof openDatabase>;
  let repository: SqliteChatRepository;
  let store: ManagedAttachmentStore;
  let ids: string[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "threadstr-service-"));
    database = openDatabase(join(directory, "on-track.sqlite"));
    repository = new SqliteChatRepository(database);
    store = new ManagedAttachmentStore(directory, {
      namespaceFactory: () => "namespace-a",
      temporaryNameFactory: () => `temporary-${ids.length}`,
    });
    ids = [];
  });

  afterEach(() => {
    if (database.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const nativeActions: NativeFileActions = {
    supported: true,
    platform: "darwin",
    open: vi.fn(async () => undefined),
    reveal: vi.fn(async () => undefined),
  };

  function service(
    attachmentStore: AttachmentStore = store,
    actions: NativeFileActions = nativeActions,
  ): ChatService {
    return new ChatService(
      repository,
      () => ids.shift()!,
      () => 1_000,
      attachmentStore,
      actions,
    );
  }

  it("does not expose attachment bytes through the service", () => {
    expect(service()).not.toHaveProperty("downloadAttachment");
  });

  it("stages attachment copies outside the write transaction and rejects changed selection contents", async () => {
    const app = service();
    ids.push(
      "source",
      "dest",
      "one",
      "f-a",
      "two",
      "fresh-a",
      "fresh-b",
      "fresh-c",
      "extra",
    );
    app.createChat({ title: "Source", accent: "moss" });
    app.createChat({ title: "Target", accent: "moss" });
    const file = {
      filename: "memo.txt",
      mediaType: "text/plain",
      byteSize: 1,
      content: Buffer.from("x"),
    };
    app.appendNote("source", { body: "First", attachments: [file] });
    app.appendNote("source", { body: "Second" });
    const copy = store.copy.bind(store);
    const writeLocks: boolean[] = [];
    let staged = "";
    vi.spyOn(store, "copy").mockImplementation((path, id) => {
      writeLocks.push(database.inTransaction);
      const created = copy(path, id);
      staged = created.storagePath;
      queueMicrotask(() =>
        app.updateNote("source", "two", {
          body: "Second",
          attachments: [file],
        }),
      );
      return created;
    });
    await expect(
      app.batchNotes("source", {
        action: "copy",
        noteIds: ["one", "two"],
        destinationChatId: "dest",
      }),
    ).rejects.toThrow(/changed/);
    expect(writeLocks).toEqual([false]);
    expect(existsSync(join(directory, staged))).toBe(false);
    expect(app.getChat("dest").notes).toHaveLength(0);
    expect(app.getChat("source").notes[1].attachments).toHaveLength(1);
  });

  it.each(["source", "copy"])(
    "rejects a %s sidecar changed while staging",
    async (changed) => {
      const app = service();
      ids.push("source", "dest", "note", "file", "copied-file", "copied-note");
      app.createChat({ title: "Source", accent: "moss" });
      app.createChat({ title: "Target", accent: "moss" });
      app.appendNote("source", {
        body: "File",
        attachments: [
          {
            filename: "file.txt",
            mediaType: "text/plain",
            content: Buffer.from("x"),
            byteSize: 1,
          },
        ],
      });
      let staged = "";
      const copy = store.copy.bind(store);
      vi.spyOn(store, "copy").mockImplementation((path, id) => {
        const file = copy(path, id);
        staged = file.storagePath;
        queueMicrotask(() =>
          writeFileSync(
            store.resolveAvailablePath(changed === "source" ? path : staged),
            "changed",
          ),
        );
        return file;
      });
      await expect(
        app.batchNotes("source", {
          action: "copy",
          noteIds: ["note"],
          destinationChatId: "dest",
        }),
      ).rejects.toThrow(/changed/);
      expect(app.getChat("dest").notes).toHaveLength(0);
      expect(existsSync(join(directory, staged))).toBe(false);
    },
  );

  it("preserves source order across equal timestamps and copies externally edited files with each new note", async () => {
    const app = service();
    ids.push(
      "source",
      "dest",
      "m-a",
      "f-a",
      "m-b",
      "f-b",
      "f-z",
      "f-c",
      "m-z",
      "m-c",
    );
    app.createChat({ title: "Source", accent: "iris" });
    app.createChat({ title: "Destination", accent: "ocean" });
    const file = {
      filename: "Brief.pdf",
      mediaType: "application/pdf",
      content: Buffer.from("data"),
      byteSize: 4,
    };
    app.appendNote("source", {
      body: "First",
      attachments: [file],
      sender: "Jules",
      createdAt: 456,
    });
    app.appendNote("source", {
      body: "Second",
      attachments: [file],
      createdAt: 456,
    });
    const original = repository.getAttachment("source", "m-a", "f-a")!;
    writeFileSync(
      store.resolveAvailablePath(original.storagePath),
      "revised file",
    );
    await app.batchNotes("source", {
      action: "copy",
      noteIds: ["m-b", "m-a"],
      destinationChatId: "dest",
    });
    const copied = app.getChat("dest").notes;
    expect(copied).toMatchObject([
      {
        id: "m-c",
        body: "First",
        sender: "Jules",
        createdAt: 456,
        attachments: [
          { filename: "Brief.pdf", mediaType: "application/pdf", byteSize: 12 },
        ],
      },
      {
        id: "m-z",
        body: "Second",
        createdAt: 456,
        attachments: [{ filename: "Brief.pdf", byteSize: 4 }],
      },
    ]);
    const duplicate = repository.getAttachment(
      "dest",
      copied[0].id,
      copied[0].attachments![0].id,
    )!;
    expect(duplicate.storagePath).not.toEqual(original.storagePath);
    app.deleteChat("source");
    expect(store.read(duplicate.storagePath).content.toString()).toBe(
      "revised file",
    );
  });

  it("rolls back previously moved notes, labels and continuation links on a later database error", async () => {
    const app = service();
    ids.push("source", "dest", "one", "two", "child");
    app.createChat({ title: "Source", accent: "iris" });
    app.createChat({ title: "Destination", accent: "ocean" });
    app.appendNote("source", { body: "First" });
    app.appendNote("source", { body: "Second" });
    app.setNoteLabel("source", "one", "pin", true);
    app.createSubthread("source", { title: "Follow-up", sourceNoteId: "one" });
    database.exec(`CREATE TRIGGER fail_last_move BEFORE UPDATE OF chat_id ON notes
      WHEN NEW.id='two' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
    await expect(
      app.batchNotes("source", {
        action: "move",
        noteIds: ["two", "one"],
        destinationChatId: "dest",
      }),
    ).rejects.toThrow("simulated write failure");
    expect(app.getChat("dest").notes).toHaveLength(0);
    expect(app.getChat("source").notes.map((n) => n.labels)).toEqual([
      ["pin"],
      [],
    ]);
    expect(app.getChat("child").origin?.sourceNoteId).toBe("one");
  });

  it("rolls back a batch with an unreadable copy, moves missing files intact, and retains continuation anchors", async () => {
    const app = service();
    ids.push("source", "dest", "one", "a", "two", "b", "child");
    app.createChat({ title: "Source", accent: "ocean" });
    app.createChat({ title: "Destination", accent: "ocean" });
    const file = {
      filename: "brief.txt",
      mediaType: "text/plain",
      content: Buffer.from("file"),
      byteSize: 4,
    };
    app.appendNote("source", { body: "First", attachments: [file] });
    app.appendNote("source", { body: "Second", attachments: [file] });
    app.createSubthread("source", {
      title: "Continuation",
      sourceNoteId: "one",
    });
    app.updateNote("source", "one", { createdAt: 523 });
    const originals = repository.listAllAttachmentStoragePaths();
    const missing = repository.getAttachment("source", "two", "b")!;
    store.remove(missing.storagePath);
    ids.push("copied-a", "copied-b");
    const values = { noteIds: ["two", "one"], destinationChatId: "dest" };
    await expect(
      app.batchNotes("source", { action: "copy", ...values }),
    ).rejects.toThrow(/missing/);
    expect(app.getChat("dest").notes).toHaveLength(0);
    expect(repository.listAllAttachmentStoragePaths()).toEqual(originals);
    expect(
      existsSync(
        join(directory, "attachments", "v1", "namespace-a", "copied-a"),
      ),
    ).toBe(false);
    await app.batchNotes("source", { action: "move", ...values });
    expect(app.getChat("source").notes).toHaveLength(0);
    expect(app.getChat("dest").notes[1]).toMatchObject({
      id: "two",
      attachments: [{ id: "b", status: "missing" }],
    });
    expect(repository.listAllAttachmentStoragePaths()).toEqual(originals);
    expect(app.getChat("child").origin).toMatchObject({
      sourceChatId: "source",
      sourceNoteId: null,
      sourceNoteCreatedAt: 523,
      sourceNotePositionId: "one",
    });
    const first = repository.getAttachment("dest", "one", "a")!;
    await app.batchNotes("dest", { action: "delete", noteIds: ["one", "two"] });
    expect(existsSync(join(directory, first.storagePath))).toBe(false);
    expect(app.getChat("dest").notes).toHaveLength(0);
  });

  it("creates, changes, preserves, and clears participant attribution", () => {
    ids.push("chat-a", "note-a");
    const chatService = service();
    chatService.createChat({ title: "Launch", accent: "ocean" });

    expect(
      chatService.appendNote("chat-a", {
        body: "Participant update",
        sender: "  Maya Chen  ",
      }),
    ).toMatchObject({ sender: "Maya Chen" });
    expect(
      chatService.updateNote("chat-a", "note-a", { body: "Still Maya" }),
    ).toMatchObject({ sender: "Maya Chen" });
    expect(
      chatService.updateNote("chat-a", "note-a", { sender: " Omar Haddad " }),
    ).toMatchObject({ sender: "Omar Haddad" });
    expect(
      chatService.updateNote("chat-a", "note-a", { sender: null }),
    ).toMatchObject({ sender: null });
  });

  it("rejects invalid participant attribution without changing the note", () => {
    ids.push("chat-a", "note-a");
    const chatService = service();
    chatService.createChat({ title: "Launch", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Participant update",
      sender: "Maya Chen",
    });

    expect(() =>
      chatService.updateNote("chat-a", "note-a", {
        sender: "x".repeat(81),
      }),
    ).toThrow();
    expect(chatService.getChat("chat-a").notes[0]).toMatchObject({
      sender: "Maya Chen",
    });
  });

  it.each(["append", "edit"] as const)(
    "preserves mixed attachment upload order on %s and reload",
    (action) => {
      const app = service();
      ids.push("chat", "note", "file-z", "file-a", "file-m");
      app.createChat({ title: "Prints", accent: "moss" });
      const filenames = ["proof.jpg", "specs.pdf", "original.png"];
      const attachments = filenames.map((filename) => ({
        filename,
        mediaType: "application/octet-stream",
        byteSize: Buffer.byteLength(filename),
        content: Buffer.from(filename),
      }));
      if (action === "edit") app.appendNote("chat", { body: "Print proof" });
      const note =
        action === "append"
          ? app.appendNote("chat", { attachments })
          : app.updateNote("chat", "note", { attachments });
      expect(note.attachments!.map((file) => file.filename)).toEqual(filenames);
      const reloaded = app.getChat("chat").notes[0].attachments!;
      expect(reloaded.map((file) => [file.id, file.filename])).toEqual(
        note.attachments!.map((file) => [file.id, file.filename]),
      );
      for (const file of reloaded) {
        const managed = repository.getAttachment("chat", "note", file.id)!;
        expect(store.read(managed.storagePath).content.toString()).toBe(
          file.filename,
        );
      }
    },
  );

  it("uses the public append and update use cases for attachment writes", () => {
    ids.push("chat-a", "note-a", "attachment-a", "attachment-b");
    const chatService = service();
    chatService.createChat({ title: "Files", accent: "ocean" });

    const created = chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });
    const updated = chatService.updateNote("chat-a", "note-a", {
      body: "Updated",
      keepAttachmentIds: ["attachment-a"],
      attachments: [
        {
          filename: "notes.txt",
          mediaType: "text/plain",
          byteSize: 5,
          content: Buffer.from("notes"),
        },
      ],
    });

    expect(created.attachments).toHaveLength(1);
    expect(updated.attachments).toMatchObject([
      { id: "attachment-a", filename: "roadmap.txt" },
      { id: "attachment-b", filename: "notes.txt" },
    ]);
  });

  it("rejects foreign kept attachments without changing records or files", () => {
    ids.push(
      "chat-a",
      "note-a",
      "attachment-a",
      "chat-b",
      "note-b",
      "attachment-b",
      "attachment-new",
    );
    const chatService = service();
    chatService.createChat({ title: "Alpha", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "",
      attachments: [
        {
          filename: "alpha.txt",
          mediaType: "text/plain",
          byteSize: 5,
          content: Buffer.from("alpha"),
        },
      ],
    });
    chatService.createChat({ title: "Beta", accent: "moss" });
    chatService.appendNote("chat-b", {
      body: "Beta",
      attachments: [
        {
          filename: "beta.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("beta"),
        },
      ],
    });

    expect(() =>
      chatService.updateNote("chat-a", "note-a", {
        body: "",
        keepAttachmentIds: ["attachment-b"],
        attachments: [
          {
            filename: "new.txt",
            mediaType: "text/plain",
            byteSize: 3,
            content: Buffer.from("new"),
          },
        ],
      }),
    ).toThrow(InvalidInputError);

    expect(repository.listNotes("chat-a")[0]).toMatchObject({
      body: "",
      attachments: [{ id: "attachment-a" }],
    });
    expect(repository.listNotes("chat-b")[0]).toMatchObject({
      body: "Beta",
      attachments: [{ id: "attachment-b" }],
    });
    expect(
      existsSync(
        join(
          directory,
          "attachments",
          "v1",
          "namespace-a",
          "attachment-new",
          "new.txt",
        ),
      ),
    ).toBe(false);
  });

  it("applies only permanent or enabled labels and removes inactive labels", () => {
    ids.push("chat-a", "note-a");
    const chatService = service();
    const chat = chatService.createChat({ title: "Launch", accent: "ocean" });
    chatService.appendNote("chat-a", { body: "Prepare rollout" });

    expect(chat.enabledLabels).toEqual(["todo", "milestone"]);
    expect(
      chatService.setNoteLabel("chat-a", "note-a", "attention", true),
    ).toEqual(["attention"]);
    expect(chatService.setNoteLabel("chat-a", "note-a", "todo", true)).toEqual([
      "attention",
      "todo",
    ]);
    expect(() =>
      chatService.setNoteLabel("chat-a", "note-a", "risk", true),
    ).toThrow(InvalidInputError);

    chatService.updateChat("chat-a", { enabledLabels: ["risk"] });
    expect(chatService.getChat("chat-a").notes[0].labels).toEqual([
      "attention",
      "todo",
    ]);
    expect(chatService.setNoteLabel("chat-a", "note-a", "todo", false)).toEqual(
      ["attention"],
    );
    expect(() =>
      chatService.setNoteLabel("chat-a", "note-a", "unknown", true),
    ).toThrow();
    expect(() =>
      chatService.setNoteLabel("other", "note-a", "pin", true),
    ).toThrow(/Project not found/i);
  });

  it("installs sidecars before database references and cleans them after database failure", () => {
    ids.push("chat-a");
    const chatService = service();
    chatService.createChat({ title: "Files", accent: "ocean" });
    database.exec(`
      CREATE TRIGGER reject_note_insert
      BEFORE INSERT ON notes
      BEGIN
        SELECT RAISE(ABORT, 'forced database failure');
      END;
    `);
    ids.push("note-a", "attachment-a");

    expect(() =>
      chatService.appendNote("chat-a", {
        body: "Context",
        attachments: [
          {
            filename: "roadmap.txt",
            mediaType: "text/plain",
            byteSize: 4,
            content: Buffer.from("road"),
          },
        ],
      }),
    ).toThrow(/forced database failure/);

    expect(repository.listNotes("chat-a")).toEqual([]);
    expect(
      existsSync(
        join(
          directory,
          "attachments",
          "v1",
          "namespace-a",
          "attachment-a",
          "roadmap.txt",
        ),
      ),
    ).toBe(false);
  });

  it("refreshes metadata after external edits while preserving identity and path", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service();
    chatService.createChat({ title: "Files", accent: "ocean" });
    const created = chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });
    const stored = repository.getAttachment(
      "chat-a",
      "note-a",
      "attachment-a",
    )!;
    writeFileSync(
      store.resolveAvailablePath(stored.storagePath),
      Buffer.alloc(0),
    );

    const refreshed = chatService.getChat("chat-a").notes[0].attachments![0];

    expect(refreshed).toMatchObject({
      id: created.attachments![0].id,
      status: "available",
      byteSize: 0,
    });
    expect(
      repository.getAttachment("chat-a", "note-a", "attachment-a")?.storagePath,
    ).toBe(stored.storagePath);
  });

  it("preserves records and reports missing and symlink-replaced files", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service();
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });
    const stored = repository.getAttachment(
      "chat-a",
      "note-a",
      "attachment-a",
    )!;
    const managedPath = store.resolveAvailablePath(stored.storagePath);
    unlinkSync(managedPath);

    expect(chatService.getChat("chat-a").notes[0].attachments![0].status).toBe(
      "missing",
    );
    expect(
      repository.getAttachment("chat-a", "note-a", "attachment-a"),
    ).toBeDefined();

    if (process.platform !== "win32") {
      const outside = join(directory, "outside.txt");
      writeFileSync(outside, "outside");
      symlinkSync(outside, managedPath);
      expect(
        chatService.getChat("chat-a").notes[0].attachments![0].status,
      ).toBe("unsafe");
    }
  });

  it("keeps a broken attachment state after a text-only edit", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service();
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Original",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });
    const stored = repository.getAttachment(
      "chat-a",
      "note-a",
      "attachment-a",
    )!;
    unlinkSync(store.resolveAvailablePath(stored.storagePath));

    const updated = chatService.updateNote("chat-a", "note-a", {
      body: "Updated",
    });

    expect(updated.attachments).toMatchObject([
      { id: "attachment-a", status: "missing" },
    ]);
  });

  it("commits reference deletion before best-effort sidecar cleanup", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const remove = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const attachmentStore = {
      create: store.create.bind(store),
      observe: store.observe.bind(store),
      remove,
    };
    const chatService = service(attachmentStore);
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });

    expect(() => chatService.deleteNote("chat-a", "note-a")).not.toThrow();
    expect(remove).toHaveBeenCalledOnce();
    expect(
      repository.getAttachment("chat-a", "note-a", "attachment-a"),
    ).toBeUndefined();
  });

  it("commits project deletion before best-effort sidecar cleanup", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const remove = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const chatService = service({
      create: store.create.bind(store),
      observe: store.observe.bind(store),
      remove,
    });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });

    expect(() => chatService.deleteChat("chat-a")).not.toThrow();
    expect(remove).toHaveBeenCalledOnce();
    expect(repository.getChat("chat-a")).toBeUndefined();
    expect(repository.listNotes("chat-a")).toEqual([]);
  });

  it("keeps referenced files and removes only new installs after an edit transaction fails", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service();
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Original",
      attachments: [
        {
          filename: "keep.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("keep"),
        },
      ],
    });
    const kept = repository.getAttachment("chat-a", "note-a", "attachment-a")!;
    const keptPath = store.resolveAvailablePath(kept.storagePath);
    database.exec(`
      CREATE TRIGGER reject_attachment_insert
      BEFORE INSERT ON note_attachments
      WHEN NEW.id = 'attachment-new'
      BEGIN
        SELECT RAISE(ABORT, 'forced edit failure');
      END;
    `);
    ids.push("attachment-new");

    expect(() =>
      chatService.updateNote("chat-a", "note-a", {
        body: "Changed",
        keepAttachmentIds: [],
        attachments: [
          {
            filename: "new.txt",
            mediaType: "text/plain",
            byteSize: 3,
            content: Buffer.from("new"),
          },
        ],
      }),
    ).toThrow(/forced edit failure/);

    expect(readFileSync(keptPath, "utf8")).toBe("keep");
    expect(repository.listNotes("chat-a")[0]).toMatchObject({
      body: "Original",
      attachments: [{ id: "attachment-a" }],
    });
    expect(
      existsSync(
        join(
          directory,
          "attachments",
          "v1",
          "namespace-a",
          "attachment-new",
          "new.txt",
        ),
      ),
    ).toBe(false);
  });

  it("opens only a scoped safe managed file after refreshing metadata", async () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const open = vi.fn(async () => undefined);
    const chatService = service(store, { ...nativeActions, open });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.pptx",
          mediaType: "application/octet-stream",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });
    const stored = repository.getAttachment(
      "chat-a",
      "note-a",
      "attachment-a",
    )!;
    const absolutePath = store.resolveAvailablePath(stored.storagePath);
    writeFileSync(absolutePath, "updated");

    await chatService.openAttachment("chat-a", "note-a", "attachment-a");

    expect(open).toHaveBeenCalledWith(absolutePath);
    expect(
      repository.getAttachment("chat-a", "note-a", "attachment-a")?.byteSize,
    ).toBe(7);
    await expect(
      chatService.openAttachment("other", "note-a", "attachment-a"),
    ).rejects.toThrow(/Project not found/i);
  });

  it.each([
    "installer.EXE",
    "profile.terminal",
    "location.inetloc",
    "help.chm",
    "addin.xll",
    "sandbox.wsb",
    "macros.docm",
    "notes.unknown",
    "README",
    "page.html",
    "image.svg",
    "archive.zip",
  ])(
    "blocks Open for %s despite text MIME metadata while allowing reveal",
    async (filename) => {
      ids.push("chat-a", "note-a", "attachment-a");
      const open = vi.fn(async () => undefined);
      const reveal = vi.fn(async () => undefined);
      const chatService = service(store, { ...nativeActions, open, reveal });
      chatService.createChat({ title: "Files", accent: "ocean" });
      chatService.appendNote("chat-a", {
        body: "Context",
        attachments: [
          {
            filename,
            mediaType: "text/plain",
            byteSize: 4,
            content: Buffer.from("road"),
          },
        ],
      });

      await expect(
        chatService.openAttachment("chat-a", "note-a", "attachment-a"),
      ).rejects.toThrow(AttachmentOpenBlockedError);
      await chatService.revealAttachment("chat-a", "note-a", "attachment-a");

      expect(open).not.toHaveBeenCalled();
      expect(reveal).toHaveBeenCalledOnce();
      expect(
        chatService.getChat("chat-a").notes[0].attachments![0].actions,
      ).toEqual({
        open: "blocked",
        reveal: "available",
      });
    },
  );

  it("keeps recovery reveal available for a missing file", async () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const reveal = vi.fn(async () => undefined);
    const chatService = service(store, { ...nativeActions, reveal });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });
    const stored = repository.getAttachment(
      "chat-a",
      "note-a",
      "attachment-a",
    )!;
    unlinkSync(store.resolveAvailablePath(stored.storagePath));
    const containingDirectory = store.resolveSafeContainingDirectory(
      stored.storagePath,
    );

    const attachment = chatService.getChat("chat-a").notes[0].attachments![0];
    expect(attachment.actions).toEqual({
      open: "unavailable",
      reveal: "available",
    });
    await chatService.revealAttachment("chat-a", "note-a", "attachment-a");
    expect(reveal).toHaveBeenCalledWith(
      containingDirectory,
      containingDirectory,
    );
  });

  it("normalizes unexpected native adapter errors without exposing managed paths", async () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service(store, {
      ...nativeActions,
      open: vi.fn(async () => {
        throw new Error("failed at /private/threadstr/attachments/secret.txt");
      }),
    });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });

    const error = await chatService
      .openAttachment("chat-a", "note-a", "attachment-a")
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(NativeFileActionFailedError);
    expect(String(error)).not.toContain("/private/threadstr");
  });

  it("reports unsupported native actions in DTOs and at action time", async () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service(store, {
      ...nativeActions,
      supported: false,
      platform: "aix",
    });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNote("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "roadmap.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: Buffer.from("road"),
        },
      ],
    });

    expect(
      chatService.getChat("chat-a").notes[0].attachments![0].actions,
    ).toEqual({ open: "unsupported", reveal: "unsupported" });
    await expect(
      chatService.openAttachment("chat-a", "note-a", "attachment-a"),
    ).rejects.toThrow(NativeFileActionUnsupportedError);
  });
});
