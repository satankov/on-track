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
  AttachmentUnavailableError,
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
    directory = mkdtempSync(join(tmpdir(), "on-track-service-"));
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
      chatService.appendNoteWithAttachments("chat-a", {
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
    const created = chatService.appendNoteWithAttachments("chat-a", {
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
    chatService.appendNoteWithAttachments("chat-a", {
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
    chatService.appendNoteWithAttachments("chat-a", {
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

  it("downloads only the scoped sidecar and refreshes its metadata", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service();
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
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
    writeFileSync(store.resolveAvailablePath(stored.storagePath), "updated");

    const download = chatService.downloadAttachment(
      "chat-a",
      "note-a",
      "attachment-a",
    );

    expect(download.content).toEqual(Buffer.from("updated"));
    expect(download.attachment.id).toBe("attachment-a");
    expect(
      repository.getAttachment("chat-a", "note-a", "attachment-a")?.byteSize,
    ).toBe(7);
    expect(() =>
      chatService.downloadAttachment("other", "note-a", "attachment-a"),
    ).toThrow(/Project not found/i);
  });

  it("commits reference deletion before best-effort sidecar cleanup", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const remove = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const attachmentStore = {
      create: store.create.bind(store),
      observe: store.observe.bind(store),
      read: store.read.bind(store),
      remove,
    };
    const chatService = service(attachmentStore);
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
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
      read: store.read.bind(store),
      remove,
    });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
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
    chatService.appendNoteWithAttachments("chat-a", {
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
      chatService.updateNoteWithAttachments("chat-a", "note-a", {
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

  it("returns a typed recoverable error for unavailable downloads", () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service();
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
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

    expect(() =>
      chatService.downloadAttachment("chat-a", "note-a", "attachment-a"),
    ).toThrow(AttachmentUnavailableError);
  });

  it("opens only a scoped safe managed file after refreshing metadata", async () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const open = vi.fn(async () => undefined);
    const chatService = service(store, { ...nativeActions, open });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
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

  it("blocks dangerous and executable attachments while allowing safe reveal", async () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const open = vi.fn(async () => undefined);
    const reveal = vi.fn(async () => undefined);
    const chatService = service(store, { ...nativeActions, open, reveal });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
      body: "Context",
      attachments: [
        {
          filename: "installer.EXE",
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
  });

  it("keeps recovery reveal available for a missing file", async () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const reveal = vi.fn(async () => undefined);
    const chatService = service(store, { ...nativeActions, reveal });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
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
        throw new Error("failed at /private/on-track/attachments/secret.txt");
      }),
    });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
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
    expect(String(error)).not.toContain("/private/on-track");
  });

  it("reports unsupported native actions in DTOs and at action time", async () => {
    ids.push("chat-a", "note-a", "attachment-a");
    const chatService = service(store, {
      ...nativeActions,
      supported: false,
      platform: "aix",
    });
    chatService.createChat({ title: "Files", accent: "ocean" });
    chatService.appendNoteWithAttachments("chat-a", {
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
