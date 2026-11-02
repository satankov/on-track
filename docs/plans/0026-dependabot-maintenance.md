# Dependabot maintenance implementation plan

Status: local CodeQL/React updates and Dependabot grouping implemented and locally
verified on 2026-10-21. Committing, pushing the branch, and opening a PR for CI are
now authorized; merging remains explicitly prohibited.
Baseline: local `3dbde7b` on `releave/v0.1.0`; GitHub `main` was `ff7e5c4` at
investigation. Revalidate remote state before eventual integration.

## Goal

Integrate the existing security fixes, resolve obsolete dependency proposals,
and repair the specific update combinations causing CI failures. Preserve
security checks, supported runtimes, and installation/recovery coverage.

## Context and reusable precedent

Commit `a50cedd` implements plan 0025 Phases 1–4; `3dbde7b` documents the result.
GitHub's default branch does not yet contain either commit. The alerts therefore
describe the old dependency tree, not a failure of the new remediation.
The HTTP/Origin guards, POST-only export, exact backup schema checks, native Open
allowlist, and their regression tests must survive every subsequent update.

Read-only GitHub inspection found 19 Dependabot PRs and 26 open alerts representing
20 distinct advisories across six packages. Multiple manifest entries duplicate
some advisories. Every reported vulnerable range is avoided by the current lock:

| Package         | Alert count | Scope       | Current resolved version(s)         |
| --------------- | ----------: | ----------- | ----------------------------------- |
| fastify         |          12 | Runtime     | 5.12.7                              |
| fast-uri        |           5 | Runtime     | 3.1.9, 4.2.3                        |
| brace-expansion |           1 | Runtime     | 5.0.12                              |
| ip-address      |           1 | Runtime     | 10.7.4                              |
| shell-quote     |           1 | Development | 1.12.0, through concurrently 10.0.6 |
| undici          |           6 | Development | 7.30.1                              |

Fresh `npm audit --json` on the current checkout exited 0 with zero vulnerabilities,
including development dependencies. This is current audit evidence, not proof of
all possible exploitability or a new full test run. Plan 0025 records the prior
local full verification; the security commits still need the CI platform matrix.
Development dependencies also participate in source installation/build workflows.

### Confirmed CI failure causes

1. **Old production dependency audit:** both Linux full-verification jobs on
   #46, #47, #48, #50, #52, #53, #54, and #55 reach the production audit and fail
   on the remaining old vulnerable dependency tree. Representative
   [run 39231441734](https://github.com/satankov/on-track/actions/runs/39231441734).
   Integrating the security baseline addresses the observed audit cause; new CI
   must still prove the complete run, including later smoke steps.
2. **Split CodeQL versions:** #54 changes analyze and #55 changes init, mixing
   4.37.9 and 4.39.0. The action explicitly rejects that combination. This is
   workflow initialization failure, not a newly found application vulnerability.
   [Run 39231121307](https://github.com/satankov/on-track/actions/runs/39231121307).
3. **Split React family:** #24 makes React 19.3.0 disagree with React DOM 19.2.7,
   preventing five client suites from loading. #25 fails `npm ci` because
   `@types/react-dom@19.3.0` requires `@types/react@^19.3.0`, while the latter stays
   at 19.2.18. [React run](https://github.com/satankov/on-track/actions/runs/35204240043),
   [types run](https://github.com/satankov/on-track/actions/runs/35204218567).
4. **TypeScript peer conflict:** #5 proposes 7.0.2, but typescript-eslint 8.68.0
   accepts `>=4.8.4 <6.1.0`. Installation fails before compilation.
   [Run 35204204408](https://github.com/satankov/on-track/actions/runs/35204204408).
5. **macOS Intel native fallback:** #54's managed baseline job times out fetching
   a better-sqlite3 12.10.0 prebuild. Source compilation then splits a node-gyp
   include path under `disposable home é`, yielding clang missing-file errors.
   This occurs while installing unchanged published v0.0.8, before the candidate
   upgrade. [Run 39231121184](https://github.com/satankov/on-track/actions/runs/39231121184).
   A successful retry that obtains the prebuild would not validate the fallback.

The expected command-collision stderr in passing managed-control tests is not a
failure. GitHub's scheduled CodeQL run on main passed on October 19. Old green PR
checks predate these security commits and are not current merge evidence.

## Acceptance criteria

- Security remediation is retained, fresh full and production audits pass, and
  the configured Linux/Node, native-install, managed-lifecycle, CodeQL, and
  dependency-review gates pass on the actual candidate commits.
- After authorized integration into main and GitHub dependency analysis, all
  26 snapshot alerts are resolved by patched versions, not manually dismissed.
- Six superseded PRs are closed only after equivalent or newer fixes reach main.
- CodeQL steps use the same verified full commit SHA; React/React DOM versions
  match and their types satisfy peer constraints. No force/legacy-peer workaround.
- Every other PR has a documented tested integration, replacement, or deferral.
- Preserve Node 22.16+ on macOS/Linux and Node 24 on all supported OSs, along with
  the current manual runtime matrix and managed arm64/x64 matrix.
- Preserve security, migration, backup/restore, native-action, Unicode-path, and
  failed-update recovery coverage. No user data or published baseline is modified.

## Non-goals

New application features, new dependencies, schema changes, runtime support
changes, automatic merging, weakening audits, broad CI rewrites, or implementation
of optional plan 0025 Phase 5. A release/tag is a separate authorized action.
Issues #32–34 remain validation work and cannot be closed based on dependency CI.

## Proposed design

Reuse the existing workflows and Dependabot configuration. Weekly scheduling and
the npm development minor/patch group already exist. Add only two coherent groups:

- An npm `react-family` group matching `react`, `react-dom`, `@types/react`, and
  `@types/react-dom`, limited to minor/patch version updates. Put it before the
  existing development group and exclude the two React type packages from that
  broader group. Do not set dependency-type: the family crosses both categories.
- A GitHub Actions `codeql` group matching `github/codeql-action*`, limited to
  minor/patch version updates, so init and analyze update together.

These are version-update groups; security-update grouping is a separate setting
and is not implicitly enabled. Preserve SHA pinning and existing audit policy.
GitHub documents first-matching-group selection and separate update scopes in its
[Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#groups--).

## Data and migration impact

None planned. Use disposable data for verification. Do not change shipped
migrations, backup formats, baseline release bytes, user databases, or attachments.

## Phases

### Phase 1 — Establish the security baseline

Review the existing two commits as the integration candidate, retain their
coherent changes, and run the configured CI matrix through an authorized PR or
dispatch. No dependency redo is needed. Any reproduction of the Intel fallback
failure must be isolated before proposing its smallest correction.

For that failure, reproduce forced source compilation in a disposable macOS Intel
fixture using pinned Node 24.14.0 and unchanged baseline source. Check whether a
separate node-gyp header-cache directory without spaces fixes the compiler command
while HOME, installation, and user-data paths retain spaces and Unicode. This is
a hypothesis, not an approved fix. Distinguish fixture-only handling from any
real installer limitation; do not introduce blanket retries or skip the job.
Potential files: `scripts/managed-upgrade-compat.mjs`, related fixture tests, and
`.github/workflows/managed-install.yml` only if reproduction justifies a change.

Evidence: CI matrix on the security candidate, fresh audits, CodeQL, and managed
baseline upgrade results. Merge into main only with explicit authorization.
GitHub integration does not update existing users; ship the security fixes in a
separately authorized release after its gates pass.

### Phase 2 — Reconcile and repair Dependabot proposals

After Phase 1 reaches main, refresh metadata and let GitHub reconcile alerts.
Close remaining superseded proposals with a reference to the landed remediation;
never merge an obsolete lockfile merely to clear the queue.

| PRs                                                                                                      | Proposed disposition                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #37 Fastify, #45 fast-uri, #46 Undici, #47 ip-address, #48 brace-expansion, #53 shell-quote/concurrently | Close as superseded after main contains the current security versions; several proposals are older than those fixes.                                                                               |
| #54 and #55 CodeQL                                                                                       | Replace with one atomic init/analyze update to the same verified SHA for 4.39.0 (or a newly reviewed compatible release); add the CodeQL group.                                                    |
| #24 and #25 React                                                                                        | Replace with one coherent four-package update, targeting the reviewed 19.3 family; add the React group.                                                                                            |
| #36 @fastify/static, #38 Zod                                                                             | Refresh against patched main and verify individually; retain if still useful.                                                                                                                      |
| #52 development group                                                                                    | Regenerate against patched main, dropping already applied changes. Review the remaining toolchain changes, especially Playwright and Vite; split only if a concrete regression requires isolation. |
| #8 checkout, #50 setup-node                                                                              | Review upstream major-version/runner requirements, preserve full SHA pins, then validate as a separate workflow maintenance batch. #50's observed Linux failure was the old application audit.     |
| #5 TypeScript 7                                                                                          | Defer pending an explicitly compatible TypeScript/ESLint toolchain migration; no forced peer resolution.                                                                                           |
| #7 better-sqlite3 13, #19 multipart 10, #3 jsdom 30                                                      | Defer to separately reviewed major upgrades. Existing green runs do not establish compatibility with the new security tests.                                                                       |

Remote comments, rebases/replacements, closing, pushing, PR creation, and merging
require authorization. Deferred majors can remain open for now; closing them or
adding ignore rules is an explicit later decision, not part of noise cleanup by
default. Existing PRs older than 30 days may need a manually requested rebase:
[GitHub PR management guidance](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/manage-dependabot-prs).

Expected local files: `.github/dependabot.yml`, `.github/workflows/codeql.yml`,
`package.json`, and `package-lock.json`. Checkout/setup-node work also touches
the existing CI, managed-install, dependency-review, and release workflows where
those actions appear. Retain the security lockfile resolutions during refresh.

### Phase 3 — Verify and deliver each accepted batch

Run the checks below on each candidate that will actually merge, fix confirmed
regressions, and repeat only the affected checks plus the required aggregate.
Require fresh remote checks after conflict resolution. Keep optional upgrades
separate from the security release if they delay it. Record deferred majors and
installer limitations without misrepresenting them as resolved security alerts.

## Test plan

- Clean `npm ci`, then `npm ls --depth=0`; no invalid peer dependencies.
- `npm audit --json` and `npm run security:check`: clean full and production trees.
- `CI=true npm run verify`: existing authoritative build/type/lint/format,
  coverage, migration, desktop/mobile E2E, audit, and managed smoke gates.
- Preserve and run request-security, dev-proxy, exact backup-schema, and native
  Open-policy regressions; the aggregate includes them.
- `node scripts/managed-upgrade-compat.mjs --baseline v0.0.8` in the configured
  four-platform managed matrix; test forced source fallback separately when
  correcting that defect.
- GitHub full Linux verification on Node 22.16/24; native install/build/test on
  Linux/macOS for both and Windows for Node 24; CodeQL and dependency review.
- Use behavioral RED → GREEN tests for any fixture/product correction. For
  Dependabot-only YAML, validate syntax/group semantics and inspect the diff;
  avoid tests that merely restate configuration.

## Risks and mitigations

Old PR merges can downgrade patched resolutions: start from the security baseline
and inspect the full resolved tree. A fresh dependency audit changes with advisory
publication: record date and exact commit, and rerun before integration.
CodeQL/React grouping prevents incompatible partial updates but does not replace
compatibility review. Native fallback needs actual macOS Intel evidence; local
arm64 success and prebuild-only retries do not establish it. New major releases
remain distinct work, especially SQLite/import safety and TypeScript peer support.

## Open decisions

Whether to integrate the security commits before optional maintenance (recommended),
when to schedule the deferred majors, and whether to close those deferred PRs
instead of leaving them open. No new production dependency is proposed.

## Approval and implementation record

The user initially approved local CodeQL/React updates, Dependabot grouping, and
checks without pushing or merging. After local verification, the user authorized
committing the maintenance changes, pushing the existing branch, and opening a
PR to run the full CI matrix. Merging remains explicitly prohibited. Remote
Dependabot PR reconciliation, optional updates, and the native-fallback
investigation remain outstanding.

Implemented:

- React, React DOM, and both React type packages are pinned to 19.3.0. React DOM's
  required scheduler moves from 0.27.0 to 0.28.0. Those five package entries and
  the root requirements are the only lockfile metadata changes; every other
  package entry is identical to the security baseline. Node engines, registries,
  install hooks, and the existing security code/tests are unchanged.
- CodeQL init/analyze both use
  `6f2ac81f5cd81fe351a197ba0b00d91d03cd2aee`. GitHub's annotated `v4.39.0` tag was
  resolved to that commit before editing. Its minimum CodeQL bundle requirement
  needs no custom setting in the existing default-bundle/root-checkout workflow.
- Added the two proposed minor/patch version-update groups and excluded React
  types from the broader development group. Existing schedules, PR limits,
  security-update policy, workflow permissions, and unrelated action pins remain.

Primary release review found no required application migration for this slice:
[React 19.3](https://react.dev/blog/2026/09/09/react-19-3#changelog) and
[CodeQL 4.39.0](https://github.com/github/codeql-action/releases/tag/v4.39.0).
Registry peer requirements and MIT licenses were checked before installation.
No new behavioral test was added for dependency/configuration edits. The earlier
CI failures establish the broken split updates; existing client, security,
database, and browser tests verify the coordinated update without weakening them.

### Verification evidence

Local environment: macOS arm64, Node 22.18.0, npm 11.5.2.

- `npm ci`: PASS, clean locked installation; no peer-resolution workaround.
- `npm ls --depth=0` and `npm ls react react-dom @types/react @types/react-dom`:
  PASS, compatible deduplicated React family, no invalid dependencies.
- `npm audit --json`: PASS, zero vulnerabilities including development packages.
- `CI=true npm run verify`: PASS, exit 0. Includes release contract, build,
  typechecks, lint, formatting, 70 test files (982 passed, 9 platform skips),
  23 migration tests, desktop Chromium/mobile WebKit E2E (60 passed, 6 intentional
  viewport skips), clean production audit, and both managed smoke modes including
  failed-candidate recovery and postcommit restart.
- Coverage: statements 90.47%, branches 84.59%, functions 92.38%, lines 91.63%;
  all enforced thresholds pass.
- Ruby YAML parsing and one-time group-match/precedence checks: PASS for the
  React family and CodeQL action names; both immutable CodeQL pins match.
- Programmatic comparison with `HEAD:package-lock.json`: every entry outside
  the five approved React/scheduler packages is unchanged. Security production
  code and regression tests have no working-tree diff.
- Independent read-only reviewer: no actionable findings. `git diff --check`
  and formatting of the changed files passed.

The pre-existing large-client-chunk warning remains. Hosted CodeQL execution,
actual Dependabot regeneration, dependency review, the exact supported OS/Node
matrix, and the unchanged published-baseline upgrade job were not run in this
local-only slice. The macOS Intel source-build fallback issue is not repaired or
reclassified by these passing local checks. No claim is made that GitHub alerts
or existing installations have changed.
