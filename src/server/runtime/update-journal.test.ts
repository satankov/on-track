import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  UpdateJournalStore,
  UPDATE_JOURNAL_FILENAME,
} from "./update-journal.js";

const roots: string[] = [];
function fixture() {
  const dataDirectory = mkdtempSync(
    join(tmpdir(), "threadstr-update-journal-"),
  );
  roots.push(dataDirectory);
  const previous = {
    releaseId: "v0.0.8",
    runtimeId: "node-v24.14.0-darwin-arm64",
    buildId: "a".repeat(64),
    schemaVersion: 7,
    migrationMarker: 1789027200000,
  };
  return {
    store: new UpdateJournalStore(dataDirectory),
    input: {
      transactionId: randomUUID(),
      installRoot: dataDirectory,
      previous,
      candidate: { ...previous, releaseId: "v0.0.9", buildId: "b".repeat(64) },
      candidateCredentials: { nonce: randomUUID(), token: "c".repeat(64) },
    },
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("durably records update intent and refuses a second update", () => {
  const { store, input } = fixture();
  expect(store.begin(input)).toMatchObject({
    version: 1,
    state: "intent",
    ...input,
  });
  expect(new UpdateJournalStore(store.dataDirectory).read()).toMatchObject({
    transactionId: input.transactionId,
  });
  expect(() => store.begin(input)).toThrow(/pending/i);
  const path = join(store.dataDirectory, ".on-track-update-journal.json");
  expect(JSON.parse(readFileSync(path, "utf8"))).toHaveProperty(
    "state",
    "intent",
  );
  if (process.platform !== "win32")
    expect(statSync(path).mode & 0o777).toBe(0o600);
});

it("enforces transaction identity and forward-only durable states", () => {
  const { store, input } = fixture();
  store.begin(input);
  const checkpoint = {
    transactionId: input.transactionId,
    sha256: "d".repeat(64),
    size: 4096,
    schemaVersion: input.previous.schemaVersion,
    migrationMarker: input.previous.migrationMarker,
  };
  expect(() => store.commit(input.transactionId)).toThrow(/transition/);
  expect(() => store.markCandidateStarted(input.transactionId)).toThrow(
    /transition/,
  );
  expect(() => store.markCheckpointReady(randomUUID(), checkpoint)).toThrow(
    /identity/,
  );
  expect(() =>
    store.markCheckpointReady(input.transactionId, {
      ...checkpoint,
      transactionId: randomUUID(),
    }),
  ).toThrow(/identity|checkpoint/);
  expect(store.markCheckpointReady(input.transactionId, checkpoint).state).toBe(
    "checkpoint_ready",
  );
  expect(() =>
    store.markCheckpointReady(input.transactionId, checkpoint),
  ).toThrow(/transition/);
  expect(store.markCandidateStarted(input.transactionId).state).toBe(
    "candidate_started",
  );
  expect(store.commit(input.transactionId).state).toBe("committed");
  expect(() => store.markCandidateStarted(input.transactionId)).toThrow(
    /transition/,
  );
  expect(() => store.clear(randomUUID())).toThrow(/identity/);
  store.clear(input.transactionId);
  expect(store.read()).toBeUndefined();
});

it.each(["{", JSON.stringify({ version: 99 }), "x".repeat(32769)])(
  "fails closed on malformed or oversized journal",
  (contents) => {
    const { store } = fixture();
    writeFileSync(store.journalPath, contents, { mode: 0o600 });
    expect(() => store.read()).toThrow(/Invalid update journal/);
  },
);

it("refuses path-like identifiers and journal symlinks", () => {
  const { store, input } = fixture();
  expect(() =>
    store.begin({ ...input, transactionId: "../../anything" }),
  ).toThrow(/identity/);
  expect(() =>
    store.begin({
      ...input,
      candidate: { ...input.candidate, releaseId: "../escape" },
    }),
  ).toThrow(/identity/);
  expect(() => store.begin({ ...input, installRoot: "relative" })).toThrow(
    /identity/,
  );
  const outside = join(store.dataDirectory, "outside.json");
  writeFileSync(outside, "{}", { mode: 0o600 });
  symlinkSync(outside, join(store.dataDirectory, UPDATE_JOURNAL_FILENAME));
  expect(() => store.read()).toThrow(/Unsafe/);
  expect(readFileSync(outside, "utf8")).toBe("{}");
});

it.skipIf(process.platform === "win32")(
  "refuses journal files readable by other users",
  () => {
    const { store, input } = fixture();
    store.begin(input);
    chmodSync(store.journalPath, 0o644);
    expect(() => store.read()).toThrow(/private/);
  },
);
