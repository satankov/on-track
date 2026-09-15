import {
  chmodSync,
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ensurePrivateDirectory } from "./private-directory.js";
import { fileIdentity, isSameFileIdentity } from "../file-identity.js";

/** An OS-held lock survives database replacement, but never survives its owner. */
export function acquireInstanceOwner(
  directory: string,
  options: {
    filename?: ".on-track-owner.sqlite" | ".on-track-install-owner.sqlite";
  } = {},
): { dataDirectory: string; release(): void } {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const dataDirectory = realpathSync(directory);
  ensurePrivateDirectory(dataDirectory);
  const filename = options.filename ?? ".on-track-owner.sqlite";
  if (
    ![".on-track-owner.sqlite", ".on-track-install-owner.sqlite"].includes(
      filename,
    )
  )
    throw new Error("Invalid ownership filename.");
  const path = join(dataDirectory, filename);
  try {
    const existing = lstatSync(path);
    if (!existing.isFile() || existing.nlink !== 1)
      throw new Error("Owner lock must be a regular file with one link.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      const created = openSync(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
        0o600,
      );
      closeSync(created);
    } catch (creationError) {
      if ((creationError as NodeJS.ErrnoException).code !== "EEXIST")
        throw creationError;
    }
  }
  const original = lstatSync(path, { bigint: true });
  if (!original.isFile() || original.nlink !== 1n)
    throw new Error("Owner lock must be a regular file with one link.");
  let database: Database.Database | undefined;
  try {
    database = new Database(path, { timeout: 0 });
    const current = lstatSync(path, { bigint: true });
    if (
      !current.isFile() ||
      !isSameFileIdentity(fileIdentity(original), fileIdentity(current))
    )
      throw new Error("Owner lock changed during acquisition.");
    chmodSync(path, 0o600);
    database.pragma("busy_timeout = 0");
    database.pragma("journal_mode = DELETE");
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database?.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY")
      throw new Error(
        "On Track data directory is already in use by another instance.",
        { cause: error },
      );
    throw error;
  }
  const owner = database;
  return {
    dataDirectory,
    release() {
      if (owner.open) owner.close();
    },
  };
}
