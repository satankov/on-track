import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ManagedAttachmentChangedError,
  ManagedAttachmentUnavailableError,
} from "../attachments/managed-attachment-store.js";
import {
  DEFAULT_SQLITE_BACKUP_BUNDLE_LIMITS,
  SQL_ON_TRACK_BACKUP_APPLICATION_ID,
  SqliteBackupBundleValidationError,
  createSqliteBackupBundle,
  prepareSqliteBackupBundle,
  validatePreparedSqliteBackupDatabase,
  validatePreparedSqliteBackupRestore,
  validateSqliteBackupBundle,
} from "./sqlite-backup-bundle.js";
import { ManagedRestoreCoordinator } from "./restore-journal.js";

describe("SQLite backup bundle", () => {
  let directory: string;
  let sourcePath: string;
  let sourceDatabase: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "on-track-bundle-"));
    sourcePath = join(directory, "source.sqlite");
    sourceDatabase = createMetadataOnlySchemaV3Database(sourcePath);
  });

  afterEach(() => {
    if (sourceDatabase.open) sourceDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates one self-validating bundle from snapshot metadata and managed bytes", async () => {
    insertAttachment(sourceDatabase, {
      id: "attachment-a",
      filename: "roadmap.pptx",
      storagePath: "attachments/v1/source-namespace/attachment-a/roadmap.pptx",
      byteSize: 1,
      modifiedAt: 1,
    });
    const read = vi.fn(() => ({
      content: Buffer.from("presentation"),
      byteSize: 12,
      modifiedAt: 1_725_000_000_123,
    }));
    const bundlePath = join(directory, "backup.on-track-backup");

    const manifest = await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: bundlePath,
      attachmentStore: { read },
      createdAt: () => 1_725_000_100_000,
    });

    expect(read).toHaveBeenCalledWith(
      "attachments/v1/source-namespace/attachment-a/roadmap.pptx",
    );
    expect(manifest).toEqual({
      formatVersion: 1,
      schemaVersion: 3,
      createdAt: 1_725_000_100_000,
      attachmentCount: 1,
      totalBytes: 12,
    });
    expect(validateSqliteBackupBundle(bundlePath)).toEqual(manifest);

    const bundle = new Database(bundlePath, { readonly: true });
    try {
      expect(bundle.pragma("application_id", { simple: true })).toBe(
        SQL_ON_TRACK_BACKUP_APPLICATION_ID,
      );
      expect(
        bundle
          .prepare(
            "SELECT storage_path, byte_size, modified_at FROM note_attachments WHERE id = ?",
          )
          .get("attachment-a"),
      ).toEqual({
        storage_path:
          "attachments/v1/source-namespace/attachment-a/roadmap.pptx",
        byte_size: 12,
        modified_at: 1_725_000_000_123,
      });
      expect(
        bundle
          .prepare(
            "SELECT attachment_id, byte_size, length(sha256) AS hash_length, content FROM _on_track_bundle_files",
          )
          .get(),
      ).toEqual({
        attachment_id: "attachment-a",
        byte_size: 12,
        hash_length: 64,
        content: Buffer.from("presentation"),
      });
    } finally {
      bundle.close();
    }
  });

  it("retries only a bounded number of concurrent attachment changes", async () => {
    insertAttachment(sourceDatabase, {
      id: "attachment-a",
      filename: "roadmap.pptx",
      storagePath: "attachments/v1/source/a/roadmap.pptx",
      byteSize: 4,
      modifiedAt: 100,
    });
    const changedThenStable = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new ManagedAttachmentChangedError();
      })
      .mockReturnValue({
        content: Buffer.from("stable"),
        byteSize: 6,
        modifiedAt: 200,
      });

    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: join(directory, "retry.on-track-backup"),
      attachmentStore: { read: changedThenStable },
      limits: { maximumChangedReadRetries: 1 },
    });
    expect(changedThenStable).toHaveBeenCalledTimes(2);

    const alwaysChanging = vi.fn(() => {
      throw new ManagedAttachmentChangedError();
    });
    const failedPath = join(directory, "changing.on-track-backup");
    await expect(
      createSqliteBackupBundle({
        sourceDatabase,
        destinationPath: failedPath,
        attachmentStore: { read: alwaysChanging },
        limits: { maximumChangedReadRetries: 2 },
      }),
    ).rejects.toBeInstanceOf(ManagedAttachmentChangedError);
    expect(alwaysChanging).toHaveBeenCalledTimes(3);
    expect(existsSync(failedPath)).toBe(false);
    expect(existsSync(`${failedPath}-wal`)).toBe(false);
  });

  it("fails without retry and cleans up when a managed file is broken", async () => {
    insertAttachment(sourceDatabase, {
      id: "attachment-a",
      filename: "roadmap.pptx",
      storagePath: "attachments/v1/source/a/roadmap.pptx",
      byteSize: 4,
      modifiedAt: 100,
    });
    const read = vi.fn(() => {
      throw new ManagedAttachmentUnavailableError(
        "missing",
        "attachments/v1/source/a/roadmap.pptx",
      );
    });
    const failedPath = join(directory, "broken.on-track-backup");

    await expect(
      createSqliteBackupBundle({
        sourceDatabase,
        destinationPath: failedPath,
        attachmentStore: { read },
      }),
    ).rejects.toBeInstanceOf(ManagedAttachmentUnavailableError);
    expect(read).toHaveBeenCalledTimes(1);
    expect(existsSync(failedPath)).toBe(false);
  });

  it("rejects raw SQLite, schema additions, payload tampering, and declared limit violations", async () => {
    const rawPath = join(directory, "raw.sqlite");
    await sourceDatabase.backup(rawPath);
    expect(() => validateSqliteBackupBundle(rawPath)).toThrow(
      SqliteBackupBundleValidationError,
    );

    insertAttachment(sourceDatabase, {
      id: "attachment-a",
      filename: "deck.pptx",
      storagePath: "attachments/v1/source/a/deck.pptx",
      byteSize: 4,
      modifiedAt: 100,
    });
    const originalPath = join(directory, "original.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: originalPath,
      attachmentStore: {
        read: () => ({
          content: Buffer.from("deck"),
          byteSize: 4,
          modifiedAt: 100,
        }),
      },
    });

    const extraSchemaPath = copyBundle(originalPath, directory, "extra");
    mutateBundle(extraSchemaPath, (database) =>
      database.exec("CREATE TABLE attacker_controlled (value TEXT)"),
    );
    expect(() => validateSqliteBackupBundle(extraSchemaPath)).toThrow(
      /schema objects/i,
    );

    const extraColumnPath = copyBundle(originalPath, directory, "column");
    mutateBundle(extraColumnPath, (database) =>
      database.exec("ALTER TABLE notes ADD COLUMN attacker_controlled TEXT"),
    );
    expect(() => validateSqliteBackupBundle(extraColumnPath)).toThrow(
      /columns.*notes/i,
    );

    const missingPayloadPath = copyBundle(originalPath, directory, "missing");
    mutateBundle(missingPayloadPath, (database) =>
      database.exec("DELETE FROM _on_track_bundle_files"),
    );
    expect(() => validateSqliteBackupBundle(missingPayloadPath)).toThrow(
      /attachment count/i,
    );

    const understatedCountPath = copyBundle(
      originalPath,
      directory,
      "understated-count",
    );
    mutateBundle(understatedCountPath, (database) =>
      database.exec(
        "UPDATE _on_track_bundle SET attachment_count = 0, total_bytes = 0",
      ),
    );
    expect(() =>
      validateSqliteBackupBundle(understatedCountPath, {
        maximumAttachmentCount: 0,
        maximumTotalAttachmentBytes: 0,
      }),
    ).toThrow(/attachment count/i);

    const tamperedPath = copyBundle(originalPath, directory, "tampered");
    mutateBundle(tamperedPath, (database) =>
      database
        .prepare("UPDATE _on_track_bundle_files SET content = ?, byte_size = ?")
        .run(Buffer.from("evil"), 4),
    );
    expect(() => validateSqliteBackupBundle(tamperedPath)).toThrow(/SHA-256/i);

    expect(() =>
      validateSqliteBackupBundle(originalPath, {
        maximumAttachmentCount: 0,
      }),
    ).toThrow(/attachment count/i);
    expect(() =>
      validateSqliteBackupBundle(originalPath, {
        maximumTotalAttachmentBytes: 3,
      }),
    ).toThrow(/total attachment bytes/i);
    expect(() =>
      validateSqliteBackupBundle(originalPath, {
        maximumBundleBytes: 100,
      }),
    ).toThrow(/bundle size/i);
  });

  it("rejects unsafe envelopes, destinations, and invalid limit configuration", async () => {
    const notSqlite = join(directory, "not-sqlite.on-track-backup");
    writeFileSync(notSqlite, Buffer.alloc(128, 1));
    expect(() => validateSqliteBackupBundle(notSqlite)).toThrow(
      /SQLite file signature/i,
    );
    expect(() =>
      validateSqliteBackupBundle("relative.on-track-backup"),
    ).toThrow(/absolute/i);
    expect(() =>
      validateSqliteBackupBundle(notSqlite, {
        maximumChangedReadRetries: -1,
      }),
    ).toThrow(/limit/i);

    const existingDestination = join(directory, "existing.on-track-backup");
    writeFileSync(existingDestination, "occupied");
    await expect(
      createSqliteBackupBundle({
        sourceDatabase,
        destinationPath: existingDestination,
        attachmentStore: {
          read: () => {
            throw new Error("unexpected read");
          },
        },
      }),
    ).rejects.toThrow(/already exists/i);
    expect(readFileSync(existingDestination, "utf8")).toBe("occupied");
  });

  it.runIf(process.platform !== "win32")(
    "does not follow a dangling bundle destination symlink",
    async () => {
      const redirectedPath = join(directory, "redirected.sqlite");
      const bundlePath = join(directory, "dangling.on-track-backup");
      symlinkSync(redirectedPath, bundlePath);

      await expect(
        createSqliteBackupBundle({
          sourceDatabase,
          destinationPath: bundlePath,
          attachmentStore: {
            read: () => {
              throw new Error("an empty snapshot must not read attachments");
            },
          },
        }),
      ).rejects.toThrow(/destination/i);
      expect(existsSync(redirectedPath)).toBe(false);
      expect(existsSync(bundlePath)).toBe(false);
      expect(() => unlinkSync(bundlePath)).not.toThrow();
    },
  );

  it.each([
    { name: "missing foreign key", schema: { attachmentForeignKey: false } },
    { name: "misdirected index", schema: { attachmentIndexColumns: "id" } },
    { name: "missing checks", schema: { includeChecks: false } },
    { name: "fake default checks", schema: { fakeMetadataChecks: true } },
    { name: "missing path uniqueness", schema: { uniqueStoragePath: false } },
  ])("rejects a lookalike schema with $name", async ({ name, schema }) => {
    const lookalikePath = join(
      directory,
      `${name.replaceAll(" ", "-")}.sqlite`,
    );
    const lookalike = createMetadataOnlySchemaV3Database(lookalikePath, schema);
    try {
      await expect(
        createSqliteBackupBundle({
          sourceDatabase: lookalike,
          destinationPath: join(directory, `${name}.on-track-backup`),
          attachmentStore: {
            read: () => {
              throw new Error("an empty snapshot must not read attachments");
            },
          },
        }),
      ).rejects.toBeInstanceOf(SqliteBackupBundleValidationError);
    } finally {
      lookalike.close();
    }
  });

  it("rejects unsupported manifests, foreign-key damage, and inconsistent managed reads", async () => {
    insertAttachment(sourceDatabase, {
      id: "attachment-a",
      filename: "deck.pptx",
      storagePath: "attachments/v1/source/a/deck.pptx",
      byteSize: 4,
      modifiedAt: 100,
    });
    const countLimitedPath = join(directory, "count-limited.on-track-backup");
    await expect(
      createSqliteBackupBundle({
        sourceDatabase,
        destinationPath: countLimitedPath,
        attachmentStore: {
          read: () => ({
            content: Buffer.from("deck"),
            byteSize: 4,
            modifiedAt: 100,
          }),
        },
        limits: { maximumAttachmentCount: 0 },
      }),
    ).rejects.toThrow(/attachment count/i);
    expect(existsSync(countLimitedPath)).toBe(false);

    const failedPath = join(directory, "inconsistent.on-track-backup");
    await expect(
      createSqliteBackupBundle({
        sourceDatabase,
        destinationPath: failedPath,
        attachmentStore: {
          read: () => ({
            content: Buffer.from("bad"),
            byteSize: 4,
            modifiedAt: 100,
          }),
        },
      }),
    ).rejects.toThrow(/read is invalid/i);
    expect(existsSync(failedPath)).toBe(false);

    const originalPath = join(directory, "valid.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: originalPath,
      attachmentStore: {
        read: () => ({
          content: Buffer.from("deck"),
          byteSize: 4,
          modifiedAt: 100,
        }),
      },
    });
    const unsupported = copyBundle(originalPath, directory, "unsupported");
    mutateBundle(unsupported, (database) =>
      database.exec("UPDATE _on_track_bundle SET format_version = 2"),
    );
    expect(() => validateSqliteBackupBundle(unsupported)).toThrow(
      /version is unsupported/i,
    );

    const invalidTimestamp = copyBundle(
      originalPath,
      directory,
      "invalid-timestamp",
    );
    mutateBundle(invalidTimestamp, (database) =>
      database.exec("UPDATE chats SET created_at = 'not-a-timestamp'"),
    );
    expect(() => validateSqliteBackupBundle(invalidTimestamp)).toThrow(
      /project creation time/i,
    );

    const invalidMediaType = copyBundle(
      originalPath,
      directory,
      "invalid-media-type",
    );
    mutateBundle(invalidMediaType, (database) =>
      database
        .prepare("UPDATE note_attachments SET media_type = ?")
        .run("text/plain\r\nx-injected: value"),
    );
    expect(() => validateSqliteBackupBundle(invalidMediaType)).toThrow(
      /attachment metadata/i,
    );

    const unsafeFilename = copyBundle(
      originalPath,
      directory,
      "unsafe-filename",
    );
    mutateBundle(unsafeFilename, (database) =>
      database
        .prepare("UPDATE note_attachments SET filename = ?")
        .run("../deck.pptx"),
    );
    expect(() => validateSqliteBackupBundle(unsafeFilename)).toThrow(
      /attachment metadata/i,
    );

    const missingManifest = copyBundle(originalPath, directory, "no-manifest");
    mutateBundle(missingManifest, (database) =>
      database.exec("DELETE FROM _on_track_bundle"),
    );
    expect(() => validateSqliteBackupBundle(missingManifest)).toThrow(
      /manifest must contain exactly one row/i,
    );

    const foreignKeyDamage = copyBundle(originalPath, directory, "foreign-key");
    mutateBundle(foreignKeyDamage, (database) => {
      database.pragma("foreign_keys = OFF");
      database.exec(
        "INSERT INTO notes (id, chat_id, body, created_at) VALUES ('orphan', 'missing', '', 1)",
      );
    });
    expect(() => validateSqliteBackupBundle(foreignKeyDamage)).toThrow(
      /foreign-key check/i,
    );
  });

  it("rejects a canonical bundle with more than ten attachments on one note", async () => {
    const bundlePath = join(directory, "too-many.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: bundlePath,
      attachmentStore: {
        read: () => {
          throw new Error("an empty snapshot must not read attachments");
        },
      },
    });
    mutateBundle(bundlePath, (database) => {
      const insertAttachmentRow = database.prepare(
        `INSERT INTO note_attachments
         (id, note_id, filename, media_type, storage_path, byte_size, modified_at, created_at)
         VALUES (?, 'note-a', ?, 'application/octet-stream', ?, 0, 1, 1)`,
      );
      const insertPayload = database.prepare(
        `INSERT INTO _on_track_bundle_files
         (attachment_id, byte_size, modified_at, sha256, content)
         VALUES (?, 0, 1, ?, ?)`,
      );
      const insertRows = database.transaction(() => {
        for (let index = 0; index < 11; index += 1) {
          const id = `attachment-${index}`;
          insertAttachmentRow.run(
            id,
            `file-${index}.txt`,
            `attachments/v1/source/${id}/file-${index}.txt`,
          );
          insertPayload.run(
            id,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            Buffer.alloc(0),
          );
        }
        database.exec(
          "UPDATE _on_track_bundle SET attachment_count = 11, total_bytes = 0",
        );
      });
      insertRows();
    });

    expect(() => validateSqliteBackupBundle(bundlePath)).toThrow(
      /attachments per message/i,
    );
  });

  it("exports and prepares a valid attachment-only message", async () => {
    sourceDatabase.exec("UPDATE notes SET body = '' WHERE id = 'note-a'");
    insertAttachment(sourceDatabase, {
      id: "attachment-only",
      filename: "context.txt",
      storagePath: "attachments/v1/source/attachment-only/context.txt",
      byteSize: 7,
      modifiedAt: 100,
    });
    const bundlePath = join(directory, "attachment-only.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: bundlePath,
      attachmentStore: {
        read: () => ({
          content: Buffer.from("context"),
          byteSize: 7,
          modifiedAt: 100,
        }),
      },
    });
    const workspace = createRestoreWorkspace(directory, "attachment-only");

    const prepared = prepareSqliteBackupBundle({ bundlePath, workspace });

    const candidate = new Database(prepared.candidateDatabasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(
        candidate
          .prepare("SELECT body FROM notes WHERE id = 'note-a'")
          .pluck()
          .get(),
      ).toBe("");
    } finally {
      candidate.close();
    }
  });

  it("rejects an empty message that owns no attachments", async () => {
    sourceDatabase.exec("UPDATE notes SET body = '' WHERE id = 'note-a'");

    await expect(
      createSqliteBackupBundle({
        sourceDatabase,
        destinationPath: join(directory, "empty-message.on-track-backup"),
        attachmentStore: {
          read: () => {
            throw new Error("an empty snapshot must not read attachments");
          },
        },
      }),
    ).rejects.toThrow(/message metadata/i);
  });

  it("prepares a compact metadata-only candidate with generated restore paths", async () => {
    insertAttachment(sourceDatabase, {
      id: "attachment-a",
      filename: "quarterly roadmap.pptx",
      storagePath: "../../attacker-selected/location",
      byteSize: 4,
      modifiedAt: 1_725_000_000_123,
    });
    const bundlePath = join(directory, "restore.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: bundlePath,
      attachmentStore: {
        read: () => ({
          content: Buffer.from("deck"),
          byteSize: 4,
          modifiedAt: 1_725_000_000_123,
        }),
      },
    });
    const workspace = createRestoreWorkspace(directory, "restore-a");

    const prepared = prepareSqliteBackupBundle({
      bundlePath,
      workspace,
    });

    expect(prepared).toMatchObject({
      restoreId: "restore-a",
      attachmentNamespace: "restore-restore-a",
      candidateDatabasePath: workspace.candidateDatabasePath,
      candidateDataDirectory: workspace.candidateDataDirectory,
      stagedNamespacePath: workspace.stagedNamespacePath,
      installedNamespaceRelativePath: "attachments/v1/restore-restore-a",
    });
    expect(
      validatePreparedSqliteBackupDatabase(prepared.candidateDatabasePath),
    ).toBeUndefined();

    const candidate = new Database(prepared.candidateDatabasePath, {
      readonly: true,
    });
    let storagePath: string;
    try {
      storagePath = candidate
        .prepare(
          "SELECT storage_path FROM note_attachments WHERE id = 'attachment-a'",
        )
        .pluck()
        .get() as string;
      expect(storagePath).toBe(
        "attachments/v1/restore-restore-a/attachment-a/quarterly roadmap.pptx",
      );
      expect(
        candidate
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name LIKE '_on_track_bundle%'",
          )
          .all(),
      ).toEqual([]);
      expect(candidate.pragma("application_id", { simple: true })).toBe(0);
      expect(
        candidate
          .prepare(
            "SELECT 1 FROM pragma_table_info('note_attachments') WHERE name = 'content'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      candidate.close();
    }

    expect(
      readFileSync(
        join(
          prepared.stagedNamespacePath,
          "attachment-a",
          "quarterly roadmap.pptx",
        ),
      ),
    ).toEqual(Buffer.from("deck"));
    expect(() =>
      validatePreparedSqliteBackupRestore(
        prepared.candidateDatabasePath,
        prepared.candidateDataDirectory,
        prepared.installedNamespaceRelativePath,
      ),
    ).not.toThrow();

    unlinkSync(
      join(
        prepared.stagedNamespacePath,
        "attachment-a",
        "quarterly roadmap.pptx",
      ),
    );
    expect(() =>
      validatePreparedSqliteBackupRestore(
        prepared.candidateDatabasePath,
        prepared.candidateDataDirectory,
        prepared.installedNamespaceRelativePath,
      ),
    ).toThrow(/inventory/i);
  });

  it("prepares an empty namespace for a bundle without attachments", async () => {
    const bundlePath = join(directory, "empty.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: bundlePath,
      attachmentStore: {
        read: () => {
          throw new Error("an empty snapshot must not read attachments");
        },
      },
    });
    const workspace = createRestoreWorkspace(directory, "restore-empty");

    const prepared = prepareSqliteBackupBundle({ bundlePath, workspace });

    expect(readdirSync(prepared.stagedNamespacePath)).toEqual([]);
    expect(
      validatePreparedSqliteBackupDatabase(prepared.candidateDatabasePath),
    ).toBeUndefined();
  });

  it("preserves current labels and migrates an exact schema-2 bundle with defaults", async () => {
    sourceDatabase.exec(`
      DELETE FROM chat_enabled_labels;
      INSERT INTO chat_enabled_labels (chat_id, label) VALUES
        ('chat-a', 'decision'), ('chat-a', 'risk');
      INSERT INTO note_labels (note_id, label) VALUES
        ('note-a', 'pin'), ('note-a', 'decision');
    `);
    const currentPath = join(directory, "labels.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: currentPath,
      attachmentStore: {
        read: () => {
          throw new Error("no files");
        },
      },
      createdAt: () => 100,
    });
    const currentPrepared = prepareSqliteBackupBundle({
      bundlePath: currentPath,
      workspace: createRestoreWorkspace(directory, "labels-current"),
    });
    const current = new Database(currentPrepared.candidateDatabasePath, {
      readonly: true,
    });
    expect(
      current
        .prepare("SELECT label FROM chat_enabled_labels ORDER BY label")
        .pluck()
        .all(),
    ).toEqual(["decision", "risk"]);
    expect(
      current
        .prepare("SELECT label FROM note_labels ORDER BY label")
        .pluck()
        .all(),
    ).toEqual(["decision", "pin"]);
    current.close();

    const legacyPath = copyBundle(currentPath, directory, "labels-legacy");
    mutateBundle(legacyPath, (legacy) => {
      legacy.exec(`
        DROP TABLE note_labels;
        DROP TABLE chat_enabled_labels;
        UPDATE app_metadata SET schema_version = 2;
        UPDATE _on_track_bundle SET schema_version = 2;
        DELETE FROM __drizzle_migrations WHERE created_at = 1788356400000;
      `);
    });
    expect(validateSqliteBackupBundle(legacyPath).schemaVersion).toBe(2);
    const legacyPrepared = prepareSqliteBackupBundle({
      bundlePath: legacyPath,
      workspace: createRestoreWorkspace(directory, "labels-legacy"),
    });
    const legacy = new Database(legacyPrepared.candidateDatabasePath, {
      readonly: true,
    });
    expect(
      legacy
        .prepare("SELECT label FROM chat_enabled_labels ORDER BY label")
        .pluck()
        .all(),
    ).toEqual(["milestone", "todo"]);
    expect(
      legacy.prepare("SELECT count(*) FROM note_labels").pluck().get(),
    ).toBe(0);
    expect(
      legacy.prepare("SELECT schema_version FROM app_metadata").pluck().get(),
    ).toBe(3);
    legacy.close();
  });

  it("rolls back activation when the installed attachment inventory changes", async () => {
    insertAttachment(sourceDatabase, {
      id: "attachment-a",
      filename: "roadmap.pptx",
      storagePath: "attachments/v1/source/a/roadmap.pptx",
      byteSize: 4,
      modifiedAt: 100,
    });
    const bundlePath = join(directory, "inventory.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: bundlePath,
      attachmentStore: {
        read: () => ({
          content: Buffer.from("deck"),
          byteSize: 4,
          modifiedAt: 100,
        }),
      },
    });

    const liveDataDirectory = join(directory, "live");
    mkdirSync(liveDataDirectory, { mode: 0o700 });
    const liveDatabasePath = join(liveDataDirectory, "on-track.sqlite");
    writeFileSync(liveDatabasePath, "old database", { mode: 0o600 });
    const restoreId = "123e4567-e89b-42d3-a456-426614174000";
    let installedFilePath = "";
    const coordinator = new ManagedRestoreCoordinator({
      dataDirectory: liveDataDirectory,
      databasePath: liveDatabasePath,
      restoreIdFactory: () => restoreId,
      closeDatabase: vi.fn(),
      openDatabase: vi.fn(),
      failpoint: (point) => {
        if (point === "after_candidate_opened") unlinkSync(installedFilePath);
      },
    });
    const workspace = coordinator.createWorkspace();
    const prepared = prepareSqliteBackupBundle({ bundlePath, workspace });
    installedFilePath = join(
      workspace.installedNamespacePath,
      "attachment-a",
      "roadmap.pptx",
    );

    expect(() => coordinator.activate(restoreId)).toThrow(/inventory/i);
    expect(readFileSync(liveDatabasePath, "utf8")).toBe("old database");
    expect(existsSync(workspace.installedNamespacePath)).toBe(false);
    expect(existsSync(prepared.restoreDirectory)).toBe(false);
  });

  it("rejects a preparation workspace whose namespace escapes its staging tree", async () => {
    const bundlePath = join(directory, "workspace.on-track-backup");
    await createSqliteBackupBundle({
      sourceDatabase,
      destinationPath: bundlePath,
      attachmentStore: {
        read: () => {
          throw new Error("an empty snapshot must not read attachments");
        },
      },
    });
    const workspace = createRestoreWorkspace(directory, "restore-a");
    const outside = join(directory, "outside");
    mkdirSync(outside, { mode: 0o700 });

    expect(() =>
      prepareSqliteBackupBundle({
        bundlePath,
        workspace: { ...workspace, stagedNamespacePath: outside },
      }),
    ).toThrow(/workspace paths/i);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(workspace.candidateDatabasePath)).toBe(false);
  });

  it("removes generated preparation state when bundle validation fails", () => {
    const invalidBundlePath = join(directory, "invalid.on-track-backup");
    writeFileSync(invalidBundlePath, "not a backup bundle");
    const workspace = createRestoreWorkspace(directory, "restore-invalid");

    expect(() =>
      prepareSqliteBackupBundle({
        bundlePath: invalidBundlePath,
        workspace,
      }),
    ).toThrow(/SQLite file signature/i);
    expect(existsSync(workspace.stagingDirectory)).toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "removes all generated preparation state if candidate creation fails",
    async () => {
      insertAttachment(sourceDatabase, {
        id: "attachment-a",
        filename: "deck.pptx",
        storagePath: "attachments/v1/source/a/deck.pptx",
        byteSize: 4,
        modifiedAt: 100,
      });
      const bundlePath = join(directory, "failed.on-track-backup");
      await createSqliteBackupBundle({
        sourceDatabase,
        destinationPath: bundlePath,
        attachmentStore: {
          read: () => ({
            content: Buffer.from("deck"),
            byteSize: 4,
            modifiedAt: 100,
          }),
        },
      });
      const workspace = createRestoreWorkspace(directory, "restore-a");
      chmodSync(workspace.stagingDirectory, 0o500);

      expect(() =>
        prepareSqliteBackupBundle({
          bundlePath,
          workspace,
        }),
      ).toThrow();
      expect(existsSync(workspace.stagingDirectory)).toBe(false);
    },
  );

  it("publishes explicit conservative defaults", () => {
    expect(DEFAULT_SQLITE_BACKUP_BUNDLE_LIMITS).toEqual({
      maximumBundleBytes: 2 * 1024 * 1024 * 1024,
      maximumAttachmentCount: 10_000,
      maximumAttachmentBytes: 100 * 1024 * 1024,
      maximumTotalAttachmentBytes: 1024 * 1024 * 1024,
      maximumChangedReadRetries: 2,
    });
  });
});

function createMetadataOnlySchemaV2Database(
  path: string,
  options: {
    attachmentForeignKey?: boolean;
    attachmentIndexColumns?: string;
    fakeMetadataChecks?: boolean;
    includeChecks?: boolean;
    uniqueStoragePath?: boolean;
  } = {},
): Database.Database {
  const omitChecks =
    options.includeChecks === false || options.fakeMetadataChecks === true;
  const attachmentForeignKey =
    options.attachmentForeignKey === false
      ? ""
      : ", FOREIGN KEY (note_id) REFERENCES notes(id) ON UPDATE NO ACTION ON DELETE CASCADE";
  const storagePathUnique = options.uniqueStoragePath === false ? "" : "UNIQUE";
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at numeric
    );
    CREATE TABLE app_metadata (
      id INTEGER PRIMARY KEY NOT NULL,
      schema_version INTEGER NOT NULL${omitChecks ? "" : ", CONSTRAINT app_metadata_single_row CHECK (app_metadata.id = 1), CONSTRAINT app_metadata_version_positive CHECK (app_metadata.schema_version >= 1)"}
    );
    CREATE TABLE chats (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      accent TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL${omitChecks ? "" : ", CONSTRAINT chats_title_length CHECK (length(trim(chats.title)) BETWEEN 1 AND 80), CONSTRAINT chats_accent_allowed CHECK (accent IN ('coral', 'amber', 'moss', 'ocean', 'iris', 'slate'))"}
    );
    CREATE INDEX chats_activity_idx ON chats(updated_at, id);
    CREATE TABLE notes (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON UPDATE NO ACTION ON DELETE CASCADE${omitChecks ? "" : ", CONSTRAINT notes_body_length CHECK (length(notes.body) <= 10000)"}
    );
    CREATE INDEX notes_chat_history_idx ON notes(chat_id, created_at, id);
    CREATE TABLE note_attachments (
      id TEXT PRIMARY KEY NOT NULL,
      note_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      storage_path TEXT NOT NULL ${storagePathUnique},
      byte_size INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL${attachmentForeignKey}${omitChecks ? "" : ", CONSTRAINT note_attachments_filename_length CHECK (length(trim(note_attachments.filename)) BETWEEN 1 AND 255), CONSTRAINT note_attachments_media_type_length CHECK (length(trim(note_attachments.media_type)) BETWEEN 1 AND 255), CONSTRAINT note_attachments_storage_path_length CHECK (length(note_attachments.storage_path) BETWEEN 1 AND 1024), CONSTRAINT note_attachments_byte_size_nonnegative CHECK (note_attachments.byte_size >= 0), CONSTRAINT note_attachments_modified_at_nonnegative CHECK (note_attachments.modified_at >= 0)"}
    );
    CREATE INDEX note_attachments_note_idx
      ON note_attachments(${options.attachmentIndexColumns ?? "note_id, created_at, id"});
    INSERT INTO app_metadata (id, schema_version) VALUES (1, 2);
    INSERT INTO __drizzle_migrations (id, hash, created_at)
      VALUES (1, 'schema-v2', 1788270000000);
    INSERT INTO chats (id, title, accent, created_at, updated_at)
      VALUES ('chat-a', 'Roadmap', 'ocean', 1, 1);
    INSERT INTO notes (id, chat_id, body, created_at)
      VALUES ('note-a', 'chat-a', 'Plan', 1);
  `);
  return database;
}

function createMetadataOnlySchemaV3Database(
  path: string,
  options: Parameters<typeof createMetadataOnlySchemaV2Database>[1] = {},
): Database.Database {
  const database = createMetadataOnlySchemaV2Database(path, options);
  database.exec(`
    CREATE TABLE chat_enabled_labels (
      chat_id TEXT NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY(chat_id, label),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON UPDATE NO ACTION ON DELETE CASCADE,
      CONSTRAINT chat_enabled_labels_label_allowed CHECK(label IN ('todo', 'decision', 'open-question', 'risk', 'milestone'))
    );
    CREATE TABLE note_labels (
      note_id TEXT NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY(note_id, label),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON UPDATE NO ACTION ON DELETE CASCADE,
      CONSTRAINT note_labels_label_allowed CHECK(label IN ('pin', 'attention', 'todo', 'decision', 'open-question', 'risk', 'milestone'))
    );
    INSERT INTO chat_enabled_labels (chat_id, label) VALUES
      ('chat-a', 'todo'), ('chat-a', 'milestone');
    UPDATE app_metadata SET schema_version = 3 WHERE id = 1;
    INSERT INTO __drizzle_migrations (id, hash, created_at)
      VALUES (2, 'schema-v3', 1788356400000);
  `);
  return database;
}

function insertAttachment(
  database: Database.Database,
  input: {
    id: string;
    filename: string;
    storagePath: string;
    byteSize: number;
    modifiedAt: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO note_attachments
       (id, note_id, filename, media_type, storage_path, byte_size, modified_at, created_at)
       VALUES (?, 'note-a', ?, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ?, ?, ?, 1)`,
    )
    .run(
      input.id,
      input.filename,
      input.storagePath,
      input.byteSize,
      input.modifiedAt,
    );
}

function copyBundle(source: string, directory: string, name: string): string {
  const destination = join(directory, `${name}.on-track-backup`);
  writeFileSync(destination, readFileSync(source));
  return destination;
}

function mutateBundle(
  path: string,
  mutation: (database: Database.Database) => void,
): void {
  const database = new Database(path);
  try {
    mutation(database);
  } finally {
    database.close();
  }
}

function createRestoreWorkspace(directory: string, restoreId: string) {
  const stagingDirectory = join(directory, `.on-track-restore-${restoreId}`);
  const attachmentNamespace = `restore-${restoreId}`;
  const candidateDataDirectory = join(stagingDirectory, "data");
  const stagedNamespacePath = join(
    candidateDataDirectory,
    "attachments",
    "v1",
    attachmentNamespace,
  );
  mkdirSync(stagedNamespacePath, { recursive: true, mode: 0o700 });
  return {
    restoreId,
    attachmentNamespace,
    stagingDirectory,
    candidateDatabasePath: join(stagingDirectory, "candidate.sqlite"),
    candidateDataDirectory,
    stagedNamespacePath,
    installedNamespaceRelativePath: `attachments/v1/restore-${restoreId}`,
  };
}
