# Changelog

All notable changes to On Track are documented here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is
below `1.0.0`, minor versions may contain breaking changes.

## [Unreleased]

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
