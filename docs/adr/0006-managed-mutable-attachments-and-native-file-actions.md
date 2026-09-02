# ADR-0006: Managed mutable attachments with guarded native file actions

## Status

Accepted for the v0.0.3 plaintext alpha. Automated command-shape coverage
exists for macOS, Windows, and Linux. Manual native dispatch has been
user-reported on one macOS host; Windows and Linux desktop smoke verification
remains pending.

## Context

An attachment stored as a SQLite BLOB has no stable operating-system path for an
external application to edit. Moving bytes to sidecars makes that workflow
possible, but introduces consistency, backup, recovery, path-validation, and
native-dispatch boundaries that SQLite cannot make atomic on its own.

The application remains a source-distributed localhost web app rather than a
packaged desktop shell. Native actions therefore cross from a same-origin
browser request through the local server to an operating-system launcher and
must not accept a browser-supplied path or shell command.

## Decision

- SQLite owns attachment identity and metadata. File bytes live only in
  owner-only managed paths beneath `attachments/v1/`; stored paths are relative,
  repository-owned, and unique.
- `ManagedAttachmentStore` is the sole authority that validates a stored path
  and resolves it to a canonical absolute target. Missing, unreadable, and
  unsafe files remain recoverable records.
- Creation publishes and flushes a file before committing its database
  reference. Deletion commits reference removal before best-effort cleanup.
  Compensation can leave an orphan, but it must not remove a referenced file.
- External edits preserve attachment and note identity plus `storage_path`.
  Project reads and file actions refresh observed size and modification time.
- A portable `.on-track-backup` SQLite container temporarily embeds a complete,
  strictly validated attachment payload inventory. Restore generates new safe
  managed paths, removes payload tables before activation, and uses a journaled
  replacement protocol. v0.0.3 is the compatibility baseline; raw SQLite and
  the unreleased development BLOB schema are not imported.
- Native Open and Show in Folder POST routes accept scoped IDs and an empty JSON
  object only. They require exact browser-origin and Fetch Metadata checks, run
  behind the maintenance gate and a shared rate limit, and resolve ownership and
  paths on the server. Responses and recoverable errors do not disclose paths.
- Dispatch uses fixed executables, structured arguments, `shell: false`, and a
  bounded wait. macOS uses `/usr/bin/open`; Windows uses fixed PowerShell for
  Open and Explorer for reveal; Linux uses `/usr/bin/xdg-open` and opens the
  containing directory for reveal.
- Open is denied for known executable, installer, script, shortcut,
  application, and desktop-launcher names and for executable POSIX files. Show
  in Folder is authorized independently.
- No production dependency or native packaging layer is introduced.

## Alternatives considered

- Keep attachment BLOBs and browser downloads: simpler transactional ownership,
  but no stable editable path and no reliable write-back workflow.
- Store arbitrary original user paths: preserves external location, but weakens
  ownership, portability, deletion, backup completeness, and path safety.
- Add ZIP or TAR backups: familiar formats, but adds archive traversal, link,
  collision, and decompression boundaries plus another dependency.
- Export the database without sidecars: produces a backup that appears valid but
  silently omits user files.
- Add a desktop shell and native IPC now: can narrow the localhost boundary, but
  adds packaging and platform complexity before storage and encryption mature.
- Use shell strings or `cmd.exe /c start`: increases injection and quoting risk.
- Permit every default association: would turn an attachment click into a
  launcher for clearly executable content.
- Require exact Linux file-manager selection: desktop support is inconsistent;
  opening the containing directory is the portable baseline.

## Consequences

- Database and filesystem writes use explicit ordering and compensation rather
  than one transaction. Crashes and cleanup failures may leave unreferenced
  files that later maintenance can reclaim conservatively.
- Managed attachments and backup bundles remain plaintext. Quarantine and
  Windows zone metadata are not preserved by managed copies, and macro-capable
  documents remain content-level risks.
- Pathname-based launch and cleanup retain a small same-user time-of-check/time-
  of-use window. Owner-only directories, canonical resolution, no-follow reads,
  and the one-trusted-local-user model reduce but do not eliminate it.
- Native action success means that the launcher accepted the request, not that a
  desktop application completed an edit. Linux reveal does not guarantee exact
  file selection.
- Real Windows Explorer/PowerShell association behavior and Linux desktop
  association behavior remain release risks until manually smoke-tested.

## Verification

- Store tests cover path grammar, canonical containment, symlinks, permissions,
  external edits, broken states, publication, and cleanup ordering.
- Migration, repository, service, API, backup, restore, and recovery tests prove
  metadata-only active databases, stable identity, complete bundles, scoped
  routes, compensation, and interrupted-restore handling.
- Native policy and adapter tests cover macOS, Windows, and Linux command shapes,
  hostile filenames, `shell: false`, fixed executables, failure normalization,
  and blocked file types.
- Playwright injects an E2E-only fake adapter and proves attach -> Open/Show
  request -> direct sidecar edit -> focus refresh -> restart while retaining the
  same attachment ID and storage path. It never launches a desktop application.
- On 2026-09-02, the project owner reported that the current checkout's native
  attachment flow worked on their macOS host. Windows and Linux manual native
  dispatch remain unverified.
