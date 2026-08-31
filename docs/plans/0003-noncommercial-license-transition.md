# Noncommercial license transition plan (superseded)

> This completed pre-publication plan was superseded by the owner's Apache-2.0
> decision in [ADR-0005](../adr/0005-apache-2-license.md). It is retained only as
> historical rationale; its license requirements are no longer current.

## Goal

Replace MIT with a standardized source-available license that permits personal
and other noncommercial use while reserving commercial licensing, remove the
developer section from the product README, and leave the complete v0.0.1 tree
verified and ready for a local commit without creating that commit.

## Context and reusable precedent

AGPL-3.0 is an OSI-approved copyleft license and therefore permits commercial
use; its network-source obligation does not create a paid-commercial boundary.
The Open Source Definition likewise requires no discrimination by field of
endeavor. PolyForm Noncommercial 1.0.0 is a standardized SPDX-listed license
designed for personal and other noncommercial use, modification, and
distribution while leaving other rights—including commercial licensing—with the
licensor.

This transition occurs before the repository's first commit, tag, or public
release, so there are no prior MIT recipients whose existing rights would
survive the change.

## Acceptance criteria

1. The canonical PolyForm Noncommercial 1.0.0 text replaces MIT without local
   modifications.
2. Package and lockfile metadata use SPDX identifier
   `PolyForm-Noncommercial-1.0.0`, and release validation rejects mismatches.
3. Public docs accurately say "source-available," not "open source," and explain
   that personal/noncommercial use is free while commercial use needs a separate
   license from the copyright holder.
4. The README contains no **Develop and test** section.
5. Contributor guidance does not accidentally grant the project the ability to
   commercially relicense third-party contributions; external code contributions
   are paused until an owner-approved contributor agreement exists.
6. Product, architecture, changelog, ADR, and release-plan statements reflect the
   current license without rewriting historical implementation evidence.
7. Release, formatting, test, security, and diff/status checks pass; no commit,
   tag, push, or release is created.

## Non-goals

- Drafting a bespoke commercial license, price list, legal entity, CLA, or sales
  process.
- Claiming OSI open-source status.
- Revoking rights from any existing public recipient; none exist before v0.0.1.
- Changing runtime behavior, database schema, or release automation.

## Proposed design

- Use the canonical tagged PolyForm Noncommercial 1.0.0 license and its SPDX ID.
- Describe On Track as source-available and free for personal/noncommercial use.
- Add a short commercial-use document that directs prospective commercial users
  to the repository owner; the actual commercial agreement remains separate.
- Record the decision in ADR-0004 and mark the MIT portion of ADR-0003 superseded.
- Extend the existing release contract to verify package and lockfile license
  metadata together with versions and changelog.

## Data and migration impact

None. The database path, schema, migrations, and user data are unchanged.

## Phases

1. Add failing release-contract cases for wrong package/lockfile license metadata.
2. Replace legal/package metadata and make the focused contract tests pass.
3. Update README and durable project/release/contributor documentation.
4. Run independent review and the verification loop, inspect status, and stop
   before commit.

## Test plan

- Unit: release validator accepts matching PolyForm metadata and rejects package
  or lockfile license drift.
- Static: search public content for stale MIT/open-source claims and ensure the
  README development heading is absent.
- Full: `npm run verify`, tagged release check, workflow YAML parse, dependency
  audit, ignored-data check, and Git status.

## Risks and mitigations

- **The project is incorrectly marketed as open source:** consistently use
  source-available/noncommercial terminology.
- **Commercial boundaries are interpreted differently:** use an unmodified
  standardized license and recommend legal review before selling licenses.
- **Contributors block later commercial licensing:** pause external code
  contributions until a proper contributor agreement and copyright-owner details
  are approved.
- **License drift between files:** enforce the SPDX identifier in the release
  validator.

## Open decisions

Before accepting external code or selling a commercial license, the owner must
choose the legal copyright/licensing entity, commercial contact, contributor
agreement, commercial terms, and pricing with qualified legal advice.

## Completion evidence

To be recorded after verification.
