import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatService } from "./chat-service.js";
import { openDatabase } from "./db/database.js";
import { SqliteChatRepository } from "./db/repository.js";
import { ManagedAttachmentStore } from "./attachments/managed-attachment-store.js";

describe("project subthreads", () => {
  let directory: string;
  let database: ReturnType<typeof openDatabase>;
  let service: ChatService;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "threadstr-subthreads-"));
    database = openDatabase(join(directory, "app.sqlite"));
    let id = 0;
    service = new ChatService(
      new SqliteChatRepository(database),
      () => `id-${++id}`,
      () => 1000,
      new ManagedAttachmentStore(directory),
    );
  });
  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates empty flat siblings with independent settings and a live root accent", () => {
    const root = service.createChat({ title: "Website", accent: "ocean" });
    service.updateChat(root.id, {
      collapseLongMessages: false,
      enabledLabels: ["risk"],
    });
    const first = service.createSubthread(root.id, { title: "Navigation" });
    const source = service.appendNote(first.id, {
      body: "Consider a shorter menu",
    });
    const second = service.createSubthread(first.id, {
      title: "Mobile menu",
      sourceNoteId: source.id,
    });
    expect(first).toMatchObject({
      projectId: root.id,
      origin: null,
      collapseLongMessages: false,
      enabledLabels: ["risk"],
    });
    expect(second).toMatchObject({
      projectId: root.id,
      origin: { sourceChatId: first.id, sourceNoteId: source.id },
    });
    expect(service.getChat(second.id).notes).toEqual([]);
    service.updateChat(root.id, {
      accent: "iris",
      collapseLongMessages: true,
      enabledLabels: ["todo"],
    });
    expect(service.getChat(first.id)).toMatchObject({
      accent: "iris",
      collapseLongMessages: false,
      enabledLabels: ["risk"],
    });
    expect(() => service.updateChat(first.id, { accent: "coral" })).toThrow();
    service.updateChat(first.id, {
      title: "Revised navigation",
      collapseLongMessages: true,
    });
    expect(service.getChat(root.id).title).toBe("Website");
    expect(
      service
        .getProject(second.id)
        .map((chat) => chat.id)
        .sort(),
    ).toEqual([root.id, first.id, second.id].sort());
    database.close();
    database = openDatabase(join(directory, "app.sqlite"));
    expect(
      new ChatService(new SqliteChatRepository(database)).getChat(second.id),
    ).toMatchObject({
      projectId: root.id,
      accent: "iris",
      origin: { sourceChatId: first.id, sourceNoteId: source.id },
    });
  });

  it("clones custom label definitions with fresh identities and no assignments", () => {
    const root = service.createChat({ title: "Labels", accent: "ocean" });
    const configured = service.updateChat(root.id, {
      labelConfiguration: {
        revision: 0,
        labels: [
          ...root.labelDefinitions!.map(({ id, name, symbol, enabled }) => ({
            id,
            name,
            symbol,
            enabled,
          })),
          { name: "Review", symbol: "☆", enabled: true },
        ],
      },
    });
    const rootCustom = configured.labelDefinitions!.find(
      (label) => !label.builtin,
    )!;
    const note = service.appendNote(root.id, { body: "Labelled original" });
    service.setNoteLabel(root.id, note.id, rootCustom.id, true);
    const child = service.createSubthread(root.id, {
      title: "Review",
      sourceNoteId: note.id,
    });
    const childCustom = child.labelDefinitions!.find(
      (label) => !label.builtin,
    )!;
    expect(childCustom).toMatchObject({
      name: "Review",
      symbol: "☆",
      enabled: true,
    });
    expect(childCustom.id).not.toBe(rootCustom.id);
    expect(service.getChat(child.id).notes).toEqual([]);
    service.updateChat(child.id, {
      labelConfiguration: {
        revision: 0,
        labels: child.labelDefinitions!.map(
          ({ id, name, symbol, enabled }) => ({
            id,
            name: id === childCustom.id ? "Ready" : name,
            symbol,
            enabled,
          }),
        ),
      },
    });
    expect(
      service
        .getChat(root.id)
        .labelDefinitions!.find((label) => label.id === rootCustom.id)?.name,
    ).toBe("Review");
    expect(service.getChat(root.id).notes[0]?.labels).toEqual([rootCustom.id]);
  });

  it("migrates schema 9 projects as Main without changing messages or settings", () => {
    const root = service.createChat({ title: "Existing", accent: "moss" });
    service.updateChat(root.id, { collapseLongMessages: false });
    service.setChatPinned(root.id, true);
    const note = service.appendNote(root.id, {
      body: "Keep existing text",
      sender: "Maya",
    });
    database.exec(
      "DROP TABLE subthread_origins; DROP INDEX chats_project_idx; ALTER TABLE chats DROP COLUMN project_id; DELETE FROM __drizzle_migrations WHERE created_at=1793364000000; UPDATE app_metadata SET schema_version=9;",
    );
    database.close();
    database = openDatabase(join(directory, "app.sqlite"));
    const migrated = new ChatService(
      new SqliteChatRepository(database),
    ).getChat(root.id);
    expect(migrated).toMatchObject({
      title: "Existing",
      projectId: null,
      origin: null,
      accent: "moss",
      collapseLongMessages: false,
      pinnedAt: 1000,
      notes: [{ id: note.id, body: "Keep existing text", sender: "Maya" }],
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects missing or foreign origin messages without partial conversations", () => {
    const root = service.createChat({ title: "Website", accent: "ocean" });
    const other = service.createChat({ title: "Unrelated", accent: "moss" });
    const note = service.appendNote(other.id, {
      body: "Private other project",
    });
    expect(() =>
      service.createSubthread(root.id, { title: "Bad", sourceNoteId: note.id }),
    ).toThrow();
    expect(() =>
      service.createSubthread(root.id, {
        title: "Bad",
        sourceNoteId: "missing",
      }),
    ).toThrow();
    expect(() =>
      service.createSubthread("missing", { title: "Bad" }),
    ).toThrow();
    expect(service.listChats()).toHaveLength(2);
  });

  it("preserves continued identity after deleting sources and keeps sibling forks", () => {
    const root = service.createChat({ title: "Website", accent: "ocean" });
    const source = service.createSubthread(root.id, { title: "Source" });
    const note = service.appendNote(source.id, { body: "A source" });
    const child = service.createSubthread(source.id, {
      title: "Child",
      sourceNoteId: note.id,
    });
    service.deleteNote(source.id, note.id);
    expect(service.getChat(child.id).origin).toEqual({
      sourceChatId: source.id,
      sourceNoteId: null,
    });
    service.deleteChat(source.id);
    expect(service.getChat(child.id).origin).toEqual({
      sourceChatId: null,
      sourceNoteId: null,
    });
    expect(service.getChat(child.id).projectId).toBe(root.id);
  });

  it("archives only the target and deletes the whole project including child files", () => {
    const root = service.createChat({ title: "Website", accent: "ocean" });
    const child = service.createSubthread(root.id, { title: "Files" });
    service.setChatPinned(child.id, true);
    service.setChatArchived(root.id, true);
    expect(service.getChat(child.id)).toMatchObject({
      archivedAt: null,
      pinnedAt: 1000,
    });
    service.setChatArchived(child.id, true);
    expect(service.getProject(child.id)).toHaveLength(2);
    expect(service.getChat(child.id)).toMatchObject({
      archivedAt: 1000,
      pinnedAt: null,
    });
    service.appendNote(child.id, {
      body: "",
      attachments: [
        {
          filename: "note.txt",
          mediaType: "text/plain",
          byteSize: 4,
          content: new Uint8Array([110, 111, 116, 101]),
        },
      ],
    });
    const path = database
      .prepare("SELECT storage_path FROM note_attachments")
      .pluck()
      .get() as string;
    expect(existsSync(join(directory, path))).toBe(true);
    service.deleteChat(root.id);
    expect(service.listChats()).toEqual([]);
    expect(existsSync(join(directory, path))).toBe(false);
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });
});
