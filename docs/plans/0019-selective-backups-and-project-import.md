# Selective backups and project import implementation plan

Status: approved by the user on 2026-09-09 for the complete slice (Phases 1–4).
Implementation and verification are complete.

## Goal

Let users export selected projects and import selected projects either by
replacing their database or adding independent projects to it. The user confirmed
that import also needs project checkboxes, with all projects selected by default.

## Context and reusable precedent

- `src/client/App.tsx`: `BackupSettingsWorkspace` contains the existing file
  input, export action, replacement confirmation, and busy/error/status states.
  App-level `importDatabase` refreshes projects and invalidates session state.
- `src/client/api.ts` currently downloads through `GET /api/database/export`
  and uploads raw backup bytes through `PUT /api/database/import`.
- `src/server/database-transfer/sqlite-backup-bundle.ts` owns online snapshots,
  strict schema/integrity/payload validation, trusted legacy migrations,
  managed-file extraction, and candidate compaction.
- `staged-upload.ts` supplies bounded private streaming uploads;
  `maintenance-gate.ts` excludes conflicting database operations.
- `restore-journal.ts` safely activates a replacement database and a single
  generated attachment namespace. Its exact-inventory validation must remain
  intact; a merged database retaining old paths cannot use that activation path.
- `ManagedAttachmentStore.create` and `ChatService.installAttachments` already
  publish and flush new files before inserting references, compensating on
  failure. ADR-0006 explicitly permits unreferenced files after interruption.
- Current working-tree Archive work introduces schema 7. Build on it and preserve
  those existing edits. Supported backup schemas are currently 3–7; metadata is
  version 0.0.6. Existing project names are not unique and have an 80-character
  JavaScript validation limit.

Research checked the installed [better-sqlite3 package](https://www.npmjs.com/package/better-sqlite3?activeTab=versions)
and its maintained [v12.10.0 API](https://github.com/WiseLibs/better-sqlite3/blob/v12.10.0/docs/api.md).
Its existing backup and transaction APIs are sufficient; no new package or
archive format is warranted. SQLite documents that deleted content can remain
in database pages until [VACUUM removes it](https://www.sqlite.org/lang_vacuum.html).
The installed [multipart v9.3.0 API](https://github.com/fastify/fastify-multipart/tree/v9.3.0)
supports streamed parts, request-specific limits, and truncation detection.

## Acceptance criteria

1. Export lists all projects, including Pinned and Archive, with native labeled
   checkboxes. All are selected initially. **Export all** always exports every
   current project; **Export selected (N)** exports exactly the checked IDs.
   Select all/clear controls and a selected count make the state explicit.
2. Each exported project includes its complete messages, labels, participant
   attribution, attachments, appearance, pin/archive state, timestamps, and
   long-message setting. Excluded projects leave neither rows nor recoverable
   message/file bytes in the delivered bundle. Source data is unchanged.
3. Selecting an import file validates it and displays its projects, all checked
   initially. Include title, archive/pin context, message/file counts, and project
   creation time to help distinguish duplicate titles. Identify choices by ID.
4. Import provides explicit radio choices **Merge DB** and **Replace whole DB**.
   Proposed default: Merge DB. Switching modes preserves project selection.
5. Merge imports only checked projects as independent copies. Existing projects,
   messages, settings, identities, attachment paths, and files remain unchanged.
   A missing or unreadable existing attachment does not prevent a valid merge.
6. Conflicting imported titles become `<title>_<import_datetime>`. Use one UTC
   timestamp per operation, e.g. `A_2026-09-09_14-30-00Z`; add `_2`, `_3`, etc.
   when necessary. Resolve conflicts against all current projects and the other
   selected imports. Preserve nonconflicting imported titles.
7. Replacement makes the selected imported projects the entire database. With
   all selected, this retains today's whole-backup restore behavior. Confirmation
   explicitly states that ALL current projects and files will be removed,
   including projects absent from the selection. No project/message matching or
   conflict renaming occurs in replacement mode.
8. Disable selected actions when no projects are checked. Preserve export of an
   empty workspace through Export all. An originally empty backup may explicitly
   replace with an empty database after confirmation; merging it does nothing.
   Clearing a nonempty backup's selection never means delete everything.
9. Invalid selections, unsupported/corrupt backups, oversized or truncated
   uploads, changed files, and precommit failures leave live project data intact.
   Validate the entire backup even when only some projects are selected.
10. Success reports imported count and actual renames. Prevent duplicate clicks
    and stale preview responses. A failed post-import refresh is identified as a
    refresh failure after success, so users are not encouraged to re-import.
11. Existing full-export and full-replacement API behavior remains compatible.
    Support the same schema-3–7 backup inputs and `.on-track-backup` output.
12. Keyboard controls, focus, status/error announcements, light/neutral/dark
    themes, narrow layouts, long titles, and 200% zoom remain usable.

## Non-goals

Message merging, synchronization, deduplication across repeated imports, changing
the database schema, new dependencies, alternate backup formats, encryption,
general orphan cleanup, commits, publishing, or release work.

## Proposed design

### Settings interaction

Extend the existing flat Settings workspace with separate Export and Import
sections. Reuse typography, spacing, theme tokens, focus styles, and semantic
button colors. The visual signature is a compact project checklist paired with
an explicit selected count and action. No imagery or new design system is needed.
This is an occasional local data-management task: keep the selection and its
consequence adjacent, and reserve destructive styling for replacement.

The import flow is file -> validation -> selection and mode -> import -> result.
Show a concise naming example for merge. Keep the completed result in Settings;
refresh the canonical workspace state behind it. Replacement invalidates project
reading positions and drafts as today. Merge retains valid existing session
state while refreshing summaries. Guard both request start and completion against
stale project reads/mutations, following existing App patterns.

### Transport and preview

- Retain `GET /api/database/export` for all projects. Add JSON
  `POST /api/database/export` for a validated explicit project-ID selection.
  Share the existing three-per-minute export budget across both methods.
- Add `POST /api/database/import/preview` accepting streamed backup bytes.
  Stage, validate, compute SHA-256 incrementally, and return the digest plus
  project summaries. Dispose of staging at request completion. Preview must not
  extract files into live storage or modify the database.
- Add multipart `POST /api/database/import` containing exactly one backup file
  and one bounded JSON options field: mode, selection (`all` or explicit IDs),
  and preview digest. The UI sends options before file bytes; the server handles
  part order safely and rejects extra/duplicate fields, invalid IDs, duplicate
  IDs, unknown modes, missing parts, and truncation before mutation.
- Re-upload the same browser File on confirmation; stage and validate again,
  then require its digest to match the preview. This avoids persistent upload
  sessions/tokens, at the cost of a second local transfer and validation.
- Keep legacy binary PUT as replace/all through the shared import service.
  Both commit endpoints share the existing two-per-minute import budget.
  Give preview a separate two-per-minute process budget so it does not consume
  commit attempts. Permit only one expensive staging/validation import request
  at a time and release that guard on errors/disconnects.
- Apply existing bundle/file/count/byte limits. Override multipart limits only
  on this route so the existing 100 MB note-file limit does not restrict a
  2 GiB backup. Bound options to 1 MiB; reject oversized selections clearly.
  Retain Host/Origin checks, private generated paths, no-store responses, and
  sanitized errors. Never accept a client filesystem path or SQL statement.

### Selective export and replacement

Snapshot under `runExport`, verify selection against that snapshot, then delete
unselected projects in the private copy with foreign keys enabled. Cascades
remove dependent records. Enumerate and read attachments only after selection,
so an excluded project's broken file cannot block export. Apply bundle limits
to the resulting selection. Compact outside the pruning transaction, build
payloads/manifest, and run the existing strict final validation before streaming.
Compaction is mandatory to remove excluded data from free pages.

For replacement, fully validate the uploaded bundle first; operate only on its
private candidate. Prune unselected projects and corresponding payload rows,
update manifest counts, preserve strict validation, migrate through trusted
migrations, and extract only retained attachments into the fresh restore
namespace. Reuse journal activation, rollback, and old-file cleanup unchanged.

### Merge and naming

Prepare selected imported records from a validated, privately migrated candidate.
Do not call ordinary create-project/create-note use cases, which would generate
defaults and alter timestamps. A focused database import module copies explicit
allowlisted columns and relationships with prepared, parameterized statements.
Never copy incoming migration/app metadata into the live database.

Hold `runRestore` across name/ID allocation, file publication, and commit. Generate
fresh project, note, and attachment IDs and remap every foreign key, including
label assignments. Install only imported attachment bytes through the existing
managed store with fresh paths; preserve source timestamps where supported and
record observed filesystem metadata as restore already does.

Insert the entire selected set in one SQLite transaction. On a known rollback,
remove only files created by this attempt. After a successful commit, never run
rollback cleanup even if response delivery or UI refresh fails. An interruption
before commit may leave private unreferenced files, matching ADR-0006; it must not
leave partially imported projects or remove existing files. Existing replacement
journal validation/recovery stays unchanged.

Title comparison is proposed as exact, case-sensitive equality of already
trimmed names: `A` and `a` are distinct. Process selected projects deterministically
by source ID; reserve unchanged incoming titles before allocating renamed titles.
Truncate only the title prefix to fit the existing 80 UTF-16-unit limit, keeping
the complete timestamp/counter suffix and never cutting a surrogate pair.
Recompute conflicts against live state at commit time; return actual mappings.

## Data and migration impact

No new migration, schema version, backup version, or production dependency.
Selective exports remain ordinary supported backups. Replacement preserves source
identities; merge regenerates identities but preserves project content/settings.
Browser-local appearance remains outside backups. No application data is used
for tests: all transfer and failure tests run against isolated fixture directories.

## Phases

1. **Selective export:** add contracts, snapshot filtering/privacy compaction,
   API, and export checklist. Evidence: failing-then-passing selection tests,
   real-bundle inspection, component tests, and unchanged full-export behavior.
2. **Preview and selective replacement:** add streamed preview/digest, multipart
   selection contract, selected candidate preparation, and import selection UI.
   Evidence: round trips, stale-preview/error tests, legacy compatibility, and
   existing journal failure/restart tests.
3. **Project merge:** add deterministic naming, ID/relationship remapping,
   managed-file publication, transactional insertion, result UI, and session
   refresh behavior. Evidence: collision/repeat-import tests and injected file,
   database, disconnect, and process-interruption failures.
4. **Review and verification:** use reviewer role and security-review skill;
   inspect rendered desktop/mobile workflows and run verification-loop. Update
   README, CHANGELOG, docs/PROJECT.md, docs/ARCHITECTURE.md, and ADR-0006 only
   where implemented transfer behavior changes their stated truth.

Likely files: `src/domain/types.ts`, `validation.ts`, `src/client/api.ts`,
`App.tsx`, `styles.css`; `src/server/app.ts`; database-transfer bundle/staging
modules; new focused `project-import.ts` and `src/server/db/project-import.ts`
modules with tests; existing API/client/component/bundle/recovery suites; and a
new `e2e/database-transfer.spec.ts`. Extract the expanded Settings component if
needed for a focused file, without unrelated App refactoring.

## Test plan

- Domain: all/explicit/empty/unknown/duplicate selection, exact-case names,
  existing and incoming duplicates, suffix collisions, repeated same-second
  imports, maximum-length and Unicode titles, fixed clock/ID factories.
- SQLite/bundle: subset with all relations and Archive fields; excluded unique
  text/file sentinels absent from raw exported bytes; unreadable selected versus
  excluded attachments; schema-3–7 compatibility; preserved timestamps/settings;
  same-backup merge with overlapping IDs; existing missing files unchanged.
- Failure/recovery: corruption even in excluded payloads, digest mismatch,
  invalid multipart limits/order/truncation, unsafe paths, disk/file publication
  errors, transaction rollback, cancellation, busy gate, rate-limit sharing,
  process exit before/after merge commit, and replacement journal failpoints.
- Client/E2E: export all/subset -> preview -> merge/subset replacement -> restart;
  default checks/mode, clearing selection, duplicate titles, destructive confirm,
  stale previews, retry after validation error, failed refresh after commit,
  actual rename results, keyboard and desktop/mobile layouts.
- Use targeted `npm test -- <affected test paths>` during RED/GREEN. Final
  `npm run verify` runs release check, build, typecheck, lint, formatting, enforced
  coverage, migrations, desktop Chromium/mobile WebKit E2E, and security audit.
  Inspect the full scoped diff and report exact results and remaining limits.

## Risks and mitigations

- Replacement still deletes current data after explicit in-app confirmation;
  partial replacement copy must make that consequence unmistakable.
- Backup preview transfers and validates twice. Stream bytes, hash incrementally,
  retain bounded attachment reads, and display progress/busy states. Avoid adding
  a retained-upload subsystem until measured need warrants its recovery surface.
- Merge may leave unreferenced files after interruption. Preserve existing
  file-before-reference ordering; do not add broad or speculative cleanup.
- A lost response after committed merge is ambiguous and retrying creates more
  copies. Do not retry automatically; prompt a project refresh/check first.
- Imports can grow the workspace beyond one bundle's export limits. Keep those
  limits explicit; selective export remains available for smaller project sets.
- The baseline has uncommitted Archive changes and a documented moderate Fastify
  advisory. Preserve those edits and report inherited verification risks.

## Approved decisions

The approved defaults are implemented: Merge DB initially selected;
exact case-sensitive name conflicts; UTC timestamp suffix; selected projects
become the entire database in Replace mode. Import checkboxes with all selected
are confirmed by the user. No open product decisions remain for this slice.

## Implementation and verification

- Completed all four phases against Archive commit `adc85d1`. No new schema,
  production dependency, commit, or remote mutation was introduced. The expanded
  UI and transfer routes were extracted into focused components/modules.
- Selective export tests failed first because excluded rows remained in the
  bundle; snapshot pruning and compaction made them pass. Preview/import API
  tests first failed on the missing route. The initial UI test failed on missing
  Merge controls. A review regression reproduced a stale initial-load error
  after successful import before the response-generation guard was added.
- API and database coverage verifies independent IDs, preserved messages,
  participant attribution, labels/settings, archive state, selected legacy
  schema-3–6 imports, existing missing files, deterministic title collisions,
  Unicode length limits, and unchanged existing attachment bytes/paths.
- Fault tests cover full transaction rollback, partial file publication,
  malformed multipart options, shared rate budgets, digest mismatch, response
  disconnect after upload, and real child-process exit before/after SQLite
  commit. Uncommitted imports leave no partial database records; newly published
  unreferenced files may remain after process exit, as documented.
- Reviewer/security review found and resolved disconnect-before-commit,
  pending-note mutation, initial-load response, and concurrent preview issues.
  The follow-up review found no remaining blocker.
- `npm run verify`: passed release contract, production build, typecheck, lint,
  formatting, coverage, migrations, browser journeys, and the dependency audit
  gate. The loopback disconnect test requires execution outside the local
  sandbox; the successful aggregate run used that permission.
- Unit/component/API/database suite: **570 passed, 1 existing skip**.
  Focused migrations: **22 passed**. Browser suite: **33 passed, 3 existing
  mobile skips**, including desktop Chromium and mobile WebKit selected
  export/merge/replacement/restart journeys.
- Coverage: **92.45% statements, 87.42% branches, 95.25% functions,
  93.84% lines**. New import modules and Settings component exceed 80% measured
  behavior coverage.
- Visual QA inspected Light, Neutral, and Dark, 1440px desktop and 390px narrow
  layouts, 200% CSS zoom, keyboard checkbox interaction, visible focus,
  forced colors, and reduced motion. A secondary-button contrast issue was
  corrected by reusing the existing quiet-button class. After that class-only
  correction, production build, the four focused Settings tests, formatting,
  and the supplementary Playwright visual/keyboard check passed. Physical
  screen-reader use and browser-native zoom were not separately tested.
- Remaining risks: the pre-existing moderate Fastify advisory remains; the
  production audit passes its high-severity gate. Vite reports the main bundle
  slightly above its 500 kB advisory size threshold. Backups remain plaintext;
  lost responses after commit require checking projects before retrying. Local
  macOS verification does not replace the release platform matrix.
