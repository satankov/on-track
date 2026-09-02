import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ManagedRestoreCoordinator,
  RestoreJournalError,
  recoverManagedRestoreBeforeDatabaseOpen,
  type RestoreFailpoint,
} from "./restore-journal.js";

const restoreId = "123e4567-e89b-42d3-a456-426614174000";
const createdDirectories: string[] = [];

function makeDataDirectory(): string {
  const path = join(
    tmpdir(),
    `on-track-restore-test-${process.pid}-${randomUUID()}`,
  );
  mkdirSync(path, { mode: 0o700 });
  createdDirectories.push(path);
  return realpathSync(path);
}

function makeCoordinator(
  dataDirectory: string,
  options: {
    failpoint?: (point: RestoreFailpoint) => void;
    openDatabase?: (path: string) => void;
    closeDatabase?: () => void;
    validateDatabase?: (path: string) => void;
    validateCommittedDatabase?: (path: string) => void;
  } = {},
): ManagedRestoreCoordinator {
  const databasePath = join(dataDirectory, "on-track.sqlite");
  return new ManagedRestoreCoordinator({
    dataDirectory,
    databasePath,
    restoreIdFactory: () => restoreId,
    closeDatabase: options.closeDatabase ?? vi.fn(),
    openDatabase: options.openDatabase ?? vi.fn(),
    validateDatabase:
      options.validateDatabase ??
      vi.fn((path: string) => {
        expect(readFileSync(path, "utf8")).toBe("candidate");
      }),
    validateCommittedDatabase: options.validateCommittedDatabase,
    failpoint: options.failpoint,
  });
}

function seedWorkspace(coordinator: ManagedRestoreCoordinator): void {
  const workspace = coordinator.createWorkspace();
  writeFileSync(workspace.candidateDatabasePath, "candidate", { mode: 0o600 });
  writeFileSync(join(workspace.stagedNamespacePath, "attachment.txt"), "file", {
    mode: 0o600,
  });
}

afterEach(() => {
  for (const path of createdDirectories.splice(0)) {
    try {
      chmodSync(path, 0o700);
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Test cleanup is best effort.
    }
  }
});

describe("ManagedRestoreCoordinator", () => {
  it("requires the live database to be directly inside the data directory", () => {
    const dataDirectory = makeDataDirectory();

    expect(
      () =>
        new ManagedRestoreCoordinator({
          dataDirectory,
          databasePath: join(dataDirectory, "nested", "on-track.sqlite"),
          closeDatabase: vi.fn(),
          openDatabase: vi.fn(),
          validateDatabase: vi.fn(),
        }),
    ).toThrow(/direct child/i);
  });

  it("rejects a symlink as the configured data directory", () => {
    if (process.platform === "win32") return;
    const parent = makeDataDirectory();
    const target = join(parent, "target");
    const linked = join(parent, "linked");
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, linked);

    expect(
      () =>
        new ManagedRestoreCoordinator({
          dataDirectory: linked,
          databasePath: join(linked, "on-track.sqlite"),
          closeDatabase: vi.fn(),
          openDatabase: vi.fn(),
          validateDatabase: vi.fn(),
        }),
    ).toThrow(/symbolic link/i);
  });

  it("creates a collision-resistant private workspace from a generated id", () => {
    const dataDirectory = makeDataDirectory();
    const coordinator = makeCoordinator(dataDirectory);

    const workspace = coordinator.createWorkspace();

    expect(workspace).toEqual({
      restoreId,
      attachmentNamespace: `restore-${restoreId}`,
      stagingDirectory: join(dataDirectory, `.on-track-restore-${restoreId}`),
      candidateDatabasePath: join(
        dataDirectory,
        `.on-track-restore-${restoreId}`,
        "candidate.sqlite",
      ),
      candidateDataDirectory: join(
        dataDirectory,
        `.on-track-restore-${restoreId}`,
        "data",
      ),
      stagedNamespacePath: join(
        dataDirectory,
        `.on-track-restore-${restoreId}`,
        "data",
        "attachments",
        "v1",
        `restore-${restoreId}`,
      ),
      installedNamespacePath: join(
        dataDirectory,
        "attachments",
        "v1",
        `restore-${restoreId}`,
      ),
      installedNamespaceRelativePath: `attachments/v1/restore-${restoreId}`,
      rollbackDatabasePath: join(
        dataDirectory,
        `.on-track-rollback-${restoreId}.sqlite`,
      ),
    });
    if (process.platform !== "win32") {
      expect(statSync(workspace.stagingDirectory).mode & 0o777).toBe(0o700);
      expect(statSync(workspace.stagedNamespacePath).mode & 0o777).toBe(0o700);
    }

    expect(() => coordinator.createWorkspace()).toThrow(/already exists/i);
  });

  it.each(["../escape", "/tmp/escape", "not-a-uuid", restoreId.toUpperCase()])(
    "rejects an invalid generated restore id: %s",
    (invalidId) => {
      const dataDirectory = makeDataDirectory();
      const coordinator = new ManagedRestoreCoordinator({
        dataDirectory,
        databasePath: join(dataDirectory, "on-track.sqlite"),
        restoreIdFactory: () => invalidId,
        closeDatabase: vi.fn(),
        openDatabase: vi.fn(),
        validateDatabase: vi.fn(),
      });

      expect(() => coordinator.createWorkspace()).toThrow(/restore id/i);
      expect(existsSync(join(dataDirectory, "..", "escape"))).toBe(false);
    },
  );

  it("installs the namespace before swapping the database and commits before cleanup", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    writeFileSync(databasePath, "old", { mode: 0o600 });
    const events: string[] = [];
    const coordinator = makeCoordinator(dataDirectory, {
      closeDatabase: () => events.push("close"),
      openDatabase: () => events.push("open"),
      validateDatabase: (path) => {
        events.push("validate");
        expect(readFileSync(path, "utf8")).toBe("candidate");
      },
      failpoint: (point) => events.push(point),
    });
    seedWorkspace(coordinator);
    mkdirSync(join(dataDirectory, "attachments", "v1"), {
      recursive: true,
      mode: 0o700,
    });

    const result = coordinator.activate(restoreId);

    expect(result.state).toBe("committed");
    expect(readFileSync(databasePath, "utf8")).toBe("candidate");
    expect(events).toEqual([
      "validate",
      "after_prepared",
      "after_namespace_installed",
      "close",
      "after_database_closed",
      "after_rollback_installed",
      "after_rollback_ready",
      "after_candidate_installed",
      "after_candidate_installed_journal",
      "open",
      "after_candidate_opened",
      "validate",
      "after_candidate_validated",
      "after_committed",
    ]);
    expect(existsSync(result.workspace.rollbackDatabasePath)).toBe(false);
    expect(existsSync(result.workspace.stagingDirectory)).toBe(false);
    expect(
      existsSync(join(dataDirectory, ".on-track-restore-journal.json")),
    ).toBe(false);
    expect(existsSync(result.workspace.installedNamespacePath)).toBe(true);
  });

  it("stores only the version, generated id, and state in an owner-only journal", () => {
    const dataDirectory = makeDataDirectory();
    writeFileSync(join(dataDirectory, "on-track.sqlite"), "old", {
      mode: 0o600,
    });
    let journal: unknown;
    let mode: number | undefined;
    const coordinator = makeCoordinator(dataDirectory, {
      failpoint: (point) => {
        if (point === "after_prepared") {
          const journalPath = join(
            dataDirectory,
            ".on-track-restore-journal.json",
          );
          journal = JSON.parse(readFileSync(journalPath, "utf8")) as unknown;
          mode = statSync(journalPath).mode & 0o777;
          throw new Error("stop");
        }
      },
    });
    seedWorkspace(coordinator);

    expect(() => coordinator.activate(restoreId)).toThrow("stop");

    expect(journal).toEqual({ version: 1, restoreId, state: "prepared" });
    if (process.platform !== "win32") expect(mode).toBe(0o600);
  });

  it("does not overwrite or delete a colliding journal staging file", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const temporaryJournalPath = join(
      dataDirectory,
      `.on-track-restore-journal-${restoreId}.tmp`,
    );
    writeFileSync(databasePath, "old", { mode: 0o600 });
    writeFileSync(temporaryJournalPath, "collision", { mode: 0o600 });
    const coordinator = makeCoordinator(dataDirectory);
    seedWorkspace(coordinator);

    expect(() => coordinator.activate(restoreId)).toThrow(/journal/i);
    expect(readFileSync(databasePath, "utf8")).toBe("old");
    expect(readFileSync(temporaryJournalPath, "utf8")).toBe("collision");
  });

  it("cleans a newly-created workspace after a durability failure", () => {
    const dataDirectory = makeDataDirectory();
    const coordinator = new ManagedRestoreCoordinator({
      dataDirectory,
      databasePath: join(dataDirectory, "on-track.sqlite"),
      restoreIdFactory: () => restoreId,
      closeDatabase: vi.fn(),
      openDatabase: vi.fn(),
      validateDatabase: vi.fn(),
      syncDirectory: () => {
        throw new Error("sync failed");
      },
    });

    expect(() => coordinator.createWorkspace()).toThrow(
      /could not be created/i,
    );
    expect(
      existsSync(join(dataDirectory, `.on-track-restore-${restoreId}`)),
    ).toBe(false);
  });

  it("rejects candidate symlinks before writing a journal", () => {
    if (process.platform === "win32") return;
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const outside = join(dataDirectory, "outside.sqlite");
    writeFileSync(databasePath, "old");
    writeFileSync(outside, "candidate");
    const coordinator = makeCoordinator(dataDirectory);
    const workspace = coordinator.createWorkspace();
    symlinkSync(outside, workspace.candidateDatabasePath);

    expect(() => coordinator.activate(restoreId)).toThrow(/safe regular file/i);
    expect(readFileSync(databasePath, "utf8")).toBe("old");
    expect(readFileSync(outside, "utf8")).toBe("candidate");
    expect(
      existsSync(join(dataDirectory, ".on-track-restore-journal.json")),
    ).toBe(false);
  });

  it("refuses to overwrite a colliding generated rollback database", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    writeFileSync(databasePath, "old", { mode: 0o600 });
    const coordinator = makeCoordinator(dataDirectory);
    seedWorkspace(coordinator);
    const paths = coordinator.pathsFor(restoreId);
    writeFileSync(paths.rollbackDatabasePath, "collision", { mode: 0o600 });

    expect(() => coordinator.activate(restoreId)).toThrow(/rollback path/i);
    expect(readFileSync(databasePath, "utf8")).toBe("old");
    expect(readFileSync(paths.rollbackDatabasePath, "utf8")).toBe("collision");
  });

  it("refuses rollback collisions and requires the closed live database to be checkpointed", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    writeFileSync(databasePath, "old", { mode: 0o600 });
    const coordinator = makeCoordinator(dataDirectory);
    seedWorkspace(coordinator);
    const paths = coordinator.pathsFor(restoreId);
    const rollbackWal = `${paths.rollbackDatabasePath}-wal`;
    writeFileSync(rollbackWal, "collision", { mode: 0o600 });

    expect(() => coordinator.activate(restoreId)).toThrow(/rollback path/i);
    expect(readFileSync(rollbackWal, "utf8")).toBe("collision");

    rmSync(rollbackWal);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      writeFileSync(`${databasePath}${suffix}`, "closed sidecar", {
        mode: 0o600,
      });
    }
    expect(() => coordinator.activate(restoreId)).toThrow(
      /closed live database has unexpected sidecars/i,
    );
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      expect(readFileSync(`${databasePath}${suffix}`, "utf8")).toBe(
        "closed sidecar",
      );
      rmSync(`${databasePath}${suffix}`);
    }
    expect(readFileSync(databasePath, "utf8")).toBe("old");
  });

  it("keeps a committed restore authoritative when immediate cleanup fails", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    writeFileSync(databasePath, "old", { mode: 0o600 });
    const coordinator = makeCoordinator(dataDirectory, {
      failpoint: (point) => {
        if (point === "after_committed") throw new Error("process stopped");
      },
    });
    seedWorkspace(coordinator);

    expect(() => coordinator.activate(restoreId)).toThrow("process stopped");
    expect(readFileSync(databasePath, "utf8")).toBe("candidate");
    expect(
      JSON.parse(
        readFileSync(
          join(dataDirectory, ".on-track-restore-journal.json"),
          "utf8",
        ),
      ),
    ).toEqual({ version: 1, restoreId, state: "committed" });
  });

  it.each<RestoreFailpoint>([
    "after_namespace_installed",
    "after_database_closed",
    "after_rollback_installed",
    "after_rollback_ready",
    "after_candidate_installed",
    "after_candidate_installed_journal",
    "after_candidate_opened",
    "after_candidate_validated",
  ])("restores the old database after a failure at %s", (failurePoint) => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    writeFileSync(databasePath, "old", { mode: 0o600 });
    const openDatabase = vi.fn();
    const closeDatabase = vi.fn();
    const coordinator = makeCoordinator(dataDirectory, {
      openDatabase,
      closeDatabase,
      failpoint: (point) => {
        if (point === failurePoint) throw new Error(`failure:${point}`);
      },
    });
    seedWorkspace(coordinator);

    expect(() => coordinator.activate(restoreId)).toThrow(
      `failure:${failurePoint}`,
    );

    const paths = coordinator.pathsFor(restoreId);
    expect(readFileSync(databasePath, "utf8")).toBe("old");
    expect(existsSync(paths.installedNamespacePath)).toBe(false);
    expect(existsSync(paths.rollbackDatabasePath)).toBe(false);
    if (failurePoint === "after_namespace_installed") {
      expect(openDatabase).not.toHaveBeenCalled();
    } else {
      expect(openDatabase).toHaveBeenLastCalledWith(databasePath);
    }
    expect(closeDatabase).toHaveBeenCalledTimes(
      failurePoint === "after_namespace_installed"
        ? 0
        : failurePoint === "after_candidate_opened" ||
            failurePoint === "after_candidate_validated"
          ? 2
          : 1,
    );
  });

  it.each([
    {
      state: "prepared",
      layout: "initial",
    },
    {
      state: "prepared",
      layout: "namespace-installed",
    },
    {
      state: "prepared",
      layout: "database-renamed",
    },
    {
      state: "rollback_ready",
      layout: "database-renamed",
    },
    {
      state: "rollback_ready",
      layout: "candidate-renamed",
    },
    {
      state: "candidate_installed",
      layout: "candidate-renamed",
    },
  ] as const)(
    "recovers the $state journal with $layout filesystem state",
    ({ state, layout }) => {
      const dataDirectory = makeDataDirectory();
      const databasePath = join(dataDirectory, "on-track.sqlite");
      const coordinator = makeCoordinator(dataDirectory);
      seedWorkspace(coordinator);
      const paths = coordinator.pathsFor(restoreId);
      writeFileSync(databasePath, "old", { mode: 0o600 });
      if (layout !== "initial") {
        mkdirSync(join(dataDirectory, "attachments", "v1"), {
          recursive: true,
          mode: 0o700,
        });
        renameSync(paths.stagedNamespacePath, paths.installedNamespacePath);
      }
      if (layout === "database-renamed" || layout === "candidate-renamed") {
        renameSync(databasePath, paths.rollbackDatabasePath);
      }
      if (layout === "candidate-renamed") {
        renameSync(paths.candidateDatabasePath, databasePath);
      }
      writeFileSync(
        join(dataDirectory, ".on-track-restore-journal.json"),
        JSON.stringify({ version: 1, restoreId, state }),
        { mode: 0o600 },
      );

      expect(coordinator.recover()).toEqual({ recovered: true, state });
      expect(readFileSync(databasePath, "utf8")).toBe("old");
      expect(existsSync(paths.installedNamespacePath)).toBe(false);
      expect(existsSync(paths.rollbackDatabasePath)).toBe(false);
      expect(existsSync(paths.stagingDirectory)).toBe(false);
      expect(
        existsSync(join(dataDirectory, ".on-track-restore-journal.json")),
      ).toBe(false);
    },
  );

  it.each([
    {
      layout: "rollback database pending",
      live: false,
      rollback: true,
      installedNamespace: true,
      stagingDirectory: true,
    },
    {
      layout: "rollback database restored",
      live: true,
      rollback: false,
      installedNamespace: true,
      stagingDirectory: true,
    },
    {
      layout: "namespace cleanup completed",
      live: true,
      rollback: false,
      installedNamespace: false,
      stagingDirectory: true,
    },
    {
      layout: "all cleanup completed except journal",
      live: true,
      rollback: false,
      installedNamespace: false,
      stagingDirectory: false,
    },
  ])("resumes an interrupted $layout", (layout) => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const coordinator = makeCoordinator(dataDirectory);
    seedWorkspace(coordinator);
    const paths = coordinator.pathsFor(restoreId);
    rmSync(paths.candidateDatabasePath);
    if (layout.live) writeFileSync(databasePath, "old", { mode: 0o600 });
    if (layout.rollback) {
      writeFileSync(paths.rollbackDatabasePath, "old", { mode: 0o600 });
    }
    if (layout.installedNamespace) {
      mkdirSync(join(dataDirectory, "attachments", "v1"), {
        recursive: true,
        mode: 0o700,
      });
      renameSync(paths.stagedNamespacePath, paths.installedNamespacePath);
    } else {
      rmSync(paths.stagedNamespacePath, { recursive: true });
    }
    if (!layout.stagingDirectory) {
      rmSync(paths.stagingDirectory, { recursive: true });
    }
    writeFileSync(
      coordinator.journalPath,
      JSON.stringify({ version: 1, restoreId, state: "prepared" }),
      { mode: 0o600 },
    );

    expect(coordinator.recover()).toEqual({
      recovered: true,
      state: "prepared",
    });
    expect(readFileSync(databasePath, "utf8")).toBe("old");
    expect(existsSync(paths.rollbackDatabasePath)).toBe(false);
    expect(existsSync(paths.installedNamespacePath)).toBe(false);
    expect(existsSync(paths.stagingDirectory)).toBe(false);
    expect(existsSync(coordinator.journalPath)).toBe(false);
  });

  it("keeps an installed database and cleans restore artifacts after committed recovery", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const coordinator = makeCoordinator(dataDirectory);
    seedWorkspace(coordinator);
    const paths = coordinator.pathsFor(restoreId);
    writeFileSync(databasePath, "candidate", { mode: 0o600 });
    writeFileSync(paths.rollbackDatabasePath, "old", { mode: 0o600 });
    mkdirSync(join(dataDirectory, "attachments", "v1"), {
      recursive: true,
      mode: 0o700,
    });
    renameSync(paths.stagedNamespacePath, paths.installedNamespacePath);
    rmSync(paths.stagingDirectory, { recursive: true });
    writeFileSync(
      join(dataDirectory, ".on-track-restore-journal.json"),
      JSON.stringify({ version: 1, restoreId, state: "committed" }),
      { mode: 0o600 },
    );

    expect(coordinator.recover()).toEqual({
      recovered: true,
      state: "committed",
    });
    expect(readFileSync(databasePath, "utf8")).toBe("candidate");
    expect(existsSync(paths.installedNamespacePath)).toBe(true);
    expect(existsSync(paths.rollbackDatabasePath)).toBe(false);
    expect(existsSync(paths.stagingDirectory)).toBe(false);
  });

  it("validates a committed live database before deleting recovery artifacts", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const validateDatabase = vi.fn(() => {
      throw new Error("corrupt candidate");
    });
    const coordinator = makeCoordinator(dataDirectory, { validateDatabase });
    const paths = coordinator.createWorkspace();
    writeFileSync(databasePath, "corrupt", { mode: 0o600 });
    writeFileSync(paths.rollbackDatabasePath, "old", { mode: 0o600 });
    mkdirSync(join(dataDirectory, "attachments", "v1"), {
      recursive: true,
      mode: 0o700,
    });
    renameSync(paths.stagedNamespacePath, paths.installedNamespacePath);
    writeFileSync(
      join(dataDirectory, ".on-track-restore-journal.json"),
      JSON.stringify({ version: 1, restoreId, state: "committed" }),
      { mode: 0o600 },
    );

    expect(() => coordinator.recover()).toThrow("corrupt candidate");
    expect(readFileSync(databasePath, "utf8")).toBe("corrupt");
    expect(readFileSync(paths.rollbackDatabasePath, "utf8")).toBe("old");
    expect(existsSync(paths.stagingDirectory)).toBe(true);
    expect(existsSync(coordinator.journalPath)).toBe(true);
  });

  it("uses committed validation rather than the frozen restore inventory during recovery", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const strictRestoreValidation = vi.fn(() => {
      throw new Error("restore inventory has legitimately evolved");
    });
    const committedValidation = vi.fn();
    const coordinator = makeCoordinator(dataDirectory, {
      validateDatabase: strictRestoreValidation,
      validateCommittedDatabase: committedValidation,
    });
    const paths = coordinator.createWorkspace();
    writeFileSync(databasePath, "candidate", { mode: 0o600 });
    writeFileSync(paths.rollbackDatabasePath, "old", { mode: 0o600 });
    mkdirSync(join(dataDirectory, "attachments", "v1"), {
      recursive: true,
      mode: 0o700,
    });
    renameSync(paths.stagedNamespacePath, paths.installedNamespacePath);
    writeFileSync(
      coordinator.journalPath,
      JSON.stringify({ version: 1, restoreId, state: "committed" }),
      { mode: 0o600 },
    );

    expect(coordinator.recover()).toEqual({
      recovered: true,
      state: "committed",
    });
    expect(committedValidation).toHaveBeenCalledWith(
      databasePath,
      dataDirectory,
      paths.installedNamespaceRelativePath,
    );
    expect(strictRestoreValidation).not.toHaveBeenCalled();
  });

  it("offers startup recovery without requiring an open database lifecycle", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const coordinator = makeCoordinator(dataDirectory);
    seedWorkspace(coordinator);
    const paths = coordinator.pathsFor(restoreId);
    writeFileSync(databasePath, "old", { mode: 0o600 });
    writeFileSync(
      join(dataDirectory, ".on-track-restore-journal.json"),
      JSON.stringify({ version: 1, restoreId, state: "prepared" }),
      { mode: 0o600 },
    );

    expect(
      recoverManagedRestoreBeforeDatabaseOpen({
        dataDirectory,
        databasePath,
        validateDatabase: vi.fn(),
      }),
    ).toEqual({ recovered: true, state: "prepared" });
    expect(readFileSync(databasePath, "utf8")).toBe("old");
    expect(existsSync(paths.stagingDirectory)).toBe(false);
  });

  it.each([
    "not json",
    JSON.stringify({ version: 2, restoreId, state: "prepared" }),
    JSON.stringify({
      version: 1,
      restoreId: "../../victim",
      state: "prepared",
    }),
    JSON.stringify({ version: 1, restoreId, state: "unknown" }),
    JSON.stringify({
      version: 1,
      restoreId,
      state: "prepared",
      databasePath: "../../victim",
    }),
  ])(
    "fails closed for an invalid journal without touching files",
    (journal) => {
      const dataDirectory = makeDataDirectory();
      const victim = join(dataDirectory, "victim");
      const databasePath = join(dataDirectory, "on-track.sqlite");
      writeFileSync(victim, "safe");
      writeFileSync(databasePath, "old");
      writeFileSync(
        join(dataDirectory, ".on-track-restore-journal.json"),
        journal,
        {
          mode: 0o600,
        },
      );
      const coordinator = makeCoordinator(dataDirectory);

      expect(() => coordinator.recover()).toThrow(RestoreJournalError);
      expect(readFileSync(victim, "utf8")).toBe("safe");
      expect(readFileSync(databasePath, "utf8")).toBe("old");
    },
  );

  it("fails closed for a symlinked journal", () => {
    if (process.platform === "win32") return;
    const dataDirectory = makeDataDirectory();
    const outside = join(dataDirectory, "outside.json");
    writeFileSync(
      outside,
      JSON.stringify({ version: 1, restoreId, state: "committed" }),
    );
    symlinkSync(outside, join(dataDirectory, ".on-track-restore-journal.json"));
    const coordinator = makeCoordinator(dataDirectory);

    expect(() => coordinator.recover()).toThrow(RestoreJournalError);
    expect(lstatSync(outside).isFile()).toBe(true);
  });

  it("fails closed for a dangling journal symlink", () => {
    if (process.platform === "win32") return;
    const dataDirectory = makeDataDirectory();
    const journalPath = join(dataDirectory, ".on-track-restore-journal.json");
    symlinkSync(join(dataDirectory, "missing-journal-target"), journalPath);
    const coordinator = makeCoordinator(dataDirectory);

    expect(() => coordinator.recover()).toThrow(RestoreJournalError);
    expect(lstatSync(journalPath).isSymbolicLink()).toBe(true);
  });

  it("rejects ambiguous precommit filesystem state without deleting anything", () => {
    const dataDirectory = makeDataDirectory();
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const coordinator = makeCoordinator(dataDirectory);
    const paths = coordinator.createWorkspace();
    writeFileSync(databasePath, "candidate");
    writeFileSync(paths.rollbackDatabasePath, "old");
    writeFileSync(paths.candidateDatabasePath, "extra-candidate");
    writeFileSync(
      join(dataDirectory, ".on-track-restore-journal.json"),
      JSON.stringify({ version: 1, restoreId, state: "prepared" }),
      { mode: 0o600 },
    );

    expect(() => coordinator.recover()).toThrow(/ambiguous/i);
    expect(readFileSync(databasePath, "utf8")).toBe("candidate");
    expect(readFileSync(paths.rollbackDatabasePath, "utf8")).toBe("old");
    expect(readFileSync(paths.candidateDatabasePath, "utf8")).toBe(
      "extra-candidate",
    );
  });

  it("returns cleanly when no restore journal exists", () => {
    const dataDirectory = makeDataDirectory();
    const coordinator = makeCoordinator(dataDirectory);

    expect(coordinator.recover()).toEqual({ recovered: false });
  });
});
