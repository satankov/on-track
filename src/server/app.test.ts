import { mkdtempSync, rmSync } from "node:fs";
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

    expect(read.statusCode).toBe(404);
    expect(update.statusCode).toBe(404);
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
