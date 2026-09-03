# On Track architecture

## Status

The v0.0.3 plaintext alpha is the published baseline. Version 0.0.4 is prepared
as the next release candidate with browser-local appearance preferences,
durable project/message label relations, Node.js 22.16/24 support, and simpler
note-write, client-state, and backup-validation paths. It preserves the existing
local server/service/repository and versioned-backup boundaries. The core
decisions are recorded in
[ADR-0001](adr/0001-localhost-typescript-sqlite.md), the
encryption limitation in [ADR-0002](adr/0002-defer-at-rest-encryption.md),
source delivery in [ADR-0003](adr/0003-source-release-pipeline.md), and the
current license in [ADR-0005](adr/0005-apache-2-license.md). Managed mutable
attachments and guarded native actions are recorded in
[ADR-0006](adr/0006-managed-mutable-attachments-and-native-file-actions.md), and
Node 22.16/24 support in
[ADR-0007](adr/0007-node-22-and-24-runtime-support.md).

## System context

One person runs one trusted Node.js process on their computer and opens the UI in
a normal browser. The process binds to `127.0.0.1`, serves the built UI and a
same-origin JSON API, owns the SQLite connection, and writes only to the local
application-data directory. There are no accounts, cloud services, telemetry,
remote assets, or required internet requests at runtime.

```text
Local browser -> loopback Fastify server -> application service -> repository -> SQLite
                     |                         |
                     +-> built React UI        +-> managed files -> native OS adapter
                                               +-> validation/domain contracts
```

## Technology decisions

- React 19 and Vite 8 provide the TypeScript browser UI and production bundle.
- Fastify 5 serves the static bundle and local API on IPv4 loopback.
- `@fastify/rate-limit` limits local database transfer and native-file routes
  that perform filesystem/database or OS-dispatch work.
- `@fastify/multipart` parses local attachment uploads with bounded file and
  part limits.
- `better-sqlite3` owns synchronous database access; Drizzle defines schema and
  applies checked-in, versioned SQL migrations.
- `react-markdown` and `remark-gfm` render user notes as Markdown without raw
  HTML.
- Zod validates untrusted transport/domain input.
- Vitest and Testing Library cover domain, database, API, client, and component
  behavior; Playwright covers the persisted browser journey.
- npm lockfile installation and GitHub source releases are the current packaging
  model. Node.js 22 is supported from 22.16.0 and Node.js 24 remains supported;
  odd-numbered and unknown future majors are excluded.

## Components and dependency direction

- `src/client`: React workspace, styles, and typed API client. It never imports
  server or database modules. A closed Light/Neutral/Dark theme preference is
  validated in the client and stored in browser-local storage; a same-origin
  bootstrap script applies it before React mounts to avoid a theme flash.
- `src/domain`: shared data contracts, closed built-in label vocabularies, and
  validation rules with no UI or persistence dependency.
- `src/server/app.ts`: Fastify transport, boundary controls, safe error mapping,
  and route wiring.
- `src/server/chat-service.ts`: use cases and transactional project/note behavior.
- `src/server/attachments` and `src/server/native-file-actions.ts`: canonical
  managed-file resolution and shell-free platform dispatch.
- `src/server/db`: the sole SQLite boundary, repositories, schema, migration
  startup, permissions, integrity checks, and downgrade refusal.
- `drizzle/`: immutable checked-in migrations and migration metadata.
- `scripts/`: dependency-free release-contract validation; it inspects filenames
  and release metadata, never user database contents.

Dependencies point inward from transport/UI and persistence adapters toward
shared contracts and use cases. Browser code accesses persistence only through
the local API; raw SQL and filesystem paths never cross that boundary.

## Data design and location

The migrations create `chats`, `notes`, `note_attachments`,
`chat_enabled_labels`, `note_labels`, and single-row `app_metadata` tables.
Foreign keys and checks enforce ownership, closed label vocabularies,
length/accent rules, unique repository-owned attachment paths, and nonnegative
last-known byte sizes and modification times. Composite primary keys prevent
duplicate label settings and assignments. Indexed `(chat_id, created_at, id)`
ordering makes note history stable; chat activity is ordered using timestamps
with a deterministic ID tie-breaker. Appending, editing, timestamp-adjusting,
and deleting notes keep chat activity consistent with the newest remaining note
in a transaction. Label changes do not alter message time or project activity.
All child relations cascade with their owning project or message.

Default data directories:

- macOS: `~/Library/Application Support/On Track/`
- Windows: `%APPDATA%/On Track/`
- Linux: `$XDG_DATA_HOME/on-track/` or `~/.local/share/on-track/`

`ON_TRACK_DATA_DIR` may select an absolute alternative. The server creates the
directory with owner-only permissions where the platform supports POSIX modes,
creates `on-track.sqlite`, enables foreign keys and WAL, and restricts database
and sidecar files to the owner. Database, journal, backup, and export patterns are
ignored by Git and forbidden by the release contract if tracked.

Default directory composition uses explicit Windows or POSIX path semantics, so
the macOS, Windows, and Linux rules are testable independently of the CI host.

Migrations are applied at startup. A database with a newer schema version or a
newer migration marker is refused rather than opened by older code. Shipped
migrations are never edited.

Startup also checks for the fixed, owner-only managed-restore journal before
opening SQLite. Restore recovery fails closed on malformed or
ambiguous state, rolls pre-commit states back idempotently, and validates a
committed database plus managed attachment path safety before deleting rollback
state. Exact generated-namespace inventory validation runs before commit.

Message attachments are owner-only files under
`attachments/v1/<generated-namespace>/<attachment-id>/<safe-filename>`.
SQLite stores metadata, a unique repository-owned POSIX relative path, and
last-known size/modified time, but no attachment BLOB. Creation installs files
before committing references; deletion commits reference removal before
best-effort file cleanup. Project reads and scoped native actions refresh metadata
after external edits and preserve missing, unreadable, or unsafe rows as
recoverable DTO states. DTOs also expose server-derived Open/Show capability
states. Scoped POST routes resolve IDs to canonical managed targets and dispatch
eligible files through fixed, shell-free macOS, Windows, or Linux commands.
Known executable, installer, script, shortcut, application, and desktop-launcher
types—and executable POSIX files—cannot be opened from On Track; safe folder
reveal remains independent. Browser focus refreshes attachment metadata after a
user returns from an external application. Attachment bytes are not exposed by a
browser download route.

All browser note creation and editing uses the same bounded multipart contract,
whether or not files are attached. The client keeps project summaries and the
active project detail in one canonical server-state value so mutations update
both views atomically without duplicated synchronization branches.

Settings exports one versioned SQLite `.on-track-backup` container, including
project label configuration and message assignments. An online snapshot
temporarily gains reserved payload tables containing every readable
managed file plus size, time, and SHA-256 metadata; strict canonical-schema,
integrity, foreign-key, count, size, hash, and inventory checks run before the
completed private file is streamed. Restore incrementally stages a bounded
upload, rejects raw SQLite, schema-2, and other unsupported bundles, generates
fresh managed paths, removes bundle payload tables, and compacts the current-
schema candidate. It then uses the maintenance gate and restore journal to
replace live state. Exact active-schema expectations come from a trusted in-
memory database built with checked-in migrations; imported SQL never defines
its own validation baseline.
Restore is replacement, not merge. Export is limited to three attempts per
minute per process; restore is limited to two attempts per minute per process.

## Trust and security boundaries

- API requests require a loopback Host; cross-origin browser requests are
  rejected by Origin checks and no permissive CORS is enabled.
- Native-file POST routes additionally require exact same-origin Origin and
  Fetch Metadata headers, an empty JSON object, and a shared ten-action-per-minute
  process limit. Requests and responses carry IDs only, never local paths.
- Production responses set a same-origin content security policy, deny framing,
  suppress referrers, and disable MIME sniffing.
- Input is schema-validated, SQL is parameterized through prepared
  statements/query tooling, and user notes render through a Markdown component
  with raw HTML skipped.
- Multipart file uploads are capped at 100 MB per file and ten files per
  message. Filenames and media types are treated as untrusted metadata, not
  filesystem paths or execution instructions.
- Database export and import routes are rate-limited before transfer work runs.
- Error responses avoid internal paths and stack details.
- The database is plaintext. Filesystem permissions and loopback binding reduce
  exposure but do not protect a copied database, exported backup, or an unlocked
  user account.

Before confidential use, encryption must cover the database, WAL/journals,
backups, exports, attachments, indexes, migration, key storage, lock behavior,
forgotten credentials, recovery, and cleanup of plaintext artifacts. Backup
integrity, import conflict handling, recovery UX, and restore failure modes must
be hardened before production-readiness claims.

## Critical user journeys

- Empty state -> create project -> customize title/accent -> add multiline note.
- Create/switch multiple projects and preserve project-specific histories.
- Copy, edit, timestamp-adjust, and delete notes while preserving deterministic
  ordering.
- Export and restore a versioned backup bundle through Settings with validation.
- Choose Light, Neutral, or Dark from accessible preview radios in Appearance,
  reload without a theme flash, and keep project data and backups independent
  from the browser-local preference.
- Attach a local file to a message, edit message attachments, filter the project
  history to messages with attached files, and use separate eligible Open and
  Show in Folder actions.
- Enable project labels, apply several labels to one message, filter by active
  labels, deactivate a label without deleting assignments, and reopen the
  persisted state after restart.
- Stop and restart the server against the same isolated data directory and
  recover all state.
- Complete the flow at desktop and mobile widths with keyboard/focus behavior and
  no unexpected outbound request.

## Quality gates

- `npm run build`: clean and build client/server production output.
- `npm run typecheck`: browser and server TypeScript checks.
- `npm run lint` and `npm run format:check`: static and formatting checks.
- `npm run test:coverage`: unit, component, API, and database suite with enforced
  80% behavior-bearing coverage thresholds.
- `npm run test:migrations`: focused real-SQLite migration/integrity tests.
- `npm run test:e2e`: built application journeys in desktop Chromium and a mobile
  WebKit viewport, including fake-native Open/Show receipts, external sidecar
  edits, metadata refresh, stable attachment identity, and server restart. The
  E2E adapter never launches a desktop application.
- `npm run security:check`: production dependency audit.
- `npm run release:check`: version, license, required-file, tag, and tracked-data
  contract.
- `npm run verify`: authoritative aggregate local/release gate.

GitHub Actions repeats full verification on Node 22.16 and 24, exercises native
SQLite dependency installation/tests for both runtimes on Linux, macOS, and
Windows, performs dependency review and CodeQL analysis, and publishes only a
matching tag whose commit is already on `main`. Unit tests cover every native
command shape; current manual dispatch
evidence is limited to one user-reported macOS host, with Windows and Linux
desktop smoke tests pending.

## Architecture constraints

- Keep one local process as the only database writer for this phase.
- Add every schema change as a new migration with rollback/error-path tests.
- Treat native mutable attachments, imports/exports, external URLs, encryption,
  OS integration, and sync as new trust-boundary work requiring dedicated plans
  and security review.
- Do not promise peer-to-peer sync until identity, pairing, transport, conflicts,
  deletion, recovery, and discovery/relay behavior are explicitly designed.
- Do not call the product NDA-safe or production-ready before encryption,
  recovery, and hardened backup/restore semantics are complete.

## Maintenance rule

Update this file when system design, boundaries, data ownership, deployment, or
quality commands change. Preserve superseded rationale in `docs/adr/`.
