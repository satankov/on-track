# Release upgrade and recovery qualification — Slice B

## Goal and approval

The user approved local Slice B on 2026-10-29: qualify the published v0.1.0
schema-7 data path to current schema 9, backup replacement and merge, and
interrupted-update recovery. No commit, push, GitHub mutation or publication is
authorized by this slice. Preserve the user's README edits and the pinned v0.0.8
managed-upgrade baseline. No release version is selected here.

## Context and reusable precedent

- v0.1.0 is commit `f42a822655ad99566df4356f263dd88cb2a050bb`; its eight
  migrations end at `1789027200000`. Their checked-in SQL remains byte-identical
  to the tag. Current source adds preferences and project labels in schema 8/9.
- Existing migration and legacy-backup tests reconstruct schema 7 by rewinding
  a current database. Existing checkpoint tests cover schema 6 and synthetic
  schema transitions; CLI tests already exercise the durable commit boundary.
- Reuse Drizzle's migrator, SQLite checkpoints, import preview/activation APIs,
  and managed-update recovery. No additional infrastructure or dependency is
  needed. ADR-0008 and ADR-0013 remain the recovery and preference contracts.

## Acceptance criteria

1. Build a disposable schema-7 fixture forward from the released journal and
   hash-pinned local migration files, without Git or network access at test time.
2. Upgrade and reopen it with schema 9, preserving project/note/attachment IDs,
   timestamps, archive and pin state, sender, disabled built-in assignments and
   readable attachment bytes. Missing local files remain metadata records.
   Preferences begin uninitialized; integrity and foreign keys remain valid.
3. Preview and import a selected archived project from a schema-7 backup fixture
   through both replacement and merge. Preserve destination preferences;
   replacement keeps source IDs, merge generates independent IDs/paths, and
   excluded projects/files stay excluded. Reopening preserves the result.
4. Recover an uncommitted real schema-7-to-9 update to its prior code and data,
   including repeated recovery. After durable commit, keep candidate selection
   and subsequent writes. Exercise interrupted checkpoint restore with real
   released data as well as existing synthetic cases.
5. Keep all existing compatibility cases and pass focused tests, full local
   verification, and the managed-upgrade gate with its unchanged checksum-pinned
   v0.0.8 release baseline.

## Design and affected files

- Add a shared test helper and textual release provenance under `src/test/`.
  It seeds synthetic archived/pinned projects, attributed notes, inactive Todo
  assignments, and managed attachment bytes. Hash checks prevent edited old
  migrations from silently changing the baseline.
- A frozen format-1 envelope mirrors the tagged export contract. This is a
  release-schema compatibility fixture, not an export produced by a running
  released binary. Valid bundles contain every attachment payload; missing-file
  preservation is tested only in live upgrades and checkpoint recovery.
- Extend `database.test.ts`, `project-import.test.ts`,
  `database-checkpoint.test.ts`, and `cli/update.test.ts` with focused integration
  assertions. Retain existing fixtures and tests.
- Record evidence here and link it from `docs/PROJECT.md` when complete.
- Update the managed compatibility harness only if its assertions assume the old
  schema; retain the actual released CLI, artifact hashes and compatibility floor.

## Phases and verification

1. Add released-schema fixtures and live/backup qualification tests; run those
   focused Vitest files. These characterize implemented behavior. If a defect
   appears, establish a failing behavioral test before a minimal production fix.
2. Add real migration/checkpoint and commit-boundary cases; run focused recovery
   tests. Review database/file ownership, attachment preservation and rollback.
3. Run `CI=true npm run verify` and
   `node scripts/managed-upgrade-compat.mjs --baseline v0.0.8`, then independent
   correctness/security review and final diff inspection.

## Data impact, risks and limits

No production data, shipped migration, schema version, backup format or runtime
dependency changes are planned. Tests use temporary synthetic data only. Keep
fixtures independent from current migration and backup builders. Checkpoint
recovery cannot restore external attachment edits; startup migrations currently
do not mutate attachments. Local macOS evidence cannot substitute for Linux,
Windows, clean-machine/manual checks, or a published candidate upgrade.

## Open decisions

None for this approved local slice. Release version and publication remain
separate decisions.

## Implementation and verification — 2026-10-29

Added eight integration cases: one live migration/restart, two selected backup
import modes, three checkpoint interruption points, and two managed-update
commit states. All eight released migration hashes and the frozen journal were
independently checked against the peeled v0.1.0 commit. The helper normalizes
Windows checkout CRLF to the released Git blobs' LF before hashing; it does not
derive its baseline from current migration metadata. Backup envelope definitions
were checked against the tagged exporter.

No production defect was found and no production code was changed. The eight
integration cases qualify existing behavior. Initial
failures corrected test setup/expectations: replacement intentionally allocates
a fresh attachment directory, custom-label IDs require the `custom-` prefix,
and an existing socket-cancellation test needs access outside the sandbox.

The first published-baseline run exposed a real test-harness defect after the
old CLI successfully activated the schema-9 candidate: its inspection queried
the removed `chat_enabled_labels` table. The harness now projects the released
project fields and built-in enablement/assignments from either schema, while
separately expecting schema metadata to advance to the candidate's declared
version. Precommit refusal still requires the exact original schema-7 snapshot.
No baseline artifact, checksum, runtime pin, download or updater behavior changed.
The initial failing log is `/tmp/ontrack-slice-b-compat-red.log` (local only).

- Focused five-suite run: **148 passed**, including legacy bundle validation.
  Command: `npm test -- src/server/db/database.test.ts src/server/database-transfer/project-import.test.ts src/server/database-transfer/sqlite-backup-bundle.test.ts src/server/runtime/database-checkpoint.test.ts src/server/cli/update.test.ts`.
- `CI=true npm run verify`: **PASS** on macOS arm64, Node 22.18.0, npm 11.5.2.
  Release contract, build, typecheck, lint and formatting passed; 83 test files,
  **1,120 tests passed**, nine platform skips; **28 migration tests passed**;
  **82 browser tests passed**, 16 intentional viewport skips. Managed lifecycle,
  failed/successful migration recovery, postcommit restart, and uninstall
  retention/purge smokes passed. Production audit reported zero vulnerabilities.
- Coverage: statements **91.09%**, branches **85.64%**, functions **93.01%**,
  lines **92.23%**; all repository thresholds passed.
- Independent correctness/security review found one test gap: excluded payloads
  could have remained as orphaned files without failing the new import test.
  Added a recursive destination attachment-file assertion; the reviewer
  confirmed it closes the finding. No remaining actionable findings.
- After that assertion and fixture normalization, reran all four changed suites:
  **80 passed**. Full-run log: `/tmp/ontrack-slice-b-verify.log` (local only).
- `node scripts/managed-upgrade-compat.mjs --baseline v0.0.8 --cache /tmp/ontrack-managed-compat-cache`:
  **PASS** with unchanged released artifacts and pinned Node **24.14.0** on
  macOS arm64. Running, stopped and prepared-installer upgrades all passed;
  precommit refusal recovered the old selection, and successful paths preserved
  data/attachment bytes, both aliases, old backup restore, installer rerun and
  postcommit restart. This is the GREEN run for the schema-aware harness fix;
  independent review found no over-normalization or remaining findings.
  Log: `/tmp/ontrack-slice-b-compat.log` (local only). `99.0.0` is used only in
  disposable candidate copies, not as a selected release version.
- Final typecheck, lint, formatting and `git diff --check` passed. The user's
  README diff was compared byte-for-byte with its pre-slice snapshot and remains
  unchanged. No shipped migration, application code or dependency file changed.

The existing non-module bootstrap-script and large-client-chunk build warnings
remain unchanged. Process control is mocked in the CLI integration tests; the
separate managed smokes exercise real local child processes. A frozen schema-7
bundle is not proof that an unmodified v0.1.0 executable exported that bundle.
No Linux/Windows, clean-machine, assistive-technology, native-action or live
published-candidate result is implied by this macOS qualification.

## Outcome

The approved local Slice B is complete. The remaining release gates are the
platform matrix and manual/published-candidate checks described in
`docs/RELEASING.md` and tracked by the existing installation/platform issues.
No push, issue modification, tag or release was performed.

## Remaining local platform qualification — 2026-10-29

After committing Slice B as `4f3e134`, the user requested continuation of the
remaining release work. The next local checks use that exact commit in two
independent disposable clones, leaving the user's README edit and working
installation unchanged.

1. Verify and extract official macOS arm64 Node 22.16.0 and the already pinned
   Node 24.14.0 into temporary directories. Keep separate dependencies and build
   outputs for their different native ABIs.
2. Sequentially run clean `npm ci`, native SQLite loading, and
   `CI=true npm run verify` on both runtimes. The Node 24 aggregate also exercises
   the real two-process managed-uninstall dispatcher relevant to issue #62.
3. Run `node scripts/verify-managed-runtime.mjs` once to verify all four pinned
   runtime archives against official checksums and sizes. Rehearse managed asset
   packaging from the clean committed copy without publishing or selecting a
   new release version.
4. Reconcile current GitHub results by commit and distinguish completed local
   checks from remaining Linux/Windows/macOS Intel, clean-machine and real
   desktop/published-upgrade checks. Do not repeat the completed v0.0.8 baseline
   gate without a relevant change.

Acceptance: both local runtime gates and artifact checks pass, or concrete
failures are diagnosed and recorded. No application feature, schema, dependency
version, system Node, shell profile or user data change is planned. Test outputs
stay outside tracked source. Remote mutations and publication remain separate
actions requiring explicit approval under `AGENTS.md`.

The user selected **v0.1.1** during this qualification. Prepare matching package
and lockfile versions plus complete release notes, retaining the published
v0.1.0 history. Validate the local release contract with `RELEASE_TAG=v0.1.1`.
The runtime matrix above qualifies implementation commit `4f3e134`; final
versioned packaging and remote CI must identify the eventual candidate commit.

### Runtime matrix and version preparation results

On macOS **15.8.1 (24H32), arm64**, zsh 5.9, both independent clean clones of
`4f3e134755a4d3e951cdbd3bc8e2e5386651c3aa` passed:

| Runtime      | Bundled npm | Clean install/native SQLite | Full verification |
| ------------ | ----------- | --------------------------- | ----------------- |
| Node 22.16.0 | 10.9.2      | PASS; SQLite 3.53.1         | PASS              |
| Node 24.14.0 | 11.9.0      | PASS; SQLite 3.53.1         | PASS              |

Each aggregate passed 83 files/1,120 tests (nine platform skips), 28 migration
tests, 82 browser tests (16 intentional skips), audit with zero production
findings, and real-process lifecycle/update/uninstall checks. Coverage remained
91.09% statements, 85.64% branches, 93.01% functions and 92.23% lines. The Node 24
uninstall log confirms dispatch through `bin/command.mjs`, adding macOS arm64
evidence for issue #62. This does not qualify its Windows/Linux requirements.
Logs and runtime provenance are under `/tmp/ontrack-release-matrix.g66KCz/`.

The clean implementation snapshot passed managed-asset packaging with floor
`0.0.7`. That rehearsal retained its old manifest version and is stored under
`packaging-rehearsal-not-for-publication`; those assets are not v0.1.1 release
assets. Final versioned assets require the committed preparation.

The user-selected v0.1.1 changes only the three root manifest version fields;
dependencies are unchanged. Complete release notes cover the previously missing
flat UI, preferences, intersecting filters, custom labels and schema-9 upgrade
limits. `RELEASE_TAG=v0.1.1 npm run release:check`, all 24 release-contract tests,
and the versioned build passed. Review found no actionable release-preparation
issues. The user subsequently requested inclusion of their README addition.

Current GitHub main is `6bb41be`, whose October 23 matrix passed. It does not
contain the candidate. The old PR #68 Node-24 failure was the Zod audit already
fixed locally; its Node-22 job timed out during Ubuntu package downloads before
tests. All five native jobs on that PR passed. Neither result qualifies the
current candidate. Fresh CI is still needed without weakening its gates.

Main's docs-only squash `6bb41be` has the same tree as local `9ee198e`. A merge
preview identifies only a README screenshot-caption conflict and three screenshot
conflicts; the release branch contains the newer versions. Replaying the release
commits onto current main while omitting that equivalent docs commit can preserve
the final content. The user approved that rebase, branch push and draft PR.
The rebase preserved the complete committed tree byte-for-byte, including the
README addition; the preparation commit became `5a21caf` (previously `f0492fa`).
[Draft PR #73](https://github.com/satankov/on-track/pull/73) now targets current
main. The user will review its CI results; this task does not wait for them.

The direct official-runtime verifier did not finish on this network: the first
attempt verified macOS arm64 then timed out downloading Intel, and the second
ended with a terminated response. Separate bounded HTTPS downloads from the
official URLs then completed. The same unchanged `verifyRuntimePins` validator
read those cached bytes and the official checksum list: **all four platform
archive hashes and sizes passed**. Log: `runtime-pins-cached.log` under the local
qualification directory. This fallback changes no production script or runtime
pin and does not verify detached signatures or platform execution.

The committed v0.1.1 preparation also passed versioned build, release contract
and managed-asset packaging under Node 24.14.0. Local rehearsal assets are in
`v0.1.1-candidate-assets` and identify pre-rebase commit `f0492fa`; the rebased
source tree is identical. Final publication must regenerate assets for the
reviewed main/tag commit. No local assets were uploaded, no PR was merged, and
no tag or GitHub Release was created.
