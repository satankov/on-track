import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  validatePreparedSqliteBackupRestore,
  validateRecoverableSqliteBackupDatabase,
} from "./sqlite-backup-bundle.js";

export const RESTORE_JOURNAL_FILENAME = ".on-track-restore-journal.json";
export const RESTORE_JOURNAL_VERSION = 1;

export type RestoreJournalState =
  "prepared" | "rollback_ready" | "candidate_installed" | "committed";

export type RestoreFailpoint =
  | "after_prepared"
  | "after_namespace_installed"
  | "after_database_closed"
  | "after_rollback_installed"
  | "after_rollback_ready"
  | "after_candidate_installed"
  | "after_candidate_installed_journal"
  | "after_candidate_opened"
  | "after_candidate_validated"
  | "after_committed";

export interface RestoreWorkspace {
  restoreId: string;
  attachmentNamespace: string;
  stagingDirectory: string;
  candidateDatabasePath: string;
  candidateDataDirectory: string;
  stagedNamespacePath: string;
  installedNamespacePath: string;
  installedNamespaceRelativePath: string;
  rollbackDatabasePath: string;
}

export interface ManagedRestoreCoordinatorOptions {
  dataDirectory: string;
  databasePath: string;
  closeDatabase: () => void;
  openDatabase: (databasePath: string) => void;
  validateDatabase?: (
    databasePath: string,
    attachmentDataDirectory: string,
    installedNamespaceRelativePath: string,
  ) => void;
  validateCommittedDatabase?: (
    databasePath: string,
    attachmentDataDirectory: string,
    installedNamespaceRelativePath: string,
  ) => void;
  restoreIdFactory?: () => string;
  failpoint?: (point: RestoreFailpoint) => void;
  syncDirectory?: (path: string) => void;
}

export interface RecoverManagedRestoreBeforeDatabaseOpenOptions {
  dataDirectory: string;
  databasePath: string;
  validateDatabase?: (
    databasePath: string,
    attachmentDataDirectory: string,
    installedNamespaceRelativePath: string,
  ) => void;
  validateCommittedDatabase?: (
    databasePath: string,
    attachmentDataDirectory: string,
    installedNamespaceRelativePath: string,
  ) => void;
  syncDirectory?: (path: string) => void;
}

interface RestoreJournal {
  version: typeof RESTORE_JOURNAL_VERSION;
  restoreId: string;
  state: RestoreJournalState;
}

export class RestoreJournalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RestoreJournalError";
  }
}

export class ManagedRestoreCoordinator {
  readonly dataDirectory: string;
  readonly databasePath: string;
  readonly journalPath: string;

  private readonly closeDatabase: () => void;
  private readonly openDatabase: (databasePath: string) => void;
  private readonly validateDatabase: (
    databasePath: string,
    attachmentDataDirectory: string,
    installedNamespaceRelativePath: string,
  ) => void;
  private readonly validateCommittedDatabase: (
    databasePath: string,
    attachmentDataDirectory: string,
    installedNamespaceRelativePath: string,
  ) => void;
  private readonly restoreIdFactory: () => string;
  private readonly failpoint?: (point: RestoreFailpoint) => void;
  private readonly syncDirectory: (path: string) => void;

  constructor(options: ManagedRestoreCoordinatorOptions) {
    const requestedDataDirectory = resolve(options.dataDirectory);
    const requestedDatabasePath = resolve(options.databasePath);
    if (dirname(requestedDatabasePath) !== requestedDataDirectory) {
      throw new RestoreJournalError(
        "The live database must be a direct child of the data directory.",
      );
    }
    if (basename(requestedDatabasePath).length === 0) {
      throw new RestoreJournalError("The live database filename is invalid.");
    }

    mkdirSync(requestedDataDirectory, { recursive: true, mode: 0o700 });
    if (lstatSync(requestedDataDirectory).isSymbolicLink()) {
      throw new RestoreJournalError(
        "The restore data directory must not be a symbolic link.",
      );
    }
    chmodSync(requestedDataDirectory, 0o700);
    this.dataDirectory = realpathSync(requestedDataDirectory);
    this.databasePath = join(
      this.dataDirectory,
      basename(requestedDatabasePath),
    );

    this.journalPath = join(this.dataDirectory, RESTORE_JOURNAL_FILENAME);
    this.closeDatabase = options.closeDatabase;
    this.openDatabase = options.openDatabase;
    this.validateDatabase =
      options.validateDatabase ?? validatePreparedSqliteBackupRestore;
    this.validateCommittedDatabase =
      options.validateCommittedDatabase ??
      options.validateDatabase ??
      validateRecoverableSqliteBackupDatabase;
    this.restoreIdFactory = options.restoreIdFactory ?? randomUUID;
    this.failpoint = options.failpoint;
    this.syncDirectory = options.syncDirectory ?? syncDirectoryEntry;
  }

  createWorkspace(): RestoreWorkspace {
    const restoreId = this.restoreIdFactory();
    assertRestoreId(restoreId);
    const workspace = this.pathsFor(restoreId);
    let createdStagingDirectory = false;
    try {
      mkdirSync(workspace.stagingDirectory, { mode: 0o700 });
      createdStagingDirectory = true;
      for (const path of [
        workspace.candidateDataDirectory,
        join(workspace.candidateDataDirectory, "attachments"),
        join(workspace.candidateDataDirectory, "attachments", "v1"),
        workspace.stagedNamespacePath,
      ]) {
        mkdirSync(path, { mode: 0o700 });
        this.syncDirectory(path);
        this.syncDirectory(dirname(path));
      }
      this.syncDirectory(workspace.stagingDirectory);
      this.syncDirectory(this.dataDirectory);
    } catch (error) {
      if (createdStagingDirectory) {
        removeKnownDirectoryIfPresent(workspace.stagingDirectory);
      }
      throw new RestoreJournalError(
        `The restore workspace already exists or could not be created for restore id ${restoreId}.`,
        { cause: error },
      );
    }
    return workspace;
  }

  pathsFor(restoreId: string): RestoreWorkspace {
    assertRestoreId(restoreId);
    const stagingDirectory = join(
      this.dataDirectory,
      `.on-track-restore-${restoreId}`,
    );
    const attachmentNamespace = `restore-${restoreId}`;
    const candidateDataDirectory = join(stagingDirectory, "data");
    const installedNamespaceRelativePath = posix.join(
      "attachments",
      "v1",
      attachmentNamespace,
    );
    return {
      restoreId,
      attachmentNamespace,
      stagingDirectory,
      candidateDatabasePath: join(stagingDirectory, "candidate.sqlite"),
      candidateDataDirectory,
      stagedNamespacePath: join(
        candidateDataDirectory,
        "attachments",
        "v1",
        attachmentNamespace,
      ),
      installedNamespacePath: join(
        this.dataDirectory,
        ...installedNamespaceRelativePath.split("/"),
      ),
      installedNamespaceRelativePath,
      rollbackDatabasePath: join(
        this.dataDirectory,
        `.on-track-rollback-${restoreId}.sqlite`,
      ),
    };
  }

  activate(restoreId: string): {
    state: "committed";
    workspace: RestoreWorkspace;
  } {
    const workspace = this.pathsFor(restoreId);
    this.assertActivationInputs(workspace);
    this.validateDatabase(
      workspace.candidateDatabasePath,
      workspace.candidateDataDirectory,
      workspace.installedNamespaceRelativePath,
    );
    let journalWritten = false;
    let databaseClosed = false;
    let candidateOpened = false;
    let committed = false;

    try {
      this.assertJournalAbsent();
      this.writeJournal({
        version: RESTORE_JOURNAL_VERSION,
        restoreId,
        state: "prepared",
      });
      journalWritten = true;
      this.hit("after_prepared");

      const namespaceParent = this.ensureNamespaceParent();
      renameSync(
        workspace.stagedNamespacePath,
        workspace.installedNamespacePath,
      );
      this.syncDirectory(namespaceParent);
      this.syncDirectory(dirname(workspace.stagedNamespacePath));
      this.hit("after_namespace_installed");

      this.closeDatabase();
      databaseClosed = true;
      this.hit("after_database_closed");
      this.assertDatabaseSidecarsAbsent(
        this.databasePath,
        "closed live database",
      );
      renameSync(this.databasePath, workspace.rollbackDatabasePath);
      this.syncDirectory(this.dataDirectory);
      this.hit("after_rollback_installed");

      this.writeJournal({
        version: RESTORE_JOURNAL_VERSION,
        restoreId,
        state: "rollback_ready",
      });
      this.hit("after_rollback_ready");

      renameSync(workspace.candidateDatabasePath, this.databasePath);
      this.syncDirectory(workspace.stagingDirectory);
      this.syncDirectory(this.dataDirectory);
      this.hit("after_candidate_installed");

      this.writeJournal({
        version: RESTORE_JOURNAL_VERSION,
        restoreId,
        state: "candidate_installed",
      });
      this.hit("after_candidate_installed_journal");

      this.openDatabase(this.databasePath);
      candidateOpened = true;
      this.hit("after_candidate_opened");
      this.validateDatabase(
        this.databasePath,
        this.dataDirectory,
        workspace.installedNamespaceRelativePath,
      );
      this.hit("after_candidate_validated");

      this.writeJournal({
        version: RESTORE_JOURNAL_VERSION,
        restoreId,
        state: "committed",
      });
      committed = true;
      this.hit("after_committed");
    } catch (error) {
      if (!committed && journalWritten) {
        this.rollbackPrecommit(workspace, databaseClosed, candidateOpened);
      }
      throw error;
    }

    this.cleanupCommitted(workspace);
    return { state: "committed", workspace };
  }

  recover():
    { recovered: false } | { recovered: true; state: RestoreJournalState } {
    if (!pathExists(this.journalPath)) return { recovered: false };

    const journal = this.readJournal();
    const workspace = this.pathsFor(journal.restoreId);
    this.assertRecoveryLayout(journal.state, workspace);
    removeKnownFileIfPresent(this.temporaryJournalPath(workspace.restoreId));

    if (journal.state === "committed") {
      this.validateCommittedDatabase(
        this.databasePath,
        this.dataDirectory,
        workspace.installedNamespaceRelativePath,
      );
      this.cleanupCommitted(workspace);
    } else {
      this.rollbackPrecommit(workspace, false, false);
    }
    return { recovered: true, state: journal.state };
  }

  private assertActivationInputs(workspace: RestoreWorkspace): void {
    this.assertKnownRegularFile(this.databasePath, "live database");
    this.assertKnownRegularFile(
      workspace.candidateDatabasePath,
      "candidate database",
    );
    this.assertKnownDirectory(
      workspace.stagingDirectory,
      "restore staging directory",
    );
    this.assertWorkspaceNamespaceAncestors(workspace);
    this.assertKnownDirectory(
      workspace.stagedNamespacePath,
      "staged attachment namespace",
    );
    this.assertDatabaseFamilyAbsent(
      workspace.rollbackDatabasePath,
      "generated rollback path",
    );
    this.assertDatabaseSidecarsAbsent(
      workspace.candidateDatabasePath,
      "candidate database",
    );
    if (pathExists(workspace.installedNamespacePath)) {
      throw new RestoreJournalError(
        "The generated attachment namespace already exists.",
      );
    }
  }

  private assertJournalAbsent(): void {
    if (pathExists(this.journalPath)) {
      throw new RestoreJournalError(
        "A restore journal already exists and must be recovered first.",
      );
    }
  }

  private assertDatabaseFamilyAbsent(path: string, label: string): void {
    for (const candidate of databaseFiles(path)) {
      if (pathExists(candidate)) {
        throw new RestoreJournalError(`The ${label} already exists.`);
      }
    }
  }

  private assertDatabaseSidecarsAbsent(path: string, label: string): void {
    for (const candidate of databaseSidecars(path)) {
      if (pathExists(candidate)) {
        throw new RestoreJournalError(`The ${label} has unexpected sidecars.`);
      }
    }
  }

  private ensureNamespaceParent(): string {
    let current = this.dataDirectory;
    for (const component of ["attachments", "v1"]) {
      current = join(current, component);
      if (pathExists(current)) {
        this.assertKnownDirectory(current, "managed attachment directory");
      } else {
        mkdirSync(current, { mode: 0o700 });
        this.syncDirectory(current);
        this.syncDirectory(dirname(current));
      }
    }
    return current;
  }

  private writeJournal(journal: RestoreJournal): void {
    const temporaryPath = this.temporaryJournalPath(journal.restoreId);
    let descriptor: number | undefined;
    let createdTemporary = false;
    try {
      descriptor = openSync(
        temporaryPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      createdTemporary = true;
      writeFileSync(descriptor, `${JSON.stringify(journal)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.journalPath);
      chmodSync(this.journalPath, 0o600);
      this.syncDirectory(this.dataDirectory);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (createdTemporary) removeKnownFileIfPresent(temporaryPath);
      throw new RestoreJournalError(
        "Could not durably update the restore journal.",
        {
          cause: error,
        },
      );
    }
  }

  private readJournal(): RestoreJournal {
    let value: unknown;
    try {
      const metadata = lstatSync(this.journalPath);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size > 4096
      ) {
        throw new Error("journal is not a bounded regular file");
      }
      value = JSON.parse(readFileSync(this.journalPath, "utf8")) as unknown;
    } catch (error) {
      throw new RestoreJournalError(
        "The restore journal is invalid; recovery stopped without changing files.",
        { cause: error },
      );
    }
    if (!isRestoreJournal(value)) {
      throw new RestoreJournalError(
        "The restore journal is invalid; recovery stopped without changing files.",
      );
    }
    return value;
  }

  private assertRecoveryLayout(
    state: RestoreJournalState,
    workspace: RestoreWorkspace,
  ): void {
    this.assertKnownPathTypes(workspace);
    const live = pathExists(this.databasePath);
    const rollback = pathExists(workspace.rollbackDatabasePath);
    const candidate = pathExists(workspace.candidateDatabasePath);
    const stagedNamespace = pathExists(workspace.stagedNamespacePath);
    const installedNamespace = pathExists(workspace.installedNamespacePath);

    const preparedBeforeSwap =
      live && !rollback && candidate && stagedNamespace !== installedNamespace;
    const rollbackBeforeCandidate =
      !live && rollback && candidate && !stagedNamespace && installedNamespace;
    const candidateBeforeCommit =
      live && rollback && !candidate && !stagedNamespace && installedNamespace;
    const rollbackRestorePending =
      !live && rollback && !candidate && !stagedNamespace && installedNamespace;
    const rollbackRestored =
      live && !rollback && !candidate && !stagedNamespace;

    let valid: boolean;
    if (state === "prepared") {
      valid =
        preparedBeforeSwap ||
        rollbackBeforeCandidate ||
        candidateBeforeCommit ||
        rollbackRestorePending ||
        rollbackRestored;
    } else if (state === "rollback_ready") {
      valid = rollbackBeforeCandidate || candidateBeforeCommit;
    } else if (state === "candidate_installed") {
      valid = candidateBeforeCommit;
    } else {
      valid = live && !candidate && !stagedNamespace && installedNamespace;
    }

    if (!valid) {
      throw new RestoreJournalError(
        "Restore filesystem state is ambiguous; recovery stopped without changing files.",
      );
    }
  }

  private assertKnownPathTypes(workspace: RestoreWorkspace): void {
    for (const [path, label] of [
      [this.databasePath, "live database"],
      [workspace.rollbackDatabasePath, "rollback database"],
      [workspace.candidateDatabasePath, "candidate database"],
    ] as const) {
      if (pathExists(path)) this.assertKnownRegularFile(path, label);
    }
    for (const [path, label] of [
      [workspace.stagingDirectory, "restore staging directory"],
      [workspace.candidateDataDirectory, "candidate data directory"],
      [
        join(workspace.candidateDataDirectory, "attachments"),
        "candidate attachment directory",
      ],
      [
        join(workspace.candidateDataDirectory, "attachments", "v1"),
        "candidate attachment version directory",
      ],
      [workspace.stagedNamespacePath, "staged attachment namespace"],
      [join(this.dataDirectory, "attachments"), "managed attachment directory"],
      [
        join(this.dataDirectory, "attachments", "v1"),
        "managed attachment version directory",
      ],
      [workspace.installedNamespacePath, "installed attachment namespace"],
    ] as const) {
      if (pathExists(path)) this.assertKnownDirectory(path, label);
    }
  }

  private assertKnownRegularFile(path: string, label: string): void {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RestoreJournalError(`The ${label} is not a safe regular file.`);
    }
  }

  private assertWorkspaceNamespaceAncestors(workspace: RestoreWorkspace): void {
    for (const [path, label] of [
      [workspace.candidateDataDirectory, "candidate data directory"],
      [
        join(workspace.candidateDataDirectory, "attachments"),
        "candidate attachment directory",
      ],
      [
        join(workspace.candidateDataDirectory, "attachments", "v1"),
        "candidate attachment version directory",
      ],
    ] as const) {
      this.assertKnownDirectory(path, label);
    }
  }

  private assertKnownDirectory(path: string, label: string): void {
    const metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new RestoreJournalError(`The ${label} is not a safe directory.`);
    }
    const canonical = realpathSync(path);
    const fromRoot = relative(this.dataDirectory, canonical);
    if (
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot) ||
      resolve(canonical) === this.dataDirectory
    ) {
      throw new RestoreJournalError(`The ${label} escapes the data directory.`);
    }
  }

  private rollbackPrecommit(
    workspace: RestoreWorkspace,
    databaseClosed: boolean,
    candidateOpened: boolean,
  ): void {
    this.writeJournal({
      version: RESTORE_JOURNAL_VERSION,
      restoreId: workspace.restoreId,
      state: "prepared",
    });
    if (candidateOpened) this.closeDatabase();
    if (pathExists(workspace.rollbackDatabasePath)) {
      removeDatabaseFiles(this.databasePath);
      this.syncDirectory(this.dataDirectory);
      renameSync(workspace.rollbackDatabasePath, this.databasePath);
      this.syncDirectory(this.dataDirectory);
    }
    removeKnownDirectoryIfPresent(workspace.installedNamespacePath);
    const installedParent = dirname(workspace.installedNamespacePath);
    if (pathExists(installedParent)) this.syncDirectory(installedParent);
    removeKnownDirectoryIfPresent(workspace.stagingDirectory);
    removeKnownFileIfPresent(this.temporaryJournalPath(workspace.restoreId));
    removeKnownFileIfPresent(this.journalPath);
    this.syncDirectory(this.dataDirectory);
    if (databaseClosed) this.openDatabase(this.databasePath);
  }

  private cleanupCommitted(workspace: RestoreWorkspace): void {
    try {
      removeDatabaseFiles(workspace.rollbackDatabasePath);
      removeKnownDirectoryIfPresent(workspace.stagingDirectory);
      removeKnownFileIfPresent(this.temporaryJournalPath(workspace.restoreId));
      removeKnownFileIfPresent(this.journalPath);
      this.syncDirectory(this.dataDirectory);
    } catch {
      // A committed restore remains authoritative. Startup recovery retries cleanup.
    }
  }

  private hit(point: RestoreFailpoint): void {
    this.failpoint?.(point);
  }

  private temporaryJournalPath(restoreId: string): string {
    return join(
      this.dataDirectory,
      `.on-track-restore-journal-${restoreId}.tmp`,
    );
  }
}

export function recoverManagedRestoreBeforeDatabaseOpen(
  options: RecoverManagedRestoreBeforeDatabaseOpenOptions,
): ReturnType<ManagedRestoreCoordinator["recover"]> {
  return new ManagedRestoreCoordinator({
    ...options,
    closeDatabase: () => undefined,
    openDatabase: () => undefined,
  }).recover();
}

function assertRestoreId(restoreId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      restoreId,
    )
  ) {
    throw new RestoreJournalError("The generated restore id is invalid.");
  }
}

function isRestoreJournal(value: unknown): value is RestoreJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "restoreId,state,version" ||
    record.version !== RESTORE_JOURNAL_VERSION ||
    typeof record.restoreId !== "string" ||
    !isRestoreJournalState(record.state)
  ) {
    return false;
  }
  try {
    assertRestoreId(record.restoreId);
    return true;
  } catch {
    return false;
  }
}

function isRestoreJournalState(value: unknown): value is RestoreJournalState {
  return (
    value === "prepared" ||
    value === "rollback_ready" ||
    value === "candidate_installed" ||
    value === "committed"
  );
}

function removeDatabaseFiles(databasePath: string): void {
  for (const path of databaseFiles(databasePath)) {
    removeKnownFileIfPresent(path);
  }
}

function databaseFiles(databasePath: string): string[] {
  return [databasePath, ...databaseSidecars(databasePath)];
}

function databaseSidecars(databasePath: string): string[] {
  return [
    `${databasePath}-wal`,
    `${databasePath}-shm`,
    `${databasePath}-journal`,
  ];
}

function removeKnownFileIfPresent(path: string): void {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RestoreJournalError(
        "Refusing to remove an unsafe restore file.",
      );
    }
    unlinkSync(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function removeKnownDirectoryIfPresent(path: string): void {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new RestoreJournalError(
        "Refusing to remove an unsafe restore directory.",
      );
    }
    rmSync(path, { recursive: true });
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function syncDirectoryEntry(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  return (
    code === "EINVAL" ||
    code === "ENOTSUP" ||
    code === "ENOSYS" ||
    (process.platform === "win32" &&
      (code === "EACCES" || code === "EPERM" || code === "EISDIR"))
  );
}
