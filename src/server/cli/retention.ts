import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { checkpointPath } from "../runtime/database-checkpoint.js";
import {
  checkpointDescriptorSchema,
  updateIdSchema,
  updateReleaseSchema,
  UpdateJournalStore,
  type UpdateJournal,
} from "../runtime/update-journal.js";
import {
  readActiveRelease,
  readInstallState,
  readJsonFile,
  releaseIdSchema,
  runtimeIdSchema,
  writeJsonFile,
} from "./state.js";

const ledgerSchema = z.strictObject({
  protocol: z.literal(1),
  releases: z.array(releaseIdSchema).max(1000),
  runtimes: z.array(runtimeIdSchema).max(1000),
  checkpoints: z.array(updateIdSchema).max(1000),
});
const completedSchema = z.strictObject({
  protocol: z.literal(1),
  transactionId: updateIdSchema,
  previous: updateReleaseSchema,
  candidate: updateReleaseSchema,
  checkpoint: checkpointDescriptorSchema,
});
const WARNING =
  "Some old managed artifacts were retained; the successful update remains active.";
function optionalJson(path: string): unknown | undefined {
  try {
    return readJsonFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function realDirectory(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(path) !== path
  )
    throw new Error("Unsafe retention directory.");
}

/** Caller holds installation ownership and has already durably recorded last-update.
 * Only artifacts recorded by past successful commits are eligible. Unknown files,
 * staging, manual checkouts and unresolved recovery artifacts are never swept.
 * Cleanup is deliberately best effort: no error can initiate data rollback.
 */
export function pruneCommitted(root: string, journal: UpdateJournal): string[] {
  const warnings: string[] = [];
  try {
    realDirectory(root);
    const state = readInstallState(root);
    realDirectory(state.dataDirectory);
    if (
      journal.state !== "committed" ||
      journal.installRoot !== root ||
      !journal.checkpoint
    )
      throw new Error("Retention requires a committed update.");
    const selection = readActiveRelease(root);
    if (
      selection.releaseId !== journal.candidate.releaseId ||
      selection.runtimeId !== journal.candidate.runtimeId
    )
      throw new Error("Retention selection mismatch.");
    const recorded = completedSchema.parse(
      readJsonFile(join(root, "last-update.json")),
    );
    if (
      JSON.stringify(recorded) !==
      JSON.stringify(
        completedSchema.parse({
          protocol: 1,
          transactionId: journal.transactionId,
          previous: journal.previous,
          candidate: journal.candidate,
          checkpoint: journal.checkpoint,
        }),
      )
    )
      throw new Error("Durable completion identity mismatch.");
    const pending = new UpdateJournalStore(state.dataDirectory).read();
    if (
      pending &&
      (pending.state !== "committed" ||
        pending.transactionId !== journal.transactionId)
    )
      throw new Error("Recovery artifacts remain in use.");
    const ledgerPath = join(root, "retention.json");
    const ledger = ledgerSchema.parse(
      optionalJson(ledgerPath) ?? {
        protocol: 1,
        releases: [],
        runtimes: [],
        checkpoints: [],
      },
    );
    const keepReleases = new Set([
      journal.previous.releaseId,
      journal.candidate.releaseId,
    ]);
    const keepRuntimes = new Set([
      journal.previous.runtimeId,
      journal.candidate.runtimeId,
    ]);
    const shim = optionalJson(join(root, "shim-runtime.json"));
    let allowRuntimePruning = false;
    if (shim) {
      const interpreter = z
        .strictObject({
          protocol: z.literal(1),
          runtimeExecutable: z.string().refine(isAbsolute),
        })
        .parse(shim).runtimeExecutable;
      const path = relative(join(root, "runtimes"), interpreter).split(sep);
      if (
        runtimeIdSchema.safeParse(path[0]).success &&
        ((path.length === 2 && path[1] === "node.exe") ||
          (path.length === 3 && path[1] === "bin" && path[2] === "node"))
      ) {
        keepRuntimes.add(path[0]);
        allowRuntimePruning = true;
      }
    }
    ledger.releases = [...new Set([...ledger.releases, ...keepReleases])];
    ledger.runtimes = [...new Set([...ledger.runtimes, ...keepRuntimes])];
    ledger.checkpoints = [
      ...new Set([...ledger.checkpoints, journal.transactionId]),
    ];
    // Registration precedes deletion, so interruptions leave a retryable ledger.
    writeJsonFile(ledgerPath, ledgerSchema.parse(ledger));
    function remove(path: string, kind: "directory" | "file"): boolean {
      try {
        realDirectory(
          kind === "directory" ? join(path, "..") : state.dataDirectory,
        );
        const stat = lstatSync(path);
        if (
          kind === "file" &&
          ["-wal", "-shm", "-journal"].some((suffix) =>
            existsSync(path + suffix),
          )
        )
          throw new Error("Checkpoint sidecars remain in use.");
        if (
          stat.isSymbolicLink() ||
          (kind === "directory"
            ? !stat.isDirectory()
            : !stat.isFile() || stat.nlink !== 1)
        )
          throw new Error("Unsafe retained artifact.");
        rmSync(path, { recursive: kind === "directory" });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        warnings.push(WARNING);
        return false;
      }
    }
    ledger.releases = ledger.releases.filter(
      (id) =>
        keepReleases.has(id) ||
        !remove(join(root, "releases", id), "directory"),
    );
    ledger.runtimes = ledger.runtimes.filter(
      (id) =>
        !allowRuntimePruning ||
        keepRuntimes.has(id) ||
        !remove(join(root, "runtimes", id), "directory"),
    );
    ledger.checkpoints = ledger.checkpoints.filter(
      (id) =>
        id === journal.transactionId ||
        !remove(checkpointPath(state.dataDirectory, id), "file"),
    );
    writeJsonFile(ledgerPath, ledger);
  } catch {
    warnings.push(WARNING);
  }
  return [...new Set(warnings)];
}
