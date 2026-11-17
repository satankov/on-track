import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDatabase } from "./db/database.js";

describe("durable outgoing drafts", () => {
  let directory: string;
  let app: FastifyInstance;
  let chatId: string;
  let db: ReturnType<typeof openDatabase>;
  const fields = {
    body: "  One\n\nTwo  ",
    sender: "Nina",
    senderOpen: true,
    timestamp: "2026-11-12T10:00",
    timestampOpen: true,
  };
  function open() {
    const databasePath = join(directory, "test.sqlite");
    db = openDatabase(databasePath);
    app = buildApp({ database: db, databasePath });
  }
  const get = () => app.inject({ url: `/api/chats/${chatId}/draft` });
  function put(
    revision: string | null,
    keepAttachmentIds: string[] = [],
    files: string[] = [],
    overrides: Record<string, unknown> = {},
  ) {
    const form = new FormData();
    form.set(
      "draft",
      JSON.stringify({ ...fields, revision, keepAttachmentIds, ...overrides }),
    );
    for (const name of files) form.append("files", new Blob([name]), name);
    return app.inject({
      method: "PUT",
      url: `/api/chats/${chatId}/draft`,
      payload: form,
    });
  }
  const send = (revision: string) =>
    app.inject({
      method: "POST",
      url: `/api/chats/${chatId}/draft/send`,
      payload: { revision, createdAt: 1700 },
    });
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "thr-draft-"));
    open();
    chatId = (
      await app.inject({
        method: "POST",
        url: "/api/chats",
        payload: { title: "Drafts", accent: "ocean" },
      })
    ).json().id;
  });
  afterEach(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it("recovers the exact composer after restart and sends each file once in the selected order", async () => {
    expect((await get()).json()).toMatchObject({
      revision: null,
      body: "",
      attachments: [],
    });
    const response = await put(null, [], ["two.txt", "one.txt"]);
    expect(response.statusCode).toBe(200);
    const draft = response.json();
    expect(draft).toMatchObject({
      ...fields,
      attachments: [
        { filename: "two.txt", status: "available" },
        { filename: "one.txt", status: "available" },
      ],
    });
    const ids = draft.attachments
      .map((file: { id: string }) => file.id)
      .reverse();
    const reordered = (await put(draft.revision, ids)).json();
    await app.close();
    open();
    expect((await get()).json()).toEqual(reordered);
    expect(
      (await app.inject({ url: `/api/chats/${chatId}` })).json().notes,
    ).toEqual([]);
    const sent = await send(reordered.revision);
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      body: "One\n\nTwo",
      sender: "Nina",
      createdAt: 1700,
      attachments: [
        { id: ids[0], filename: "one.txt" },
        { id: ids[1], filename: "two.txt" },
      ],
    });
    expect((await send(reordered.revision)).json()).toEqual({
      ...sent.json(),
      replayed: true,
    });
    expect((await get()).json()).toMatchObject({
      body: "",
      attachments: [],
      sender: "",
      senderOpen: false,
      timestampOpen: false,
      timestamp: "",
    });
    expect((await put(null)).statusCode).toBe(409);
    expect((await put(reordered.revision)).statusCode).toBe(409);
  });
  it("rejects stale updates, foreign files, excess files and unavailable attachments without losing the draft", async () => {
    const saved = await put(null, [], ["recover.txt"]);
    expect(saved.statusCode).toBe(200);
    const draft = saved.json();
    expect((await put(null, [], ["stale.txt"])).statusCode).toBe(409);
    expect((await put(draft.revision, ["foreign"])).statusCode).toBe(400);
    expect(
      (
        await put(
          draft.revision,
          [draft.attachments[0].id],
          Array.from({ length: 10 }, (_, i) => i + ".txt"),
        )
      ).statusCode,
    ).toBe(400);
    const path = db
      .prepare("SELECT storage_path FROM note_attachments WHERE id=?")
      .pluck()
      .get(draft.attachments[0].id) as string;
    unlinkSync(join(directory, path));
    expect((await get()).json().attachments[0].status).toBe("missing");
    expect((await send(draft.revision)).statusCode).toBe(409);
    const restored = (await put(draft.revision, [], ["again.txt"])).json();
    expect(restored.attachments[0].filename).toBe("again.txt");
    expect((await send(restored.revision)).statusCode).toBe(201);
  });
  it("preserves an empty/picker-only draft on an invalid send and rejects writes after chat deletion", async () => {
    const saved = (await put(null, [], [], { body: "" })).json();
    expect((await send(saved.revision)).statusCode).toBe(400);
    expect((await get()).json()).toEqual(saved);
    expect(
      (await put(saved.revision, [], [], { timestamp: "invalid" })).statusCode,
    ).toBe(400);
    await app.inject({ method: "DELETE", url: `/api/chats/${chatId}` });
    expect((await put(saved.revision)).statusCode).toBe(404);
    expect((await get()).statusCode).toBe(404);
  });
  it("retains ten files, rolls back a failed send and releases their sidecars on removal or project deletion", async () => {
    const parent = chatId;
    chatId = (
      await app.inject({
        method: "POST",
        url: `/api/chats/${parent}/subthreads`,
        payload: { title: "Subthread" },
      })
    ).json().id;
    const names = Array.from({ length: 10 }, (_, i) => `file-${i}.txt`);
    const first = await put(null, [], names, { body: "" });
    expect(first.statusCode).toBe(200);
    const saved = first.json();
    const paths = db
      .prepare(
        "SELECT storage_path FROM note_attachments WHERE draft_chat_id=? ORDER BY position",
      )
      .pluck()
      .all(chatId) as string[];
    expect(paths).toHaveLength(10);
    expect(saved.attachments).toHaveLength(10);
    expect(saved.attachments[0]).not.toHaveProperty("storagePath");
    db.exec(
      "CREATE TRIGGER interrupt_send BEFORE UPDATE OF note_id ON note_attachments BEGIN SELECT RAISE(ABORT,'test rollback'); END",
    );
    expect((await send(saved.revision)).statusCode).toBe(500);
    expect((await get()).json()).toEqual(saved);
    expect(
      (await app.inject({ url: `/api/chats/${chatId}` })).json().notes,
    ).toEqual([]);
    db.exec("DROP TRIGGER interrupt_send");
    await put(saved.revision, [saved.attachments[0].id]);
    expect(existsSync(join(directory, paths[0]!))).toBe(true);
    expect(existsSync(join(directory, paths[1]!))).toBe(false);
    await app.inject({ method: "DELETE", url: `/api/chats/${parent}` });
    expect(existsSync(join(directory, paths[0]!))).toBe(false);
    expect(
      db.prepare("SELECT COUNT(*) FROM conversation_drafts").pluck().get(),
    ).toBe(0);
  });
  it("retains a newer outgoing draft when retrying an already delivered message", async () => {
    const saved = (
      await put(null, [], ["file-only.txt"], {
        body: "",
        timestamp: "",
        timestampOpen: false,
      })
    ).json();
    const delivered = (await send(saved.revision)).json();
    const next = (
      await put(delivered.draftRevision, [], [], { body: "second" })
    ).json();
    expect(next.body).toBe("second");
    const replay = (await send(saved.revision)).json();
    expect(replay).toMatchObject({
      id: delivered.id,
      replayed: true,
      draftRevision: next.revision,
    });
    expect((await get()).json()).toEqual(next);
    expect(
      (await app.inject({ url: `/api/chats/${chatId}` })).json().notes,
    ).toHaveLength(1);
  });
});
