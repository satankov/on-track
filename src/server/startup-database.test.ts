import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabaseAfterRestoreRecovery } from "./startup-database.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database startup recovery", () => {
  it("recovers an interrupted restore before opening the database", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "on-track-startup-"));
    directories.push(dataDirectory);
    const databasePath = join(dataDirectory, "on-track.sqlite");
    const events: string[] = [];
    const database = { open: true };

    const result = openDatabaseAfterRestoreRecovery({
      dataDirectory,
      databasePath,
      recover: (options) => {
        events.push("recover");
        expect(options).toMatchObject({ dataDirectory, databasePath });
      },
      validateDatabase: vi.fn(),
      openDatabase: (path) => {
        events.push("open");
        expect(path).toBe(databasePath);
        return database;
      },
    });

    expect(result).toBe(database);
    expect(events).toEqual(["recover", "open"]);
  });

  it("does not open SQLite when recovery fails closed", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "on-track-startup-"));
    directories.push(dataDirectory);
    const openDatabase = vi.fn();

    expect(() =>
      openDatabaseAfterRestoreRecovery({
        dataDirectory,
        databasePath: join(dataDirectory, "on-track.sqlite"),
        recover: () => {
          throw new Error("ambiguous restore");
        },
        validateDatabase: vi.fn(),
        openDatabase,
      }),
    ).toThrow("ambiguous restore");
    expect(openDatabase).not.toHaveBeenCalled();
  });
});
