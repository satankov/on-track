# Apache-2.0 license and publication preparation plan

## Goal

Replace the uncommitted PolyForm decision with Apache License 2.0, restore
accurate open-source and contribution language, verify the full v0.0.1 release
candidate, and stage the complete initial tree for a local commit without
creating the commit, tag, remote, or GitHub release.

## Context and reusable precedent

The repository has no commits, tags, or remote, so no public recipient has
received rights under either earlier candidate license. Apache-2.0 is an
OSI-approved permissive open-source license that permits personal and commercial
use, modification, and distribution, subject to its notice, license, change-
marking, trademark, and patent provisions. The Apache Software Foundation
recommends placing the unmodified canonical text in a top-level `LICENSE` file.

The existing release contract already verifies license metadata and can be
retargeted without new infrastructure.

## Acceptance criteria

1. Top-level `LICENSE` matches the canonical Apache License 2.0 text exactly.
2. Package and lockfile use SPDX identifier `Apache-2.0`; the release validator
   rejects stale PolyForm/MIT metadata.
3. `COMMERCIAL_USE.md` and all active noncommercial/source-available claims are
   removed or superseded.
4. README and durable docs accurately call On Track open source under
   Apache-2.0; the README still has no **Develop and test** section.
5. Contribution guidance permits contributions under Apache-2.0 and does not
   claim a CLA exists.
6. ADR-0005 records the final pre-publication license choice and supersedes
   ADR-0004; earlier ADRs remain honest historical records.
7. Full verification, independent review, canonical-license comparison, tagged
   release check, audit, data-file hygiene, and Git status pass.
8. All intended initial-release files are staged locally. Ignored IDE, agent,
   database, dependency, build, coverage, and browser artifacts remain unstaged.
9. No commit, tag, remote, push, repository setting, or GitHub Release is created.

## Non-goals

- Restricting or charging for commercial use; Apache-2.0 explicitly permits it.
- Adding a `NOTICE` file without actual attribution notices.
- Publishing to npm, building native installers, or changing runtime behavior.
- Creating the GitHub repository or choosing its account/organization.

## Proposed design

- Replace `LICENSE` with the canonical ASF `LICENSE-2.0.txt` content.
- Change the release contract constant and both manifest values to `Apache-2.0`.
- Remove the commercial-use document and revert public language to open source.
- Restore normal Apache-licensed contribution guidance while noting that large
  provenance-sensitive grants may require separate maintainer review.
- Stage with `git add -A` only after review and verification; inspect the staged
  name/status list before delivery.

## Data and migration impact

None. Database schema, migrations, default external data path, and ignore/release
protections remain unchanged.

## Phases

1. RED/GREEN: update the focused release-contract tests and implementation for
   Apache-2.0 metadata.
2. Replace the canonical license and update README, changelog, contributor docs,
   project/architecture state, and ADRs.
3. Run reviewer and Verification Loop; resolve actionable findings.
4. Stage the verified initial tree, inspect it, and provide exact local commit and
   GitHub publication instructions.

## Test plan

- Focused unit: accept `Apache-2.0`; reject stale PolyForm and MIT metadata.
- Static/legal: byte-compare `LICENSE` with ASF canonical text; search for active
  source-available/noncommercial/commercial-license claims; confirm README heading
  removal.
- Full: local/tagged release checks, `npm run verify`, full npm audit, YAML parse,
  database ignore/tracked-file inspection, reviewer, and staged status review.

## Risks and mitigations

- **Owner still expects commercial restrictions:** make the commercial permission
  explicit in README/ADR and final handoff.
- **License drift:** enforce Apache SPDX metadata at release time and compare the
  full text with the canonical source.
- **Unwanted private/generated files enter the initial commit:** stage only after
  ignore checks, then inspect every staged path.
- **Remote controls are assumed active:** publication instructions separately
  require branch/tag rulesets and security settings after the repository exists.

## Open decisions

None. The owner explicitly selected Apache License 2.0.

## Approval request

Approved by the owner's explicit request to change to Apache 2.0 and prepare the
local commit.

## Completion evidence

### TDD and implementation

- RED: the focused release-contract suite failed three Apache metadata cases
  while implementation still required PolyForm. GREEN: package, lockfile, and
  validator now require `Apache-2.0`; matching metadata passes and stale PolyForm
  or MIT metadata fails.
- Reviewer RED: forced tracked `.on-track-backup`, `.on-track-export`,
  `on-track-backups/`, and `on-track-exports/` paths passed the validator. GREEN:
  all four are rejected and the 17 focused release-contract tests pass.
- Canonical `LICENSE` byte comparison against the Apache Software Foundation
  source passes. The obsolete commercial-use file was removed.

### Review and verification

- Independent re-review reports no remaining High or Medium findings.
- Local and `RELEASE_TAG=v0.0.1` release checks pass.
- `npm run verify` passes build, typecheck, lint, formatting, 65 tests in 8
  files, coverage (85.71% statements / 80.55% branches / 82.79% functions /
  88.53% lines), 8 migration tests, desktop Chromium and mobile WebKit restart
  journeys, and the production dependency audit.
- Full dependency audit reports zero vulnerabilities; workflow YAML parses.
- README has no **Develop and test** heading and current public docs contain no
  active PolyForm, source-available, or separate-commercial-license claim.

### Git state at plan completion

The verified initial tree is staged for one local commit. No commit, tag, remote,
push, repository setting, or GitHub Release was created. Ignored agent, IDE,
dependency, build, coverage, browser-report, and database artifacts remain
unstaged.

### Publication outcome

The owner subsequently committed and pushed the initial tree, applied the
Windows path-portability correction in commit `81027e1`, and created annotated
tag `v0.0.1` at that commit. CI, CodeQL, cross-platform portability, and the
tag-gated release workflow passed. GitHub published the immutable
[On Track v0.0.1 release](https://github.com/satankov/on-track/releases/tag/v0.0.1).
