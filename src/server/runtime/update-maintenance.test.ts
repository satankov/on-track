import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { UpdateJournalStore } from "./update-journal.js";
import { createDatabaseCheckpoint } from "./database-checkpoint.js";
import {
  assertUpdateStartupAllowed,
  recoverUpdate,
} from "./update-maintenance.js";

const roots: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "threadstr-update-recovery-"));
  roots.push(directory);
  const store = new UpdateJournalStore(directory);
  const previous = {
    releaseId: "v0.0.8",
    runtimeId: "node-v24.14.0-darwin-arm64",
    buildId: "a".repeat(64),
    schemaVersion: 7,
    migrationMarker: 1789027200000,
  };
  const candidate = {
    ...previous,
    releaseId: "v0.0.9",
    buildId: "b".repeat(64),
    schemaVersion: 8,
    migrationMarker: 1789027200001,
  };
  const input = {
    transactionId: randomUUID(),
    installRoot: store.dataDirectory,
    previous,
    candidate,
    candidateCredentials: { nonce: randomUUID(), token: "c".repeat(64) },
  };
  store.begin(input);
  const databasePath = join(store.dataDirectory, "on-track.sqlite");
  const sqlite = new Database(databasePath);
  sqlite.exec(
    "CREATE TABLE app_metadata(id INTEGER PRIMARY KEY, schema_version INTEGER); INSERT INTO app_metadata VALUES(1, 7); CREATE TABLE __drizzle_migrations(created_at INTEGER); INSERT INTO __drizzle_migrations VALUES(1789027200000); CREATE TABLE notes(body TEXT); INSERT INTO notes VALUES('before update')",
  );
  sqlite.close();
  chmodSync(databasePath, 0o600);
  return { store, input, databasePath };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("blocks ordinary startup while update intent owns the database", () => {
  const { store } = fixture();
  expect(() => assertUpdateStartupAllowed(store.dataDirectory)).toThrow(
    /update/i,
  );
});

it("requires the exact candidate capability and durable candidate_started before permission to migrate", async () => {
  const { store, input, databasePath } = fixture();
  const checkpoint = await createDatabaseCheckpoint({
    dataDirectory: store.dataDirectory,
    databasePath,
    transactionId: input.transactionId,
    expectedSchemaVersion: 7,
    expectedMigrationMarker: 1789027200000,
  });
  store.markCheckpointReady(input.transactionId, checkpoint);
  const identity = {
    transactionId: input.transactionId,
    buildId: input.candidate.buildId,
    ...input.candidateCredentials,
    installRoot: input.installRoot,
  };
  expect(() =>
    assertUpdateStartupAllowed(store.dataDirectory, {
      ...identity,
      token: "d".repeat(64),
    }),
  ).toThrow(/identity|capability/i);
  expect(store.read()?.state).toBe("checkpoint_ready");
  expect(() =>
    assertUpdateStartupAllowed(store.dataDirectory, identity),
  ).toThrow(/recover/i);
  store.markCandidateStarted(input.transactionId);
  expect(assertUpdateStartupAllowed(store.dataDirectory, identity)?.state).toBe(
    "candidate_started",
  );
  expect(store.read()?.state).toBe("candidate_started");
});

it("rolls a precommit migration back repeatedly but preserves all postcommit writes", async () => {
  const { store, input, databasePath } = fixture();
  store.markCheckpointReady(
    input.transactionId,
    await createDatabaseCheckpoint({
      dataDirectory: store.dataDirectory,
      databasePath,
      transactionId: input.transactionId,
      expectedSchemaVersion: 7,
      expectedMigrationMarker: 1789027200000,
    }),
  );
  store.markCandidateStarted(input.transactionId);
  const migrated = new Database(databasePath);
  migrated.exec(
    "ALTER TABLE notes ADD COLUMN label TEXT; UPDATE app_metadata SET schema_version = 8; INSERT INTO __drizzle_migrations VALUES(1789027200001)",
  );
  migrated.close();
  const options = {
    store,
    databasePath,
    transactionId: input.transactionId,
    installRoot: input.installRoot,
  };
  expect(recoverUpdate(options)).toMatchObject({ outcome: "rolled_back" });
  expect(recoverUpdate(options)).toMatchObject({ outcome: "rolled_back" });
  const restored = new Database(databasePath);
  expect(restored.prepare("SELECT * FROM notes").get()).toEqual({
    body: "before update",
  });
  restored.close();
  store.commit(input.transactionId);
  const live = new Database(databasePath);
  live.exec("INSERT INTO notes VALUES('after commit')");
  live.close();
  expect(recoverUpdate(options)).toMatchObject({ outcome: "committed" });
  const committed = new Database(databasePath);
  expect(committed.prepare("SELECT count(*) FROM notes").pluck().get()).toBe(2);
  committed.close();
});

it("allows ordinary startup without a journal but refuses orphan candidate credentials", () => {
  const { store, input } = fixture();
  store.clear(input.transactionId);
  expect(assertUpdateStartupAllowed(store.dataDirectory)).toBeUndefined();
  expect(() =>
    assertUpdateStartupAllowed(store.dataDirectory, {
      buildId: input.candidate.buildId,
      transactionId: input.transactionId,
    }),
  ).toThrow(/no matching/);
});

it("resumes the untouched old database before candidate_started and rejects a different installation", () => {
  const { store, input, databasePath } = fixture();
  const options = {
    store,
    databasePath,
    transactionId: input.transactionId,
    installRoot: input.installRoot,
  };
  expect(recoverUpdate(options)).toMatchObject({ outcome: "unchanged" });
  expect(store.read()?.state).toBe("intent");
  const other = mkdtempSync(join(tmpdir(), "threadstr-other-install-"));
  roots.push(other);
  expect(() => recoverUpdate({ ...options, installRoot: other })).toThrow(
    /installation identity/,
  );
});

it("allows only the committed build and never opens its missing retained checkpoint", async () => {
  const { store, input, databasePath } = fixture();
  const checkpoint = await createDatabaseCheckpoint({
    dataDirectory: store.dataDirectory,
    databasePath,
    transactionId: input.transactionId,
    expectedSchemaVersion: 7,
    expectedMigrationMarker: 1789027200000,
  });
  store.markCheckpointReady(input.transactionId, checkpoint);
  store.markCandidateStarted(input.transactionId);
  store.commit(input.transactionId);
  rmSync(
    join(store.dataDirectory, `.on-track-update-${input.transactionId}.sqlite`),
  );
  expect(
    assertUpdateStartupAllowed(store.dataDirectory, {
      buildId: input.candidate.buildId,
    })?.state,
  ).toBe("committed");
  expect(() =>
    assertUpdateStartupAllowed(store.dataDirectory, {
      buildId: input.previous.buildId,
    }),
  ).toThrow(/matching application build/);
  expect(
    recoverUpdate({
      store,
      databasePath,
      transactionId: input.transactionId,
      installRoot: input.installRoot,
    }),
  ).toMatchObject({ outcome: "committed" });
});

it("refuses missing or malformed candidate secrets without changing the journal", async () => {
  const { store, input, databasePath } = fixture();
  store.markCheckpointReady(
    input.transactionId,
    await createDatabaseCheckpoint({
      dataDirectory: store.dataDirectory,
      databasePath,
      transactionId: input.transactionId,
      expectedSchemaVersion: 7,
      expectedMigrationMarker: 1789027200000,
    }),
  );
  store.markCandidateStarted(input.transactionId);
  const identity = {
    transactionId: input.transactionId,
    buildId: input.candidate.buildId,
    ...input.candidateCredentials,
    installRoot: input.installRoot,
  };
  for (const wrong of [
    { ...identity, token: undefined },
    { ...identity, token: "wrong" },
    { ...identity, nonce: randomUUID() },
    { ...identity, transactionId: randomUUID() },
    { ...identity, buildId: input.previous.buildId },
    { ...identity, installRoot: undefined },
  ]) {
    expect(() =>
      assertUpdateStartupAllowed(store.dataDirectory, wrong),
    ).toThrow(/identity or capability/);
  }
  expect(store.read()?.state).toBe("candidate_started");
});
