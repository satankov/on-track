import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

export const UPDATE_JOURNAL_FILENAME = ".on-track-update-journal.json";
export const UPDATE_JOURNAL_VERSION = 1;
export const updateIdSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const updateReleaseSchema = z.strictObject({
  releaseId: z.string().regex(/^v\d+\.\d+\.\d+$/),
  runtimeId: z
    .string()
    .regex(/^node-v\d+\.\d+\.\d+-(darwin|linux|win)-(x64|arm64)$/),
  buildId: sha256Schema,
  schemaVersion: z.number().int().positive(),
  migrationMarker: z.number().int().nonnegative(),
});
const credentialsSchema = z.strictObject({
  nonce: updateIdSchema,
  token: sha256Schema,
});
export const checkpointDescriptorSchema = z.strictObject({
  transactionId: updateIdSchema,
  sha256: sha256Schema,
  size: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  migrationMarker: z.number().int().nonnegative(),
});
const journalSchema = z
  .strictObject({
    version: z.literal(UPDATE_JOURNAL_VERSION),
    transactionId: updateIdSchema,
    installRoot: z
      .string()
      .min(1)
      .max(4096)
      .refine((path) => isAbsolute(path) && resolve(path) === path),
    previous: updateReleaseSchema,
    candidate: updateReleaseSchema,
    candidateCredentials: credentialsSchema,
    previousCredentials: credentialsSchema.optional(),
    state: z.enum([
      "intent",
      "checkpoint_ready",
      "candidate_started",
      "committed",
    ]),
    checkpoint: checkpointDescriptorSchema.optional(),
  })
  .superRefine((journal, context) => {
    if (
      (journal.state !== "intent" && !journal.checkpoint) ||
      (journal.checkpoint &&
        (journal.checkpoint.transactionId !== journal.transactionId ||
          journal.checkpoint.schemaVersion !== journal.previous.schemaVersion ||
          journal.checkpoint.migrationMarker !==
            journal.previous.migrationMarker))
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint identity mismatch",
      });
    }
  });

export type UpdateReleaseIdentity = z.infer<typeof updateReleaseSchema>;
export type DatabaseCheckpoint = z.infer<typeof checkpointDescriptorSchema>;
export type UpdateJournal = z.infer<typeof journalSchema>;
export type BeginUpdate = Omit<
  UpdateJournal,
  "version" | "state" | "checkpoint"
>;

export class UpdateJournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateJournalError";
  }
}

/** Caller holds lifetime data ownership for every read/transition/recovery. */
export class UpdateJournalStore {
  readonly dataDirectory: string;
  readonly journalPath: string;
  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    if (
      !lstatSync(dataDirectory).isDirectory() ||
      lstatSync(dataDirectory).isSymbolicLink()
    )
      throw new UpdateJournalError("Unsafe update data directory.");
    this.dataDirectory = realpathSync(dataDirectory);
    this.journalPath = join(this.dataDirectory, UPDATE_JOURNAL_FILENAME);
  }

  read(): UpdateJournal | undefined {
    if (!assertUpdateFile(this.journalPath, true)) return undefined;
    const descriptor = openSync(
      this.journalPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32_768)
        throw new UpdateJournalError("Invalid update journal file.");
      let parsed: unknown;
      try {
        const buffer = Buffer.alloc(32_769);
        let length = 0;
        for (;;) {
          const bytes = readSync(
            descriptor,
            buffer,
            length,
            buffer.length - length,
            null,
          );
          length += bytes;
          if (length > 32_768)
            throw new UpdateJournalError("Invalid update journal size.");
          if (!bytes) break;
        }
        parsed = JSON.parse(buffer.subarray(0, length).toString("utf8"));
      } catch {
        throw new UpdateJournalError(
          "Invalid update journal. Recovery is required before starting.",
        );
      }
      const result = journalSchema.safeParse(parsed);
      if (!result.success)
        throw new UpdateJournalError(
          "Invalid update journal. Recovery is required before starting.",
        );
      return result.data;
    } finally {
      closeSync(descriptor);
    }
  }

  begin(input: BeginUpdate): UpdateJournal {
    if (this.read())
      throw new UpdateJournalError("A pending update must be recovered first.");
    return this.write({
      ...input,
      version: UPDATE_JOURNAL_VERSION,
      state: "intent",
    });
  }

  markCheckpointReady(
    transactionId: string,
    checkpoint: DatabaseCheckpoint,
  ): UpdateJournal {
    const journal = this.require(transactionId);
    if (journal.state !== "intent")
      throw new UpdateJournalError("Update checkpoint transition is invalid.");
    return this.write({ ...journal, state: "checkpoint_ready", checkpoint });
  }

  markCandidateStarted(transactionId: string): UpdateJournal {
    const journal = this.require(transactionId);
    if (journal.state !== "checkpoint_ready")
      throw new UpdateJournalError("Candidate startup transition is invalid.");
    return this.write({ ...journal, state: "candidate_started" });
  }

  commit(transactionId: string): UpdateJournal {
    const journal = this.require(transactionId);
    if (journal.state !== "candidate_started")
      throw new UpdateJournalError("Update commit transition is invalid.");
    return this.write({ ...journal, state: "committed" });
  }

  /** Only after matching installation selection is durable, under ownership. */
  clear(transactionId: string): void {
    this.require(transactionId);
    unlinkSync(this.journalPath);
    syncUpdateDirectory(this.dataDirectory);
  }

  require(transactionId: string): UpdateJournal {
    const journal = this.read();
    if (!journal || journal.transactionId !== transactionId)
      throw new UpdateJournalError(
        "Update transaction identity does not match.",
      );
    return journal;
  }

  private write(journal: UpdateJournal): UpdateJournal {
    const parsed = journalSchema.safeParse(journal);
    if (!parsed.success)
      throw new UpdateJournalError(
        "Invalid update journal identity or checkpoint.",
      );
    atomicUpdateFile(this.journalPath, JSON.stringify(parsed.data));
    return parsed.data;
  }
}

export function assertUpdateFile(path: string, allowMissing = false): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new UpdateJournalError("Unsafe update file.");
    if (
      process.platform !== "win32" &&
      (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
    )
      throw new UpdateJournalError(
        "Update files must be private to the current user.",
      );
    return true;
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")
      return false;
    throw error;
  }
}

export function syncUpdateDirectory(directory: string): void {
  if (process.platform === "win32") return; // Windows does not expose directory fsync through Node.
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function atomicUpdateFile(path: string, contents: string): void {
  assertUpdateFile(path, true);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporary, 0o600);
  assertUpdateFile(path, true);
  renameSync(temporary, path);
  syncUpdateDirectory(dirname(path));
}
