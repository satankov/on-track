import type Database from "better-sqlite3";

import { openDatabase } from "./db/database.js";
import {
  recoverManagedRestoreBeforeDatabaseOpen,
  type RecoverManagedRestoreBeforeDatabaseOpenOptions,
} from "./database-transfer/restore-journal.js";

export interface OpenDatabaseAfterRestoreRecoveryOptions<
  TDatabase = Database.Database,
> {
  dataDirectory: string;
  databasePath: string;
  recover?: (
    options: RecoverManagedRestoreBeforeDatabaseOpenOptions,
  ) => unknown;
  validateDatabase?: RecoverManagedRestoreBeforeDatabaseOpenOptions["validateDatabase"];
  validateCommittedDatabase?: RecoverManagedRestoreBeforeDatabaseOpenOptions["validateCommittedDatabase"];
  openDatabase?: (databasePath: string) => TDatabase;
}

export function openDatabaseAfterRestoreRecovery<TDatabase = Database.Database>(
  options: OpenDatabaseAfterRestoreRecoveryOptions<TDatabase>,
): TDatabase {
  const recover = options.recover ?? recoverManagedRestoreBeforeDatabaseOpen;
  recover({
    dataDirectory: options.dataDirectory,
    databasePath: options.databasePath,
    validateDatabase: options.validateDatabase,
    validateCommittedDatabase: options.validateCommittedDatabase,
  });

  const open =
    options.openDatabase ??
    (openDatabase as unknown as (databasePath: string) => TDatabase);
  return open(options.databasePath);
}
