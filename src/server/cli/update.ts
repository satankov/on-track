import { spawn } from "node:child_process";
import { pruneCommitted } from "./retention.js";
import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describeRuntime } from "../runtime/build-info.js";
import { createDatabaseCheckpoint } from "../runtime/database-checkpoint.js";
import { requestControl } from "../runtime/control-server.js";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import { readInstance } from "../runtime/managed-server.js";
import { recoverUpdate } from "../runtime/update-maintenance.js";
import {
  UpdateJournalStore,
  type UpdateJournal,
  type UpdateReleaseIdentity,
} from "../runtime/update-journal.js";
import {
  managedStatus,
  softwareEnvironment,
  startManaged,
  stopManaged,
} from "./process.js";
import {
  managedPaths,
  readActiveRelease,
  readInstallState,
  releaseIdSchema,
  selectActiveRelease,
  writeJsonFile,
  type ActiveRelease,
} from "./state.js";

export function identityFor(
  root: string,
  selection: ActiveRelease,
): UpdateReleaseIdentity {
  const description = describeRuntime(
    managedPaths(root, selection).releaseDirectory,
  );
  if (description.releaseId !== selection.releaseId)
    throw new Error("Installed release does not match its recorded identity.");
  return {
    releaseId: selection.releaseId,
    runtimeId: selection.runtimeId,
    buildId: description.buildId,
    schemaVersion: description.schemaVersion,
    migrationMarker: description.migrationMarker,
  };
}
function selectionFor(identity: UpdateReleaseIdentity): ActiveRelease {
  return {
    protocol: 1,
    releaseId: identity.releaseId,
    runtimeId: identity.runtimeId,
  };
}
function recordCompleted(root: string, journal: UpdateJournal): void {
  writeJsonFile(join(root, "last-update.json"), {
    protocol: 1,
    transactionId: journal.transactionId,
    previous: journal.previous,
    candidate: journal.candidate,
    checkpoint: journal.checkpoint,
  });
  pruneCommitted(root, journal);
}

/** Installation ownership is held by the caller. Data ownership is acquired here. */
export async function recoverManagedUpdate(
  root: string,
): Promise<"none" | "previous" | "committed"> {
  const state = readInstallState(root);
  const store = new UpdateJournalStore(state.dataDirectory);
  let journal = store.read();
  if (!journal) return "none";
  if (realpathSync(journal.installRoot) !== root)
    throw new Error("Pending update belongs to another managed installation.");
  const status = await managedStatus(root);
  if (status) {
    if (journal.state === "committed") {
      if (status.buildId !== journal.candidate.buildId)
        throw new Error(
          "Running build disagrees with the committed update. Recovery stopped.",
        );
      selectActiveRelease(root, selectionFor(journal.candidate));
      recordCompleted(root, journal);
      return "committed";
    }
    const expected = [
      journal.candidateCredentials,
      journal.previousCredentials,
    ].filter(Boolean);
    const instance = readInstance(state.dataDirectory);
    if (
      !instance ||
      !expected.some(
        (credentials) =>
          credentials?.nonce === instance.nonce &&
          credentials?.token === instance.token,
      )
    )
      throw new Error(
        "Pending update instance cannot be authenticated. No process was stopped.",
      );
    await stopManaged(root);
  }
  const owner = acquireInstanceOwner(state.dataDirectory);
  try {
    journal = store.read();
    if (!journal) return "none";
    const result = recoverUpdate({
      store,
      databasePath: join(state.dataDirectory, "on-track.sqlite"),
      transactionId: journal.transactionId,
      installRoot: root,
    });
    const committed = result.outcome === "committed";
    selectActiveRelease(
      root,
      selectionFor(committed ? journal.candidate : journal.previous),
    );
    if (committed) recordCompleted(root, journal);
    store.clear(journal.transactionId);
    return committed ? "committed" : "previous";
  } finally {
    owner.release();
  }
}

async function recoverOldImport(
  root: string,
  previous: ActiveRelease,
): Promise<void> {
  const paths = managedPaths(root, previous);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      paths.node,
      [paths.cli, "maintenance-recover-import", "--root", root],
      {
        cwd: paths.releaseDirectory,
        env: softwareEnvironment(),
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let message = "";
    child.stderr?.on("data", (chunk) => {
      if (message.length < 2048) message += String(chunk);
    });
    const timeout = setTimeout(() => {
      child.stderr?.destroy();
      child.unref();
      reject(
        new Error(
          "Previous-version recovery is still busy. No process was forcibly stopped; retry after it finishes.",
        ),
      );
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            "The previous version could not finish database recovery. Run thr logs before updating.",
          ),
        );
    });
  });
}

export interface ActivateOptions {
  confirm: () => Promise<boolean>;
  progress?: (message: string) => void;
  forceCheckpoint?: boolean;
}

/** Activate only a previously verified, fully built release in managed storage. */
export async function activatePrepared(
  root: string,
  candidate: ActiveRelease,
  options: ActivateOptions,
): Promise<void> {
  await recoverManagedUpdate(root);
  const state = readInstallState(root);
  const previous = readActiveRelease(root);
  const oldVersion = releaseIdSchema
    .parse(previous.releaseId)
    .slice(1)
    .split(".")
    .map(BigInt);
  const newVersion = releaseIdSchema
    .parse(candidate.releaseId)
    .slice(1)
    .split(".")
    .map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (newVersion[index] < oldVersion[index])
      throw new Error("Downgrades are not supported.");
    if (newVersion[index] > oldVersion[index]) break;
  }
  const oldIdentity = identityFor(root, previous);
  const nextIdentity = identityFor(root, candidate);
  if (
    oldIdentity.buildId === nextIdentity.buildId &&
    !options.forceCheckpoint
  ) {
    if (!(await managedStatus(root))) await startManaged(root);
    return;
  }
  if (
    nextIdentity.schemaVersion < oldIdentity.schemaVersion ||
    nextIdentity.migrationMarker < oldIdentity.migrationMarker
  )
    throw new Error(
      "This release cannot open the existing data. Downgrades are not supported.",
    );
  if (!(await options.confirm()))
    throw new Error("Update cancelled. The current installation is unchanged.");
  const current = await managedStatus(root);
  if (!current) await recoverOldImport(root, previous);
  const oldInstance = current ? readInstance(state.dataDirectory) : undefined;
  if (current && current.buildId !== oldIdentity.buildId)
    throw new Error("Running server does not match the active installation.");
  const transactionId = randomUUID();
  const intent = {
    transactionId,
    installRoot: root,
    previous: oldIdentity,
    candidate: nextIdentity,
    candidateCredentials: {
      nonce: randomUUID(),
      token: randomBytes(32).toString("hex"),
    },
    ...(oldInstance
      ? {
          previousCredentials: {
            nonce: oldInstance.nonce,
            token: oldInstance.token,
          },
        }
      : {}),
  };
  const store = new UpdateJournalStore(state.dataDirectory);
  options.progress?.("Preparing a recovery checkpoint…");
  try {
    if (oldInstance) {
      await requestControl(oldInstance, {
        command: "prepare-update",
        update: intent,
      });
      await stopManaged(root);
    }
    const owner = acquireInstanceOwner(state.dataDirectory);
    try {
      if (!oldInstance) {
        const pending = store.read();
        if (pending?.state === "committed") {
          recordCompleted(root, pending);
          store.clear(pending.transactionId);
        }
        store.begin(intent);
      }
      const checkpoint = await createDatabaseCheckpoint({
        dataDirectory: state.dataDirectory,
        databasePath: join(state.dataDirectory, "on-track.sqlite"),
        transactionId,
        expectedSchemaVersion: oldIdentity.schemaVersion,
        expectedMigrationMarker: oldIdentity.migrationMarker,
      });
      store.markCheckpointReady(transactionId, checkpoint);
      store.markCandidateStarted(transactionId);
    } finally {
      owner.release();
    }
    options.progress?.("Starting the new version…");
    const status = await startManaged(root, {
      selection: candidate,
      updateTransactionId: transactionId,
      credentials: intent.candidateCredentials,
    });
    if (
      status.state !== "maintenance" ||
      status.buildId !== nextIdentity.buildId
    )
      throw new Error(
        "Candidate did not start in the expected maintenance state.",
      );
    selectActiveRelease(root, candidate);
    const instance = readInstance(state.dataDirectory);
    if (!instance || instance.nonce !== intent.candidateCredentials.nonce)
      throw new Error("Update candidate identity changed before activation.");
    await requestControl(instance, "activate");
    // The server commits its data journal before allowing project requests. A
    // lost acknowledgment is recovered from that journal, never by rollback.
    const committed = store.require(transactionId);
    if (committed.state !== "committed")
      throw new Error("Candidate did not record update activation.");
    recordCompleted(root, committed);
  } catch (error) {
    const outcome = await recoverManagedUpdate(root);
    if (outcome === "committed") return;
    if (!(await managedStatus(root))) {
      try {
        await startManaged(root);
      } catch {
        /* Keep recovery artifacts and the original failure visible. */
      }
    }
    throw error;
  }
}
