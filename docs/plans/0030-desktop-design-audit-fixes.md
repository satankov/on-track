# Desktop design audit corrections

Status: Complete, 2026-10-27. Authorized by the user's request to fix the desktop
findings from the design audit. No mobile-specific work is included.

## Goal and scope

Bring existing desktop controls into the established DESIGN.md contract without
changing product workflows, data formats, dependencies, or the visual direction.
Reuse the current dialog, settings, message, attachment, and feedback families.

## Acceptance criteria

- Appearance choices fit desktop workspaces, including an 800px browser window.
- Create project is centered in the full viewport, has one backdrop treatment,
  and returns keyboard focus to its opening control after Cancel or Escape.
- Wide Markdown tables remain readable and scroll locally with keyboard access;
  collapsed content does not introduce hidden focus targets.
- Attachment explanations remain readable in constrained desktop message widths.
- The composer has one visible keyboard stop for opening the file picker.
- Backup export, preview, and import progress/errors appear beside the relevant
  controls, preserve retry/selection behavior, and retain existing write guards.
- Backup typography and Home help use the existing documented roles.
- Message-label popups retain a visible boundary in forced-colors mode.

Desktop verification covers 1440×900, 1024×768, and 800×768, all three themes,
keyboard interaction, forced colors, and desktop zoom/reflow where relevant.
The 320px swatch layout and tablet-only hover issue remain outside this slice.
Shared corrections may incidentally improve mobile, but no mobile layouts,
breakpoints, tests, or dedicated verification are added.

## Affected surfaces and implementation

1. Add focused regression coverage in `e2e/desktop-design.spec.ts` and
   `src/client/BackupSettingsWorkspace.test.tsx`; establish failures first.
2. Correct modal/focus/table/file-picker markup in `src/client/App.tsx` and
   local backup feedback in `src/client/BackupSettingsWorkspace.tsx`.
3. Correct existing component selectors in `src/client/styles.css` without a
   token migration. Keep DESIGN.md and cookbook specimens consistent with the
   repaired anatomy and states.
4. Review the full diff and verify the desktop flows and repository quality gates.

## Data impact and risks

No API, SQLite, migration, backup-format, native-file capability, or persistence
changes. No new dependency. Main regression risks are modal focus after successful
creation, hidden keyboard targets in collapsed messages, backup feedback ownership,
and stale preview completion. Preserve existing guards and cover those paths.

## Verification

Run focused component and desktop browser regressions RED then GREEN. Complete
`npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`,
`npm run test:coverage`, `npx playwright test --project=desktop-chromium`,
`npm run security:check`, `git diff --check`, cookbook script validation, and
rendered review. No remote mutation is included.

### Results

- RED: eight browser regressions and two backup component regressions failed
  against the original implementation for the intended reasons.
- Build, types, lint, formatting, and `git diff --check`: passed. Build retains
  the pre-existing advisory about a client chunk over 500kB.
- Focused tests: 172 passed. Full coverage: 1,039 passed, nine existing skips;
  90.93% statements, 85.12% branches, 93.42% functions, 92.04% lines. App and
  BackupSettingsWorkspace both exceed 90% statement and line coverage.
- Desktop Chromium: all 45 journeys passed, including nine new regressions.
  The two backup journeys also passed after the final accessibility adjustment.
- Security: production dependency audit found zero vulnerabilities. Read-only
  review found no new Markdown, file-action, or backup trust-boundary issues.
- Review caught an empty live-region visibility issue; replaced `display:none`
  with accessible clipping and obtained a clean follow-up review.
- Visual checks: Appearance at 800px in Light/Neutral/Dark, centered modal,
  1024px table scrolling, 800px attachment explanations, forced-color popup,
  local backup feedback and 200% backup reflow. Cookbook feedback/table/modal
  specimens were rendered with the current stylesheet; all 22 local references
  and `node --check branding/threadstr/ui/cookbook.js` passed.
- No migrations or data-format changes. Mobile-specific issues remain deferred.
  Actual screen-reader speech was not manually verified.
