# ADR-0008: Add managed CLI installation alongside manual source delivery

## Status

Accepted for implementation on 2026-09-11 through
[plan 0021](../plans/0021-managed-install-and-cli.md). On 2026-09-15 the user
selected v0.0.7 as the first managed-compatible release (floor `0.0.7`) and
accepted experimental delivery before real end-user installation/OS validation.
Those checks were deferred to the next release; automated verification, runtime
integrity checks, and immutable publication remain required. v0.0.7 is now
published and real installation validation is in progress (see plan 0021).
This extends ADR-0003 while retaining ADR-0007's manual runtime policy.

## Context

On Track is a browser UI served by a local Node/Fastify process with SQLite and
managed attachment files outside the source checkout. Manual installation
requires supported Node and `npm run quickstart`; users keep its terminal open
and repeat dependency/build steps when upgrading.

Users need one initial setup and memorable `ontrack` commands without a desktop
wrapper or permanent supervisor. Some have neither Node nor Git. The manual
Node/npm workflow must remain supported. A source alias alone cannot establish
which background process owns data or safely coordinate a migrated database
with an older application after interrupted updates.

## Decision

- Keep React, Fastify, SQLite, existing data directories, and foreground manual
  scripts. Add a short-lived CLI and per-user bootstrap scripts. Do not add
  Electron, Tauri, PM2, system services, Git installation, or global npm packages.
- Download a release-pinned private Node runtime, including npm. Keep versioned
  code/runtimes separate from project data and existing manual checkouts.
  Preserve the system Node installation and user npm configuration.
- Publish fixed source archives and a versioned managed-release manifest with
  hashes, exact runtime/platform information, and compatibility metadata. Build
  locked dependencies in staging before interrupting an active application.
- Keep `run`, `stop`, `status`, `logs`, and stable/exact-version `update` as the
  user command surface. Detach background output from the terminal. Startup at
  login/reboot and crash supervision are outside this decision.
- Acquire a lifetime data-ownership lock before restore recovery or migration
  for participating manual and managed starts. Use authenticated local IPC for
  status and graceful control, including Windows. Browser routes do not gain
  privileged update or process-control endpoints.
- Serialize managed mutations separately from data ownership. Freeze/drain
  accepted application operations before handoff, preserving normal use if
  draining fails before shutdown.
- Journal activation durably. Create an integrity-checked SQLite backup snapshot
  while owning stopped data before a candidate can migrate it. Keep protocol-v1
  startup migrations database-only; attachment files are not changed during
  activation and are not part of the rollback checkpoint.
- Accept project requests only after durable activation. Before commit,
  interrupted recovery restores the matching old database/code pair. After
  commit, recovery preserves newer writes and never automatically restores an
  older checkpoint. Unknown or corrupt operational state fails closed.
- Refuse downgrades, arbitrary URL/branch installation, and incompatible
  releases. Explicit managed adoption of existing data requires a verified,
  built, published protocol-compatible manual source release; older releases
  first need a manual upgrade. Never infer a code version from database schema.
- Trust the fixed publisher's HTTPS release channel, release asset integrity,
  reviewed official Node hashes, and npm lockfile integrity. Same-channel hashes
  are not independent signatures. Installation executes trusted publisher and
  dependency code as the current user; it is not an OS sandbox.
- Retain offline runtime use. Installation/update downloads contact distribution
  services, upload no project content, and introduce no background update polling.

## Alternatives considered

- A shell alias around `git pull` and `npm run quickstart` requires Git, mutates
  the active checkout, keeps foreground lifecycle semantics, and cannot recover
  interrupted schema upgrades.
- Desktop packaging can provide a familiar installation lifecycle but expands
  the requested scope into wrappers, OS packaging, signing, and application
  distribution.
- A permanent process manager adds another daemon, dependencies, and operational
  ownership. The existing server can be detached and controlled directly.
- Reuse system Node or install a global runtime manager: convenient for some
  developers, but changes user configuration and makes release/runtime pairing
  unpredictable. Manual users retain their existing choice.
- Portable project export as the mandatory update checkpoint fails for workspaces
  above bundle limits or with unavailable attachments. Database-only checkpointing
  under ownership fits the constrained migration contract.

## Consequences

The product architecture remains local browser/server/database. The delivery
layer gains security-sensitive filesystem, process, download, and recovery code
with cross-platform test obligations. Every managed release must prove archive
integrity, native SQLite loading, clean installation, terminal-independent
startup, graceful shutdown, ownership exclusion, and interrupted-update recovery
on each advertised platform.

The intended initial matrix is macOS arm64/x64, Windows x64, and Linux glibc x64.
Exact supported OS floors require verified release evidence; architecture tests
or a test on one host do not establish the entire matrix. Manual Node 22.16+/24
on macOS/Linux and Node 24 on Windows remain independent guarantees.

Operational files and database checkpoints are private local artifacts excluded
from source releases and portable project exports. They contain plaintext data
or process capabilities and must not be shared as generic logs. Checkpointing
adds disk requirements and does not undo external attachment edits or replace
independent user backups. Older releases cannot retroactively obey the new
ownership protocol; adoption instructions require stopping them explicitly.

Separate [macOS](../install/macos.md), [Windows](../install/windows.md), and
[Linux](../install/linux.md) guides cover both workflows, with one-command setup
first. v0.0.7 labels the installer experimental and retains manual setup as the
fallback. Download commands require the corresponding published release assets.

## Verification requirements

- Real-process tests: conflicting ports with shared data, process death releasing
  ownership, authenticated stop, and manual foreground compatibility.
- Bootstrap/manifest tests: absent Node/Git, fixed download trust, unsafe archives,
  hash mismatch, custom paths, PATH idempotence, and isolated dependency setup.
- Update tests: stopped/running server, exact/latest version resolution,
  checkpoint errors, every durable interruption boundary, repeat recovery, and
  preservation of postcommit writes and attachment identities/bytes.
- Clean OS/architecture installation and upgrade validation (deferred from
  v0.0.7 to the next release under the exception above),
  plus the repository's build, static, coverage, migration, E2E, security, and
  release-contract checks.

The accepted plan records the detailed protocol and evidence expected for each
phase. Acceptance of this ADR alone does not claim those gates passed.
