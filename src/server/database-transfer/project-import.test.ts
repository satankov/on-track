import {
  mkdtempSync,
  rmSync,
  readFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { openDatabase } from "../db/database.js";
import { ManagedAttachmentStore } from "../attachments/managed-attachment-store.js";
import { allocateImportedTitles } from "./project-import.js";
import * as projectImport from "./project-import.js";

let directory: string;
let app: FastifyInstance;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "on-track-selective-"));
  const path = join(directory, "on-track.sqlite");
  app = buildApp({
    database: openDatabase(path),
    databasePath: path,
    clock: () => Date.UTC(2026, 8, 9, 14, 30),
  });
});
afterEach(async () => {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});
async function fixture() {
  const a = (
    await app.inject({
      method: "POST",
      url: "/api/chats",
      payload: { title: "A", accent: "ocean" },
    })
  ).json();
  const b = (
    await app.inject({
      method: "POST",
      url: "/api/chats",
      payload: { title: "B", accent: "moss" },
    })
  ).json();
  const form = new FormData();
  form.set("body", "Decision");
  form.set("sender", "Alex");
  form.append("files", new File(["important file"], "data.txt"));
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/chats/${a.id}/notes`,
        payload: form,
      })
    ).statusCode,
  ).toBe(201);
  await app.inject({ method: "PUT", url: `/api/chats/${a.id}/archive` });
  await app.inject({
    method: "PATCH",
    url: `/api/chats/${a.id}`,
    payload: { enabledLabels: ["risk"], collapseLongMessages: false },
  });
  const note = (await app.inject(`/api/chats/${a.id}`)).json().notes[0];
  await app.inject({
    method: "PUT",
    url: `/api/chats/${a.id}/notes/${note.id}/labels/attention`,
  });
  const backup = (
    await app.inject({ method: "GET", url: "/api/database/export" })
  ).rawPayload;
  const response = await app.inject({
    method: "POST",
    url: "/api/database/import/preview",
    headers: { "content-type": "application/octet-stream" },
    payload: backup,
  });
  expect(response.statusCode, response.body).toBe(200);
  return { a, b, backup, preview: response.json() };
}
function importForm(backup: Buffer, options: unknown) {
  const form = new FormData();
  form.set("options", JSON.stringify(options));
  form.append(
    "file",
    new File([new Uint8Array(backup)], "backup.on-track-backup"),
  );
  return form;
}
it("previews and merges selected independent projects with all content and fresh identities", async () => {
  const { a, b, backup, preview } = await fixture();
  expect(preview.projects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: a.id,
        messageCount: 1,
        attachmentCount: 1,
        archivedAt: expect.any(Number),
      }),
      expect.objectContaining({ id: b.id }),
    ]),
  );
  const original = (await app.inject(`/api/chats/${a.id}`)).json();
  const response = await app.inject({
    method: "POST",
    url: "/api/database/import",
    payload: importForm(backup, {
      mode: "merge",
      selection: [a.id],
      digest: preview.digest,
    }),
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toEqual({
    importedCount: 1,
    renames: [{ original: "A", renamed: "A_2026-09-09_14-30-00Z" }],
  });
  const chats = (await app.inject("/api/chats")).json();
  expect(chats).toHaveLength(3);
  expect((await app.inject(`/api/chats/${a.id}`)).json()).toEqual(original);
  const imported = (
    await app.inject(
      `/api/chats/${chats.find((c: { title: string }) => c.title.startsWith("A_")).id}`,
    )
  ).json();
  expect(imported.archivedAt).toBe(original.archivedAt);
  expect(imported.notes[0]).toMatchObject({ body: "Decision", sender: "Alex" });
  expect(imported.notes[0].labels).toEqual(["attention"]);
  expect(imported.enabledLabels).toEqual(["risk"]);
  expect(imported.collapseLongMessages).toBe(false);
  expect(imported.notes[0].id).not.toBe(original.notes[0].id);
  const db = openDatabase(join(directory, "on-track.sqlite"));
  const paths = db
    .prepare("SELECT storage_path FROM note_attachments")
    .pluck()
    .all() as string[];
  db.close();
  expect(new Set(paths).size).toBe(2);
  for (const path of paths)
    expect(readFileSync(join(directory, path), "utf8")).toBe("important file");
});
it("replaces the database with only checked projects", async () => {
  const { b, backup, preview } = await fixture();
  const response = await app.inject({
    method: "POST",
    url: "/api/database/import",
    payload: importForm(backup, {
      mode: "replace",
      selection: [b.id],
      digest: preview.digest,
    }),
  });
  expect(response.statusCode, response.body).toBe(200);
  expect((await app.inject("/api/chats")).json()).toEqual([
    expect.objectContaining({ id: b.id, title: "B" }),
  ]);
});
it("rejects changed files and unknown selection without changing projects", async () => {
  const { a, backup, preview } = await fixture();
  for (const options of [
    { mode: "merge", selection: [a.id], digest: "0".repeat(64) },
    { mode: "replace", selection: ["missing"], digest: preview.digest },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/database/import",
      payload: importForm(backup, options),
    });
    expect(response.statusCode, response.body).toBe(400);
  }
  expect((await app.inject("/api/chats")).json()).toHaveLength(2);
});

it("reserves unchanged incoming names and resolves duplicate, repeated, and Unicode titles", () => {
  const now = Date.UTC(2026, 8, 9, 14, 30);
  const suffix = "_2026-09-09_14-30-00Z";
  const long = "😀".repeat(40);
  const names = allocateImportedTitles(
    [
      { id: "1", title: "A" },
      { id: "2", title: "A" },
      { id: "3", title: "A" + suffix },
      { id: "4", title: long },
      { id: "5", title: "a" },
    ],
    ["A", long],
    now,
  );
  expect([...names.values()]).toEqual(
    expect.arrayContaining([
      "A" + suffix,
      "A" + suffix + "_2",
      "A" + suffix + "_3",
      "a",
    ]),
  );
  const renamed = names.get("4")!;
  expect(renamed.length).toBeLessThanOrEqual(80);
  expect(renamed).toBe(
    "😀".repeat(Math.floor((80 - suffix.length) / 2)) + suffix,
  );
  expect(
    allocateImportedTitles(
      [{ id: "1", title: "A" }],
      [...names.values(), "A"],
      now,
    ).get("1"),
  ).toBe("A" + suffix + "_4");
});

it("merges successfully with an unavailable existing attachment", async () => {
  const { a, backup, preview } = await fixture();
  const db = openDatabase(join(directory, "on-track.sqlite"));
  const path = db
    .prepare("SELECT storage_path FROM note_attachments")
    .pluck()
    .get() as string;
  db.close();
  unlinkSync(join(directory, path));
  const response = await app.inject({
    method: "POST",
    url: "/api/database/import",
    payload: importForm(backup, {
      mode: "merge",
      selection: [a.id],
      digest: preview.digest,
    }),
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(
    (await app.inject(`/api/chats/${a.id}`)).json().notes[0].attachments[0]
      .status,
  ).toBe("missing");
});

it("rolls back every inserted row and newly published file when SQLite rejects an import", async () => {
  const { a, backup, preview } = await fixture();
  const db = openDatabase(join(directory, "on-track.sqlite"));
  db.exec(
    "CREATE TRIGGER reject_import BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT,'injected failure'); END",
  );
  const originalPaths = db
    .prepare("SELECT storage_path FROM note_attachments")
    .pluck()
    .all();
  db.close();
  const response = await app.inject({
    method: "POST",
    url: "/api/database/import",
    payload: importForm(backup, {
      mode: "merge",
      selection: [a.id],
      digest: preview.digest,
    }),
  });
  expect(response.statusCode).toBe(500);
  expect((await app.inject("/api/chats")).json()).toHaveLength(2);
  const files = readdirSync(join(directory, "attachments"), {
    recursive: true,
  }).filter((path) => String(path).endsWith("data.txt"));
  expect(files).toHaveLength(1);
  expect(readFileSync(join(directory, String(originalPaths[0])), "utf8")).toBe(
    "important file",
  );
});

it("cleans a published file if a later file cannot be installed", async () => {
  const { a } = await fixture();
  const form = new FormData();
  form.set("body", "Second");
  form.append("files", new File(["second"], "second.txt"));
  await app.inject({
    method: "POST",
    url: `/api/chats/${a.id}/notes`,
    payload: form,
  });
  const backup = (await app.inject("/api/database/export")).rawPayload;
  const preview = (
    await app.inject({
      method: "POST",
      url: "/api/database/import/preview",
      headers: { "content-type": "application/octet-stream" },
      payload: backup,
    })
  ).json();
  const create = ManagedAttachmentStore.prototype.create;
  let count = 0;
  const spy = vi
    .spyOn(ManagedAttachmentStore.prototype, "create")
    .mockImplementation(function (this: ManagedAttachmentStore, input) {
      if (++count === 4) throw new Error("disk failure");
      return create.call(this, input);
    });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/database/import",
      payload: importForm(backup, {
        mode: "merge",
        selection: [a.id],
        digest: preview.digest,
      }),
    });
    expect(response.statusCode).toBe(500);
    expect(count).toBe(4);
    expect((await app.inject("/api/chats")).json()).toHaveLength(2);
    expect(
      readdirSync(join(directory, "attachments"), { recursive: true }).filter(
        (path) => String(path).endsWith(".txt"),
      ),
    ).toHaveLength(2);
  } finally {
    spy.mockRestore();
  }
});

it.each([
  "extra",
  "duplicate",
  "unknown-mode",
  "empty",
  "missing-file",
  "missing-options",
])("rejects malformed multipart %s", async (kind) => {
  const { backup, preview } = await fixture();
  const form = importForm(backup, {
    mode: kind === "unknown-mode" ? "unexpected" : "merge",
    selection: kind === "empty" ? [] : "all",
    digest: preview.digest,
  });
  if (kind === "extra") form.set("extra", "bad");
  if (kind === "duplicate") form.append("options", String(form.get("options")));
  if (kind === "missing-file") form.delete("file");
  if (kind === "missing-options") form.delete("options");
  const response = await app.inject({
    method: "POST",
    url: "/api/database/import",
    payload: form,
  });
  expect(response.statusCode, response.body).toBe(400);
  expect((await app.inject("/api/chats")).json()).toHaveLength(2);
});

it("accepts file-before-options and keeps preview query strings read-only", async () => {
  const { backup, preview } = await fixture();
  const response = await app.inject({
    method: "POST",
    url: "/api/database/import/preview?check=1",
    headers: { "content-type": "application/octet-stream" },
    payload: backup,
  });
  expect(response.statusCode, response.body).toBe(200);
  expect((await app.inject("/api/chats")).json()).toHaveLength(2);
  const form = new FormData();
  form.append("file", new File([new Uint8Array(backup)], "b"));
  form.set(
    "options",
    JSON.stringify({ mode: "merge", selection: "all", digest: preview.digest }),
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/database/import",
        payload: form,
      })
    ).statusCode,
  ).toBe(200);
});

it("shares export budgets across GET and POST and import budgets across PUT and POST", async () => {
  const { backup, preview } = await fixture();
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/database/export",
        payload: { selection: "all" },
      })
    ).statusCode,
  ).toBe(200);
  expect((await app.inject("/api/database/export")).statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/database/export",
        payload: { selection: "all" },
      })
    ).statusCode,
  ).toBe(429);
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/database/import",
        headers: { "content-type": "application/octet-stream" },
        payload: backup,
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/database/import",
        payload: importForm(backup, {
          mode: "merge",
          selection: "all",
          digest: preview.digest,
        }),
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/database/import",
        headers: { "content-type": "application/octet-stream" },
        payload: backup,
      })
    ).statusCode,
  ).toBe(429);
});

it("allows an originally empty backup to merge as a no-op or replace the database", async () => {
  const backup = (await app.inject("/api/database/export")).rawPayload;
  const preview = (
    await app.inject({
      method: "POST",
      url: "/api/database/import/preview",
      headers: { "content-type": "application/octet-stream" },
      payload: backup,
    })
  ).json();
  await app.inject({
    method: "POST",
    url: "/api/chats",
    payload: { title: "Keep", accent: "ocean" },
  });
  for (const mode of ["merge", "replace"]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/database/import",
      payload: importForm(backup, {
        mode,
        selection: "all",
        digest: preview.digest,
      }),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ importedCount: 0, renames: [] });
    expect((await app.inject("/api/chats")).json()).toHaveLength(
      mode === "merge" ? 1 : 0,
    );
  }
});

it("cancels before commit if the response connection closes after the complete upload", async () => {
  const { backup, preview } = await fixture();
  let release!: () => void;
  let started!: () => void;
  let closed!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hashing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const connectionClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const digest = projectImport.backupDigest;
  const spy = vi
    .spyOn(projectImport, "backupDigest")
    .mockImplementation(async (path) => {
      started();
      await waiting;
      return digest(path);
    });
  try {
    // The hook is registered on a separate server because fixture() made app ready.
    await app.close();
    const path = join(directory, "on-track.sqlite");
    app = buildApp({ database: openDatabase(path), databasePath: path });
    app.addHook("onRequest", async (_request, reply) => {
      reply.raw.once("close", closed);
    });
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const upload = fetch(`${url}/api/database/import`, {
      method: "POST",
      body: importForm(backup, {
        mode: "replace",
        selection: [preview.projects[0].id],
        digest: preview.digest,
      }),
      signal: controller.signal,
    }).catch(() => undefined);
    await hashing;
    controller.abort();
    await connectionClosed;
    release();
    await upload;
    await vi.waitFor(() =>
      expect(readdirSync(join(directory, ".transfer-staging"))).toEqual([]),
    );
    expect((await app.inject("/api/chats")).json()).toHaveLength(2);
  } finally {
    release();
    spy.mockRestore();
  }
});

it.each(["before", "after"])(
  "preserves a complete database across process exit %s merge commit",
  async (point) => {
    await fixture();
    await app.close();
    const path = join(directory, "on-track.sqlite");
    const script = `
    import {openDatabase} from './src/server/db/database.ts';
    import {mergePreparedProjects} from './src/server/database-transfer/project-import.ts';
    import {ManagedAttachmentStore} from './src/server/attachments/managed-attachment-store.ts';
    const [path, directory, point] = process.argv.slice(1);
    const db = openDatabase(path);
    if (point === 'before') {
      const create = ManagedAttachmentStore.prototype.create;
      ManagedAttachmentStore.prototype.create = function(input) { create.call(this,input); process.exit(77); };
    } else {
      const transaction = db.transaction.bind(db);
      db.transaction = fn => { const execute = transaction(fn); return (...args) => { execute(...args); process.exit(78); }; };
    }
    mergePreparedProjects({database:db,candidateDatabasePath:path,candidateDataDirectory:directory,dataDirectory:directory,now:1000});
  `;
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
        path,
        directory,
        point,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    expect(child.status, child.stderr).toBe(point === "before" ? 77 : 78);
    const db = openDatabase(path);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT count(*) FROM chats").pluck().get()).toBe(
      point === "before" ? 2 : 4,
    );
    const paths = db
      .prepare("SELECT storage_path FROM note_attachments")
      .pluck()
      .all() as string[];
    for (const storagePath of paths)
      expect(readFileSync(join(directory, storagePath), "utf8")).toBe(
        "important file",
      );
    app = buildApp({ database: db, databasePath: path });
  },
  30000,
);
