# threadstr compatibility identifiers

The next release changes the product name from On Track to **threadstr** and
makes **thr** the primary CLI command. v0.0.8 remains the latest published
release until then. The selected candidate is v0.0.9. The repository and existing
published releases retain their real names and URLs.

## Commands and installation

`thr` and `ontrack` select the same active release, private runtime, recorded data
folder, and port. Both support `run`, `stop`, `status`, `logs`, `update`, `install`,
`maintenance-recover-import`, help, `--version`, and `--describe-runtime` with
existing argument behavior. The alias remains supported throughout 0.x and until
separately approved removal. Removal requires notice in at least two published
releases and a migration review; there is no scheduled removal version.

After publication, v0.0.8 users can run `ontrack update`, or rerun the new
installer using the existing root. The old updater can print its old product
name during this transition. New invocations use threadstr. v0.0.7's updater has
a published HTTP 415 defect; use a corrected installer against the same root.
Custom-root users must continue supplying their existing root where required.

Setup/update must stop safely for an unrelated `thr` executable at its target or
on executable PATH. Resolve the reported conflict explicitly and retry. Do not
create a second installation or move project data to work around it. The
`--no-profile` option does not bypass collision checks. Profiles are not sourced
to discover aliases/functions; inspect your shell and use the printed absolute
managed launcher path when needed.

## Deliberately retained identifiers

| Surface                | Retained compatibility contract                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data folders           | macOS `~/Library/Application Support/On Track`, Windows `%APPDATA%/On Track`, Linux `$XDG_DATA_HOME/on-track` or `~/.local/share/on-track`                                                                                    |
| Runtime folders        | macOS/Windows `On Track Runtime`; Linux `on-track-runtime`; custom recorded roots remain authoritative                                                                                                                        |
| Environment            | `ON_TRACK_DATA_DIR`, `ON_TRACK_PORT`, `ON_TRACK_INSTALL_ROOT`, `ON_TRACK_MANAGED_LAUNCH`, `ON_TRACK_NATIVE_FILE`, `ON_TRACK_PRIVATE_DIRECTORY`, `ONTRACK_BOOTSTRAP_*`, installer template tokens and archive-helper variables |
| Database and ownership | `on-track.sqlite` and sidecars, `.on-track-owner.sqlite`, `.on-track-install-owner.sqlite`, `.on-track-instance.json`, existing update/restore journals, staging and checkpoint names                                         |
| Managed state          | `install.json`, `active.json`, `shim-runtime.json`, `last-update.json`, authenticated control endpoints and protocol shapes                                                                                                   |
| Backups                | `.on-track-backup`, MIME `application/vnd.on-track.backup+sqlite`, application ID `0x4f545242`, `_on_track_bundle*` tables, format 1/schema 7 and supported legacy descriptors                                                |
| Browser preferences    | `on-track-theme`, `on-track-show-examples`, same local origin and saved port                                                                                                                                                  |
| Shell profiles         | Existing On Track marker delimiters, allowing reuse without duplicate PATH blocks                                                                                                                                             |
| Distribution           | `satankov/on-track` URLs, `on-track-vX.Y.Z.zip`, installer/bootstrap/manifest filenames, protocol 1 and managed compatibility floor `0.0.7`                                                                                   |

Backup download display names begin `threadstr-`; the format and extension stay
compatible. No database migration or data-path relocation is part of this change.
Do not rename existing files, rewrite backup tables, or edit shipped migrations.
Keeping ownership identities also prevents old and new launchers from opening
the same data folder concurrently.

Historical changelogs, release examples, ADR/plan rationale, logo exploration
provenance, negative compatibility fixtures, and data-protection exclusion
patterns retain the old name deliberately. Current guidance supersedes historical
instructions. See [installation](install/README.md) and
[ADR-0010](adr/0010-threadstr-identity-and-cli-transition.md).
