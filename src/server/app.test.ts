import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { buildApp } from "./app.js";
import { openDatabase } from "./db/database.js";
import { MaintenanceGate } from "./database-transfer/maintenance-gate.js";
import type { StagedUpload } from "./database-transfer/staged-upload.js";
import type { NativeFileActions } from "./native-file-actions.js";

describe("local project-chat API", () => {
  let directory: string;
  let app: FastifyInstance;
  let sequence: number;
  let exportDirectoryCleanup: Mock<(path: string) => void>;
  let stagedUploadCleanup: Mock<(staged: StagedUpload) => void>;
  let nativeFileActions: NativeFileActions;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "on-track-api-"));
    sequence = 0;
    exportDirectoryCleanup = vi.fn((path: string) =>
      rmSync(path, { recursive: true, force: true }),
    );
    stagedUploadCleanup = vi.fn((staged: { dispose(): void }) =>
      staged.dispose(),
    );
    nativeFileActions = {
      supported: true,
      platform: "darwin",
      open: vi.fn(async () => undefined),
      reveal: vi.fn(async () => undefined),
    };
    app = buildApp({
      database: openDatabase(join(directory, "on-track.sqlite")),
      databasePath: join(directory, "on-track.sqlite"),
      idFactory: () => `id-${++sequence}`,
      clock: () => 1_000 + sequence,
      exportDirectoryCleanup,
      stagedUploadCleanup,
      nativeFileActions,
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates, customizes, and appends a note through JSON contracts", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { title: "  Migration  ", accent: "amber" },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: "id-1",
      title: "Migration",
      accent: "amber",
    });

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/chats/id-1",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { title: "Migration plan", accent: "ocean" },
    });
    expect(updated.statusCode).toBe(200);

    const note = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { body: "Decision:\nShip the thin slice." },
    });
    expect(note.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: "/api/chats/id-1",
      headers: { host: "localhost:4173" },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      title: "Migration plan",
      accent: "ocean",
      notes: [{ id: "id-2", body: "Decision:\nShip the thin slice." }],
    });
  });

  it("accepts an optional timestamp when appending a note", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { title: "Backfill", accent: "amber" },
    });

    const note = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { body: "From the past", createdAt: 250 },
    });

    expect(note.statusCode).toBe(201);
    expect(note.json()).toMatchObject({
      id: "id-2",
      body: "From the past",
      createdAt: 250,
    });
  });

  it("creates an attachment message through multipart and downloads file bytes", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { title: "Files", accent: "amber" },
    });
    const form = new FormData();
    form.set("body", "Deck context");
    form.set("createdAt", "250");
    form.append(
      "files",
      new File([new Uint8Array([1, 2, 3])], "roadmap.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    );

    const note = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: form,
    });

    expect(note.statusCode).toBe(201);
    expect(note.json()).toMatchObject({
      id: "id-2",
      body: "Deck context",
      createdAt: 250,
      attachments: [
        {
          id: "id-3",
          noteId: "id-2",
          filename: "roadmap.pptx",
          byteSize: 3,
        },
      ],
    });

    const attachment = await app.inject({
      method: "GET",
      url: "/api/chats/id-1/notes/id-2/attachments/id-3",
      headers: { host: "localhost:4173" },
    });

    expect(attachment.statusCode).toBe(200);
    expect(attachment.headers["content-disposition"]).toContain(
      'filename="roadmap.pptx"',
    );
    expect(attachment.rawPayload).toEqual(Buffer.from([1, 2, 3]));
  });

  it("opens and reveals scoped managed attachments through privileged routes", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { title: "Files", accent: "amber" },
    });
    const form = new FormData();
    form.append("files", new File(["deck"], "roadmap.pptx"));
    await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: form,
    });
    const headers = {
      host: "127.0.0.1:4173",
      origin: "http://127.0.0.1:4173",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      "content-type": "application/json",
    };

    const opened = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes/id-2/attachments/id-3/open",
      headers,
      payload: {},
    });
    const revealed = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes/id-2/attachments/id-3/reveal",
      headers,
      payload: {},
    });

    expect(opened.statusCode).toBe(204);
    expect(revealed.statusCode).toBe(204);
    expect(nativeFileActions.open).toHaveBeenCalledOnce();
    expect(nativeFileActions.reveal).toHaveBeenCalledOnce();

    Object.defineProperty(nativeFileActions, "supported", { value: false });
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes/id-2/attachments/id-3/open",
      headers,
      payload: {},
    });
    expect(unsupported.statusCode).toBe(501);
    expect(unsupported.json()).toMatchObject({
      code: "native_action_unsupported",
    });
  });

  it.each([
    {
      name: "missing origin",
      headers: {
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
    },
    {
      name: "mismatched origin",
      headers: {
        origin: "http://localhost:4173",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
    },
    {
      name: "cross-site metadata",
      headers: {
        origin: "http://127.0.0.1:4173",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
    },
    {
      name: "missing fetch mode",
      headers: {
        origin: "http://127.0.0.1:4173",
        "sec-fetch-site": "same-origin",
        "sec-fetch-dest": "empty",
      },
    },
  ])("rejects native action requests with $name", async ({ headers }) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/chats/unknown/notes/unknown/attachments/unknown/open",
      headers: {
        host: "127.0.0.1:4173",
        "content-type": "application/json",
        ...headers,
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(nativeFileActions.open).not.toHaveBeenCalled();
  });

  it("rejects non-empty native action bodies before launch", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/chats/unknown/notes/unknown/attachments/unknown/open",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "content-type": "application/json",
      },
      payload: { path: "/tmp/unsafe" },
    });
    expect(response.statusCode).toBe(400);
    expect(nativeFileActions.open).not.toHaveBeenCalled();
  });

  it("shares a narrow native-action rate limit before service work", async () => {
    const headers = {
      host: "localhost:4173",
      origin: "http://localhost:4173",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      "content-type": "application/json",
    };
    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(
        await app.inject({
          method: "POST",
          url: `/api/chats/missing/notes/missing/attachments/missing/${attempt % 2 ? "open" : "reveal"}`,
          headers,
          payload: {},
        }),
      );
    }

    expect(
      responses.slice(0, 10).map((response) => response.statusCode),
    ).toEqual(Array(10).fill(404));
    expect(responses[10].statusCode).toBe(429);
    expect(responses[10].json()).toEqual({
      code: "native_action_rate_limited",
      message: "Native file actions are temporarily rate-limited.",
    });
  });

  it("returns a recoverable conflict without launching blocked file types", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Files", accent: "amber" },
    });
    const form = new FormData();
    form.append("files", new File(["run"], "INSTALLER.EXE"));
    await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: form,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes/id-2/attachments/id-3/open",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "content-type": "application/json",
      },
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain(directory);
    expect(nativeFileActions.open).not.toHaveBeenCalled();
  });

  it("exports attachment metadata accepted through multipart ingestion", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Files", accent: "amber" },
    });
    const form = new FormData();
    form.append(
      "files",
      new File(["notes"], "C:notes.txt", {
        type: "text/plain; charset=utf-8",
      }),
    );
    const note = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: form,
    });

    expect(note.statusCode).toBe(201);
    expect(note.json()).toMatchObject({
      body: "",
      attachments: [{ filename: "C:notes.txt" }],
    });
    const exported = await app.inject({
      method: "GET",
      url: "/api/database/export",
      headers: { host: "localhost:4173" },
    });
    expect(exported.statusCode).toBe(200);
  });

  it("edits attachment messages through multipart by keeping and adding files", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { title: "Files", accent: "amber" },
    });
    const createForm = new FormData();
    createForm.set("body", "Original");
    createForm.append("files", new File(["keep"], "keep.pdf"));
    createForm.append("files", new File(["remove"], "remove.pdf"));
    await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: createForm,
    });

    const updateForm = new FormData();
    updateForm.set("body", "Updated");
    updateForm.set("createdAt", "500");
    updateForm.append("keepAttachmentIds", "id-3");
    updateForm.append("files", new File(["new"], "new.pptx"));
    const updated = await app.inject({
      method: "PATCH",
      url: "/api/chats/id-1/notes/id-2",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: updateForm,
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      body: "Updated",
      createdAt: 500,
      attachments: [
        { id: "id-3", filename: "keep.pdf" },
        { id: "id-5", filename: "new.pptx" },
      ],
    });
  });

  it("rejects invalid attachment edits without partially changing the message", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { title: "Files", accent: "amber" },
    });
    const createForm = new FormData();
    createForm.set("body", "Original");
    createForm.append("files", new File(["keep"], "keep.pdf"));
    await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: createForm,
    });

    const emptyEdit = new FormData();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/chats/id-1/notes/id-2",
          headers: {
            host: "127.0.0.1:4173",
            origin: "http://127.0.0.1:4173",
          },
          payload: emptyEdit,
        })
      ).statusCode,
    ).toBe(400);

    const tooManyKept = new FormData();
    tooManyKept.set("body", "Too many");
    for (let index = 0; index < 11; index += 1) {
      tooManyKept.append("keepAttachmentIds", `attachment-${index}`);
    }
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/chats/id-1/notes/id-2",
          headers: {
            host: "127.0.0.1:4173",
            origin: "http://127.0.0.1:4173",
          },
          payload: tooManyKept,
        })
      ).statusCode,
    ).toBe(400);

    const emptyFile = new FormData();
    emptyFile.set("body", "Empty file");
    emptyFile.append("files", new File([], "empty.pdf"));
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/chats/id-1/notes/id-2",
          headers: {
            host: "127.0.0.1:4173",
            origin: "http://127.0.0.1:4173",
          },
          payload: emptyFile,
        })
      ).statusCode,
    ).toBe(400);

    const chat = await app.inject({
      method: "GET",
      url: "/api/chats/id-1",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
    });
    expect(chat.json().notes[0]).toMatchObject({
      body: "Original",
      attachments: [{ id: "id-3", filename: "keep.pdf" }],
    });
  });

  it("rejects oversized attachments without creating partial notes", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: { title: "Files", accent: "amber" },
    });
    const form = new FormData();
    form.append(
      "files",
      new File([new Uint8Array(100 * 1024 * 1024 + 1)], "too-big.bin", {
        type: "application/octet-stream",
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
      payload: form,
    });
    const detail = await app.inject({
      method: "GET",
      url: "/api/chats/id-1",
      headers: { host: "localhost:4173" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "invalid_input",
      message: "Please check the submitted values.",
    });
    expect(detail.json().notes).toEqual([]);
  });

  it.each([
    { url: "/api/chats", payload: { title: " ", accent: "coral" } },
    { url: "/api/chats", payload: { title: "Valid", accent: "neon" } },
  ])(
    "rejects malformed input without a partial write",
    async ({ url, payload }) => {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { host: "localhost:4173", origin: "http://localhost:4173" },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: "invalid_input",
        message: "Please check the submitted values.",
      });

      const list = await app.inject({
        url: "/api/chats",
        headers: { host: "localhost:4173" },
      });
      expect(list.json()).toEqual([]);
    },
  );

  it("returns a non-sensitive not-found response", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/chats/missing/notes",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { body: "Keep this draft" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "not_found",
      message: "Project not found.",
    });
  });

  it("returns not found for missing project reads and updates", async () => {
    const read = await app.inject({
      method: "GET",
      url: "/api/chats/missing",
      headers: { host: "localhost:4173" },
    });
    const update = await app.inject({
      method: "PATCH",
      url: "/api/chats/missing",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Still missing" },
    });
    const remove = await app.inject({
      method: "DELETE",
      url: "/api/chats/missing",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
    });

    expect(read.statusCode).toBe(404);
    expect(update.statusCode).toBe(404);
    expect(remove.statusCode).toBe(404);
  });

  it("deletes a project and its messages through the scoped route", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Disposable", accent: "coral" },
    });
    await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { body: "Remove me too" },
    });

    const removed = await app.inject({
      method: "DELETE",
      url: "/api/chats/id-1",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
    });
    const read = await app.inject({
      method: "GET",
      url: "/api/chats/id-1",
      headers: { host: "localhost:4173" },
    });
    const list = await app.inject({
      method: "GET",
      url: "/api/chats",
      headers: { host: "localhost:4173" },
    });

    expect(removed.statusCode).toBe(204);
    expect(read.statusCode).toBe(404);
    expect(list.json()).toEqual([]);
  });

  it("updates and deletes notes through project-scoped routes", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Notes", accent: "coral" },
    });
    await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { body: "Original" },
    });

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/chats/id-1/notes/id-2",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { body: "Revised", createdAt: 750 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ body: "Revised", createdAt: 750 });

    const removed = await app.inject({
      method: "DELETE",
      url: "/api/chats/id-1/notes/id-2",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
    });
    expect(removed.statusCode).toBe(204);

    const detail = await app.inject({
      method: "GET",
      url: "/api/chats/id-1",
      headers: { host: "localhost:4173" },
    });
    expect(detail.json().notes).toEqual([]);
  });

  it("returns not found for missing note updates and deletes", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Notes", accent: "coral" },
    });

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/chats/id-1/notes/missing",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { body: "Still missing" },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/chats/id-1/notes/missing",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
    });

    expect(updated.statusCode).toBe(404);
    expect(deleted.statusCode).toBe(404);
  });

  it("round-trips a versioned backup bundle with managed attachment files", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Exported", accent: "moss" },
    });
    const form = new FormData();
    form.set("body", "Bundled file");
    form.append("files", new File(["sidecar bytes"], "roadmap.txt"));
    await app.inject({
      method: "POST",
      url: "/api/chats/id-1/notes",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: form,
    });

    const exported = await app.inject({
      method: "GET",
      url: "/api/database/export",
      headers: { host: "localhost:4173" },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain(
      "application/vnd.on-track.backup+sqlite",
    );
    expect(exported.headers["content-disposition"]).toMatch(
      /\.on-track-backup"$/,
    );

    const importedDirectory = mkdtempSync(join(tmpdir(), "on-track-import-"));
    const importedPath = join(importedDirectory, "on-track.sqlite");
    const importedDb = openDatabase(importedPath);
    const importedApp = buildApp({
      database: importedDb,
      databasePath: importedPath,
      idFactory: () => "import-id",
      clock: () => 9_000,
    });
    try {
      const imported = await importedApp.inject({
        method: "PUT",
        url: "/api/database/import",
        headers: {
          host: "localhost:4173",
          origin: "http://localhost:4173",
          "content-type": "application/octet-stream",
        },
        payload: exported.rawPayload,
      });
      expect(imported.statusCode).toBe(204);

      const list = await importedApp.inject({
        method: "GET",
        url: "/api/chats",
        headers: { host: "localhost:4173" },
      });
      expect(list.json()).toMatchObject([{ title: "Exported" }]);
      const attachment = await importedApp.inject({
        method: "GET",
        url: "/api/chats/id-1/notes/id-2/attachments/id-3",
        headers: { host: "localhost:4173" },
      });
      expect(attachment.statusCode).toBe(200);
      expect(attachment.rawPayload).toEqual(Buffer.from("sidecar bytes"));

      const inspected = new Database(importedPath, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        expect(
          inspected
            .prepare("SELECT name FROM pragma_table_info('note_attachments')")
            .pluck()
            .all(),
        ).not.toContain("content");
        expect(
          inspected
            .prepare(
              "SELECT name FROM sqlite_schema WHERE name LIKE '_on_track_bundle%'",
            )
            .pluck()
            .all(),
        ).toEqual([]);
      } finally {
        inspected.close();
      }
    } finally {
      await importedApp.close();
      rmSync(importedDirectory, { recursive: true, force: true });
    }
  });

  it("keeps successful transfers successful when temporary cleanup fails", async () => {
    exportDirectoryCleanup.mockImplementationOnce(() => {
      throw new Error("export cleanup failed");
    });
    const exported = await app.inject({
      method: "GET",
      url: "/api/database/export",
      headers: { host: "localhost:4173" },
    });

    expect(exported.statusCode).toBe(200);
    await vi.waitFor(() =>
      expect(exportDirectoryCleanup).toHaveBeenCalledOnce(),
    );

    stagedUploadCleanup.mockImplementationOnce(() => {
      throw new Error("staging cleanup failed");
    });
    const imported = await app.inject({
      method: "PUT",
      url: "/api/database/import",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "content-type": "application/octet-stream",
      },
      payload: exported.rawPayload,
    });

    expect(imported.statusCode).toBe(204);
    expect(stagedUploadCleanup).toHaveBeenCalledOnce();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/chats",
          headers: { host: "localhost:4173" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("rate-limits database exports before repeated filesystem work", async () => {
    const responses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(
        await app.inject({
          method: "GET",
          url: "/api/database/export",
          headers: { host: "localhost:4173" },
        }),
      );
    }

    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 429,
    ]);
    expect(responses[3].json()).toEqual({
      code: "rate_limited",
      message: "Database transfer is temporarily rate-limited.",
    });
    expect(responses[3].headers["retry-after"]).toBe("60");
  });

  it("rate-limits database imports before repeated filesystem work", async () => {
    const payload = Buffer.from("not sqlite");
    const responses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      responses.push(
        await app.inject({
          method: "PUT",
          url: "/api/database/import",
          headers: {
            host: "localhost:4173",
            origin: "http://localhost:4173",
            "content-type": "application/octet-stream",
          },
          payload,
        }),
      );
    }

    expect(responses.map((response) => response.statusCode)).toEqual([
      400, 400, 429,
    ]);
    expect(responses[2].json()).toEqual({
      code: "rate_limited",
      message: "Database transfer is temporarily rate-limited.",
    });
    expect(responses[2].headers["retry-after"]).toBe("60");
  });

  it("rejects raw and pre-v0.0.3 backup imports without replacing local data", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Keep me", accent: "iris" },
    });
    const before = readFileSync(join(directory, "on-track.sqlite"));
    writeFileSync(join(directory, "not-a-db.sqlite"), "not sqlite");

    const imported = await app.inject({
      method: "PUT",
      url: "/api/database/import",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "content-type": "application/octet-stream",
      },
      payload: readFileSync(join(directory, "not-a-db.sqlite")),
    });

    expect(imported.statusCode).toBe(400);
    expect(readFileSync(join(directory, "on-track.sqlite"))).toEqual(before);

    const exported = await app.inject({
      method: "GET",
      url: "/api/database/export",
      headers: { host: "localhost:4173" },
    });
    const legacyPath = join(directory, "legacy.on-track-backup");
    writeFileSync(legacyPath, exported.rawPayload);
    const legacy = new Database(legacyPath);
    legacy.exec("UPDATE _on_track_bundle SET schema_version = 1");
    legacy.close();
    const legacyImport = await app.inject({
      method: "PUT",
      url: "/api/database/import",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "content-type": "application/octet-stream",
      },
      payload: readFileSync(legacyPath),
    });

    expect(legacyImport.statusCode).toBe(400);
    const list = await app.inject({
      method: "GET",
      url: "/api/chats",
      headers: { host: "localhost:4173" },
    });
    expect(list.json()).toMatchObject([{ title: "Keep me" }]);
  });

  it("rejects a domain-invalid bundle without replacing live data", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Keep me", accent: "iris" },
    });
    const exported = await app.inject({
      method: "GET",
      url: "/api/database/export",
      headers: { host: "localhost:4173" },
    });
    const invalidPath = join(directory, "invalid-domain.on-track-backup");
    writeFileSync(invalidPath, exported.rawPayload);
    const invalid = new Database(invalidPath);
    invalid.exec("UPDATE chats SET created_at = 'not-a-timestamp'");
    invalid.close();

    const imported = await app.inject({
      method: "PUT",
      url: "/api/database/import",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "content-type": "application/octet-stream",
      },
      payload: readFileSync(invalidPath),
    });
    const list = await app.inject({
      method: "GET",
      url: "/api/chats",
      headers: { host: "localhost:4173" },
    });

    expect(imported.statusCode).toBe(400);
    expect(list.json()).toMatchObject([{ title: "Keep me" }]);
  });

  it("reports database transfer as unavailable without a managed database path", async () => {
    const unmanagedDirectory = mkdtempSync(
      join(tmpdir(), "on-track-unmanaged-"),
    );
    const unmanagedApp = buildApp({
      database: openDatabase(join(unmanagedDirectory, "on-track.sqlite")),
    });
    try {
      const exported = await unmanagedApp.inject({
        method: "GET",
        url: "/api/database/export",
        headers: { host: "localhost:4173" },
      });
      const imported = await unmanagedApp.inject({
        method: "PUT",
        url: "/api/database/import",
        headers: {
          host: "localhost:4173",
          origin: "http://localhost:4173",
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from("SQLite format 3"),
      });

      expect(exported.statusCode).toBe(501);
      expect(imported.statusCode).toBe(501);
    } finally {
      await unmanagedApp.close();
      rmSync(unmanagedDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an empty backup import before touching local files", async () => {
    const imported = await app.inject({
      method: "PUT",
      url: "/api/database/import",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "content-type": "application/octet-stream",
      },
      payload: Buffer.alloc(0),
    });

    expect(imported.statusCode).toBe(400);
    expect(imported.json()).toEqual({
      code: "invalid_backup",
      message:
        "The selected file is not a valid supported On Track backup bundle.",
    });
  });

  it("returns a recoverable conflict when maintenance blocks a mutation", async () => {
    const gate = new MaintenanceGate();
    let release!: () => void;
    const held = gate.runExport(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const blockedDirectory = mkdtempSync(join(tmpdir(), "on-track-gated-"));
    const blockedPath = join(blockedDirectory, "on-track.sqlite");
    const blockedApp = buildApp({
      database: openDatabase(blockedPath),
      databasePath: blockedPath,
      maintenanceGate: gate,
    });
    try {
      const response = await blockedApp.inject({
        method: "POST",
        url: "/api/chats",
        headers: { host: "localhost:4173", origin: "http://localhost:4173" },
        payload: { title: "Blocked", accent: "moss" },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: "maintenance_busy" });

      const nativeResponse = await blockedApp.inject({
        method: "POST",
        url: "/api/chats/missing/notes/missing/attachments/missing/open",
        headers: {
          host: "localhost:4173",
          origin: "http://localhost:4173",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          "content-type": "application/json",
        },
        payload: {},
      });
      expect(nativeResponse.statusCode).toBe(503);
      expect(nativeResponse.json()).toMatchObject({ code: "maintenance_busy" });
    } finally {
      release();
      await held;
      await blockedApp.close();
      rmSync(blockedDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a valid SQLite file that is not an On Track database", async () => {
    const otherPath = join(directory, "other.sqlite");
    const otherDatabase = openDatabase(otherPath);
    otherDatabase.exec("DROP TABLE notes; DROP TABLE chats;");
    otherDatabase.close();

    const imported = await app.inject({
      method: "PUT",
      url: "/api/database/import",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "content-type": "application/octet-stream",
      },
      payload: readFileSync(otherPath),
    });

    expect(imported.statusCode).toBe(400);
  });

  it("hides unexpected database details behind a generic error", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "First", accent: "coral" },
    });
    sequence = 0;

    const response = await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Duplicate id", accent: "moss" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "internal_error",
      message: "Something went wrong.",
    });
    expect(response.body).not.toContain("UNIQUE");
  });

  it.each([
    { headers: { host: "attacker.example" }, expected: 421 },
    {
      headers: { host: "localhost:4173", origin: "https://attacker.example" },
      expected: 403,
    },
  ])(
    "rejects non-loopback request boundaries",
    async ({ headers, expected }) => {
      const response = await app.inject({
        method: "GET",
        url: "/api/chats",
        headers,
      });
      expect(response.statusCode).toBe(expected);
    },
  );
});
