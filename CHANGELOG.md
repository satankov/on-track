# Changelog

All notable changes to On Track are documented here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is
below `1.0.0`, releases may contain breaking changes.

## [Unreleased]

## [0.0.4] - 2026-09-03

### Added

- A flatter desktop-first workspace with a compact auto-growing composer and a
  vertical project-history filter rail.
- Browser-local Light, Neutral, and Dark appearance themes with accessible
  controls and pre-render application to avoid a theme flash.
- Permanent Pin and Attention labels plus project-enabled Todo, Decision, Open
  question, Risk, and Milestone labels, with multi-label message filtering and
  persistence in the current backup format.
- Node.js 22 support from version 22.13.0 while retaining Node.js 24 support,
  with dual-runtime CI, native SQLite portability, and release verification.

### Changed

- Unified text-only and attachment note writes behind one bounded multipart and
  service path.
- Centralized project-list and active-project client state commits to remove
  duplicated mutation synchronization.
- Derived strict current-database schema validation from a trusted database
  built with checked-in migrations instead of a handwritten duplicate schema.

### Breaking

- Current-format backup restore no longer accepts v0.0.3/schema-2 bundles. Live
  v0.0.3 databases still migrate at startup.

### Removed

- Removed the unused browser attachment-download API. Managed Open and Show in
  Folder remain available subject to their existing platform and safety checks.

## [0.0.3] - 2026-09-02

### Added

- Attachment messages with optional text, add/retain/remove behavior while
  editing, compact file cards, and a Files-only project-history filter.
- Managed mutable attachment sidecars with stable identity, external-edit
  metadata refresh, recoverable broken-file states, and guarded native Open/Show
  in Folder actions.
- Versioned `.on-track-backup` export and restore containing the metadata database
  plus all readable attachment files, with bounded staging and interrupted-
  restore recovery.

### Changed

- Replaced the unreleased development attachment BLOB schema with a metadata-only
  v0.0.3 baseline; obsolete development databases require a local data reset.
- Replaced reachable raw SQLite transfer with complete validated backup bundles.

### Security

- Managed paths are server-owned and canonically validated; browser native-action
  requests carry scoped IDs only and use same-origin/Fetch Metadata checks,
  rate limiting, fixed shell-free commands, and executable-file blocking.

### Known limitations

- The database, managed attachment files, and backup bundles remain plaintext.
- Native Open/Show in Folder has been manually reported working on one macOS
  host. Windows and Linux desktop dispatch have automated command-shape coverage
  but remain manually unverified.

## [0.0.2] - 2026-09-01

### Added

- Settings workspace with local SQLite database export and import.
- Markdown rendering for chat messages, including GitHub-flavored Markdown.
- Message copy, edit, timestamp adjustment, and delete actions.
- Optional composer timestamp selection for adding backfilled messages.
- Project edit workspace with project deletion.

### Changed

- Reworked the main project view into a more chat-like message layout with
  right-aligned message bubbles, grouped date dividers, and per-message times.
- Replaced message action text buttons with hover-visible icon controls and
  copied-state feedback.
- Moved message editing into the main composer with compact Save, Cancel, and
  timestamp controls.

### Security

- Database import validates the selected file before replacing local app data.
- Database export and import routes are rate-limited to reduce repeated local
  filesystem/database work from same-origin abuse.
- Project deletion and message deletion run through explicit server-side
  persistence APIs instead of client-only state changes.

## [0.0.1] - 2026-08-31

### Added

- Personal project chats with persistent title and accent customization.
- Multiline plain-text notes in deterministic chronological order.
- Local SQLite persistence owned by a loopback-only application server.
- Responsive, keyboard-accessible desktop and mobile browser workflows.
- One-command source quick start with `npm run quickstart`.
- Apache License 2.0 open-source license, contributor guidance, security policy,
  and automated CI/security/release gates.

### Security

- Host and Origin validation, same-origin production UI/API, strict content
  security policy, parameterized persistence, and literal note rendering.
- Application data defaults to the operating-system data directory and database
  files are excluded from Git.

### Known limitations

- Local data is plaintext and the app has no backup/restore workflow. Do not use
  v0.0.1 for confidential, NDA-bound, or irreplaceable data.
- Distribution is source-based and requires Node.js 24; native installers are not
  included.
