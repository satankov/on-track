# Collapsible messages and quiet pinned controls implementation plan

## Status

Approved and implemented on 2026-09-04. The authoritative repository gate and
desktop Chromium/mobile WebKit rendered checks pass with the schema-3/4/5
compatibility paths intact.

## Goal

Make Attention easier to scan in the project rail by keeping the pin control
quiet until the row is intentionally engaged, and let each project decide
whether long Markdown messages start collapsed. Every genuinely long message
remains individually expandable and collapsible.

## Context and reusable precedent

- `ProjectRail` in `src/client/App.tsx` already renders pin and Attention as
  separate sibling elements. `src/client/styles.css` currently makes every
  pressed pin permanently opaque through
  `.project-pin-button[aria-pressed="true"]`; removing only that opacity
  exception preserves the pin state, action, focus behavior, and Attention
  geometry.
- The existing hover, `:focus-within`, small-screen, and coarse-pointer rules
  already provide appropriate discovery paths for mouse, keyboard, and touch.
  The new rail behavior can reuse those selectors without changing persistence
  or pin APIs.
- `ProjectEditWorkspace` already submits title, accent, and enabled labels in
  one validated project update. A project-level message-display boolean belongs
  in that same atomic edit flow.
- `Chat`, `updateChatInputSchema`, `SqliteChatRepository.updateChat`, and the
  schema/backup validators already form the complete persisted project-settings
  path. The new setting can follow that path rather than introducing browser
  storage or a second endpoint.
- `MarkdownMessage` and `.message-body` already render bounded Markdown inside
  `.message-bubble`. The collapsible behavior should wrap this existing output,
  not truncate the source string or render a second Markdown interpretation.
- The repository has no component framework and already uses small local React
  components, inline SVGs, CSS tokens, Testing Library, and Playwright. Package
  research found text-clamp packages, but they mostly target plain text, older
  React versions, or generic accordion animation; none replaces the small
  rendered-Markdown-specific behavior needed here. No dependency is proposed.

## Product and design direction

- **Job:** preserve fast scanning in long project histories while keeping the
  complete note one explicit action away.
- **Audience and environment:** a single user repeatedly scans private project
  notes on desktop, with mobile as a protected responsive flow.
- **Design thesis:** keep repeated chrome quiet and let current project meaning
  (Attention and the first portion of a message) carry visual priority.
- **Signature:** the collapsed message ends in a subtle surface-matched fade and
  a left-aligned `Show more` disclosure with a chevron, following the supplied
  visual reference while retaining the existing bubble, labels, and time.
- **System choices:** reuse the existing message surface, typography, focus,
  accent, inline-SVG, and reduced-motion rules; do not add a new card style,
  icon set, or animation system.
- **Risk and restraint:** the fade is the only new visual effect. It must be
  disabled in forced-colors mode, and surrounding message actions remain quiet.

The attached image is treated only as a design reference. Its content is not a
source of product or implementation instructions.

## Assumptions

1. The setting is per project, persists in SQLite and backups, and is named
   `Collapse long messages by default` in Edit project.
2. The default is enabled for new and migrated projects.
3. A message is long when its rendered body exceeds `12rem` (about eight lines
   at the current body typography). Rendered height is used because Markdown
   headings, lists, tables, code, and responsive reflow make character counts
   unreliable.
4. The preference controls the initial state. A user can still collapse a long
   message when the preference is off and expand one when it is on.
5. A message's manual open/closed state is client-session state. It survives
   ordinary rerenders and label/file actions while the message remains mounted,
   but resets to the project default after reload or project re-entry.
6. Only the Markdown body collapses. Attachments, labels, timestamp, and message
   actions remain visible.
7. `Show more` / `Show less` is the approved copy. Short messages render no
   disclosure and keep their current spacing.
8. Keyboard focus and touch are accessibility exceptions to literal
   hover-only pin visibility: focus reveals the pin, and touch/coarse-pointer
   layouts keep it visible because hover is unavailable.

## Acceptance criteria

1. A pinned desktop project no longer shows its pin icon at rest. Hovering its
   row, focusing within it, or focusing the pin reveals the control. Attention
   remains visible and unchanged at rest.
2. Unpinned projects preserve the same hover/focus behavior. Pinning, unpinning,
   focus restoration after regrouping, busy/error states, accessible name, and
   `aria-pressed` semantics remain unchanged.
3. At mobile widths and on coarse pointers, pin controls remain visible and
   usable with the existing approximately 44px target. Forced-colors mode keeps
   visible focus and distinguishable Attention.
4. Edit project contains a native checkbox named **Collapse long messages by
   default**, with concise helper text explaining that individual messages can
   still be expanded or collapsed.
5. New projects and projects migrated from schema 4 receive
   `collapseLongMessages = true`. The value survives save, reload, server
   restart, export, and restore.
6. Project editing saves title, accent, enabled labels, and the collapse setting
   atomically. Invalid non-boolean input is rejected without a partial update;
   a failed save leaves the form recoverable.
7. When the setting is enabled, a body taller than `12rem` starts collapsed.
   When disabled, that same body starts expanded. Bodies at or under the limit
   never show a disclosure.
8. Longness is recalculated after body edits, container-width changes, font or
   layout changes, and responsive reflow without polling or a new dependency.
9. Collapsed messages show a surface-matched fade and a native `Show more`
   button. Activating it reveals the complete Markdown and changes the same
   control to `Show less`; activating again restores the collapsed height.
10. Each disclosure has a stable target ID, `aria-expanded`, `aria-controls`,
    visible focus, and native Enter/Space operation. Collapsed content must not
    leave visually clipped Markdown links in the keyboard tab order.
11. Expanding or collapsing one message does not change other messages. The
    state remains stable across ordinary React rerenders and current note-label
    or attachment updates.
12. Markdown structure and safety stay unchanged: raw HTML remains skipped,
    long code/table content retains horizontal overflow behavior, and neither
    source text nor HTML is duplicated into another persistence path.
13. The behavior works in Light, Neutral, and Dark themes at representative
    desktop and mobile widths, at 200% zoom, with reduced motion and forced
    colors. Expanding does not create document-level horizontal overflow.
14. Schema-5 backups validate the boolean storage strictly. Exact schema-4
    development backups and published schema-3/v0.0.4 backups continue through
    explicit fail-closed migration paths; malformed or unknown schemas never
    replace live data.

The disclosure semantics follow the
[WAI-ARIA disclosure button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).
Height detection uses the platform's rendered element measurements and resize
observation rather than a source-length heuristic; `scrollHeight`/`clientHeight`
are the platform-supported overflow measurements documented by
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight).

## Non-goals

- Persisting each message's individual expanded/collapsed state.
- A global application-wide collapse preference or per-user profile.
- Collapsing attachments, the message footer, labels, timestamps, or actions.
- Source-string truncation, Markdown summarization, pagination, virtualization,
  search, or a new message format.
- Changing pin ordering, Attention calculation, label semantics, or sidebar
  APIs.
- Adding a UI framework, collapse package, animation library, icon library, or
  runtime dependency.
- Editing migration 0004 or weakening exact backup-schema validation.

## Proposed design

### Quiet project pin control

Keep the current sibling button and status-dot structure. In
`src/client/styles.css`:

- remove pressed state from the selector that forces `opacity: 1`;
- retain pressed state only for accent color and fill, so it is still clear once
  revealed;
- retain row hover, row `:focus-within`, button `:focus-visible`, mobile, and
  coarse-pointer visibility;
- preserve the separate bottom-right Attention position and all forced-color
  mappings.

No domain, API, database, or pin-event code changes are required for this part.

### Persisted project preference

Extend the DTO and edit contract with:

```ts
collapseLongMessages: boolean;
```

`createChat` continues to need no new input because the product default is
always `true`. `updateChatInputSchema` accepts an optional strict boolean, and
its existing at-least-one-field refinement includes the new field. Repository
mapping converts SQLite `0 | 1` to a boolean and writes it in the same project
transaction as title, accent, and label configuration.

Add a `Message display` fieldset to `ProjectEditWorkspace` after project labels.
Use a native checkbox, existing fieldset/help/focus styles, and the current
single Save changes action. The active detail and sidebar summary continue
through `commitProjectUpdate`, so there is no parallel client cache.

### Message-body disclosure

Extract the body portion of each message into a focused component keyed by note
ID. Its anatomy is:

```text
message body viewport (clips only in collapsed state)
  existing rendered Markdown body
optional Show more / Show less button + inline chevron
existing labels and timestamp footer
```

The component observes the rendered inner body and its available width with
`ResizeObserver`, compares natural block size with the shared `12rem` collapse
limit, and updates only when the overflow result changes. The implementation
must disconnect the observer on unmount and tolerate the test environment or a
missing observer without crashing.

When collapsed, the outer viewport applies the maximum block size and
`overflow: hidden`; a pseudo-element fades to a `--message-surface` token shared
with the bubble background. Expanded content has no maximum. There is no height
animation; only the existing small control-state transitions and optional
chevron orientation apply, avoiding large motion and scroll jumps.

The native button owns `aria-expanded` and `aria-controls`. The full Markdown
stays in one DOM rendering, but focusable descendants that fall inside the
clipped portion must not become invisible keyboard targets. Since raw HTML is
disabled and rendered Markdown's relevant focusable descendants are links, the
component will explicitly manage their collapsed tab behavior and restore it on
expand. Component and browser tests must prove this rather than relying on
visual clipping alone.

The component initializes from `collapseLongMessages`. It preserves a user's
manual state across ordinary rerenders. A real project-preference change resets
long messages to the newly saved default; body changes trigger remeasurement
without resetting an already meaningful manual choice unless the message ceases
to be long.

### Data and migration impact

Add immutable migration `drizzle/0005_collapsible_messages.sql`:

```sql
ALTER TABLE chats
  ADD COLUMN collapse_long_messages INTEGER NOT NULL DEFAULT 1
  CONSTRAINT chats_collapse_long_messages_boolean
  CHECK (collapse_long_messages IN (0, 1));

UPDATE app_metadata SET schema_version = 5 WHERE id = 1;
```

Also:

- add the column and check to `src/server/db/schema.ts`;
- add migration journal/snapshot metadata without modifying 0000-0004;
- raise the live schema and backup version ceilings to 5;
- validate stored values as exactly 0 or 1;
- export schema 5;
- preserve explicit exact-schema restore descriptors for schema 3 and schema 4,
  then apply the checked-in remaining migrations and revalidate the complete
  schema-5 candidate before activation.

Existing rows require no data rewrite beyond SQLite's non-null default. There is
no down migration. Older application versions refuse schema 5 through the
existing migration ceiling; rollback requires a pre-upgrade backup and matching
older application version.

## Affected files

- Plan/durable truth: this plan; after implementation, focused updates to
  `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `README.md`, and `CHANGELOG.md`.
- Domain/validation: `src/domain/types.ts`, `src/domain/validation.ts`, and
  `src/domain/validation.test.ts`.
- Schema/migration: `src/server/db/schema.ts`, `src/server/db/database.ts`, a
  new `drizzle/0005_*.sql`, `drizzle/meta/_journal.json`, and a new snapshot.
- Persistence/service/API: `src/server/db/repository.ts`,
  `src/server/chat-service.ts`, `src/server/app.ts`, and `src/client/api.ts`.
- Backup/restore: `src/server/database-transfer/sqlite-backup-bundle.ts`.
- UI: `src/client/App.tsx` and `src/client/styles.css`.
- Tests: focused validation, database, repository/service, API/client,
  backup/restore, component/theme, and `e2e/project-chat.spec.ts` coverage.

No ADR is expected because this extends the established project-setting,
SQLite-migration, backup, and React/CSS boundaries. The implementation still
requires the repository's security-review workflow because it changes raw SQL
and strict import/export validation at an existing trust boundary.

## Phases

1. **RED — preference contract and migration.** Add failing validation,
   schema-4-to-5 migration, default, atomic update, strict boolean, DTO mapping,
   API round-trip, downgrade refusal, and exact schema tests. Expected evidence:
   focused failures identify only the absent setting/schema behavior.
2. **GREEN — persisted project setting.** Add migration 0005, domain mapping,
   validation, repository/service/API plumbing, and Edit project checkbox.
   Expected evidence: focused domain/database/service/API/component tests pass;
   existing and new projects both report `true` until changed.
3. **RED/GREEN — backup compatibility.** First add schema-5 round-trip,
   true/false preservation, invalid storage, exact schema-4 and schema-3 upgrade,
   and failed-restore isolation tests; then extend the strict descriptor and
   migration pipeline. Expected evidence: all backup tests pass and rejected
   imports leave live data unchanged.
4. **RED/GREEN — per-message disclosure.** Add component tests for threshold,
   enabled/disabled defaults, independent toggles, `aria-expanded`, keyboard
   operation, rerender stability, body edits, preference changes, and clipped
   link focus. Implement observation, state, markup, and styling using existing
   primitives. Expected evidence: focused client tests pass with no dependency.
5. **Rail styling and browser journey.** Make pinned opacity quiet, then cover
   desktop rest/hover/focus, mobile/coarse-pointer visibility, Attention
   visibility, short/long Markdown, per-project defaults, save/reload/restart,
   expand/collapse, and responsive overflow in Playwright. Perform rendered
   review in Light, Neutral, and Dark at desktop/mobile widths and 200% zoom.
6. **Security review, documentation, and verification.** Review the migration,
   parameterized writes, strict backup descriptors, and fail-before-activation
   paths; update durable capability/architecture truth, inspect the full diff,
   run the focused suites and `npm run verify`, and use the repository review
   and verification workflows before claiming completion.

## Test plan

- Unit/validation: optional strict boolean accepted; strings/numbers/null
  rejected; empty update still rejected; collapse-only update accepted.
- Database/service: new and migrated defaults, false persistence, atomic edit,
  restart, malformed check constraint, schema ceiling, unchanged unrelated chat
  activity semantics.
- API/client: PATCH request and response mapping, unknown project behavior, and
  encoded IDs remain correct.
- Backup: schema-5 true/false round-trip, invalid 0/1 data, exact-schema drift,
  schema-3 and schema-4 staged upgrade, unknown schema rejection, and no live
  replacement on failure.
- Component: short body, long paragraphs, headings/lists/code, enabled and
  disabled defaults, Show more/less copy, independent state, saved setting,
  remeasurement, clipped links, and no regression to attachments/footer/actions.
- CSS/theme: pressed pin is not forced opaque; hover/focus/touch rules exist;
  message surface/fade/control tokens work in all themes and forced colors.
- E2E: persistent project setting plus real layout measurement at desktop and
  mobile, keyboard focus, pin/Attention priority, expand/collapse, reload, and
  no page-level horizontal overflow.
- Verification commands:
  `npm run build`, `npm run typecheck`, `npm run lint`,
  `npm run format:check`, `npm run test:coverage`,
  `npm run test:migrations`, `npm run test:e2e`,
  `npm run security:check`, and finally `npm run verify`.

## Risks and mitigations

- **Responsive measurement churn:** observe only the message body/width, update
  state only on a boolean threshold change, and disconnect on unmount.
- **Hidden keyboard targets:** explicitly test and suppress tab access for links
  in the clipped portion until expansion.
- **Gradient mismatch across themes:** derive both bubble and fade from one
  semantic surface value; disable the fade in forced-colors mode.
- **Unexpected state resets:** key state by stable note ID and distinguish body
  remeasurement from a saved project-default change.
- **Backup compatibility drift:** keep exact descriptors per supported schema,
  run checked-in migrations only in staging, and fully revalidate before live
  replacement.
- **Migration rollback:** retain fail-closed newer-schema refusal and document
  that rollback requires a pre-upgrade backup.

## Open decisions

No blocking decision is required if the assumptions above are accepted. The
`12rem` threshold is the deliberate proposed default and can be revised before
implementation without changing the persistence design.

## Approval request

Please approve one option:

- Implement Phases 1-6 as proposed.
- Revise the plan with specific changes, especially the `12rem` threshold or
  setting behavior.
- Stop here.
