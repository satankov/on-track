# Project sidebar pins, previews, and Attention implementation plan

## Goal

Extend the existing project rail without changing its visual system:

- persist project-level pin/unpin state and keep pinned projects in a stable
  section above activity-sorted projects;
- replace generic update copy with a one-line latest-message preview;
- replace the trailing chevron with a bright or dim Attention status;
- remove the project accent dot while retaining the selected-project accent
  keyline.

This implementation slice was approved after the rendered design review on
2026-09-04 and implemented against the current visual system.

## Context and reusable precedent

- `src/client/App.tsx` already owns `sortChats`, `chatFromDetail`, and
  `commitProjectUpdate`, which form the canonical synchronization path between
  project summaries and the active project detail. Note and label mutations can
  update the sidebar through that path instead of adding parallel state.
- Before this slice, `ProjectRail` rendered the accent dot, generic update copy,
  and `ChevronRightIcon`. `PinIcon`, the selected accent keyline, inline SVG
  language, and focus treatment already exist.
- `useTimelineNow` already demonstrates bounded timers for future-dated
  messages. The project rail can use the same maximum-timeout rule for future
  Attention timestamps and the next local midnight.
- `src/server/db/repository.ts` already provides deterministic
  `(created_at, id)` note ordering, batched label reads, parameterized queries,
  and idempotent message-label mutations that do not alter project activity.
- `src/server/chat-service.ts` already injects a clock, so summary reads and pin
  writes can be deterministic in tests.
- `src/server/database-transfer/sqlite-backup-bundle.ts` validates exact schemas
  and application rows before replacement. Schema-3/v0.0.4 backup compatibility
  must remain explicit and fail closed rather than becoming permissive.
- Light, Neutral, and Dark already expose the required rail, selection, focus,
  and critical semantic colors in `src/client/styles.css`.
- Current React, Zod, Drizzle, SQLite, Vitest, and Playwright primitives cover
  the complete slice. No new package is justified.

The interaction follows native sibling buttons: one opens the project and one
toggles the project pin. The pin button keeps a stable accessible name and uses
`aria-pressed`, consistent with the WAI-ARIA button pattern. Attention has a
visible non-color distinction plus programmatic text, consistent with WCAG 2.2
Use of Color.

## Acceptance criteria

1. Existing projects migrate with `pinned_at = NULL`; new projects start
   unpinned. Pin state survives page reload, server restart, export, and restore.
2. Pin and unpin are idempotent. Repeated pinning preserves the original pin
   timestamp; neither action changes `updatedAt`.
3. Pinned projects appear first and sort by `pinnedAt DESC, id ASC`. New pins
   enter at the top. Message activity never reorders pinned projects. Unpinned
   projects retain `updatedAt DESC, id ASC` ordering.
4. The Pinned section is absent when empty. Its count includes only pinned
   projects; the Projects count includes only unpinned projects. Unpinning
   returns a project to activity order.
5. Each project row shows the latest message at or before the current service
   time by deterministic `createdAt DESC, id DESC` ordering. Future messages are
   excluded until their timestamp arrives. The server bounds preview source
   text, the client collapses whitespace, and CSS applies width-aware one-line
   ellipsis. A project with no current messages shows `Ready for the first note`.
6. The preview and activity order update immediately after append, edit,
   timestamp change, or deletion. They remain correct under out-of-order async
   responses through the existing mutation-generation guards.
7. Attention is derived from currently applied message labels:
   - at least one timestamp from browser-local start of today through `now`
     produces the bright dot;
   - otherwise, at least one timestamp before today produces the dim dot;
   - future-only Attention produces no dot until its timestamp arrives;
   - bright wins when today and older Attention both exist;
   - removing the last qualifying label updates the state immediately.
8. Previews and Attention change at their relevant future timestamps, and
   Attention changes at local midnight, without a page reload. The timer is
   bounded, refreshes summaries at temporal boundaries and browser focus, and
   ignores stale responses.
9. The project accent dot and chevron are removed. The selected project retains
   its accent keyline and existing background treatment.
10. The project-selection and pin controls are sibling native buttons, never
    nested controls. A pin button has a stable `Pin <project>` accessible name,
    `aria-pressed`, disabled/busy behavior, and restores focus after its row
    moves sections.
11. Pinned controls are always visible. Unpinned controls appear on hover or
    keyboard focus at desktop widths while remaining focusable; coarse-pointer
    and mobile layouts show all pin controls with approximately 44px targets.
12. Failed pin persistence leaves state and order unchanged, keeps focus on the
    control, and presents a row-associated recoverable alert.
13. The project-open control programmatically includes pinned and Attention
    state. Current Attention uses a red filled dot plus halo; earlier Attention
    uses the same filled dot in neutral grey without a halo. Forced colors map
    these to Highlight and GrayText while the programmatic descriptions preserve
    meaning.
14. Light, Neutral, and Dark retain current typography, 58px row density, rail
    width, hover/selection treatment, and mobile list/detail behavior. The rail
    reflows without document-level overflow at 200% zoom and with long titles
    and message content.
15. Schema-4 backups preserve valid pin timestamps and reject malformed pin
    data or altered schemas without replacing live data. A strictly validated
    schema-3/v0.0.4 backup is migrated to schema 4 during staging; schema 2 and
    unknown schemas remain unsupported.
16. Live schema-3 databases migrate automatically. Older application versions
    refuse schema 4 through the existing schema-version and migration-ceiling
    checks.

## Non-goals

- Drag-and-drop or manual ordering inside the Pinned section.
- Pin limits, folders, custom sidebar sections, sorting preferences, search, or
  cross-project filtering.
- Notifications, unread counts, label history, due dates, or automatic removal
  of Attention labels.
- Changing the existing message-level Pin or Attention semantics.
- Rendering Markdown in sidebar previews.
- A new theme, mobile redesign, icon dependency, state library, or runtime
  dependency.
- Editing a shipped migration or changing attachment/native-action behavior.

## Implemented design

### Domain and summary contract

Extend `Chat` with:

```ts
pinnedAt: number | null;
latestMessagePreview: string | null;
nextMessageAt: number | null;
latestAttentionAt: number | null;
nextAttentionAt: number | null;
```

Only `pinnedAt` is stored. The other fields are bounded, server-derived summary
data:

- `latestMessagePreview` comes from the last note at or before the service clock
  by timestamp and ID, capped at a small source length before transport; it is
  rendered as literal text, never Markdown or HTML.
- `nextMessageAt` is the earliest future message timestamp, allowing the client
  to reveal a scheduled message preview when it becomes current.
- `latestAttentionAt` is the greatest Attention-labeled note timestamp not
  later than the service clock.
- `nextAttentionAt` is the earliest Attention-labeled note timestamp later than
  the service clock. It lets the client schedule the next state transition
  without polling.

Repository summary reads remain batched: read chats once, batch enabled labels,
select current-time latest-note previews and next-message timestamps for all chat
IDs, and aggregate Attention timestamps grouped by project. Do not issue one
query per project.

`ChatService.clock()` supplies a single `now` to `listChats` and `getChat`, so
past/future classification is consistent and testable.

### Persistent project pin mutation

Project pinning is separate from project editing and the message-level Pin label:

```text
PUT    /api/chats/:id/pin
DELETE /api/chats/:id/pin
```

Both routes are maintenance-gated and return only
`{ pinnedAt: number | null }`, preventing a narrow pin response from replacing
newer sidebar summary data.

Repository behavior is parameterized and idempotent:

- pin uses `pinned_at = COALESCE(pinned_at, :now)`;
- unpin uses `pinned_at = NULL`;
- neither statement modifies `updated_at`.

The client patches only `pinnedAt`, applies canonical sorting, moves focus to
the same keyed pin control, and leaves the old state intact on failure.

### Client summary and temporal state

Extend `chatFromDetail` rather than adding another client cache. Pure helpers
will:

- sort pinned and unpinned projects;
- normalize and bound preview whitespace;
- derive latest-message and Attention summary fields from active detail notes;
- classify Attention using browser-local start of day and `Date.now()`.

Append, edit, delete, timestamp, and label mutations first construct the updated
`ChatDetail`, then derive its matching `Chat` summary through the canonical
commit path.

A project-rail time hook schedules the earliest of the next local midnight,
future message timestamp, and future Attention timestamp, clamped by the
existing maximum timer delay. At a boundary it updates the clock immediately and
performs one guarded project-summary refresh to discover subsequent future
timestamps. Window focus performs the same guarded refresh after sleep or clock
changes.

### Rail structure and visual states

Each row becomes a structural container with:

- a full-height project-selection button containing title, preview, and
  assistive status text;
- a sibling project-pin button in the upper trailing position;
- a non-interactive Attention mark beneath the pin in a visually centered
  trailing status cluster.

The selected keyline stays unchanged. Pinned rows keep the filled pin visible;
desktop unpinned pins reveal on hover or `:focus-within`; mobile/coarse-pointer
pins remain visible. The existing transition duration and reduced-motion rule
are reused.

Attention uses current theme tokens. Current and earlier states share the same
filled-dot geometry: current is critical red with a halo; earlier is neutral grey
without a halo. Message-level Attention reuses the current dot, and icon-only
message Pin and Attention markers have no surrounding pill border. Forced colors
map current to Highlight and earlier to GrayText.

### Backup compatibility

Advance the current live and backup schema to 4. Export produces schema 4.

Restore dispatches by the manifest schema version:

- schema 4 follows the current exact-schema path;
- schema 3 is checked against one explicit, immutable v0.0.4 descriptor,
  including object names, columns, definitions, foreign keys, indexes, and
  migration timestamps;
- after exact validation and bundle payload checks, a schema-3 candidate has
  bundle-only tables removed, runs checked-in migration 0004, and must pass the
  complete trusted schema-4 and application-data validation before activation;
- schema 2, malformed schema 3, and unknown versions fail closed before live
  replacement.

This keeps legacy acceptance narrow and does not reintroduce permissive imported
schema trust.

## Data and migration impact

Add one immutable migration, `drizzle/0004_project_sidebar_state.sql`:

```sql
ALTER TABLE chats
  ADD COLUMN pinned_at INTEGER
  CONSTRAINT chats_pinned_at_nonnegative
  CHECK (pinned_at IS NULL OR pinned_at >= 0);

UPDATE app_metadata SET schema_version = 4 WHERE id = 1;
```

SQLite permits a nullable added column with a `CHECK`, and evaluates the added
constraint against existing rows. Existing rows therefore remain valid without
a destructive backfill.

Also:

- add `pinnedAt` and its check to `src/server/db/schema.ts`;
- add migration 0004 and its snapshot/journal metadata without modifying
  migrations 0000-0003;
- raise `CURRENT_SCHEMA_VERSION`, `LATEST_BUNDLED_MIGRATION_AT`, and
  `SQL_ON_TRACK_BACKUP_SCHEMA_VERSION`;
- validate `pinned_at` as null or a nonnegative safe integer during backup and
  prepared-database validation.

No new index is initially proposed. The sidebar is a small local dataset and
the existing activity and note-history indexes cover the ordering subqueries.
Add an index only if query-plan evidence shows it materially helps.

There is no down-migration. Once a live database reaches schema 4, older code
safely refuses it. Rollback requires a pre-upgrade backup and the older release.

## Affected files

- Domain: `src/domain/types.ts`.
- Schema and migration: `src/server/db/schema.ts`, `src/server/db/database.ts`,
  `drizzle/0004_project_sidebar_state.sql`, `drizzle/meta/_journal.json`, and a
  new snapshot.
- Persistence and service: `src/server/db/repository.ts`,
  `src/server/chat-service.ts`.
- Transport: `src/server/app.ts`, `src/client/api.ts`.
- UI: `src/client/App.tsx`, `src/client/styles.css`.
- Backup/restore: `src/server/database-transfer/sqlite-backup-bundle.ts`.
- Tests: focused domain/database/service/API/client/theme/backup tests and
  `e2e/project-chat.spec.ts`.
- Durable truth after implementation: focused changes to `docs/PROJECT.md`,
  `docs/ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`, and this plan's completion
  section. No ADR is expected because existing boundaries remain intact.

## Phases

1. **RED — persistence and project-summary contracts.** Add failing migration,
   repository, service, route, and client-API tests for nullable pin state,
   idempotent pinning, stable order, unchanged activity, deterministic bounded
   previews, Attention aggregates, unknown IDs, and encoded IDs. Expected
   evidence: focused failures only for absent schema and behavior.
2. **GREEN — schema, repository, service, and API.** Add migration 0004,
   version ceilings, batched summaries, idempotent pin methods and routes, and
   the narrow client API. Expected evidence: focused database/service/API tests
   pass and live schema-3 migration preserves every project unpinned.
3. **RED/GREEN — schema-4 backup and schema-3 restore.** First add failing
   schema-4 round-trip, pin preservation, malformed pin, altered schema,
   migration metadata, strict schema-3 upgrade, and schema-2 rejection tests.
   Then implement exact legacy dispatch and staged migration. Expected evidence:
   backup tests pass and every failed preparation leaves live state untouched.
4. **RED/GREEN — canonical client summaries and time.** Add component tests for
   previews after every note mutation, today/old/future precedence, label
   removal, midnight/future boundaries, focus refresh, and stale responses.
   Extend `chatFromDetail` and the canonical commit path. Expected evidence:
   fake-timer and out-of-order component tests pass without a second client
   cache.
5. **RED/GREEN — approved project rail.** Add sections and counts, sibling open
   and pin controls, focus restoration, busy/error handling, accessible status,
   bright/dim dots, and remove the accent dot and chevron. Expected evidence:
   Testing Library verifies names, roles, pressed state, focus, error recovery,
   and state hooks in all themes.
6. **Browser journey and rendered review.** Cover pin, activity stability,
   restart, unpin, previews, bright/dim/none Attention, future activation,
   keyboard behavior, mobile visibility, and rail overflow. Expected evidence:
   focused desktop Chromium and mobile WebKit tests pass, plus rendered checks
   at representative widths and 200% zoom.
7. **Security review, documentation, and verification.** Review project-ID
   routing, parameterized SQL, preview rendering, migration and backup
   validation, inspect the complete diff, update durable truth, and run the full
   repository gate. Expected evidence: no unresolved actionable findings and
   `npm run verify` passes.

## Test plan

Focused automated checks:

```bash
npm test -- src/server/db/database.test.ts src/server/chat-service.test.ts src/server/app.test.ts src/client/api.test.ts
npm test -- src/server/database-transfer/sqlite-backup-bundle.test.ts src/server/database-transfer/restore-journal.test.ts
npm test -- src/client/App.test.tsx src/client/theme.test.ts
npm run test:migrations
npx playwright test e2e/project-chat.spec.ts --grep "project sidebar"
```

Completion checks:

```bash
npm run build
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run test:e2e
npm run security:check
npm run verify
git diff --check
git status --short
```

Manual rendered matrix:

- Light, Neutral, and Dark at 1440x900 and 1024x768;
- current mobile WebKit/iPhone viewport;
- 200% zoom and keyboard-only navigation;
- hover/focus and coarse-pointer pin visibility;
- long/localized titles and messages;
- no-message, pinned-only, unpinned-only, and overflowing rails;
- bright, dim, absent, and future Attention;
- forced colors and reduced motion.

## Risks and mitigations

- **Project Pin versus message Pin ambiguity:** use separate endpoints, names,
  symbols, tests, and row context; do not change message labels.
- **Stale sidebar summaries:** derive active-project changes through the existing
  canonical detail-to-summary path, use narrow pin responses, and retain
  mutation-generation guards for temporal refreshes.
- **Focus loss when a row changes sections:** key controls by project ID and
  restore focus after the successful move.
- **Midnight, DST, sleep, and future timestamps:** derive day start in the
  browser's local zone, schedule exact bounded transitions, and resynchronize on
  focus.
- **Color-only status:** pair current Attention with a halo, keep earlier
  Attention halo-free, and include explicit programmatic descriptions.
- **Markdown or large-message leakage:** transport only a bounded source prefix,
  normalize whitespace, and render it as a text node rather than HTML.
- **Sidebar query growth:** batch the projection and avoid per-project queries;
  add an index only from measured query-plan evidence.
- **Legacy backup trust:** accept only the exact published schema-3 descriptor,
  migrate only after validation in staging, and require full schema-4 validation
  before activation.
- **Rollback:** the additive column has no destructive backfill; downgrade
  refusal and a pre-upgrade backup provide the recovery boundary.

## Open decisions

None. The plan resolves the approved design as follows:

- newest pinned project appears first;
- unpinned projects return to current activity order;
- the Pinned section is hidden when empty;
- preview shortening is responsive CSS ellipsis after bounded literal-text
  normalization;
- future-dated messages enter the preview only when their timestamp arrives,
  while future Attention likewise remains inactive until its timestamp;
- schema-3/v0.0.4 backups receive one strict staged upgrade path.

## Completion evidence

Implemented after approval on 2026-09-04. The final repository checks produced:

- 414 passing automated tests with one intentional skip;
- 91.07% statement, 85.07% branch, 93.38% function, and 92.42% line coverage;
- 19 passing live-migration tests;
- 16 passing desktop Chromium and mobile WebKit scenarios with two
  platform-specific skips;
- passing release contract, production build, typecheck, lint, formatting, and
  diff checks;
- a passing high-severity dependency-audit threshold, with one existing
  moderate Fastify advisory remaining.

Rendered desktop and mobile review confirmed responsive ellipsis, persistent
pin grouping, visible keyboard focus, bright current Attention, grey earlier
Attention, and the removal of the former accent dot and chevron. Independent
correctness, accessibility, backup-safety, and security review found no
remaining actionable issues. No dependency, commit, push, or release was added.
