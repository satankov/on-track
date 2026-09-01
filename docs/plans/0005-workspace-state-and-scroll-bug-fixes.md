# Workspace state and independent scrolling bug-fix plan

## Goal

Fix two related workspace defects without changing persistence or navigation
semantics:

1. never present the first-project empty state when persisted projects exist; and
2. keep the rail header/footer, workspace header, and note composer visible while
   project and note collections scroll inside their own bounded regions.

## Context and reusable precedent

The API and persistence path is already correct. `apiClient.listChats()`, the
Fastify chat route, `ChatService.listChats()`, and
`SqliteChatRepository.listChats()` return persisted projects in deterministic
activity order. The defect is in `src/client/App.tsx`: `active` is initially
undefined, startup only populates `chats`, and every undefined `active` value
renders `EmptyWorkspace`, whose copy always says "Create your first project."
The original slice plan defines that state specifically for an empty database.

The chat markup already separates the header, `.history`, and composer into three
grid rows, and `.history` already declares `overflow-y: auto`. The scrollbar does
not engage because `html`, `body`, `#root`, `.app-shell`, `.project-rail`, and
`.workspace` use minimum heights rather than a definite viewport-bounded height.
The outer grid row therefore grows with its content. The rail's `.project-list`
also has no flexible, minimum-zero scrolling region, so a long project list pushes
the local-only footer away.

The existing React components, CSS grid/flex layout, design tokens, Vitest setup,
and Playwright desktop/mobile projects are sufficient. No package or third-party
layout primitive is warranted.

### UI direction

Preserve the calm, dense project workbench. The memorable detail remains the
project-colored thread running through note history. Structural controls stay
quiet and stationary; content collections own scrolling. The first viewport must
describe the user's actual state rather than reuse first-run marketing copy.

## Acceptance criteria

1. After a successful nonempty project-list response with no active selection,
   desktop shows a neutral selection prompt such as "Choose a project" and does
   not show "Create your first project."
2. The application does not auto-open a project. Existing explicit selection and
   mobile list/detail navigation remain unchanged.
3. "Create your first project" appears only after a successful empty-list
   response, not while loading and not when list loading fails.
4. Creating, selecting, customizing, adding notes, async race protection, draft
   preservation, and activity ordering continue to behave as before.
5. At desktop viewport height, the app shell does not grow with long project or
   note collections. The rail header/footer, chat header, and composer remain in
   view.
6. A long note history scrolls within `.history`; scrolling it does not move the
   chat header, composer, rail header, or rail footer.
7. A long project collection scrolls within `.project-list`; scrolling it does
   not move the rail header, section label, or local-only footer.
8. The same containment works in the mobile list and detail views, including a
   short-height viewport, without introducing horizontal overflow or unreachable
   controls.
9. Keyboard focus, semantic labels, visible focus styles, reduced-motion behavior,
   and reflow at representative desktop/mobile sizes remain intact.

## Non-goals

- Remembering or restoring the last selected project.
- Automatically opening the most recently active project.
- Changing project or note ordering.
- Adding virtualized lists, custom scrollbar styling, sticky overlays, or a new
  UI dependency.
- Changing the API, database schema, migrations, or local data.
- Automatically scrolling note history to the newest note; that is a separate
  product behavior.

## Proposed design

### Accurate workspace states

Derive the no-active-project presentation from `loading`, load failure, and
`chats.length` rather than from `active` alone:

- loading: a dedicated non-actionable loading presentation;
- successful empty result: the existing first-project state and CTA;
- successful nonempty result: a restrained desktop prompt to select a project
  from the rail;
- load error: keep the existing recoverable alert while avoiding false first-run
  copy.

On mobile, the rail remains the list-first view and the secondary workspace
presentation stays hidden by the existing breakpoint rule. Explicit project
selection continues to load detail through the current request-race guard.

### Viewport and overflow ownership

Bound the application root/shell to the dynamic viewport and prevent document-
level vertical growth while the application is active. Give both desktop columns
and the chat grid `min-height: 0`/definite-height constraints so their children can
shrink.

In the rail, keep the header, section label, and footer as non-scrolling flex
items. Make `.project-list` the flexible `min-height: 0; overflow-y: auto` region.
In the workspace, keep the existing three-row grid and make `.history` the sole
vertical overflow owner between the header and composer. Preserve the mobile
single-pane switch while applying the same bounded-height rule to whichever pane
is visible.

Use native browser scrollbars and existing tokens. Do not make the whole rail or
whole workspace scroll, because that would move the controls the user explicitly
asked to keep visible.

## Data and migration impact

None. This change reads the same chat/note contracts and makes no persistence,
API, filesystem, or migration changes. Rollback is limited to the client component
and stylesheet changes.

## Phases

1. **RED: workspace-state regression tests.** Add component tests proving that a
   successful nonempty list never renders the first-project CTA, a successful
   empty list does, loading is distinct, and list failure does not masquerade as
   first run. Expected evidence: the nonempty/loading/error assertions fail on
   the current render condition.
2. **GREEN/REFACTOR: separate the no-selection states.** Introduce the minimum
   presentational state/component changes in `src/client/App.tsx`, preserving
   explicit selection and mobile behavior. Expected evidence: focused component
   tests pass, including existing async and draft tests.
3. **RED: real-browser overflow regressions.** Extend Playwright coverage with
   enough projects and notes to overflow both collections. Assert bounded shell
   geometry, visible fixed structural controls, `scrollHeight > clientHeight` on
   each intended scroll owner, stable control positions during scroll, and no
   document-level overflow at desktop, mobile, and short-height sizes. Expected
   evidence: current CSS fails because the document expands and the intended
   regions do not own overflow.
4. **GREEN/REFACTOR: establish scroll containment.** Adjust only the root, shell,
   rail, workspace, project-list, history, and relevant mobile CSS rules needed to
   enforce definite height and minimum-zero sizing. Expected evidence: overflow
   E2E passes without changing visual tokens or component hierarchy.
5. **Review and verification.** Inspect the complete diff, use the repository
   reviewer role, address correctness/accessibility/regression findings, then run
   focused tests and the authoritative verification gates. Expected evidence:
   clean diff review and passing commands listed below.

## Affected files

- `src/client/App.tsx`: distinguish loading, true-empty, and populated-no-selection
  workspace presentations.
- `src/client/styles.css`: establish viewport containment and independent rail/
  history scrolling across desktop and mobile.
- `src/client/App.test.tsx`: component regression coverage for accurate startup
  states.
- `e2e/project-chat.spec.ts` (or a focused sibling spec): real-browser overflow,
  geometry, scrolling, and fixed-control assertions.
- `docs/plans/0005-workspace-state-and-scroll-bug-fixes.md`: plan and eventual
  verification evidence.

No architecture or project-strategy document should change because system
boundaries, product scope, and durable data behavior remain the same.

## Test plan

- TDD focus: `npm test -- src/client/App.test.tsx`.
- Browser focus: build, then run the relevant Playwright spec in desktop Chromium
  and mobile WebKit, including a short-height viewport case.
- Accessibility/reflow: verify keyboard reachability and visible focus while each
  collection is scrolled; retain 390px/1440px coverage and add a constrained
  height/zoom-equivalent check for fixed controls.
- Regression suite: `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run test:coverage`, and `npm run test:e2e`.
- Completion gate: `npm run verify`.

## Risks and mitigations

- **Mobile browser viewport changes:** use dynamic viewport units with the
  existing fallback and test WebKit at the configured phone viewport plus a short
  height.
- **Nested-scroll usability:** limit nesting to two side-by-side content regions
  on desktop; on mobile only one pane is visible. Use native overflow behavior and
  confirm wheel/touch/keyboard reachability.
- **Clipped focus rings:** keep overflow only on list/history content and verify
  focused items near scroll edges remain visible.
- **False overflow assertions from fractional pixels/scrollbar gutters:** compare
  geometry with a small tolerance while still requiring the intended region to
  have measurable overflow.
- **State-copy regression:** derive presentations from explicit load/result state
  and lock each branch with component tests.

## Assumptions and open decisions

The proposed behavior intentionally does not auto-open the most recent project.
When projects exist and none is selected, desktop asks the user to choose one;
mobile continues showing the project list. This is the smallest fix consistent
with the existing explicit-navigation flow. If automatic selection or last-project
restoration is desired, it should be approved as a different behavior because it
adds loading races and persistence/navigation decisions.

There are no remaining implementation-blocking decisions for this slice.

## Implementation evidence

Implemented after approval on 2026-09-01.

TDD evidence:

- Workspace state RED: `npm test -- src/client/App.test.tsx` failed with missing
  loading status, missing populated/no-selection prompt, and first-project CTA
  appearing after list-load failure.
- Workspace state GREEN: `npm test -- src/client/App.test.tsx` passed with 12
  tests.
- Scroll containment RED: `npx playwright test e2e/project-chat.spec.ts --grep
"keeps project and note collections"` failed because `.project-list` expanded
  instead of owning overflow.
- Scroll containment GREEN: the same focused Playwright command passed in desktop
  Chromium and mobile WebKit.
- Reviewer follow-up RED: `npm test -- src/client/App.test.tsx` failed while the
  loading placeholder replaced the `main` landmark with `role="status"`.
- Reviewer follow-up GREEN: `npm test -- src/client/App.test.tsx` passed with the
  status role moved to the inner loading copy.

Final verification:

- `npm run verify` passed: release contract, build, typecheck, lint, format,
  coverage, migrations, E2E, and high-severity production audit.
- Coverage summary: 85.46% statements, 80.42% branches, 82.60% functions, 88.84%
  lines.
- E2E summary: 4 passed across desktop Chromium and mobile WebKit.
- Security summary: `npm audit --omit=dev --audit-level=high` found 0
  vulnerabilities.

Follow-up evidence:

- Timeline RED: `npx playwright test e2e/project-chat.spec.ts --grep "keeps
project and note collections"` failed because the `.thread-line` ended above
  the final visible note marker after scrolling.
- Timeline GREEN: the same focused Playwright command passed after moving the
  thread line into the note content wrapper.
- Final follow-up verification: `npm run verify` passed again with 68 unit/
  integration tests, 4 E2E tests, and 0 high-severity production audit findings.

## Status

Approved and implemented. No follow-up decisions remain for this slice.
