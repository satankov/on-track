# Install On Track on Windows

## Quick setup — one command

> **Experimental in v0.0.7:** end-user installation and OS validation are
> deferred to the next release. The command requires published installer files
> from v0.0.7 or later. [Manual setup](#manual-setup) remains available.

Open PowerShell in a folder you own and paste this line:

```powershell
try { Invoke-WebRequest -UseBasicParsing https://github.com/satankov/on-track/releases/latest/download/install.ps1 -OutFile ontrack-install.ps1 -ErrorAction Stop; powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ontrack-install.ps1 } catch { throw }
```

Setup downloads private Node and the application dependencies, builds On Track,
and opens your browser with the server running in the background. You can close
PowerShell after setup. Git, a system Node installation, and administrator
access are not required. The execution-policy setting applies to this process.

The initial target is Windows x64; Windows ARM64 is not included. Windows
verification is still pending.

Open a **new PowerShell window** after setup, then use:

```powershell
ontrack stop
ontrack run
ontrack status
ontrack update
```

Run `ontrack run` after a reboot. See [commands and updates](README.md#commands-and-updates)
for logs and updating to a specific version.

### Install a specific version

Replace `releases/latest/download` in the command with
`releases/download/v0.0.9`, substituting a published version that includes
installer files. v0.0.9 is an example.

### Download first, then run

```powershell
Invoke-WebRequest -UseBasicParsing https://github.com/satankov/on-track/releases/latest/download/install.ps1 -OutFile ontrack-install.ps1
```

Open `ontrack-install.ps1` in a text editor, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ontrack-install.ps1
```

For a custom data folder or port, use this **instead** of the default run command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ontrack-install.ps1 -DataDir "$HOME\On Track Data" -Port 4180 -NoOpen
```

Setup remembers these choices. `-NoOpen` skips opening the browser. `-Root`
changes the runtime folder; `-NoProfile` **after the script filename** skips
adding `ontrack` to your user PATH. Runtime and data folders must be separate.
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

### 2. Download On Track

Choose a version in [Releases](https://github.com/satankov/on-track/releases),
download **Source code (zip)**, and select **Extract All** in File Explorer.
Open PowerShell in the extracted folder containing `package.json`.
Git users can clone the repository and check out a published release tag instead.

### 3. Install and start

```powershell
npm.cmd run quickstart
```

Open [On Track](http://127.0.0.1:4173). Keep PowerShell open while using the app.
Press **Ctrl+C** to stop. For later starts, run `npm.cmd start` from that folder.

For a custom data folder or port:

```powershell
$env:ON_TRACK_DATA_DIR = "$HOME\On Track Data"
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
