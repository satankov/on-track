import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDatabaseCheckpoint } from "../runtime/database-checkpoint.js";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import {
  UpdateJournalStore,
  type BeginUpdate,
} from "../runtime/update-journal.js";
import type { ControlStatus } from "../runtime/control-server.js";
import {
  readActiveRelease,
  selectActiveRelease,
  writeInstallState,
  type ActiveRelease,
} from "./state.js";
import {
  activatePrepared,
  identityFor,
  recoverManagedUpdate,
} from "./update.js";

const boundary = vi.hoisted(() => ({
  spawn: vi.fn(),
  managedStatus: vi.fn(),
  startManaged: vi.fn(),
  stopManaged: vi.fn(),
  requestControl: vi.fn(),
  readInstance: vi.fn(),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: boundary.spawn,
}));
vi.mock("./process.js", () => ({
  ...boundary,
  softwareEnvironment: () => ({}),
}));
vi.mock("../runtime/managed-server.js", () => ({
  readInstance: boundary.readInstance,
}));
vi.mock("../runtime/control-server.js", () => ({
  requestControl: boundary.requestControl,
}));

const roots: string[] = [];
const owners: Array<ReturnType<typeof acquireInstanceOwner>> = [];
function fixture() {
  const base = realpathSync(
    mkdtempSync(join(tmpdir(), "threadstr-cli-update-")),
  );
  roots.push(base);
  const root = join(base, "runtime");
  const dataDirectory = join(base, "data");
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(dataDirectory, { mode: 0o700 });
  writeInstallState(root, { protocol: 1, dataDirectory, port: 4197 });
  const previous: ActiveRelease = {
    protocol: 1,
    releaseId: "v0.0.8",
    runtimeId: "node-v24.14.0-darwin-arm64",
  };
  const candidate: ActiveRelease = { ...previous, releaseId: "v0.0.9" };
  for (const selection of [previous, candidate]) {
    const release = join(root, "releases", selection.releaseId);
    mkdirSync(join(release, "src/server/db"), { recursive: true });
    mkdirSync(join(release, "drizzle/meta"), { recursive: true });
    const old = selection === previous;
    writeFileSync(
      join(release, "package.json"),
      JSON.stringify({ version: selection.releaseId.slice(1) }),
    );
    writeFileSync(
      join(release, "src/server/db/database.ts"),
      `const CURRENT_SCHEMA_VERSION = ${old ? 7 : 8};`,
    );
    writeFileSync(
      join(release, "drizzle/meta/_journal.json"),
      JSON.stringify({
        entries: [{ when: old ? 1789027200000 : 1789027200001 }],
      }),
    );
  }
  selectActiveRelease(root, previous);
  const databasePath = join(dataDirectory, "on-track.sqlite");
  const sqlite = new Database(databasePath);
  sqlite.exec(
    "CREATE TABLE app_metadata(id INTEGER PRIMARY KEY, schema_version INTEGER); INSERT INTO app_metadata VALUES(1, 7); CREATE TABLE __drizzle_migrations(created_at INTEGER); INSERT INTO __drizzle_migrations VALUES(1789027200000); CREATE TABLE notes(body TEXT); INSERT INTO notes VALUES('original note')",
  );
  sqlite.close();
  chmodSync(databasePath, 0o600);
  const store = new UpdateJournalStore(dataDirectory);
  const intent: BeginUpdate = {
    transactionId: randomUUID(),
    installRoot: root,
    previous: identityFor(root, previous),
    candidate: identityFor(root, candidate),
    candidateCredentials: { nonce: randomUUID(), token: "a".repeat(64) },
    previousCredentials: { nonce: randomUUID(), token: "b".repeat(64) },
  };
  return {
    root,
    dataDirectory,
    previous,
    candidate,
    databasePath,
    store,
    intent,
  };
}
async function pending(
  f: ReturnType<typeof fixture>,
  state: "intent" | "candidate_started" | "committed",
) {
  f.store.begin(f.intent);
  if (state === "intent") return;
  f.store.markCheckpointReady(
    f.intent.transactionId,
    await createDatabaseCheckpoint({
      dataDirectory: f.dataDirectory,
      databasePath: f.databasePath,
      transactionId: f.intent.transactionId,
      expectedSchemaVersion: 7,
      expectedMigrationMarker: 1789027200000,
    }),
  );
  f.store.markCandidateStarted(f.intent.transactionId);
  const candidate = new Database(f.databasePath);
  candidate.exec(
    "ALTER TABLE notes ADD COLUMN label TEXT; UPDATE app_metadata SET schema_version = 8; INSERT INTO __drizzle_migrations VALUES(1789027200001)",
  );
  candidate.close();
  selectActiveRelease(f.root, f.candidate);
  if (state === "committed") f.store.commit(f.intent.transactionId);
}
function notes(path: string) {
  const sqlite = new Database(path, { readonly: true });
  try {
    return sqlite.prepare("SELECT * FROM notes").all();
  } finally {
    sqlite.close();
  }
}
function status(
  identity: BeginUpdate["candidate"],
  nonce: string,
  state: ControlStatus["state"] = "maintenance",
): ControlStatus {
  return {
    state,
    version: identity.releaseId.slice(1),
    releaseId: identity.releaseId,
    buildId: identity.buildId,
    nonce,
    url: "http://127.0.0.1:4197",
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.managedStatus.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const owner of owners.splice(0)) owner.release();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("restores the previous selection and schema before clearing an interrupted candidate journal", async () => {
  const f = fixture();
  await pending(f, "candidate_started");
  await expect(recoverManagedUpdate(f.root)).resolves.toBe("previous");
  expect(readActiveRelease(f.root)).toEqual(f.previous);
  expect(f.store.read()).toBeUndefined();
  expect(notes(f.databasePath)).toEqual([{ body: "original note" }]);
  await expect(recoverManagedUpdate(f.root)).resolves.toBe("none");
});

it("reconciles a stopped committed update without erasing later notes", async () => {
  const f = fixture();
  await pending(f, "committed");
  const sqlite = new Database(f.databasePath);
  sqlite.exec("INSERT INTO notes(body) VALUES('saved after commit')");
  sqlite.close();
  selectActiveRelease(f.root, f.previous);
  await expect(recoverManagedUpdate(f.root)).resolves.toBe("committed");
  expect(readActiveRelease(f.root)).toEqual(f.candidate);
  expect(f.store.read()).toBeUndefined();
  expect(notes(f.databasePath)).toHaveLength(2);
  expect(
    JSON.parse(readFileSync(join(f.root, "last-update.json"), "utf8")),
  ).toMatchObject({ transactionId: f.intent.transactionId });
});

it("recovers intent without a checkpoint and never opens or alters the untouched live database", async () => {
  const f = fixture();
  await pending(f, "intent");
  const before = readFileSync(f.databasePath);
  await expect(recoverManagedUpdate(f.root)).resolves.toBe("previous");
  expect(readFileSync(f.databasePath)).toEqual(before);
  expect(f.store.read()).toBeUndefined();
});

it("authenticates and stops a surviving pending candidate before acquiring its data lock", async () => {
  const f = fixture();
  await pending(f, "candidate_started");
  const held = acquireInstanceOwner(f.dataDirectory);
  owners.push(held);
  const credentials = {
    ...f.intent.candidateCredentials,
    endpoint: "test-only-endpoint",
    installRoot: f.root,
  };
  boundary.managedStatus.mockResolvedValue(
    status(f.intent.candidate, credentials.nonce),
  );
  boundary.readInstance.mockReturnValue(credentials);
  boundary.stopManaged.mockImplementation(async () => {
    expect(() => acquireInstanceOwner(f.dataDirectory)).toThrow(
      /already in use/,
    );
    held.release();
  });
  await expect(recoverManagedUpdate(f.root)).resolves.toBe("previous");
  expect(boundary.stopManaged).toHaveBeenCalledExactlyOnceWith(f.root);
  expect(notes(f.databasePath)).toEqual([{ body: "original note" }]);
});

it("preserves journal and data when the surviving instance cannot be authenticated", async () => {
  const f = fixture();
  await pending(f, "candidate_started");
  const before = readFileSync(f.databasePath);
  boundary.managedStatus.mockResolvedValue(
    status(f.intent.candidate, randomUUID()),
  );
  boundary.readInstance.mockReturnValue({
    ...f.intent.candidateCredentials,
    nonce: randomUUID(),
    endpoint: "test-only",
    installRoot: f.root,
  });
  await expect(recoverManagedUpdate(f.root)).rejects.toThrow(
    /cannot be authenticated/,
  );
  expect(boundary.stopManaged).not.toHaveBeenCalled();
  expect(f.store.read()?.state).toBe("candidate_started");
  expect(readFileSync(f.databasePath)).toEqual(before);
});

it("leaves an already-running committed candidate serving and reconciles its selection", async () => {
  const f = fixture();
  await pending(f, "committed");
  selectActiveRelease(f.root, f.previous);
  boundary.managedStatus.mockResolvedValue(
    status(f.intent.candidate, f.intent.candidateCredentials.nonce, "ready"),
  );
  await expect(recoverManagedUpdate(f.root)).resolves.toBe("committed");
  expect(readActiveRelease(f.root)).toEqual(f.candidate);
  expect(boundary.stopManaged).not.toHaveBeenCalled();
  expect(f.store.read()?.state).toBe("committed");
});

it("does not stop a server or modify selection when update confirmation is declined", async () => {
  const f = fixture();
  const before = readFileSync(f.databasePath);
  await expect(
    activatePrepared(f.root, f.candidate, { confirm: async () => false }),
  ).rejects.toThrow(/cancelled/);
  expect(boundary.stopManaged).not.toHaveBeenCalled();
  expect(boundary.startManaged).not.toHaveBeenCalled();
  expect(f.store.read()).toBeUndefined();
  expect(readActiveRelease(f.root)).toEqual(f.previous);
  expect(readFileSync(f.databasePath)).toEqual(before);
});

it("persists candidate_started before launch and selects the candidate before its commit command", async () => {
  const f = fixture();
  const oldOwner = acquireInstanceOwner(f.dataDirectory);
  owners.push(oldOwner);
  let current = status(
    f.intent.previous,
    f.intent.previousCredentials!.nonce,
    "ready",
  );
  let instance = {
    ...f.intent.previousCredentials!,
    endpoint: "test-old",
    installRoot: f.root,
  };
  boundary.managedStatus.mockImplementation(async () => current);
  boundary.readInstance.mockImplementation(() => instance);
  boundary.stopManaged.mockImplementation(async () => {
    oldOwner.release();
  });
  boundary.requestControl.mockImplementation(async (_instance, command) => {
    if (typeof command === "object" && command.command === "prepare-update") {
      f.store.begin(command.update);
      return current;
    }
    if (command === "activate") {
      expect(readActiveRelease(f.root)).toEqual(f.candidate);
      const journal = f.store.read()!;
      expect(journal.state).toBe("candidate_started");
      f.store.commit(journal.transactionId);
      current = { ...current, state: "ready" };
      return current;
    }
    throw new Error("Unexpected control command");
  });
  boundary.startManaged.mockImplementation(async (_root, options) => {
    const journal = f.store.read()!;
    expect(journal.state).toBe("candidate_started");
    expect(options.updateTransactionId).toBe(journal.transactionId);
    expect(options.credentials).toEqual(journal.candidateCredentials);
    instance = {
      ...options.credentials,
      endpoint: "test-candidate",
      installRoot: f.root,
    };
    current = status(f.intent.candidate, instance.nonce);
    return current;
  });
  await activatePrepared(f.root, f.candidate, { confirm: async () => true });
  expect(f.store.read()?.state).toBe("committed");
  expect(readActiveRelease(f.root)).toEqual(f.candidate);
  expect(boundary.requestControl).toHaveBeenLastCalledWith(
    instance,
    "activate",
  );
});

it("recovers the previous code and data when candidate startup fails after migration", async () => {
  const f = fixture();
  let owner = acquireInstanceOwner(f.dataDirectory);
  owners.push(owner);
  let current: ControlStatus | undefined = status(
    f.intent.previous,
    f.intent.previousCredentials!.nonce,
    "ready",
  );
  let instance = {
    ...f.intent.previousCredentials!,
    endpoint: "test-old",
    installRoot: f.root,
  };
  boundary.managedStatus.mockImplementation(async () => current);
  boundary.readInstance.mockImplementation(() => instance);
  boundary.stopManaged.mockImplementation(async () => {
    owner.release();
    current = undefined;
  });
  boundary.requestControl.mockImplementation(async (_instance, command) => {
    if (command.command !== "prepare-update")
      throw new Error("Unexpected command");
    f.store.begin(command.update);
    return current;
  });
  boundary.startManaged.mockImplementation(async (_root, options) => {
    if (!options?.updateTransactionId) {
      current = status(
        f.intent.previous,
        f.intent.previousCredentials!.nonce,
        "ready",
      );
      return current;
    }
    owner = acquireInstanceOwner(f.dataDirectory);
    owners.push(owner);
    const sqlite = new Database(f.databasePath);
    sqlite.exec(
      "ALTER TABLE notes ADD COLUMN label TEXT; UPDATE app_metadata SET schema_version = 8; INSERT INTO __drizzle_migrations VALUES(1789027200001)",
    );
    sqlite.close();
    instance = {
      ...options.credentials,
      endpoint: "test-failed-candidate",
      installRoot: f.root,
    };
    current = status(f.intent.candidate, instance.nonce);
    throw new Error("Candidate readiness failed after migration");
  });
  await expect(
    activatePrepared(f.root, f.candidate, { confirm: async () => true }),
  ).rejects.toThrow(/Candidate readiness failed/);
  expect(boundary.stopManaged).toHaveBeenCalledTimes(2);
  expect(readActiveRelease(f.root)).toEqual(f.previous);
  expect(f.store.read()).toBeUndefined();
  expect(notes(f.databasePath)).toEqual([{ body: "original note" }]);
  expect(boundary.startManaged).toHaveBeenLastCalledWith(f.root);
});

it("treats a lost activation acknowledgment as committed and preserves newly accepted writes", async () => {
  const f = fixture();
  let current = status(
    f.intent.previous,
    f.intent.previousCredentials!.nonce,
    "ready",
  );
  let instance = {
    ...f.intent.previousCredentials!,
    endpoint: "test-old",
    installRoot: f.root,
  };
  boundary.managedStatus.mockImplementation(async () => current);
  boundary.readInstance.mockImplementation(() => instance);
  boundary.requestControl.mockImplementation(async (_instance, command) => {
    if (typeof command === "object") {
      f.store.begin(command.update);
      return current;
    }
    expect(command).toBe("activate");
    const journal = f.store.read()!;
    f.store.commit(journal.transactionId);
    const sqlite = new Database(f.databasePath);
    sqlite.exec("INSERT INTO notes VALUES('accepted after commit')");
    sqlite.close();
    current = { ...current, state: "ready" };
    throw new Error("Connection lost after durable activation");
  });
  boundary.startManaged.mockImplementation(async (_root, options) => {
    instance = {
      ...options.credentials,
      endpoint: "test-new",
      installRoot: f.root,
    };
    current = status(f.intent.candidate, instance.nonce);
    return current;
  });
  await expect(
    activatePrepared(f.root, f.candidate, { confirm: async () => true }),
  ).resolves.toBeUndefined();
  expect(readActiveRelease(f.root)).toEqual(f.candidate);
  expect(f.store.read()?.state).toBe("committed");
  expect(notes(f.databasePath)).toHaveLength(2);
  expect(boundary.stopManaged).toHaveBeenCalledTimes(1);
});

it("uses the old release's recovery helper before checkpointing a stopped application and starts the candidate", async () => {
  const f = fixture();
  let instance:
    | { nonce: string; token: string; endpoint: string; installRoot: string }
    | undefined;
  boundary.readInstance.mockImplementation(() => instance);
  boundary.spawn.mockImplementation((_executable, args, options) => {
    expect(f.store.read()).toBeUndefined();
    expect(args).toEqual([
      join(
        f.root,
        "releases",
        f.previous.releaseId,
        "dist/server/server/cli/main.js",
      ),
      "maintenance-recover-import",
      "--root",
      f.root,
    ]);
    expect(options).toMatchObject({
      cwd: join(f.root, "releases", f.previous.releaseId),
      shell: false,
    });
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
    });
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
  boundary.startManaged.mockImplementation(async (_root, options) => {
    expect(f.store.read()?.state).toBe("candidate_started");
    instance = {
      ...options.credentials,
      endpoint: "test-new",
      installRoot: f.root,
    };
    return status(f.intent.candidate, options.credentials.nonce);
  });
  boundary.requestControl.mockImplementation(async (_instance, command) => {
    expect(command).toBe("activate");
    const journal = f.store.read()!;
    f.store.commit(journal.transactionId);
    return status(
      f.intent.candidate,
      journal.candidateCredentials.nonce,
      "ready",
    );
  });
  await activatePrepared(f.root, f.candidate, { confirm: async () => true });
  expect(boundary.spawn).toHaveBeenCalledTimes(1);
  expect(boundary.startManaged).toHaveBeenCalledTimes(1);
  expect(boundary.stopManaged).not.toHaveBeenCalled();
  expect(readActiveRelease(f.root)).toEqual(f.candidate);
});

it("blocks a stopped update before intent if previous-version import recovery fails", async () => {
  const f = fixture();
  const before = readFileSync(f.databasePath);
  boundary.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
    });
    queueMicrotask(() => child.emit("close", 1));
    return child;
  });
  await expect(
    activatePrepared(f.root, f.candidate, { confirm: async () => true }),
  ).rejects.toThrow(/previous version could not finish database recovery/);
  expect(f.store.read()).toBeUndefined();
  expect(readActiveRelease(f.root)).toEqual(f.previous);
  expect(readFileSync(f.databasePath)).toEqual(before);
  expect(boundary.startManaged).not.toHaveBeenCalled();
});

it("treats the current build as a no-op that starts a stopped application without confirmation", async () => {
  const f = fixture();
  const confirm = vi.fn();
  await activatePrepared(f.root, f.previous, { confirm });
  expect(confirm).not.toHaveBeenCalled();
  expect(boundary.startManaged).toHaveBeenCalledExactlyOnceWith(f.root);
  expect(f.store.read()).toBeUndefined();
});

it("rejects a candidate that would downgrade the database before confirmation or shutdown", async () => {
  const f = fixture();
  const confirm = vi.fn();
  writeFileSync(
    join(
      f.root,
      "releases",
      f.candidate.releaseId,
      "src/server/db/database.ts",
    ),
    "const CURRENT_SCHEMA_VERSION = 6;",
  );
  await expect(
    activatePrepared(f.root, f.candidate, { confirm }),
  ).rejects.toThrow(/Downgrades are not supported/);
  expect(confirm).not.toHaveBeenCalled();
  expect(boundary.stopManaged).not.toHaveBeenCalled();
  expect(boundary.spawn).not.toHaveBeenCalled();
  expect(f.store.read()).toBeUndefined();
  expect(readActiveRelease(f.root)).toEqual(f.previous);
});

it("fails closed when a running server disagrees with the committed candidate build", async () => {
  const f = fixture();
  await pending(f, "committed");
  boundary.managedStatus.mockResolvedValue(
    status(f.intent.previous, f.intent.previousCredentials!.nonce, "ready"),
  );
  await expect(recoverManagedUpdate(f.root)).rejects.toThrow(
    /disagrees with the committed update/,
  );
  expect(boundary.stopManaged).not.toHaveBeenCalled();
  expect(f.store.read()?.state).toBe("committed");
});
