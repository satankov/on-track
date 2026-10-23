# Install and run threadstr

> Managed installations include `thr` and the `ontrack` compatibility alias.
> Uninstall requires v0.1.0 or later; update older installations first.

Choose your guide: **[macOS](macos.md)** · **[Linux](linux.md)** · [Windows](windows.md).
Each starts with a one-command installer, followed by download-first and manual
Node/npm instructions.

## Choose an installation method

|               | Quick setup                                   | Manual setup                                    |
| ------------- | --------------------------------------------- | ----------------------------------------------- |
| Prerequisites | Standard OS download/archive tools            | Node with npm; Git optional                     |
| Installation  | One command downloads Node and builds the app | Download source; run `npm run quickstart`       |
| Start / stop  | `thr run` / `thr stop`                        | `npm start` / Ctrl+C in the source folder       |
| Update        | `thr update`                                  | Download new source; rerun `npm run quickstart` |
| Terminal      | Can close after startup                       | Stays open while using the app                  |

Both methods run the same local browser application and keep projects separate
from application code. Neither starts automatically after a reboot.

**Experimental installer:** v0.0.8 has published installer assets;
installation/OS validation is ongoing. Releases showing only **Source code (zip)**,
**Source code (tar.gz)**, and an attestation are source-only; use manual setup
with their ZIP archive. Older releases do not gain installer files automatically.

## Commands and updates

**v0.0.7 limitation:** its published `ontrack update` command fails with HTTP 415
before activation. v0.0.8 fixes this and the macOS Bash installer defect. To leave
v0.0.7, rerun a published corrected installer against the same runtime and data
folders; retrying the old updater does not repair its client bug.

After quick setup, open a new terminal:

| Command             | Action                                                 |
| ------------------- | ------------------------------------------------------ |
| `thr run`           | Start in the background and open the browser           |
| `thr stop`          | Stop the managed server                                |
| `thr status`        | Show server status and address                         |
| `thr logs`          | Show recent server logs                                |
| `thr update`        | Install the latest stable release and start the server |
| `thr update vX.Y.Z` | Install a specific published compatible version        |

Replace `vX.Y.Z` with an already published compatible release tag. Updates accept stable releases with installer
support; development branches, prereleases, and downgrades are not supported.
An unavailable version leaves the working server running.

Save browser drafts before updating. The command prepares the new version,
then asks before restarting. Reload your browser tabs after it finishes.
Export a backup in Settings before important upgrades; update recovery files
are not a replacement for a full backup.

Use `thr run --no-open` to start without opening a browser, and
`thr --help` for command options. Start again with `thr run` after a reboot.

<a id="uninstall-next-release"></a>

## Uninstall

These commands require v0.1.0 or later. Run `thr --help` to check whether your
installed CLI supports them.

Remove the managed application, its private Node/npm, installed dependencies,
recorded old releases, known logs, and update checkpoints, while keeping projects:

```sh
thr uninstall
```

To also delete projects, messages, and managed attachments:

```sh
thr uninstall --delete-data
```

The command shows the exact runtime and data locations before asking for
confirmation. Export a backup in Settings before deleting data. Cancellation
does not stop the server or change files. Use `--yes` to confirm noninteractively;
data deletion still requires the separate `--delete-data` option. `ontrack`
supports the same commands. For a custom installation, append `--root` followed
by its absolute runtime directory in quotes.

Only recorded app artifacts are removed. Unrecognized files, unmarked interrupted
installer staging folders, exported backups, original files outside managed
attachments, manual source checkouts, and system Node/npm remain. Retained paths
are reported; review them before deleting anything manually. Exact owned shell
PATH entries are removed; modified or ambiguous profile blocks remain with
cleanup guidance. Open a new terminal afterward. Browser appearance preferences
can be removed through the browser's site-data controls.

On Windows, the command first stops the app, then schedules remaining runtime
cleanup after both CLI and dispatcher exit. **Pending is not complete.** Read the
printed `result.txt` path to confirm completion or see the failure. A failed job
retains `cleanup.ps1` and `job.json` beside that receipt; retry with PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\exact\printed\cleanup.ps1" -JobFile "C:\exact\printed\job.json"
```

Use the actual printed paths. The helper removes its script/job on success;
the receipt remains for inspection. On all operating systems, small ownership
lock files remain in the runtime/data folders to avoid racing another local
process; they contain no project content. Actual Windows and Linux
uninstall smoke validation remains pending; macOS has local disposable-fixture
evidence. This does not widen the installer's experimental platform guarantees.

An interrupted macOS/Linux uninstall retains a validated removal record. Retry
the same command/options. If the launcher has already been removed, use a built
source checkout of this version (or a compatible newer one):

```sh
node dist/server/server/cli/main.js uninstall --root "/absolute/runtime/path"
```

Include `--delete-data` again if it was originally selected. Conflicting owners,
pending update/restore journals, replaced targets, and unsafe paths are refused.
Do not remove those guards just to force cleanup.

### Remove a manual source installation

Stop the foreground app with Ctrl+C. Delete the extracted source folder after
checking for personal files or uncommitted work; this also removes its local
`node_modules` and build output. To delete project data as well, separately remove
the exact data directory listed in your OS guide (or the `ON_TRACK_DATA_DIR` you
selected), after exporting any needed backup. Keep shared system Node/npm unless
you independently intend to remove them. Saved installer scripts and downloaded
archives outside the managed directory can be deleted separately.

## Transition from On Track

An existing v0.0.8 installation can run
`ontrack update`. Alternatively, run the new installer against its same runtime
root (pass `--root` / `-Root` if customized). The old updater may print its old
product name once; subsequent commands use threadstr. Both launchers select the
same installation, data folder, and port. Do not create a second data directory.

`ontrack` remains supported throughout 0.x and until separately approved removal.
Removal requires notice in at least two published releases and a migration review.
See [retained compatibility identifiers](../compatibility.md).

If an unrelated `thr` exists in the destination or executable PATH, installation
or update stops before activation. Resolve the reported conflict explicitly and
retry; do not delete an unfamiliar program. `--no-profile` does not bypass this
check. Shell aliases/functions are not inspected by sourcing profiles; check
your shell resolution and use the absolute managed launcher path printed by setup.

## Manual updates

1. Export a backup in **Settings** and save browser drafts.
2. Stop the old server with **Ctrl+C**.
3. Download and extract the new source release into a separate folder.
4. Run `npm run quickstart` there (`npm.cmd run quickstart` on PowerShell).

The new version uses the same default data folder. If you chose a custom
`ON_TRACK_DATA_DIR`, supply that same path again. Git users can update their
checkout to the desired release while preserving local edits, then rerun
`npm run quickstart`.

A new release may migrate your database. Do not run older code against migrated
data; keeping the old source folder alone does not undo an upgrade.

## Existing projects and manual installations

To switch to quick setup, first update manually to a published release that
supports the installer. Build it, check your projects, and stop it with Ctrl+C.
Download the installer as described in your OS guide, then pass the absolute
path to that built source folder:

macOS / Linux:

```sh
bash thr-install.sh --adopt-from "/absolute/path/to/threadstr-source"
```

Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\thr-install.ps1 -AdoptFrom "C:\absolute\path\to\threadstr-source"
```

If you use a custom data folder, also pass `--data-dir` (macOS/Linux) or
`-DataDir` (Windows) with its existing absolute path. Projects stay in that
folder. Keep your source folder and backups until you have checked the new setup.
Legacy v0.0.6 and unpublished/custom builds cannot be adopted directly.

## Data and backups

| System  | Default project data folder                              |
| ------- | -------------------------------------------------------- |
| macOS   | `~/Library/Application Support/On Track/`                |
| Linux   | `$XDG_DATA_HOME/on-track/` or `~/.local/share/on-track/` |
| Windows | `%APPDATA%\On Track\`                                    |

Use **Settings → Export** to save a `.on-track-backup` containing projects and
attachments. Store backups separately from the live data folder. Do not back up
by copying only a running SQLite database: that omits attachments and may miss
recent changes. Local data and backups are not encrypted.
See [data and backup details](../../README.md#where-your-data-lives).

## If something goes wrong

| Problem                                 | What to do                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download returns `404`                  | The selected release has no installer file. Use its source ZIP and manual setup, or choose a release with installer files.                                                             |
| `forward[@]: unbound variable` on macOS | The published v0.0.7 installer needs an optional flag with macOS's Bash. Retry the downloaded v0.0.7 installer with `--no-open`, then open the printed address.                        |
| `thr` is not found                      | Open a new terminal, or use the full command path printed by setup. If you skipped PATH changes, add the printed `bin` folder yourself.                                                |
| Browser did not open                    | Open the address shown by `thr status`. The default is [127.0.0.1:4173](http://127.0.0.1:4173).                                                                                        |
| Port or data already in use             | Stop the existing server with its own stop command or Ctrl+C. A different port does not allow two servers to share one data folder.                                                    |
| Install/update failed                   | Read the error and printed log location. Keep the database and recovery files; rerun the command to attempt recovery. If recovery refuses to continue, retain the files for diagnosis. |
| Node/npm not found in manual setup      | Reopen the terminal after installing a supported Node version. On Windows, use `npm.cmd` if `npm.ps1` is blocked.                                                                      |
| Missing tool or native build error      | Install the reported prerequisite for your OS. Setup does not install system packages or compilers; check your Node version and platform.                                              |
| Proxy/certificate error                 | Use your organisation's approved network settings. Quick setup does not import your custom `.npmrc`; manual setup is available for custom npm configuration.                           |

Remove sensitive paths or other private details before sharing logs.
