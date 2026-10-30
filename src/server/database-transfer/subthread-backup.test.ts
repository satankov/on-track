import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { readBackupProjects } from "./sqlite-backup-bundle.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("catalogs project roots and includes archived subthread messages and files in their totals", () => {
  const directory = mkdtempSync(join(tmpdir(), "threadstr-subthread-catalog-"));
  directories.push(directory);
  const path = join(directory, "catalog.sqlite");
  const database = new Database(path);
  database.exec(`
    CREATE TABLE chats(id TEXT PRIMARY KEY, title TEXT, created_at INTEGER, pinned_at INTEGER, archived_at INTEGER, project_id TEXT);
    CREATE TABLE notes(id TEXT PRIMARY KEY, chat_id TEXT);
    CREATE TABLE note_attachments(id TEXT PRIMARY KEY, note_id TEXT);
    INSERT INTO chats VALUES('main','Website',1,NULL,NULL,NULL),('child','Pricing',2,NULL,10,'main'),('other','Unrelated',3,NULL,NULL,NULL);
    INSERT INTO notes VALUES('a','main'),('b','child'),('c','child'),('d','other');
    INSERT INTO note_attachments VALUES('file-b','b'),('file-d','d');
  `);
  database.close();
  expect(readBackupProjects(path, 10)).toEqual([
    {
      id: "other",
      title: "Unrelated",
      createdAt: 3,
      pinnedAt: null,
      archivedAt: null,
      messageCount: 1,
      attachmentCount: 1,
    },
    {
      id: "main",
      title: "Website",
      createdAt: 1,
      pinnedAt: null,
      archivedAt: null,
      messageCount: 3,
      attachmentCount: 1,
    },
  ]);
});
