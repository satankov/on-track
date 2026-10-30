# Project subthreads implementation plan

Status: implemented and verified locally, 2026-10-30, following the user's
explicit instruction to implement the approved subthreads design. Work is on `codex/project-subthreads`,
based on `codex/next-release-candidate` (60217a5) with main's managed-server test
stability fix carried forward. The user subsequently requested committing the
complete change and integrating it into `codex/next-release-candidate`.

## Goal

Implement the approved desktop project/subthread workflow. A project is its main
conversation; subthreads are flat, independently editable conversations within it.

## Context and reusable precedent

Reuse Chat/Note storage, existing composer, scoped labels, message actions,
reading anchors, pin/archive, Edit, keyword search, native dialogs, and backup
validation. Follow DESIGN.md and the approved branding/threadstr/subthreads
mockup. Preserve candidate title-only rail and Question display. No dependencies.

## Acceptance criteria

- Clicking a project opens Main and expands five indented active children;
  clicking it again collapses children while Main stays open. No row chevron.
  Pins sort first within the project; Show all expands the remainder.
- Independent creation takes a name only. Continue in subthread is an icon
  between Change labels and Copy message. Both use the same branch glyph.
- New conversations contain no copied messages. Branching from a child creates
  a sibling within the same project.
- Centered date-style origin and continuation links navigate to the exact source
  or child; deleted sources have explicit safe fallbacks.
- Children inherit root accent dynamically and own all other Edit settings,
  initially seeded from the root. Edit includes archive and delete.
- Parent and child header titles independently ellipsize and retain full names.
- Search Project checkbox searches Main and every child, including archives,
  from any conversation. Results identify ownership and open exact context.
- Per-conversation message tools, attachments, labels, drafts and reading state
  remain isolated. Existing main/candidate behavior remains intact.
- Restart, root deletion, old-backup migration, selected export and merged import
  preserve graph integrity and clean up managed files correctly.

## Non-goals

AI, copied history/context, cross-thread message publishing, deeper hierarchy,
mobile redesign, release publication, commits, pushes, or changing source branches.

## Proposed design

Add nullable chats.project_id referencing the root with cascading deletion.
Existing chats remain roots. A separate subthread_origins table records continued
creation; source conversation/message references become NULL after deletion.
Validate flat roots and same-project origin ownership transactionally and on
backup import. Dynamic effective accent is projected from the root; child accent
writes are rejected. Notes remain owned by one conversation.

POST /api/chats/:id/subthreads accepts title and optional sourceNoteId. Resolve
root server-side; source notes must belong to :id. Add a project-wide read for
search, returning ordinary conversation details; reuse search normalization.

Archiving a root hides its group and preserves individual child archive states.
Child archive only affects that child. Root deletion removes all conversations
and managed files, with explicit confirmation. Deleting a source child never
removes sibling forks. Root selection in backups includes its full closure;
merge remaps root, child, note, label and origin identities.

New controls reuse existing icon buttons, project dialog, native checkbox,
settings groups and date-divider typography. Child rows indent 24px. Header uses
flex items with min-width:0 and separate overflow ellipsis; message actions keep
adequate gutter for all five controls. Inspect Light/Neutral/Dark at desktop sizes.

## Data and migration impact

Advance schema 9 to 10 with a new migration and current snapshot/journal. Keep
backup format 1 and support legacy schema 3–9 through existing migration paths.
No rewrites of shipped migrations. Migration recovery uses existing managed
checkpoint/backup restore; older code must reject schema 10.

## Phases

1. Lock creation/ownership/deletion guarantees with failing integration tests.
2. Persist and expose subthreads, including root attachment cleanup; pass tests.
3. Update selected export, restore validation and merge identity mapping; prove
   legacy migration and round trips before delivery.
4. Implement approved UI with behavioral component and desktop E2E evidence.
5. Independent correctness/security review, full quality gates, rendered UI
   review, and concise durable documentation updates.

## Test plan

Focused tests cover flattening, settings independence, inherited accent, origin
fallbacks, transaction rejection, attachment cleanup, backup closure, graph
validation and identity remapping. UI tests cover hierarchy, creation, links,
Project search and ownership, long titles, focus, error recovery and persistence.
Run build, typecheck, lint, format:check, test:coverage, test:migrations,
test:e2e, security:check, release:check and relevant managed update smoke checks.
Record exact outcomes at completion. Use only disposable databases.

## Risks and mitigations

- Cascading rows can leak attachment files: gather all descendant paths before
  deletion inside the repository transaction.
- Imported graphs can be invalid: validate root and origin invariants before
  activation; insert roots/children, notes, then remapped origins transactionally.
- Cross-conversation results can mutate the wrong chat: result navigation uses
  owning chat ID, and normal tools operate only after opening that conversation.
- UI cleanup regression: base on candidate and preserve main's unique fix.

## Open decisions

None blocking. Initial child settings clone root settings; later edits are
independent. Root archive preserves child state. No history text is inherited.

## Authorization

The user approved the visual design and explicitly requested implementation,
including preservation of work on main and codex/next-release-candidate.

## Completion evidence

Implemented all phases, including schema-10 migration, complete-project backup
selection/merge/restore, source deletion fallbacks, independent settings and
session drafts, whole-project search, and the approved desktop controls. Current
project/architecture/design docs and the production-CSS cookbook are updated.
The original visual mockup is preserved.

- TDD RED confirmed missing creation/flat ownership/source lifecycle behavior,
  the missing Project checkbox, incorrect rail grouping/action order, and both
  late-response races. The same tests passed after implementation. Regressions
  cover draft changes during navigation, replacement-import cache clearing,
  stale and already-observed creation responses, and deletion after navigation.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run release:check`, and `git diff --check`: pass.
- Final `CI=true npm run test:coverage`: 86 files; 1,154 passed, 9 skipped.
  Statements 90.64%, branches 85.13%, functions 91.76%, lines 91.86%.
- `npm run test:migrations`: 28 passed. Additional subthread integration tests
  prove schema-9 upgrade, flat origins, independent custom-label identities,
  inherited accent, invalid-source rejection and full attachment cleanup.
- Independent backend/security review: 110 focused backup/import/subthread tests
  plus the scoped API test passed; no remaining actionable findings.
- Full `npx playwright test`: 86 passed, 18 skipped. After the final two client
  race fixes and creation focus correction, the affected journeys were rerun:
  `npx playwright test e2e/subthreads.spec.ts e2e/project-chat.spec.ts` passed
  43 tests, with 7 skips. Existing desktop/mobile regressions remain covered;
  the new design targets desktop.
- `npm run security:check`: zero vulnerabilities.
- Managed install smoke passed. `npm run test:managed-update` and
  `npm run test:managed-uninstall` passed: successful activation, failed-migration
  recovery, attachments, restart, retained-data uninstall and explicit purge.
- Rendered actual app at 1440×900 and 1024×768; Light/Neutral/Dark, long titles,
  exact source/result focus, native dialog cancellation, settings/delete,
  indented children, and search ownership. Both title segments independently
  truncate while actions remain reachable. Cookbook specimen rendered too.

One final coverage attempt encountered a timeout in an existing hidden-trigger
backup-validation test. The focused retry passed nine checks and a complete
coverage rerun passed without code changes. Existing Vite bootstrap-script and
bundle-size warnings remain. Real-device/screen-reader qualification and a
published upgrade are separate release gates; no publication is claimed.

The delivery target is `codex/next-release-candidate`, using a feature commit
from `codex/project-subthreads`. It preserves candidate 60217a5 and main
a5d911a's managed-test stability fix. Main remains unchanged. No dependencies,
remote pushes, pull requests or releases are part of this delivery.
