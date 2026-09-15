import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  assertUpdateFile,
  checkpointDescriptorSchema,
  syncUpdateDirectory,
  UpdateJournalError,
  updateIdSchema,
  type DatabaseCheckpoint,
} from "./update-journal.js";

export interface CreateDatabaseCheckpointOptions {
  dataDirectory: string;
  databasePath: string;
  transactionId: string;
  expectedSchemaVersion: number;
  expectedMigrationMarker: number;
}

export function checkpointPath(
  dataDirectory: string,
  transactionId: string,
): string {
  if (!updateIdSchema.safeParse(transactionId).success)
    throw new UpdateJournalError("Invalid checkpoint transaction identity.");
  return join(dataDirectory, `.on-track-update-${transactionId}.sqlite`);
}

function assertDatabaseLocation(
  dataDirectory: string,
  databasePath: string,
): string {
  const canonical = realpathSync(dataDirectory);
  if (
    lstatSync(dataDirectory).isSymbolicLink() ||
    realpathSync(dirname(resolve(databasePath))) !== canonical
  )
    throw new UpdateJournalError(
      "Database must be a direct child of the owned data directory.",
    );
  return canonical;
}

/** Own the data directory and resolve old-version import recovery before calling. */
export async function createDatabaseCheckpoint(
  options: CreateDatabaseCheckpointOptions,
): Promise<DatabaseCheckpoint> {
  const dataDirectory = assertDatabaseLocation(
    options.dataDirectory,
    options.databasePath,
  );
  assertUpdateFile(options.databasePath);
  const destination = checkpointPath(dataDirectory, options.transactionId);
  const created = openSync(
    destination,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  closeSync(created);
  const source = new Database(options.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }
  assertUpdateFile(destination);
  // The snapshot contains every committed WAL page. Normalize only the copy so
  // validation and rollback never depend on checkpoint sidecars.
  const snapshot = new Database(destination, { fileMustExist: true });
  try {
    snapshot.pragma("journal_mode = DELETE");
  } finally {
    snapshot.close();
  }
  chmodSync(destination, 0o600);
  flushFile(destination);
  syncUpdateDirectory(dataDirectory);
  const checkpoint = {
    transactionId: options.transactionId,
    ...hashDatabaseFile(destination),
    schemaVersion: options.expectedSchemaVersion,
    migrationMarker: options.expectedMigrationMarker,
  };
  validateDatabaseCheckpoint(dataDirectory, checkpoint);
  return checkpoint;
}

export function validateDatabaseCheckpoint(
  dataDirectory: string,
  checkpoint: DatabaseCheckpoint,
): string {
  if (!checkpointDescriptorSchema.safeParse(checkpoint).success)
    throw new UpdateJournalError("Invalid database checkpoint descriptor.");
  const path = checkpointPath(
    realpathSync(dataDirectory),
    checkpoint.transactionId,
  );
  // The descriptor authenticates a standalone SQLite file, never unrecorded
  // sidecars that SQLite might replay while we inspect it.
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (assertUpdateFile(`${path}${suffix}`, true))
      throw new UpdateJournalError(
        "Database checkpoint has unexpected SQLite sidecars.",
      );
  }
  const actual = hashDatabaseFile(path);
  if (actual.sha256 !== checkpoint.sha256 || actual.size !== checkpoint.size)
    throw new UpdateJournalError(
      "Database checkpoint integrity does not match. Recovery stopped.",
    );
  validateDatabaseIdentity(
    path,
    checkpoint.schemaVersion,
    checkpoint.migrationMarker,
  );
  return path;
}

export function validateDatabaseIdentity(
  path: string,
  schemaVersion: number,
  migrationMarker: number,
): void {
  assertUpdateFile(path);
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (
      sqlite.pragma("integrity_check", { simple: true }) !== "ok" ||
      (sqlite.pragma("foreign_key_check") as unknown[]).length !== 0
    )
      throw new UpdateJournalError(
        "Database checkpoint failed SQLite integrity checks.",
      );
    const schema = sqlite
      .prepare("SELECT schema_version FROM app_metadata WHERE id = 1")
      .pluck()
      .get();
    const migration = sqlite
      .prepare("SELECT max(created_at) FROM __drizzle_migrations")
      .pluck()
      .get();
    if (schema !== schemaVersion || migration !== migrationMarker)
      throw new UpdateJournalError(
        "Database checkpoint schema does not match its previous release.",
      );
  } finally {
    sqlite.close();
  }
}

export type CheckpointRestoreFailpoint =
  "after_copy" | "after_sidecars_removed" | "after_database_replaced";

/** All application SQLite connections MUST be closed; lifetime ownership held.
 * The checkpoint and journal remain intact, making every interruption repeatable.
 */
export function restoreDatabaseCheckpoint(options: {
  dataDirectory: string;
  databasePath: string;
  checkpoint: DatabaseCheckpoint;
  failpoint?: (point: CheckpointRestoreFailpoint) => void;
}): void {
  const dataDirectory = assertDatabaseLocation(
    options.dataDirectory,
    options.databasePath,
  );
  const source = validateDatabaseCheckpoint(dataDirectory, options.checkpoint);
  assertUpdateFile(options.databasePath, true);
  const temporary = join(
    dataDirectory,
    `.on-track-update-restore-${options.checkpoint.transactionId}.sqlite`,
  );
  // A prior interrupted copy is disposable only after its immutable source has
  // passed verification. One constrained staging name bounds repeated recovery.
  if (assertUpdateFile(temporary, true)) unlinkSync(temporary);
  copyFileSync(source, temporary, constants.COPYFILE_EXCL);
  chmodSync(temporary, 0o600);
  flushFile(temporary);
  const copy = hashDatabaseFile(temporary);
  if (
    copy.sha256 !== options.checkpoint.sha256 ||
    copy.size !== options.checkpoint.size
  )
    throw new UpdateJournalError(
      "Restaged database checkpoint failed verification.",
    );
  options.failpoint?.("after_copy");
  // Validate all sidecars before removing any. This never traverses attachments.
  const sidecars = ["-wal", "-shm", "-journal"].map(
    (suffix) => `${options.databasePath}${suffix}`,
  );
  for (const path of sidecars) assertUpdateFile(path, true);
  for (const path of sidecars)
    if (assertUpdateFile(path, true)) unlinkSync(path);
  syncUpdateDirectory(dataDirectory);
  options.failpoint?.("after_sidecars_removed");
  assertUpdateFile(options.databasePath, true);
  renameSync(temporary, options.databasePath);
  syncUpdateDirectory(dataDirectory);
  options.failpoint?.("after_database_replaced");
  validateDatabaseIdentity(
    options.databasePath,
    options.checkpoint.schemaVersion,
    options.checkpoint.migrationMarker,
  );
}

function flushFile(path: string): void {
  assertUpdateFile(path);
  const descriptor = openSync(
    path,
    constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function hashDatabaseFile(path: string): { sha256: string; size: number } {
  assertUpdateFile(path);
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new UpdateJournalError("Unsafe database checkpoint file.");
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let size = 0;
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytes) break;
      size += bytes;
      digest.update(buffer.subarray(0, bytes));
    }
    if (size !== stat.size)
      throw new UpdateJournalError(
        "Database checkpoint changed during validation.",
      );
    return { sha256: digest.digest("hex"), size };
  } finally {
    closeSync(descriptor);
  }
}
