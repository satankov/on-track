# ADR-0013: Durable workspace preferences

## Status

Accepted, 2026-10-29; approved in plan 0031, Slice 2.

## Decision

Schema 8 stores theme, Examples visibility and four sidebar disclosures in a
typed SQLite singleton. A validated no-store script applies the database theme
before React. Legacy browser values initialize the database atomically once;
successful reads/writes remove legacy keys. Partial writes preserve unrelated
fields, failures can be retried, focus refresh reconciles tabs, and replacement
pauses outstanding client writes.

Full backups include initialized preferences. Selected-project exports omit the
singleton. Replace adopts initialized included settings or retains destination
settings; merge always retains destination settings. Legacy schemas migrate only
in validated staging. Drafts, reading anchors and filter/search choices remain
session-only.

## Consequences

A database is the authority across browser profiles and ports. Browser storage
cannot reset settings or compete with a second cached copy. Typed columns keep
validation and import guarantees explicit. Schema 8 requires current code.

## Verification

API/restart, queued-write/focus races, legacy migrations, hostile metadata and
full/selected backup tests cover persistence. Desktop and mobile browser tests
verify cache-clearing recovery and theme application before React.
