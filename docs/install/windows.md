# Install threadstr on Windows

> **Next-release guidance:** this branch prepares threadstr and `thr`. The latest
> published release is still [On Track v0.0.8](https://github.com/satankov/on-track/releases/tag/v0.0.8),
> whose installer provides `ontrack`. Until the next release is published, the
> `latest` downloads below install v0.0.8; use its
> [installation guide](https://github.com/satankov/on-track/tree/v0.0.8/docs/install)
> and `ontrack` commands. No next version has been selected.

## Quick setup — one command

> **Experimental managed installation:** end-user installation and OS validation are
> deferred to the next release. The command requires published installer files
> from v0.0.7 or later. [Manual setup](#manual-setup) remains available.

Open PowerShell in a folder you own and paste this line:

```powershell
try { Invoke-WebRequest -UseBasicParsing https://github.com/satankov/on-track/releases/latest/download/install.ps1 -OutFile thr-install.ps1 -ErrorAction Stop; powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\thr-install.ps1 } catch { throw }
```

Setup downloads private Node and the application dependencies, builds threadstr,
and opens your browser with the server running in the background. You can close
PowerShell after setup. Git, a system Node installation, and administrator
access are not required. The execution-policy setting applies to this process.

The initial target is Windows x64; Windows ARM64 is not included. Windows
verification is still pending.

Open a **new PowerShell window** after setup, then use:

```powershell
thr stop
thr run
thr status
thr update
```

Run `thr run` after a reboot. See [commands and updates](README.md#commands-and-updates)
for logs and updating to a specific version.

### Install a specific version

Replace `releases/latest/download` in the command with
`releases/download/vX.Y.Z`, replacing `vX.Y.Z` with an already published tag
that includes installer files. This placeholder does not select the next version.

### Download first, then run

```powershell
Invoke-WebRequest -UseBasicParsing https://github.com/satankov/on-track/releases/latest/download/install.ps1 -OutFile thr-install.ps1
```

Open `thr-install.ps1` in a text editor, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\thr-install.ps1
```

For a new custom data folder or port, use this **instead** of the default run
command. Existing users must substitute their recorded data path; do not switch
to the sample path during an upgrade:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\thr-install.ps1 -DataDir "$HOME\threadstr Data" -Port 4180 -NoOpen
```

Setup remembers these choices. `-NoOpen` skips opening the browser. `-Root`
changes the runtime folder; `-NoProfile` **after the script filename** skips
adding `thr` to your user PATH. Runtime and data folders must be separate.
Use `-Help` after the script filename for all options.

## Manual setup

### 1. Install Node 24

Install [Node.js 24](https://nodejs.org/en/download) for Windows; npm is included.
Open a new PowerShell window and check:

```powershell
node --version
npm.cmd --version
```

Node 22 is not supported on Windows. `npm.cmd` runs the usual npm commands
without PowerShell trying to execute `npm.ps1`.

### 2. Download threadstr

Choose a version in [Releases](https://github.com/satankov/on-track/releases),
download **Source code (zip)**, and select **Extract All** in File Explorer.
Open PowerShell in the extracted folder containing `package.json`.
Git users can clone the repository and check out a published release tag instead.

### 3. Install and start

```powershell
npm.cmd run quickstart
```

Open [threadstr](http://127.0.0.1:4173). Keep PowerShell open while using the app.
Press **Ctrl+C** to stop. For later starts, run `npm.cmd start` from that folder.

For a custom data folder or port (reuse your existing data path when upgrading):

```powershell
$env:ON_TRACK_DATA_DIR = "$HOME\threadstr Data"
$env:ON_TRACK_PORT = "4180"
npm.cmd run quickstart
```

Set the same variables before `npm.cmd start` on later launches.
See [manual updates](README.md#manual-updates) before installing a newer version.

## Files and existing projects

- Project data: `%APPDATA%\On Track\`.
- Application and private Node: `%LOCALAPPDATA%\On Track Runtime\`.

To move an existing manual installation to the background command workflow,
follow [switching from manual setup](README.md#existing-projects-and-manual-installations).
For startup, download, or update problems, see [troubleshooting](README.md#if-something-goes-wrong).

The retained legacy data and runtime names are deliberate; see
[compatibility guidance](../compatibility.md).
