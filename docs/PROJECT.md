# threadstr project

## Vision

threadstr is an open-source, private-by-default personal project tracker for
managers, project managers, and individuals. It replaces scattered notes,
decisions, meeting records, and progress spreadsheets with a familiar private
chat-like stream: the user writes to their own project, not to a team.

The long-term product promise is user ownership. It should run locally, avoid
third-party data services, and eventually protect copied local data well enough
for confidential work. Version 0.0.3 added managed mutable attachments and
complete versioned backups, but does not yet fulfill the encryption or hardened
recovery parts of that promise.

## Current phase

Version 0.0.8 is the latest published plaintext alpha release under Apache
License 2.0. It fixes the macOS Bash installer and HTTP 415 updater defects in
v0.0.7, the first managed-compatible release (floor `0.0.7`). Managed installation
remains experimental; clean OS/platform and published-upgrade evidence is incomplete.

## Current objective

Prepare **v0.0.9** with the **threadstr** identity, primary **thr** CLI,
built-in Examples, Home release checks, and navigation polish. The published v0.0.8 still
uses On Track and `ontrack`; current source introduces the new identity while
preserving the old command as a compatibility alias, existing data and update
contracts. See [plan 0023](plans/0023-threadstr-rebrand.md),
[ADR-0010](adr/0010-threadstr-identity-and-cli-transition.md), and
[compatibility guidance](compatibility.md).

Complete installation/platform and upgrade validation, retain the manual Node
matrix and plaintext warnings, and record remaining evidence limits. Mobile
remains a regression-protected alpha, not a dedicated design target.

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

## v0.0.5 outcome

- Chronological history marks the first future-dated message with a silent,
  square-edged, full-width accent fade and accessible separator. The boundary
  advances or disappears at delivery time without remounting message controls.
- The current project-rail slice adds persistent project pins, current-time
  message previews, and today/earlier Attention status without changing message
  activity ordering.
- Pinned controls stay visually quiet at rest on hover-capable layouts, and long
  Markdown messages can be expanded or collapsed using a project-level default
  that persists through restart and backup restore.

## v0.0.6 outcome

- The shared add/edit composer provides an optional compact Markdown strip with
  selection-aware formatting, GFM table insertion, and familiar textarea-scoped
  shortcuts without changing stored note or backup formats. Timestamp and
  Markdown rows share one compact visual system at desktop and mobile widths.
- The same composer can attribute messages to a free-form participant name.
  Those messages use one neutral left-aligned bubble, stable sender-name color,
  and all existing message labels, filters, files, and actions. Schema 6 and the
  versioned backup contract preserve this optional attribution.
- Home navigation, per-project session reading positions, and independently
  collapsible Pinned and Projects sections improve movement through the private
  notebook without adding persistent navigation data.
- The add/edit composer grows to eight lines, sidebar previews present inert
  plain text extracted from Markdown, and Links filters messages using the same
  parsed Markdown/GFM URL policy as rendering.

## v0.0.7 outcome

- [Archive](plans/0018-project-archive.md) adds a third sidebar section and
  versioned archive state in database/backup schema 7.
- [Selective backups and import](plans/0019-selective-backups-and-project-import.md)
  support project selection, validated previews, independent-copy merges, and
  selected replacement using the existing guarded storage boundaries.
- [Composer and filter fixes](plans/0020-composer-drop-and-filter-scroll.md)
  add visible file-drop targets, restore All reading positions after filtering,
  position other filters near current work, and give add/edit drafts full width
  above a toolbar that remains reachable in short viewports.
- [Managed installation and CLI](plans/0021-managed-install-and-cli.md) is the
  active delivery slice: private Node, Git-free source installation, background
  lifecycle commands, and version-specific updates with database recovery.
  [Separate OS guides](install/README.md) retain full manual instructions.
  Installer assets are published; installation defects and remaining platform
  evidence are recorded in that plan and the OS guides.

## Current capabilities

- Home preserves project-first navigation and adds explicit GitHub release checks,
  compatible managed/manual update instructions, and curated guide/source links.
  The reserved bug-report block is a noninteractive coming-soon placeholder.
  No polling, automatic updates, diagnostic collection or reporting service is
  introduced. See [plan 0024](plans/0024-home-updates-and-support.md).

- Built-in Examples contains one read-only 🇳🇱 Trip to Amsterdam notebook. Users
  explore its filters and create independent editable projects; originals update
  with the app and stay out of backups. General settings can hide Examples using
  a browser-local preference. See [plan 0022](plans/0022-built-in-examples.md).

- Create and switch between personal project chats, return Home through the
  threadstr brand, and retain reading positions during the current browser session.
- Independently collapse the Pinned, Projects, Archive, and Examples sidebar sections;
  browser-local preferences retain their state across reloads.
  Pinned, Projects, and Archive headers remain visible when empty.
- Pin and unpin projects in a stable sidebar section without changing their
  message-activity timestamps.
- Archive projects from Edit project, then restore through settings or the
  sidebar restore icon. Archiving clears the pin, preserves all content, and
  leaves projects editable; restoration returns them to Projects.
- Rename a project and select a restrained accent color.
- Add multiline Markdown notes in deterministic chronological order.
- Attribute notes to a named participant from a compact composer row, or switch
  back to You, without creating participant accounts or project settings.
- Format selected or placeholder text from the compact Markdown strip, or use
  Cmd/Ctrl shortcuts for bold, italic, link, quote, lists, checklist, and code.
- Expand and collapse long Markdown notes, and choose each project's initial
  long-message state from Edit project.
- Schedule future-dated messages and see a live, unobtrusive boundary between
  current history and messages whose timestamps have not arrived.
- Add local files to project messages with optional text context, including
  attachment add/remove while editing a message. Drag files onto the highlighted
  composer or use Attach; both add/edit modes use a full-width text field above
  their controls.
- Filter the open project history to messages with attached files or automatically
  detected Markdown/GFM links. Returning to All restores the reading position;
  other filters open around their latest current and first future messages.
- Apply permanent Pin and Attention labels plus project-enabled Todo, Decision,
  Open question, Risk, and Milestone labels to messages, then filter history by
  active labels.
- Scan a plain-text preview of each project's latest message up to the current
  time and see whether an applied Attention label belongs to today or an earlier
  message directly from the sidebar.
- Open eligible managed files with the operating system's default association,
  or show their safe managed folder; risky executable/launcher types are blocked
  from Open.
- Copy, edit, timestamp-adjust, and delete notes.
- Export all or selected projects to a versioned `.on-track-backup` bundle with
  their messages and attachments. Preview and select imported projects, then
  merge independent copies with conflict renaming or replace the whole database.
- Choose Light, Neutral, or Dark appearance from large previews in Settings;
  the browser-local preference applies immediately and persists across reloads.
- Persist state across browser and server restarts.
- Use a responsive, accessible browser interface served from a local process.

## Near-term priorities

1. Complete managed CLI installation and recovery gates, then prepare the next
   alpha candidate with release review and the preserved platform-scoped manual
   Node 22.16/24 verification matrix.
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
- The sidebar footer uses only “Local only” beside Settings. Plaintext alpha
  limitations remain documented in the README and backup settings; locality is
  not encryption.
- Manual GitHub source installation supports Node.js 22 from 22.16.0 on macOS
  and Linux and Node.js 24 on Windows, macOS, and Linux. Managed CLI delivery
  adds a private pinned runtime and fixed source assets alongside that workflow;
  no desktop wrapper or global npm package is introduced.
- The project is open source under Apache License 2.0, including commercial use.

## Roadmap and tracker

The public repository and release are:

- [GitHub repository](https://github.com/satankov/on-track)
- [v0.0.1 release](https://github.com/satankov/on-track/releases/tag/v0.0.1)
- [v0.0.2 release tag](https://github.com/satankov/on-track/releases/tag/v0.0.2)
- [v0.0.3 release tag](https://github.com/satankov/on-track/releases/tag/v0.0.3)
- [v0.0.4 release tag](https://github.com/satankov/on-track/releases/tag/v0.0.4)
- [v0.0.5 release tag](https://github.com/satankov/on-track/releases/tag/v0.0.5)
- [v0.0.6 release](https://github.com/satankov/on-track/releases/tag/v0.0.6)
- [Issues](https://github.com/satankov/on-track/issues)

GitHub is the backlog and ownership tracker. The Fastify advisory is tracked by
open [PR #26](https://github.com/satankov/on-track/pull/26); it supersedes closed
PR #18. Native-action smoke tests are tracked in
[issue #32](https://github.com/satankov/on-track/issues/32), filesystem drag/drop
validation in [issue #33](https://github.com/satankov/on-track/issues/33), and
managed installation/upgrade validation in
[issue #34](https://github.com/satankov/on-track/issues/34).
[v0.0.8](https://github.com/satankov/on-track/releases/tag/v0.0.8) is the latest published release;
v0.0.9 is the selected candidate; see the [release procedure](RELEASING.md).
Broader product priorities above remain strategy until scoped. Durable decisions
live in `docs/adr/`; significant work lives in `docs/plans/`.

## Current risks

- A copied threadstr database is readable because at-rest encryption is absent.
- Plaintext backup bundles contain readable database metadata and attached file
  bytes. Replace mode removes all current projects and files; Merge mode adds
  selected independent projects. Neither mode merges message histories. A lost
  import response requires checking current projects before retrying.
- Source installation requires a supported Node.js LTS line and a native SQLite
  dependency. Node 22 support ends no later than upstream support, currently
  2027-04-30. The next candidate must pass full verification on Node 22.16 and
  24 on Linux, plus native SQLite install/test coverage on macOS for both lines
  and on Windows for Node 24; every future release candidate must pass those
  gates, and dependency upgrades can still affect portability.
- Managed installation requires additional clean-machine, background-process,
  and interrupted-update evidence for each advertised OS/architecture. Its
  database checkpoints remain plaintext, need free disk space, and are not
  independent backups of attachment files. Existing pre-protocol source releases
  must be stopped and upgraded manually before explicit adoption.
- The configured production audit passes its high-severity gate but currently
  reports a moderate Fastify advisory. The available fixed version is outside
  the exact declared dependency and requires explicit upgrade verification.
- v0.0.4 deliberately does not restore v0.0.3/schema-2 backup bundles. Live
  v0.0.3 databases still migrate at startup, and this compatibility break is
  acceptable only under the current no-user alpha assumption.
- Native command construction is tested for macOS, Windows, and Linux, but real
  OS dispatch has been manually reported only on one macOS host. Windows and
  Linux desktop integration remains unverified.
- Browser file-drop regressions pass, but actual Finder-origin dragging and
  cancellation remain manually unverified; this is separate from native Open.
- Loopback HTTP narrows exposure but is still a trust boundary requiring Host,
  Origin, content-security, and input-validation controls.

## Maintenance rule

Update this file when vision, phase, non-goals, success criteria, or cross-feature
priorities change. Do not use it as a session log.
