# Managed mutable attachments implementation plan

## Goal

Replace unreleased SQLite BLOB attachment storage with managed plaintext files
under the On Track data directory. Keep attachment identity stable while native
applications edit those files, expose safe Open and Show in Folder actions, and
preserve a single-file restorable export/import workflow.

This plan is approval-gated. It does not authorize production-code, dependency,
or migration changes until a named phase is approved.

## Context and reusable precedent

The current attachment slice buffers multipart uploads, stores bytes in
`note_attachments.content` inside repository transactions, serves them through a
project/note/attachment-scoped route, and opens browser blob URLs. Settings uses
`better-sqlite3` online backup plus a database-file rollback rename. These
ownership queries, upload limits, loopback Host/Origin checks, online backup,
temporary-file conventions, injected ID/clock test seams, and isolated E2E data
directories are reusable.

The important lost guarantee is that SQLite can no longer atomically own both
metadata and bytes. Sidecar creation/deletion, export consistency, import crash
recovery, and native launch therefore require explicit services and failure
rules rather than repository callbacks that happen to touch the filesystem.

The BLOB attachment schema exists only on the unreleased v0.0.3 branch. Version
v0.0.3 will be the minimum supported database and backup baseline for this
feature, so the unshipped attachment migration can be replaced before release
instead of carrying conversion logic for development-only data.

## Acceptance criteria

1. New attachments are copied under `<data>/attachments/v1/`; the active SQLite
   database contains metadata and repository-generated POSIX relative paths, but
   no attachment content BLOBs.
2. The same attachment ID and managed path survive external edits. The next
   project read, download, open, reveal, or browser-focus refresh updates its
   last-known byte size and modified time.
3. Missing, unreadable, non-regular, or symlink-replaced targets preserve their
   database rows and render recoverable, non-crashing broken states.
4. Attachment cards expose separate keyboard-accessible Open and Show in Folder
   actions. Open uses the OS default association; reveal selects the file where
   supported and otherwise opens its containing directory.
5. Native-action requests carry only project, note, and attachment IDs. No API
   accepts or returns a local path, command, executable name, or URL.
6. Every successful export is one restorable `.on-track-backup` file containing
   a consistent SQLite snapshot and all readable managed attachment bytes.
7. Import remains replacement, not merge. It validates and stages the complete
   backup before changing live state, and startup recovers an interrupted swap.
8. Version v0.0.3 is the minimum supported database/backup baseline. Imports
   accept versioned `.on-track-backup` files from v0.0.3 onward, migrate supported
   older bundle schemas forward before activation, and reject pre-v0.0.3 raw
   SQLite or newer unsupported versions without changing live data.
9. Note/project deletion and attachment removal commit database deletion first,
   then best-effort remove sidecars. A cleanup failure may leave an orphan but
   must not lose a referenced file.
10. Tests cover the v0.0.3 schema baseline and legacy rejection, path traversal
    and Windows path tricks, symlink escape, collision/no-overwrite, missing/
    unreadable files, backup validation and interrupted restore, shell-open
    safety, card behavior, and the E2E open/reveal/external-update journey.

## Non-goals

- Cloud sync, collaboration, OCR, indexing, previews, or watching files outside
  the managed data directory.
- Preserving BLOB attachments created from the unreleased development branch.
- Importing pre-v0.0.3 databases or raw SQLite backups.
- File-system watching; metadata refresh is event/read driven.
- Encryption, secure erase, quarantine/Zone.Identifier preservation, or
  confidential-data claims.
- Exact file selection on Linux desktops without FileManager1 support; opening
  the containing directory is the first-release fallback.

## Proposed design

### Managed storage and data model

Add a `ManagedAttachmentStore` as the only component allowed to turn a stored
relative path into an absolute path. Store files as:

```text
attachments/v1/<generated-namespace>/<attachment-id>/<safe-filename>
```

The namespace and attachment ID are application-generated. The final component
is a cross-platform-safe version of the display filename so native associations
remain useful; the original sanitized display name remains independent metadata.
Paths are serialized with POSIX separators regardless of host OS.

The metadata-only `note_attachments` shape is:

```text
id, note_id, filename, media_type, storage_path,
byte_size, modified_at, created_at
```

`storage_path` is non-empty and unique. `byte_size` permits zero because a user
may externally truncate an initially non-empty upload. Availability is derived
from the filesystem and returned as `available`, `missing`, `unreadable`, or
`unsafe`; it is not persisted. A live content hash is also not persisted because
external mutation would immediately make it stale.

Create ordering is private staging file -> flush/close -> same-directory atomic
no-overwrite publication -> durable directory-entry sync where supported ->
database transaction. Newly created directories and their parents are also
synced before publication succeeds. A real sync failure rolls publication back;
platform/filesystem errors that specifically mean directory fsync is unsupported
are recorded as a residual durability limitation. Database failure removes the
new file best-effort. A crash can leave an unreferenced file, but on filesystems
with directory fsync cannot commit a row whose bytes were never installed.
Removal ordering is database commit -> best-effort unlink. Stale staging files
can be cleaned by age; final-file orphan reclamation is deferred until it can
prove non-ownership conservatively.

Chat detail reads batch-stat attachments and update size/modified metadata only
when values changed. Download/open/reveal repeat the check immediately before
use. The client refetches the active project when the browser regains focus, so
returning from an editor refreshes the card without a watcher.

### Path and file security model

Treat every database path as untrusted, particularly after import. The store:

- rejects NULs, absolute paths, drive/UNC paths, backslashes, empty segments,
  `.`, `..`, and paths outside the exact `attachments/v1/...` grammar;
- uses path-segment parsing and `path.relative` containment, never string-prefix
  containment;
- canonicalizes the managed root and existing target, rejects symlinked
  ancestors/targets and canonical escapes, and requires a regular file;
- creates owner-only directories/files, uses exclusive creation, and uses
  no-follow flags where the host supports them;
- reads/copies through an opened descriptor, enforces the attachment size bound,
  and verifies identity, size, modified/change times, byte count, and EOF before
  accepting a mutable-file snapshot.

Pathname-based launch and removal necessarily retain a small same-user time-of-
check/time-of-use window because Node core lacks descriptor-relative OS launch
and unlink APIs. Owner-only managed directories, final identity/containment
checks, and the product's one-trusted-local-user model bound that residual risk;
the verified descriptor keeps attachment reads outside this window.

### Backup/import bundle

Use a versioned SQLite backup container rather than ZIP/TAR. This reuses the
existing database/validation tooling, keeps one browser-downloadable file, adds
no archive dependency, and removes archive traversal, links, entry collisions,
and decompression bombs from the import boundary. The user-facing extension is
`.on-track-backup` and the media type is
`application/vnd.on-track.backup+sqlite`.

The active database never contains file bytes. During export only, an online
backup copy gains two reserved tables:

```text
_on_track_bundle(format_version, schema_version, created_at,
                 attachment_count, total_bytes)
_on_track_bundle_files(attachment_id, byte_size, modified_at,
                       sha256, content)
```

Export acquires a maintenance gate that rejects concurrent mutation/import/
export work, creates a private same-filesystem staging area, and performs an
online SQLite backup. It enumerates attachment rows from that snapshot, resolves
each live file through the store, reads it with before/after descriptor stats,
retries a bounded number of times if it changes, and inserts the copied bytes,
observed metadata, and SHA-256 into the backup copy. It updates only the backup
copy's metadata, verifies exact row/payload counts plus SQLite integrity and
foreign-key checks, and streams the completed file. Missing, unreadable, unsafe, or repeatedly changing files
fail export before response success; On Track must not label a partial backup as
restorable.

Import streams the upload to a bounded private staging file rather than buffering
the whole backup. Before live state changes it verifies SQLite magic and size
limits, full integrity and foreign-key checks, supported schema and bundle versions, exact
tables/columns, one payload per attachment and no extras, declared/actual sizes,
SHA-256 values, attachment count, total bytes, and domain metadata. Stored bundle
paths are not extraction destinations: the importer generates a new namespace
and safe path for every payload, writes with exclusive private files, then
rewrites the staged database paths. It drops the bundle-only tables and compacts
the staged database before activation, so the restored active database again has
no content BLOB table or retained free pages containing bundle payloads.

Import recognizes only the versioned v0.0.3-or-newer backup container. A bundle
with an older supported schema is migrated completely in staging before
activation. Pre-v0.0.3 raw SQLite, the unreleased BLOB schema, and bundles from a
newer unsupported application/schema version are rejected without touching live
state.

### Restore atomicity and crash recovery

SQLite and sidecars cannot be replaced in one filesystem rename. Avoid replacing
the shared attachment root: install imported files first under a fresh generated
namespace, while current paths remain untouched. Then use an owner-only restore
journal and the existing database rollback pattern:

1. Fully validate and stage the compacted database and new attachment namespace.
2. Write/fsync journal state `prepared`, then atomically install the new namespace.
3. Checkpoint/close the live database, rename it to a unique rollback path, and
   advance the journal.
4. Rename the staged database into place, reopen it, run integrity/schema and
   attachment-inventory checks, then mark `committed`.
5. Remove the journal, rollback database, old referenced files, and staging data
   only after success; cleanup failures leave harmless orphans.

Before opening the normal database, startup resolves any journal. Every state
before `committed` restores the rollback database and removes the new namespace;
a committed state keeps the new database and finishes cleanup. Journal updates
use temp-file-plus-rename in the data directory and record only generated
basenames, never arbitrary paths. The import maintenance gate returns a
recoverable service-unavailable response to other data requests during the
close/swap window.

### Native Open and Show in Folder

Expose scoped, side-effecting POST routes ending in `/open` and `/reveal`.
Alongside the existing loopback Host checks, these privileged routes require a
same-origin `Origin`, `Sec-Fetch-Site: same-origin`, a normal JSON/fetch request,
and a narrow rate limit. Missing headers are rejected for these routes even
though non-browser local API clients can call ordinary data routes.

The service resolves the row through project -> note -> attachment ownership,
refreshes status, and passes only a canonical managed absolute path to an
injected `NativeFileActions` adapter. It never accepts or emits a path. The
adapter uses fixed executables and argument arrays with `shell: false`:

- macOS: `/usr/bin/open <path>`; reveal `/usr/bin/open -R <path>`;
- Windows: a fixed non-interactive encoded PowerShell script reads the validated
  path from a dedicated environment value and calls `Start-Process`; reveal uses
  direct `explorer.exe /select,...` as a pragmatic adapter;
- Linux: `xdg-open <path>`; reveal uses `xdg-open <parent>` unless a later
  structured FileManager1 integration is approved.

There is no shell fallback. Unsupported launchers/desktops return a recoverable
not-supported result; broken paths return a recoverable conflict; errors and logs
do not expose absolute paths.

Native Open is execution-adjacent and copied files do not retain source
quarantine or Windows Zone.Identifier metadata. The first release therefore
blocks Open for known executable, installer, script, shortcut, application, and
desktop-launcher extensions and for executable POSIX files; Show in Folder
remains available. MIME metadata is never trusted for this policy. This denylist
does not neutralize active content such as document macros, which remains an
explicit plaintext-alpha risk.

### Attachment card direction

Purpose: let a user scan and act on repeatedly edited working files without
turning message history into a file manager. The direction is calm, compact, and
utilitarian, reusing the existing card, button, color, focus, and typography
primitives. The intentional detail is a stable metadata/status line: size and
modified time when available, or a warning icon plus plain-language broken state
without relying on color.

The card becomes a non-button container with two explicit controls: Open as the
primary action and Show in Folder as the quiet secondary action. Risk-blocked or
broken Open is disabled with an accessible explanation; reveal remains enabled
only when a safe containing directory exists. Controls remain keyboard reachable
with visible focus, labels do not collapse to icon-only affordances, long/localized
filenames wrap safely, and the action row wraps below metadata at narrow widths
and 200% zoom. No new UI dependency or motion is needed.

## Data and migration impact

Replace the unshipped `0002_attachment_messages` migration before v0.0.3 release
so its attachment table is metadata-only from inception: remove `content`, add
`storage_path` and `modified_at`, and allow nonnegative byte sizes. Existing
development databases created from the BLOB migration require an explicit local
data reset. Once v0.0.3 ships, its migration and backup format become immutable;
later releases add forward migrations and apply them to staged imported bundles
before activation.

Deleting a note/project no longer completes file lifecycle through foreign-key
cascade alone. The service/repository boundary must return the validated paths
that become unreferenced so post-commit cleanup can run. Import replacement must
retain the old database and sidecars until the new pair passes reopen and
inventory checks.

## Phases

1. **Managed storage kernel — first independently verifiable phase.** Add the
   unused `ManagedAttachmentStore` with generated path creation, exclusive staged
   writes, read/stat/status, metadata observation, safe removal, and canonical
   resolution. Prove traversal, drive/UNC/backslash tricks, symlinked ancestors
   and targets, collision/no-overwrite, missing/unreadable behavior, owner-only
   permissions, and atomic-write cleanup in focused tests. Do not change the
   schema, routes, current BLOB behavior, dependencies, or UI.
2. **Bundle and recovery primitives.** Add the SQLite bundle codec, streamed
   staging, strict validation, maintenance gate, restore journal, startup
   recovery, and v0.0.3 bundle-version baseline behind focused tests. Keep the
   current transfer endpoints unchanged until the cutover phase.
3. **Release-safe sidecar cutover.** Replace the unshipped migration and add the
   development-schema reset guard; wire the data directory and store through
   startup/app/service boundaries; move upload, download, edit, and delete
   lifecycle to sidecars; add metadata refresh and broken DTOs; and switch
   export/import endpoints and Settings copy/extension to the already-tested
   bundle in the same phase. There must be no reachable build where new sidecars
   exist but export omits them.
4. **Native actions and card UI.** Add the injected platform adapter, privileged
   routes and open policy, client contracts, separate card actions, status/
   modified metadata, focus refresh, responsive behavior, and accessibility
   tests.
5. **Cross-platform/E2E and durable state.** Compose the E2E server with a fake
   native adapter (never launch desktop apps in CI), expose its isolated data
   directory to the fixture, and prove attach -> open/reveal request -> external
   edit -> same attachment ID with refreshed metadata after focus/restart. Manually
   smoke-test native adapters on macOS, Windows, and a Linux desktop. Add the
   accepted ADR and update project/architecture/README text.

Each phase is a separate reviewable outcome. Phases 2 and 3 may be implemented
consecutively but Phase 3 cannot ship without both passing.

## TDD and test plan

Every production behavior starts with a focused failing test and records RED ->
GREEN -> REFACTOR evidence.

- Storage unit/integration: path grammar, generated names, atomic create, file
  descriptor stat/read, zero-byte external edits, traversal variants, symlinks,
  non-regular files, missing/unreadable state, collision, cleanup, and POSIX modes.
- Bundle/import: complete round-trip, metadata snapshot, mutation-during-export
  retry/failure, broken-file export refusal, payload/count/size/hash mismatch,
  unsupported/legacy versions, extra/missing payloads, size limits, forward
  migration in staging, restore failure at every journal state, restart recovery,
  and no active BLOBs.
- Database/service/API: clean v0.0.3 migration, development-BLOB reset guidance,
  append/edit/delete rollback ordering, scoped download/open/reveal, maintenance
  conflicts, Host/Origin/fetch metadata, generic errors, and native-action rate
  limits.
- Native adapter: every platform command shape; spaces, quotes, commas, leading
  dashes, shell metacharacters, and newlines remain one non-shell argument;
  unsupported launchers and executable-policy cases fail closed.
- Client/component: both actions and busy/error states, disabled explanations,
  missing/unreadable/unsafe cards, modified metadata refresh, keyboard/focus,
  long labels, mobile layout, and 200% zoom.
- E2E: fake native action receipts plus direct mutation of the isolated managed
  file prove stable identity and refreshed metadata across focus and restart.

Focused commands are discovered/revalidated before each phase. Expected first-
phase evidence is:

```sh
npm test -- src/server/attachments/managed-attachment-store.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Before any phase is called complete, use the verification loop: relevant focused
tests, build/types/lint/format, coverage, migrations for persistence changes,
E2E for the product cutover/UI, dependency audit, full diff review, and finally
`npm run verify` when the complete feature is assembled.

## Risks and mitigations

- **Cross-resource atomicity:** install new files before database references;
  delete database references before files; use a restore journal and retain the
  old pair until validation succeeds.
- **Directory-entry durability:** fsync the file, new directories, and affected
  parents before database commit; roll back real sync failures. Some Windows or
  network filesystems do not expose directory fsync through Node, leaving a
  documented power-loss residual that requires cross-platform smoke tests.
- **Mutable export race:** gate On Track writes, copy through descriptors, compare
  before/after stats, retry boundedly, and fail rather than emit a partial bundle.
- **Path/symlink escape:** central resolver, exact grammar, lexical plus canonical
  containment, no-follow reads, generated destinations, and adversarial tests.
- **Memory/disk pressure:** stream bundle transfer; retain the 100 MB per-file
  bound; add total import/entry bounds and free-space preflight. SQLite payload
  insertion still buffers one bounded file at a time. Export may need about twice
  and restore about three times live data size while rollback exists.
- **Windows locks:** preflight install/swap capability and fail before live
  replacement when possible; preserve rollback and surface actionable errors.
- **Native execution:** explicit user POST only, strict browser headers, scoped
  ID lookup, no shell, fixed commands, dangerous-file blocking, and no path leaks.
- **Broken files:** preserve rows and last-known metadata, fail restorable export
  explicitly, and keep edit/removal available.
- **Early-alpha data:** replace only the unshipped migration, require an explicit
  development-data reset, and freeze the new migration once v0.0.3 ships.

## Assumptions and approved-decision candidates

- Database and backup compatibility begins at v0.0.3; all earlier databases,
  raw SQLite exports, and unreleased BLOB attachments are unsupported.
- Successful backups must be complete. Export fails if a managed file is broken
  rather than producing a knowingly partial restore.
- A portable backup may contain BLOB payloads even though the active database may
  not; its reserved format tables are removed and compacted before activation.
- Open is blocked for clearly executable/launcher-like files; this is the one
  intentional security exception to “use the default app for every attachment.”
- No production dependency is required by the proposed SQLite-container format
  or native adapters.

## Approval status

Phases 1 and 2 were approved and implemented. Phases 3-5 remain approval-gated;
the next independent decision is whether to implement Phase 3's release-safe
sidecar cutover as proposed.

## Completion evidence

Phase 1 implemented without wiring production routes, persistence, dependencies,
or UI:

- RED: the focused test suite failed because the managed storage module did not
  exist.
- GREEN: generated/private no-overwrite publication, durable directory syncing,
  bounded consistent reads, external metadata observation, traversal/UNC/
  backslash rejection, symlink/junction boundaries, missing/unreadable/unsafe
  states, and safe removal are covered by focused tests.
- Focused tests pass with 36 tests and one Windows-only junction test skipped on
  macOS. Module coverage is 91.77% statements, 85.79% branches, 100% functions,
  and 93.48% lines.
- `npm run verify` passes: release contract, production build, type checking,
  lint, formatting, 152 covered tests with one platform skip, 14 migration
  tests, eight desktop/mobile E2E tests, and a production dependency audit with
  zero vulnerabilities.
- Independent correctness/security review found no remaining actionable Phase 1
  findings.

Phase 2 implemented without changing the current BLOB schema or transfer routes:

- RED: focused suites failed because the maintenance gate, staged upload, SQLite
  bundle codec, restore journal, and startup composition modules did not exist.
- GREEN: bundle creation/validation/preparation, bounded incremental upload
  staging, transfer concurrency, generated restore workspaces, inventory-aware
  activation, and idempotent crash recovery are covered by 84 focused tests.
- Validation rejects raw/pre-v0.0.3 SQLite, unsupported versions, weakened schema
  definitions, count/size/hash mismatches, unsafe paths and symlinks, incomplete
  attachment inventories, and ambiguous recovery layouts before deleting
  rollback state.
- Production startup checks for an interrupted restore journal before opening
  SQLite. Current export/import endpoints remain unchanged until Phase 3.
- Focused Phase 2 coverage exceeds 80% for statements, branches, functions, and
  lines; the bundle codec alone records 86.33% statements, 80.37% branches,
  97.43% functions, and 86.83% lines.
- `npm run verify` passes: production build, type checking, lint, formatting, 236
  covered tests with one platform skip, 14 migration tests, eight desktop/mobile
  E2E tests, and a production dependency audit with zero vulnerabilities.
- Independent correctness/security review found no remaining actionable Phase 2
  findings.
