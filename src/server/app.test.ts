import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { openDatabase } from "./db/database.js";

describe("local project-chat API", () => {
  let directory: string;
  let app: FastifyInstance;
  let sequence: number;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "on-track-api-"));
    sequence = 0;
    app = buildApp({
      database: openDatabase(join(directory, "on-track.sqlite")),
      databasePath: join(directory, "on-track.sqlite"),
      idFactory: () => `id-${++sequence}`,
      clock: () => 1_000 + sequence,
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

  it("exports and imports a validated SQLite backup", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { title: "Exported", accent: "moss" },
    });

    const exported = await app.inject({
      method: "GET",
      url: "/api/database/export",
      headers: { host: "localhost:4173" },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain(
      "application/vnd.sqlite3",
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
    } finally {
      await importedApp.close();
      rmSync(importedDirectory, { recursive: true, force: true });
    }
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

  it("rejects an invalid database import without replacing local data", async () => {
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
    const list = await app.inject({
      method: "GET",
      url: "/api/chats",
      headers: { host: "localhost:4173" },
    });
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

  it("rejects an empty database import before touching local files", async () => {
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
      code: "invalid_database",
      message: "Choose a non-empty On Track database backup.",
    });
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
