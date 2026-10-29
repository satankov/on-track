# Flat UI and durable design contract

Status: User-requested implementation and cookbook complete in source; not released. Reconciled on 2026-10-27 against baseline
`9ee198e`, after published v0.1.0. No next release version is selected.

## Delivered scope

- Borderless resting composer, participant bubbles, rail Add/Settings controls,
  message labels, history arrows, and message-label popup; meaningful focus and
  high-contrast affordances remain.
- Edit project uses grouped controls and concise notes without an outer card or
  redundant visible title. Shared swatch fields also serve Create project.
  Project labels have an icon, title, and right-aligned square checkbox.
- Settings and Edit are left aligned with 840px maximum content, desktop left
  gutter three times `clamp(20px, 3vw, 40px)`, unchanged right gutter, and 16px
  gutters on mobile. General, Appearance, Backups, and Create share the flat style.
- Back/Save are at the top; failed saves show an alert there and preserve edits
  for retry. Archive/Delete are stacked with the archive preservation note.
- Composer edge fades from transparent into the history surface, replacing the
  superseded black shadow. Timestamp input aligns left with its helper rows.
- [DESIGN.md](../../DESIGN.md) owns usage standards and exact baseline metrics;
  [the visual cookbook](../../branding/threadstr/ui/README.md) imports production
  CSS and demonstrates themes and states. Palette values remain in CSS. Legacy
  selectors are documented exceptions, not templates for new controls.

No API, database schema, backup format, dependency, or installation change.
No architecture ADR is needed for these visual refinements. The current design
contract supersedes visual details in older plans when they describe the former
bordered/centered settings treatment; historical verification remains historical.

## Agent discovery and portability

Local `AGENTS.md`, `.agents/skills/design/SKILL.md`, its UI metadata, and the
alternate `frontend-design-direction` skill route future UI work to DESIGN.md.
Those paths are already Git-ignored: local changes persist in this checkout but
will not accompany an ordinary commit or clean clone. DESIGN.md, the cookbook,
and the architecture/branding indexes are repository artifacts. No ignore rule
or staging state was changed. A fresh checkout can reconstruct the rules from
these repository documents; instruction-file distribution is not promised.

## Verification evidence and limits

The implementation cycle ran:

- `npm run build`, `npm run typecheck`, `npm run lint`,
  `npm run format:check`, and `git diff --check`: passed. The existing >500kB
  client-chunk advisory remains.
- Focused App/theme/backup/search/history component suite: 164 passed before the
  final save-error regression. After that fix, `npm test -- src/client/App.test.tsx`
  passed all 102 tests, including failed-save placement, preserved draft, and retry.
- Full Playwright suite: 66 passed, 6 intentional skips, desktop Chromium and
  mobile WebKit. After the save-error fix and subsequent margin-only adjustment,
  `npx playwright test e2e/project-archive.spec.ts` passed both projects.
- An earlier full coverage run during this slice passed 1,033 tests / 9 skips,
  with 91.99% lines. It predates the later refinements and is not represented as
  final-tree coverage. Full `npm run verify`, release/platform matrices, and
  managed lifecycle smoke were not repeated for this design slice.
- Cookbook syntax, focused lint/format, local links, both skill validators, and
  independent review/forward use passed. Theme, specimen interaction, and
  responsive evidence is recorded in its README. App and cookbook screenshots
  were visually reviewed; this is not a complete assistive-technology audit.
- `npm run security:check` failed during the cycle and again on 2026-10-27:
  one high-severity Zod advisory. No dependency was changed by this slice.

No unfinished UI implementation is identified. The current security follow-up
is tracked in [issue #72](https://github.com/satankov/on-track/issues/72), with
audit evidence in [plan 0025](0025-security-audit-response.md#current-dependency-follow-up-2026-10-27).
Existing native/platform/accessibility follow-ups #32, #33, #34, #62, and #63
remain open in GitHub. Local visual passes do not close their evidence gaps.
Issue #61 also remains open, but subsequent review found its published focus fix
and passing Linux CI; see [plan 0025](0025-security-audit-response.md#tracker-reconciliation).

## Final cycle verification after issue #72

On 2026-10-27 the Zod-only dependency follow-up and three bounded-validation
regressions passed the full `npm run verify` gate on macOS arm64 / Node 22.18.0.
This supersedes the earlier incomplete final-tree gate above: 1,037 tests passed
with 9 skips, 23 migration tests passed, and 66 browser tests passed with 6
intentional skips. Coverage is 92.03% lines. The production audit reports zero
vulnerabilities, and managed lifecycle/update/uninstall smoke checks pass.
An initial browser startup failure did not recur on the complete rerun; exact
limits and the separate moderate development-tool audit findings are recorded
in [plan 0025](0025-security-audit-response.md#issue-72-remediation-2026-10-27).

Status: READY FOR NEW CHAT. Design artifacts, the Zod fix, and closeout documents
are included in this cycle's source commits; issue #72 remains open pending delivery.
No release or remote tracker change was performed during this remediation.
