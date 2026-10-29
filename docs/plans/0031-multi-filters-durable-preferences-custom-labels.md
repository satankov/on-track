# Multi-filters, durable preferences, and custom labels

Slices 1–3 approved, 2026-10-29. This commit completes Slice 1; database preferences
and custom labels follow in separate commits. Baseline schema remains 7.

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
