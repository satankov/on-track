# Multi-filters, durable preferences, and custom labels

Slices 1–3 approved, 2026-10-29. Slices 1 and 2 are complete; custom labels follow in a separate commit.
The source now uses schema 8.

## Slice 1 — multiple filters

Command/Ctrl selection and touch toggles intersect filters and search (AND).
All clears selection. Canonical combination keys retain reading positions and
whole-project counts. Disabled filters leave the selection on refresh.
The compact `⌘/Ctrl + multiple` hint shares send-shortcut typography, without a
checkbox. Desktop filters span history and composer height; only overflowing
lists scroll. Mobile keeps horizontal filters. No database or dependency change.

Verification: build/types/lint, unit/component tests and desktop/mobile browser
journeys verify selection and full-height geometry in this isolated commit.
The final plan closeout will record aggregate evidence for all three slices.

## Slice 2 — database preferences

Theme, Examples visibility and the four sidebar disclosures survive browser
storage clearing and restart. One-time migration never overwrites initialized
database settings. Partial ordered writes, retryable failures, focus refresh and
replacement pause/resume preserve newer choices. Full and selected exports,
merge and replacement follow ADR-0013. Schema 8 and its versioned migration are
included. Custom label definitions remain deferred to Slice 3.
