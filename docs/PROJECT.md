# On Track project

## Vision

On Track is an open-source, private-by-default personal project tracker for
managers, project managers, and individuals. It replaces scattered notes,
decisions, meeting records, and progress spreadsheets with a familiar private
chat-like stream: the user writes to their own project, not to a team.

The long-term product promise is user ownership. It should run locally, avoid
third-party data services, and eventually protect copied local data well enough
for confidential work. Version 0.0.3 added managed mutable attachments and
complete versioned backups, but does not yet fulfill the encryption or hardened
recovery parts of that promise.

## Current phase

Version 0.0.4 is the current published plaintext alpha source release under
Apache License 2.0. Version 0.0.5 is in development: its first committed slice
adds a silent live boundary between current and future-dated messages, while the
current feature slices add project sidebar pins, current-time previews,
Attention status, quiet pin controls, and collapsible long messages with a
per-project default.

## Current objective

Complete, review, and prepare the v0.0.5 feature slices for publication while
retaining the plaintext and portability warnings. Mobile remains a
regression-protected alpha, not a dedicated design target.

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

## v0.0.3 outcome

- Attachment bytes live in repository-owned sidecars while SQLite retains stable
  identity and metadata without content BLOBs.
- External edits preserve attachment identity and refresh size/modified metadata;
  missing, unreadable, and unsafe files remain recoverable records.
- Settings exports and restores one validated `.on-track-backup` containing the
  database and every readable attachment, with bounded staging and startup
  recovery for interrupted replacement.
- Eligible managed files can be opened with their operating-system association
  or shown in their folder through scoped, shell-free native actions. Executable
  and launcher-like files are blocked from Open.
- Desktop Chromium and mobile WebKit E2E use a fake adapter to prove native action
  requests, external edits, stable identity, focus refresh, and restart without
  launching desktop applications.

## v0.0.4 outcome

- The main workspace uses a flatter desktop-first hierarchy, compact auto-growing
  composer, and vertical history filters without losing mobile regression
  coverage.
- Light, Neutral, and Dark themes are accessible, apply before React renders,
  and remain browser-local rather than entering project data or backups.
- Messages support several durable built-in labels, and each project controls
  which optional labels appear in its composer and history filters.
- Node.js 22 is supported from 22.16.0 on macOS and Linux; Windows requires
  Node.js 24. Startup enforces that platform-specific policy, and CI exercises
  each supported runtime/operating-system pair.
- Note writes and client project-state updates have one canonical path; backup
  schema validation is derived from checked-in migrations; the unused attachment
  download route and obsolete schema-2 backup restore path are removed.

## v0.0.5 development

- Chronological history marks the first future-dated message with a silent,
  square-edged, full-width accent fade and accessible separator. The boundary
  advances or disappears at delivery time without remounting message controls.
- The current project-rail slice adds persistent project pins, current-time
  message previews, and today/earlier Attention status without changing message
  activity ordering.
- Pinned controls stay visually quiet at rest on hover-capable layouts, and long
  Markdown messages can be expanded or collapsed using a project-level default
  that persists through restart and backup restore.

## Current capabilities

- Create and switch between personal project chats.
- Pin and unpin projects in a stable sidebar section without changing their
  message-activity timestamps.
- Rename a project and select a restrained accent color.
- Add multiline Markdown notes in deterministic chronological order.
- Expand and collapse long Markdown notes, and choose each project's initial
  long-message state from Edit project.
- Schedule future-dated messages and see a live, unobtrusive boundary between
  current history and messages whose timestamps have not arrived.
- Add local files to project messages with optional text context, including
  attachment add/remove while editing a message.
- Filter the open project history to messages with attached files.
- Apply permanent Pin and Attention labels plus project-enabled Todo, Decision,
  Open question, Risk, and Milestone labels to messages, then filter history by
  active labels.
- Scan each project's latest message up to the current time and see whether an
  applied Attention label belongs to today or an earlier message directly from
  the sidebar.
- Open eligible managed files with the operating system's default association,
  or show their safe managed folder; risky executable/launcher types are blocked
  from Open.
- Copy, edit, timestamp-adjust, and delete notes.
- Export and restore one versioned `.on-track-backup` bundle containing the
  metadata database and all readable attachment files.
- Choose Light, Neutral, or Dark appearance from large previews in Settings;
  the browser-local preference applies immediately and persists across reloads.
- Persist state across browser and server restarts.
- Use a responsive, accessible browser interface served from a local process.

## Near-term priorities

1. Finish and publish v0.0.5 after its future-message and project-rail slices
   pass review and the platform-scoped Node 22.16/24 release matrix.
2. Continue hardening backup, restore, integrity checking, recovery, and
   conflict-free import semantics before users entrust irreplaceable data to the
   application.
3. Design the encryption threat model, unlock and recovery experience, encrypted
   database/sidecar/attachment handling, and plaintext migration.
4. Evaluate richer label workflows only after observing the fixed built-in
   vocabulary in planning, decision, risk, and milestone use.
5. Evaluate native desktop packaging once the storage and key lifecycle are
   credible.

## Long-term direction

Explore an iPhone client and device-to-device synchronization without mandatory
cloud infrastructure. Peer-to-peer sync is a separate architecture phase: it
requires device identity, pairing, encryption in transit, conflict semantics,
offline history, deletion rules, recovery, and relay/discovery decisions. The
current stable IDs, explicit migrations, and repository boundaries preserve
options without pretending those choices are solved.

## Non-goals for current plaintext alpha

Collaboration, accounts, user-created label definitions, search, encryption,
NDA-safe claims, native installers, mobile apps, peer-to-peer sync, public
hosting, analytics, and telemetry.

## Product decisions

- A chat is a private project notebook, not a cooperative messenger.
- Data is local by default and stored outside the Git checkout.
- Plaintext alpha limitations must be prominent; locality is not encryption.
- Distribution is a GitHub source release supporting Node.js 22 from 22.16.0 on
  macOS and Linux and Node.js 24 on Windows, macOS, and Linux, not an npm package
  or native installer.
- The project is open source under Apache License 2.0, including commercial use.

## Roadmap and tracker

The public repository and release are:

- [GitHub repository](https://github.com/satankov/on-track)
- [v0.0.1 release](https://github.com/satankov/on-track/releases/tag/v0.0.1)
- [v0.0.2 release tag](https://github.com/satankov/on-track/releases/tag/v0.0.2)
- [v0.0.3 release tag](https://github.com/satankov/on-track/releases/tag/v0.0.3)
- [Issues](https://github.com/satankov/on-track/issues)

GitHub Issues is the intended backlog and ownership tracker. The near-term
priorities above still need tracker records. Durable decisions live in
`docs/adr/`; significant active work lives in `docs/plans/`.

## Current risks

- A copied On Track database is readable because at-rest encryption is absent.
- Plaintext backup bundles contain readable database metadata and attached file
  bytes; restoring replaces current local projects and files rather than merging
  histories.
- Source installation requires a supported Node.js LTS line and a native SQLite
  dependency. Node 22 support ends no later than upstream support, currently
  2027-04-30. The next candidate must pass full verification on Node 22.16 and
  24 on Linux, plus native SQLite install/test coverage on macOS for both lines
  and on Windows for Node 24; future dependency upgrades can still affect
  portability.
- v0.0.4 deliberately does not restore v0.0.3/schema-2 backup bundles. Live
  v0.0.3 databases still migrate at startup, and this compatibility break is
  acceptable only under the current no-user alpha assumption.
- Native command construction is tested for macOS, Windows, and Linux, but real
  OS dispatch has been manually reported only on one macOS host. Windows and
  Linux desktop integration remains unverified.
- Loopback HTTP narrows exposure but is still a trust boundary requiring Host,
  Origin, content-security, and input-validation controls.

## Maintenance rule

Update this file when vision, phase, non-goals, success criteria, or cross-feature
priorities change. Do not use it as a session log.
