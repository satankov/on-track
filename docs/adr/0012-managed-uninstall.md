# ADR-0012: Remove only owned artifacts during managed uninstall

## Status

Accepted through approval of plan 0027 on 2026-10-21. Implementation is for the
next release. No database or backup schema change.

## Decision

`thr uninstall` removes recorded managed code, private runtimes/dependencies,
known logs, launchers, and checkpoints, preserving project data. The separate
`--delete-data` option selects the app-owned data namespace. Both preview exact
paths and require confirmation; `--yes` alone never selects data deletion.

Use existing installation/data ownership and authenticated graceful shutdown.
Refuse unresolved update/restore, unsafe root aliases, changed targets, and
modified launchers. Never recover or force-kill as an uninstall side effect.
Retain unknown files and unmarked staging; name patterns alone do not prove
ownership. Remove only exact installer-owned PATH entries without sourcing
profiles or changing system Node/npm.

A bounded private uninstall record captures original file identities and paths.
Retry validates its closed path inventory and identities, allowing absent
already-removed items. Other managed operations reject a pending uninstall.
Deletion is not atomic and cannot roll back deleted projects.

Retain ownership files on all platforms. Unlinking after releasing ownership
can remove a new owner's lock; unlinking before release is also unsafe because
closing the old SQLite handle can remove a replacement journal by pathname.
Stable small lock files contain no project content and permit safe reinstallation.

Windows uses a short-lived, non-detached PowerShell launcher to start fixed cleanup
code in a private external working directory. Direct detached PowerShell can
exit before executing the script without a console; a PowerShell-created child
also avoids Node's parent-exit job cleanup. Fixed encoded launcher code passes
script/job paths through environment values, never shell interpolation. Cleanup uses
literal JSON arguments, recorded target identities, bounded waits for the CLI
and dispatcher, and no process killing. Runtime cleanup starts after those
processes exit. Current managed commands honor the uninstall marker before and after lock acquisition. A receipt
reports completion or failure; launching the helper alone is only pending.

## Consequences

The application and private dependencies can be removed without touching a
manual checkout, shared tools, original attachments, or user exports. Unknown
staging may need explicit user cleanup. A Windows receipt and small ownership locks
remain. Older binaries cannot retroactively honor the new marker.

Real platform evidence is required separately: macOS disposable-process smoke
passes locally; Windows/Linux native uninstall smoke remains unverified. The
managed smoke command supports Node 22 through direct source CLI and Node 24
through the two-process dispatcher. Windows helper invocation tests are not a
substitute for native executable-locking tests.
