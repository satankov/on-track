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
import { LATEST_BUNDLED_MIGRATION_AT, openDatabase } from "../db/database.js";
import { DEFAULT_PREFERENCES } from "../../domain/preferences.js";
import { readPreferences, writePreferences } from "../db/preferences.js";
import { insertProjectLabel } from "../db/project-labels.js";
import {
  createV010Database,
  readV010Rows,
  V010_FILE,
} from "../../test/released-v010.js";
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
function fixture(releasedSchema = false) {
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
    releaseId: releasedSchema ? "v0.1.0" : "v0.0.8",
    runtimeId: "node-v24.14.0-darwin-arm64",
  };
  const candidate: ActiveRelease = {
    ...previous,
    releaseId: releasedSchema ? "v99.0.0" : "v0.0.9",
  };
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
      `const CURRENT_SCHEMA_VERSION = ${old ? 7 : releasedSchema ? 9 : 8};`,
    );
    writeFileSync(
      join(release, "drizzle/meta/_journal.json"),
      JSON.stringify({
        entries: [
          {
            when: old
              ? 1789027200000
              : releasedSchema
                ? LATEST_BUNDLED_MIGRATION_AT
                : 1789027200001,
          },
        ],
      }),
    );
  }
  selectActiveRelease(root, previous);
  const databasePath = join(dataDirectory, "on-track.sqlite");
  const sqlite = releasedSchema
    ? createV010Database(dataDirectory, { missingAttachment: true }).sqlite
    : new Database(databasePath);
  if (!releasedSchema)
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
  const realMigration = f.intent.candidate.schemaVersion === 9;
  const candidate = realMigration
    ? openDatabase(f.databasePath)
    : new Database(f.databasePath);
  if (!realMigration)
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

it.each(["candidate_started", "committed"] as const)(
  "recovers a real v0.1.0-to-schema-9 update at %s without crossing the durable commit boundary",
  async (state) => {
    const f = fixture(true);
    const old = new Database(f.databasePath);
    const before = readV010Rows(old);
    old.close();
    await pending(f, state);
    const file = join(f.dataDirectory, V010_FILE.path);
    writeFileSync(file, "External edit during update", { mode: 0o600 });
    const preferences = {
      ...DEFAULT_PREFERENCES,
      initialized: true,
      theme: "dark" as const,
    };
    const customId = `custom-${randomUUID()}` as const;
    if (state === "committed") {
      const candidate = openDatabase(f.databasePath);
      try {
        candidate
          .prepare(
            "INSERT INTO notes(id,chat_id,body,created_at) VALUES('postcommit','release-archive','Saved after activation',100)",
          )
          .run();
        writePreferences(candidate, preferences);
        insertProjectLabel(candidate, "release-archive", {
          id: customId,
          name: "Review",
          symbol: null,
          builtin: false,
          enabled: true,
          position: 7,
        });
        candidate
          .prepare(
            "INSERT INTO note_labels(note_id,chat_id,label) VALUES('postcommit','release-archive',?)",
          )
          .run(customId);
      } finally {
        candidate.close();
      }
      // The selection write may lag the committed journal after a crash.
      selectActiveRelease(f.root, f.previous);
    }
    await expect(recoverManagedUpdate(f.root)).resolves.toBe(
      state === "committed" ? "committed" : "previous",
    );
    expect(readActiveRelease(f.root)).toEqual(
      state === "committed" ? f.candidate : f.previous,
    );
    expect(f.store.read()).toBeUndefined();
    await expect(recoverManagedUpdate(f.root)).resolves.toBe("none");
    const recovered = new Database(f.databasePath);
    try {
      expect(
        recovered
          .prepare("SELECT schema_version FROM app_metadata")
          .pluck()
          .get(),
      ).toBe(state === "committed" ? 9 : 7);
      if (state === "committed") {
        expect(
          recovered
            .prepare("SELECT body FROM notes WHERE id='postcommit'")
            .pluck()
            .get(),
        ).toBe("Saved after activation");
        expect(readPreferences(recovered)).toEqual(preferences);
        expect(
          recovered
            .prepare("SELECT label FROM note_labels WHERE note_id='postcommit'")
            .pluck()
            .get(),
        ).toBe(customId);
        expect(
          recovered
            .prepare("SELECT name FROM project_labels WHERE id=?")
            .pluck()
            .get(customId),
        ).toBe("Review");
        expect(readV010Rows(recovered).attachments).toEqual(before.attachments);
      } else {
        expect(readV010Rows(recovered)).toEqual(before);
        expect(
          recovered
            .prepare(
              "SELECT label FROM chat_enabled_labels WHERE chat_id='release-archive'",
            )
            .pluck()
            .all(),
        ).toEqual(["risk"]);
      }
      expect(recovered.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(recovered.pragma("foreign_key_check")).toEqual([]);
    } finally {
      recovered.close();
    }
    expect(readFileSync(file, "utf8")).toBe("External edit during update");
  },
);

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
