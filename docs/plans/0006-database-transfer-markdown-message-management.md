# Database transfer, Markdown, and message management plan

## Goal

Add the first post-alpha local data-transfer controls and message-management
workflow: export/import the SQLite database from Settings, render notes as safe
Markdown, and let users copy, edit, retimestamp, and delete messages.

## Context and reusable precedent

The v0.0.1 architecture already keeps one Fastify process as the sole SQLite
owner and uses Zod, repository transactions, and loopback Host/Origin checks at
the API boundary. `better-sqlite3` provides an online backup API suitable for
exporting a consistent SQLite file while the app is running. `react-markdown`
renders Markdown to React elements without `dangerouslySetInnerHTML`, and
`remark-gfm` adds familiar GitHub-flavored Markdown syntax. The final release
also uses `@fastify/rate-limit` on database transfer routes so repeated requests
are stopped before additional filesystem/database work runs.

The worktree already contains the workspace-state and scroll-containment changes
from plan 0005; this slice preserves those edits and builds on the fixed
sidebar/footer structure.

## Acceptance criteria

1. A settings button replaces the static local-only sidebar footer and opens an
   accessible Settings dialog.
2. Export downloads a SQLite backup of the current local database.
3. Import accepts a selected SQLite backup only after confirmation, validates it,
   replaces the active local database, refreshes the project list, and does not
   merge histories.
4. Invalid, empty, future-schema, corrupt, or non-On Track imports fail without
   replacing the current database.
5. Notes render Markdown while raw HTML remains inert.
6. Existing notes can be copied to the clipboard, edited, retimestamped, and
   deleted.
7. Note mutation keeps deterministic `(created_at, id)` ordering and updates chat
   activity to the newest remaining note.
8. Desktop and mobile browser journeys cover the settings and message-management
   flows.

## Non-goals

- Encryption, password protection, secure erase, or NDA-safe claims.
- Import merge, conflict resolution, preview/diff, or partial restore.
- Attachments, labels, search, native file pickers, or native packaging.
- A schema migration; the existing note fields are sufficient.

## Proposed design

Add note update/delete schemas, service methods, repository methods, API routes,
and API-client calls. Keep repository operations transactional and recalculate
chat activity from note history after edits or deletion.

Add `GET /api/database/export` and `PUT /api/database/import`. Export creates a
temporary online backup and serves it as an attachment. Import buffers a backup
upload, writes it to the configured data directory as a temporary file, validates
the On Track schema and SQLite integrity, closes the active connection, replaces
the database file, and reopens the repository. Roll back to the previous file if
replacement fails. Rate-limit export to three attempts per minute and import to
two attempts per minute per process.

Render notes with `react-markdown` plus `remark-gfm` and `skipHtml`. Keep links
browser-openable but avoid custom URL transforms. Add compact per-note icon
controls and reuse the main composer for body/timestamp editing.

## Data and migration impact

No schema migration is required. Import/export operates on whole SQLite database
files in the application data directory and removes temporary import/export and
rollback files after success or failure. Exported backups remain plaintext.

## Test plan

- Domain: note update validation and timestamp bounds.
- Database: note update/delete ordering, chat activity recomputation, rollback.
- API: note routes, export/import happy path, invalid import preservation.
- Client: API route encoding, settings dialog, Markdown safety, message controls.
- E2E: desktop/mobile Markdown edit/delete plus UI export/import restore.

## Completion evidence

### TDD evidence

- RED: focused validation, repository, API, API-client, and component tests first
  failed for missing note update/delete methods, missing import/export routes,
  literal Markdown rendering, and absent settings/message controls.
- GREEN: the focused suite now passes with 56 tests across validation,
  database, API, API client, and React component coverage.
- Coverage hardening: additional failure-path tests cover unavailable transfer
  endpoints, empty and non-On Track imports, cancelled import/delete, transfer
  errors, invalid timestamps, clipboard failures, and successful project/export
  API paths.

### Review and verification

- Security review covered Markdown rendering, imported database files, temporary
  files, rollback behavior, transfer rate limiting, clipboard writes,
  destructive deletion, and new dependencies. No Critical, High, or Medium
  findings remain.
- A WAL-sidecar risk found during review was fixed by checkpointing imported
  databases after validation and cleaning temporary sidecars after replacement.
- `npm run verify` passes release validation, build, typecheck, lint, formatting,
  coverage, migration tests, desktop/mobile Playwright E2E, and production
  dependency audit.
- Coverage: 104 tests pass with 88.96% statements, 82.26% branches, 89.72%
  functions, and 91.49% lines.
- E2E: 6 Playwright tests pass across desktop Chromium and mobile WebKit,
  including Markdown message management and Settings export/import.
- Release: annotated tag `v0.0.2` points at `c2ef29b` on `main`/`origin/main`.

### Remaining risk

Exports are plaintext SQLite database copies. Import replaces the local database
rather than merging histories or previewing conflicts. Encryption, secure erase,
and full recovery UX remain future work.
