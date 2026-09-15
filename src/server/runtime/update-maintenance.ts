import { timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  restoreDatabaseCheckpoint,
  validateDatabaseCheckpoint,
} from "./database-checkpoint.js";
import {
  UpdateJournalError,
  UpdateJournalStore,
  type UpdateJournal,
} from "./update-journal.js";

export interface UpdateStartupIdentity {
  buildId: string;
  transactionId?: string;
  token?: string;
  nonce?: string;
  installRoot?: string;
}

/** Call after acquiring data ownership and before import recovery or migrations.
 * Returning candidate_started authorizes migration only; HTTP admission must
 * remain frozen until this same candidate durably commits the journal.
 */
export function assertUpdateStartupAllowed(
  dataDirectory: string,
  identity?: UpdateStartupIdentity,
): UpdateJournal | undefined {
  const store = new UpdateJournalStore(dataDirectory);
  const journal = store.read();
  if (!journal) {
    if (identity?.transactionId)
      throw new UpdateJournalError(
        "Update startup has no matching transaction.",
      );
    return undefined;
  }
  if (journal.state === "committed") {
    if (identity?.buildId !== journal.candidate.buildId)
      throw new UpdateJournalError(
        "A committed update must restart its matching application build.",
      );
    return journal;
  }
  if (!identity?.transactionId)
    throw new UpdateJournalError(
      "An update is pending. Run ontrack to recover before starting the application.",
    );
  if (
    identity.transactionId !== journal.transactionId ||
    identity.buildId !== journal.candidate.buildId ||
    identity.nonce !== journal.candidateCredentials.nonce ||
    !equalCapability(identity.token, journal.candidateCredentials.token) ||
    !identity.installRoot ||
    realpathSync(identity.installRoot) !== realpathSync(journal.installRoot)
  )
    throw new UpdateJournalError(
      "Update candidate identity or capability does not match.",
    );
  if (journal.state !== "candidate_started")
    throw new UpdateJournalError(
      "This update needs recovery before another candidate start.",
    );
  validateDatabaseCheckpoint(store.dataDirectory, journal.checkpoint!);
  return journal;
}

export interface RecoverUpdateOptions {
  store: UpdateJournalStore;
  databasePath: string;
  transactionId: string;
  installRoot: string;
}
export interface UpdateRecoveryResult {
  outcome: "unchanged" | "rolled_back" | "committed";
  journal: UpdateJournal;
}

/** Caller first authenticates/stops old or candidate processes, closes every
 * connection, and acquires data ownership. This deliberately keeps the journal:
 * select the returned previous/candidate release durably before clearing it.
 */
export function recoverUpdate(
  options: RecoverUpdateOptions,
): UpdateRecoveryResult {
  const journal = options.store.require(options.transactionId);
  if (realpathSync(options.installRoot) !== realpathSync(journal.installRoot))
    throw new UpdateJournalError(
      "Update installation identity does not match. Recovery stopped.",
    );
  // This must precede every checkpoint access: it protects writes accepted after
  // a durable commit even when the retained snapshot is corrupt or missing.
  if (journal.state === "committed") return { outcome: "committed", journal };
  if (journal.state === "candidate_started") {
    restoreDatabaseCheckpoint({
      dataDirectory: options.store.dataDirectory,
      databasePath: options.databasePath,
      checkpoint: journal.checkpoint!,
    });
    return { outcome: "rolled_back", journal };
  }
  return { outcome: "unchanged", journal };
}

function equalCapability(
  actual: string | undefined,
  expected: string,
): boolean {
  if (!actual || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}
