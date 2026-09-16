import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { openDatabase } from "../db/database.js";
import type { FastifyInstance } from "fastify";

let directory: string;
let app: FastifyInstance;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "threadstr-examples-"));
  const databasePath = join(directory, "on-track.sqlite");
  app = buildApp({ database: openDatabase(databasePath), databasePath });
});
afterEach(async () => {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});

it("reads one trip example without seeding user projects or attachments, then creates independent editable copies", async () => {
  const filesBefore = readdirSync(directory, { recursive: true });
  const listed = await app.inject("/api/examples");
  expect(listed.statusCode).toBe(200);
  expect(listed.json()).toHaveLength(1);
  const example = (
    await app.inject(`/api/examples/${listed.json()[0].slug}`)
  ).json();
  expect(example.title).toBe("🇳🇱 Trip to Amsterdam");
  expect((await app.inject("/api/chats")).json()).toEqual([]);
  expect(readdirSync(directory, { recursive: true })).toEqual(filesBefore);
  const first = await app.inject({
    method: "POST",
    url: `/api/examples/${example.slug}/copies`,
    payload: { revision: example.revision },
  });
  expect(first.statusCode).toBe(201);
  const project = first.json().project;
  expect(project).toMatchObject({
    title: "🇳🇱 Trip to Amsterdam (copy)",
    archivedAt: null,
    pinnedAt: null,
  });
  expect(project.notes).toHaveLength(example.notes.length);
  expect(project.notes[0].id).not.toBe(example.notes[0].id);
  expect(
    project.notes.flatMap((n: { attachments: unknown[] }) => n.attachments),
  ).toHaveLength(3);
  const second = (
    await app.inject({
      method: "POST",
      url: `/api/examples/${example.slug}/copies`,
      payload: { revision: example.revision },
    })
  ).json().project;
  expect(second.title).toBe("🇳🇱 Trip to Amsterdam (copy 2)");
  expect(second.notes[0].id).not.toBe(project.notes[0].id);
  await app.inject({ method: "DELETE", url: `/api/chats/${project.id}` });
  expect((await app.inject(`/api/chats/${second.id}`)).statusCode).toBe(200);
  expect((await app.inject(`/api/examples/${example.slug}`)).json()).toEqual(
    example,
  );
});

it("rejects missing, stale and malformed copy requests and original mutations", async () => {
  expect((await app.inject("/api/examples/missing")).statusCode).toBe(404);
  for (const [payload, status] of [
    [{ revision: 999 }, 409],
    [{ revision: 3, path: "../x" }, 400],
  ] as const) {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/examples/weekend-trip/copies",
          payload,
        })
      ).statusCode,
    ).toBe(status);
  }
  const original = (await app.inject("/api/examples/weekend-trip")).json();
  expect(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/chats/${encodeURIComponent(original.id)}`,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/examples/weekend-trip",
        payload: { title: "Changed" },
      })
    ).statusCode,
  ).toBe(404);
  expect((await app.inject("/api/chats")).json()).toEqual([]);
});

it("rate limits copies without reporting a server failure or creating a fourth project", async () => {
  for (let i = 0; i < 3; i++)
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/examples/weekend-trip/copies",
          payload: { revision: 3 },
        })
      ).statusCode,
    ).toBe(201);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/examples/weekend-trip/copies",
        payload: { revision: 3 },
      })
    ).statusCode,
  ).toBe(429);
  expect((await app.inject("/api/chats")).json()).toHaveLength(3);
});

it("rejects native file actions and cross-origin copying for catalog originals", async () => {
  const example = (await app.inject("/api/examples/weekend-trip")).json();
  const note = example.notes.find(
    (n: { attachments?: unknown[] }) => n.attachments?.length,
  );
  const file = note.attachments[0];
  for (const action of ["open", "reveal"]) {
    const response = await app.inject({
      method: "POST",
      url: `/api/chats/${encodeURIComponent(example.id)}/notes/${encodeURIComponent(note.id)}/attachments/${encodeURIComponent(file.id)}/${action}`,
      headers: {
        host: "127.0.0.1",
        origin: "http://127.0.0.1",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  }
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/examples/weekend-trip/copies",
        headers: { origin: "https://evil.example" },
        payload: { revision: 3 },
      })
    ).statusCode,
  ).toBe(403);
  expect((await app.inject("/api/chats")).json()).toEqual([]);
});

it("rejects oversized copy input before any publication", async () => {
  const result = await app.inject({
    method: "POST",
    url: "/api/examples/weekend-trip/copies",
    payload: { revision: 3, data: "x".repeat(2048) },
  });
  expect(result.statusCode).toBe(413);
  expect((await app.inject("/api/chats")).json()).toEqual([]);
});
