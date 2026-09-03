# Project message labels implementation plan

## Status

Implemented on 2026-09-03. Completion verification is recorded below.

## Goal

Add durable, reaction-like labels to project messages so one message can carry
several useful classifications and project history can be filtered by them.
Keep the approved interaction within the existing On Track workspace, message,
theme, icon, and responsive conventions rather than copying the exploratory
mockup literally.

The first slice provides permanent `Pin` and `Attention` labels plus the closed
configurable vocabulary `Todo`, `Decision`, `Open question`, `Risk`, and
`Milestone`. Each project enables only the configurable labels it needs;
`Todo` and `Milestone` are enabled by default. `Files` remains an automatic
attachment facet rather than a user-applied label.

## Context and reusable precedent

- `src/domain/validation.ts` already centralizes closed vocabularies and Zod
  boundary validation. Label identifiers and project-label configuration can use
  the same pattern as project accents.
- `src/server/db/schema.ts`, `src/server/db/repository.ts`, and the checked-in
  `drizzle/` migrations already enforce ownership with foreign keys, checks,
  indexes, and transactions. SQLite supports composite primary keys plus
  `NOT NULL`, `CHECK`, and foreign-key constraints, so label relations do not
  require generated IDs or a new dependency.
- `src/server/chat-service.ts` and `src/server/app.ts` provide the service and
  maintenance-gated transport boundaries. Label mutations can remain scoped by
  project and message IDs and use parameterized repository operations.
- `src/client/App.tsx` already owns project editing, message action controls,
  project-local history filtering, mutation-generation guards, and responsive
  workspace state. `src/client/styles.css` already defines the production
  message footer, action strip, filter rail, themes, focus treatment, and mobile
  reflow to extend.
- The Files filter is an existing computed precedent: it counts and filters
  messages without persisting a redundant label.
- `src/server/database-transfer/sqlite-backup-bundle.ts` strictly validates the
  complete active and bundle schema. The new schema must extend those exact
  allowlists and add an explicit legacy-schema migration path rather than making
  validation permissive.
- The approved UX uses an accessible disclosure button followed by native
  checkboxes. This follows WAI-ARIA disclosure and checkbox keyboard semantics
  without introducing a custom menu/listbox interaction model.
- No maintained package solves a meaningful part of this closed-vocabulary,
  local-SQLite feature better than the repository's existing React, Zod,
  Drizzle, and SQLite primitives. No dependency is proposed.

## Product definitions and assumptions

- `Pin`: save for rapid retrieval.
- `Attention`: important or requires review/action. It does not schedule or send
  a notification.
- `Todo`: an unfinished action.
- `Decision`: an agreed direction or conclusion.
- `Open question`: an unresolved question.
- `Risk`: a potential negative project outcome, displayed with `⚠️`.
- `Milestone`: a meaningful project checkpoint, displayed with `🎖️`; it does
  not imply a due date or structured milestone entity.
- `Attention` is displayed with `🔴`. Other labels use the existing restrained
  inline-icon language or text, not additional emoji.
- Applying or removing a label does not change message time, chronological
  position, or project activity ordering.
- Label assignment has current-state persistence but no audit log. Removing a
  label does not retain a historical label event.
- Only one history filter is active at a time in this slice.

## Acceptance criteria

1. Every new project and every project migrated from the current schema has
   `Todo` and `Milestone` enabled; the user may enable or disable any of the five
   configurable built-in labels in Edit project and save the whole project edit
   atomically.
2. Edit project shows only the five configurable labels. It does not show an
   “Always available” section for `Pin` or `Attention`.
3. `Pin` and `Attention` can always be applied to any message. A configurable
   label can be newly applied only while it is enabled for that message's
   project.
4. One message may carry any non-duplicated combination of built-in labels.
   Applying or removing one label is immediately persisted and survives page,
   server, and application restarts.
5. Disabling a configurable label never removes it from existing messages.
   Existing inactive assignments remain visible and removable, but cannot be
   added to another message until the label is re-enabled.
6. The message label control is the first control in the existing
   label/copy/edit/delete action strip. It opens a multi-choice checkbox
   disclosure containing `Pin`, `Attention`, enabled configurable labels, and
   any inactive labels already applied to that message.
7. The disclosure has an accessible name, `aria-expanded`/`aria-controls`,
   logical tab order, native checkbox operation, Escape/outside-click dismissal,
   and focus restoration to its trigger. A failed mutation leaves the prior
   selection intact and presents a recoverable message-level error.
8. Applied labels render in the production message footer on the same visual
   line as the timestamp when space allows. Labels wrap without overlapping or
   displacing the timestamp at narrow widths, long content, localization, or
   200% zoom.
9. History filters appear in this exact order: `All`, `Files`, `Pin`,
   `Attention`, then only the configurable labels currently enabled for the
   project in catalog order (`Todo`, `Decision`, `Open question`, `Risk`,
   `Milestone`). Each filter shows the matching-message count.
10. `Files` continues to be derived from attachment presence. A disabled
    configurable label remains on messages but is absent from the filter rail.
    Disabling the currently selected filter safely returns history to `All`.
11. Each filter preserves chronological/date grouping and has a specific empty
    state. Switching projects resets the history filter to `All`.
12. Project deletion cascades both project-label configuration and message-label
    assignments. Message deletion cascades its labels. Invalid, unknown,
    duplicated, cross-project, disabled-on-apply, and malformed label input is
    rejected without partial writes.
13. Versioned backup export includes project configuration and message labels.
    Restore preserves them, and current On Track can still strictly validate,
    stage, migrate, and restore a valid schema-v2/v0.0.3-or-v0.0.4 backup with
    `Todo` and `Milestone` backfilled.
14. The important journey works with keyboard and pointer input in Light,
    Neutral, and Dark themes at representative desktop and mobile widths, with
    visible focus, forced-color-safe meaning, and no horizontal page overflow.

## Non-goals

- User-created, renamed, reordered, colored, imported, or deleted label
  definitions.
- More built-in labels than the seven approved labels.
- Multiple simultaneous filter conditions, AND/OR logic, saved views, global
  cross-project filtering, search, or sorting by label.
- Reminder dates, notifications, due dates, priority, owner, completion history,
  task objects, or structured milestone tracking.
- Applying labels during initial message composition or changing labels inside
  the message edit composer; labels are managed by the separate message action.
- Server-side paginated filtering; the current project detail remains the source
  for the client-side history slice.
- An ADR unless implementation reveals a durable architectural decision beyond
  the existing localhost/service/repository/migration boundaries.
- New runtime or development dependencies.

## Proposed design

### Domain contract

Define one stable machine vocabulary:

```text
pin, attention, todo, decision, open-question, risk, milestone
```

Expose ordered constants and Zod schemas for all labels, configurable labels,
default enabled labels, project configuration arrays, and route label
parameters. DTOs add ordered `enabledLabels` to `Chat` and ordered `labels` to
`Note`. The server, not database row order, returns catalog order consistently.

`createChat` keeps the existing input shape and applies defaults server-side.
`updateChat` accepts an optional complete `enabledLabels` array, rejects unknown
or duplicate values, and atomically replaces the project's enabled-label rows
when supplied.

### Persistence and service behavior

Add two relation tables:

```text
chat_enabled_labels(chat_id, label)
note_labels(note_id, label)
```

Both columns are explicitly `NOT NULL`; each pair is a composite primary key.
The parent ID is a cascading foreign key. Database `CHECK` constraints allow
only the appropriate closed vocabulary: five configurable labels for project
settings and all seven labels for messages. The primary-key order supports
project/message ownership reads without extra indexes in this slice.

Creating a project inserts the two defaults in the same transaction. Updating
project configuration replaces only the configuration relation, never
`note_labels`. Project reads batch-load enabled labels; project-detail reads
batch-load message labels alongside the existing attachment batch to avoid
per-message queries.

Add idempotent, project-and-message-scoped label operations. Applying validates
that the label is permanent or currently enabled inside the same database
transaction; removal permits any currently applied label, including inactive
ones. Neither operation updates note time or chat activity. The service maps a
missing scoped message to the existing not-found response and a disabled or
invalid label to the existing safe invalid-input response.

Expose dedicated idempotent routes:

```text
PUT    /api/chats/:id/notes/:noteId/labels/:label
DELETE /api/chats/:id/notes/:noteId/labels/:label
```

Each route runs through the maintenance mutation gate and returns the complete
ordered label array for that message. The API client updates only that message's
labels after success, avoiding an attachment refresh or full project reload.

### Migration and backup compatibility

Create a new immutable migration that:

1. creates both constrained relation tables;
2. backfills `todo` and `milestone` for every existing chat;
3. raises `app_metadata.schema_version` from 2 to 3.

Update the runtime migration ceiling and schema tests. Extract or reuse one
checked-in-migration runner so normal startup and staged restore cannot drift.

The backup exporter writes schema version 3 and validates the two new tables,
columns, foreign keys, composite-key indexes, normalized SQL definitions, and
closed-vocabulary row data. Restore recognizes only two exact known bundle
shapes: legacy schema 2 and current schema 3. It does not accept arbitrary
intermediate objects or columns. A legacy bundle is fully validated as schema 2,
copied and staged, stripped of bundle-only payload tables, migrated through the
checked-in schema-3 migration, and then fully validated as the current active
schema before activation. This preserves the v0.0.3 compatibility promise while
keeping malformed imports fail-closed.

### Production UI

Extend `ProjectEditWorkspace` with a native-checkbox fieldset after the existing
accent controls. Initialize it from `chat.enabledLabels`, submit it with title
and accent, and reuse the existing form error, saving, cancellation, responsive,
and theme conventions. Do not render permanent labels in project settings.

Add a focused message-label disclosure component. Its icon-only trigger is
inserted immediately before Copy, Edit, and Delete in the existing action strip.
The anchored surface reuses production tokens, elevation rules, inline SVG
language, focus styles, and mobile always-visible actions. It shows native
checkboxes rather than emulating a menu/listbox. Inactive-but-applied labels are
identified as inactive and may only be unchecked.

Render compact label marks at the start of `.message-footer`, with the time kept
at the end. Use the approved `🔴`, `⚠️`, and `🎖️` marks for Attention, Risk, and
Milestone; use the repository's restrained monochrome inline icons for Pin,
Todo, Decision, and Open question. Pin and Attention are icon-only inside
messages, with their full names retained for assistive technology and tooltips.
The exploratory tag silhouette is optional: production readability, theme
coherence, wrapping, and density take precedence over copying it.

Generalize history-filter state to represent `all`, `files`, or one label.
Generate buttons and counts in the exact approved order. Preserve the existing
desktop vertical rail and mobile horizontal-scrolling treatment, adjusting
width/wrapping only as required for production labels and 200% zoom. Use an icon
for every filter, concise filter-only aliases where full names do not fit, and a
separate count badge while preserving the full accessible label name.

### Affected surfaces

- Domain: `src/domain/types.ts`, `src/domain/validation.ts`, and validation
  tests.
- Persistence: `src/server/db/schema.ts`, `src/server/db/repository.ts`,
  `src/server/db/database.ts`, one new `drizzle/` migration and journal/snapshot
  metadata, plus database/repository tests.
- Service/API: `src/server/chat-service.ts`, `src/server/app.ts`,
  `src/client/api.ts`, and focused service/API-client/API tests.
- Backup/restore: `src/server/database-transfer/sqlite-backup-bundle.ts` and its
  legacy/current validation and round-trip tests.
- UI: `src/client/App.tsx`, `src/client/styles.css`, component/theme tests, and
  `e2e/project-chat.spec.ts`.
- Durable truth after implementation: `docs/PROJECT.md`,
  `docs/ARCHITECTURE.md`, and this plan's completion evidence. No ADR is planned
  unless the approved implementation changes an architectural boundary.

## Data and migration impact

- Schema version increases from 2 to 3 through one immutable additive
  migration.
- Existing and new projects receive `Todo` and `Milestone` settings. Existing
  messages start with no applied labels.
- Relation rows are small plaintext metadata and are included in existing local
  database and backup confidentiality warnings.
- Cascades prevent orphan label rows. Closed-vocabulary checks and composite
  primary keys prevent unknown or duplicate assignments even if an application
  bug bypasses domain validation.
- Rollback to an older executable is intentionally refused by the existing
  newer-schema and newer-migration guards. User recovery is restore from a
  pre-upgrade backup with the older application, not down-migration of the live
  database.

## Phases

1. **RED — contracts, migration, and persistence guarantees.** Add failing
   domain, migration, repository, and schema-version tests for vocabularies,
   defaults, constraints, cascades, configuration replacement, scoped label
   mutation, inactive retention, ordering, and unchanged timestamps/activity.
   Expected evidence: focused tests fail only because label behavior is absent.
2. **GREEN — domain and persistence.** Add the immutable schema-3 migration,
   Drizzle schema, typed DTOs/validation, repository operations, and service
   behavior needed to satisfy Phase 1. Expected evidence: focused domain,
   database, and service tests pass with no new dependency.
3. **RED/GREEN — transport contract.** Add failing then passing API and API-client
   tests for project configuration and idempotent apply/remove routes, including
   invalid, inactive, cross-project, and missing-message cases. Expected
   evidence: scoped JSON contracts pass through the maintenance gate and leak no
   internal details.
4. **RED/GREEN — backup compatibility.** Add legacy schema-2 fixtures and current
   schema-3 tests before extending strict validators and staged migration.
   Prove current export/restore preservation, legacy backfill, malformed-row and
   unexpected-schema rejection, failure-before-activation, and recovery
   validation. Expected evidence: focused transfer and migration suites pass.
5. **RED/GREEN — project settings and message labels.** Add component tests, then
   extend the production project editor, message footer/action strip, accessible
   checkbox disclosure, mutation errors, and inactive-label behavior. Expected
   evidence: keyboard-accessible component tests pass across representative
   label states.
6. **RED/GREEN — filtering and responsive integration.** Add exact-order,
   count, empty-state, project-switch, active-filter-deactivation, Files-facet,
   narrow-layout, and theme tests, then generalize the existing filter rail.
   Expected evidence: component/theme tests pass without regressing attachments,
   composer, message management, or project editing.
7. **Browser journey and durable documentation.** Extend Playwright with
   configure → multi-label → filter → deactivate → retained chip → restart
   behavior on desktop and the existing mobile regression viewport. Update
   project and architecture documents to current truth. Expected evidence:
   focused Chromium/WebKit journeys and documentation review pass.
8. **Security and completion verification.** Review the full diff and validate
   input allowlists, scoped ownership, parameterization, transactions, cascade
   behavior, exact backup schemas, legacy staging, error redaction, and no data
   loss on deactivation or failed restore. Run the repository verification loop.
   Expected evidence: no unresolved actionable review findings and all listed
   quality gates pass.

## Test plan

- Focused domain/client/API: `npm test -- src/domain/validation.test.ts src/client/api.test.ts src/server/app.test.ts`
- Focused persistence/service: `npm test -- src/server/db/database.test.ts src/server/chat-service.test.ts`
- Focused backup/restore: `npm test -- src/server/database-transfer/sqlite-backup-bundle.test.ts src/server/database-transfer/restore-journal.test.ts`
- Focused UI/theme: `npm test -- src/client/App.test.tsx src/client/theme.test.ts`
- Migration gate: `npm run test:migrations`
- Focused browser journey: `npx playwright test e2e/project-chat.spec.ts --grep "labels"`
- Full completion gate: `npm run verify`
- Manual rendered inspection: populated and empty label filters, long/wrapped
  footer labels, inactive applied label, open picker, mutation error, project
  settings, Light/Neutral/Dark, keyboard-only use, desktop at 1440×900 and
  1024×768, mobile width, forced colors, reduced motion, and 200% zoom.

## Security review

No security finding exists in the unchanged code. The planned change introduces
one new untrusted string vocabulary and new imported database rows, so the
implementation review must verify:

- route bodies/parameters and project arrays are schema-validated against exact
  allowlists with duplicate rejection;
- repository statements remain parameterized and mutations resolve both project
  and message ownership at the database boundary;
- configuration replacement and label application are transactional, and
  disabling a label cannot delete assignments;
- foreign keys, explicit `NOT NULL`, composite primary keys, and checks make
  invalid/duplicate/orphan rows unrepresentable during normal writes;
- backup import accepts only exact schema-2 or schema-3 shapes, validates all
  label rows before writes, migrates only in private staging, and validates the
  complete current candidate before live replacement;
- client errors do not expose SQL, paths, database contents, or note text.

Residual risk remains the project's documented plaintext database/backup model;
labels add metadata but do not change that confidentiality boundary.

## Risks and mitigations

- **Backup regression:** strict validators currently know only schema 2.
  Mitigation: preserve a versioned exact schema-2 descriptor, add an exact
  schema-3 descriptor, migrate only after legacy validation in staging, and test
  failure-before-activation.
- **Silent label loss on deactivation:** replacing settings could accidentally
  cascade or delete message assignments. Mitigation: independent tables, no
  foreign key from message assignments to enabled settings, repository tests,
  and a browser retention journey.
- **Unauthorized/inconsistent application:** a client could attempt to apply a
  disabled label or address a note in another project. Mitigation: one scoped
  transactional repository operation and API/service negative tests.
- **Stale client state:** focus refresh, project switching, and rapid toggles may
  race. Mitigation: reuse mutation-generation/project-ID guards, disable an
  in-flight checkbox, return the authoritative ordered label array, and test
  rejection/retry.
- **Footer and rail crowding:** several labels, long names, small screens, or
  zoom can overlap the timestamp or consume history width. Mitigation: flex-wrap
  labels before the nonshrinking time, preserve the current mobile horizontal
  rail, adjust production dimensions minimally, and render realistic extremes.
- **Overpromising Attention/Milestone:** users may expect notifications, due
  dates, or progress. Mitigation: keep definitions and UI copy explicit and do
  not add notification or scheduling language.

## Resolved decisions

The approved and implemented slice uses these behaviors:

1. Applying/removing a label does not update project activity ordering.
2. Existing inactive labels appear in a message's picker as removable
   “inactive” selections; once removed, they disappear until re-enabled for the
   project.
3. Label configuration is available only while editing an existing project;
   project creation uses server-defined `Todo` and `Milestone` defaults.
4. A label mutation saves immediately rather than waiting for a separate Save
   action in the picker.

## Completion evidence

- RED: focused domain/database tests failed on the absent label constants,
  defaults, DTO fields, and persistence methods; focused service and transport
  tests then failed on the absent scoped mutation methods and routes; component
  tests failed on the absent settings, footer, picker, and filter behavior.
- GREEN: focused domain, persistence, service, API, backup, component, and
  migration suites passed before the broader gate.
- `npm run verify`: passed on 2026-09-03. This included release contract, build,
  typecheck, lint, formatting, 366 passing unit/integration/component tests with
  one existing platform skip, 90.12% statement and 83.12% branch coverage, the
  schema migration gate, 12 passing Playwright journeys with two intentional
  project-specific skips, and the high-severity production dependency audit.
- Backup evidence covers current schema-3 label preservation and strict
  schema-2 validation followed by private staged migration with Todo/Milestone
  backfill.
- Rendered inspection covered the populated footer, exact filter order,
  inactive applied label, open picker, desktop Chromium, and mobile WebKit. The
  desktop rail was widened from 78px to 128px; compact aliases, left-aligned
  icons, and separate count badges keep every filter legible without clipping.
- Security review found no new actionable issue. Label values are closed at Zod
  and SQLite boundaries, mutations are parameterized and scoped by project plus
  message, configuration replacement is transactional, and import remains
  fail-closed. The existing plaintext-data risk is unchanged. The audit reports
  one moderate Fastify advisory below the repository's high-severity failure
  threshold; dependency remediation is outside this feature slice and is
  tracked by [Dependabot PR #6](https://github.com/satankov/on-track/pull/6).
