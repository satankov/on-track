# ADR-0010: Introduce threadstr and thr without moving existing data

## Status

Accepted 2026-09-16 through approval of [plan 0023](../plans/0023-threadstr-rebrand.md),
Phases 1–5. Applies starting with the next release after published v0.0.8; its
version is deliberately unselected. Supersedes current naming guidance in
ADR-0001/0003/0008/0009, preserving their historical decisions and examples.

## Context

The approved product identity is lowercase threadstr, using the supplied v1
wordmark. Existing users have On Track installations, persisted data and browser
preferences, backups, process locks, and an updater that requires the old archive
name. Renaming every identifier would lose discovery or permit duplicate writers.

## Decision

- Use threadstr on current product surfaces and `thr` as the primary command.
  Preserve approved artwork and the exploration archive byte-for-byte.
- Keep `ontrack` as a fully supported alias throughout 0.x and until a separately
  approved removal, preceded by notices in at least two published releases and
  a migration review. Both commands share dispatch and behavior.
- Preserve all documented [compatibility identifiers](../compatibility.md).
  Introduce no storage migration, namespace aliases, schema change, dependency,
  package registration, repository rename, or new remote URL.
- Provision the launcher during authenticated candidate activation before commit
  so the unchanged v0.0.8 updater can perform the transition. Use owned dispatcher
  and interpreter identities, idempotent provisioning, and existing recovery.
- Stop before activation for unrelated target or executable-PATH `thr` conflicts;
  never execute, overwrite, or silently shadow them. Do not source user profiles
  to inspect aliases/functions. Retain the old working installation on failure.
- Keep published artifacts, tags, history, old changelog sections, and historical
  plan/ADR statements unchanged. Current guidance clearly identifies prepublication
  `latest` downloads as the still-branded v0.0.8 release.

## Consequences and verification

Some visible filesystem paths, backup extensions, environment variables, archive
names, and the old updater's transition message intentionally retain On Track.
This avoids accidental empty workspaces, broken backups and upgrades, duplicate
instances, and lost settings. Future namespace changes require separate migration
approval and evidence.

Verify command parity, safe collisions, repeat provisioning, old-client activation,
rollback/interruption, retained data/settings/attachments/backups, and native OS
installation behavior. A controlled baseline-upgrade fixture is not evidence of
a live published-to-published upgrade. No next version or publication is authorized
by this decision.
