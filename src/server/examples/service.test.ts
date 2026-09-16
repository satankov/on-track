import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import Fastify from "fastify";
import { openDatabase } from "../db/database.js";
import { ManagedAttachmentStore } from "../attachments/managed-attachment-store.js";
import { MaintenanceGate } from "../database-transfer/maintenance-gate.js";
import { copyExample } from "./service.js";
import { getExample, exampleFileContent } from "./catalog.js";
import { registerExampleRoutes } from "./routes.js";

let directory: string;
let database: Database.Database;
let store: ManagedAttachmentStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "on-track-example-copy-"));
  database = openDatabase(join(directory, "on-track.sqlite"));
  store = new ManagedAttachmentStore(directory);
});
afterEach(() => {
  if (database.open) database.close();
  rmSync(directory, { force: true, recursive: true });
});

it("rolls back all rows and newly published files if the transaction fails", () => {
  database.exec(
    "CREATE TRIGGER reject_example BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  );
  const created = vi.spyOn(store, "create");
  const removed = vi.spyOn(store, "remove");
  expect(() =>
    copyExample(database, store, getExample("weekend-trip")!, Date.now()),
  ).toThrow("injected failure");
  expect(database.prepare("SELECT COUNT(*) AS n FROM chats").get()).toEqual({
    n: 0,
  });
  for (const result of created.mock.results) {
    const path = result.value.storagePath;
    expect(removed).toHaveBeenCalledWith(path);
    expect(existsSync(join(directory, path))).toBe(false);
  }
});

it("cleans the first file if later publication fails, and leaves prior copies intact", () => {
  const example = getExample("weekend-trip")!;
  const first = copyExample(database, store, example, Date.now());
  const fileNote = example.notes.find((n) => n.attachments?.length)!;
  example.notes.at(-1)!.attachments = structuredClone(fileNote.attachments);
  const create = store.create.bind(store);
  vi.spyOn(store, "create")
    .mockImplementationOnce(create)
    .mockImplementationOnce(() => {
      throw new Error("disk full");
    });
  expect(() => copyExample(database, store, example, Date.now())).toThrow(
    "disk full",
  );
  expect(database.prepare("SELECT id FROM chats").all()).toEqual([
    { id: first },
  ]);
  const original = database
    .prepare("SELECT storage_path FROM note_attachments WHERE filename = ?")
    .get("packing-list.txt") as { storage_path: string };
  expect(store.read(original.storage_path).content.toString()).toContain(
    "AMSTERDAM — PACKING LIST",
  );
});

it("keeps committed rows and files even when preparing the response fails", async () => {
  const app = Fastify();
  await registerExampleRoutes(app, {
    database: () => database,
    detail: () => {
      throw new Error("refresh failed");
    },
    store,
    gate: new MaintenanceGate(),
    clock: Date.now,
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/examples/weekend-trip/copies",
    payload: { revision: 3 },
  });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toEqual({ id: expect.any(String) });
  expect(database.prepare("SELECT id FROM chats").get()).toEqual(
    response.json(),
  );
  expect(
    database.prepare("SELECT COUNT(*) AS n FROM note_attachments").get(),
  ).toEqual({ n: 3 });
  await app.close();
});

it("does not expose mutable catalog objects or unrecognized asset bytes", () => {
  const original = getExample("weekend-trip")!;
  original.notes[0].body = "changed";
  expect(getExample("weekend-trip")!.notes[0].body).not.toBe("changed");
  expect(() => exampleFileContent("../../private")).toThrow();
});

it("excludes copying while restore owns the maintenance gate", async () => {
  const gate = new MaintenanceGate();
  const app = Fastify();
  await registerExampleRoutes(app, {
    database: () => database,
    detail: () => {
      throw new Error("unexpected refresh");
    },
    store,
    gate,
    clock: Date.now,
  });
  // The real app maps the domain busy error to HTTP 503; here assert no copy.
  await gate.runRestore(async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/examples/weekend-trip/copies",
      payload: { revision: 3 },
    });
    expect(response.statusCode).not.toBe(201);
  });
  expect(database.prepare("SELECT COUNT(*) AS n FROM chats").get()).toEqual({
    n: 0,
  });
  await app.close();
});

it("new catalog revisions do not rewrite an existing user copy", () => {
  const original = getExample("weekend-trip")!;
  const oldId = copyExample(database, store, original, Date.now());
  const revised = structuredClone(original);
  revised.revision++;
  revised.notes[0].body = "A revised trip introduction.";
  const newId = copyExample(database, store, revised, Date.now());
  const firstBody = (id: string) =>
    database
      .prepare(
        "SELECT body FROM notes WHERE chat_id = ? ORDER BY created_at LIMIT 1",
      )
      .get(id);
  expect(firstBody(oldId)).toEqual({ body: original.notes[0].body });
  expect(firstBody(newId)).toEqual({ body: revised.notes[0].body });
});
