# Managed installation and ontrack CLI implementation plan

Status: all four phases implemented. On 2026-09-15 the user selected experimental
v0.0.7 publication and deferred real end-user installation/OS validation to the
next release. v0.0.7 is now published; real installation validation has resumed.
Automated release gates remain required. See the current investigation below.
Approval also requires separate macOS, Windows, and Linux installation guides,
each covering managed quick setup and the preserved manual setup.
Prepared 2026-09-10 against
`release/v0.0.7` at `676f056`, originally with package version 0.0.6. Release
preparation now sets 0.0.7 and the first managed compatibility floor to 0.0.7.
The current request investigates published installation and update failures.

## Goal

Let a user without Node or Git copy one installation command, start On Track in
the background, and subsequently use `ontrack run`, `ontrack stop`,
`ontrack update`, and `ontrack update vX.Y.Z`. Retain the browser application,
existing local server, and existing project data locations.

The manual alternative is a firm requirement: installing supported Node,
downloading or cloning the repository, running `npm run quickstart`, and later
running `npm start` must continue to work as foreground commands. Managed setup
must not alter system Node, Git, manual source checkouts, or their dependencies.

## Context and reusable precedent

### Repository evidence

- `package.json`: `quickstart` runs `npm ci && npm run build && npm start`;
  `start` executes `dist/server/server/main.js`. Use the same installation and
  build steps separately when preparing a managed release.
- `src/server/main.ts`: checks runtime support before importing startup.
- `src/server/local-server.ts`, `startLocalServer`: resolves data, recovers and
  opens SQLite, serves `dist/client`, and handles SIGINT/SIGTERM. It currently
  opens/migrates the database before validating the port or binding. Add shared
  ownership protection before that work and release resources on startup errors.
- `src/server/db/database.ts`, `openDatabase` and `applyBundledMigrations`:
  migrations run at startup; newer schemas/migration markers are refused.
  Migration and static asset paths depend on `process.cwd()`. A CLI can supply
  the exact release working directory without a broad resource-path refactor.
- `src/server/data-directory.ts`, `resolveDataDirectory`: preserves the existing
  platform defaults and override. Managed setup records an explicit canonical
  data directory; it does not relocate existing projects.
- `src/server/app.ts`: health reports only `{status: "ok"}`; `onClose` closes
  SQLite. The existing browser API is not a privileged process-control channel.
- `database-transfer/maintenance-gate.ts`: provides in-process exclusion only.
  `startup-database.ts` runs import recovery before opening SQLite.
- `database-transfer/restore-journal.ts`: provides durable states, constrained
  paths, flushing, and interruption tests. Reuse these patterns, not its
  attachment-replacement semantics, for software-update recovery.
- `database-transfer/sqlite-backup-bundle.ts`: already uses `Database.backup()`.
  Portable backups have size/count limits and require readable attachments;
  they cannot be an unconditional prerequisite for every software update.
- `e2e/fixtures.ts`: supplies disposable data directories and process readiness/
  shutdown test precedent. Its test-only forced termination is not a production
  stop implementation.
- ADRs 0001, 0003, and 0007 establish browser/local-server separation, source
  delivery, and manual Node 22.16+/24 platform support. Plans 0018–0020 contain
  completed unreleased features; this work must not absorb their follow-ups.
- `.github/workflows/release.yml` creates a release record after verification;
  it currently uploads no installer/source assets with a managed manifest.
  `scripts/release-check.mjs` uses Git and remains a maintainer/CI check, not a
  prerequisite for end-user archive installation.

### External research and reuse choices

- [Node binary verification](https://github.com/nodejs/node#verifying-binaries)
  and [official archives](https://nodejs.org/download/release/latest-v24.x/):
  download a private, exact tested Node 24 patch, with its included npm. CI
  verifies official checksums/signatures before recording archive hashes in the
  application release manifest. Do not resolve a moving Node version at install.
- [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/): use locked installs
  in staging. Include development dependencies because Vite/TypeScript build the
  source application; do not run `npm ci` in the active release directory.
- [GitHub archive guarantees](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives):
  generated archive compression can change. Publish fixed source archive assets
  with hashes instead of pinning a permanent checksum of an autogenerated tarball.
  [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
  protect published assets; upload all assets before publishing the draft.
- [Node 24 child processes](https://nodejs.org/download/release/v24.0.0/docs/api/child_process.html#optionsdetached):
  detach and disconnect terminal stdio, then `unref`. This is process lifecycle
  support, not crash supervision or login startup.
- [Node signal behavior](https://nodejs.org/download/release/v22.13.0/docs/api/process.html#signal-events)
  makes Windows PID signals unsuitable for graceful shutdown. Use authenticated
  [local IPC](https://nodejs.org/download/release/v24.0.0/docs/api/net.html#ipc-support)
  to ask the server to close itself on every platform.
- [SQLite locking](https://www.sqlite.org/lockingv3.html): evaluate the existing
  native driver for a separate lifetime ownership lock, with a real-process
  proof before building further phases. No additional native lock package.
- [fnm](https://github.com/Schniz/fnm) is a maintained installer precedent for
  per-user placement and shell setup, but installing a second version manager
  is unnecessary here. [PM2](https://pm2.keymetrics.io/docs/usage/quick-start/)
  introduces a daemon; its [registry metadata](https://registry.npmjs.org/pm2/latest)
  also declares AGPL-3.0. Do not add it for this scope.
- [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) is MIT and
  provides mkdir/heartbeat locking. Its stale-lock assumptions are a poor fit
  for avoiding two database owners after suspension; do not select it.
- [node-tar](https://github.com/isaacs/node-tar) is a maintained extraction
  alternative if platform tools cannot satisfy the archive tests. Do not write
  a tar parser. Adding an extractor dependency requires a separately reviewed
  exact version, license, and audit; none is selected by this plan.

## Acceptance criteria

1. On each advertised managed platform, installation works with Node and Git
   absent from PATH. A POSIX command and a Windows PowerShell command download
   private dependencies, build, start, and open the local browser. The commands
   print concise progress and give a log location on failure.
2. `npm run quickstart` and `npm start` preserve their existing foreground
   behavior and supported Node matrix, from both Git checkouts and source ZIPs.
   Manual operation does not depend on CLI metadata or an internet connection
   after dependencies/build are present.
3. Managed commands work from any working directory and after opening a new
   terminal, including installation paths containing spaces and non-ASCII text.
   Installation is per-user; no administrator access, system package manager,
   global npm installation, or system Node replacement is required.
4. `run` returns only after the intended instance is ready, opens its browser,
   and exits. Closing the launching terminal does not stop the server. Repeating
   `run` opens the matching running instance without starting another writer.
5. `stop` gracefully drains accepted operations and closes the managed server.
   Repeating it is harmless. It never kills an unrelated PID, stops a manual
   instance, or silently forces termination after a timeout.
6. `status` reports mode, running/stopped/busy state, version, and URL. `logs`
   shows a bounded tail of installation/server diagnostics without secrets or
   project content. These commands require no network access.
7. `update` selects the latest eligible published stable release. An explicit
   `vX.Y.Z` selects exactly that eligible published release, not a branch or an
   arbitrary URL. Missing/incompatible versions fail before stopping the server.
   Older releases are refused initially; installing the current version is a
   no-op that ensures the managed server is running.
8. Download/build/preflight failures leave active code and data usable. Updates
   prepare dependencies in a different directory, then take a brief maintenance
   interruption and start the selected version in the background even if the
   managed app was stopped before the command.
9. Every participating manual and managed startup acquires data ownership before
   import recovery or migration. Competing starts with the same data directory
   are rejected even when they request different HTTP ports. Different data
   directories remain usable independently if their ports do not conflict.
10. Interrupted precommit updates recover the previous code/database pair before
    accepting project requests. After activation commits, recovery never restores
    an older checkpoint automatically because new writes may exist.
11. Saved projects, IDs, timestamps, labels, archive/pin state, and managed
    attachment paths/bytes remain intact. Existing missing attachments remain
    recoverable records. Update recovery is not constrained by portable-export
    bundle size or attachment readability.
12. Installation and updates contact only the documented software distribution
    services. They upload no project data, introduce no runtime update polling,
    and do not weaken the browser API's CSP/Origin protections.
13. Manual and managed launch/update/restart are tested on disposable data.
    Unsupported environments fail with manual-install instructions before
    changing an existing working installation.

## Non-goals

Desktop applications, Electron/Tauri, a permanent CLI daemon, PM2, Git
installation, npm publication, automatic startup at login/reboot, automatic
crash restart, background update polling, the home-screen update button/FAQ,
arbitrary branch installs, automatic downgrades, encryption, attachment-storage
migrations, remote services for project data, or changing the manual Node policy.
No public release, credentials, commits, pushes, or remote settings are authorized.

## Proposed design

### Command contract and scope

| Command                 | Behavior                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `ontrack run`           | Start the recorded managed installation or reuse its matching instance; open browser. |
| `ontrack stop`          | Stop only that managed instance through authenticated control.                        |
| `ontrack status`        | Show current installation and verified server state.                                  |
| `ontrack logs`          | Print recent bounded diagnostics, with an option to locate the file.                  |
| `ontrack update`        | Prepare the latest eligible stable release and activate/start it.                     |
| `ontrack update vX.Y.Z` | Use the exact eligible published version; reject downgrades.                          |

Return nonzero on failure, with an actionable short message. Sanitize remote
strings before terminal output. Provide `--help` and `--version`. Proposed
convenience options are `run --no-open` for headless use and `update --yes` for
automation. Do not expand this into a general process manager.

One managed installation per OS user is supported initially. Installer options
can record an absolute custom data directory and port once; later commands use
that record, not whatever environment happens to exist in a new shell. Report
conflicting environment overrides rather than silently targeting different data.
Manual commands continue to use their existing environment-based configuration.

The initial installer starts without a confirmation when it owns a fresh setup.
For an existing workspace, explain that any legacy manual server must be stopped.
For `update`, propose one terminal confirmation before interruption: show current
and target versions and ask the user to save browser drafts. Noninteractive use
requires `--yes`. The command is restart authorization, not permission to delete
project data. There is no promise to save unsent browser drafts. Do not force a
browser reload; print that existing tabs should reload after the update. Managed
protocol v1 releases must preserve their browser API compatibility; an API break
requires a reviewed client-version negotiation design before becoming eligible.

### Bootstrap, private runtime, and command availability

Use small `scripts/install.sh` and `scripts/install.ps1` entry points. Publish
versioned copies with each release. README provides one command per shell family
that downloads a complete script successfully before executing it. Per the user's
guide refinement, release download examples appear first with an explicit
unpublished notice; remove that notice only after verifying the released assets.

Bootstrap uses standard shell/download/archive/hash utilities on macOS/Linux and
native PowerShell on Windows. It does not install Homebrew, apt packages, Visual
Studio, Python, or change PowerShell machine/user execution policy. List required
base utilities in the README and fail usefully when unavailable.

Proposed private installation roots, separate from the existing data roots:

| Platform | Managed code/runtime root                            |
| -------- | ---------------------------------------------------- |
| macOS    | `~/Library/Application Support/On Track Runtime/`    |
| Linux    | `${XDG_DATA_HOME:-~/.local/share}/on-track-runtime/` |
| Windows  | `%LOCALAPPDATA%/On Track Runtime/`                   |

Store versioned `releases/`, versioned `runtimes/`, private `logs/`, bounded
download/cache staging, and a small installation record. Never run builds in the
data directory. Validate the installation/data roots do not overlap dangerously.

A thin shell/PowerShell command shim resolves the active release/runtime pair
and invokes the selected private Node executable plus the compiled CLI. Its
selection file uses strictly validated generated IDs and a versioned format;
never source/evaluate it as shell code. Update that selection as one durable
replacement. Keep the shim backward-compatible with protocol v1 so routine
updates do not need to replace a running executable on Windows. Old runtime and
release directories stay available through commit/recovery. This shim is a
short-lived command entry point; there is no additional resident launcher.

Install the command into a user bin location and add only that location to PATH.
Use an identifiable, idempotent block for supported POSIX shell profiles and a
deduplicated user PATH entry on Windows. Preserve existing content/permissions;
do not add the private Node runtime to global PATH. The installer can run the
absolute command immediately, but cannot alter its parent shell environment;
explain when a new terminal is needed. Offer a profile-edit opt-out with the
absolute command path. Unknown shells receive explicit setup instructions.

Pin a tested Node 24 patch and its bundled npm for each managed release. Invoke
npm via that Node executable and npm's CLI file, with fixed argument arrays,
`shell: false`, and private npm cache/config. Use `npm ci --include=dev` then
`npm run build`; keep the lockfile unchanged. Prevent inherited NODE_OPTIONS,
production-only install settings, unrelated npm hooks, and user registry
configuration from silently changing the managed build. Do not copy credentials
into install records or logs. Enterprise proxy/custom-CA exceptions require a
documented explicit configuration; do not disable TLS verification.

Native dependency prebuild availability is a release gate. The proposed first
matrix is macOS arm64/x64, Windows x64, and Linux glibc x64. Record exact OS floors
and Linux distributions with the selected Node/SQLite versions during Phase 2;
advertise only combinations with clean-install evidence. Windows ARM64, Linux
ARM64/musl, network filesystems, remote terminal sessions, and managed corporate
devices are not implicitly supported. Manual installation remains available.

### Process ownership and control

Use `src/server/runtime/instance-owner.ts` in shared startup. Proposed mechanism:
an owner-private auxiliary `.on-track-owner.sqlite` file in the canonical data
directory, with DELETE journaling, zero busy timeout, and `BEGIN EXCLUSIVE` held
until the server closes. It contains no project tables, is never replaced or
unlinked, and is excluded from exports/restores. Losing the process releases the
OS-held lock. Validate this design on all target platforms in Phase 1; do not
silently fall back to a stale heartbeat/PID takeover if that proof fails.

The installation has a separate ownership lock for concurrent CLI mutations.
Once dependencies exist, use the same tested SQLite primitive. First bootstrap,
before a native driver is available, uses an exclusive creation claim with an
owner token; only that invocation removes it normally. A leftover claim fails
closed with recovery instructions rather than timeout-based automatic takeover.
Do not pretend a PID alone proves an active server's identity.

Startup order becomes: runtime/config validation; canonical directory and
ownership acquisition; pending update check/recovery; existing restore recovery;
database open/migrations; HTTP readiness. Ordinary startup must not migrate a
database covered by an unresolved update journal. Any failure closes initialized
resources and releases ownership. Lifetime ownership spans database replacement
inside import as well as normal operation.

Managed mode adds a bounded Node IPC listener inside the existing server:
Unix domain socket or Windows named pipe, using a short generated endpoint name.
Require a random bearer capability and instance nonce for every command; store
them in private operational state, never public health, CLI arguments, logs, or
browser code. Apply POSIX owner permissions and verified user-only Windows ACLs.
Control supports status, graceful stop, and update handoff/readiness/commit only;
it accepts no arbitrary commands or paths. It is not a browser `/api/stop` route.

The CLI spawns the server directly with exact Node/cwd, detached, terminal stdio
disconnected, and private bounded logs; waits for authenticated instance/build
readiness; then exits. Browser-opening uses a fixed local URL through an injected
shell-free platform adapter. Failure to open the browser does not stop a healthy
server: print the URL. Logs have rotation/retention and no request-body logging.

Extend `MaintenanceGate` with a reversible freeze/drain/resume operation; its
current counters alone do not implement shutdown. Freeze new project operations,
track and drain all accepted reads/writes/imports/exports/native actions, and
only then close HTTP/SQLite/control and release ownership. If draining times
out, resume admission before reporting busy, leaving the listener and database
usable. Keep status/control available during the freeze. Failures after close
begins report the actual stopped/failed state rather than claiming the process
remains intact. No automatic SIGKILL or Windows taskkill. A manual owner is
reported as a conflict, not silently adopted or stopped by `ontrack`.

### Release identity and download trust

Add a versioned `managed-release.json` asset containing the application version,
commit, managed protocol version, exact source asset names/digests/sizes, pinned
Node artifacts per supported OS/architecture, expected database schema/migration
marker, accepted upgrade origins, browser API protocol, and
`migrationScope: "database-only"` for this first implementation.

Generate a deterministic build fingerprint from the shipped source, lockfile,
migrations, and build configuration, without requiring Git on the user's machine.
Both manual and managed builds expose it through internal runtime description;
published manifests carry the expected fingerprint. Package version or schema
version alone cannot establish identity. Add a bounded `--describe-runtime`
maintenance entry point that describes compatibility without opening/migrating
project data; this is an internal command, not a second background service.

Only fixed publisher/repository HTTPS endpoints and validated release-asset
redirect hosts are allowed. Bound redirects, response sizes, timeouts, extracted
size, and file counts. Reject draft/prerelease targets, missing assets, invalid
version syntax, unsupported protocols/platforms, arbitrary URLs, and downgrades
before any application shutdown. Latest means latest eligible stable release,
not whichever commit is on `main`. Never substitute another target for an exact
requested version. Limit update targets to the first managed-compatible release
and later versions; do not invent that release number now.

Publish fixed `.tar.gz`/`.zip` source assets from the checked-out verified commit,
including migrations, lockfile, CLI/shims, and build inputs. Exclude private data,
node_modules, and local artifacts. CI rejects unsafe paths, duplicate entries,
special files, and symlinks in application source assets. Hash-verify before
extraction into a newly created private staging directory. The official Node
archive policy separately permits its expected contained npm symlinks; never
apply a blanket symlink ban that makes the official runtime unusable. Validate
extracted containment and expected entry points; archive tests cover traversal,
absolute paths, links, Windows path aliases, and expansion limits.

Initial trust proposal: trust the fixed GitHub publisher/release channel over
HTTPS, verify immutable uploaded-asset digests and reviewed Node hashes, and rely
on npm lockfile integrity for dependency bytes. A hash downloaded through the
same trusted channel is not an independent publisher signature. This has the
same publisher/package-code execution trust inherent in manual installation;
it is not an OS sandbox or protection against a compromised release account.
Independent signing-key infrastructure is an explicit future choice, not hidden
inside this scope. No GitHub token is required on user machines.

Installation/build code runs with the user's privileges. Exact hashes do not
remove dependency install-script risk. Retain dependency review/audit, verify the
selected native install scripts, and never execute remotely supplied shell
fragments or release-note content.

### Update transaction and recovery

The CLI is the temporary coordinator. There is no supervisor that must remain
alive after a successful command. Keep a small durable update journal in the
data directory and a matching installation transaction record. Use generated
transaction IDs and constrained paths, not absolute paths accepted from the
network. The data journal is authoritative for whether writes may resume.

Use explicit `intent`, `checkpoint_ready`, `candidate_started`, and `committed`
states. `intent` guarantees candidate code has not touched the live database;
recovery can resume the old version without a checkpoint. Persist the verified
checkpoint before `checkpoint_ready`, and persist `candidate_started` before
allowing candidate migration. From that state, recovery requires the matching
checkpoint even if the candidate may not yet have run. Unknown states fail closed.
Before durable intent, losing the coordinator releases the temporary maintenance
freeze. After intent, the transaction recovery protocol owns the frozen state.

1. Under installation ownership, select/download/hash-check/build/preflight the
   candidate in isolation. Test-load native SQLite and validate manifest/build
   identity without opening live data. If the app is stopped, use the installed
   old-version maintenance helper to own/recover its data before proceeding.
2. Resolve an existing import-restore journal with the old version, under data
   ownership. An ambiguous restore blocks updating. Obtain restart confirmation
   and complete/drain current operations; freeze new operations.
3. Persist update intent while the old owner still holds the data lock. Close
   the old server; acquire data ownership for checkpointing. All ordinary new
   starts refuse the pending intent. A restart gap must not allow an unguarded
   manual migration.
4. Create a consistent database checkpoint with existing `Database.backup()`
   support, without auto-applying candidate migrations. Include WAL state through
   SQLite's snapshot API, then close, flush, hash, and integrity-check the result.
   Do not copy a live main SQLite file alone. Record old/new release/runtime IDs,
   schema markers, checkpoint identity, and transaction state durably.
5. Keep attachment files unchanged throughout the update. Protocol v1 permits
   only reviewed database-only startup migrations; candidate startup and
   readiness must perform no attachment refresh/write, native action, import,
   cleanup, or other filesystem migration. This preserves missing-file records
   and avoids export-bundle limits. It is a database rollback checkpoint, not a
   full user backup, and does not undo external edits to attachments.
6. Release the coordinator's data lock and start the candidate with an exact
   transaction capability. Candidate reacquires ownership and validates the
   journal before migration. Racing ordinary starts refuse the intent. Migrate
   and check integrity/readiness while project requests remain unavailable.
7. After authenticated readiness, persist candidate selection while the data
   journal is still pending, then mark the data journal committed durably before
   accepting project requests. A crash between those writes remains precommit
   and restores the old selection. The candidate acknowledges activation before
   the CLI reports success. Do not infer commit from a timeout or PID existence.
8. For a precommit crash, the next managed command first discovers and
   authenticates any old/candidate instance named by the transaction. It queries
   durable commit state and gracefully stops a surviving precommit instance
   through control before acquiring data ownership. It must not wait forever for
   a candidate holding the lock while awaiting its dead coordinator. Persist
   reconnect credentials privately before handoff; never infer them from a PID.
   If the live owner cannot be authenticated or stopped, fail closed and preserve
   the transaction. After taking ownership, re-read the journal to avoid racing
   a commit, validate any required checkpoint, restore the old database/selection
   when necessary, and restart the previous version. The database restore uses a separately tested
   staged rename protocol handling old WAL/SHM files only after all connections
   close. Repeat interruptions remain recoverable. Unknown/corrupt state fails
   closed and preserves every recovery artifact.
9. After commit, never automatically restore an older checkpoint. Reconcile the
   selected version and resume that version, preserving any subsequent writes.
   Browser/API readiness failure after commit is a repair case, not permission
   to erase newly saved work.

The old runtime/release and latest successful checkpoint are retained through
the next successful update; replace that retained checkpoint only after the new
one commits. Prune only known managed artifacts, never project attachments or
manual source folders. Checkpoint disk use is approximately one database copy
(temporarily two during rotation); builds/downloads add separate disk needs.
Disk exhaustion aborts safely. No time-based deletion of a pending checkpoint.

Initial installation of an empty data directory creates schema normally. For an
existing workspace without a managed installation record, require an explicit
installer `--adopt-from <absolute-source-directory>` and a stopped manual server.
Validate the selected built entry point, runtime compatibility, canonical data
path, and published protocol/build fingerprint using its data-free maintenance
description. Do not infer application version from schema or search arbitrary
folders for executable code. Preserve that checkout; the temporary coordinator
invokes only its fixed maintenance helper with validated arguments and retains
the verified old release/runtime required for rollback in managed storage.
The manual checkout remains the user's untouched fallback, not a cleanup target.

Same-version adoption still verifies/checkpoints data and switches installation
ownership, but does not apply an artificial schema change. Existing managed
installs use their saved metadata, so ordinary updates do not ask for a path.
Legacy pre-protocol or unpublished/custom builds require a one-time manual
upgrade to a published protocol-aware source release before managed adoption.
If no eligible adoption source is supplied, stop before opening the existing
database and explain the required step. Older processes do not honor the new
lock/journal: detect known port conflicts but do not claim to discover every
old server on other ports. Users must stop them. The new guarantee applies to
participating releases, not retroactively to shipped code.

### Affected files and boundaries

| Surface                | Proposed files / changes                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared startup         | `src/server/main.ts`, `local-server.ts`, `startup-database.ts`, `app.ts`: ownership, resource cleanup, mode/readiness and maintenance shutdown.                                                                                                                     |
| Operational primitives | New `src/server/runtime/instance-owner.ts`, `control-server.ts`, `update-journal.ts`, `database-checkpoint.ts`, and colocated tests.                                                                                                                                |
| CLI                    | New `src/server/cli/main.ts` plus focused command, install-state, platform, download and update modules; reuse existing runtime/data rules.                                                                                                                         |
| Installer/shims        | New `scripts/install.sh`, `scripts/install.ps1`, and versioned command-shim templates; first-install and PATH tests.                                                                                                                                                |
| Packaging contract     | New `scripts/managed-release.mjs` and contract tests; versioned manifest descriptor with source/runtime hashes and compatibility.                                                                                                                                   |
| Verification           | `package.json` for additional developer test/packaging commands only; retain quickstart/start. Extend fixtures and CI for real CLI/process tests. Existing server TS/coverage globs include CLI under `src/server`; cover bootstrap scripts with integration tests. |
| Release automation     | `.github/workflows/release.yml`, `ci.yml`, `scripts/release-contract.mjs`: fixed assets, clean-install and update gates before publication.                                                                                                                         |
| Documentation          | README keeps both installation methods; `docs/RELEASING.md`, `PROJECT.md`, `ARCHITECTURE.md`, CHANGELOG; new ADR-0008 for managed delivery alongside source use. Update implemented truth only when delivered.                                                      |

Do not generalize restore/import into a framework or refactor unrelated client
code. Reuse file-identity/private-path helpers where their contracts fit. A new
filesystem migration or API incompatibility is a later separately planned slice.
Also extend `src/server/database-transfer/maintenance-gate.ts` and its tests for
reversible draining; wire native operations into that lifecycle explicitly.

## Data and migration impact

No project-table migration or portable-backup format change is proposed. The
feature adds private operational files: lifetime-lock SQLite files with no
project tables, authenticated instance metadata, install selection, update
journals, logs, and database checkpoints. Their formats have explicit versions
and must be excluded from backups, exports, Git, and release assets.

Data ownership applies across import replacement and across manual/managed
launches. Keep the existing data-directory defaults; installing the CLI does not
copy projects into the runtime directory. A first-managed adoption cannot open
older data with candidate migrations before its safe transition is established.

## Phases

1. **Local lifecycle and manual compatibility.** Add and prove the shared
   lifetime ownership primitive, startup cleanup, managed control/readiness, and
   `run/stop/status/logs` using an already built disposable release. Retain manual
   scripts verbatim. Outcome: background operation without downloads; different
   ports cannot bypass participating data ownership. Evidence: real concurrent
   processes, crash release, wrong-token/nonce refusal, manual foreground smoke,
   Windows graceful stop, and terminal closure on the initial matrix. If the
   lock or detach proof fails, revise this plan before adding another mechanism.
2. **Bootstrap and fixed release artifacts.** Add manifest generation, exact
   private Node provisioning, archive validation, staged npm/build, shims/PATH,
   and first-install flow. Select exact Node patch/OS floors from clean-machine
   evidence. Outcome: one command installs on clean supported hosts without Git
   or global Node. Evidence: clean-user/masked-PATH runs, hostile archive and
   checksum tests, interrupted/repeated setup, existing system tooling untouched,
   and ZIP/manual quickstart regression. Public download examples remain marked
   unavailable until final recovery and release gates pass and assets are published.
3. **Updates and durable database recovery.** Add exact/latest release selection,
   database-only eligibility, serialized preparation, checkpointing, candidate
   maintenance startup, two-record activation, and recovery. Outcome: all four
   requested lifecycle commands work, including version-specific updates.
   Evidence: real schema-transition fixture, interruption at every durable
   boundary, repeat recovery, disk/permission failure, current-version no-op,
   downgrade/incompatible rejection, and saved postcommit writes preserved.
4. **Release integration and delivery validation.** Add clean managed-install
   and old-to-new update gates to publication without weakening existing manual
   Node 22.16/24 gates. Finalize README and ADR with only verified platform claims.
   Outcome: a reviewable release-ready implementation with both install methods.
   Evidence: aggregate verification, security/reviewer findings resolved, actual
   supported terminal closure, browser restart/reload and attachment persistence
   smoke, and an asset manifest matching the tested revision. Publication remains
   a separate user-authorized action.

Each phase is a separate coherent implementation slice. Phase 1 can be approved
alone; it does not claim to deliver the complete one-command installation/update
experience. The public feature is complete only after all four phases pass.

## Test plan

Use RED -> GREEN behavior tests during implementation, a reviewer role for each
non-trivial slice, security-review for privileged/download/data boundaries, and
verification-loop before completion. Do not run installers against personal data
or alter the developer machine's PATH to validate the feature.

Existing focused regression command:

```sh
npm test -- src/server/startup-database.test.ts src/server/db/database.test.ts src/server/database-transfer/maintenance-gate.test.ts src/server/database-transfer/restore-journal.test.ts src/server/app.test.ts scripts/release-contract.test.ts
```

Proposed focused commands once the new targets exist:

```sh
npm test -- src/server/runtime src/server/cli scripts/managed-release.test.ts
npm run test:managed-install
npm run test:managed-update
npm run verify
git diff --check
```

The new integration scripts must support disposable roots and fixture release
feeds. Tests use injected/local test transports; production does not accept an
arbitrary update server. Network, process, clock, and filesystem failure adapters
must remain test-only or narrowly scoped dependency injection.

Required evidence beyond ordinary source CI:

- Ownership: simultaneous managed/manual startup, canonical aliases, distinct
  ports, legitimate distinct data roots, process crash/suspension, stale metadata,
  PID reuse simulation, malformed lock paths, pending journal, bind failure, and
  ownership held across import replacing the application database.
- IPC: wrong/missing capability, replayed nonce, oversized/malformed messages,
  endpoint spoofing, private permissions/ACLs, no public stop/install API, and
  graceful stop while writes/import/export are running. Never test a production
  force-kill fallback because none is proposed.
- Installation: no Node/Git, existing incompatible/system Node unchanged,
  paths with spaces/Unicode, repeated profile changes, new-shell discovery,
  private npm settings, native SQLite loading without compiler tools, missing
  utilities, offline/proxy failures, invalid assets, traversal/link/size attacks,
  stale bootstrap claim, extraction interruption, and disk/permission failures.
- Update: exact and latest selection, draft/prerelease/incompatible rejection,
  downgrade refusal, stopped-app update starts afterward, concurrent CLI calls,
  explicit valid/invalid manual adoption paths and same-version adoption,
  unchanged attachments including missing files, workspace exceeding export
  limits, unfinished import recovery, checkpoint corruption, WAL contents,
  candidate health mismatch, and loss of CLI/candidate at every journal state.
  Include a candidate still alive and holding ownership after its coordinator
  exits, plus reversible freeze timeout before update intent is persisted.
- Recovery: real older-schema to newer-schema fixture and round-trip rollback,
  crashes during rollback itself, mismatched install/data records, no writes
  accepted before commit, committed updates preserve subsequent notes, and no
  accidental pruning of pending state or old manual folders.
- UX/platform: actual terminal-close survival on supported macOS/Linux/Windows
  local terminals, foreground Ctrl+C manual flow, browser-open failure, friendly
  status/log output, update draft warning, and restart using the same data path.
  Hosted CI with preinstalled build tools alone does not prove a clean-manager
  installation; use minimal images/VMs or explicitly controlled tool absence.

## Risks and mitigations

| Risk                                                       | Mitigation / practical limit                                                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI becomes a second application architecture              | Keep one server and short-lived CLI; no desktop shell, supervisor, scheduler, or general service framework.                                                    |
| Two writers or wrong process stopped                       | Lifetime data lock in shared startup, authenticated instance identity, no PID-only termination. Pre-protocol manual releases remain an explicit limit.         |
| Windows shutdown or terminal closure differs               | IPC graceful close and actual Windows terminal tests before support claims.                                                                                    |
| Updated code cannot use old data, or rollback loses writes | Consistent checkpoint, pending journal honored before migration, staged activation, and no rollback after commit.                                              |
| Attachment data cannot be backed up or changes externally  | Database-only migration contract; updater never rewrites attachment bytes; checkpoint is not a full attachment backup.                                         |
| Initial adoption accidentally migrates legacy data         | Require protocol-aware manual baseline for adoption; preserve old source installation and stop old processes first.                                            |
| Software supply-chain compromise                           | Fixed publisher, immutable checked assets, pinned Node/hash verification and locked dependency review; disclose that channel trust is not independent signing. |
| Native dependency requires compiler tools                  | Restrict advertised matrix to clean-install prebuild evidence; fail with manual guidance rather than modifying the OS.                                         |
| PATH or inherited environment breaks unrelated tools       | Install only user-level command shim, idempotent edits, private runtime/cache/config, no global Node/Git changes.                                              |
| Unsaved browser draft disappears on refresh                | Explicit pre-update save warning; no forced reload or claim of draft persistence.                                                                              |
| Disk/checkpoint accumulation                               | Keep bounded logs/cache and one successful recovery checkpoint; never prune pending recovery artifacts.                                                        |
| Power-loss durability differs by filesystem/OS             | Local filesystem scope, platform fsync/rename evidence, interruption tests, fail closed on ambiguity; do not promise support for network/synced roots.         |

## Approved defaults

The user approved these defaults with all four phases on 2026-09-11:

1. **Runtime/platform scope:** private pinned Node 24 even when system Node
   exists; first targets macOS arm64/x64, Windows x64, and Linux glibc x64, with
   exact tested OS floors recorded before advertising support. Preserve the
   broader current manual Node policy.
2. **Background meaning:** survive local terminal closure; no automatic restart
   at login/reboot or after a crash.
3. **Update interaction:** one save-drafts/restart confirmation; `--yes` for
   automation. Exact version means an eligible equal/newer release, not automatic
   downgrade. First managed-compatible release number is selected at release time.
4. **Recovery scope:** database-only migrations and one retained SQLite
   checkpoint; no attachment storage migration. One-time manual protocol upgrade
   is required when adopting an older existing workspace.
5. **Download trust:** fixed GitHub HTTPS/immutable asset digests plus pinned Node
   hashes and npm integrity, without introducing signing-key infrastructure now.
6. **Environment integration:** private runtime roots above and idempotent user
   PATH/profile setup, with an opt-out; local disks and supported local terminals.

No new production dependency is proposed. A failed lock/extraction/platform proof
requires presenting an alternative and any dependency decision before proceeding.

## Approval recorded

The user approved the complete managed installation and CLI slice (Phases 1–4),
including separate complete OS guides with manual and managed setup. Approval
covers implementation and disposable tests, not public release, remote settings,
real user installation/data, commits, or pushes.

## Planning verification (before approval)

Repository and primary-source investigation completed; planner and documentation
researcher consulted. Production code, dependencies, migrations, user installs,
and remote resources were not changed. Implementation tests above are planned,
not executed evidence. Plan-only formatting and diff checks are recorded in the
delivery response.

## Implementation and verification record — 2026-09-11

- Lifecycle: shared OS-held data ownership, authenticated bounded IPC,
  terminal-independent processes, reversible HTTP drain, and offline CLI commands.
- Delivery: private Node 24.14.0 with reviewed official SHA-256/size pins;
  bounded fixed-release downloads; regular-file source extraction; isolated npm
  builds; versioned runtime/source pairs and user command shims. Initial setup
  writes selection before the installation record so interruption is retryable.
- Update: exact/latest eligible immutable releases, old-version import recovery,
  database-only checkpoints, candidate maintenance startup, durable activation,
  repeat recovery, and no rollback after commit. Known completed artifacts are
  pruned conservatively; unknown or ambiguous recovery artifacts remain intact.
- Adoption rebuilds verified previous source under private Node rather than
  copying Node 22 native modules. Legitimate npm hardlinks are copied into
  independent retained files; source/archive links cannot escape their tree.
- Release: existing manual commands and Node policy are unchanged. Managed
  lifecycle/update matrix gates and fixed draft-before-publish assets are wired.
  Generated INSTALL.md supplies versioned one-command setup in release notes;
  docs/install contains full macOS, Windows, and Linux alternatives.
- No production dependencies, project-table migrations, commits, tags, remote
  settings, public releases, real user installations, or project data changed.

Local evidence: full `npm run verify` passed on macOS arm64 with Node 22.18.0,
including build/types/lint/format, coverage above all 80% aggregate thresholds,
existing desktop/mobile E2E, migrations, high-severity production audit, and
actual background lifecycle plus failed/successful migration update fixtures.
The audit reports an existing moderate Fastify advisory; dependency versions
were not expanded in this installation change.

A separate disposable source installation downloaded and hash/size-verified
private Node 24.14.0, ran locked npm/build, executed the actual CLI installer
with profile/browser opt-outs, used its retained shim from another directory,
and passed start/stop/restart and real migration/update fixtures. All server
processes were stopped. This verifies private Node/macOS behavior, not published
bootstrap URLs, GUI-terminal closure, or other operating systems.

Review found and resolved native-ABI adoption, bootstrap root permissions,
manifest trust, retry cleanup, atomic profile writes, first-install state order,
and stop-instance identity races. Node bootstrap/manifest pin parity is tested.

Release validation still requires the configured automated Windows x64, Linux
glibc x64, and Mac matrix. The v0.0.7 exception below defers clean end-user
bootstrap/terminal checks and published manual-to-managed adoption to the next
release. The first eligible version is now `0.0.7` (`MANAGED_MINIMUM_VERSION`).
Public assets cannot be exercised before publication. Official Node hashes are pinned and CI rechecks
bytes over HTTPS; detached Node signature verification is not implemented, so
this does not add an independent signing trust root.

Final local evidence: `npm run verify` completed with 770 passing tests (one
existing skip), 39 browser E2E passes (five existing platform skips), 90.72% line
and 83.73% branch coverage. A later exact-release-identity regression and two
additional preparation cases passed with the final focused 67-test installer,
distribution, packaging, and release-contract run. Final typecheck, lint,
format, and whitespace checks passed after those changes. Broader gates were
not repeated for the final metadata identity check after its focused tests and
static checks passed. Public/platform release validation above is still open.

## v0.0.7 release decision — 2026-09-15

The user accepted publication of the new installation method as experimental
and deferred real end-user installation testing to the next release. This
supersedes the earlier requirement to complete that manual/platform evidence
before v0.0.7 publication; it does not mark unperformed tests as passed or disable
CI, prepared lifecycle/recovery fixtures, source contracts, or runtime hash checks.
The first managed-compatible version is `0.0.7`. Existing v0.0.6 workspaces need
a manual upgrade to that protocol-aware version before adoption.

Package and lockfile metadata and the changelog are prepared for v0.0.7.
The [publication runbook](../releases/v0.0.7.md) covers commit/PR, compatibility
variable, merge, tag, and generated asset publication. These remote steps have
not been executed as part of preparation.

## Required tracker follow-up

### Draft: Validate experimental installer and upgrades before the next release

Owner: repository maintainer. Target: the release following v0.0.7.
The user explicitly deferred these checks; they remain unfinished, not waived
permanently. This draft needs a GitHub issue record before memory closeout is ready.

Acceptance criteria:

- Record the exact release/commit, OS version, shell, architecture, and private
  Node version for macOS arm64/x64, Linux glibc x64, and Windows x64.
- Use the published installer on clean user environments without Node/Git;
  verify downloads, native dependencies, PATH in a new shell, browser opening,
  terminal closure, background run/stop/status/logs, and restart after reboot.
- Exercise latest and exact-version updates from v0.0.7 to the next candidate,
  persistence of projects/attachments, failed activation, interruption recovery,
  and manual-source adoption after upgrading the legacy source protocol.
- Verify manual source ZIP plus supported Node/npm installation remains usable.
- Record failures as defects, state supported platforms from actual evidence,
  and remove experimental wording only where the evidence supports it.

## Release preparation verification — 2026-09-15

`RELEASE_TAG=v0.0.7 npm run release:check` passed. The focused release-contract
and managed-packaging suite passed 46 tests. Repository `npm run format:check`,
`git diff --check`, generated-instructions module syntax, publication command
shell syntax, and 62 local documentation links/anchors passed. Review reconciled
the selected compatibility floor with the publication commands. No real
installation or full suite was rerun for this metadata/documentation preparation;
the runbook and release CI retain those automated gates before publication.
The earlier implementation verification above remains historical evidence.

## PR #30 CI regression verification — 2026-09-15

The initial Linux jobs exposed backup form overflow at 200% zoom. The document
no longer forces a 320px minimum through zoom; backup columns, children, and
buttons shrink/wrap within the available width. The E2E assertion now checks
panel width and both button edges. It reproduced a 544px panel in a 390px
viewport locally before the fix and passed afterward.

Windows helpers now isolate their built-in PowerShell modules from inherited
PowerShell 7 module paths. ACL application persists only changed owner/access
sections and verifies private inheritable access. Partial subprocess mocks keep
Windows permission calls available, and the profile test preserves actual
platform permissions. New conflicting-module and native ACL/capability tests
cover these boundaries; bootstrap ZIP tests now run on Windows too. Extraction
errors expose only fixed stage names and numeric codes.

`RELEASE_TAG=v0.0.7 npm run verify` passed locally on macOS: 779 unit/component/
integration tests (one existing skip), 39 browser tests (five existing skips),
91.23% line and 83.94% branch coverage, migrations, static checks, release
contract, high-severity audit gate, and prepared lifecycle/recovery fixtures.
The audit still reports one existing moderate advisory. Independent review found
no unresolved issue. Fresh Windows and Linux WebKit CI results remain required;
local verification is not evidence that the remote failures have passed.

## Published installer investigation — 2026-09-15

The public [v0.0.7 release](https://github.com/satankov/on-track/releases/tag/v0.0.7)
and its six assets are available. [Release CI](https://github.com/satankov/on-track/actions/runs/34989837301)
passed full Node 22.16/24 verification and managed fixtures on Windows x64,
Linux x64, macOS arm64 and x64. These are prepared-installation CI results,
not clean-OS bootstrap evidence.

Two failures reproduced against the published release:

- macOS `/bin/bash` 3.2.57 rejects an empty `forward` array under `set -u`,
  before invoking the downloaded Node bootstrap. The exact documented default
  command fails with `forward[@]: unbound variable`. Local conditional array
  expansion fixes zero-option and `--root`-only invocation without changing
  strict mode or argument boundaries. Three full-shell fixture tests cover
  those cases and populated arguments containing spaces/Unicode. The managed
  CI matrix now runs them with `/bin/bash` explicitly.
- The published updater requests GitHub metadata with binary `Accept`, which
  returns HTTP 415. The local downloader requests `application/vnd.github+json`
  on `api.github.com` and retains binary media types for assets. This follows
  [GitHub's release API](https://docs.github.com/en/rest/releases/releases#list-releases).
  Both exact/latest metadata regression tests failed before the fix; the binary
  redirect test and corrected metadata tests pass. Live read-only probes returned
  415 with the old header and 200 with JSON. Trust, size, checksum and redirect
  checks remain intact.

Native online evidence: macOS 15.7.9 arm64, Bash 3.2.57, downloaded private Node
24.14.0. Tests used a disposable home/runtime/data directory with spaces/Unicode,
an isolated port and an allowlisted tool PATH without Node, npm, Git, Python,
make or clang. Publisher asset digests were checked before execution.
This is the existing developer OS with masked tooling, not a clean machine.

- Unmodified published bootstrap reproduced the default failure and released
  its bootstrap claim. Retrying `bash ontrack-install.sh --no-open` downloaded
  and verified real Node/bootstrap/source assets, installed locked dependencies,
  built and started successfully. It printed the browser address. This is the
  documented temporary workaround; it does not fix the published updater.
- Published `run`, repeated `run`, `stop`, repeated `stop`, `status`, `logs`
  and restart passed. The server survived installer-process exit.
- With only the locally corrected compiled downloader copied into the disposable
  release, real exact/current and latest update selection passed. Updating the
  stopped app started it. Missing and unsupported old releases failed before
  activation. These results are for a locally patched client, not published v0.0.7.
- Repeating the locally fixed shell installer against real v0.0.7 downloads
  preserved the fixture project/note and attachment identities/bytes. The shell
  profile contained one PATH block; a new zsh found `ontrack`. Its system profile
  emitted a missing-`locale` warning due to the deliberately restricted PATH.
  Background startup also survived an interactive Bash pseudo-terminal exiting.
  All disposable managed servers were stopped after testing.

TDD commands: `npm test -- scripts/install-shell.test.ts` first reproduced the
two empty-array failures, then passed all three tests. `npm test --
src/server/cli/release.test.ts` reproduced both HTTP 415 cases, then passed.
The combined shell/release/distribution suite passed 36 tests.
Final `npm run verify` passed: 789 tests and one existing skip, 39 browser tests
and five existing skips, coverage above all 80% gates, build/types/lint/format,
migrations, release contract, audit and prepared lifecycle/update-recovery
fixtures. The production audit still reports one existing moderate Fastify
advisory. An initial sandboxed run could not bind test HTTP/IPC sockets; the
successful full run used the required local-server permissions.
Independent correctness/security review found no unresolved code issue;
the published-updater documentation limitation was added after review.

Remaining evidence: clean-user/OS runs and GUI-terminal closure on the supported
matrix, browser opening/reboot behavior, and a real published v0.0.7-to-newer
upgrade with its repaired entry path. Successful migration, failed-candidate
rollback, interruption recovery and attachment preservation remain verified by
local prepared fixtures, not by two real published managed releases. Fixes are
uncommitted and unpublished; no real installation/data or remote resources were
changed by this investigation.
