# threadstr naming audit inventory

Prepared 2026-09-16 at `2d3b180`, before implementation. Companion to
[plan 0023](0023-threadstr-rebrand.md). Counts are matching **lines**, not
individual occurrences. Hidden tracked files are included. This section records the original state; implementation closeout is below.

The inventory is a navigation index for contextual review, not a replacement
allowlist. In mixed files, classify each individual expression by its role:
current presentation changes; persisted/wire/path/URL values stay exact;
historical assertions and records stay intact. Current test descriptions and
temporary fixture names can change while the compatibility assertions beside
them remain unchanged.

- C: current branding/development wording to update.
- H: historical content to preserve; superseding notes may be added.
- K: compatibility-sensitive values or real URLs to retain.

## Matched tracked files

| File                                                                   | Matching lines | Context and intended disposition                                                                                      |
| ---------------------------------------------------------------------- | -------------: | --------------------------------------------------------------------------------------------------------------------- |
| `.github/ISSUE_TEMPLATE/bug_report.yml`                                |              2 | C/K — issue/release text and temporary output names change; real repository/asset contracts remain.                   |
| `.github/workflows/release.yml`                                        |              4 | C/K — issue/release text and temporary output names change; real repository/asset contracts remain.                   |
| `.gitignore`                                                           |              5 | K/C — retain legacy sensitive-file protections/assertions; current identifier wording may change.                     |
| `CHANGELOG.md`                                                         |              4 | C/H/K — introduction and Unreleased change; published sections remain byte-identical.                                 |
| `CONTRIBUTING.md`                                                      |              3 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `README.md`                                                            |             22 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `SECURITY.md`                                                          |              2 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `docs/ARCHITECTURE.md`                                                 |             13 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `docs/PROJECT.md`                                                      |             16 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `docs/RELEASING.md`                                                    |              6 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `docs/adr/0001-localhost-typescript-sqlite.md`                         |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/adr/0003-source-release-pipeline.md`                             |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/adr/0004-noncommercial-source-license.md`                        |              2 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/adr/0005-apache-2-license.md`                                    |              2 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/adr/0006-managed-mutable-attachments-and-native-file-actions.md` |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/adr/0007-node-22-and-24-runtime-support.md`                      |              3 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/adr/0008-managed-install-and-cli.md`                             |              2 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/install/README.md`                                               |             22 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `docs/install/linux.md`                                                |             20 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `docs/install/macos.md`                                                |             21 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `docs/install/windows.md`                                              |             20 | C/H/K — update current guidance; keep version-specific history, real URLs, paths and formats.                         |
| `docs/plans/0001-first-project-chat-slice.md`                          |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0002-v0.0.1-release-readiness.md`                          |              4 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0003-noncommercial-license-transition.md`                  |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0004-apache-license-and-publication.md`                    |              4 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0006-database-transfer-markdown-message-management.md`     |              3 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0008-managed-mutable-attachments.md`                       |             10 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0010-appearance-themes.md`                                 |              3 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0011-project-message-labels.md`                            |              3 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0013-project-sidebar-pins-previews-attention.md`           |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0015-markdown-composer-assistance.md`                      |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0016-participant-message-attribution.md`                   |              2 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0017-chat-navigation-and-history-polish.md`                |              6 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0019-selective-backups-and-project-import.md`              |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0020-composer-drop-and-filter-scroll.md`                   |              1 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0021-managed-install-and-cli.md`                           |             21 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/plans/0022-built-in-examples.md`                                 |              3 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/visuals/markdown-composer-assistance-desktop.svg`                |              3 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `docs/visuals/markdown-composer-assistance-mobile.svg`                 |              2 | H/K — original rationale, dated evidence, concepts and contract examples; retain, add focused superseding notes only. |
| `e2e/database-transfer.spec.ts`                                        |              3 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `e2e/examples.spec.ts`                                                 |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `e2e/fixtures.ts`                                                      |              3 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `e2e/project-archive.spec.ts`                                          |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `e2e/project-chat.spec.ts`                                             |              4 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `index.html`                                                           |              1 | C/K — current product text changes; adjacent database, backup or launch identities remain.                            |
| `package-lock.json`                                                    |              2 | C — private root package name only; preserve versions/dependency graph.                                               |
| `package.json`                                                         |              1 | C — private root package name only; preserve versions/dependency graph.                                               |
| `public/theme-init.js`                                                 |              1 | K — browser storage keys must remain identical.                                                                       |
| `scripts/extract-source.ps1`                                           |              1 | K — environment/launch or helper-error protocol, not display branding.                                                |
| `scripts/install-shell.test.ts`                                        |              7 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `scripts/install.ps1`                                                  |              8 | C/K/H — current installer/release output changes; fixed asset names, publisher URLs, bootstrap tokens/pins remain.    |
| `scripts/install.sh`                                                   |              7 | C/K/H — current installer/release output changes; fixed asset names, publisher URLs, bootstrap tokens/pins remain.    |
| `scripts/managed-bootstrap.mjs`                                        |              5 | C/K/H — current installer/release output changes; fixed asset names, publisher URLs, bootstrap tokens/pins remain.    |
| `scripts/managed-bootstrap.test.ts`                                    |              5 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `scripts/managed-release.mjs`                                          |             14 | C/K/H — current installer/release output changes; fixed asset names, publisher URLs, bootstrap tokens/pins remain.    |
| `scripts/managed-release.test.ts`                                      |              5 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `scripts/managed-smoke.mjs`                                            |              9 | C/K/H — current installer/release output changes; fixed asset names, publisher URLs, bootstrap tokens/pins remain.    |
| `scripts/release-contract.mjs`                                         |              4 | K/C — retain legacy sensitive-file protections/assertions; current identifier wording may change.                     |
| `scripts/release-contract.test.ts`                                     |             19 | K/C — retain legacy sensitive-file protections/assertions; current identifier wording may change.                     |
| `scripts/verify-managed-runtime.mjs`                                   |              1 | C/K/H — current installer/release output changes; fixed asset names, publisher URLs, bootstrap tokens/pins remain.    |
| `src/client/App.test.tsx`                                              |             29 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/client/App.tsx`                                                   |              2 | C/K — current product text changes; adjacent database, backup or launch identities remain.                            |
| `src/client/BackupSettingsWorkspace.test.tsx`                          |              7 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/client/BackupSettingsWorkspace.tsx`                               |              3 | C/K — current product text changes; adjacent database, backup or launch identities remain.                            |
| `src/client/api.test.ts`                                               |              1 | K — backup MIME/extension transport contracts stay exact.                                                             |
| `src/client/api.ts`                                                    |              2 | K — backup MIME/extension transport contracts stay exact.                                                             |
| `src/client/preferences.ts`                                            |              1 | K — browser storage keys must remain identical.                                                                       |
| `src/client/theme.ts`                                                  |              1 | K — browser storage keys must remain identical.                                                                       |
| `src/server/app.test.ts`                                               |             19 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/app.ts`                                                    |              1 | K — backup MIME/extension transport contracts stay exact.                                                             |
| `src/server/attachments/managed-attachment-store.test.ts`              |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/attachments/managed-attachment-store.ts`                   |              1 | C/K — current product text changes; adjacent database, backup or launch identities remain.                            |
| `src/server/chat-service.test.ts`                                      |              4 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/chat-service.ts`                                           |              1 | C/K — current product text changes; adjacent database, backup or launch identities remain.                            |
| `src/server/cli/archive-process.test.ts`                               |              4 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/archive.test.ts`                                       |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/archive.ts`                                            |              1 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/arguments.ts`                                          |              1 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/build.test.ts`                                         |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/distribution.test.ts`                                  |              6 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/distribution.ts`                                       |              1 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/install.test.ts`                                       |              8 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/install.ts`                                            |              7 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/lifecycle.ts`                                          |              1 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/main.test.ts`                                          |             14 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/main.ts`                                               |             24 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/platform.test.ts`                                      |              6 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/platform.ts`                                           |             10 | C/K — dual launchers and safe provisioning; retain runtime roots/profile markers and dispatcher contract.             |
| `src/server/cli/prepared.test.ts`                                      |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/process.test.ts`                                       |              4 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/process.ts`                                            |              8 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/release.test.ts`                                       |              6 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/release.ts`                                            |              3 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/retention.test.ts`                                     |              3 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/state.test.ts`                                         |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/state.ts`                                              |              1 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/cli/update.test.ts`                                        |              2 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/cli/update.ts`                                             |              3 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/data-directory.test.ts`                                    |              8 | K/C — keep OS defaults/environment lookup and path assertions; generic fixture prefix may change.                     |
| `src/server/data-directory.ts`                                         |              4 | K/C — keep OS defaults/environment lookup and path assertions; generic fixture prefix may change.                     |
| `src/server/database-transfer/project-import.test.ts`                  |              8 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/database-transfer/restore-journal.test.ts`                 |             42 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/database-transfer/restore-journal.ts`                      |              4 | C/K — display messages/download basename change; tables, IDs, MIME, extension, journals and namespaces remain.        |
| `src/server/database-transfer/routes.ts`                               |              5 | C/K — display messages/download basename change; tables, IDs, MIME, extension, journals and namespaces remain.        |
| `src/server/database-transfer/sqlite-backup-bundle.test.ts`            |             60 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/database-transfer/sqlite-backup-bundle.ts`                 |             46 | C/K — display messages/download basename change; tables, IDs, MIME, extension, journals and namespaces remain.        |
| `src/server/database-transfer/staged-upload.test.ts`                   |              2 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/database-transfer/staged-upload.ts`                        |              2 | C/K — display messages/download basename change; tables, IDs, MIME, extension, journals and namespaces remain.        |
| `src/server/db/database.test.ts`                                       |             13 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/db/database.ts`                                            |              5 | C/K — current product text changes; adjacent database, backup or launch identities remain.                            |
| `src/server/examples/catalog.ts`                                       |              1 | C — maintained story prose; advance revision, preserve stable IDs and existing user copies.                           |
| `src/server/examples/examples.test.ts`                                 |              2 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/examples/service.test.ts`                                  |              2 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/local-server.test.ts`                                      |              7 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/local-server.ts`                                           |              6 | C/K — current product text changes; adjacent database, backup or launch identities remain.                            |
| `src/server/main.ts`                                                   |              2 | K — environment/launch or helper-error protocol, not display branding.                                                |
| `src/server/native-file-actions.test.ts`                               |              2 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/native-file-actions.ts`                                    |              2 | K — environment/launch or helper-error protocol, not display branding.                                                |
| `src/server/runtime-support.test.ts`                                   |              2 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime-support.ts`                                        |              3 | C/K — current product text changes; adjacent database, backup or launch identities remain.                            |
| `src/server/runtime/build-info.test.ts`                                |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/control-server.test.ts`                            |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/control-server.ts`                                 |              2 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/runtime/database-checkpoint.test.ts`                       |              5 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/database-checkpoint.ts`                            |              2 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/runtime/instance-owner.test.ts`                            |              3 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/instance-owner.ts`                                 |              4 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/runtime/managed-control.test.ts`                           |              1 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/managed-server.test.ts`                            |              3 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/managed-server.ts`                                 |              3 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/runtime/private-directory-process.test.ts`                 |              3 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/private-directory.test.ts`                         |              5 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/private-directory.ts`                              |              4 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/runtime/update-journal.test.ts`                            |              2 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/update-journal.ts`                                 |              1 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/runtime/update-maintenance.test.ts`                        |              4 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |
| `src/server/runtime/update-maintenance.ts`                             |              1 | C/K — current diagnostics/commands change; state, locks, discovery, environment and distribution contracts remain.    |
| `src/server/startup-database.test.ts`                                  |              4 | C/K/H — update current assertions/labels/temp prefixes; preserve storage, protocol, URL and old-release fixtures.     |

## Filename and ignored/local inventory

- 289 tracked/nonignored files; 138 files and 811 lines match content search.
- No tracked filenames match `on[ _-]?track` (case-insensitive).
- `.idea/on_track.iml` is the only matching non-generated local filename;
  `.idea/modules.xml` references it. Personal IDE state: preserve both.
- Ignored `docs/releases/v0.0.7.md` has 14 matching lines, all an old release
  runbook, old command examples, real URLs or actual checkout paths. Preserve.
- Local `.agents`, `.codex` and AGENTS instruction files were inspected separately
  from tracked source; no private context content is included here.
- Git internals/remotes and the actual checkout path retain the old identity.
  Dependency caches, compiled output, coverage and browser/test reports are
  generated/tool state, not current editable product guidance. Rebuild output
  rather than renaming vendor identifiers or historical artifacts.
- Approved PNG/SVG assets and logo exploration boards were inventoried with
  their usage guidance; preserve source artwork/provenance and manifest hashes.
  Historical Markdown composer concept SVG titles/descriptions are H, not a
  live application surface.

## Implementation closeout requirements

Repeat the content and filename scans from the plan. Explain residual groups:
historical records, valid existing URLs, compatibility contracts, intentional
alias/upgrade guidance, synthetic legacy fixtures, and local/generated tooling.
A leftover current product label, CLI example or diagnostic is a defect unless
it is explicitly part of a documented historical-client transition. Add new
files to this inventory where necessary; counts above remain the initial audit
baseline rather than a claim about the final tree.

## Residual audit after implementation

The final contextual review covers tracked and new source, hidden configuration,
current documentation, tests, filenames, and the separately inspected ignored
local configuration. The original table above remains historical audit evidence.
The rebrand plan/audit themselves intentionally quote the old names being audited.

Every residual belongs to one of these categories:

- **Stable data and runtime contracts:** legacy application-data/runtime folders,
  database and SQLite sidecars, ownership locks, instance/journal/checkpoint and
  staging names, IPC pipe convention, environment variables, bootstrap template
  tokens/helper output, shell profile delimiters, and browser preference keys.
  Implementations and assertions retain identical values. Internal constants
  such as `SQL_ON_TRACK_BACKUP_*` and the release backup-exclusion pattern describe
  those exact retained contracts; renaming them adds no user-facing benefit.
- **Backup compatibility and data protection:** extension, MIME, application ID,
  bundle table names, legacy format fixtures and `.gitignore`/release exclusions.
  The download display prefix is now threadstr; old backup files still import.
- **Actual publisher and asset identities:** existing repository/download/API
  URLs and protocol-1 source archive names. Test URLs, including rejected foreign
  publisher fixtures, exercise those unchanged contracts. Existing synthetic
  version examples in tests are test inputs, not a selected next release.
- **Supported alias and transition guidance:** old launcher names, alias parity
  assertions, v0.0.8 upgrade commands, explicit next-release notices and historical
  client output. The new baseline harness intentionally invokes and asserts the
  genuine published client's old identity before upgrading it.
- **Historical records/provenance:** published changelog sections, original ADR
  and plan statements, historical composer concept SVGs, and branding provenance.
  Relevant records have additive superseding notes. Approved v1 and exploration
  files are unchanged; public SVG copies match approved bytes.
- **Local/generated state:** the checkout and Git remote retain their real names;
  ignored `.idea/on_track.iml` and its module reference remain personal IDE state.
  The ignored old release runbook remains historical. Dependencies, Git internals,
  compiled output, coverage and browser reports are tool/generated state, not
  editable current product branding. Private context was not copied into artifacts.

No current product label, ordinary command example, help/error text or generic
fixture name remains under the old identity. Compatibility-aware diagnostics
correctly spell the legacy environment variable or alias they refer to. No
tracked/new source filename matches the naming regex; the only non-generated
local filename match remains the ignored IDE module.

Verification repeats the plan's `rg` content/filename commands and Git ignored
status inspection. Published changelog content from `## [0.0.8]` onward is
byte-identical to the pre-change baseline, as are shipped migrations, approved
v1 assets and exploration files. Package versions and dependency graph are
unchanged; only the private root package names changed.

## Changed-file inventory

The rebrand contributes changes to 113 files, including new artifacts.
The tree was clean at audit start. Concurrent Amsterdam-example work appeared
after the full verification run in `e2e/examples.spec.ts` and overlapping
PROJECT/ARCHITECTURE, plan 0022, catalog, component and example test files.
Those later edits are independently owned and were left untouched; this list
records files with rebrand contributions, not ownership of every current diff.

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/workflows/managed-install.yml`
- `.github/workflows/release.yml`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `README.md`
- `SECURITY.md`
- `branding/threadstr/README.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT.md`
- `docs/RELEASING.md`
- `docs/adr/0001-localhost-typescript-sqlite.md`
- `docs/adr/0003-source-release-pipeline.md`
- `docs/adr/0008-managed-install-and-cli.md`
- `docs/adr/0009-application-owned-examples.md`
- `docs/adr/0010-threadstr-identity-and-cli-transition.md`
- `docs/compatibility.md`
- `docs/install/README.md`
- `docs/install/linux.md`
- `docs/install/macos.md`
- `docs/install/windows.md`
- `docs/plans/0021-managed-install-and-cli.md`
- `docs/plans/0022-built-in-examples.md`
- `docs/plans/0023-threadstr-name-audit.md`
- `docs/plans/0023-threadstr-rebrand.md`
- `e2e/branding.spec.ts`
- `e2e/database-transfer.spec.ts`
- `e2e/fixtures.ts`
- `e2e/project-chat.spec.ts`
- `index.html`
- `package-lock.json`
- `package.json`
- `public/branding/threadstr-thr-circle-light.svg`
- `public/branding/threadstr-wordmark-on-dark.svg`
- `public/branding/threadstr-wordmark-on-light.svg`
- `scripts/install-shell.test.ts`
- `scripts/install.ps1`
- `scripts/install.sh`
- `scripts/managed-bootstrap.mjs`
- `scripts/managed-bootstrap.test.ts`
- `scripts/managed-release.mjs`
- `scripts/managed-release.test.ts`
- `scripts/managed-smoke.mjs`
- `scripts/managed-upgrade-compat.mjs`
- `scripts/managed-upgrade-transport.mjs`
- `scripts/managed-upgrade-transport.test.ts`
- `scripts/verify-managed-runtime.mjs`
- `src/client/App.test.tsx`
- `src/client/App.tsx`
- `src/client/BackupSettingsWorkspace.test.tsx`
- `src/client/BackupSettingsWorkspace.tsx`
- `src/client/styles.css`
- `src/server/app.test.ts`
- `src/server/attachments/managed-attachment-store.test.ts`
- `src/server/attachments/managed-attachment-store.ts`
- `src/server/chat-service.test.ts`
- `src/server/chat-service.ts`
- `src/server/cli/archive-process.test.ts`
- `src/server/cli/archive.test.ts`
- `src/server/cli/arguments.ts`
- `src/server/cli/build.test.ts`
- `src/server/cli/distribution.test.ts`
- `src/server/cli/distribution.ts`
- `src/server/cli/install.test.ts`
- `src/server/cli/install.ts`
- `src/server/cli/launchers.test.ts`
- `src/server/cli/launchers.ts`
- `src/server/cli/lifecycle.ts`
- `src/server/cli/main.test.ts`
- `src/server/cli/main.ts`
- `src/server/cli/platform.test.ts`
- `src/server/cli/platform.ts`
- `src/server/cli/prepared.test.ts`
- `src/server/cli/process.test.ts`
- `src/server/cli/process.ts`
- `src/server/cli/release.ts`
- `src/server/cli/retention.test.ts`
- `src/server/cli/state.test.ts`
- `src/server/cli/update.test.ts`
- `src/server/cli/update.ts`
- `src/server/data-directory.test.ts`
- `src/server/database-transfer/project-import.test.ts`
- `src/server/database-transfer/restore-journal.test.ts`
- `src/server/database-transfer/routes.ts`
- `src/server/database-transfer/sqlite-backup-bundle.test.ts`
- `src/server/database-transfer/sqlite-backup-bundle.ts`
- `src/server/database-transfer/staged-upload.test.ts`
- `src/server/database-transfer/staged-upload.ts`
- `src/server/db/database.test.ts`
- `src/server/db/database.ts`
- `src/server/examples/catalog.ts`
- `src/server/examples/examples.test.ts`
- `src/server/examples/service.test.ts`
- `src/server/local-server.test.ts`
- `src/server/local-server.ts`
- `src/server/native-file-actions.test.ts`
- `src/server/runtime-support.test.ts`
- `src/server/runtime-support.ts`
- `src/server/runtime/build-info.test.ts`
- `src/server/runtime/control-server.ts`
- `src/server/runtime/database-checkpoint.test.ts`
- `src/server/runtime/instance-owner.test.ts`
- `src/server/runtime/instance-owner.ts`
- `src/server/runtime/managed-control.test.ts`
- `src/server/runtime/managed-server.test.ts`
- `src/server/runtime/managed-server.ts`
- `src/server/runtime/private-directory-process.test.ts`
- `src/server/runtime/private-directory.test.ts`
- `src/server/runtime/private-directory.ts`
- `src/server/runtime/update-journal.test.ts`
- `src/server/runtime/update-maintenance.test.ts`
- `src/server/runtime/update-maintenance.ts`
- `src/server/startup-database.test.ts`
