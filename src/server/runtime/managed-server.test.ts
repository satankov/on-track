import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { parseManagedLaunch, readInstance } from "./managed-server.js";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
it("rejects malformed or secret-bearing unrecognized launch options", () => {
  const launch = {
    installRoot: join(tmpdir(), "runtime"),
    dataDirectory: join(tmpdir(), "data"),
    port: 4173,
    releaseId: "v0.0.9",
    version: "0.0.9",
    buildId: "a".repeat(64),
    nonce: randomUUID(),
    token: "b".repeat(64),
  };
  expect(parseManagedLaunch(JSON.stringify(launch))).toEqual(launch);
  for (const invalid of [
    { ...launch, port: 0 },
    { ...launch, token: "short" },
    { ...launch, installRoot: "relative" },
    { ...launch, command: "arbitrary" },
  ])
    expect(() => parseManagedLaunch(JSON.stringify(invalid))).toThrow();
  expect(() => parseManagedLaunch("x".repeat(8193))).toThrow(/configuration/);
});
it("treats missing instance metadata as stopped without touching the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "threadstr-instance-"));
  directories.push(directory);
  expect(readInstance(directory)).toBeUndefined();
});

it("rejects project bodies before parsing while frozen but keeps health available", async () => {
  const { buildApp } = await import("../app.js");
  const { openDatabase } = await import("../db/database.js");
  const { MaintenanceGate } =
    await import("../database-transfer/maintenance-gate.js");
  const directory = mkdtempSync(join(tmpdir(), "threadstr-frozen-"));
  directories.push(directory);
  const gate = new MaintenanceGate();
  await gate.freezeAndDrain();
  const app = buildApp({
    database: openDatabase(join(directory, "on-track.sqlite")),
    maintenanceGate: gate,
  });
  try {
    const blocked = await app.inject({
      method: "POST",
      url: "/api/chats",
      headers: { host: "localhost:4173", "content-type": "application/json" },
      payload: "{invalid",
    });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json()).toMatchObject({ code: "maintenance_busy" });
    const health = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "localhost:4173" },
    });
    expect(health.statusCode).toBe(200);
    gate.resume();
    const normal = await app.inject({
      method: "GET",
      url: "/api/chats",
      headers: { host: "localhost:4173" },
    });
    expect(normal.statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
