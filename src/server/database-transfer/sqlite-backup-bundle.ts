import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";

import Database from "better-sqlite3";

import {
  ACCENTS,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "../../domain/validation.js";
import {
  isCanonicalAttachmentFilename,
  isCanonicalAttachmentMediaType,
} from "../attachment-metadata.js";
import {
  ManagedAttachmentChangedError,
  ManagedAttachmentStore,
  type ManagedAttachmentRead,
} from "../attachments/managed-attachment-store.js";

export const SQL_ON_TRACK_BACKUP_APPLICATION_ID = 0x4f545242;
export const SQL_ON_TRACK_BACKUP_FORMAT_VERSION = 1;
export const SQL_ON_TRACK_BACKUP_SCHEMA_VERSION = 2;

export interface SqliteBackupBundleLimits {
  maximumBundleBytes: number;
  maximumAttachmentCount: number;
  maximumAttachmentBytes: number;
  maximumTotalAttachmentBytes: number;
  maximumChangedReadRetries: number;
}

export const DEFAULT_SQLITE_BACKUP_BUNDLE_LIMITS = Object.freeze({
  maximumBundleBytes: 2 * 1024 * 1024 * 1024,
  maximumAttachmentCount: 10_000,
  maximumAttachmentBytes: 100 * 1024 * 1024,
  maximumTotalAttachmentBytes: 1024 * 1024 * 1024,
  maximumChangedReadRetries: 2,
}) satisfies Readonly<SqliteBackupBundleLimits>;

export interface SqliteBackupBundleManifest {
  formatVersion: number;
  schemaVersion: number;
  createdAt: number;
  attachmentCount: number;
  totalBytes: number;
}

export interface CreateSqliteBackupBundleOptions {
  sourceDatabase: Database.Database;
  destinationPath: string;
  attachmentStore: Pick<ManagedAttachmentStore, "read">;
  limits?: Partial<SqliteBackupBundleLimits>;
  createdAt?: () => number;
}

export interface PrepareSqliteBackupBundleOptions {
  bundlePath: string;
  workspace: SqliteBackupPreparationWorkspace;
  limits?: Partial<SqliteBackupBundleLimits>;
}

export interface SqliteBackupPreparationWorkspace {
  restoreId: string;
  attachmentNamespace: string;
  stagingDirectory: string;
  candidateDatabasePath: string;
  candidateDataDirectory: string;
  stagedNamespacePath: string;
  installedNamespaceRelativePath: string;
}

export interface PreparedSqliteBackupBundle {
  restoreId: string;
  attachmentNamespace: string;
  restoreDirectory: string;
  candidateDatabasePath: string;
  candidateDataDirectory: string;
  stagedNamespacePath: string;
  installedNamespaceRelativePath: string;
  manifest: SqliteBackupBundleManifest;
}

export class SqliteBackupBundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqliteBackupBundleValidationError";
  }
}

interface AttachmentMetadataRow {
  id: string;
  note_id: string;
  filename: string;
  media_type: string;
  storage_path: string;
  byte_size: number;
  modified_at: number;
  created_at: number;
}

interface BundlePayloadRow {
  attachment_id: string;
  byte_size: number;
  modified_at: number;
  sha256: string;
  content: Buffer;
}

interface ColumnDescription {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface IndexDescription {
  name: string;
  unique: number;
  origin: string;
  columns: string[];
}

interface ForeignKeyDescription {
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

const GENERATED_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ALLOWED_ACCENTS = new Set<string>(ACCENTS);
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "binary");

const ACTIVE_SCHEMA_OBJECTS = [
  "__drizzle_migrations:table",
  "app_metadata:table",
  "chats:table",
  "chats_activity_idx:index",
  "note_attachments:table",
  "note_attachments_note_idx:index",
  "notes:table",
  "notes_chat_history_idx:index",
] as const;

const BUNDLE_SCHEMA_OBJECTS = [
  ...ACTIVE_SCHEMA_OBJECTS,
  "_on_track_bundle:table",
  "_on_track_bundle_files:table",
].sort();

const ACTIVE_TABLE_COLUMNS: Readonly<Record<string, ColumnDescription[]>> = {
  __drizzle_migrations: [
    { name: "id", type: "SERIAL", notnull: 0, pk: 1 },
    { name: "hash", type: "TEXT", notnull: 1, pk: 0 },
    { name: "created_at", type: "numeric", notnull: 0, pk: 0 },
  ],
  app_metadata: [
    { name: "id", type: "INTEGER", notnull: 1, pk: 1 },
    { name: "schema_version", type: "INTEGER", notnull: 1, pk: 0 },
  ],
  chats: [
    { name: "id", type: "TEXT", notnull: 1, pk: 1 },
    { name: "title", type: "TEXT", notnull: 1, pk: 0 },
    { name: "accent", type: "TEXT", notnull: 1, pk: 0 },
    { name: "created_at", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "updated_at", type: "INTEGER", notnull: 1, pk: 0 },
  ],
  notes: [
    { name: "id", type: "TEXT", notnull: 1, pk: 1 },
    { name: "chat_id", type: "TEXT", notnull: 1, pk: 0 },
    { name: "body", type: "TEXT", notnull: 1, pk: 0 },
    { name: "created_at", type: "INTEGER", notnull: 1, pk: 0 },
  ],
  note_attachments: [
    { name: "id", type: "TEXT", notnull: 1, pk: 1 },
    { name: "note_id", type: "TEXT", notnull: 1, pk: 0 },
    { name: "filename", type: "TEXT", notnull: 1, pk: 0 },
    { name: "media_type", type: "TEXT", notnull: 1, pk: 0 },
    { name: "storage_path", type: "TEXT", notnull: 1, pk: 0 },
    { name: "byte_size", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "modified_at", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "created_at", type: "INTEGER", notnull: 1, pk: 0 },
  ],
};

const BUNDLE_TABLE_COLUMNS: Readonly<Record<string, ColumnDescription[]>> = {
  _on_track_bundle: [
    { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
    { name: "format_version", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "schema_version", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "created_at", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "attachment_count", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "total_bytes", type: "INTEGER", notnull: 1, pk: 0 },
  ],
  _on_track_bundle_files: [
    { name: "attachment_id", type: "TEXT", notnull: 0, pk: 1 },
    { name: "byte_size", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "modified_at", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "sha256", type: "TEXT", notnull: 1, pk: 0 },
    { name: "content", type: "BLOB", notnull: 1, pk: 0 },
  ],
};

const ACTIVE_FOREIGN_KEYS: Readonly<Record<string, ForeignKeyDescription[]>> = {
  __drizzle_migrations: [],
  app_metadata: [],
  chats: [],
  notes: [foreignKey("chats", "chat_id", "id", "CASCADE")],
  note_attachments: [foreignKey("notes", "note_id", "id", "CASCADE")],
};

const BUNDLE_FOREIGN_KEYS: Readonly<Record<string, ForeignKeyDescription[]>> = {
  _on_track_bundle: [],
  _on_track_bundle_files: [
    foreignKey("note_attachments", "attachment_id", "id", "CASCADE"),
  ],
};

const ACTIVE_INDEXES: Readonly<Record<string, IndexDescription[]>> = {
  __drizzle_migrations: [
    index("sqlite_autoindex___drizzle_migrations_1", 1, "pk", ["id"]),
  ],
  app_metadata: [],
  chats: [
    index("chats_activity_idx", 0, "c", ["updated_at", "id"]),
    index("sqlite_autoindex_chats_1", 1, "pk", ["id"]),
  ],
  notes: [
    index("notes_chat_history_idx", 0, "c", ["chat_id", "created_at", "id"]),
    index("sqlite_autoindex_notes_1", 1, "pk", ["id"]),
  ],
  note_attachments: [
    index("note_attachments_note_idx", 0, "c", ["note_id", "created_at", "id"]),
    index("sqlite_autoindex_note_attachments_1", 1, "pk", ["id"]),
    index("sqlite_autoindex_note_attachments_2", 1, "u", ["storage_path"]),
  ],
};

const BUNDLE_INDEXES: Readonly<Record<string, IndexDescription[]>> = {
  _on_track_bundle: [],
  _on_track_bundle_files: [
    index("sqlite_autoindex__on_track_bundle_files_1", 1, "pk", [
      "attachment_id",
    ]),
  ],
};

const ACTIVE_TABLE_DEFINITIONS: Readonly<Record<string, string>> = {
  __drizzle_migrations:
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at numeric)",
  app_metadata:
    "CREATE TABLE app_metadata (id INTEGER PRIMARY KEY NOT NULL, schema_version INTEGER NOT NULL, CONSTRAINT app_metadata_single_row CHECK (app_metadata.id = 1), CONSTRAINT app_metadata_version_positive CHECK (app_metadata.schema_version >= 1))",
  chats:
    "CREATE TABLE chats (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, accent TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, CONSTRAINT chats_title_length CHECK (length(trim(chats.title)) BETWEEN 1 AND 80), CONSTRAINT chats_accent_allowed CHECK (accent IN ('coral', 'amber', 'moss', 'ocean', 'iris', 'slate')))",
  notes:
    "CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL, chat_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (chat_id) REFERENCES chats(id) ON UPDATE NO ACTION ON DELETE CASCADE, CONSTRAINT notes_body_length CHECK (length(notes.body) <= 10000))",
  note_attachments:
    "CREATE TABLE note_attachments (id TEXT PRIMARY KEY NOT NULL, note_id TEXT NOT NULL, filename TEXT NOT NULL, media_type TEXT NOT NULL, storage_path TEXT NOT NULL UNIQUE, byte_size INTEGER NOT NULL, modified_at INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (note_id) REFERENCES notes(id) ON UPDATE NO ACTION ON DELETE CASCADE, CONSTRAINT note_attachments_filename_length CHECK (length(trim(note_attachments.filename)) BETWEEN 1 AND 255), CONSTRAINT note_attachments_media_type_length CHECK (length(trim(note_attachments.media_type)) BETWEEN 1 AND 255), CONSTRAINT note_attachments_storage_path_length CHECK (length(note_attachments.storage_path) BETWEEN 1 AND 1024), CONSTRAINT note_attachments_byte_size_nonnegative CHECK (note_attachments.byte_size >= 0), CONSTRAINT note_attachments_modified_at_nonnegative CHECK (note_attachments.modified_at >= 0))",
};

const BUNDLE_TABLE_DEFINITIONS: Readonly<Record<string, string>> = {
  _on_track_bundle:
    "CREATE TABLE _on_track_bundle (id INTEGER PRIMARY KEY CHECK (id = 1), format_version INTEGER NOT NULL, schema_version INTEGER NOT NULL, created_at INTEGER NOT NULL CHECK (created_at >= 0), attachment_count INTEGER NOT NULL CHECK (attachment_count >= 0), total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0))",
  _on_track_bundle_files:
    "CREATE TABLE _on_track_bundle_files (attachment_id TEXT PRIMARY KEY REFERENCES note_attachments(id) ON DELETE CASCADE, byte_size INTEGER NOT NULL CHECK (byte_size >= 0), modified_at INTEGER NOT NULL CHECK (modified_at >= 0), sha256 TEXT NOT NULL CHECK (length(sha256) = 64), content BLOB NOT NULL, CHECK (length(content) = byte_size))",
};

export async function createSqliteBackupBundle(
  options: CreateSqliteBackupBundleOptions,
): Promise<SqliteBackupBundleManifest> {
  const limits = resolveLimits(options.limits);
  const createdAt = (options.createdAt ?? Date.now)();
  requireNonnegativeSafeInteger(createdAt, "bundle creation time");
  requireAbsolutePath(options.destinationPath, "bundle destination");
  if (directoryEntryExists(options.destinationPath)) {
    throw new Error("The backup bundle destination already exists.");
  }
  assertPrivateDestinationDirectory(dirname(options.destinationPath));

  let bundle: Database.Database | undefined;
  try {
    await options.sourceDatabase.backup(options.destinationPath);
    chmodSync(options.destinationPath, 0o600);
    bundle = new Database(options.destinationPath);
    bundle.pragma("foreign_keys = ON");
    bundle.pragma("journal_mode = DELETE");
    validateActiveDatabase(bundle, limits);

    const attachments = bundle
      .prepare(
        `SELECT id, note_id, filename, media_type, storage_path,
                byte_size, modified_at, created_at
         FROM note_attachments
         ORDER BY id`,
      )
      .all() as AttachmentMetadataRow[];
    if (attachments.length > limits.maximumAttachmentCount) {
      throw validationError("The attachment count exceeds the bundle limit.");
    }

    bundle.exec(`
      CREATE TABLE _on_track_bundle (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        format_version INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        attachment_count INTEGER NOT NULL CHECK (attachment_count >= 0),
        total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0)
      );
      CREATE TABLE _on_track_bundle_files (
        attachment_id TEXT PRIMARY KEY
          REFERENCES note_attachments(id) ON DELETE CASCADE,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        modified_at INTEGER NOT NULL CHECK (modified_at >= 0),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        content BLOB NOT NULL,
        CHECK (length(content) = byte_size)
      );
    `);

    let totalBytes = 0;
    const insertPayload = bundle.prepare(
      `INSERT INTO _on_track_bundle_files
       (attachment_id, byte_size, modified_at, sha256, content)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const updateMetadata = bundle.prepare(
      `UPDATE note_attachments
       SET byte_size = ?, modified_at = ?
       WHERE id = ?`,
    );
    const insertPayloads = bundle.transaction(() => {
      for (const attachment of attachments) {
        validateAttachmentMetadata(attachment, limits);
        const read = readManagedAttachmentWithRetries(
          options.attachmentStore,
          attachment.storage_path,
          limits.maximumChangedReadRetries,
        );
        validateAttachmentRead(read, limits);
        totalBytes = safeTotal(
          totalBytes,
          read.byteSize,
          limits.maximumTotalAttachmentBytes,
        );
        insertPayload.run(
          attachment.id,
          read.byteSize,
          read.modifiedAt,
          sha256(read.content),
          read.content,
        );
        updateMetadata.run(read.byteSize, read.modifiedAt, attachment.id);
      }
    });
    insertPayloads();

    bundle
      .prepare(
        `INSERT INTO _on_track_bundle
         (id, format_version, schema_version, created_at,
          attachment_count, total_bytes)
         VALUES (1, ?, ?, ?, ?, ?)`,
      )
      .run(
        SQL_ON_TRACK_BACKUP_FORMAT_VERSION,
        SQL_ON_TRACK_BACKUP_SCHEMA_VERSION,
        createdAt,
        attachments.length,
        totalBytes,
      );
    bundle.pragma(`application_id = ${SQL_ON_TRACK_BACKUP_APPLICATION_ID}`);
    bundle.close();
    bundle = undefined;

    const manifest = validateSqliteBackupBundle(
      options.destinationPath,
      limits,
    );
    return manifest;
  } catch (error) {
    if (bundle?.open) bundle.close();
    removeDatabaseFiles(options.destinationPath);
    throw error;
  }
}

export function validateSqliteBackupBundle(
  bundlePath: string,
  limitOverrides?: Partial<SqliteBackupBundleLimits>,
): SqliteBackupBundleManifest {
  const limits = resolveLimits(limitOverrides);
  validateSqliteFileEnvelope(bundlePath, limits.maximumBundleBytes);

  const database = openReadOnlyDatabase(bundlePath);
  try {
    const applicationId = database.pragma("application_id", {
      simple: true,
    });
    if (applicationId !== SQL_ON_TRACK_BACKUP_APPLICATION_ID) {
      throw validationError(
        "This is not a supported versioned On Track backup bundle.",
      );
    }
    validateIntegrity(database);
    validateExactSchema(
      database,
      BUNDLE_SCHEMA_OBJECTS,
      Object.assign({}, ACTIVE_TABLE_COLUMNS, BUNDLE_TABLE_COLUMNS),
      Object.assign({}, ACTIVE_FOREIGN_KEYS, BUNDLE_FOREIGN_KEYS),
      Object.assign({}, ACTIVE_INDEXES, BUNDLE_INDEXES),
      Object.assign({}, ACTIVE_TABLE_DEFINITIONS, BUNDLE_TABLE_DEFINITIONS),
    );
    validateSchemaVersion(database);
    validateApplicationData(database, limits);

    const rows = database
      .prepare(
        `SELECT format_version, schema_version, created_at,
                attachment_count, total_bytes
         FROM _on_track_bundle
         WHERE id = 1`,
      )
      .all() as Array<{
      format_version: number;
      schema_version: number;
      created_at: number;
      attachment_count: number;
      total_bytes: number;
    }>;
    const manifestRowCount = database
      .prepare("SELECT count(*) FROM _on_track_bundle")
      .pluck()
      .get() as number;
    if (rows.length !== 1 || manifestRowCount !== 1) {
      throw validationError(
        "The backup manifest must contain exactly one row.",
      );
    }
    const row = rows[0];
    if (
      row.format_version !== SQL_ON_TRACK_BACKUP_FORMAT_VERSION ||
      row.schema_version !== SQL_ON_TRACK_BACKUP_SCHEMA_VERSION
    ) {
      throw validationError("The backup bundle version is unsupported.");
    }
    requireNonnegativeSafeInteger(row.created_at, "bundle creation time");
    requireNonnegativeSafeInteger(row.attachment_count, "attachment count");
    requireNonnegativeSafeInteger(row.total_bytes, "total attachment bytes");
    if (row.attachment_count > limits.maximumAttachmentCount) {
      throw validationError("The attachment count exceeds the bundle limit.");
    }
    if (row.total_bytes > limits.maximumTotalAttachmentBytes) {
      throw validationError(
        "The total attachment bytes exceed the bundle limit.",
      );
    }

    const metadataCount = database
      .prepare("SELECT count(*) FROM note_attachments")
      .pluck()
      .get() as number;
    const payloadCount = database
      .prepare("SELECT count(*) FROM _on_track_bundle_files")
      .pluck()
      .get() as number;
    requireNonnegativeSafeInteger(metadataCount, "attachment row count");
    requireNonnegativeSafeInteger(payloadCount, "attachment payload count");
    if (
      metadataCount !== row.attachment_count ||
      payloadCount !== row.attachment_count ||
      metadataCount > limits.maximumAttachmentCount
    ) {
      throw validationError(
        "The attachment count does not match the manifest.",
      );
    }

    const metadata = database
      .prepare(
        `SELECT id, note_id, filename, media_type, storage_path,
                byte_size, modified_at, created_at
         FROM note_attachments
         ORDER BY id`,
      )
      .all() as AttachmentMetadataRow[];
    const payloadSizes = database
      .prepare(
        `SELECT attachment_id, byte_size, modified_at, sha256,
                length(content) AS content_length
         FROM _on_track_bundle_files
         ORDER BY attachment_id`,
      )
      .all() as Array<
      Omit<BundlePayloadRow, "content"> & { content_length: number }
    >;
    if (
      metadata.length !== metadataCount ||
      payloadSizes.length !== payloadCount
    ) {
      throw validationError(
        "The attachment count does not match the manifest.",
      );
    }

    let actualTotal = 0;
    for (let index = 0; index < metadata.length; index += 1) {
      const attachment = metadata[index];
      const payload = payloadSizes[index];
      validateAttachmentMetadata(attachment, limits);
      if (payload.attachment_id !== attachment.id) {
        throw validationError(
          "Backup payload IDs do not exactly match attachment metadata.",
        );
      }
      requireNonnegativeSafeInteger(payload.byte_size, "attachment byte size");
      requireNonnegativeSafeInteger(
        payload.modified_at,
        "attachment modification time",
      );
      if (
        payload.byte_size > limits.maximumAttachmentBytes ||
        payload.content_length !== payload.byte_size ||
        attachment.byte_size !== payload.byte_size ||
        attachment.modified_at !== payload.modified_at
      ) {
        throw validationError(
          "An attachment payload size or metadata is invalid.",
        );
      }
      actualTotal = safeTotal(
        actualTotal,
        payload.byte_size,
        limits.maximumTotalAttachmentBytes,
      );
    }
    if (actualTotal !== row.total_bytes) {
      throw validationError(
        "The total attachment bytes do not match the manifest.",
      );
    }

    const payloadStatement = database.prepare(
      `SELECT attachment_id, byte_size, modified_at, sha256, content
       FROM _on_track_bundle_files
       ORDER BY attachment_id`,
    );
    let payloadIndex = 0;
    for (const payload of payloadStatement.iterate() as Iterable<BundlePayloadRow>) {
      const metadataRow = metadata[payloadIndex];
      if (
        !Buffer.isBuffer(payload.content) ||
        payload.content.length !== payload.byte_size ||
        sha256(payload.content) !== payload.sha256.toLowerCase()
      ) {
        throw validationError(
          `The SHA-256 value for attachment ${metadataRow.id} is invalid.`,
        );
      }
      payloadIndex += 1;
    }

    return {
      formatVersion: row.format_version,
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
      attachmentCount: row.attachment_count,
      totalBytes: row.total_bytes,
    };
  } catch (error) {
    throw asValidationError(error);
  } finally {
    database.close();
  }
}

export function prepareSqliteBackupBundle(
  options: PrepareSqliteBackupBundleOptions,
): PreparedSqliteBackupBundle {
  const limits = resolveLimits(options.limits);
  const workspace = validatePreparationWorkspace(options.workspace);
  const restoreId = workspace.restoreId;
  const restoreDirectory = workspace.stagingDirectory;
  const candidateDatabasePath = workspace.candidateDatabasePath;
  const attachmentNamespace = workspace.attachmentNamespace;

  let candidate: Database.Database | undefined;
  try {
    validateSqliteBackupBundle(options.bundlePath, limits);
    copyFileSync(
      options.bundlePath,
      candidateDatabasePath,
      constants.COPYFILE_EXCL,
    );
    chmodSync(candidateDatabasePath, 0o600);
    const copiedManifest = validateSqliteBackupBundle(
      candidateDatabasePath,
      limits,
    );
    candidate = new Database(candidateDatabasePath);
    candidate.pragma("foreign_keys = ON");
    candidate.pragma("journal_mode = DELETE");
    const store = new ManagedAttachmentStore(workspace.candidateDataDirectory, {
      namespaceFactory: () => attachmentNamespace,
      maximumReadableBytes: limits.maximumAttachmentBytes,
    });

    const attachmentStatement = candidate.prepare(
      `SELECT a.id, a.filename, f.byte_size, f.modified_at, f.content
       FROM note_attachments AS a
       JOIN _on_track_bundle_files AS f ON f.attachment_id = a.id
       ORDER BY a.id`,
    );
    type RestoredAttachmentRow = {
      id: string;
      filename: string;
      byte_size: number;
      modified_at: number;
      content: Buffer;
    };
    const update = candidate.prepare(
      `UPDATE note_attachments
       SET storage_path = ?, byte_size = ?, modified_at = ?
       WHERE id = ?`,
    );
    const restoredMetadata: Array<{
      id: string;
      storagePath: string;
      byteSize: number;
      modifiedAt: number;
    }> = [];
    for (const attachment of attachmentStatement.iterate() as Iterable<RestoredAttachmentRow>) {
      const created = store.create({
        attachmentId: attachment.id,
        filename: attachment.filename,
        content: attachment.content,
      });
      const absolutePath = store.resolveAvailablePath(created.storagePath);
      const modifiedAt = new Date(attachment.modified_at);
      utimesSync(absolutePath, modifiedAt, modifiedAt);
      const observed = store.observe(created.storagePath);
      if (
        observed.status !== "available" ||
        observed.byteSize === undefined ||
        observed.modifiedAt === undefined
      ) {
        throw validationError("A restored attachment became unavailable.");
      }
      restoredMetadata.push({
        id: attachment.id,
        storagePath: created.storagePath,
        byteSize: observed.byteSize,
        modifiedAt: observed.modifiedAt,
      });
    }
    const rewriteMetadata = candidate.transaction(() => {
      for (const restored of restoredMetadata) {
        update.run(
          restored.storagePath,
          restored.byteSize,
          restored.modifiedAt,
          restored.id,
        );
      }
    });
    rewriteMetadata();

    candidate.exec(`
      DROP TABLE _on_track_bundle_files;
      DROP TABLE _on_track_bundle;
    `);
    candidate.pragma("application_id = 0");
    candidate.exec("VACUUM");
    candidate.close();
    candidate = undefined;
    validatePreparedSqliteBackupDatabase(candidateDatabasePath);
    validatePreparedSqliteBackupRestore(
      candidateDatabasePath,
      workspace.candidateDataDirectory,
      workspace.installedNamespaceRelativePath,
    );

    return {
      restoreId,
      attachmentNamespace,
      restoreDirectory,
      candidateDatabasePath,
      candidateDataDirectory: workspace.candidateDataDirectory,
      stagedNamespacePath: workspace.stagedNamespacePath,
      installedNamespaceRelativePath: workspace.installedNamespaceRelativePath,
      manifest: copiedManifest,
    };
  } catch (error) {
    if (candidate?.open) candidate.close();
    chmodSync(restoreDirectory, 0o700);
    rmSync(restoreDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function validatePreparedSqliteBackupDatabase(
  databasePath: string,
): void {
  validateSqliteFileEnvelope(
    databasePath,
    DEFAULT_SQLITE_BACKUP_BUNDLE_LIMITS.maximumBundleBytes,
  );
  const database = openReadOnlyDatabase(databasePath);
  try {
    if (database.pragma("application_id", { simple: true }) !== 0) {
      throw validationError("A prepared database retains the bundle identity.");
    }
    validateIntegrity(database);
    validateExactSchema(
      database,
      ACTIVE_SCHEMA_OBJECTS,
      ACTIVE_TABLE_COLUMNS,
      ACTIVE_FOREIGN_KEYS,
      ACTIVE_INDEXES,
      ACTIVE_TABLE_DEFINITIONS,
    );
    validateSchemaVersion(database);
    validateApplicationData(database, DEFAULT_SQLITE_BACKUP_BUNDLE_LIMITS);
  } catch (error) {
    throw asValidationError(error);
  } finally {
    database.close();
  }
}

export function validatePreparedSqliteBackupRestore(
  databasePath: string,
  dataDirectory: string,
  installedNamespaceRelativePath: string,
): void {
  validatePreparedSqliteBackupDatabase(databasePath);
  requireAbsolutePath(dataDirectory, "prepared attachment data directory");
  if (
    !/^attachments\/v1\/restore-[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(
      installedNamespaceRelativePath,
    )
  ) {
    throw validationError("The prepared attachment namespace is invalid.");
  }

  const store = new ManagedAttachmentStore(dataDirectory);
  const database = openReadOnlyDatabase(databasePath);
  try {
    const rows = database
      .prepare(
        `SELECT storage_path, byte_size, modified_at
         FROM note_attachments
         ORDER BY storage_path`,
      )
      .all() as Array<{
      storage_path: string;
      byte_size: number;
      modified_at: number;
    }>;
    const expectedPaths: string[] = [];
    for (const row of rows) {
      if (!row.storage_path.startsWith(`${installedNamespaceRelativePath}/`)) {
        throw validationError(
          "The prepared attachment inventory uses an unexpected namespace.",
        );
      }
      const observed = store.observe(row.storage_path);
      if (
        observed.status !== "available" ||
        observed.byteSize !== row.byte_size ||
        observed.modifiedAt !== row.modified_at
      ) {
        throw validationError(
          "The prepared attachment inventory does not match its metadata.",
        );
      }
      expectedPaths.push(store.resolveAvailablePath(row.storage_path));
    }

    const namespacePath = join(
      dataDirectory,
      ...installedNamespaceRelativePath.split("/"),
    );
    const actualPaths = listManagedNamespaceFiles(namespacePath);
    if (
      JSON.stringify(actualPaths.sort()) !==
      JSON.stringify(expectedPaths.sort())
    ) {
      throw validationError(
        "The prepared attachment inventory contains missing or extra files.",
      );
    }
  } catch (error) {
    throw asValidationError(error);
  } finally {
    database.close();
  }
}

export function validateRecoverableSqliteBackupDatabase(
  databasePath: string,
  dataDirectory: string,
): void {
  validatePreparedSqliteBackupDatabase(databasePath);
  requireAbsolutePath(dataDirectory, "managed attachment data directory");
  const store = new ManagedAttachmentStore(dataDirectory);
  const database = openReadOnlyDatabase(databasePath);
  try {
    const storagePaths = database
      .prepare(
        "SELECT storage_path FROM note_attachments ORDER BY storage_path",
      )
      .pluck()
      .all() as string[];
    for (const storagePath of storagePaths) {
      const observation = store.observe(storagePath);
      if (observation.status === "unsafe") {
        throw validationError(
          "The committed database contains an unsafe attachment path.",
        );
      }
    }
  } catch (error) {
    throw asValidationError(error);
  } finally {
    database.close();
  }
}

function validateActiveDatabase(
  database: Database.Database,
  limits: SqliteBackupBundleLimits,
): void {
  validateIntegrity(database);
  validateExactSchema(
    database,
    ACTIVE_SCHEMA_OBJECTS,
    ACTIVE_TABLE_COLUMNS,
    ACTIVE_FOREIGN_KEYS,
    ACTIVE_INDEXES,
    ACTIVE_TABLE_DEFINITIONS,
  );
  validateSchemaVersion(database);
  validateApplicationData(database, limits);
}

function validateApplicationData(
  database: Database.Database,
  limits: SqliteBackupBundleLimits,
): void {
  const chats = database
    .prepare("SELECT id, title, accent, created_at, updated_at FROM chats")
    .all() as Array<{
    id: unknown;
    title: unknown;
    accent: unknown;
    created_at: unknown;
    updated_at: unknown;
  }>;
  for (const chat of chats) {
    if (
      typeof chat.id !== "string" ||
      !GENERATED_COMPONENT.test(chat.id) ||
      typeof chat.title !== "string" ||
      chat.title !== chat.title.trim() ||
      chat.title.length < 1 ||
      chat.title.length > 80 ||
      typeof chat.accent !== "string" ||
      !ALLOWED_ACCENTS.has(chat.accent)
    ) {
      throw validationError("Project metadata is invalid.");
    }
    requireNonnegativeSafeInteger(chat.created_at, "project creation time");
    requireNonnegativeSafeInteger(chat.updated_at, "project update time");
  }

  const notes = database
    .prepare("SELECT id, chat_id, body, created_at FROM notes")
    .all() as Array<{
    id: unknown;
    chat_id: unknown;
    body: unknown;
    created_at: unknown;
  }>;
  const noteIdsWithAttachments = new Set(
    database
      .prepare("SELECT DISTINCT note_id FROM note_attachments")
      .pluck()
      .all() as string[],
  );
  for (const note of notes) {
    if (
      typeof note.id !== "string" ||
      !GENERATED_COMPONENT.test(note.id) ||
      typeof note.chat_id !== "string" ||
      !GENERATED_COMPONENT.test(note.chat_id) ||
      typeof note.body !== "string"
    ) {
      throw validationError("Message metadata is invalid.");
    }
    if (
      note.body !== note.body.trim() ||
      note.body.length > 10_000 ||
      (note.body.length === 0 && !noteIdsWithAttachments.has(note.id))
    ) {
      throw validationError("Message metadata is invalid.");
    }
    requireNonnegativeSafeInteger(note.created_at, "message creation time");
  }

  const attachments = database
    .prepare(
      `SELECT id, note_id, filename, media_type, storage_path,
              byte_size, modified_at, created_at
       FROM note_attachments`,
    )
    .all() as AttachmentMetadataRow[];
  for (const attachment of attachments) {
    validateAttachmentMetadata(attachment, limits);
  }
  const overfullNote = database
    .prepare(
      `SELECT note_id
       FROM note_attachments
       GROUP BY note_id
       HAVING count(*) > ?
       LIMIT 1`,
    )
    .pluck()
    .get(MAX_ATTACHMENTS_PER_MESSAGE);
  if (overfullNote !== undefined) {
    throw validationError(
      "A message exceeds the attachments per message limit.",
    );
  }
}

function validateSchemaVersion(database: Database.Database): void {
  const rows = database
    .prepare("SELECT id, schema_version FROM app_metadata")
    .all() as Array<{ id: number; schema_version: number }>;
  if (
    rows.length !== 1 ||
    rows[0].id !== 1 ||
    rows[0].schema_version !== SQL_ON_TRACK_BACKUP_SCHEMA_VERSION
  ) {
    throw validationError("The database schema version is unsupported.");
  }
}

function validateIntegrity(database: Database.Database): void {
  const integrityRows = database.pragma("integrity_check") as Array<{
    integrity_check: string;
  }>;
  if (integrityRows.length !== 1 || integrityRows[0].integrity_check !== "ok") {
    throw validationError("The SQLite integrity check failed.");
  }
  if ((database.pragma("foreign_key_check") as unknown[]).length !== 0) {
    throw validationError("The SQLite foreign-key check failed.");
  }
}

function validateExactSchema(
  database: Database.Database,
  allowedObjects: readonly string[],
  allowedColumns: Readonly<Record<string, ColumnDescription[]>>,
  allowedForeignKeys: Readonly<Record<string, ForeignKeyDescription[]>>,
  allowedIndexes: Readonly<Record<string, IndexDescription[]>>,
  allowedDefinitions: Readonly<Record<string, string>>,
): void {
  const objects = database
    .prepare(
      `SELECT name || ':' || type
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .pluck()
    .all() as string[];
  const expectedObjects = [...allowedObjects].sort();
  if (JSON.stringify(objects) !== JSON.stringify(expectedObjects)) {
    throw validationError("The SQLite schema objects are not exactly allowed.");
  }

  for (const [table, expected] of Object.entries(allowedColumns)) {
    const columns = (
      database
        .prepare("SELECT * FROM pragma_table_xinfo(?) ORDER BY cid")
        .all(table) as Array<ColumnDescription & { cid: number }>
    ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
    if (JSON.stringify(columns) !== JSON.stringify(expected)) {
      throw validationError(`The columns for table ${table} are not allowed.`);
    }

    const foreignKeys = (
      database
        .prepare("SELECT * FROM pragma_foreign_key_list(?) ORDER BY id, seq")
        .all(table) as Array<{
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
        match: string;
      }>
    ).map((row) => ({
      table: row.table,
      from: row.from,
      to: row.to,
      onUpdate: row.on_update,
      onDelete: row.on_delete,
      match: row.match,
    }));
    if (
      JSON.stringify(foreignKeys) !==
      JSON.stringify(allowedForeignKeys[table] ?? [])
    ) {
      throw validationError(
        `The foreign keys for table ${table} are not allowed.`,
      );
    }

    const indexes = (
      database
        .prepare(
          "SELECT name, [unique], origin FROM pragma_index_list(?) ORDER BY name",
        )
        .all(table) as Array<{ name: string; unique: number; origin: string }>
    ).map((row) => ({
      name: row.name,
      unique: row.unique,
      origin: row.origin,
      columns: database
        .prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
        .pluck()
        .all(row.name) as string[],
    }));
    if (
      JSON.stringify(indexes) !== JSON.stringify(allowedIndexes[table] ?? [])
    ) {
      throw validationError(`The indexes for table ${table} are not allowed.`);
    }

    const tableSql = database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
      )
      .pluck()
      .get(table) as string;
    if (
      normalizeSchemaSql(tableSql) !==
      normalizeSchemaSql(allowedDefinitions[table] ?? "")
    ) {
      throw validationError(
        `The definition for table ${table} is not allowed.`,
      );
    }
  }
}

function openReadOnlyDatabase(path: string): Database.Database {
  let database: Database.Database | undefined;
  try {
    database = new Database(path, { readonly: true, fileMustExist: true });
    database.pragma("trusted_schema = OFF");
    database.pragma("query_only = ON");
    if (database.pragma("trusted_schema", { simple: true }) !== 0) {
      throw validationError("SQLite trusted-schema protection is unavailable.");
    }
    if (database.pragma("query_only", { simple: true }) !== 1) {
      throw validationError("SQLite read-only validation is unavailable.");
    }
    return database;
  } catch (error) {
    if (database?.open) database.close();
    throw asValidationError(error);
  }
}

function validateSqliteFileEnvelope(path: string, maximumBytes: number): void {
  requireAbsolutePath(path, "backup bundle");
  let descriptor: number | undefined;
  try {
    const file = lstatSync(path);
    if (file.isSymbolicLink() || !file.isFile()) {
      throw validationError("The backup bundle must be a regular file.");
    }
    if (file.size <= SQLITE_MAGIC.length || file.size > maximumBytes) {
      throw validationError(
        "The backup bundle size exceeds the allowed limit.",
      );
    }
    descriptor = openSync(path, constants.O_RDONLY);
    const magic = Buffer.alloc(SQLITE_MAGIC.length);
    if (
      readSync(descriptor, magic, 0, magic.length, 0) !== magic.length ||
      !magic.equals(SQLITE_MAGIC)
    ) {
      throw validationError(
        "The backup does not have the SQLite file signature.",
      );
    }
  } catch (error) {
    throw asValidationError(error);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateAttachmentMetadata(
  row: AttachmentMetadataRow,
  limits: SqliteBackupBundleLimits,
): void {
  if (
    typeof row.id !== "string" ||
    !GENERATED_COMPONENT.test(row.id) ||
    typeof row.note_id !== "string" ||
    !GENERATED_COMPONENT.test(row.note_id)
  ) {
    throw validationError("An attachment ID is invalid.");
  }
  if (
    typeof row.filename !== "string" ||
    !isCanonicalAttachmentFilename(row.filename) ||
    typeof row.media_type !== "string" ||
    !isCanonicalAttachmentMediaType(row.media_type) ||
    typeof row.storage_path !== "string" ||
    row.storage_path.length < 1 ||
    row.storage_path.length > 1024
  ) {
    throw validationError("Attachment metadata is invalid.");
  }
  requireNonnegativeSafeInteger(row.byte_size, "attachment byte size");
  requireNonnegativeSafeInteger(
    row.modified_at,
    "attachment modification time",
  );
  requireNonnegativeSafeInteger(row.created_at, "attachment creation time");
  if (row.byte_size > limits.maximumAttachmentBytes) {
    throw validationError("An attachment exceeds the per-file limit.");
  }
}

function validateAttachmentRead(
  read: ManagedAttachmentRead,
  limits: SqliteBackupBundleLimits,
): void {
  requireNonnegativeSafeInteger(read.byteSize, "attachment byte size");
  requireNonnegativeSafeInteger(
    read.modifiedAt,
    "attachment modification time",
  );
  if (
    !Buffer.isBuffer(read.content) ||
    read.content.length !== read.byteSize ||
    read.byteSize > limits.maximumAttachmentBytes
  ) {
    throw validationError("A managed attachment read is invalid or too large.");
  }
}

function readManagedAttachmentWithRetries(
  store: Pick<ManagedAttachmentStore, "read">,
  storagePath: string,
  maximumRetries: number,
): ManagedAttachmentRead {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return store.read(storagePath);
    } catch (error) {
      if (
        !(error instanceof ManagedAttachmentChangedError) ||
        attempt >= maximumRetries
      ) {
        throw error;
      }
    }
  }
}

function resolveLimits(
  overrides?: Partial<SqliteBackupBundleLimits>,
): SqliteBackupBundleLimits {
  const limits = { ...DEFAULT_SQLITE_BACKUP_BUNDLE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`The SQLite backup limit ${name} is invalid.`);
    }
  }
  if (limits.maximumBundleBytes < SQLITE_MAGIC.length + 1) {
    throw new TypeError("The SQLite backup limits are inconsistent.");
  }
  return limits;
}

function safeTotal(current: number, addition: number, maximum: number): number {
  const total = current + addition;
  if (!Number.isSafeInteger(total) || total > maximum) {
    throw validationError(
      "The total attachment bytes exceed the bundle limit.",
    );
  }
  return total;
}

function requireNonnegativeSafeInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw validationError(`The ${label} is invalid.`);
  }
}

function requireGeneratedComponent(value: string, label: string): string {
  if (!GENERATED_COMPONENT.test(value)) {
    throw new TypeError(`The generated ${label} is invalid.`);
  }
  return value;
}

function validatePreparationWorkspace(
  workspace: SqliteBackupPreparationWorkspace,
): SqliteBackupPreparationWorkspace {
  requireGeneratedComponent(workspace.restoreId, "restore ID");
  requireGeneratedComponent(
    workspace.attachmentNamespace,
    "attachment namespace",
  );
  requireAbsolutePath(workspace.stagingDirectory, "restore staging directory");
  const expectedCandidate = join(
    workspace.stagingDirectory,
    "candidate.sqlite",
  );
  const expectedCandidateData = join(workspace.stagingDirectory, "data");
  const expectedAttachmentNamespace = `restore-${workspace.restoreId}`;
  const expectedStagedNamespace = join(
    expectedCandidateData,
    "attachments",
    "v1",
    expectedAttachmentNamespace,
  );
  const expectedInstalledNamespace = posix.join(
    "attachments",
    "v1",
    expectedAttachmentNamespace,
  );
  if (
    workspace.candidateDatabasePath !== expectedCandidate ||
    workspace.candidateDataDirectory !== expectedCandidateData ||
    workspace.attachmentNamespace !== expectedAttachmentNamespace ||
    workspace.stagedNamespacePath !== expectedStagedNamespace ||
    workspace.installedNamespaceRelativePath !== expectedInstalledNamespace
  ) {
    throw new TypeError("The restore workspace paths are inconsistent.");
  }
  for (const [path, label] of [
    [workspace.stagingDirectory, "restore staging directory"],
    [workspace.candidateDataDirectory, "candidate data directory"],
    [workspace.stagedNamespacePath, "staged attachment namespace"],
  ] as const) {
    const metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError(`The ${label} is unsafe.`);
    }
  }
  const canonicalStagingDirectory = realpathSync(workspace.stagingDirectory);
  if (
    realpathSync(workspace.candidateDataDirectory) !==
      join(canonicalStagingDirectory, "data") ||
    realpathSync(workspace.stagedNamespacePath) !==
      join(
        canonicalStagingDirectory,
        "data",
        "attachments",
        "v1",
        expectedAttachmentNamespace,
      )
  ) {
    throw new TypeError(
      "The restore workspace resolves outside its known paths.",
    );
  }
  if (
    existsSync(workspace.candidateDatabasePath) ||
    readdirSync(workspace.stagedNamespacePath).length !== 0
  ) {
    throw new TypeError("The restore workspace is not fresh.");
  }
  return workspace;
}

function foreignKey(
  table: string,
  from: string,
  to: string,
  onDelete: string,
): ForeignKeyDescription {
  return {
    table,
    from,
    to,
    onUpdate: "NO ACTION",
    onDelete,
    match: "NONE",
  };
}

function index(
  name: string,
  unique: number,
  origin: string,
  columns: string[],
): IndexDescription {
  return { name, unique, origin, columns };
}

function normalizeSchemaSql(sql: string): string {
  return sql
    .toLowerCase()
    .replace(/["`[\]\s;]/g, "")
    .replace(/\b(?:app_metadata|chats|notes|note_attachments)\./g, "")
    .replace(/constraint[a-z0-9_]+/g, "");
}

function listManagedNamespaceFiles(namespacePath: string): string[] {
  const root = lstatSync(namespacePath);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw validationError("The prepared attachment namespace is unsafe.");
  }
  const files: string[] = [];
  for (const attachmentEntry of readdirSync(namespacePath, {
    withFileTypes: true,
  })) {
    const attachmentDirectory = join(namespacePath, attachmentEntry.name);
    const attachmentStat = lstatSync(attachmentDirectory);
    if (
      attachmentEntry.isSymbolicLink() ||
      !attachmentEntry.isDirectory() ||
      !attachmentStat.isDirectory() ||
      attachmentStat.isSymbolicLink()
    ) {
      throw validationError("The prepared attachment inventory is unsafe.");
    }
    for (const fileEntry of readdirSync(attachmentDirectory, {
      withFileTypes: true,
    })) {
      const filePath = join(attachmentDirectory, fileEntry.name);
      const fileStat = lstatSync(filePath);
      if (
        fileEntry.isSymbolicLink() ||
        !fileEntry.isFile() ||
        !fileStat.isFile() ||
        fileStat.isSymbolicLink()
      ) {
        throw validationError("The prepared attachment inventory is unsafe.");
      }
      files.push(realpathSync(filePath));
    }
  }
  return files;
}

function directoryEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isFileError(error, "ENOENT")) return false;
    throw error;
  }
}

function assertPrivateDestinationDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The backup bundle destination directory is unsafe.");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("The backup bundle destination directory is not private.");
  }
  const canonical = realpathSync(path);
  const parent = realpathSync(dirname(path));
  const fromParent = relative(parent, canonical);
  if (!fromParent || fromParent === ".." || fromParent.startsWith(`..${sep}`)) {
    throw new Error("The backup bundle destination directory is unsafe.");
  }
}

function requireAbsolutePath(path: string, label: string): void {
  if (!isAbsolute(path))
    throw new TypeError(`The ${label} path must be absolute.`);
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function removeDatabaseFiles(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      unlinkSync(candidate);
    } catch (error) {
      if (!isFileError(error, "ENOENT")) throw error;
    }
  }
}

function isFileError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function validationError(message: string): SqliteBackupBundleValidationError {
  return new SqliteBackupBundleValidationError(message);
}

function asValidationError(error: unknown): SqliteBackupBundleValidationError {
  if (error instanceof SqliteBackupBundleValidationError) return error;
  return validationError("The SQLite backup bundle is invalid or unreadable.");
}
