# On Track project

## Vision

On Track is an open-source, private-by-default personal project tracker for
managers, project managers, and individuals. It replaces scattered notes,
decisions, meeting records, and progress spreadsheets with a familiar private
chat-like stream: the user writes to their own project, not to a team.

The long-term product promise is user ownership. It should run locally, avoid
third-party data services, and eventually protect a copied database well enough
for confidential work. Version 0.0.1 proves the workflow but does not yet fulfill
the encryption or recovery parts of that promise.

## Current phase

Version 0.0.1 plaintext alpha is published as an immutable GitHub source release
under Apache License 2.0. The project is collecting early feedback and selecting
the first post-alpha data-safety slice.

## Current objective

Prioritize and plan the first post-alpha slice without relaxing the plaintext and
recovery warnings. Backup/export/restore and integrity checking are the leading
safety need before users entrust important data to the application.

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

## Current capabilities

- Create and switch between personal project chats.
- Rename a project and select a restrained accent color.
- Add multiline plain-text notes in deterministic chronological order.
- Persist state across browser and server restarts.
- Use a responsive, accessible browser interface served from a local process.

## Near-term priorities

1. Design backup, export, restore, integrity checking, and recovery before users
   entrust irreplaceable data to the application.
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

## Non-goals for v0.0.1

Collaboration, accounts, attachments, labels, filtering, search, edit/delete,
Markdown, encryption, NDA-safe claims, backup/restore, native installers, mobile
apps, peer-to-peer sync, public hosting, analytics, and telemetry.

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
- [Issues](https://github.com/satankov/on-track/issues)

GitHub Issues is the intended backlog and ownership tracker. At the v0.0.1
closeout it contains automated dependency pull requests but no product-roadmap
issues; the near-term priorities above still need tracker records. Durable
decisions live in `docs/adr/`; significant active work lives in `docs/plans/`.

## Current risks

- A copied v0.0.1 database is readable because at-rest encryption is absent.
- Backup/restore and corruption recovery do not exist, so important data could be
  lost.
- Source installation requires Node.js 24 and a native SQLite dependency. The
  release commit passed CI on Linux plus native install/test coverage on Linux,
  macOS, and Windows, but future dependency upgrades can still affect portability.
- Loopback HTTP narrows exposure but is still a trust boundary requiring Host,
  Origin, content-security, and input-validation controls.

## Maintenance rule

Update this file when vision, phase, non-goals, success criteria, or cross-feature
priorities change. Do not use it as a session log.
