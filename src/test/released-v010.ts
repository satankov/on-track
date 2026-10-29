import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

// Frozen from v0.1.0 (f42a822), not derived from the current migration journal.
const released = JSON.parse(
  readFileSync(
    new URL("./fixtures/v0.1.0-migrations.json", import.meta.url),
    "utf8",
  ),
) as {
  journal: { entries: Array<{ tag: string; when: number }> };
  sha256: Record<string, string>;
};
export const V010_MIGRATION_MARKER = 1789027200000;
export const V010_FILE = {
  id: "release-file",
  path: "attachments/v1/release-file/evidence.txt",
  content: "Release fixture attachment\n",
};

/** Forward-build released schema 7 without current repository/schema helpers. */
export function createV010Database(
  dataDirectory: string,
  options: { missingAttachment?: boolean } = {},
) {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const migrationsFolder = join(dataDirectory, "released-migrations");
  mkdirSync(join(migrationsFolder, "meta"), { recursive: true, mode: 0o700 });
  for (const entry of released.journal.entries) {
    const name = `${entry.tag}.sql`;
    // Git blobs use LF; tolerate Windows checkout line-ending conversion only.
    const sql = Buffer.from(
      readFileSync(join(process.cwd(), "drizzle", name), "utf8").replace(
        /\r\n/g,
        "\n",
      ),
    );
    if (sha256(sql) !== released.sha256[name])
      throw new Error(`Shipped v0.1.0 migration changed: ${name}`);
    writeFileSync(join(migrationsFolder, name), sql);
  }
  writeFileSync(
    join(migrationsFolder, "meta/_journal.json"),
    JSON.stringify(released.journal),
  );
  const databasePath = join(dataDirectory, "on-track.sqlite");
  const sqlite = new Database(databasePath);
  chmodSync(databasePath, 0o600);
  try {
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.exec(`
      INSERT INTO chats(id,title,accent,created_at,updated_at,pinned_at,collapse_long_messages,archived_at)
      VALUES ('release-archive','Released archive','ocean',10,40,NULL,0,50),
             ('release-pinned','Released pinned','moss',11,41,45,1,NULL);
      INSERT INTO notes(id,chat_id,body,created_at,sender)
      VALUES ('release-note','release-archive','Keep **Markdown**, sender and disabled labels',20,'Alex'),
             ('release-other-note','release-pinned','Excluded project note',21,NULL);
      INSERT INTO chat_enabled_labels(chat_id,label)
      VALUES ('release-archive','risk'), ('release-pinned','todo');
      INSERT INTO note_labels(note_id,label)
      VALUES ('release-note','todo'), ('release-note','attention');
    `);
    const insert = sqlite.prepare(`INSERT INTO note_attachments
      (id,note_id,filename,media_type,storage_path,byte_size,modified_at,created_at)
      VALUES(?,?,?,'text/plain',?,?,30,25)`);
    for (const file of [
      { ...V010_FILE, note: "release-note", filename: "evidence.txt" },
      {
        id: "release-other-file",
        note: "release-other-note",
        filename: "excluded.txt",
        path: "attachments/v1/release-other-file/excluded.txt",
        content: "Excluded attachment\n",
      },
    ]) {
      insert.run(
        file.id,
        file.note,
        file.filename,
        file.path,
        Buffer.byteLength(file.content),
      );
      mkdirSync(dirname(join(dataDirectory, file.path)), {
        recursive: true,
        mode: 0o700,
      });
      writeFileSync(join(dataDirectory, file.path), file.content, {
        mode: 0o600,
      });
    }
    if (options.missingAttachment)
      insert.run(
        "release-missing",
        "release-note",
        "missing.txt",
        "attachments/v1/release-missing/missing.txt",
        12,
      );
    return { dataDirectory, databasePath, sqlite };
  } catch (error) {
    sqlite.close();
    throw error;
  } finally {
    rmSync(migrationsFolder, { recursive: true, force: true });
  }
}

/** Only columns present in the release, so added schema-9 columns cannot mask loss. */
export function readV010Rows(sqlite: Database.Database) {
  return {
    chats: sqlite
      .prepare(
        `SELECT id,title,accent,created_at,updated_at,pinned_at,
      collapse_long_messages,archived_at FROM chats ORDER BY id`,
      )
      .all(),
    notes: sqlite.prepare("SELECT * FROM notes ORDER BY id").all(),
    attachments: sqlite
      .prepare("SELECT * FROM note_attachments ORDER BY id")
      .all(),
    labels: sqlite
      .prepare("SELECT note_id,label FROM note_labels ORDER BY note_id,label")
      .all(),
  };
}

/** Release-schema fixture, not an export produced by the released app binary.
 * Envelope SQL/format/application ID checked against v0.1.0's exporter.
 * Deliberately independent of the current exporter and its schema constant.
 */
export async function createV010Backup(dataDirectory: string) {
  const fixture = createV010Database(dataDirectory);
  const bundlePath = join(dataDirectory, "released.on-track-backup");
  try {
    await fixture.sqlite.backup(bundlePath);
  } finally {
    fixture.sqlite.close();
  }
  chmodSync(bundlePath, 0o600);
  const bundle = new Database(bundlePath);
  try {
    bundle.pragma("journal_mode = DELETE");
    bundle.pragma("foreign_keys = ON");
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
    let total = 0;
    const files = bundle
      .prepare("SELECT id,storage_path FROM note_attachments")
      .all() as Array<{ id: string; storage_path: string }>;
    for (const file of files) {
      const bytes = readFileSync(join(dataDirectory, file.storage_path));
      bundle
        .prepare("INSERT INTO _on_track_bundle_files VALUES(?,?,30,?,?)")
        .run(file.id, bytes.length, sha256(bytes), bytes);
      total += bytes.length;
    }
    bundle
      .prepare("INSERT INTO _on_track_bundle VALUES(1,1,7,60,?,?)")
      .run(files.length, total);
    bundle.pragma("application_id = 0x4f545242");
  } finally {
    bundle.close();
  }
  return bundlePath;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
