# Security audit response and implementation plan

Status: Phases 1–4 approved, implemented, and locally verified on 2026-10-21.
Optional Phase 5 remains deferred. The release OS/Node matrix was outstanding
at that local verification checkpoint. Phases 1–4 shipped in v0.1.0 on 2026-10-23;
this record does not independently establish release-matrix results.
Reviewed 2026-10-21 against `ff7e5c4` (package version 0.0.9), the same commit
named by the external 2026-09-25 audit. Existing unrelated changes to
`.gitignore` and `.prettierignore` were left untouched.

## Goal

Protect users from malicious browser pages and imported content with a small,
maintainable set of boundary fixes. Prioritize confidentiality, data integrity,
and accidental native execution. Do not turn every defense-in-depth suggestion
into a release blocker or add security infrastructure without a concrete need.

Recommendation: implement Phases 1–4 before the next release. Phase 5 is optional
follow-up work. The audit contains material findings, but its severity labels,
dependency snapshot, and some proposed remedies should not be adopted wholesale.

## Finding decisions

| ID  | Judgment                                                                                                                                                                                                                      | Recommended action                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| H1  | Accept, High: encoded API prefixes bypass the global Host/Origin guard. Reproduced against the actual application. Browser-specific DNS-rebinding success was not tested.                                                     | Phase 1, first priority.                                                                                               |
| H2  | Accept the dangerous default-allow policy. Potential impact is High, but the audit does not prove one-click execution for every listed format/OS. An imported attachment still requires a user Open action.                   | Phase 3: a short document/media allowlist, with Show in Folder for other files.                                        |
| M1  | Accept, Medium: another loopback origin can send a multipart write. A malicious same-user process already has broader access; the important case is untrusted content served by another local web application.                | Phase 1 with H1.                                                                                                       |
| M2  | Accept, Medium with serious persistent data-integrity/privacy consequences: hidden objects survive replacement and contaminate later selected exports. Independently reproduced end to end.                                   | Phase 2: complete schema validation; keep journaled replacement.                                                       |
| M3  | Accepted distribution trust limitation, not a newly discovered implementation vulnerability. GitHub/publisher compromise remains consequential.                                                                               | Defer independent release signing; retain accurate trust documentation.                                                |
| M4  | Accept only the disabled-TLS case, conditional Medium. A configured proxy or additional trusted CA is not inherently a vulnerability.                                                                                         | Optional Phase 5A: refuse network operations with certificate verification explicitly disabled.                        |
| L1  | Accept, Low: unwanted backup generation/download is possible. Normal same-origin policy prevents the remote page reading the response. Downloads placement and file mode are browser/OS dependent, not established constants. | Include in Phase 1 because it shares the same boundary and is cheap to fix.                                            |
| L2  | Accept, Low: remote Markdown images are blocked by production CSP but can load during development. No demonstrated production data leak.                                                                                      | Optional Phase 5B: render image alt text without an image request.                                                     |
| L3  | Accept missing development response headers; Low, overlapping L2.                                                                                                                                                             | Defer a dedicated dev CSP project. Do not copy production CSP blindly; it interferes with Vite refresh/style behavior. |
| L4  | Accept bootstrap environment inconsistency, Low. The disabled-TLS case deserves narrow treatment; the report does not demonstrate that arbitrary proxy variables alone replace native binaries.                               | Cover explicit disabled TLS in Phase 5A; defer a broad bootstrap environment redesign.                                 |
| L5  | No demonstrated exploit through supported `thr` launch. The generated dispatcher already selects the trusted active release as cwd. `ExecutionPolicy Bypass` alone does not establish code injection.                         | Defer module-relative helper-path cleanup until that area changes.                                                     |
| L6  | Accepted upstream trust limitation/Low. Runtime hashes are pinned; validating Node signatures at maintainer update time is separate supply-chain work.                                                                        | Defer keyring/signature infrastructure. Correct any documentation that claims signature verification already happens.  |
| D1  | Original two Fastify advisory prerequisites are absent, but the audit's overall dependency conclusion is stale.                                                                                                               | Phase 4: targeted compatible updates, not an upgrade of every package.                                                 |

### Evidence and corrections

The source review covered project/architecture documents, ADRs 0001, 0006, 0008,
0011, relevant portions of plans 0008, 0019, 0021, 0024, current code/tests, and
recent Git history. The external audit was treated as untrusted evidence.

HTTP probes used `buildApp`, installed dependencies, real disposable SQLite
databases, and Fastify injection. With hostile Host and Origin:

```text
/api/chats       -> 421 invalid_host
/%61pi/chats     -> 200
/api/ch%61ts     -> 421 invalid_host
```

The audit's third bypass example is incorrect, but its encoded-prefix finding is
real. The raw-URL condition also skips request leases; it does not bypass every
maintenance check, because handlers still use maintenance wrappers.
Cross-port multipart note creation returned 201. Cross-site navigation headers
without Origin produced a 200 backup response with attachment disposition.
These tests establish server behavior, not a full browser DNS-rebinding exploit.
See `src/server/app.ts:243`, `:465`, `src/server/home/routes.ts:17`, and
`src/server/database-transfer/routes.ts:143`.

The SQLite reproduction imported a fixture with a hidden table and trigger,
activated it, wrote a future private note in project B, and exported only
project A. B's note survived inside the hidden table in A's export. Both patched
reserved names (`sqlite_stash`) and ordinary names (`sqliteXstash`) worked:
SQL `LIKE 'sqlite_%'` treats `_` as a wildcard. No special file patching is needed
for the ordinary-name variant. `trusted_schema=OFF` did not prevent the ordinary
SQL trigger from executing. Merge does not install incoming triggers in the live
database, but its shared mutable preparation stage is not immune to them.
See `src/server/database-transfer/sqlite-backup-bundle.ts:542`, `:1147`, `:1185`,
`:1274`, and `src/server/database-transfer/restore-journal.ts:294`.

Direct execution of `attachmentOpenPolicy` returned `available` for `.terminal`,
`.inetloc`, `.chm`, `.xll`, `.wsb`, and `.docm` at mode 0600. No malicious OS
handlers were launched. The service already rechecks policy immediately before
dispatch, so the enforcement point is reusable. Apple documents commands in
[Terminal profiles](https://support.apple.com/guide/terminal/trmlshll/mac);
Microsoft documents how [Mark of the Web affects macro restrictions](https://learn.microsoft.com/en-us/DeployOffice/security/internet-macros-blocked).
Missing that metadata does not imply every Office installation executes macros
without another prompt or policy check.

Before remediation, `npm audit --omit=dev --json` exited 1 and reported four vulnerable package
entries: three High (`brace-expansion`, `fast-uri`, `fastify`) and one Moderate
(`ip-address`), zero Critical. These are package counts, not four demonstrated
application exploits. Review found no direct exploit in the current fixed glob,
schema-free route validation, HTTP/1, and non-trusting-proxy configuration.
Current [Fastify advisories](https://github.com/fastify/fastify/security/advisories)
include findings absent from the report. The current suggested Fastify target is
5.12.7; recheck advisories and compatibility when implementing.

## Context and reusable precedent

- Reuse the global HTTP hook, existing stricter native/Home guards, rate limits,
  and maintenance gate; no authentication framework or session store is needed.
- Reuse the migration-derived schema descriptors, SQLite fixture tests, and
  restore journal. Imported SQL must never define the validation baseline.
- Reuse `attachmentOpenPolicy`, service checks, existing blocked-action DTOs and
  accessible UI explanation; no new screen or OS integration is needed.
- Reuse current dependency locking and release verification. No new production
  package is proposed. Existing library mechanisms suffice; a new parser,
  archive scanner, security package, or signing service would increase scope.
- SQLite documents [schema object fields](https://www.sqlite.org/schematab.html)
  and the narrower purpose of [trusted_schema](https://www.sqlite.org/pragma.html#pragma_trusted_schema).
  Validate identity/structure, not physical page allocation.

## Acceptance criteria

1. Encoded route spellings cannot evade Host/Origin checks or API admission
   accounting; normal same-origin UI and intended non-browser clients work.
2. Cross-origin browser writes fail before parsing uploads or changing data.
   A different localhost port or hostname is a different origin.
3. Export requires the explicit JSON POST API for both all/selected projects;
   navigation and Markdown subresource requests cannot generate a backup.
4. Unexpected SQLite objects fail validation before candidate mutation or live
   activation. Legitimate supported backups and implicit indexes still work.
5. Unsupported attachment types cannot invoke native Open, even with a forged
   API call or misleading MIME metadata. Existing files remain accessible via
   the separately guarded Show in Folder action.
6. Compatible dependency fixes restore `npm run security:check`; passing an audit
   alone is not a claim of exploitability or comprehensive security.
7. Production and Vite development workflows remain usable. Relevant automated
   tests pass, and any missing real-OS/browser evidence is recorded explicitly.

## Non-goals

Independent release signing, a Node keyring, at-rest encryption, new login/token
infrastructure, sandboxing document viewers, antivirus/content sniffing,
preserving quarantine/zone metadata, rewriting replacement as clear-and-merge,
broad dependency major upgrades, and defending against a fully compromised
same-user OS process. These are not necessary to close the reproduced gaps.

## Proposed design and phases

### Phase 1 — Browser/API boundary (H1, M1, L1)

Apply loopback Host validation to all requests, independent of the raw path.
Validate supplied Origin against the request's validated HTTP authority. Keep
maintenance leases separate, classified using Fastify's matched route metadata,
with the intended health exception. Avoid custom URL-decoding logic and repeated
copies of the same Host policy in every endpoint.

For API requests, reject supplied Fetch Metadata indicating another origin
(`same-site` is not sufficient); allow intentional headerless non-browser API
clients. Retain the stronger required Origin/Fetch Metadata checks for native
actions and Home checks. Missing Origin must not rescue a browser request whose
Fetch Metadata says cross-site. This remains a browser-origin defense, not
authentication of arbitrary local processes.

Make export POST-only with required JSON selection (`all` or explicit IDs),
updating both client branches. Preserve existing selection limits and rate
budget. Do not silently accept a form POST as an all-project export.

Change Vite's string proxy to an explicit target with `changeOrigin: false`.
Installed Vite 8 expands the current string shorthand to `changeOrigin: true`,
which would otherwise break exact Origin-to-Host comparison. Do not compensate
by allowing every localhost origin.

Affected: `src/server/app.ts`, `src/server/database-transfer/routes.ts`,
`src/client/api.ts`, `vite.config.ts`, API/client/Home/native tests, relevant E2E,
and `docs/ARCHITECTURE.md`. Document the intentional GET-export contract change.

Evidence required: encoded-prefix/host/origin matrix; rejected cross-port
multipart import before staging; valid same-origin writes and exports; GET and
simple-form export refusal; encoded native/Home rejection; maintenance lease
and health behavior; actual Vite proxy smoke test. Browser tests cover both
supported desktop/mobile engines; no real native handler is launched in CI.

### Phase 2 — Exact imported SQLite schema (M2)

Replace all broad `sqlite_%` exclusions in object inventory/count/definitions
with a complete comparison to trusted migration-derived schema expectations.
Compare type, name, owning table, and normalized SQL; handle `NULL` SQL for
expected implicit indexes explicitly. Keep existing column, foreign-key, index,
migration, row, and payload validation. Reject unexpected triggers/views/tables
and indexes, including reserved names, wildcard lookalikes, and forged internal
index names. Do not compare root-page numbers, which change during compaction.
Include bundle-owned implicit indexes, such as
`sqlite_autoindex__on_track_bundle_files_1`, in the trusted inventory as well as
application indexes; the existing explicit bundle-index map is not complete.

Run this check before any candidate pruning/migration, and retain post-transform
and activation validation. Set `trusted_schema=OFF` on writable candidate,
export, and live application connections after migration/compatibility tests;
this is defense in depth, not the trigger fix. Keep identity-preserving
replacement and its existing recovery journal.

Affected: `src/server/database-transfer/sqlite-backup-bundle.ts`,
`src/server/db/database.ts`, bundle/transfer/restore/database tests, and
`docs/ARCHITECTURE.md`; change restore wiring only if needed to reuse validation.

Evidence required: ordinary `sqliteX...` and patched `sqlite_...` fixtures;
trigger-only, unexpected table/view/index, and implicit-index tampering;
all supported backup versions; preview/merge/replace rejection before mutation;
unchanged live records/files after rejection; legitimate selected exports and
restore interruption/rollback behavior. Preserve a sentinel proving excluded
project content never appears in an accepted selected export.

### Phase 3 — Bounded native Open policy (H2)

Replace the growing denylist with a small explicit suffix allowlist in the
existing pure policy function. Proposed initial set:

```text
Documents/text: .txt .md .csv .pdf .docx .xlsx .pptx
Raster images:  .png .jpg .jpeg .gif .webp .bmp .tif .tiff .heic
Audio/video:    .mp3 .wav .m4a .ogg .flac .mp4 .mov .webm
```

Require both display and actual managed filename suffixes to be allowed, retain
POSIX executable-bit denial, and use deterministic case-insensitive comparison.
Unknown/no-extension files, launcher formats, legacy/macro-enabled Office files,
HTML/SVG, and archives receive Show in Folder only. Upload, storage, backup, and
reveal remain available. This conservative list is a product policy, not proof
that allowed file contents or the user's default applications are safe.

Do not modify filename canonicalization or rename stored files for the audit's
bidi suggestion. That would make previously valid backup metadata noncanonical.
Display-only bidi hardening can be separately scoped if needed.

Affected: `src/server/attachment-open-policy.ts`, its tests, service/API
capability tests, relevant existing client/E2E tests, ADR-0006 consequences and
current architecture/user guidance. Reuse existing blocked-action copy unless
usability testing shows a clarification is needed.

Evidence required: allowed examples, all reported dangerous examples,
unknown/extensionless types, mixed-case and suffix tricks, display/managed-name
disagreement, POSIX executable modes, MIME spoofing, and proof that blocked Open
never calls the adapter while Show remains available. Verify keyboard/narrow
layout behavior with existing components and fake-native tests.

### Phase 4 — Focused dependency fixes (D1)

Recheck current advisories and any existing dependency PR before selecting exact
versions. Update Fastify within major 5 and refresh only the compatible
transitive resolutions needed for the reported packages. Inspect maintenance,
license, engine, install-script, and API changes. Avoid `npm audit fix --force`
and unrelated React/Vite/SQLite major upgrades.

Affected: `package.json`, `package-lock.json`, existing security-risk notes where
they become stale, and tests only where compatibility requires them. Keep this
separate from the application fixes so dependency regressions are attributable.

Evidence required: fresh production audit; full verification; supported Node
22.16/24 and OS/native SQLite matrix. Re-run the new HTTP regressions against the
updated router, particularly malformed and percent-encoded URLs. No claim that
all platforms passed based only on one local machine.

### Phase 5 — Optional small safeguards (M4/L4 and L2)

5A: Refuse managed network downloads/checks/bootstrap before network or package
installation when `NODE_TLS_REJECT_UNAUTHORIZED` is exactly `0`, with a clear
instruction to remove the setting. Prefer an explicit failure over silently
stripping it. Do not newly reject certificate-verified CA/proxy settings where
currently supported, and do not widen existing child-process environment
allowlists to introduce new support. These settings are not inherently malicious.
Preserve immutable legacy launcher/dispatcher bytes; put the guard in transport
and bootstrap boundaries instead of changing launcher ownership contracts.
Cover direct CLI and bootstrap entry paths, Home's shared
release transport, and child installation behavior. Offline local commands must
continue working. Reuse current subprocess/environment tests; verify ordinary
certificate failures and legitimate test CA/proxy operation. Likely files:
`src/server/cli/release.ts`, CLI distribution/bootstrap entry points,
`scripts/managed-bootstrap.mjs`, and their tests. Inspect installer entry points
so the guard precedes their first relevant Node network operation.

5B: Render Markdown images as inert alt text using the existing component map,
without changing stored Markdown or disabling normal links. Test remote,
protocol-relative, same-origin API, and data URLs produce no image requests in
development and production. Likely files: `src/client/App.tsx` and renderer/E2E
tests. Do not create a separate dev CSP/nonce subsystem for this.

Neither optional change needs a new dependency, broad environment allowlist,
or removal of unrelated production CSP directives.

## Data and migration impact

No schema migration, backup version change, data deletion, or identity remapping.
Legitimate supported backups remain compatible; previously accepted malformed
schemas become rejected. Native Open eligibility narrows immediately, including
existing attachments, without changing their bytes or metadata. GET export is
an intentional API compatibility change; the bundled client is updated with it.

This work prevents new malicious imports; it does not silently repair a database
already compromised by an earlier import. Do not delete unknown tables from a
user database automatically. If prior compromise is suspected, preserve data and
handle inspection/recovery separately. Existing plaintext and document-viewer
risks remain accurately documented.

## Test plan

During implementation use RED → GREEN → REFACTOR for the behavior guarantees
above, followed by the repository reviewer and security-review workflows.
Use temporary fixture directories and fake native adapters exclusively.

Run focused tests per phase, then `npm run verify` once the approved slice is
complete. That aggregate includes release checks, build, typecheck, lint,
formatting, coverage, migration tests, desktop/mobile E2E, production dependency
audit, and managed installation/update smoke tests. The dependency phase also
needs the supported runtime/OS CI matrix before release. Record exact commands,
failures, and unverified platform checks rather than claiming blanket safety.

During the original planning task, only targeted executable probes and a fresh
dependency audit were run. Production code and dependencies were unchanged at
that point, and the audit failed the release-security gate. The implementation
and verification record below supersedes that initial state.

## Risks and mitigations

- Stricter Origin checks can break dev proxies: preserve browser Host explicitly
  and test actual Vite requests before merging.
- GET export consumers must switch to JSON POST: document the change and update
  all shipped call sites/tests together.
- Complete schema checks can reject legitimate internal objects if expectations
  are wrong: derive them from the trusted migrations for every supported backup
  version and test valid implicit indexes on supported runtimes.
- Default-deny Open trades convenience for a bounded rule: Show in Folder remains
  available and new ordinary types can be added deliberately later.
- Allowed documents can still contain hostile content or exploit viewers:
  extension policy is not a content sandbox, and no such claim should be made.
- Dependency upgrades may change routing behavior: keep them isolated and run
  the new adversarial tests again after lockfile changes.
- Signing without an independent key boundary may not stop publisher/workflow
  compromise. Defer it until a separate threat model and key lifecycle justify
  the operational cost; same-workflow Sigstore identity is not automatically an
  independent trust anchor.

## Accepted decisions and remaining scope

Phases 1–4 accepted POST-only export, the listed Open allowlist, preserved
journaled replacement, and compatible dependency fixes. Optional Phase 5 remains
deferred and is not a release blocker. Independent signing/keyring infrastructure
and the other rejected or deferred audit proposals are accepted scope exclusions.

Platform/native validation remains tracked in [issue #32](https://github.com/satankov/on-track/issues/32)
and installation/upgrade validation in [issue #34](https://github.com/satankov/on-track/issues/34).
Their v0.0.9 target labels predate the now-published release; unfinished acceptance
criteria still apply. Run the configured CI OS/Node matrix on each future release
candidate; local macOS verification does not replace that gate.

Draft follow-up, pending tracker authorization: **Evaluate optional disabled-TLS
and Markdown-image safeguards**. Acceptance criteria:

- Decide whether to implement or explicitly decline each of Phase 5A and 5B based
  on practical risk and maintenance cost; neither is currently approved.
- If implementing 5A, reject explicit disabled TLS before managed network work,
  preserve offline commands and legitimate CA/proxy behavior, and test entry paths.
- If implementing 5B, render inert image alt text without changing stored Markdown
  or normal links, with development and production no-request regression coverage.
- Add no dependency or broad environment/CSP redesign; retain the rationale here.

## Approval and implementation record

The user approved Phases 1–4 on 2026-10-21. Phase 5A/5B were not implemented.
Implementation is recorded in commit `a50cedd` (`fix security issues`).
The closeout made no commits, pushes, remote changes, or releases.

Implemented all four core outcomes with the existing HTTP hook, migration-derived
schema descriptors, restore journal, native policy, and blocked-action UI. No
database migration, new package entry in the lockfile, or new runtime security
subsystem was introduced. Existing `.gitignore`/`.prettierignore` edits were
preserved.

Dependency updates: Fastify 5.12.7, brace-expansion 5.0.12, fast-uri 3.1.9/4.2.3,
and ip-address 10.7.4. A full audit additionally identified development-tool
advisories, resolved through compatible updates to concurrently 10.0.6,
shell-quote 1.12.0, Vite 8.1.6 and its required bundler subtree, source-map-js
1.2.2, and Undici 7.30.1. Vite 8.1 remains a supported security-backport line.
Review found no registry changes, new install hooks, or engine changes in the
lockfile. No unrelated major upgrades were made.

The first aggregate run exposed unrelated `node:test` video-demo files under
ignored local marketing/skill folders. Application tests passed, but Vitest
reported 11 foreign suites with no tests. `vitest.config.ts` now explicitly
discovers tests under `src/` and `scripts/`; all tracked Vitest tests and the new
security tests remain included, with unchanged coverage thresholds. The rerun
passed. No local marketing/skill files were edited.

### TDD and verification evidence

- HTTP RED: `npm test -- src/server/request-security.test.ts` failed 15 of 18
  cases for the intended missing guards/export contract. GREEN: all 18 passed.
- Native policy/service RED: 36 intended failures for unsupported filenames and
  dispatch. GREEN: policy/service/adapter/store suites passed 157 tests, with one
  existing platform skip.
- SQLite RED: new fixtures exposed accepted hidden objects, forged implicit-index
  ownership, trigger execution before export validation, and unsafe schema
  functions. GREEN: bundle/database/restore/import suites passed 146 tests;
  subsequent additional tampering cases passed with the final full suite.
- HTTP/client/import/Vite integration:
  `npm test -- src/server/dev-proxy.test.ts src/server/request-security.test.ts src/server/app.test.ts src/client/api.test.ts src/server/database-transfer/project-import.test.ts`
  passed 98 tests. The actual Vite proxy exercised creation, multipart notes,
  fake-native Open, Home checks, export, preview, and merge.
- `npx playwright test e2e/security-boundaries.spec.ts`: 4 passed across desktop
  Chromium and mobile WebKit, covering blocked Open/keyboard Reveal and export.
- Final `npm run verify`: PASS, exit 0 on macOS arm64, Node 22.18.0. This includes
  release contract, build, both typechecks, lint, formatting, 70 test files
  (982 passed / 9 platform skips), 23 migration tests, browser E2E (60 passed /
  6 intentional viewport skips), production audit (0 vulnerabilities), and both
  managed lifecycle/update smoke tests including failed-candidate recovery.
- Coverage: statements 90.47%, branches 84.59%, functions 92.38%, lines 91.63%;
  all enforced thresholds passed.
- Full dependency audit during final installation: 0 vulnerabilities, including
  development dependencies. `npm ls --depth=0` passed without invalid/extraneous
  direct dependencies.
- Read-only reviewer found no actionable issues in production changes, final
  dependencies/tests, or the test-discovery correction. `git diff --check` passed.

The build retains its pre-existing large-client-chunk warning. Real hostile
native handlers and browser DNS rebinding were not executed. Automated native
actions use a fake adapter. Linux/Windows and exact Node 22.16/24 release-matrix
runs were not performed here and remain required before release; local success
does not substitute for those checks. Existing compromised databases are not
automatically repaired, and allowed document contents are not sandboxed.

## Current dependency follow-up (2026-10-27)

The successful audit above is historical. A fresh `npm run security:check` on
2026-10-27 fails with one high-severity finding in pinned Zod 4.5.4:
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), memory
exhaustion while validating oversized constrained collections. The audit reports
affected versions `<4.6.6` and suggests 4.6.7 outside the current exact pin.
This was the pre-remediation result; the completed fix and reachability review
are below. The flat UI/design documentation slice itself did not change dependencies.

Tracked with user authorization in [issue #72](https://github.com/satankov/on-track/issues/72),
created on 2026-10-27. The issue owns remediation status and acceptance criteria;
the initial scope is recorded below.

**Initial acceptance criteria:**

- Assess which application schema paths can reach the oversized-collection
  behavior and document impact or existing bounds.
- Select a compatible patched Zod version after API, maintenance, license,
  engine, and security checks; update the exact pin and lockfile together.
  Do not use a broad forced audit upgrade.
- Run schema/request/import validation tests and the repository verification
  gate; add a focused regression only where the application behavior warrants it.
- Confirm a fresh production audit has no high-severity findings and record
  exact results and any remaining platform limitations before release.

### Issue #72 remediation (2026-10-27)

The local fix upgrades the exact Zod pin and lockfile from 4.5.4 to 4.6.7;
no other resolved package changes. The maintained upstream package remains MIT,
adds no runtime dependencies or install hooks, and declares no new Node engine
restriction. The lockfile integrity matches npm's published metadata. The
[upstream fix](https://github.com/colinhacks/zod/pull/6652) rejects oversized
bounded collections before walking their elements; unbounded arrays are unchanged.
The application continues using the same Zod v4 API and schemas.

Reachability review:

- Project label, retained-attachment, and service attachment arrays use `.max()`.
  Project export/import selection caps at 10,000 IDs. With 4.5.4, malformed
  oversized input still allocated one validation error per element before the
  length error. Same-origin/Host guards and upload limits restrict access and
  request size, but do not substitute for early collection rejection.
- The server's general body cap is 128 MiB; export JSON has a 1 MiB cap.
  Multipart attachments additionally have count and per-file limits. Import
  selection uses the same bounded schema; backup file validation remains a
  separate database/bundle boundary. Error handlers return generic messages.
- Home's release list has a 100-entry cap and a 2 MiB response cap. Its nested
  release-assets array is unbounded at the schema level and remains protected
  by the fetched-byte cap, not by this patch. No claim of constant-space parsing
  for unbounded arrays or arbitrarily large JSON is made.
- Managed retention and uninstall metadata use bounded arrays; metadata reads
  are capped at 256 KiB. Update journals are capped at 32 KiB. These local
  storage boundaries remain unchanged.

Regression evidence: `npm test -- src/domain/bounded-validation.test.ts` failed
all three cases on 4.5.4: labels and retained IDs each allocated 257 issues, and
backup selection allocated 10,003 nested issues. On 4.6.7 these become one size
issue per bounded array (two branch issues for the selection union). The test
uses modest fixtures, not an actual memory-exhaustion attack. The focused domain,
request-security, chat-service, project-import, and Home suite passed 112 tests;
the initial sandboxed import run could not bind localhost and was rerun successfully
with the required execution permissions.

The optional all-dependency audit at that checkpoint reported three moderate development-tool
entries (`vitest`, `@vitest/coverage-v8`, `@vitest/mocker`) for
[manual mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and
[Windows redirect traversal](https://github.com/advisories/GHSA-xp26-3454-mjgp).
They are outside issue #72 and the production audit: this repository runs Vitest
in Node/jsdom and configures neither browser mode nor the affected mocker Vite
plugins. Keep that exposure assessment with future test-tooling upgrades; this
slice does not claim an all-dependency audit with zero findings.

Final local verification on macOS arm64 / Node 22.18.0:

- `npm run verify`: PASS (exit 0). Includes release contract, build, both
  typechecks, lint, formatting, coverage, migration tests, browser E2E,
  production audit, and managed lifecycle/update/uninstall smoke tests.
- Coverage suite: 79 files, 1,037 passed / 9 skips; statements 90.91%, branches
  85.07%, functions 93.41%, lines 92.03%. Migration suite: 23 passed.
- Desktop Chromium/mobile WebKit: 66 passed / 6 intentional viewport skips.
  The first aggregate attempt stopped with two browser-server startup failures
  when a compiled module was temporarily absent. Its cause was not established;
  the complete rerun passed without test or production-code changes.
- `npm run security:check`: zero production vulnerabilities. `npm ls --depth=0`
  and `git diff --check` pass. Independent read-only review found no actionable
  defect. The existing >500kB client-chunk warning remains.

Issue #72 is fixed in source, but has not yet been published or closed on GitHub. The completed design cycle and this follow-up are ready for a
new chat. This is local verification, not a fresh Linux/Windows/Node 24 release
matrix or a claim that the existing native/accessibility tracker items are closed.

## Pre-release security maintenance: Slice A (2026-10-29)

Status: approved, implemented and locally verified after review of all 13 open
dependency PRs and seven issues. Baseline `462c391` on `release/v0.1.1`.
Committing the reviewed local changes was subsequently approved. Pushing,
remote comments/closures, merging and publication remain outside this slice.
The existing README edit is outside its scope.

### Scope and acceptance

Retain the Zod 4.6.7 fix and bounded-validation regressions from `735cd2b`.
Apply the version proposed by [PR #68](https://github.com/satankov/on-track/pull/68)
(`@fastify/static` 10.1.3 to 10.1.7), and update `vitest` and
`@vitest/coverage-v8` together from 4.1.11 to 4.1.12. PR #60's broad development
group does not include this Vitest fix and remains deferred. Preserve exact
pins, supported Node versions, unrelated lockfile resolutions, security
boundaries, and the existing database/backup contracts. No new direct dependency,
application feature, migration, runtime-policy change, or release version is
introduced.

Registry metadata identifies all three packages as MIT. Static declares no new
Node engine constraint; Vitest retains `^20.0.0 || ^22.0.0 || >=24.0.0` and Vite
6/7/8 compatibility. The paired coverage package requires Vitest 4.1.12. These
packages add no install lifecycle hooks. Upstream Vitest's
[4.1.12 release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.12)
backports the manual/redirect mock hardening.

Static requires `content-disposition` 3.0.0 instead of 2.0.1. Its MIT package
has no runtime dependencies; its Node `>=22` floor and ESM distribution remain
within the supported runtime contract. The reviewed lockfile changes only these
two runtime packages and nine Vitest-family packages, plus root requirements.
The existing compatible Chai 6.2.2 resolution is retained.

npm 11.5.2 crashed while exploring optional peers (`edgesOut` on a null parent).
The lockfile was resolved in a disposable manifest/lock copy using npm 11.9.0,
which includes [the upstream parent guard](https://github.com/npm/cli/pull/8448).
No global npm update, new project toolchain pin, `--force`, or `--legacy-peer-deps`
was used. Only the reviewed lockfile was copied back; clean installation with
the original npm 11.5.2 passed without peer errors.

Acceptance requires a narrowly reviewed lockfile diff, clean installation and
peer resolution, focused boundary regressions, the full `CI=true npm run verify`
gate, and fresh full/production audits. Reuse the existing request-security,
bounded-validation, startup, and desktop/mobile browser tests: the affected
upstream configurations are unused, so this slice does not invent an application
exploit or a failing regression for an unreachable path. The full audit before
the update exited 1 with three moderate package entries for two Vitest
advisories. Final-revision remote/platform qualification remains release work.

### Exposure assessment

- **Static serving:**
  [GHSA-r799-r9gc-m956](https://github.com/fastify/fastify-static/security/advisories/GHSA-r799-r9gc-m956)
  affects versions below 10.1.4 and bypasses path-sensitive route guards or
  `allowedPath` rules on case-insensitive filesystems. `local-server.ts` serves
  only `dist/client`, with `wildcard: false` and no `allowedPath`. User databases
  and attachment sidecars are outside that root. No protected-file exposure was
  demonstrated; the compatible patch removes the affected dependency version.
- **Vitest:**
  [GHSA-qxg6-89mg-rqv8](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)
  and [GHSA-xp26-3454-mjgp](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp)
  concern the public mocker/interceptor Vite plugins. This repository uses
  Node/jsdom tests and configures neither affected plugin. The paired 4.1.12
  update also resolves the transitive mocker version; no override or forced
  peer installation is used.
- **Deferred multipart major update:**
  [PR #71](https://github.com/satankov/on-track/pull/71) includes the fix for
  [GHSA-62qx-hpj5-j6hc](https://github.com/fastify/fastify-multipart/security/advisories/GHSA-62qx-hpj5-j6hc).
  Its affected range includes the retained 9.3.0, but its aborted-upload leak
  requires `request.saveRequestFiles()`. No application call uses that API.
  Note uploads use `request.parts()` in `app.ts`; backup uploads use
  `request.parts()` in `database-transfer/routes.ts` and application-owned staging
  cleanup. Defer the major upgrade with this reachability assessment, not a claim
  that 9.3.0 is patched. Reassess if multipart APIs change; independently qualify
  upload limits, cancellation, partial-file cleanup and backup staging before
  upgrading. The initial production audit reported zero findings despite these
  upstream static/multipart advisories, so an audit response alone does not
  establish absence of known affected dependencies.

### Tracker reconciliation

These are prepared dispositions, not remote changes:

- **Issue #61:** ready for evidence-backed closure. Commit `f42a822` (published
  in v0.1.0 via PR #64) changes `focusMobileBackButton` to preserve focus moved
  while navigation frames are pending. `App.test.tsx` covers both the retained
  attachment focus and ordinary Back focus. The original E2E focus assertion and
  keyboard Reveal receipt remain intact. On `6bb41be`, both
  [Linux Node 22.16](https://github.com/satankov/on-track/actions/runs/39938524534/job/120363939740)
  and [Linux Node 24](https://github.com/satankov/on-track/actions/runs/39938524534/job/120363939916)
  passed full verification on 2026-10-23, including the named mobile-WebKit
  attachment-safety test. This provides a code correction, regression coverage,
  and remote evidence, rather than an unexplained successful retry. The published
  changelog's original limitation remains historical; current indexes are corrected.
- **PR #58:** close as superseded only after main contains `735cd2b` or equivalent
  Zod 4.6.7 plus bounded-validation coverage. The local fix is more complete than
  the version-only proposal. Its Windows `windowsSearchConfig` timeout remains
  separate installer/uninstall evidence for #34/#62, not a Zod failure.
- **Issue #72:** retain the existing source fix; close only after integration and
  final-revision verification evidence is linked. State explicitly whether it
  is fixed on main or published. This local slice does not establish either.
- **PR #68:** the selected version is applied locally. After this batch reaches
  main with required checks passing, close the version-only PR as superseded.

Other dependency PRs remain deferred. Issues #32/#33/#34/#62/#63 retain their
native installation, desktop dispatch, real filesystem-drag and accessibility
acceptance criteria. No historical platform-validation exception is extended.

### Local verification

Verified on macOS arm64 / Node 22.18.0 / npm 11.5.2:

- `npm ci`: PASS; clean installation of 597 packages with no peer errors.
  `npm ls --depth=0`: PASS, with the selected exact versions.
- `npm test -- src/domain/bounded-validation.test.ts src/server/request-security.test.ts src/server/local-server.test.ts`:
  PASS, 23 tests before and after the dependency patches. The pre-update full
  audit's three moderate entries are resolved without changing application
  behavior or adding tests that only mirror unused upstream APIs.
- `CI=true npm run verify`: PASS (exit 0), including release contract, production
  build, both typechecks, lint, formatting, coverage, migrations, desktop/mobile
  browser tests, production audit, and prepared lifecycle/update/uninstall smokes.
- Coverage: 83 files; 1,112 passed, 9 platform skips. Statements 91.08%, branches
  85.54%, functions 93.01%, lines 92.21%. Migration suite: 27 passed.
- Browser suite: 82 passed, 16 intentional viewport skips, including the existing
  attachment keyboard/focus safety test. These are macOS Chromium/WebKit results,
  not new Linux/Windows evidence.
- `npm audit --json` and `npm audit --omit=dev --json`: both exit 0 with zero
  findings. The separately assessed multipart advisory remains deferred despite
  the audit response.
- `git diff --check` and changed-file formatting: PASS. Independent review found
  no code, dependency or data-safety defect; its PR #68 disposition wording was
  corrected. The pre-existing README edit is byte-for-byte unchanged.

The existing client bundle-size and non-module preference-bootstrap build
warnings remain. Final-revision Linux/Windows/Node 24 CI, managed platform
qualification, actual published upgrades, and manual native/accessibility checks
remain release work. This local result does not close remote trackers or qualify
the entire release.
