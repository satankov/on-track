# Project Archive implementation plan

## Goal

Add Archive as a third project sidebar group, using the existing visual system.
Users archive only from Edit project and restore from either Edit project or a
dedicated sidebar restore icon.

Status: approved on 2026-09-09 for the complete Archive slice (Phases 1–4).
Implementation is complete; final verification evidence is recorded below.

## Context and reusable precedent

- `src/client/App.tsx`: `ProjectRail`, `RailSection`, and `collapsedSections`
  already provide grouped rows, counts, and session-local disclosures.
  `ProjectEditWorkspace` owns the real Edit project screen and its Delete,
  Back to project, and Save changes actions.
- `sortChats`, `chatFromDetail`, `commitProjectUpdate`, and `toggleChatPinned`
  establish canonical summary/detail updates and narrow pin mutations.
  The post-commit focus restoration in commit `87b6da3` must be preserved and
  extended to handle restoration into a collapsed section.
- `src/client/styles.css` provides the compact row geometry, theme tokens,
  selection keyline, 16px stroked icons, 44px row action targets, and responsive
  settings actions. Reuse these rather than introduce another visual system.
- `src/server/app.ts`, `src/server/chat-service.ts`, and
  `src/server/db/repository.ts` already implement idempotent pin routes that
  do not alter message activity. Archive can follow this path.
- Current database and backup schema are 6. Backup validation derives current
  schema from trusted migrations and accepts exact legacy schemas 3, 4, and 5.
- Relevant precedent: plans 0013 and 0017, and ADR-0001. Git history contains the
  v0.0.6 release commit despite older release-status wording in project docs;
  this proposal uses current code and schema as its baseline.

Research checked the [lucide-react package](https://www.npmjs.com/package/lucide-react)
and maintained [Lucide Archive Restore icon](https://lucide.dev/icons/archive-restore).
They provide an icon precedent, but a package does not solve the application
state or persistence requirements. Use the existing inline SVG convention with
an independently drawn plain box icon; add no dependency.
Retain the native button semantics described by the
[WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).
The additive migration uses established
[SQLite ADD COLUMN support](https://www.sqlite.org/lang_altertable.html).

## Acceptance criteria

1. Sidebar order is Pinned, Projects, Archive. Every project appears in exactly
   one group. Counts reflect each group's members. Pinned, Projects, and Archive remain visible when empty with a zero count.
2. Archive starts expanded and collapses independently, with disclosure state
   retained during in-app navigation and reset on reload like existing groups.
3. In Edit project, a neutral **Archive project** button appears immediately
   right of **Delete project** on desktop. Archived projects instead show
   **Restore project** in that same location. No archive shortcut appears on
   active project rows.
4. Archived rows replace the pin control with a plain box restore icon.
   Its accessible name is `Restore <project> from archive`; tooltip copy is
   `Restore project`. It is an action button, with no toggle/pressed semantics.
   Project selection and restore remain sibling buttons.
5. Archiving clears any project pin atomically. Restoring returns the project
   unpinned to Projects. Archived projects cannot be pinned through the API.
   Restore does not implicitly open or select a different project.
6. Archive orders by `archivedAt DESC, id ASC`. Repeated archive calls preserve
   the first archive timestamp. Restore is idempotent. Both operations leave
   `createdAt`, `updatedAt`, and all messages, files, labels, settings, and
   participant attribution unchanged. Projects retains activity sorting and
   Pinned retains pin-time sorting.
7. Archived projects remain openable and editable, including adding messages.
   Normal activity updates previews and Attention but never unarchives or
   reorders the archive. Archiving is organization, not a read-only mode.
8. Settings archive/restore applies immediately without requiring Save changes
   or a confirmation dialog. Stay in Edit project, update the action label,
   preserve unsaved form fields, and announce the result. Saving those fields
   later preserves archive state. Delete keeps its existing confirmation.
9. Keep the current selection, message draft, and reading position when the
   selected project changes groups. Sidebar restoration keeps focus on that
   project's new row action after React commits, or on the Projects disclosure
   if collapsed. Settings actions retain focus on their button. Do not force
   destination groups open.
10. Pending operations disable conflicting save/delete/pin/archive actions for
    that project. Failed writes leave group membership unchanged and show a
    recoverable, associated error at the initiating control. Guard stale reads
    and mutations so they cannot revert archive state or newer content.
11. New and migrated projects start unarchived. Archive state survives reload,
    server restart, export, and restore. Existing supported backup versions
    remain supported; malformed archive state cannot replace live data.
12. Reuse all three themes, focus styles, previews, Attention indicators, and
    current row density. Restore appears on hover/focus on fine-pointer layouts
    and remains visible on touch. Verify keyboard operation, long titles,
    forced colors, reduced motion, mobile reflow, and 200% zoom.

## Non-goals

Custom groups, drag-and-drop, bulk actions, automatic archiving, archive search,
read-only projects, automatic re-pinning, new dependencies, message-level
archiving, new themes, attachment behavior changes, or release publication.

## Proposed design

### Direction brief

- **Job:** move inactive notebooks out of the active list and recover them easily.
- **Audience/environment:** the same individual scanning a dense local project
  rail, primarily on desktop with mobile regression support.
- **Thesis:** Archive should feel like an existing third shelf in the private
  notebook, with the same section and row grammar as Pinned and Projects.
- **System:** retain typography, uppercase muted group labels, two-digit counts,
  spacing, flat surfaces, selected accent keyline, theme colors, and stroked
  inline icons. Add no colors, fonts, depth, or animation.
- **Signature:** the plain box restore glyph occupies exactly the familiar
  pin action location, making the available reverse action recognizable.
- **Risk/restraint:** the new icon may be unfamiliar; provide tooltip and
  accessible action text while keeping the surrounding row quiet.
- **Rejections:** red archive styling implies destruction; washed-out project
  text implies disabled content; extra cards and banners dilute the rail.

Desktop action arrangement:

```text
[Delete project] [Archive project]       [Back to project] [Save changes]
[Delete project] [Restore project]       [Back to project] [Save changes]
```

Group Delete and Archive/Restore together. Keep their side-by-side relationship
when width permits; wrap in the same DOM order on narrow screens or at zoom,
with no clipping or horizontal page scroll. Archive/Restore uses an existing
neutral button treatment; only Delete uses danger styling. Update the settings
description to explain that archiving keeps messages and files.

### Contracts and state flow

Add `archivedAt: number | null` to `Chat` and inherited `ChatDetail`. Introduce a
narrow archive response `{ archivedAt, pinnedAt }` and a typed client method:

```text
PUT    /api/chats/:id/archive
DELETE /api/chats/:id/archive
```

Use the existing loopback, error-mapping, and maintenance-gate conventions.
Validate project IDs through the existing service boundary; return normal 404
for absent projects. Pinning an archived project returns a safe 409 conflict
without changing it; idempotent unpin remains harmless.

The repository archives in one parameterized update, preserving an existing
archive timestamp and clearing `pinned_at`. Restore clears `archived_at`.
The client patches only the returned fields in canonical summary/detail state.
Extend sorting, summary conversion, selection refresh merging, mutation guards,
and post-commit focus handling. Serialize conflicting project-state mutations;
ordinary project edits must never overwrite archive/pin columns.

## Data and migration impact

- Append `drizzle/0007_project_archive.sql` and the corresponding journal/snapshot
  metadata after approval. Never edit shipped migrations.
- Add nullable integer `chats.archived_at`, default NULL, with checks for a
  nonnegative integer when present and mutual exclusion with `pinned_at`.
  Model the same constraints in `src/server/db/schema.ts`. Test the additive
  cross-column check on the bundled SQLite runtime.
- Advance runtime schema ceiling, latest migration marker, and backup schema
  to 7; keep backup container
  format version 1. No data deletion, file movement, or backfill is required.
- Add the exact schema-6 migration descriptor to the accepted legacy set in
  `sqlite-backup-bundle.ts`. Validate legacy 3/4/5/6 before migration in staging.
  Validate schema-7 archive values and the pin/archive invariant before restore.
- Preserve existing downgrade refusal and restore recovery behavior. Returning
  to older application code requires a compatible pre-upgrade backup; no down
  migration or automatic stripping of archive state is proposed.

## Phases

1. **Persistence and API:** use TDD for migration defaults/constraints, archive
   and restore idempotency, atomic pin clearing, conflict handling, and unchanged
   activity/content. Extend domain, schema, repository, service, routes, and
   typed API. Evidence: focused domain, service, API, and real-SQLite tests pass.
2. **Backup compatibility:** advance schema contracts and legacy descriptors;
   test schema-7 round trips, migration of supported old backups, malformed
   archive rejection, and preserved live state on restore failure. Evidence:
   database-transfer and startup suites pass with attachment/sender fixtures.
3. **Complete UI journey:** implement third section, settings action, row restore,
   busy/errors, draft preservation, canonical state updates, and focus recovery.
   Evidence: component tests and desktop Chromium/mobile WebKit journeys cover
   both restore entry points, last archived row, and collapsed destinations.
4. **Review and delivery:** use the reviewer role, security-review for persistence
   and backup boundaries, and verification-loop. Update PROJECT, ARCHITECTURE,
   CHANGELOG, and this plan only with implemented facts. Evidence: reviewed diff,
   full verification, and rendered desktop/mobile/theme checks.

Expected files: `src/domain/types.ts`; `src/server/db/{schema,database,repository}.ts`;
`src/server/{chat-service,app}.ts`; `src/server/database-transfer/sqlite-backup-bundle.ts`;
`src/client/api.ts`, `src/client/App.tsx`, `src/client/styles.css`; migration and
metadata files; associated existing test files; `e2e/project-chat.spec.ts` or a
focused archive sibling; and the documentation listed above.

## Test plan

- Record RED/GREEN for behavior changes with `npm test --` and the affected
  `src/server/chat-service.test.ts`, `src/server/app.test.ts`,
  `src/server/database-transfer/sqlite-backup-bundle.test.ts`,
  `src/client/api.test.ts`, and `src/client/App.test.tsx` targets.
- `npm run test:migrations`: defaults, integer/cross-column constraints,
  persistence, and downgrade refusal.
- `npm run test:e2e -- --grep archive`: archive an ordinary and a pinned project,
  restore through both controls, exercise keyboard focus and delayed failures,
  preserve unsaved edits, verify restart/backup round trip and existing content.
- Render wide and narrow layouts in Light, Neutral, and Dark; inspect 200% zoom,
  long labels, hover/focus/touch, collapsed/empty groups, busy and error states.
- `npm run verify`: aggregate release contract, build, typecheck, lint,
  formatting, coverage, migrations, browser tests, and production security audit.
- `git diff --check` and full diff review. Test data remains isolated from the
  user's application database. No runtime or visual checks are claimed at planning.

## Risks and mitigations

- **Lost pin preference:** make clearing the pin explicit; restored projects can
  be pinned again using the normal control.
- **Backup rejection/regression:** preserve exact legacy schema descriptors and
  test supported versions plus malformed state before live replacement.
  The lookalike-schema fixture explicitly models schema 7, including its new
  column and migration markers. Update synthetic legacy
  fixtures to remove the new column and migration marker where appropriate.
- **Async state regression:** narrow responses, per-project mutation exclusion,
  guarded summary/detail refreshes, and delayed-response tests.
- **Focus lost as rows move:** extend the existing React post-commit fix and test
  collapsed destinations and restoration of the final Archive row.
- **Unsaved form loss:** mutate only archive state, retain component identity and
  local drafts, and keep settings open after success or error.
- **Crowded settings footer:** group related actions, permit ordered wrapping,
  and verify actual rendering at narrow widths and zoom.

## Approved decisions

Approved defaults: archive clears the pin; restore returns to
Projects; archived projects remain editable; all groups stay visible when empty; Archive starts
expanded, and sorts newest-archived first; settings actions apply immediately
while preserving unsaved edits. The user approved these product decisions with the complete slice.

## Approval

The user explicitly approved the complete **Project Archive slice (Phases 1–4)**
on 2026-09-09.

## Implementation and verification evidence

- Added the Archive section, settings archive/restore control, sidebar restore
  glyph, shared project mutation exclusion, guarded refreshes, and focus/error
  handling. The existing typography, colors, row geometry, and theme tokens are
  reused. Settings actions wrap within the available width.
- Added migration 0007 and schema-7 backup validation. Archive state survives
  restart and backup restore; exact legacy schemas 3/4/5/6 remain supported.
  Messages, participant attribution, and attachment bytes are covered by the
  restore tests. No runtime dependency was added.
- TDD: the new API journey failed with the missing archive route (404), then
  passed. Component journeys failed on missing Archive/Restore controls, then
  passed. The reviewer's error-association test failed before the ARIA fix.
  A browser regression reproduced Save extending past its panel at 200% CSS
  zoom; the flex-wrap correction passes the all-actions containment assertion.
- `npm run verify`: passed release contract, build, typecheck, lint, formatting,
  coverage, migrations, browser regression tests, and the security audit gate.
  Unit/component/API/database suite: 530 passed, 1 existing skip. Focused
  migrations: 22 passed. Browser suite: 31 passed, 3 existing mobile skips.
- Coverage: 92.11% statements, 87.02% branches, 94.95% functions, 93.56% lines.
- Rendered evidence: desktop 1440px, intermediate 960px, mobile WebKit 390px,
  Light/Neutral/Dark settings, Archive rail and focus, forced colors, reduced
  motion, long form input, and 200% CSS zoom. Browser-native zoom and a physical
  screen reader were not separately exercised.
- Reviewer and security review covered the project API, parameterized writes,
  database constraints, strict legacy/current backup validation, async state,
  and focus behavior. The sole accessibility finding was fixed; follow-up
  review found no remaining actionable findings. Full diff and whitespace were
  reviewed. No commits, pushes, or releases were created.
- Residual risk: the existing moderate Fastify advisory group remains. The
  production audit passes its high-severity gate; no dependencies changed.
  Local macOS verification does not replace the supported-platform release CI
  matrix. Older binaries cannot open the upgraded schema-7 database.

## Follow-up refinement

The user requested a plain box restore glyph without an arrow and all three
section headers to remain visible when empty. The UI and empty-section tests
now follow those refinements; restore accessibility labels remain explicit.

Refinement verification: the new empty-group test failed on the missing Pinned
header before implementation. The workspace component suite passes (75 tests),
as do the desktop Chromium/mobile WebKit archive journeys (2 tests), production
build, typecheck, lint, formatting, and whitespace checks. The rendered rail
was inspected for the plain box icon and visible empty Pinned header.
