# On Track project

## Vision

On Track is an open-source, private-by-default personal project tracker for
managers, project managers, and individuals. It replaces scattered notes,
decisions, meeting records, and progress spreadsheets with a familiar private
chat-like stream: the user writes to their own project, not to a team.

The long-term product promise is user ownership. It should run locally, avoid
third-party data services, and eventually protect a copied database well enough
for confidential work. Version 0.0.2 adds backup and message-management basics
but does not yet fulfill the encryption or recovery parts of that promise.

## Current phase

Version 0.0.2 is tagged on the current `main` history as the next plaintext alpha
source release under Apache License 2.0. It keeps the local-only browser/server
architecture while adding backup, restore, Markdown, project deletion, and
message-management workflows.

## Current objective

Select and plan the next data-safety slice without relaxing the plaintext and
recovery warnings. Backups remain readable until encryption is designed.

## v0.0.1 outcome

- The core project-chat workflow works at representative desktop and mobile
  browser widths and is keyboard accessible.
- Notes and project customization persist in a local SQLite database outside the
  source checkout.
- The runtime binds only to loopback and has no account, telemetry, cloud, or
  outbound runtime dependency.
- A fresh user can install/build/start with `npm run quickstart`, stop with
  `Ctrl+C`, and later restart with `npm start`.
- Build, type, lint, format, test, coverage, migration, browser E2E, release, and
  dependency-security gates are reproducible locally and passed on the published
  release commit across the configured GitHub Actions workflows.

## v0.0.2 outcome

- Settings opens as a workspace mode and supports local SQLite database export
  and import.
- Messages render Markdown, display as grouped chat bubbles, and support copy,
  edit, timestamp adjustment, and deletion.
- The main composer can send backfilled messages with a selected timestamp and
  reuses the same timestamp pattern while editing existing messages.
- Projects can be edited and deleted from the workspace without modal dialogs.
- Plaintext warnings remain accurate: exports and the active database are local
  readable SQLite files, and import replaces local data rather than merging.
- Database transfer endpoints are rate-limited as defense in depth around local
  filesystem and database work.

## Current capabilities

- Create and switch between personal project chats.
- Rename a project and select a restrained accent color.
- Add multiline Markdown notes in deterministic chronological order.
- Copy, edit, timestamp-adjust, and delete notes.
- Export and import the local SQLite database from Settings.
- Persist state across browser and server restarts.
- Use a responsive, accessible browser interface served from a local process.

## Near-term priorities

1. Harden backup, restore, integrity checking, recovery, and conflict-free import
   semantics before users entrust irreplaceable data to the application.
2. Design the encryption threat model, unlock and recovery experience, encrypted
   database/sidecar/attachment handling, and plaintext migration.
3. Add attachments with explicit storage, size, type, lifecycle, and import
   security boundaries.
4. Add a broad built-in label vocabulary—such as TODO, open question, decision,
   risk, and meeting note—and convenient history filtering.
5. Evaluate native desktop packaging once the storage and key lifecycle are
   credible.

## Long-term direction

Explore an iPhone client and device-to-device synchronization without mandatory
cloud infrastructure. Peer-to-peer sync is a separate architecture phase: it
requires device identity, pairing, encryption in transit, conflict semantics,
offline history, deletion rules, recovery, and relay/discovery decisions. The
current stable IDs, explicit migrations, and repository boundaries preserve
options without pretending those choices are solved.

## Non-goals for published v0.0.2

Collaboration, accounts, attachments, labels, filtering, search, encryption,
NDA-safe claims, native installers, mobile apps, peer-to-peer sync, public
hosting, analytics, and telemetry.

## Product decisions

- A chat is a private project notebook, not a cooperative messenger.
- Data is local by default and stored outside the Git checkout.
- Plaintext alpha limitations must be prominent; locality is not encryption.
- Distribution is a GitHub source release requiring Node.js 24, not an npm
  package or native installer.
- The project is open source under Apache License 2.0, including commercial use.

## Roadmap and tracker

The public repository and release are:

- [GitHub repository](https://github.com/satankov/on-track)
- [v0.0.1 release](https://github.com/satankov/on-track/releases/tag/v0.0.1)
- [v0.0.2 release tag](https://github.com/satankov/on-track/releases/tag/v0.0.2)
- [Issues](https://github.com/satankov/on-track/issues)

GitHub Issues is the intended backlog and ownership tracker. The near-term
priorities above still need tracker records. Durable decisions live in
`docs/adr/`; significant active work lives in `docs/plans/`.

## Current risks

- A copied On Track database is readable because at-rest encryption is absent.
- Plaintext exports are readable copies of the database; importing replaces the
  local database rather than merging histories.
- Source installation requires Node.js 24 and a native SQLite dependency. The
  release commit passed CI on Linux plus native install/test coverage on Linux,
  macOS, and Windows, but future dependency upgrades can still affect portability.
- Loopback HTTP narrows exposure but is still a trust boundary requiring Host,
  Origin, content-security, and input-validation controls.

## Maintenance rule

Update this file when vision, phase, non-goals, success criteria, or cross-feature
priorities change. Do not use it as a session log.
