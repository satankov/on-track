import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { openDatabase } from "./db/database.js";
import { MaintenanceGate } from "./database-transfer/maintenance-gate.js";

let directory: string;
let app: FastifyInstance;
let gate: MaintenanceGate;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "threadstr-request-security-"));
  const databasePath = join(directory, "on-track.sqlite");
  gate = new MaintenanceGate();
  app = buildApp({
    database: openDatabase(databasePath),
    databasePath,
    maintenanceGate: gate,
  });
});
afterEach(async () => {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});

it.each([
  "/api/chats",
  "/%61pi/chats",
  "/%61%70%69/chats",
  "/api/ch%61ts",
  "/",
  "/missing",
])("rejects hostile hosts independently of raw URL %s", async (url) => {
  const response = await app.inject({
    url,
    headers: {
      host: "attacker.example:4173",
      origin: "http://attacker.example:4173",
    },
  });
  expect(response.statusCode).toBe(421);
});

it.each([
  "http://localhost:3000",
  "http://127.0.0.1:4173",
  "null",
  "https://attacker.example",
  "",
])(
  "rejects a different or invalid supplied Origin %s on an encoded API route",
  async (origin) => {
    const response = await app.inject({
      url: "/%61pi/chats",
      headers: { host: "localhost:4173", origin },
    });
    expect(response.statusCode).toBe(403);
  },
);

it.each(["same-site", "cross-site"])(
  "rejects %s browser uploads before staging even without Origin",
  async (site) => {
    const before = readdirSync(directory).sort();
    const response = await app.inject({
      method: "POST",
      url: "/%61pi/database/import",
      headers: {
        host: "localhost:4173",
        "sec-fetch-site": site,
        "content-type": "multipart/form-data; boundary=missing",
      },
      payload: "not a valid multipart upload",
    });
    expect(response.statusCode).toBe(403);
    expect(readdirSync(directory).sort()).toEqual(before);
    expect((await app.inject("/api/chats")).json()).toEqual([]);
  },
);

it("allows same-origin encoded requests and headerless local clients", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/%61pi/chats",
    headers: {
      host: "localhost:4173",
      origin: "http://localhost:4173",
      "sec-fetch-site": "same-origin",
    },
    payload: { title: "Allowed", accent: "ocean" },
  });
  expect(response.statusCode).toBe(201);
  expect((await app.inject("/api/chats")).json()).toHaveLength(1);
});

it.each([
  "/api/home/releases/check",
  "/api/chats/x/notes/y/attachments/z/open",
])(
  "rejects encoded privileged route %s with matching hostile authority",
  async (url) => {
    const response = await app.inject({
      method: "POST",
      url: url.replace("/api/", "/%61pi/"),
      headers: {
        host: "attacker.example:4173",
        origin: "http://attacker.example:4173",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
      payload: {},
    });
    expect(response.statusCode).toBe(421);
  },
);

it("accounts for encoded API requests while draining, preserving health access", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.get("/api/lease-probe", async () => {
    entered();
    await held;
    return { ok: true };
  });
  const request = app.inject("/%61pi/lease-probe");
  const pending = request.then((response) => response);
  await started;
  let drained = false;
  const drain = gate.freezeAndDrain().then(() => {
    drained = true;
  });
  try {
    expect((await app.inject("/%61pi/health")).statusCode).toBe(200);
    expect((await app.inject("/%61pi/chats")).statusCode).toBe(503);
    expect(drained).toBe(false);
  } finally {
    release();
    await pending;
    await drain;
  }
  expect(drained).toBe(true);
});

it("requires explicit JSON POST export; navigation cannot generate a backup", async () => {
  const navigation = await app.inject({
    method: "GET",
    url: "/api/database/export",
    headers: {
      "sec-fetch-site": "none",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
  });
  expect(navigation.statusCode).toBe(404);
  expect(navigation.headers["content-disposition"]).toBeUndefined();
  const form = await app.inject({
    method: "POST",
    url: "/api/database/export",
    headers: { "content-type": "text/plain" },
    payload: '{"selection":"all"}',
  });
  expect(form.statusCode).toBe(400);
  const missing = await app.inject({
    method: "POST",
    url: "/api/database/export",
    payload: {},
  });
  expect(missing.statusCode).toBe(400);
  const valid = await app.inject({
    method: "POST",
    url: "/api/database/export",
    payload: { selection: "all" },
  });
  expect(valid.statusCode).toBe(200);
  expect(valid.headers["content-disposition"]).toContain("attachment;");
});
