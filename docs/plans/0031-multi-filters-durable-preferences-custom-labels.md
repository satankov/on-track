# Multi-filters, durable preferences, and custom labels

Status: Completed and verified locally, 2026-10-29. The user approved Slices 1–3
and the subsequent UI corrections. This is unreleased source work; the published
baseline remains v0.1.0/schema 7. Implementation began at `4b549ff` and advances
the database/backup schema to 9 without changing backup container format 1.

## Completed scope

### Multiple history filters

- Ordinary mouse clicks select one filter. Command-click on Apple platforms or
  Ctrl-click on Windows/Linux toggles additional filters; keyboard activation
  follows the same modifier convention. Touch taps toggle directly.
- All, or removing the final selection, clears the filter set. Messages must
  match **every selected filter** and the current search query. Links + Pin means
  pinned messages containing links. Counts still describe the whole project.
- Canonical combination keys preserve reading positions, including All's special
  anchor, and are independent of selection order. Disabled/deleted labels leave
  the active filter set without losing surviving selections.
- Native pressed buttons retain the existing 128px desktop rail. The exact hint
  is `⌘/Ctrl + multiple`, directly beneath the list, sharing the send hint's
  typography. There is no multiselect checkbox.
- Desktop filters span the full area below the header alongside history and the
  composer. Composer growth/search does not shorten the rail; only overflowing
  lists scroll. Mobile keeps horizontal filters with the hint underneath.

### Database-backed preferences

Schema 8 adds a constrained singleton with these settings:

| Legacy browser key            | Database-owned values                           | Fresh default |
| ----------------------------- | ----------------------------------------------- | ------------- |
| `on-track-theme`              | Light / Neutral / Dark                          | Light         |
| `on-track-show-examples`      | Examples visibility                             | On            |
| `on-track-collapsed-sections` | Pinned, Projects, Archive, Examples disclosures | Expanded      |

These were all browser-persisted application preferences. Project customization
already belonged to SQLite. Search/filter selections, unsaved drafts, navigation
and reading anchors remain transient session state.

- The same-origin, no-store `/api/preferences/bootstrap.js` applies a validated
  database theme before React. It replaces the static browser-storage bootstrap;
  no cache is a second authoritative copy.
- A one-time transactional initializer adopts valid legacy values only while
  the database is uninitialized. The first successful initialization wins;
  subsequent reads/writes remove legacy keys. A clean browser initializing first
  cannot recover values held only in another browser profile.
- Strict, bounded partial updates preserve unrelated fields. The client queues
  saves, rejects stale reads, reports retryable failures, and refreshes on focus.
  Database replacement pauses/invalidates pending work and reloads preferences
  from the active connection rather than replaying stale writes.
- Preferences survive browser-data clearing, fresh profiles and server restart
  when those clients use the same database. Fresh databases still default to Light.

### Project labels

Schema 9 adds project-owned definitions, seeds existing built-ins and migrates
all assignments, including disabled labels. Composite foreign keys enforce both
note/project and label/project ownership; names and positions are unique within
one project. Custom IDs are server-generated UUIDs independent of display text.

- Keep all seven built-ins and their names/symbols immutable. Pin and Attention
  remain enabled and first. Optional built-ins and custom labels can be reordered
  and enabled/disabled.
- Allow at most **five custom labels** per project. Names contain **1–8 visible
  grapheme clusters**, with one optional symbol/emoji grapheme. Validation bounds
  raw input before segmentation, rejects invisible-only/control/bidi text and
  duplicate normalized names, and preserves valid joined emoji.
- Built-in/custom rows share dimensions, alignment, icon/name columns and square
  checkboxes. Custom fields use `☆` and `Label name` placeholders with accessible
  names. Limit errors appear while typing.
- One trailing empty custom row is available while capacity remains. Typing
  activates it and creates the next placeholder; fully cleared rows collapse to
  one blank without losing focus. Empty rows never enter Save.
- Whole rows follow pointer dragging, with neighboring rows shifting over stable
  layout slots. Hit testing uses the visible row center and final release
  coordinates. Autoscroll, Escape/cancel, keyboard arrows/Home/End and tap-to-place
  alternatives are supported. Deferred focus restoration preserves newer focus.
- Every filled custom row, including saved/shuffled labels, has a small × right
  of its checkbox. Using it, or clearing both fields, removes the definition and
  its message tags **on Save**; messages remain. Disabling instead preserves tags.
  Retyping a cleared saved row before Save retains that row's identity.
- Full project edits and label configuration save transactionally. Revisions
  reject stale edits; foreign IDs and omitted built-ins are rejected. Surviving
  IDs/assignments remain stable, rollback preserves data, and label-only edits
  do not reorder projects by activity.

## Backup, import and compatibility

| Operation               | Preference policy                                                          | Label policy                                                  |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Full export             | Include effective initialized settings in the private snapshot             | Include definitions and assignments                           |
| Selected-project export | Omit the singleton row                                                     | Include selected definitions and assignments                  |
| Replace                 | Adopt included initialized settings; otherwise retain destination settings | Adopt validated selected project records                      |
| Merge                   | Preserve destination settings                                              | Copy independently, remapping custom and project IDs together |

Exporting does not initialize the live database. Replacement marks preserved
settings initialized so legacy browser values cannot override them. Selecting
some projects from a full bundle still restores included preferences in Replace.
Built-in IDs retain their semantic meaning in each project scope; copied/merged
projects start at revision 0. Example notebooks expose read-only definitions and
copies seed ordinary project data.

Current format 1/schema 9 bundles and legacy schema 3–8 bundles are validated
against exact migration-derived schemas and domain constraints. Legacy migration
runs only in private validated staging; excluded records are validated before
selection pruning. Migrations 8/9 and their snapshots/journal are additive;
shipped migrations remain unchanged. Older code cannot reopen schema 9. Recovery
uses a matching pre-upgrade checkpoint/backup and application version.

## Implementation and durable decisions

- Filters: `src/client/history-filters.ts`, App selection/matching and history
  anchors, with the shared layout/shortcut contract in `DESIGN.md` and the cookbook.
- Preferences: `src/domain/preferences.ts`, `src/server/db/preferences.ts`,
  `src/server/preferences-routes.ts`, and `src/client/useWorkspacePreferences.ts`.
- Labels: `src/domain/labels.ts`, `src/server/db/project-labels.ts`,
  `src/client/ProjectLabelsEditor.tsx`, draft/context helpers and reordering hook.
- Storage/transfer: migrations 8/9, repository/schema, exact-schema backup
  validation, project import/copy and example services.
- [ADR-0013](../adr/0013-durable-preferences-and-project-labels.md) owns the
  preference/label storage rationale; it supersedes browser preference storage
  in ADR-0009. [Architecture](../ARCHITECTURE.md), [user guide](../USER_GUIDE.md)
  and [compatibility](../compatibility.md) describe the current contracts.

Existing React, Zod, SQLite, native controls and `Intl.Segmenter` cover the scope;
no dependency was added. Maintained React Aria and dnd-kit implementations were
reviewed before choosing native controls for the bounded list. Relevant primary
references: [React Aria selection](https://react-aria.adobe.com/selection),
[WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/),
[Pointer Events](https://www.w3.org/TR/pointerevents3/),
[WCAG dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
and [ECMA-402 Segmenter](https://tc39.es/ecma402/#segmenter-objects).

## Verification and completion evidence

Final `npm run verify` passed on 2026-10-29:

- Build, release contract, typecheck, lint and format: PASS.
- Unit/integration: **1,112 passed**, 9 platform-specific skips across 83 files.
- Coverage: **92.21% lines**, **85.54% branches**; repository gates pass.
- SQLite migration/integrity suite: **27 passed**.
- Browser E2E: **82 passed**, 16 intentional platform skips, desktop Chromium
  and mobile WebKit. Critical journeys include cache clearing/prepaint/restart,
  intersecting filters, custom limits/order/deletion, retained messages/tags,
  backup/restore, full-height filters, search and expanded composers.
- Production dependency audit: **zero vulnerabilities**.
- Managed installation, failed/successful update recovery and uninstall smoke
  checks: PASS against disposable directories.
- Independent client/storage/security reviews and `git diff --check`: PASS.

The user requested three separate feature commits. The filter-only schema-7
snapshot passed build, types, lint, formatting, 1,046 unit/integration tests and
48 distinct browser checks. The preferences schema-8 snapshot passed the same
static gates, 1,057 unit/integration tests and 53 browser checks. Both intermediate
snapshots were reviewed independently; the full gate above covers the final
schema-9 custom-label feature and combined behavior.

RED/GREEN regressions reproduced preference races, stale edits, hostile imported
metadata, saved-empty label validation, off-center/final-coordinate drop errors,
delayed focus stealing and composer-dependent filter height. Twenty focused
editor tests cover the final label interactions. Screenshots were reviewed in
Light/Neutral/Dark, desktop/mobile, 320px, short desktop and 720×450 reflow
(equivalent to 200% at 1440×900).

## Remaining scope and evidence limits

No feature work or known defect remains from these approved slices. No release,
push or remote tracker mutation is part of this closeout. Existing plaintext-alpha,
platform/native-action and assistive-technology limitations remain recorded in
[PROJECT.md](../PROJECT.md#current-risks) and its tracker links. Manual Windows/Linux
modifier use and assistive-technology behavior on those platforms were not
exercised here; modifier logic and browser interactions are automated-test covered.
The build still reports the intentional external bootstrap script and existing
large-bundle advisory; neither is a failing gate. No new follow-up issue is required
for this completed scope.
