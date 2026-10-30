# Release-candidate UI trim

Status: Slice A approved, implemented, and verified locally, 2026-10-30. Branch:
`codex/next-release-candidate`, based on `3549251`.

## Goal

Implement the user's 13 requested UI changes as one scoped release-candidate
slice, including complete removal of sidebar last-message previews while
preserving Attention indicators.

## Context and reusable precedent

- `DESIGN.md` and `branding/threadstr/ui/index.html` govern the existing flat UI.
- `src/client/App.tsx` owns the rail, Edit/Create, Settings navigation, composer,
  message labels, and summary refresh scheduling.
- `src/server/db/repository.ts` now computes only Attention summaries;
  `src/domain/types.ts` defines their transport fields.
- `src/client/HomeWorkspace.tsx`, `HomeUtilities.tsx`,
  `BackupSettingsWorkspace.tsx`, and `ProjectLabelsEditor.tsx` own the other
  affected surfaces.
- ADR-0013 and schema 9 make built-in label names canonical stored values.
  Backup validation requires those names; changing the stored name is not a
  safe copy-only edit.
- `markdown-analysis.ts` is also used by project search and Links filtering;
  that shared functionality remains necessary after rail previews are removed.
- Existing primitives cover the work. No package, framework, or new visual
  system is needed.

## Acceptance criteria

1. Remove “Private project threads” beneath the wordmark and its unused style.
2. Remove last-message previews completely: rendering, fallback text, preview
   cache/formatter, summary fields, source-length constant, server preview
   queries, and refresh scheduling for ordinary future messages. Preserve
   project titles, pin/archive actions, activity order, accessible mutation
   errors, and Attention dots for today/earlier/future notes. Attention still
   updates after mutations, future boundaries, midnight, and focus restoration.
3. Display “Question” for the built-in `open-question` label throughout Edit,
   composer choices, message badges, filters, and accessible control names.
   Existing and restored projects must remain editable with their tags intact.
4. Under Project labels remove the last two visible sentences: the paragraph
   beginning “Use × or clear both fields…” and “Drag rows to reorder.” Retain
   the first paragraph and accessible keyboard/tap reorder instructions.
5. Change the normal composer placeholder to “Write a note...”.
6. Remove the paragraph below “Choose a project to continue.” and center the
   remaining heading vertically within the Home hero area. Other loading,
   first-use, and error guidance remains functional.
7. Remove “Contacts GitHub only when you check. No project content is sent.”
8. Remove “Find help in the guides below.”
9. Remove “Participant messages appear on the left” from Sender.
10. Remove the visible “Projects to export” subheading. Preserve a meaningful
    accessible name for the project checklist and its empty state.
11. Remove the visible “Choose threadstr backup” label. Associate the file input
    with a meaningful accessible name, retaining file selection and errors.
12. Replace Edit's text Back button with the existing Settings arrow control,
    keeping an accessible “Back to project” name, disabled state, keyboard focus,
    and placement at the left of the top actions.
13. In Create's action footer, add “More settings in Edit project.” using the
    existing `.field-help` treatment, aligned with Cancel/Create. This includes
    the user's follow-up correction after the initial implementation.

## Non-goals

No release publication, version bump, commit, push, dependency change, database
migration, new preference, or redesign. Preserve the static example description;
it is not a last-message preview. Do not remove Markdown analysis used by search.

## Implemented design

The interface remains a quiet personal project notebook: less repeated guidance
makes project names and notes easier to scan. Retain its project accents,
wordmark, flat tonal surfaces, typography, and responsive layout.

Reuse the Settings arrow (`ArrowLeftIcon`, `.settings-back-button`, 38px target,
20px icon, 9px radius, `--control`/`--muted`, existing hover/focus/disabled states).
Scope an Edit override for the Settings button's auto left margin so it remains
left aligned. Reuse `.field-help` (12px, 1.5 line height, muted semantic color)
for the Create hint, aligned with the action buttons in the footer. Keep the
buttons grouped when the hint wraps on narrow screens. No new tokens or animation.

Keep existing rail row target dimensions and vertically center each project
name after removing its second line. Remove only preview-specific styling;
recoverable row errors still need visible text and accessible association.
Update affected cookbook specimens and contract wording in the same change.

Use a single client presentation helper keyed by built-in ID for “Question”.
Apply it to both visible and accessible text, including reorder announcements.
Keep draft/configuration values canonical when saving. Custom labels retain
user-entered names, even if an existing custom label is named “Question”.

## Data and migration impact

Remove `latestMessagePreview` and `nextMessageAt` from `Chat`, repository summary
results, client projections, and test fixtures. These are derived API fields,
not database columns. Keep `latestAttentionAt`, `nextAttentionAt`, `updatedAt`,
and current mutation-generation protections. Remove the SQL projections that
read message bodies and ordinary future timestamps for the rail.

Schema 9, stored `open-question` IDs and “Open question” canonical values,
assignments, backups, and import validation remain unchanged. A display-only
name change avoids invalidating existing backups or colliding with custom names
in persisted unique constraints. Older open browser tabs may need a reload after
updating to the new client/server bundle.

## Completed scope

### Slice A — all 13 UI changes and complete preview removal

1. Add focused regression coverage and demonstrate RED: list responses no longer
   expose preview fields; rail omits note text while retaining Attention states;
   existing canonical question definitions display “Question” and still save.
2. Remove preview plumbing end to end. Adapt preview-specific tests to the new
   requirements while retaining stale-response, mutation-ordering, deletion,
   future-Attention, midnight, and focus-refresh coverage.
3. Implement copy, arrow, accessible labels, and Home alignment changes. Apply
   the shared display-name helper to affected label UI and announcements.
4. Update cookbook and current capability/architecture documentation to reflect
   preview removal. Keep historical release descriptions identifiable as history.
5. Run focused checks, broader verification, rendered UI review, and independent
   reviewer/security review of the changed SQL/API boundary. Fix findings within
   this scope before reporting completion.

## Test plan

- Repository/API tests: summaries omit preview fields; Attention summaries and
  activity ordering remain correct, including future timestamps.
- App/component tests: title-only rail, all Attention states and transitions,
  pin/restore failures, current-project updates and stale async responses;
  canonical built-in definitions display the new name and still save;
  Create/Edit/back navigation and accessible backup controls still work.
- Preserve existing search, Markdown/Links, backup, and label validation tests.
  Do not add low-value tests for every deleted sentence or CSS literal.
- Browser journeys: create, write, label, pin, edit/back, settings import/export
  selection; desktop Chromium and mobile WebKit coverage where applicable.
- Render cookbook and affected screens in Light/Neutral/Dark at 1440×900,
  1024×768, 390×844, and 320px reflow. Check 200% zoom, keyboard focus,
  long titles, disabled actions, error states, forced colors, reduced motion,
  and Home heading alignment.

Commands (run after implementation):

```bash
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test -- src/server/db/database.test.ts src/server/app.test.ts src/server/chat-service.test.ts
npm test -- src/client/App.test.tsx src/client/ProjectLabelsEditor.test.tsx src/client/BackupSettingsWorkspace.test.tsx src/client/theme.test.ts
npm run test:coverage
npm run test:migrations
npm run test:e2e
npm run security:check
npm run release:check
git diff --check
```

## Risks and mitigations

- Preview timers also drive Attention: retain Attention-only scheduling and
  prove future activation, midnight rollover, focus refresh, and stale guards.
- Blind label renaming breaks schema-9 backups: change presentation only and
  test Save using existing canonical definitions.
- Removing labels harms accessibility: explicitly name checklist/file controls
  using existing headings or accessible labels; retain adjacent error linkage.
- Shared style removal can affect examples or errors: inspect all consumers and
  keep unrelated descriptions/error rendering.
- Home utilities and mobile affect centering: measure the hero composition at
  desktop and narrow widths rather than applying an arbitrary offset.

## Open decisions

None required. “Remove two last sentences” means the last two visible sentences
currently present under Project labels. The next release version is intentionally
unspecified; the requested branch does not change release metadata.

## Approval

The user approved Slice A on 2026-10-30. All 13 changes are implemented.
No commit, push, version bump, or publication was performed.

## Completion evidence

The full-suite results below cover the main slice. The subsequent Create footer
correction received the focused verification recorded separately below; the full
coverage and browser suites were not repeated after that correction.

- RED: `npm test -- src/server/db/database.test.ts src/client/ProjectLabelsEditor.test.tsx src/client/App.test.tsx -t 'persists stable project pins|displays Question while|shows plain Markdown previews'`
  executed three new/updated regression checks. All failed for the intended
  preview payload/rendering and Question presentation differences.
- GREEN: `npm test -- src/server/db/database.test.ts src/client/ProjectLabelsEditor.test.tsx src/client/App.test.tsx`
  passed 158 tests. Two additional fake-clock tests subsequently passed for
  midnight and focus Attention transitions.
- `npm run build`, `npm run typecheck`, `npm run lint`,
  `npm run format:check`, `npm run release:check`, and `git diff --check`: pass.
- `npm run test:coverage`: 83 files; 1,123 passed, 9 skipped. Coverage:
  statements 91.07%, branches 85.64%, functions 92.98%, lines 92.21%.
- `npm run test:migrations`: 28 passed. No migration changes.
- `npm run test:e2e` built the main slice; the final full browser run for that
  slice, `npx playwright test`, passed 84 tests with 16 skipped.
- `npm run security:check`: zero vulnerabilities.
- Independent review and security review found no remaining actionable
  correctness, security, or data-integrity findings in the changed boundaries.
- Rendered actual app and cookbook: Light/Neutral/Dark; desktop 1440×900 and
  1024×768; mobile WebKit 390×844; 720px and 320px reflow; forced colors and
  reduced motion. Inspected title-only rail with Attention, Question tags and
  editor, Back control, Sender, Home centering, Create hint, and backup captions.
  Keyboard Back activation, touch Back activation, persistence after reload,
  canonical stored label values, and document overflow are covered by
  `e2e/ui-trim.spec.ts`. Existing 200% reflow coverage also passed.
- Screenshots are reproducible under `test-results/ui-trim-*/` from that E2E
  journey. Cookbook specimens and current project/architecture/design documents
  match the implementation.

Remaining limits: browser emulation is not real-device or manual screen-reader
qualification. Managed installer/update/uninstall smoke scripts were not rerun
because their code and contracts are unchanged. Existing Vite bootstrap-script
and bundle-size warnings remain. No new dependency or data-format risk was added.

### Create footer follow-up

Moved the hint into the Cancel/Create footer and changed it to “More settings in
Edit project.” The existing helper typography is retained; the action buttons
remain grouped when the footer wraps. Updated the cookbook and design contract.
Build, types, lint, formatting, and diff checks passed; the focused App/theme
suite passed 164 tests and existing Create desktop/mobile journeys passed four
checks (two desktop-only skips). After the final helper-margin correction,
build and all 53 theme checks passed again. Rendered desktop review confirmed
identical vertical centers for the hint and button group.

Existing platform and assistive-technology qualification follow-ups remain in
[the project tracker index](../PROJECT.md#roadmap-and-tracker).
This slice introduced no additional unresolved follow-up.
