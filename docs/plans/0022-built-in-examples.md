# Built-in Examples implementation plan

Status: approved by the user on 2026-09-16 for Phases 1–5.
Amendment: ship ONE simple trip-planning story; detailed storytelling and full
capability coverage will be refined later. This supersedes all earlier two-story
and exhaustive-content requirements. Implementation complete; verification evidence is recorded below.
Prepared 2026-09-16 against commit `60e0ddc` (package version 0.0.8).
The approved design below is followed by implementation and verification evidence.

## Goal

Introduce one simple trip-planning story that teaches On Track through its
actual chat interface. Place maintained, read-only originals in a new Examples
sidebar group. Let users create independent editable projects from them and
hide the group through Settings → General → Show examples (on by default).

The user has agreed to read-only originals, editable copies, and release-driven
story updates. Their latest direction supersedes the earlier Archive placement.
The user explicitly authorized implementation of Phases 1–5 with that amendment.

## Context and reusable precedent

- `docs/PROJECT.md`: a private personal notebook, not live team messaging; local
  ownership and no outbound runtime dependency remain product constraints.
- `src/client/App.tsx`: `ProjectRail`, `RailSection`, `SettingsRail`,
  `ChatWorkspace`, `AttachmentList`, `MessageActionButton`, and
  `CollapsibleMessageBody` provide the real UI to extend. Session reading
  positions, filters, pending mutation guards, and mobile focus must survive.
- `src/client/styles.css`: existing rail density, semantic theme colors,
  settings panels, composer geometry, button and focus treatments.
- `src/client/theme.ts`: precedent for validated browser-local customization
  with a safe fallback when localStorage is unavailable.
- `src/domain/types.ts` and `validation.ts`: current chat/note/attachment
  contracts, limits, labels, and accents. There is no example provenance model.
- `src/server/db/repository.ts`: archive clears pin and preserves editability.
  Examples must not change ordinary Archive semantics.
- `src/server/database-transfer/project-import.ts`: fresh identities, managed
  attachment publication, and rollback compensation for independent copies.
  `src/server/db/project-import.ts::insertImportedRecords` inserts all related
  records in one SQLite transaction. Reuse narrowly; do not build fake backup
  uploads or round-trip bundled examples through SQLite files.
- `src/server/app.ts`, `database-transfer/maintenance-gate.ts`, and
  `attachments/managed-attachment-store.ts`: existing transport controls,
  maintenance coordination, and file-before-reference ownership rules.
- `tsconfig.server.json` compiles server/domain TypeScript; `scripts/managed-release.mjs`
  and release contract tests cover distribution. Catalog and small file payloads
  can compile as source modules without a separate asset installation system.

External research: the [Joplin Templates plugin](https://github.com/joplin/plugin-templates)
provides a maintained precedent for creating ordinary notes from reusable source
content, but its user-authored template language is outside this scope. The
[npm Zod registry entry](https://www.npmjs.com/package/zod) was checked; the
repository already has boundary validation. No new package or template engine
is needed. For discoverable inactive controls, use the
[W3C APG keyboard guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#focusabilityofdisabledcontrols).

## Acceptance criteria

1. Fresh and existing installations show Examples after Archive, expanded by
   default, with one trip-planning story. Existing
   Pinned, Projects, and Archive sections retain their behavior and counts.
2. Selecting an example renders the real timeline and filters. Its first visit
   starts at the beginning of the story; later visits restore session reading
   position. All/Files/Links/label filters and long-message expansion work.
3. A persistent notice says: “Read-only example. Create a copy to edit messages
   or open and modify files.” The primary action is “Create editable copy”.
4. Message editing/deletion/label assignment, composition, file attachment,
   project customization, and native Open/Show in folder cannot mutate or expose
   originals. Their relevant controls remain visible but inactive with an
   accessible explanation. Copying message text and reading remain available.
5. No original can be pinned, archived, restored, deleted, or exported as user
   data. Example rows have no pin/restore action. No native action can resolve a
   bundled file through an ordinary project endpoint, including forged requests.
6. Creating a copy makes one complete, unpinned, unarchived ordinary project,
   selects it, expands Projects if needed, and announces success. Notes, labels,
   sender names, settings, and independent file bytes are preserved. Editing or
   deleting copies cannot affect an original or another copy.
7. Pending copies cannot be double-submitted from the same UI. Failures before
   commit leave no partial project. Known post-commit refresh failures are
   reported as completed copies. Ambiguous lost responses never auto-retry.
8. Settings gains General before Appearance and Backups, selected initially.
   Its sole setting is Show examples, enabled by default and applied immediately.
   Hiding removes the whole group; showing restores it. Copies stay visible.
9. The preference persists in this browser/origin through reloads and software
   updates. Invalid/missing values default to on. Blocked storage still permits
   a session change and explains that it could not be saved.
10. App updates refresh originals by stable catalog identity/revision without
    touching copies or the visibility preference. Reading examples never seeds
    a database or writes attachment files. No network fetch is required.
11. Backups contain copies as ordinary projects and exclude originals. Restoring
    old or current backups does not add duplicate originals or change visibility.
12. New surfaces meet keyboard, touch, theme, focus, and reflow requirements;
    desktop/mobile, 200% zoom, reduced motion, and forced colors are verified.

## Non-goals

User-authored templates, a generic tutorial framework, guided overlays, progress
tracking, telemetry, remote example delivery, app-wide read-only projects,
automatic copying, notifications about every content revision, new dependencies,
schema changes, or a redesign of existing settings and project navigation.
No installation, CLI-update, or database-replacement exercise is performed
automatically as part of onboarding.

## Proposed design

### Direction brief

- **Job:** understand a useful project notebook, then safely experiment on a copy.
- **Audience/environment:** a first-time local user scanning a compact desktop
  workspace, with the existing mobile workflow supported.
- **Thesis:** examples should look like real On Track notebooks, with ownership
  explained at the point where reading becomes editing.
- **System:** reuse typography, six existing accents, Light/Neutral/Dark tokens,
  flat panels, compact rows, existing stroked icons, and focus treatments. Add
  no font, color system, decorative illustration, animation, or component library.
- **Signature:** a quiet read-only notice and one clear copy action alongside
  an authentic project story.
- **Risk/restraint:** visible inactive controls teach capabilities but can feel
  broken; explain them persistently and keep the story fully legible.
- **Rejections:** lock icons on every message, warning-yellow attachment cards,
  marketing cards, pop-up tours, and attention dots competing with real work.

### Layout and interaction

```text
PINNED                 Weekend trip                    [Create editable copy]
PROJECTS               -------------------------------------------------------
ARCHIVE                Existing filters and real message timeline
EXAMPLES  01           ...
  Weekend trip         Regular composer, with the read-only notice inside it
                       and all writing controls inactive
```

Use normal section disclosure/count styling. Examples disclosure is session-local,
independent of the persistent Show examples preference. Rows use authored short
descriptions instead of time-sensitive previews and omit Attention indicators.
Do not auto-open a story or redirect existing users after an upgrade.

The header copy action replaces Edit; no separate notification row is added.
The regular composer is reused, including the same text field, toolbar icons,
spacing, and Add control. Put the read-only notice inside its border above the
text field. A disabled fieldset blocks its controls; pointer events on those
controls route to the surrounding composer so attempted interaction still gives
feedback. Remove the redundant “Create a copy to edit” text outside the composer.

Every blocked message/file action and click inside the composer highlights the
composer border and notice with a steady glow for 800 ms. Further attempts restart
that interval. Enter/Space on the focusable read-only composer also triggers it.
Use no pulsing or moving animation; forced colors use an outline. Dragging files
cannot navigate the browser or upload data, and a drop on the composer triggers
the same explanation.

Use native disabled input/submit controls for the composer. For message/file
action buttons whose discoverability teaches a capability, use `aria-disabled`
with explicit pointer/keyboard handler guards and `aria-describedby` linked to
the explanation. Activating such a control only announces the copy requirement;
it never starts the underlying action. Do not rely on opacity, tooltip hover,
or `aria-disabled` alone. Read-only file actions use neutral helper copy, not
the existing unsafe/missing-file warning state. Links in story Markdown remain
ordinary user-activated links under the existing URL policy; “open files” refers
to attachment/native actions, not reading a linked page.

Settings General uses the existing settings panel and a native checkbox:

```text
General
Workspace
[x] Show examples
    Display read-only example projects in the sidebar.
```

Hiding while an example is the remembered selection clears that selection and
its active filter; returning from Settings shows Home. A selected user project
is retained. Focus remains on the setting. Re-enabling restores the group without
automatically opening it. Listen for preference changes from another tab; if they
hide the actively displayed example, go Home and announce the change.

### Stories and coverage

Ship one English Weekend trip example with six short messages: an introduction,
a checklist/question, a recorded remark, a decision and budget table/link, an
attached packing list, and a brief invitation to experiment in a copy. Use
fictional names and data. Do not spend this slice polishing narratives or trying
to exhaustively demonstrate every feature; the user explicitly deferred that.
The supported read-only/copy interface still preserves all normal project data.

Keep authored dates fixed and chronological. The closing note suggests scheduling
a note tomorrow in an editable copy to demonstrate the real future boundary.
No simulated clock or silent moving dates. The one tiny plain-text attachment
exists to prove file copying, isolation, and native actions after copying.

### Ownership, contracts, and updates

Use an application-owned catalog outside SQLite. Proposed modules:
`src/domain/examples.ts`, `src/server/examples/catalog.ts`,
`src/server/examples/service.ts`, and `src/server/examples/routes.ts`.
Catalog entries have a stable slug, integer content revision, explicit order,
summary, and validated story data. Tiny UTF-8 attachment payloads are authored
as server-only source strings and compiled with TypeScript. They are not served
as public files, arbitrary file paths, or executable templates. Cap the initial
catalog to one story and 100 KiB total attachment payloads.

Expose separate `GET /api/examples`, `GET /api/examples/:slug`, and
`POST /api/examples/:slug/copies` routes. The copy body contains the expected
revision only, validated strictly. Unknown examples return 404; stale revisions
return 409 with a refresh message before any write. Unsupported mutation/native
routes do not exist. Return public metadata, never installation paths or a way
to resolve bundled assets through native-file endpoints.

Keep the ordinary chats endpoint and backup project selector unchanged. Use a
discriminated active selection (`project` or `example`) and source-qualified
reading-position keys. Example identifiers must not overlap the accepted
ordinary project-ID namespace; tests verify forged ordinary routes cannot reach
originals. Shared timeline presentation accepts explicit read-only capabilities,
not a fake ordinary project whose safety depends on the current UI.
In particular, `AttachmentList` currently defaults absent capabilities to
available; originals must pass an explicit read-only policy. Audit focus refresh
(currently `api.getChat(activeId)`), stale-response generations, mutation
callbacks, Home/settings return, import completion, and copy completion for the
new selection type. Catalog loading/errors stay independent of user-project
loading; failure to load examples must not block ordinary work. Show a small
inline retry state within Examples, without pretending it is an empty catalog.

On update, the installed release supplies the whole catalog. No startup seed,
merge, deletion, or per-story data migration occurs. Refresh catalog state on
reload; a stale already-open page gets revision-conflict recovery on copy.
Keep stable IDs for retained messages; key reading anchors by example revision
so changed stories reopen at their beginning. Updates do not create sidebar
entries for prior revisions. An app rollback restores its bundled examples,
subject to existing database compatibility rules for user projects.

### Creating an editable copy

1. Validate slug/revision against the installed catalog under the existing
   maintenance gate, excluding restore/export interference.
2. Allocate fresh project/note/attachment IDs and a bounded unique title:
   `Weekend trip (copy)`, then `(copy 2)`, etc. Read collision state and commit
   synchronously within the guarded operation. Keep ordinary title limits.
3. Publish independent attachment bytes through `ManagedAttachmentStore`,
   then insert all records/labels/settings in one transaction. Reuse the import
   insertion primitive or narrowly extract its common record writer; preserve
   import behavior and tests. Do not call public import routes.
4. Set project creation time to the copy time, pin/archive null, preserve message timestamps, and calculate activity
   from copied messages using existing invariants. Explicitly expand Projects
   and select the returned complete ordinary `ChatDetail`; do not depend on its
   historical activity placing it at the top of the rail.
5. Mark commit before response preparation. Before-commit failure cleans only
   newly published files; no existing or committed file is removed. A process
   crash may leave unreferenced files, matching current attachment semantics.

The copy action reads the live database connection at invocation, including after
backup replacement; it must not capture a closed startup handle. Apply existing
Host/Origin/body-size/error conventions and a small rate limit (three copy
requests per minute per process). Disable copy/navigation conflicts while pending
using existing mutation patterns. A deliberate later copy is allowed.

No persistent idempotency table is proposed. A lost HTTP response can therefore
mean a completed copy: tell the user to check Projects before trying again and
offer a list refresh, never silently retry. A received successful response updates
canonical state directly; a subsequent refresh failure must not imply rollback.

## Data and migration impact

- No schema or backup-format version change; no SQL migrations or seeded rows.
- Originals and source files belong to the installed application. Copies use
  existing SQLite tables and managed attachment storage, with ordinary backup,
  deletion, migration, and recovery semantics.
- `on-track-show-examples` stores a validated browser-local boolean, following
  the theme preference precedent. It is not backed up or shared across browsers,
  origins/ports, or devices. Clearing browser storage restores the default on.
- Backup replacement changes user projects only. Originals remain supplied by
  the application and the browser preference remains intact.
- New features may need their own schema migrations. A story revision does not.
  No copies retain a live update link to the catalog.

## Phases

1. **Catalog and protected reading.** Add validated example contracts, the
   story, payloads, list/detail routes, and source-separated selection. Extend
   the real rail/timeline with the notice and inactive actions. Files: proposed
   domain/server examples modules; `src/server/app.ts`; `src/client/api.ts`,
   `App.tsx`, `styles.css`; focused tests. Outcome: originals can be explored
   offline without DB/file writes. Evidence: catalog/API/component tests for
   read-only behavior, forged mutations, filter/scroll behavior, and failures.
2. **Independent copy.** Add guarded copy service/route and explicit DB record
   insertion reuse. Files: examples service/routes; `db/project-import.ts` only
   if extraction is needed; attachment and import tests; API/client wiring.
   Outcome: a complete editable project with independent files. Evidence: real
   SQLite integration tests, rollback injection, restart, repeated-copy and
   stale-revision tests, plus a copy-after-database-replacement regression.
3. **General settings.** Add `src/client/preferences.ts` and focused General
   settings UI (extract a small component if useful), update SettingsRail and
   App selection logic. Outcome: default-on visibility persists safely and
   hides/shows the whole group without affecting copies. Evidence: storage,
   settings, two-tab, focus, and navigation component/browser tests.
4. **Complete journey and release lifecycle.** Add `e2e/examples.spec.ts`,
   backup/import integration coverage, and production packaging smoke coverage
   in managed release tests where needed. Outcome: the story works from a
   built distribution; release catalog replacement leaves user copies intact.
   Evidence: desktop/mobile journey, old/new catalog fixture test, copy export/
   restore, no unintended outbound requests, and built-runtime attachment copy.
5. **Review and delivery.** Use reviewer, security-review, and verification-loop;
   review source separation, file lifecycle, restored DB handles, stale reads,
   focus, and backup boundaries. Update PROJECT/ARCHITECTURE/CHANGELOG with
   implemented truth and add an ADR for application-owned examples. Outcome:
   reviewed slice with verification evidence and explicit remaining limits.

Use TDD for behavior changes. Each phase is an implementation increment within
the complete approved slice; intermediate disabled/unwired actions are not a
finished release. No dependency installation or production edit before approval.

## Test plan

- Unit: catalog validity/limits/IDs/feature coverage, revisions, title collision
  allocation, preference defaults and malformed/blocked storage.
- API/integration: no writes on reads, unknown/stale request rejection,
  originals unreachable via mutation/native endpoints, rate limits, maintenance
  exclusion, independent IDs/bytes, transaction failure and cleanup, successful
  copy after DB replacement, post-commit response failure, and persistence.
- Component: default group/order/disclosure, no example Attention/pin actions,
  keyboard and touch explanations, inactive composer/shortcuts/drop handling,
  active copy/filter/expand/text-copy actions, session reading position,
  pending/error/success states, settings persistence and selected-example hiding.
- Browser: first-run explore → copy → edit message/file → restart → backup and
  restore; hide → reload → show; two copies share no mutable data; source
  updates leave edited copies unchanged. Native action tests use the existing
  fake adapter. Physical OS native dispatch limits remain separately reported.
- Render at 1440px and 390px, plus an intermediate width around 960px; inspect
  all three themes, 200% zoom, forced colors, reduced motion, long labels,
  keyboard focus, and screen-reader announcements. Ensure the read-only notice
  does not obscure content and inactive controls remain understandable.
- Commands during implementation: focused `npm test -- <affected test files>`;
  `npm run test:migrations` (unchanged-schema regression);
  `npm run test:e2e -- --grep examples`; then `npm run verify` and
  `git diff --check`. Extend relevant packaging tests within their existing
  suite; do not claim clean-machine/native OS validation from mocks.

## Risks and mitigations

| Risk                                                           | Mitigation                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A disabled-looking original still mutates through another path | Separate server resources and selection types; exhaustive action and forged-request tests |
| Existing backup/import/nav behavior regresses during UI reuse  | Keep user chats separate; narrow presentation capabilities; regression coverage           |
| Native Open/Show exposes bundled installation files            | No native/catalog asset endpoint; only fresh managed copies gain native capabilities      |
| Partial copy or lost response creates uncertainty              | Transactional records, scoped compensation, explicit commit state, no automatic retry     |
| Source fixtures leak into user backup selections               | Catalog remains outside DB and ordinary chats list                                        |
| New features leave stories incomplete                          | Release-reviewed capability map and content revision updates                              |
| Historical dates fail to demonstrate future behavior           | Clearly named scheduling exercise in copies; no simulated clock                           |
| Preference expected to follow the database                     | Document browser-local scope, consistent with Appearance                                  |
| Story controls overwhelm the introduction                      | Short authentic narratives, compact persistent explanation, one copy CTA                  |
| Stale service uses closed DB after restore                     | Resolve current database/service through provider; test replacement then copy             |

## Open decisions

Approved defaults: Examples follows Archive; General is the initial Settings section;
visibility is browser-local; the story is Weekend trip;
original dates are fixed; detailed story and feature-coverage refinement is deferred.
The initial copy/asset scope needs no new schema or dependencies. If later
requirements demand app-wide preference persistence, exactly-once copy retries,
or interactive future dates in originals, revise this plan before adding them.

## Approval request

The user approved **Built-in Examples, Phases 1–5** on 2026-09-16, with one
simple trip story and later content refinement. No additional approval is
required for the implementation and verification described here.

At planning time, validation was limited to source and primary-reference review.
Implementation evidence follows.

## Implementation and verification evidence

- Implemented one six-message Weekend trip story with one small packing-list
  attachment; content refinement and exhaustive feature coverage remain deferred
  at the user's request. Originals stay outside SQLite, imports, and exports.
- Added source-separated example selection and server endpoints, shared read-only
  timeline controls, independent editable copies, General settings, browser-local
  visibility, and focus/reading-position handling. Copy responses return the
  committed ID even if preparing detail fails; no POST is automatically retried.
- Existing user-project state remains canonical and separate from example state.
  `ExampleDetail.kind` and a pending-selection discriminator identify example
  operations; no fake example records enter the user-project collection. An
  explicit capability context blocks edit/label/native controls and composition.
- No dependency, schema, backup-format, or user-runtime-data change was needed.
  Source modules compile into the normal distribution; managed smoke exercises
  the built app through startup, persistence, and update/recovery paths.
- TDD: example API tests first failed on missing 404 endpoints; General UI test
  failed on missing Examples. Review-driven tests reproduced rate-limit 500,
  delayed selection overriding Settings, and cross-tab filter reset before fixes.
  The same focused targets passed after implementation. Additional tests cover
  transaction/file rollback, original native-route rejection, strict/stale input,
  committed-copy refresh failure, catalog revision independence, and storage errors.
- `npm run verify`: PASS, exit 0. Release contract, build, typecheck, lint,
  formatting, 808 unit/component/API/integration tests (1 existing skip), 22
  migration tests, and 41 browser tests (5 existing skips) pass. Both managed
  smoke modes pass, including successful update and failed-candidate recovery.
- Coverage: 90.04% statements, 84.43% branches, 91.97% functions, 91.22% lines.
  Example service has 100% line and 80% branch coverage; example routes have
  92.59% line and 85.71% branch coverage. Browser preference helpers have 100%
  line coverage.
- Reviewer/security review found and verified fixes for committed-copy reporting,
  rate-limit status, selection races, unrelated-filter resets, and focus loss.
  Final review found no additional actionable issue. Full diff and
  `git diff --check` reviewed; no commits, pushes, or remote mutations performed.
- Visual evidence inspected at desktop 1440px, intermediate 960px, mobile WebKit
  390px, all three themes, forced colors, and 200% CSS zoom. Zoom inspection
  exposed a cramped file card; container-based spacing/wrapping fixed it and a
  browser assertion now checks filename width. Keyboard focus after copying and
  mobile Back is tested. A physical screen reader and native browser zoom were
  not separately exercised.
- Residual limits: native file dispatch uses the existing fake E2E adapter;
  physical Windows/Linux/macOS dispatch is not newly certified. The audit passes
  its high-severity gate while reporting the existing moderate Fastify advisory.
  Copy response loss remains ambiguous; precommit process interruption may leave
  unreferenced new files, matching existing managed-attachment semantics.

## Composer refinement

The user requested the copy action in the existing header action position, the
notice inside the composer, identical ordinary composer controls made inactive,
and visible feedback for blocked interactions. Implemented through one shared
composer, an inactive fieldset, pointer routing, and an 800 ms retriggerable glow.
The distinct example composer and extra top row were removed. No backend change.

TDD: the new component test first failed because the header lacked the copy
button; it now verifies shared controls and glow duration/retriggering. All 89
workspace component tests pass. Desktop Chromium and mobile WebKit verify real
pointer/touch hits on disabled input/Add, keyboard activation of blocked
edit/delete/label/file actions, glow persistence beyond 500 ms, and screenshots
at desktop/mobile/200% CSS zoom. Review found no additional actionable issue.

Refinement verification: release contract, build, typecheck, and lint pass.
`npm run verify` stopped at formatting in five unrelated untracked
`branding/threadstr/explorations/prompts*.md` files, which were left untouched;
formatting checks for the changed feature files and `git diff --check` pass.
The remaining suites ran separately: `npm run test:coverage` passes 809 tests
(1 existing skip), `npm run test:migrations` passes 22, and `npm run test:e2e`
passes 41 (5 existing skips). Coverage is 89.98% statements, 84.25% branches,
92% functions, and 91.16% lines. A mobile composer test initially sampled its
height before resizing; it now waits for eight lines to fit before comparing the
nine-line capped height. `npm run security:check` passes its high-severity gate
with the existing moderate Fastify advisory. The managed lifecycle smoke passes.
`npm run test:managed-update` also passes successful activation, failed-candidate
recovery, attachments, and postcommit restart checks.

## Amsterdam story refinement — 2026-09-16

The user approved replacing the simple Weekend trip content with one natural
**🇳🇱 Trip to Amsterdam** notebook, without tutorial messages or reader exercises.
The existing slug is preserved and content revision advances to 3; existing user
copies remain independent. The story uses Pin, Attention, Todo, and Risk only,
with Todo and Risk enabled as optional labels. Three embedded text files cover
multiple attachments and an attachment-only attributed message. File prose
describes opening the same managed attachment in the usual editor and saving in
place. Native actions still require an editable project, as the read-only UI states.

Fixed authored dates place departure on 16 December 2026 (three months after
authoring), a predeparture check two days earlier, and a return-trip idea on
16 September 2029 (three years after authoring). Review these dates in subsequent
releases; reads never slide timestamps, and copies retain their original dates.
Feature coverage and deliberate omissions are recorded beside the catalog.
No schema, dependencies, or original/copy ownership changes are introduced.

Refinement verification: `npm run build`, `npm run typecheck`, `npm run lint`,
`npm run format:check`, and `npm run release:check` pass. Updated example/API/UI
checks first failed on the old title/revision, then passed (101 tests).
`npm run test:coverage` passes 830 tests (7 skips), with 90.03% statements and
84.11% branches. The multi-file fixture exposed an unordered single-row lookup
in a rollback test; it now selects the packing file explicitly and verifies
cleanup of all published files. `npx playwright test e2e/examples.spec.ts
e2e/branding.spec.ts` passes 11 tests (1 skip), including real long-message
expansion, future divider, Links/Files filters, independent file editing,
backup/restore, and desktop/mobile screenshots. Screenshots were inspected.
Browser and socket-based tests required execution outside the filesystem sandbox.
`npm run security:check` passes its high-severity gate with the existing moderate
Fastify advisory. Scoped reviewer and diff checks found no actionable defects.
The full release aggregate and managed installation smoke were not rerun for
this content-only change; native file dispatch uses the existing fake adapter.
