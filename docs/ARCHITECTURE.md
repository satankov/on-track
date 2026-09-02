# On Track architecture

## Status

Implemented through the v0.0.2 plaintext alpha plus the active v0.0.3
attachment/file-filter work in the current development tree. The core decisions
are recorded in [ADR-0001](adr/0001-localhost-typescript-sqlite.md), the
encryption limitation in [ADR-0002](adr/0002-defer-at-rest-encryption.md),
source delivery in [ADR-0003](adr/0003-source-release-pipeline.md), and the
current license in [ADR-0005](adr/0005-apache-2-license.md).

## System context

One person runs one trusted Node.js process on their computer and opens the UI in
a normal browser. The process binds to `127.0.0.1`, serves the built UI and a
same-origin JSON API, owns the SQLite connection, and writes only to the local
application-data directory. There are no accounts, cloud services, telemetry,
remote assets, or required internet requests at runtime.

```text
Local browser -> loopback Fastify server -> application service -> repository -> SQLite
                     |                         |
                     +-> built React UI        +-> validation/domain contracts
```

## Technology decisions

- React 19 and Vite 8 provide the TypeScript browser UI and production bundle.
- Fastify 5 serves the static bundle and local API on IPv4 loopback.
- `@fastify/rate-limit` limits local database transfer routes that perform
  filesystem/database work.
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
  model. Node.js 24 is the supported runtime.

## Components and dependency direction

- `src/client`: React workspace, styles, and typed API client. It never imports
  server or database modules.
- `src/domain`: shared data contracts and validation rules with no UI or
  persistence dependency.
- `src/server/app.ts`: Fastify transport, boundary controls, safe error mapping,
  and route wiring.
- `src/server/chat-service.ts`: use cases and transactional project/note behavior.
- `src/server/db`: the sole SQLite boundary, repositories, schema, migration
  startup, permissions, integrity checks, and downgrade refusal.
- `drizzle/`: immutable checked-in migrations and migration metadata.
- `scripts/`: dependency-free release-contract validation; it inspects filenames
  and release metadata, never user database contents.

Dependencies point inward from transport/UI and persistence adapters toward
shared contracts and use cases. Browser code accesses persistence only through
the local API; raw SQL and filesystem paths never cross that boundary.

## Data design and location

The migrations create `chats`, `notes`, `note_attachments`, and single-row
`app_metadata` tables. Foreign keys and check constraints enforce ownership,
length/accent rules, attachment metadata bounds, non-empty attachment content, and
byte-size agreement. Indexed `(chat_id, created_at, id)` ordering makes note
history stable; chat activity is ordered using timestamps with a deterministic ID
tie-breaker. Appending, editing, timestamp-adjusting, and deleting notes keep
chat activity consistent with the newest remaining note in a transaction.
Attachment rows cascade with their owning note.

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
opening SQLite. The dormant restore primitive fails closed on malformed or
ambiguous state, rolls pre-commit states back idempotently, and validates a
committed database plus managed attachment path safety before deleting rollback
state. Exact generated-namespace inventory validation runs before commit. Current
transfer routes do not create this journal yet.

Message attachments are stored as SQLite BLOBs in the same database as message
metadata. The first slice caps each file at 100 MB, stores sanitized filename and
media-type strings as display/open metadata, and serves bytes only through a
project-, note-, and attachment-scoped route. The browser client opens fetched
attachment bytes as a local blob URL; native app opening and in-place file
mutation are deferred OS-integration work.

The Settings workflow exports the live SQLite database through
`better-sqlite3`'s online backup API, including attachment bytes. Import accepts
an uploaded SQLite file, validates it as an On Track database, runs SQLite
`quick_check`, closes the live connection, replaces the database file in the
configured data directory, and reopens the repository against the imported file.
Import is replacement, not merge. Export is limited to three attempts per minute
per process; import is limited to two attempts per minute per process.

The next transfer format is implemented behind unused primitives: one versioned
SQLite `.on-track-backup` container with strict canonical-schema, integrity,
foreign-key, count, size, hash, and attachment-inventory validation. Its staging
primitive accepts bounded incremental input while SQLite payload access buffers
at most one bounded attachment. The current Settings endpoints continue to use
raw SQLite until the sidecar schema and bundle routes cut over together.

## Trust and security boundaries

- API requests require a loopback Host; cross-origin browser requests are
  rejected by Origin checks and no permissive CORS is enabled.
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
- Export a database backup and import it through Settings with validation.
- Attach a local file to a message, edit message attachments, filter the project
  history to messages with attached files, and open a scoped attachment.
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
  WebKit viewport, including server restart.
- `npm run security:check`: production dependency audit.
- `npm run release:check`: version, license, required-file, tag, and tracked-data
  contract.
- `npm run verify`: authoritative aggregate local/release gate.

GitHub Actions repeats these checks, exercises native installation/tests on
Linux, macOS, and Windows, performs dependency review and CodeQL analysis, and
publishes only a matching tag whose commit is already on `main`.

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
