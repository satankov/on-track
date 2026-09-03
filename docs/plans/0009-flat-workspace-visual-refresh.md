# Desktop-first flat workspace visual refresh plan

## Goal

Give the primary desktop project workspace more room for messages and a calmer,
native-feeling visual language without changing the product workflow or data
model.

## Context and reusable precedent

The current chat workspace reserves separate rows for a large project header,
history filters, and a composer whose textarea is always at least three lines.
At 1440x900 the rendered header, filters, and composer consume 349px, leaving
552px for history. The existing React structure, CSS tokens, inline stroke icons,
Vitest component tests, and Playwright geometry coverage are sufficient; no new
dependency is needed.

### UI direction

A quiet project ledger that behaves with the speed of a native messenger. Notes
are the visual subject. A restrained project-colored keyline provides
orientation across the selected project, active history filter, and primary
composer action. Persistent surfaces stay flat and neutral; elevation is
reserved for overlays.

## Acceptance criteria

1. At 1440x900, the active-project header is no taller than 64px and the resting
   composer wrapper is no taller than 72px.
2. Desktop history filters occupy a narrow vertical strip beside history rather
   than a separate grid row.
3. The desktop history viewport gains at least 120px relative to the recorded
   552px baseline.
4. The composer starts at one line, grows with multiline content, shrinks when
   content is removed or cleared, and scrolls internally after a bounded maximum.
5. Programmatically loading a message into edit mode also resizes the composer.
6. Existing create/select/edit, Markdown, timestamp, attachment, native-file,
   message-action, draft-preservation, and keyboard behavior remains unchanged.
7. Long project names truncate without colliding with navigation or Edit.
8. Persistent workspace regions use no decorative gradients or shadows. Borders
   remain only for meaningful dividers, editable controls, selection, focus, and
   safety boundaries.
9. Project accent remains an orientation/action role. Focus and status colors
   remain independent, and normal text pairs meet WCAG 2.2 AA contrast.
10. The existing mobile alpha list/detail flow remains usable and free of
    document-level horizontal overflow. Mobile-specific redesign is a non-goal.

## Non-goals

- Changing navigation, message ordering, project editing, filters, attachments,
  settings behavior, or persistence.
- A dedicated mobile visual solution.
- Dark mode, new themes, a component library, an icon package, or a web font.
- API, server, database, migration, or native-file changes.

## Proposed design

- Use compact system-sans typography throughout the application.
- Retune neutral canvas, surface, text, divider, and focus tokens while keeping
  the six accessible project accents.
- Reduce the desktop rail and active-project header density.
- Place labeled All and Files filter buttons in a flat vertical history strip.
- Make the composer a compact single-row control at rest, with conditional rows
  for files, timestamp, edit state, and errors.
- Replace remaining raw glyph controls with the existing inline rounded-stroke
  SVG language.
- Remove persistent-surface shadows, floating date pills, and nested attachment
  cards in favor of tone, alignment, and spacing.

## Data and migration impact

None. Rollback is limited to client JSX, CSS, tests, and this plan record.

## Phases

1. **RED:** add component and browser guarantees for textarea auto-sizing,
   compact desktop geometry, vertical filters, and increased history height.
2. **Foundations:** normalize semantic colors, type, spacing, radius, focus,
   motion, and icon treatment without dependencies.
3. **Compact chrome:** update the desktop workspace grid, header, rail, and filter
   presentation while preserving scroll ownership.
4. **Composer:** add layout-synchronized textarea measurement and compact
   responsive composition.
5. **Flat surfaces:** simplify messages, dates, attachments, settings, empty
   states, and dialogs without changing their information architecture.
6. **Review and verification:** inspect realistic desktop states at 1440x900,
   1024x768, short height, and 200% zoom; retain a mobile regression check; then
   run the full repository gate.

## Test plan

- Focused component/theme: `npm test -- src/client/App.test.tsx src/client/theme.test.ts`
- Focused browser: `npx playwright test e2e/project-chat.spec.ts --grep "uses compact desktop chrome"`
- Full completion gate: `npm run verify`
- Manual rendered inspection: default history, multiline composer, long title,
  attachments, edit/timestamp state, settings, 200% zoom, and keyboard focus.

## Risks and mitigations

- A narrow filter strip can reduce message width. Keep it compact and disable the
  vertical treatment at the existing mobile breakpoint.
- `scrollHeight` can become stale after programmatic draft changes. Measure in a
  layout effect keyed to the controlled draft and cover edit/clear paths.
- Removing borders and shadows can weaken grouping. Preserve deliberate tonal
  contrast, alignment, and spacing and inspect realistic dense content.
- Composer controls can crowd at intermediate widths. Allow compact wrapping
  while preserving labels, target sizes, and keyboard order.

## Approval

Approved by the project owner on 2026-09-02 with desktop as the primary target.
Mobile receives regression protection only because no mobile solution is part of
the current alpha.

## Completion

Implemented and verified on 2026-09-02. The delivered slice includes the compact
desktop header, vertical history filters, flat visual tokens and surfaces,
normalized inline icons, and a one-line composer that grows to a 144px cap and
remeasures after content, viewport, zoom, or width changes.

- Focused component and theme coverage: 41 tests passed.
- Focused desktop browser coverage: compact 1440px geometry, 1920px alignment,
  bounded composer growth, and resize-induced wrapping passed.
- Full repository gate: `npm run verify` passed, including 319 covered tests,
  migration tests, 9 browser tests with 1 intended mobile skip, formatting,
  typechecking, linting, build, release checks, and the production dependency
  audit.
- Manual rendered review covered the populated desktop workspace, multiline
  composer, empty workspace, and backup settings at 1280x720.
- Independent code review reported no remaining actionable findings.
