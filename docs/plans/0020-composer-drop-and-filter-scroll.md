# Composer attachments, filter scrolling, and layout

## Goal

Make filesystem file drops discoverable in both add and edit mode, restore the
expected history position after filter changes, and give multiline drafts the
full composer width. Approved on 2026-09-09 after review of the interactive
Add/Edit composer mockup. All three features are implemented in commit `8f74b00`
on `release/v0.0.7`; the aggregate local verification gate passes. Package
metadata remains 0.0.6 and this slice is unreleased.

## Context and reusable precedent

The following describes the preimplementation baseline.

- `ChatWorkspace` in `src/client/App.tsx` shares one add/edit composer. The file
  picker calls `onFilesSelected`, backed by `addPendingFiles`; there are currently
  no file drag/drop handlers. Reuse the pending-file chips and multipart saves.
- `src/client/history-position.ts` restores only on workspace initialization.
  Filter changes toggle anchor saving without restoring. Its existing placement
  helper already locates the current/first-future boundary.
- `.composer-input-row` in `src/client/styles.css` uses a text column beside an
  actions column, reserving unused space above the controls. Below 420px the
  existing layout already places controls underneath the textarea.
- Plan 0017 supplies the session anchor and normal future-timeline precedent.
  This request revises its filter-change rule: initialize once per actual filter
  transition, while ordinary refreshes and clock ticks preserve manual scrolling.
- Native browser events suffice; no drag/drop package is warranted. Follow the
  [MDN file-drop pattern](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop):
  recognize file items/types during hover, cancel accepted dragover events, and
  read file payloads on drop. The
  [file list is protected during hover](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files).

## Acceptance criteria

1. Dragging local files into an active chat reveals a clear composer target:
   “Drop files here to attach” or “Drop files here to attach to this message”
   during editing. Hovering the target strengthens its existing accent border.
2. Dropping within the composer appends files once to the pending list. It keeps
   draft text, sender, timestamp, and retained edit attachments. Add/Save remains
   explicit; cancel retains existing edit-cancellation semantics.
3. File drops outside the composer do not navigate the browser or add files.
   Moving across nested controls does not flicker the target. Leaving the window,
   cancelling the drag, dropping, or navigating clears the indicator. Saving
   rejects further drops. Text selection and ordinary text dragging still work.
4. File-picker access remains available by keyboard and on mobile. Use the same
   existing upload limits and recoverable server error path. Directory traversal,
   URL downloading, and clipboard-file support are outside this slice; detectable
   directory drops receive a useful unsupported-folder message.
5. Leaving All preserves its message ID and viewport offset before rows change.
   Returning to All restores that anchor, with the existing deleted/collapsed
   anchor fallback. Filtered scrolling never replaces the All anchor.
6. Entering Files, Links, or any label filter positions that matching history at
   the latest current message and first future message. Switching between two
   non-All filters also repositions. No future messages means newest matching
   message; future-only means first matching message; empty means empty state.
7. Additional future messages remain reachable by scrolling. Position the first
   future message at the lower viewport edge where geometry permits; tall future
   messages use a bounded preview portion so current context stays visible.
   As in plan 0017, very short or future-only histories can naturally reveal more
   than one future row. A strict one-row visibility limit would require hiding
   content or artificial spacing and is not proposed here.
8. Rapid filter/project changes cancel stale positioning. Ordinary edits, label
   refreshes, clock ticks, and clicking an already active filter do not repeatedly
   reset a user's reading position.
9. Add and Edit use the same full-width textarea above a compact toolbar. The
   textarea grows to eight content lines and then scrolls internally. Cancel
   occupies toolbar space without narrowing the text field.

## Proposed design

The composer stays a quiet writing surface: text receives the full width, while
secondary controls occupy a stable bottom row inside the existing rounded shell.
Keep the existing fonts, theme colors, icons, focus treatment, and utility strips.
Put Sender, Markdown, Attach, and Timestamp on the toolbar's left; place the
shortcut hint and Add, or Cancel/Save, on its right. Hide the hint first when
space is constrained; allow intentional toolbar wrapping at narrow widths.

Use this layout consistently, including single-line drafts, to avoid controls
moving sideways and changing text wrapping while typing. The tradeoff is one
toolbar row of extra height for short desktop drafts. The full-width text field
reduces wrapping for long drafts. Existing attachment and expanded utility rows
continue to share the same shell. The temporary drop overlay uses text plus an
accent outline and does not resize the composer or obscure the target location.

## Affected files

- `src/client/App.tsx`: shared composer drag handling, toolbar arrangement, and
  filter transition wiring; a focused drag helper/hook only if it simplifies
  lifecycle cleanup.
- `src/client/styles.css`: full-width textarea, toolbar reflow, drop feedback.
- `src/client/history-position.ts` and its tests: filter identity, isolated All
  anchor saving, scheduled placement, and race cancellation.
- `src/client/App.test.tsx`, `e2e/project-chat.spec.ts` or focused sibling specs:
  file-drop journeys, filter transitions, and actual layout/scroll geometry.
- Update the current behavior descriptions in `docs/ARCHITECTURE.md`,
  `docs/PROJECT.md`, and `CHANGELOG.md` after implementation. Add a concise
  supersession link in plan 0017 without rewriting its historical evidence.

## Data and migration impact

Client-only behavior. No new dependencies, API changes, migrations, backup format
changes, or durable navigation state. Existing server attachment validation
remains authoritative. No release, commit, or remote mutation is part of this plan.

## Phases

1. Add failing component tests for drag feedback and add/edit pending files;
   implement native drop handling through the existing attachment callback.
   Prove one append per drop, save/cancel behavior, and non-file drag isolation.
2. Add failing filter-transition tests; pass filter identity into the scroll
   lifecycle and preserve the All anchor before replacing its DOM. Prove direct
   All/filter/All and Files/Links/label transitions in real browser geometry.
3. Apply the approved full-width layout. Replace the desktop one-row height
   assumptions in E2E with full-width text, stable controls, eight-line growth,
   and contained history checks. Inspect add/edit and expanded utility states.
4. Run reviewer and security-review passes on the changed behavior; resolve
   actionable findings, update capability documentation, and run verification.

## Test plan

- Record RED/GREEN with `npm test -- src/client/App.test.tsx
src/client/history-position.test.tsx` (one command).
- Browser regression: `npm run test:e2e -- e2e/project-chat.spec.ts` or the
  focused sibling tests added by this slice. Cover multiple future matches,
  long/collapsed anchors, empty/future-only history, and rapid transitions.
- Visually inspect desktop, intermediate and mobile widths, 200% zoom, themes,
  keyboard focus, and reduced motion. Validate the OS-origin drag path manually
  when available; synthetic DataTransfer tests alone cannot prove Finder dispatch.
- Final aggregate: `npm run verify`; inspect `git diff --check` and the full diff.
  Report exact results and any browser/OS validation that remains unavailable.

## Risks and mitigations

- Filter cleanup can accidentally save already-filtered rows as All. Capture
  before changing rows and suppress scroll saves while restoration is pending.
- Browser drag data is restricted during hover. Detect file kinds/types first,
  inspect payloads only on drop, and render filenames as ordinary escaped text.
- Nested drag events can duplicate uploads or leave stale feedback. Give drop
  acceptance one owner and test child transitions, cancellation, and unmount.
- The toolbar increases short-draft height. Keep it compact and verify that
  history remains usable with mobile keyboards and expanded utility strips.

## Approval

The user approved all three features, including the uniform stacked composer
and the normal-timeline short-history exception in criterion 7. Retain project
styles and design guidance throughout implementation.

## Implementation and verification evidence

- Native file drops use a focused hook with one acceptance handler and the same
  pending-file callback as the picker. Detectable folders are rejected before
  adding files; outside drops, saving, cancellation, and listener cleanup are
  covered. Component tests prove Add/Edit retain draft text and old attachments.
- Filter transitions capture All before replacing rows, then restore once after
  settled layout. Filtered views do not write All anchors. Tests cover rapid
  transitions, deleted/collapsed anchors, tall future rows, and manual scrolling.
- The shared composer uses existing tokens, icons, utility strips, and focus
  styles with a full-width field above left-aligned tools and right-aligned actions.
  A supplemental 720-by-450 CSS-pixel reflow check exposed toolbar clipping with
  all utilities open and a long draft. A bounded content scroller now keeps
  the toolbar visible; its failing browser regression passes after the fix.
  Reopening a utility while scrolled down was also reproduced as a failing case;
  newly opened Sender, Timestamp, and Markdown rows are now revealed locally.
- RED: five drop-hook tests, two Add/Edit component cases, two scroll-hook cases,
  and three Chromium browser cases demonstrated missing/broken behavior before
  their implementations. An initial missing-module setup failure was resolved
  with an inert hook scaffold before recording the five behavioral failures.
- GREEN: focused client suite passed 100 tests. Browser regressions cover persisted
  add/edit drops, direct All/Files/Links/All transitions, and textarea/control
  geometry at 1440, 1024, 800, 390, and 320 pixels. Desktop and mobile edit
  screenshots were visually inspected.
- `npm run verify`: PASS on 2026-09-09, including release contract, production
  build, types, lint, formatting, coverage, migrations, browser journeys, and
  production audit. Unit/component/integration tests: 582 passed, 1 existing
  platform skip. Migration suite: 22 passed. Browser suite: 39 passed, 5
  desktop-only cases skipped on mobile, including filesystem drag simulation.
- Coverage: 92.59% statements, 87.43% branches, 95.60% functions, 94.04% lines.
  The drop hook has 95.89% statement and 82.92% branch coverage; the history hook
  has 98.27% statement and 96.66% branch coverage.
- Supplemental visuals cover expanded utilities in Light, Neutral, and Dark,
  reduced-motion preference, visible keyboard focus, and a 720-by-450 CSS-pixel
  viewport equivalent to 200% reflow pressure on a 1440-by-900 desktop. This is
  reflow-equivalent validation, not manual browser zoom. The final browser case
  verifies history/composer separation, visible Save/Cancel, and reopening each
  utility from a scrolled position. The final constrained screenshot was inspected.
- Reviewer/security review found no actionable findings in file routing,
  directory rejection, save guards, lifecycle cleanup, scroll isolation, or reflow.
- `git diff --check`: PASS. No dependencies, schema, server contracts, or native
  OS actions changed. The work was subsequently committed as `8f74b00`.
- Remaining limits: actual Finder-origin dispatch/cancellation has not been
  manually exercised; synthetic browser file drops pass. The production audit
  retains the existing moderate Fastify advisory, below its high-severity gate.
  Vite emits a non-blocking warning for the approximately 505 kB main bundle.

## Required tracker follow-ups

Read-only GitHub inspection on 2026-09-09 found pull requests but no standalone
issues. The completed feature implementation is verified. Memory closeout is
NOT READY until the two validation issues below are created or explicitly
dismissed by the user. These drafts are the sole current authority for those
unrecorded tasks; no remote mutation is authorized by this closeout.

### Already tracked: Fastify advisories

Open [PR #18](https://github.com/satankov/on-track/pull/18) proposes upgrading
Fastify 5.8.5 to 5.12.3 and is the existing remote record for this follow-up.
The installed dependency still reports GHSA-w2qp-rph6-63g4 and
GHSA-3m5p-2c4r-xxw2. Its
[CI run](https://github.com/satankov/on-track/actions/runs/34107255809) passed
for that PR revision; a future integration must verify the current release
candidate. Do not create a duplicate issue or imply the upgrade is merged.

### Draft: Verify native Open and Show in Folder on Windows and Linux

Existing browser tests use a fake native adapter. Real dispatch has been
manually reported only on one macOS host; Windows/Linux remain unverified.

Acceptance criteria:

- On Windows with Node 24 and a supported Linux desktop/runtime, test Open for a
  safe managed document and Show in Folder using disposable evaluation data.
- Confirm executable/launcher files remain blocked from Open and missing files
  or absent default associations produce recoverable errors.
- Record OS/runtime, desktop/file association, tested revision, and outcomes;
  track any failures or explicitly retain the platform limitation.

### Draft: Verify filesystem-origin drag and drop for new and edited messages

Plan 0020 has component and Chromium DataTransfer coverage, including persisted
add/edit attachments. Real Finder-origin dragging and cancellation have not
been manually exercised. This is distinct from native Open/Show dispatch.

Acceptance criteria:

- Record the tested commit, macOS version, and browser/version. Use disposable
  project data and drag actual files from Finder in Add and Edit modes.
- Confirm the target appears before dropping; multiple files append once; draft
  text and retained attachments survive; Add/Save persists the files after reload.
- Check nested-target movement, window exit, drag cancellation, outside-target
  drops, saving-in-progress, and detectable folder rejection. No unexpected
  navigation or upload should occur.
- Retain the keyboard-accessible file-picker fallback and record any browser
  limitation or defect with reproduction steps.
