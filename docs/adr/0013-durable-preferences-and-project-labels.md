# ADR-0013: Durable workspace preferences and project-owned labels

## Status

Accepted, 2026-10-29; approved in plan 0031, Slices 1–3.

## Context

Browser storage resets theme and other preferences when a profile or cache is
cleared. Custom project labels need stable identities across renaming, ordering,
assignment and backup transfer, while preserving built-in semantics and compact
filter geometry.

## Decision

Schema 8 adds a typed singleton for theme, Examples visibility and four sidebar
disclosures. A validated no-store script applies the database theme before React.
Legacy browser values initialize an uninitialized database atomically once;
successful reads/writes then remove the legacy keys. Partial API writes preserve
unrelated fields, failures are retryable, focus refreshes reconcile other tabs,
and replacement pauses and invalidates outstanding client writes.

Schema 9 adds project-owned definitions, keeping immutable built-ins and at most
five custom labels. Names allow 1–8 grapheme clusters; symbols allow one. Stable
server-generated custom UUIDs are independent of names and positions. Project
revision checks reject stale edits; composite foreign keys enforce note/project/
label ownership. Disable preserves assignments. Removal uses the custom row's
delete cross or clearing both fields, then saving: omitted custom definitions
and their assignments are deleted in the project transaction; messages remain.
Built-ins cannot be omitted, and stale revisions still reject the entire write.
Definition changes do not reorder projects by activity.

Full backups include preferences. Selected-project exports omit the singleton
row. Replace adopts included initialized preferences and otherwise retains the
destination; merge always retains destination preferences. Legacy schema 3–8
bundles migrate only in validated staging. Merge remaps project and custom-label
identities together; built-in IDs keep their meanings.

## Alternatives considered

- Retaining localStorage as a cache creates two authoritative copies and repeats
  the reset problem. Only temporary legacy migration reads remain.
- Arbitrary JSON settings weaken validation and import guarantees; typed columns
  fit the small fixed preference set.
- Names as label IDs break assignments on rename. Parallel built-in/custom
  assignment tables complicate ownership, ordering and import unnecessarily.
- A drag-and-drop dependency is unnecessary for this bounded list. The initial
  up/down controls were superseded by the user’s 2026-10-29 refinement: native
  Pointer Events handles with keyboard and tap-to-place alternatives, plus an
  always-available trailing empty row. Subsequent corrections make whole rows
  follow the pointer over stable layout slots and allow saving cleared-label removal.

## Consequences

Preferences now belong to one local database, shared across browser profiles and
ports. Full backups carry these settings; project-only exports remain portable.
Schema 9 requires current code and prevents older releases from reopening the
database. Built-in enablement remains compatible with an already-open old UI
without disabling custom labels. Current filter/search selections, drafts and
reading anchors stay session-only.

## Verification

Domain validation, SQLite migration and ownership tests, preference API/restart
tests, full/selected backup and merge tests, queued-write/focus race tests, and
desktop Chromium/mobile WebKit journeys cover these contracts. Plan 0031 records
the final verification evidence.
