# History controls, send feedback, and uninstall

Status: Implementation complete and locally verified, including edit-save glow.
Published in [v0.1.0](https://github.com/satankov/on-track/releases/tag/v0.1.0) on 2026-10-23.
Dreaming closeout reconciled on 2026-10-22; remaining native and accessibility
validation is tracked in issues #62 and #63.
The interactive send mockup is a review artifact outside the repository.

## Goal

Make long project histories easier to navigate, give new-message submission a
brief, polished visual response, and provide a documented managed uninstall
command with an explicit option to remove project data.

## Context and reusable precedent

- `ChatWorkspace` in `src/client/App.tsx` owns the `.history` scroll container
  and shared add/edit composer. `src/client/history-position.ts` already restores
  session reading anchors and positions filters near current/future messages.
  Preserve the contracts from plans 0017 and 0020.
- `submitDraft()` reaches the existing guarded append/save callbacks. Invalid
  drafts are rejected, pending requests prevent duplicate sends, and failed saves
  retain drafts. The user explicitly selected the current shortcuts: plain Enter
  adds a newline; Cmd/Ctrl+Enter sends. Button copy remains Add.
- Existing styles supply three themes, project accent/action roles, compact
  toolbars, a 12px composer radius, and keyboard focus outlines. Use CSS motion;
  no animation or scrolling dependency is warranted.
- CLI arguments/dispatch are in `src/server/cli/arguments.ts` and `main.ts`.
  `state.ts`, `process.ts`, `retention.ts`, `platform.ts`, and `launchers.ts`
  provide private state validation, authenticated stop, owned artifact cleanup,
  profile updates, and command provisioning. ADR-0008/0010 and plan 0021 govern
  managed delivery and compatibility.
- Runtime/code and data live in separate roots. Strict protocol-1 install state
  records data directory and port, not a complete ownership inventory or original
  shell profile. The private Node dispatcher spawns the CLI: Windows cleanup must
  wait for both processes before removing their runtime.
- Native APIs cover the proposed behavior. Reference: [element scrolling](https://developer.mozilla.org/en-US/docs/Web/API/Element/scroll),
  [reduced-motion preference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion),
  and [Node 24 filesystem APIs](https://nodejs.org/download/release/v24.20.0/docs/api/fs.html).
  Filesystem retries are bounded error handling, not proof that an active runtime
  or an unknown directory is safe to delete. No package installation is proposed.

## Acceptance criteria

### History controls

1. Show compact up/down controls above the composer at the history edge. Up is
   available when more than 24 CSS pixels from the beginning; down is available
   when more than 24 pixels from the end. Neither is shown for empty or fitting
   content. Reserve space so message actions are not covered.
2. Accessible names are “Scroll to beginning” and “Scroll to end”. Each action
   moves only the active history to its true boundary, including future entries
   and respecting the selected filter. Initial project/filter placement stays
   near the existing current/future boundary.
3. Recompute availability after scroll, resize, composer growth, note expansion,
   message mutation, and project/filter changes. Preserve All/filter/All anchors
   and cancel stale operations on navigation.
4. Use smooth scrolling normally and instant scrolling for reduced motion.
   Maintain visible keyboard focus and usable touch targets. If a focused
   control disappears at its destination, move focus to a stable history target
   rather than leaving it on the document body; do not focus the composer.

### Send feedback

1. Add and Cmd/Ctrl+Enter trigger the same single glow on an accepted new-message
   submission. Plain Enter continues inserting a newline. Preserve current edit
   shortcuts; edit Save also triggers the glow (user-requested follow-up on
   2026-10-22) but gets no new-message entrance animation.
2. Glow uses the active project accent around the composer shell: approximately
   130 ms rise, a short soft peak, then decay, totaling 720 ms. No layout shift,
   infinite motion, sound, or replacement of the focus indicator.
3. After confirmed persistence, animate only the newly created visible message
   with a 6px upward entrance and opacity transition over 220 ms. No replay on
   refresh, editing, label changes, filtering, or switching projects. A backdated,
   future, or filtered-out note must not hijack the existing scroll policy.
4. Initial glow means submission started, not saved. Retain pending and error
   semantics; do not clear drafts or show success before persistence. Invalid,
   empty, duplicate pending, and read-only attempts produce no send animation.
   Valid attachment-only submissions behave like text submissions.
5. Reduced motion uses a brief static accent border without halo expansion or
   message movement. Project switches/unmounts cancel stale timers and effects;
   fast consecutive valid sends can each trigger once.

### Managed uninstall

1. `thr uninstall` previews resolved app/data paths and removes the managed app,
   private Node/npm, release-local dependencies, owned logs/staging/checkpoints,
   and verified launchers. Project data remains by default.
2. `thr uninstall --delete-data` additionally deletes the configured app-owned
   SQLite data, managed attachments, and recognized data-side operational files.
   Confirmation names the target and consequence. Offer export guidance before
   confirmation; cancellation changes nothing, including server state.
3. Support `--yes` for explicit noninteractive confirmation; it never implies
   `--delete-data`. Noninteractive deletion requires both flags. Reject unknown
   or contradictory arguments. `ontrack` remains an equivalent alias.
4. Validate ownership and canonical paths before stopping anything. Serialize
   against installation/update work, stop only the authenticated instance, and
   obtain data ownership before deletion. Refuse unsafe/overlapping roots,
   root/home/system targets, symlinks/junctions, corrupt state, unresolved
   update/restore operations, and conflicting owners with actionable errors.
5. Delete only verified app artifacts. Preserve and report unrelated files under
   custom roots; never blindly remove a directory because it has an install
   marker. Remove empty owned directories after their contents are handled.
   Preserve manual/adopted source checkouts, shared Node/npm, global caches,
   externally saved exports, and original files outside managed attachments.
6. Remove only exact owned PATH blocks or entries. Verify matching runtime bin
   paths; retain modified or ambiguous profile content and explain cleanup.
   Older installs lack original-profile metadata: inspect a bounded set of
   supported profiles for exact owned blocks, without sourcing profiles.
7. Windows uses a bounded cleanup helper outside the deletion tree after the
   dispatcher and CLI exit. Validate literal paths, helper ownership, process
   identity, and target inventory. A helper being launched is not completion:
   communicate pending status and a completion/failure receipt. Remove the
   helper's temporary artifacts after successful cleanup and report failures.
8. Partial failure is reported with exact retained paths and a safe recovery or
   retry route. Keep sufficient cleanup state until completion. Never promise
   atomic deletion or automatic restoration of deleted data.
9. Document both command modes and their scope in README, user guide, and every
   OS installation guide, including a manual-install removal path. Browser-local
   appearance preferences are outside CLI-owned files and can be cleared through
   browser site-data controls. The command targets the managed installation,
   not an arbitrary current working directory.

## Non-goals

Changing message storage, search, pagination, new keyboard semantics, animation
libraries, deleting a single project (already supported), uninstalling shared
system tools, finding every user export, publishing a release, or running the
uninstaller on the user's actual installation.

## Proposed design

- **Job:** capture a thought and confidently resume reading a private notebook.
- **Audience/environment:** frequent local desktop use, with mobile regression
  support, long histories, and Light/Neutral/Dark themes.
- **Thesis:** retain the quiet writing surface and give a submitted thought one
  short accent response before attention returns to its place in history.
- **System:** reuse typography, project colors, existing icons, toolbar density,
  composer geometry, and focus treatment. Add semantic send-duration/glow roles
  and use existing project colors for their theme mappings.
- **Signature:** the project accent softly illuminates the composer perimeter,
  followed by a small arrival of the saved note. Other content stays still.
- **Risk/restraint:** the halo is deliberately more expressive than resting
  controls, but remains brief and local. Avoid particles, rainbow outlines,
  bouncing bubbles, moving text clones, and looping pulses because they compete
  with repeated writing and reading.
- Preview controls allow light/neutral/dark, reduced motion, timing, and simulated
  success/error inspection. Simulation does not establish production behavior.

## Affected files

- UI: `src/client/App.tsx`, `src/client/styles.css`, focused history/send helpers
  only if warranted, `src/client/App.test.tsx`, history tests, and focused browser
  cases in `e2e/project-chat.spec.ts` or a sibling spec.
- CLI: new `src/server/cli/uninstall.ts` with tests; arguments, dispatch, platform,
  launchers, corresponding tests, and a minimal platform cleanup helper where
  required. Add a disposable managed-uninstall smoke script.
- Documentation: README, CHANGELOG, `docs/USER_GUIDE.md`,
  `docs/install/{README,macos,linux,windows}.md`, `docs/ARCHITECTURE.md`, relevant
  current capability/compatibility entries, and an ADR for uninstall ownership
  and cleanup lifecycle. Update only statements changed by implementation.

## Data and migration impact

No database migration or backup-format change; schema remains 7. No production
dependency. Navigation/animation state is transient. Any added cleanup manifest
must be separately versioned, bounded, and validated without breaking the strict
existing install-state protocol. Data deletion happens only on explicit command
execution with the destructive option; implementation tests use disposable data.

## Phases

1. **Navigation:** record failing boundary/resize/anchor tests; implement controls;
   pass browser geometry and keyboard/mobile checks.
2. **Approved animation:** record failing submission-state tests; implement common
   send feedback and success-only entrance; compare rendered results with preview
   in all themes and reduced motion. Verify existing shortcuts unchanged.
3. **Uninstall lifecycle:** first prove Windows post-exit cleanup on disposable
   fixtures; implement validated removal planning, confirmation, shutdown/locks,
   execution, receipts/retry, and PATH reversal using RED/GREEN tests. Verify
   cancellation, retained data, explicit purge, and unknown-file preservation.
4. **Review and delivery:** use reviewer role and security-review skill, resolve
   findings, update instructions, and run verification-loop. Inspect full diff.

## Test plan

- `npm test -- src/client/history-position.test.tsx src/client/App.test.tsx`
- `npm run test:e2e -- e2e/project-chat.spec.ts` plus any focused new sibling spec.
- `npm test -- src/server/cli/arguments.test.ts src/server/cli/main.test.ts src/server/cli/platform.test.ts src/server/cli/launchers.test.ts src/server/cli/uninstall.test.ts`
- `npm run test:managed-install` and `npm run test:managed-update`.
- Add/run disposable uninstall smoke coverage for running/stopped app, custom
  paths with spaces/metacharacters, adopted data, cancellation, both removal
  modes, unsafe links, lock conflicts, modified launchers/profiles, pending
  recovery, interruption, and reruns. Test real Windows and Linux separately.
- Inspect UI at desktop/intermediate/mobile widths, 200% browser zoom, all themes,
  reduced motion, keyboard focus, expanded utilities, and long content. Test empty,
  filtered, future-only, long, and dynamically resized histories.
- Final `npm run verify` and `git diff --check`; report exact outcomes and host
  platform limits. Do not claim Windows/Linux smoke evidence from macOS tests.

## Risks and mitigations

Glow can be clipped by existing overflow boundaries: render at the shell boundary
with sufficient paint space and verify expanded/short viewport states. Dynamic
scroll controls can disrupt focus or saved anchors: keep one scroll owner and
test transition cleanup. Animations must distinguish submission from persistence.

Deletion is irreversible and interruption is possible. Plan exact targets first,
retain unknown files, honor locks, and provide honest partial-failure reporting.
Windows executable locking is an early proof requirement, not a late polish task.
Existing platform-validation limitations remain until real smoke evidence exists.

## Approved decisions

The user confirmed current keyboard shortcuts and approved all phases:
720 ms glow plus 220 ms message entrance; managed app-only uninstall by default;
explicit `--delete-data` for projects and attachments.

## Authorization scope

The user's “approve all” authorized implementation. This does not authorize commits, remote changes, release publishing,
or executing destructive uninstall against real user data.

## Implementation decisions and review

- Use existing history scroll ownership and native CSS motion, with no new
  dependency or schema change. Reserve the button gutter only for overflowing
  history, and preserve resting composer height and short-message alignment.
- Ownership SQLite files remain on every platform. A regression reproduced
  the danger of unlinking them: closing the original SQLite handle could remove
  a newly acquired owner's journal by pathname. Stable small lock files contain
  no project content. This safety requirement supersedes removal of all
  operational files; it is documented in ADR-0012 and user instructions.
- Unknown staging is retained because existing metadata cannot prove ownership.
  Recorded releases, private runtimes, checkpoints, logs, launchers, and optional
  data are removed through a bounded inventory with identity validation.
- Reviewer findings addressed: Windows UTF-8 JSON reads, an external helper
  working directory (including custom TEMP/TMP), exact retry filename matching,
  stable ownership, and retry recovery checks after acquiring data ownership.
- Native Windows/Linux smoke is not available on this macOS host. A disposable
  uninstall smoke now runs in the existing native CI matrix; adding the gate is
  not evidence that those platforms passed. Windows helper scheduling is unit
  tested locally; executable-locking behavior still needs native execution.

## Remaining validation

The repository maintainer owns these next-release validation records, created
with user approval during dreaming closeout on 2026-10-22:

- [Issue #62: native uninstall and Node 24 launcher validation](https://github.com/satankov/on-track/issues/62).
  Covers real Windows/Linux execution, dispatcher exit, cleanup receipts/retry,
  path and ownership safety, and data retention/purge. Broader clean installation
  and published-update work remains in issue #34.
- [Issue #63: assistive-technology validation](https://github.com/satankov/on-track/issues/63).
  Covers history-control names/focus, keyboard flows, reduced motion, and
  pending/error/save announcements with a real screen reader.

These issues own acceptance criteria and status. Local tests do not establish
native-platform or manual assistive-technology support. Issue #61's attachment
focus fix later shipped in v0.1.0 with passing Linux CI; its pending tracker
reconciliation is documented in [plan 0025](0025-security-audit-response.md#tracker-reconciliation).

## Preview verification (2026-10-21)

- `node /tmp/check-threadstr-preview.cjs`: passed click submission, Ctrl+Enter,
  replay, narrow-layout overflow checks, and reduced-motion fallback with no
  JavaScript runtime errors. This temporary script exercises the isolated mockup,
  not production code. A sandboxed form-submit issue was corrected before the
  successful run by handling the preview's Add button directly.
- Inspected desktop Light and mobile Dark screenshots. Checked outer widths of
  800, 390, and 352 pixels (the wrapper reserves additional horizontal padding).
  Neutral theme, error simulation, screen-reader behavior, and actual 200% browser
  zoom still require visual/interaction review during implementation.
- Plan formatting and `git diff --check` pass. Production tests were not run:
  only this plan and the isolated preview were authored.

## Implementation verification (2026-10-21)

- `npm run verify`: PASS on macOS, Node 22.18.0. Includes release contract,
  production build, both TypeScript configurations, lint, formatting, coverage,
  migrations, browser tests, production dependency audit, and disposable managed
  installation/update/uninstall smoke. Existing Vite bundle-size advisory remains.
- Unit/component/integration suite: 75 files, 1,006 passed, 9 existing skips.
  Coverage: 90.40% statements, 84.45% branches, 92.61% functions, 91.56% lines.
  Every new behavior module exceeds 80% statement coverage; uninstall planning
  branch coverage is 76.08%. PowerShell source is not executed by local unit tests.
- Migration checks: 23 passed. No migration introduced.
- Browser suite: 62 passed, 6 existing platform-specific skips. Includes desktop
  Chromium, mobile WebKit, navigation focus, preserved shortcuts, accepted send
  animations, reduced motion, existing reading anchors, and 200% reflow coverage.
  Visually inspected real glow screenshots in Light/Neutral/Dark; the peak was
  paused through the browser animation API for repeatable inspection.
- `npm run security:check` (within verify): zero production vulnerabilities.
  Reviewer/security review found no remaining actionable issues after fixes to
  recovery races, lock ownership, path validation, UTF-8 parsing, and helper cwd.
- Disposable uninstall smoke: stopped a running managed server, removed code and
  private runtime, retained projects/attachments by default, then removed selected
  data on explicit purge while preserving a user export and external dependency
  link target. No real user installation was uninstalled.
- `git diff --check`: PASS. Diff reviewed; no commits, publication, dependencies,
  schema changes, or generated user data added.
- Remaining validation: native Windows/Linux uninstall, Node 24 two-process
  launcher cleanup, and assistive-technology/manual screen-reader checks. CI now
  contains the native uninstall gate; it was not remotely executed in this task.

## Edit-save follow-up (2026-10-22)

User requested the same glow when saving edits. Accepted edit submissions now
trigger it through Save or Cmd/Ctrl+Enter. Feedback uses an independently owned
DOM attribute so leaving edit mode cannot cancel the animation. Edited messages
do not replay the new-message entrance.

- RED: three component cases failed for missing glow, then exposed premature
  cancellation when edit mode closed. Both failures corrected.
- `npm test -- src/client/App.test.tsx src/client/send-feedback.test.tsx`: 98 passed.
- `npx playwright test e2e/project-chat.spec.ts -g 'navigates history boundaries'`:
  2 passed (desktop Chromium and mobile WebKit), including saved-edit animation.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`,
  and `git diff --check`: passed. Existing bundle-size advisory remains.
  Full CLI/security smoke was not repeated for this UI-only follow-up.

## Closeout verification (2026-10-22)

The final combined `npm run verify` passed on macOS/Node 22.18.0: 75 test files,
1,009 tests passed and 9 skipped; 62 browser tests passed and 6 skipped; 23
migration tests passed; production audit reported zero vulnerabilities; managed
install/update/uninstall smoke passed. Coverage is 90.40% statements, 84.45%
branches, 92.61% functions, and 91.56% lines. Existing bundle-size advisory remains.
Final review found no remaining implementation defects; release-command and
Windows retry instructions were corrected. Project/architecture indexes reflect
the published v0.0.9 baseline and the complete approved feature scope.

Follow-ups #62/#63 were created with explicit user approval. Existing #61 remains
open; these local results do not resolve its reported Linux/mobile-WebKit failure.
No release or push is part of this closeout. The user separately authorized the
local commit.
