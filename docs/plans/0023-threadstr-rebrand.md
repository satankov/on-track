# threadstr next-release rebrand implementation plan

Status: Phases 1–5 approved and implemented; local verification completed
2026-09-16. Native/platform and publication gates remain below. Prepared against
`2d3b180` on `release/v0.0.9`. The branch name does not select a release version.
The original preparation changed only planning documents.

## Goal

Introduce **threadstr** and the primary **thr** command in the next release,
preserving existing installations, data, settings, backups, process exclusion,
and historical records. Implement Phases 1–5 as one coherent release slice.

## Context and reusable precedent

- The working tree was clean at audit start. Package and lockfile version are
  `0.0.8`. HEAD includes the completed Examples work (`90e1df5`) and branding
  handoff (`2d3b180`); preserve both, including unrelated follow-ups.
- The live GitHub latest-release API returned **v0.0.8**, published
  **2026-09-16 08:12:36 UTC**, neither draft nor prerelease. Local tag resolves
  to `60e0ddcdefcb1b9f882024875dd97bb1adbdc79d`. Its six assets are `INSTALL.md`,
  `install.sh`, `install.ps1`, `managed-bootstrap.mjs`, `managed-release.json`,
  and `on-track-v0.0.8.zip`. [Published baseline](https://github.com/satankov/on-track/releases/tag/v0.0.8).
- The published source ZIP's API SHA-256 is
  `6c1dacd664f892612d9e9ad27cc83a3f952d3f41d2857975b69472038a61cdd0`;
  manifest SHA-256 is
  `fa8010b2facf17373045392f1ea2780dc306d623512a19566d9a6a8692a1033a`.
  Revalidate downloaded baseline artifacts before use.
- PROJECT/ARCHITECTURE still call v0.0.7 current and its fixes unpublished.
  Correct these current-state statements during implementation; keep dated
  investigation records and historical outcomes intact.
- Read PROJECT, ARCHITECTURE, ADRs 0001/0003/0006/0007/0008/0009, active
  plans 0021/0022, release guidance, relevant source/tests, and branding usage.
  The optional private CONTEXT file was absent. Explorer and planner audits
  supplemented the repository trace.
- Reuse `platform.ts` launcher generation, `active.json` selection, private
  filesystem helpers, authenticated control, update journaling/checkpoints,
  current UI tokens, and the approved asset kit. No new dependency, installer
  framework, package registration, schema, or migration is needed.
- External checks: [GitHub release API](https://docs.github.com/en/rest/releases/releases)
  for published baseline metadata; [npm package metadata](https://docs.npmjs.com/files/package.json/)
  for retaining `private: true`. This is local package naming, not npm publication.

## Repository audit and classifications

The initial case-insensitive `on[ _-]?track` scan covers the requested spellings
and `OnTrack`. It found **811 matching lines in 138 tracked files**, among 289
tracked/nonignored files. No tracked filename contains an old-name variant.
See [the per-file inventory](0023-threadstr-name-audit.md). Matches within a
file may have different dispositions; no blanket replacement is permitted.

Hidden tracked configuration was included. A separate ignored/local scan found
the historical `docs/releases/v0.0.7.md` runbook and the personal IDE filename
`.idea/on_track.iml` with its `modules.xml` reference. Preserve these. The
checkout's own `on_track` path is not product branding to rename.
Generated `dist`, coverage, test reports, dependencies and Git internals are
not editable source; rebuild generated output, never rewrite Git objects or
vendor files. Local agent configuration and private context are not release
artifacts and must not be copied into tracked audit evidence.

| Class                     | Disposition and representative surfaces                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current branding          | Rename UI/copy, title, accessible backup labels, runtime/CLI messages, current comments/test descriptions, private package name, installer progress/help, current docs, generated INSTALL and future release titles.                                                            |
| Historical material       | Preserve past changelog sections, dated release runbooks, ADR/plan rationale and evidence, old-release examples, Markdown design-concept SVGs and logo exploration provenance. Add concise superseding notes where readers might otherwise follow old current guidance.         |
| Compatibility identifiers | Keep real repository URLs, data/runtime paths, environment and helper protocols, backup format, locks/journals, browser keys, archive names, manifest protocol and profile markers. Keep tests asserting these exact contracts. Explain them in current compatibility guidance. |

Temporary fixture prefixes, fake object URLs, nonpersistent local variable names,
current test descriptions and downloaded installer _local_ filenames are current
development naming: update where appropriate. Real URLs and version-specific
negative fixtures stay valid. Do not alter user-created project text or existing
copies of Examples to remove old words.

## Acceptance criteria

1. Current product surfaces say lowercase `threadstr`; instructions and CLI help
   lead with `thr`. Remaining old names have a documented historical or
   compatibility reason, including intentional old-client diagnostics.
2. Approved wordmark geometry and archive bytes are preserved. UI uses local
   supplied assets with correct themes, accessible naming, responsive layout,
   keyboard Home navigation, visible focus and no new network dependency.
3. All existing commands and options retain behavior under both launchers,
   including exit codes, argument forwarding, quoting and internal commands.
4. Clean setup installs `thr`/`thr.cmd` plus `ontrack`/`ontrack.cmd`; both resolve
   the same active release, private runtime, recorded data directory and port.
5. Untouched v0.0.8 `ontrack update` can activate the candidate and produce a
   usable `thr` launcher. Rerunning the candidate installer in the same root is
   also a supported upgrade path. Test running and stopped installations.
6. Existing data, attachment identities/bytes, browser settings at the same
   origin, backups, runtime discovery and ownership locks survive. Neither a
   second default data directory nor concurrent old/new writers are introduced.
7. An unrelated `thr` is neither executed, overwritten, nor silently shadowed.
   Collision stops setup/update safely with actionable guidance. Repeat setup,
   repeated activation, interruption, rollback and retry remain safe.
8. Published content and shipped migrations are unchanged; no next version is
   selected, no remote name/URL is invented, and unrelated work is preserved.
9. Relevant tests, full verification, security review and independent reviewer
   review pass, with native-platform/online evidence limits explicitly reported.

## Non-goals and historical exclusions

No redesign, logo regeneration, feature cleanup, dependency upgrade, data-path
migration, backup-format change, runtime protocol bump, npm CLI publication,
remote repository rename, or version bump. No Git staging, commits, tags,
pushes, PRs, workflow dispatch, release publication or remote mutations.

Keep all published changelog entries byte-for-byte. Keep historical ADR/plan
statements and visual concepts; append superseding notes rather than rewriting
their original decisions. Preserve `branding/threadstr/v1/` asset bytes,
manifest, sources and `explorations/`. Handoff prose can receive a separate
integration note without erasing its original scope/provenance.

## Proposed design

### Product and visual identity

Integrate the supplied light/dark SVG wordmarks in `App.tsx` and the compact
approved mark as the browser icon. Copy required files byte-for-byte into a
small `public/branding/` directory so they enter the existing runtime build
fingerprint and offline distribution. Verify copies against the v1 manifest.

Design brief: support frequent private project reading/writing with the current
quiet, compact workspace; the ribbon wordmark supplies identity. Preserve
typography, semantic colors, layout, controls and motion. Use the full wordmark
at 192 CSS pixels where practical, retaining clear space and aspect ratio.
Select ink/white assets for Light/Neutral/Dark surfaces; provide a readable
forced-colors fallback. Preserve the link's accessible `Home` destination and
give standalone logos the name `threadstr`. Do not duplicate announcements.

Change backup download display prefixes to `threadstr-YYYY-MM-DD`, on both
client and server, retaining `.on-track-backup`. Update built-in story copy and
advance its content revision while preserving slugs/message IDs; user copies
remain untouched. Set only local package/lockfile root names to `threadstr`,
retaining `private: true`, versions and dependency graph.

### Complete command inventory and alias policy

| Existing entry point                  | Preserved contract                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `run [--no-open]`                     | Start/reuse recorded background instance and optionally open browser.                                                         |
| `stop`                                | Authenticated graceful shutdown; no force kill.                                                                               |
| `status`                              | Recorded install/version and authenticated instance state.                                                                    |
| `logs`                                | Existing bounded diagnostics behavior.                                                                                        |
| `update [vX.Y.Z] [--yes] [--no-open]` | Latest/exact published compatible update, confirmation and recovery.                                                          |
| `install`                             | Preserve `--release-dir`, `--runtime-dir`, `--manifest`, `--data-dir`, `--port`, `--adopt-from`, `--no-profile`, `--no-open`. |
| `maintenance-recover-import`          | Existing internal recovery contract.                                                                                          |
| no arguments, `help`, `--help`        | Help output.                                                                                                                  |
| `--version`                           | Preserve current status-like output/installed-root requirement; no unrelated CLI fix.                                         |
| `--describe-runtime`                  | Read-only machine-readable build description.                                                                                 |

All currently accepted entry points retain `--root`; preserve rejection of
unknown/duplicate/invalid options. OS bootstrap flags also remain unchanged.

`thr` is primary immediately in the next release. Install and retain `ontrack`
as a fully supported compatibility alias throughout the 0.x line and until a
separately approved removal. No removal date/version is implied. Any future
removal needs notice in at least two published releases and its own migration
review. Document the alias in help and upgrade guidance; do not add per-command
warnings that would alter machine-readable output or scripts.

### Launcher ownership and collisions

Extract a small shared launcher generator/provisioner rather than a new launcher
framework. Verify ownership via known generated content plus canonical root and
dispatcher/interpreter identity, not merely a matching filename or comment.
Use existing private-directory and no-follow helpers, exclusive file creation,
bounded reads, correct permissions and idempotent recovery. Reject symlinks,
dangling links, hard links, directories and unrecognized existing target bytes.

Inspect target files and PATH entries without executing discovered commands.
Include Windows case folding, PATHEXT and effective user/system PATH; test
PowerShell and cmd resolution. The runtime bin may already precede an unrelated
command, so skipping a PATH edit alone is insufficient. Do not source user
profiles merely to inspect shell aliases/functions; document this inspection
limit and show the absolute managed command path.

For an unrelated target or PATH `thr`, fail before new installation selection or
update commit and before profile changes. Report the conflict and instructions
to resolve it explicitly and retry; existing `ontrack` remains usable. Do not
delete/rename the conflicting program or create a second installation/data root.
`--no-profile` must not bypass an existing shadowing conflict. Installer preflight
runs early; activation repeats the check to catch changes since preflight.

### Bridge from the published updater

v0.0.8 fixes v0.0.7's HTTP 415 bug, but `updateFromRelease` calls
`activatePrepared` without installing launchers. Merely renaming the new
installer is insufficient.

Add a narrow, additive provision step in the candidate's authenticated
`startManagedControl` activation branch, after selection/runtime/build/journal
identity checks and before `store.commit()` / `gate.resume()`. The unmodified
old updater already invokes this candidate handler. Create `thr` using the
existing retained `shim-runtime.json` interpreter and `bin/command.mjs`.
Preserve the existing `ontrack`, dispatcher, shim metadata and profile bytes.
Do not call the broad current `installCommand` or mutate `--describe-runtime`.

Manual adoption needs separate ordering: `installPrepared --adopt-from` currently
activates before `installCommand`, so a fresh adopted runtime root has no
dispatcher or shim metadata. After safe preflight, prepare and validate the
owned dispatcher/interpreter state for new or adopted roots before activation.
Only existing managed roots use the preserve-existing-bytes bridge. Test adoption
of v0.0.8 manual data into an empty runtime root without changing the data path.

The new launcher reads `active.json`, never a candidate-specific path. If failure
causes rollback, any safely created launcher follows the restored old selection.
Repeated precommit activation recognizes owned bytes. An already-committed
activation retry must acknowledge the committed state without rerunning launcher
preflight or writes: a later collision must not turn acknowledgment recovery
into a failure or roll back accepted writes. Provision failure before commit
uses existing recovery; after commit, lost acknowledgment must preserve later
writes and report/recover the committed state. New installs use the same narrow
primitive to create both commands. Same-version installer reruns repair missing
owned launchers safely. No new journal field may break old strict readers.

The old process may print its own `On Track updated` message during this one
transition; published code cannot be retroactively rebranded. Document that
exception. The next `thr` or alias invocation uses new branding.

### Compatibility decisions and data impact

| Identifier family   | Decision                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data defaults       | Keep macOS `~/Library/Application Support/On Track`, Windows `%APPDATA%/On Track`, Linux XDG/`~/.local/share/on-track`.                                                                                                                                         |
| Runtime defaults    | Keep `On Track Runtime` / `on-track-runtime`, including custom-root discovery and saved paths.                                                                                                                                                                  |
| Environment         | Keep `ON_TRACK_DATA_DIR`, `ON_TRACK_PORT`, `ON_TRACK_INSTALL_ROOT`, `ON_TRACK_MANAGED_LAUNCH`, `ON_TRACK_NATIVE_FILE`, `ON_TRACK_PRIVATE_DIRECTORY`, `ONTRACK_BOOTSTRAP_*`, template tokens and archive-helper protocol. No new variable aliases in this slice. |
| Database/ownership  | Keep `on-track.sqlite`, SQLite sidecars, `.on-track-owner.sqlite`, `.on-track-install-owner.sqlite`, `.on-track-instance.json`, update/restore journals, checkpoint/staging names and control endpoint conventions.                                             |
| Managed state       | Keep `install.json`, `active.json`, `shim-runtime.json`, `last-update.json`, protocol shapes, runtime retention and authenticated control identities.                                                                                                           |
| Backups             | Keep extension, MIME `application/vnd.on-track.backup+sqlite`, application ID `0x4f545242`, `_on_track_bundle*` tables, format 1/schema 7 and supported legacy descriptors. Only display filename prefix changes.                                               |
| Browser persistence | Keep `on-track-theme` in both initializer/client and `on-track-show-examples`; keep port/origin. No setting migration.                                                                                                                                          |
| Shell profiles      | Keep old marker delimiters as compatibility anchors; update current error wording, never duplicate profile blocks.                                                                                                                                              |
| Delivery            | Keep `satankov/on-track`, real URLs, `on-track-vX.Y.Z.zip`, installer/bootstrap/manifest filenames, strict protocol 1, source hashes/inventory and existing managed floor `0.0.7`. Rebrand future release title and INSTALL prose.                              |
| Data protection     | Preserve `.gitignore`, release source exclusions and tests for all old backup/database/runtime patterns. Add protection for any new generated sensitive namespace if introduced.                                                                                |

No data migration, backfill, SQL/schema change, identifier rewrite or cleanup of
existing user files. Document the retained strings in a focused new
`docs/compatibility.md` and link it from installation and architecture guidance.

## Phases and affected surfaces

1. **Lock compatibility in tests.** Add failing launcher/alias, collision,
   baseline-upgrade and brand assertions. Files: CLI `platform`, `arguments`,
   `main`, `install`, `distribution`, `update` tests; runtime managed-control
   tests; new `scripts/managed-upgrade-compat.mjs` and harness tests. Record
   immutable baseline inputs. Evidence: failures demonstrate missing `thr`
   and old-client upgrade gaps, not just changed string snapshots.
2. **Implement CLI transition.** Modify those CLI modules as needed and
   `runtime/managed-server.ts`; update current messages in process/lifecycle,
   runtime/control/private-directory/ownership, local-server, runtime-support,
   database/attachment/backup errors. Keep protocols fixed. Evidence: command
   parity, real launcher execution, collisions, rollback and repeatability tests.
3. **Integrate identity.** `index.html`, `src/client/App.tsx`, `styles.css`,
   `BackupSettingsWorkspace.tsx`, `src/server/examples/catalog.ts`, transfer
   `routes.ts`, new public assets, package/lock metadata, corresponding
   component/API/E2E assertions. Evidence: browser title/logo/Home/backup/example
   journeys, theme/zoom/mobile rendering, old settings and backup regression.
4. **Update delivery and current guidance.** README, CONTRIBUTING, SECURITY,
   PROJECT, ARCHITECTURE, RELEASING, all OS install guides, CHANGELOG introduction
   and Unreleased only, issue template, release/managed workflows, bootstrap and
   install scripts, managed-release/runtime-verification scripts and tests.
   Add compatibility guide and a superseding ADR; add focused status notes to
   relevant old plans/ADRs/branding handoff. Evidence: generated INSTALL, manifest
   accepted by v0.0.8, both installer platforms, honest prepublication guidance.
   Existing examples that assume an unpublished v0.0.9 must become clearly
   parameterized next-release examples, without inventing live URLs.
5. **Review, verify and residual audit.** Use TDD throughout, then security-review,
   independent reviewer and verification-loop. Extend managed OS matrix to the
   baseline harness. Reclassify every remaining old-name match and inspect
   filename/hidden-config results. Report changes, exact pass/fail/skip results,
   coverage, historical/compatibility exclusions and unavailable platform proof.

## Test plan and exact verification commands

Use only disposable homes, runtime/data directories and ports. Never discover,
start, upgrade or rewrite the user's real managed installation during testing.

New baseline harness: obtain checksum-verified v0.0.8 sources/assets and build
its unchanged locked code. Run the actual installed old `ontrack` launcher,
not today's CLI with an old version string. A controlled test transport may
supply candidate metadata/assets at the fixed publisher boundary; preserve old
parser, hashes, source inventory, build, activation and recovery behavior.
Document transport substitution explicitly: this is not a published-to-published
network test. Also exercise candidate installer upgrade into the same root.

Seed project/message/labels/archive/attachments; export a baseline backup and
seed browser preferences. Verify IDs, bytes, schema, canonical paths, saved port,
settings and backups after upgrade/restart. Test both shims, manual/managed and
old/new ownership conflicts on different ports, custom roots containing spaces
and Unicode, absent/duplicate/stale launchers, collision files/symlinks/PATH,
running/stopped app, fresh-root manual adoption, cancellation, lost acknowledgment and interruption around
launcher creation and journal commit. Restore a real baseline backup and retain
existing legacy-backup validation guarantees. Test future candidate updates via
both aliases without raising the compatibility floor.

Focused commands (new harness/brand test files are deliverables of this plan):

```sh
npm test -- src/server/cli src/server/runtime scripts/install-shell.test.ts scripts/managed-bootstrap.test.ts scripts/managed-release.test.ts scripts/release-contract.test.ts
npm test -- src/client src/server/examples src/server/database-transfer src/server/data-directory.test.ts src/server/db/database.test.ts src/server/runtime-support.test.ts src/server/local-server.test.ts
npm run test:managed-install
npm run test:managed-update
npm run build
node scripts/managed-upgrade-compat.mjs --baseline v0.0.8
npx playwright test e2e/branding.spec.ts e2e/project-chat.spec.ts e2e/database-transfer.spec.ts e2e/examples.spec.ts
CI=true npm run verify
git diff --check
git diff --exit-code 2d3b180 -- drizzle branding/threadstr/v1 branding/threadstr/explorations
```

`npm run verify` runs release contract, build, typecheck, lint, formatting,
coverage (80% thresholds), migrations, all E2E, production audit, and managed
lifecycle/update smokes. Add the new baseline gate to the managed workflow.
Run the preserved manual Node matrix (22.16/macOS+Linux, 24/macOS+Linux+Windows)
and managed Node 24 matrix (macOS arm64/x64, Linux x64, Windows x64) when hosts
are available; never claim local mocks establish other OS execution.

Render 1440, 960 and 390 pixel widths, Light/Neutral/Dark, 200% zoom and forced
colors; exercise keyboard Home/Settings/backup labels and reduced motion.
Verify asset hashes and bundled offline loading.

Keep production packaging's clean-commit requirement. This task cannot run a
final candidate `release:managed` on an uncommitted working tree. Use its tested
pure manifest/inventory functions and disposable working-source fixtures to
verify compatibility, without weakening the release gate or creating a commit.
Synthetic versions in fixtures are explicitly test-only, never the next version.
Final selected-version/tag packaging and a live published upgrade remain release
gates after separate version/commit/publication authorization.

Residual commands, with each match reviewed rather than globally suppressed:

```sh
rg -n --hidden -i 'on[ _-]?track' -g '!.git/**' -g '!node_modules/**' -g '!dist/**' -g '!coverage/**' -g '!playwright-report/**' -g '!test-results/**'
rg --files --hidden --no-ignore -g '!.git' -g '!node_modules' -g '!dist' -g '!coverage' -g '!playwright-report' -g '!test-results' | rg -i 'on[ _-]?track'
git status --short --ignored
```

Use a separate local ignored-config scan without copying private contents into
tracked output. Compare the released CHANGELOG suffix with HEAD before changes;
all published sections must remain identical. Generated artifacts are rebuilt,
not edited. Report unexpected old branding as unfinished work, not an exception.

## Risks and mitigations

- Old updater rejects renamed archive/protocol: retain exact distribution
  contract and execute unchanged v0.0.8 upgrade code.
- Upgrade succeeds but `thr` is absent: provision inside authenticated candidate
  activation; test actual launchers and interruption ordering.
- Collision shadows another application: inspect both destination and effective
  PATH, fail before commit, retain old app and provide conflict guidance.
- New lock/path creates an empty workspace or duplicate writers: retain every
  ownership/data identity and test mixed-generation startup exclusion.
- Changing backup display name accidentally changes format: assert MIME,
  extension, application ID, tables and schema remain fixed.
- Branding assets enlarge source package: inventory total/individual sizes
  against existing limits; preserve archive rather than deleting exploration work.
- Existing formatting/advisory/native-platform debt blocks a gate: report exact
  evidence and scope; do not silently reformat the archive or upgrade dependencies.
- Current README commands target a still-old latest release before publication:
  explicitly state the next-release boundary and link the v0.0.8 installation
  guide for the currently published version until publication.

## Open decisions

Approval adopts the proposed indefinite-with-review alias policy, unchanged
legacy storage/environment/backup/distribution identifiers, and fail-safe
collision policy. A new public variable namespace or relocated data store is a
separate migration proposal. Next release number remains deliberately unset.

## Approval request

The user approved **threadstr next-release rebrand, Phases 1–5** on 2026-09-16.
Approval covers local implementation and verification, not Git publication
operations or remote changes.

## Implementation and review evidence

Phases 1–5 are implemented and locally verified. `launchers.ts` shares the existing dispatcher between
both commands, validates ownership/collisions, and publishes complete launchers
with no-clobber hard-link publication and interrupted-publication recovery.
Authenticated candidate activation provisions the primary command before commit;
committed acknowledgment retries preserve later writes. Fresh/manual-adoption
roots prepare their dispatcher before activation. No persisted identity migrates.

The current UI, diagnostics, examples, package names, installer/release prose,
workflow titles and current guidance use threadstr/thr. Approved assets are
copied byte-for-byte; built-in example revision changes without changing IDs.
Historical records receive additive superseding notes only.

Review used the security-review and verification-loop skills, independent
launcher review, and a separate baseline-harness/transport review. Identified
issues were corrected and covered: interrupted partial writes, destination
Windows suffix conflicts outside PATH, execute-permission repair, publication
EEXIST/disappearance races, malformed saved shim metadata, and Windows Unicode
registered-PATH serialization. The final independent reviews found no remaining
blocker. Native Windows regression execution remains pending.

The new baseline harness downloads checksum-pinned published v0.0.8 source and
manifest plus official Node 24.14.0, builds unchanged locked source, and invokes
its actual old dispatcher and launcher. A disposable HTTPS publisher fixture
supplies a test-only candidate version (`99.0.0`); production URLs, strict
manifest/parser, checksums and updater behavior remain unchanged. Running/exact
and stopped/latest upgrades exercise collision rollback/retry, stable IDs/data/
attachment bytes, genuine baseline backup restoration, postcommit writes,
installer rerun, aliases and restart. The old manual server cannot acquire the
renamed server's data owner lock. Browser storage compatibility is verified by
component/E2E tests separately.

Detailed file inventory and residual classifications are in the
[naming audit closeout](0023-threadstr-name-audit.md#residual-audit-after-implementation).

## Final verification report — 2026-09-16

- **PASS:** `node scripts/managed-upgrade-compat.mjs --baseline v0.0.8 --cache /tmp/threadstr-baseline-cache`
  exited 0 on macOS arm64 using official private Node 24.14.0. All three routes
  passed: running exact-version update with collision rollback/retry, stopped
  latest-version update, and direct v0.0.8-to-candidate prepared-installer upgrade.
  Each verified unchanged legacy launcher/dispatcher/shim/install bytes, both
  command names, saved data path/port, domain IDs and attachment bytes, genuine
  old backup restore, postcommit writes, installer rerun, restart persistence and
  exclusion of an old manual writer. Authenticated disposable-instance cleanup
  completed. The optional cache only avoids downloading the pinned artifacts
  again. This is controlled transport evidence, not a live published upgrade.
  A fixture-only millisecond timestamp rounding failure was resolved by seeding
  whole-second attachment mtimes; exact preservation assertions remain intact.
- **PASS after final harness-only addition:** `npm test -- scripts/managed-upgrade-transport.test.ts`
  (2 tests), focused ESLint/Prettier on the harness and transport, and diff review.
- **PASS:** `CI=true npm run verify` on macOS arm64, Node 22.18.0. This includes
  release-contract validation, build, typecheck, ESLint, repository formatting,
  coverage, migrations, browser tests, production security audit and both managed
  lifecycle/update-recovery smokes. The sandbox attempt could not bind local
  sockets (`EPERM`); the authorized rerun outside that restriction exited 0.
- **PASS:** 62 unit/integration test files; 830 tests passed, 7 platform-specific
  skips. Coverage: 91.17% lines, 90% statements, 91.94% functions, 84.07% branches,
  above all configured 80% gates. Launcher coverage is 83.76% lines; its local
  branch coverage is 67.96% because native Windows branches cannot execute here.
- **PASS:** migration verification, 22 tests. Browser verification: 48 passed,
  6 existing/mobile-specific skips. Brand tests cover retained preference keys,
  Home accessibility, approved asset loading, themes, mobile/desktop layout,
  forced colors and 200% reflow. Screenshots were inspected at 390/960/1440 widths.
- **PASS:** `npm test -- src/server/cli/launchers.test.ts src/server/cli/platform.test.ts src/server/runtime/managed-control.test.ts`:
  24 passed, 6 native Windows skips. Interrupted writes, owned-stage recovery,
  unrelated file/link/PATH conflicts and precommit/committed activation behavior
  have focused regression coverage. Windows Unicode serialization is a real
  PowerShell test queued for the native matrix, not a local mock-based guarantee.
- **PASS with existing advisory:** `npm run security:check` / production audit
  high-severity gate exits 0; one existing moderate Fastify dependency finding
  remains (GHSA-w2qp-rph6-63g4 and GHSA-3m5p-2c4r-xxw2). No dependency was changed.
- **PASS:** independent launcher/security and harness/transport reviews after
  correcting findings; full changed-file diff inspection and `git diff --check`.
- **PASS:** `git diff --exit-code 2d3b180 -- drizzle branding/threadstr/v1 branding/threadstr/explorations`;
  all 26 manifest hashes, provenance source and three public SVG copies match.
  Published CHANGELOG suffix, package version and full dependency graph match the
  baseline; only private root package names differ. `git diff --cached --exit-code`
  confirms nothing is staged.

Remaining release evidence: native Linux/Windows and other supported Node/CPU
matrix execution; clean-machine online bootstrap and real terminal-close/profile
checks; final clean-commit versioned packaging; live published-to-published
upgrade. The workflow now includes the pinned baseline gate but was not pushed
or dispatched. No release version, migration, tag, existing release asset,
remote URL/registration or Git history was changed. No material user data was
accessed; fixture data lives only in disposable directories.

### Concurrent-work verification boundary

The final status check detected independent Amsterdam-example work added after
`CI=true npm run verify` completed. It changed `e2e/examples.spec.ts`,
`src/server/examples/catalog.ts`, `src/server/examples/examples.test.ts`,
`src/server/examples/service.test.ts`, `src/client/App.test.tsx`,
PROJECT/ARCHITECTURE, and plan 0022. These later edits were not reverted or
rewritten. Their catalog revision 3 supersedes the rebrand's revision 2.
The full-gate counts above apply to the verified rebrand snapshot before those
edits, not a blanket verification claim for the later combined working tree.
The final three-route baseline harness passed afterward; separate validation of
the concurrent example changes remains with that work. Historical preservation
claims here describe the rebrand's own changes; the original changelog, asset
and migration checks still pass against the current tree.

## PR #35 CI follow-up — 2026-09-16

The Windows managed-update job reached successful-candidate activation, then
failed its PowerShell command-search inspection. The earlier deliberate migration
exception was expected recovery-fixture behavior. Inspection did not retain the
underlying exit/timeout code, so the native failure's exact cause is not proven.
The candidate now establishes matching Windows PowerShell module paths before
startup and avoids module autoload while establishing the in-script path. Bounded
exit/error diagnostics and a native reduced-environment regression cover this
boundary; native Windows CI must confirm the result.

The upgrade harness now selects fixed literal Windows launcher commands and
passes installation paths through cwd, with ZIP paths passed separately through
environment values. The actual ontrack/thr launchers remain under test. The Home
fixture now matches the parsed HTTPS API origin instead of a URL substring.
These changes address PR #35's reported CodeQL flows without suppressing rules.
CodeQL clearance requires a fresh scan of the corrected candidate.

Local verification on macOS/Node 22.18.0: aggregate verification passed with
883 tests / 8 skips, 22 migration tests, 56 browser tests / 6 skips, 91.58% line
and 84.50% branch coverage; managed recovery and the v0.0.8 baseline harness passed.
An initial WebKit label test timed out waiting for Add note; it passed alone and
in the full rerun without a UI change. The existing moderate Fastify advisory
remains. New URL/module-environment and fixed-command regressions demonstrated
RED then GREEN; native Windows regression execution and CodeQL remain pending.

Subsequent PR CodeQL checks and the candidate Windows managed-update smoke
passed. Passing checks did not establish alert closure: alert #5 remained open.
Run `35134568111` still fails while installing the unchanged v0.0.8
baseline: the retained runtime directory is empty. Its pinned Node 24.14.0
native directory-copy implementation uses narrow Windows paths, consistent with
copying to a misdecoded Unicode destination before private-directory setup
creates the empty intended path. Candidate retention now selects Node's
JS/libuv copy traversal with an all-inclusive filter. The baseline harness
runs a mandatory candidate source/runtime byte-retention check at a Unicode
destination under that same pinned Node. Only the immutable baseline's Windows
installation root uses ASCII (still containing spaces); data paths retain
Unicode. This does not establish Unicode installation support for v0.0.8.
Native Windows confirmation of this correction remains pending.

Local correction verification on macOS: `RELEASE_TAG=v0.0.9 npm run verify`
passed (886 unit tests / 8 skips, 22 migration tests, 56 browser tests / 6 skips,
managed lifecycle/recovery; existing moderate audit advisory unchanged).
`node scripts/managed-upgrade-compat.mjs --baseline v0.0.8 --cache /tmp/threadstr-baseline-cache`
passed the pinned Node 24.14.0 Unicode check and all three upgrade scenarios.

Run `35145336866` confirms the pinned-runtime Unicode check and baseline
installation pass on Windows. Its next failure is candidate ZIP entry validation.
The fixture's Windows PowerShell `CreateFromDirectory` writer can produce legacy
backslash names, unlike the publisher's Git ZIP writer. The fixture now uses
`git archive` on a disposable candidate tree on every OS, without a commit, and
validates the complete generated archive before starting upgrade scenarios.
A nested-path regression verifies exact bytes, including CRLF and an ignored
fixture file. Native Windows confirmation of the archive correction is pending.
Local verification passed: typecheck, lint, formatting, 17 focused archive/
launcher/transport tests, and all three published-v0.0.8 upgrade scenarios,
including the new complete candidate-archive check. This fixture-only change
does not alter or relax production extraction checks.

Managed workflow `35147087509` subsequently passed all platforms, including
Windows and all baseline upgrade scenarios. PR CodeQL and Node 24 full
verification also passed. The remaining Node 22.16 Linux failure in
`35147087426` measured an empty mobile composer before navigation completed.
The full-width composer test now waits for the selected project and mobile
navigation focus, then verifies draft contents before measuring layout;
existing height and toolbar assertions remain unchanged.

## CodeQL alert #5 verification correction

Analysis `1789463448` succeeded on merge commit
`a41989653c48214961b703cfb1a8b845018d4008` but still contains
`js/shell-command-injection-from-environment`; the PR instance of alert #5 is
open. Its seven messages reference repository, temporary-directory and optional
cache paths. The four serialized SARIF traces follow the installer script path
(two traces), retention script path, and curl download destination into the
shared process runner. These are executable arguments, but that call site also
handled `cmd.exe /c`, conflating data arguments with shell text.

The fixture now invokes its finite literal Windows command map at a separate
shell call site. The general runner forces `shell: false` and ordinary Windows
argument quoting after caller options. No suppression, dismissal, query exclusion
or relaxation of archive/upgrade checks is introduced. Closure requires a fresh
successful analysis of the current PR merge commit with no matching SARIF result,
and alert #5's `refs/pull/35/merge` instance explicitly reporting `fixed`.
Local-only changes cannot establish that remote state.

Local CodeQL 2.27.0 with the matching `codeql/javascript-queries` 2.4.5 pack
reproduced one finding before the change (76 paths with `--max-paths=100`),
and zero findings after it for the exact rule across the repository. Static
analysis with the complete JavaScript/TypeScript code-scanning suite also reports
zero findings on the patched snapshot. Static
checks, ten command tests and all three baseline upgrade scenarios passed;
the new native Windows command test is skipped on the local macOS host.
The read-only remote closure check still fails on analysis `1789463448`, as
expected until these local changes are pushed and analyzed.
