# Install On Track on macOS

## Quick setup — one command

> **Experimental in v0.0.7:** end-user installation and OS validation are
> deferred to the next release. The command requires published installer files
> from v0.0.7 or later. [Manual setup](#manual-setup) remains available.

Open Terminal and run:

```sh
curl -fsSL https://github.com/satankov/on-track/releases/latest/download/install.sh -o ontrack-install.sh && bash ontrack-install.sh
```

Setup downloads a private Node runtime, installs the dependencies, builds On
Track, and opens your browser. The server runs in the background, so you can
close Terminal. Git, a system Node installation, and administrator access are
not required.

Target: Apple Silicon and Intel Macs. Platform verification is still pending.
Internet access and `bash`, `curl`, `tar`, `unzip`, `zipinfo`, `mktemp`, and
`shasum` or `sha256sum` are required. Setup reports any missing tools.

Open a **new terminal** after setup, then use:

```sh
ontrack stop
ontrack run
ontrack status
ontrack update
```

Run `ontrack run` after a reboot. See [commands and updates](README.md#commands-and-updates)
for logs and updating to a specific version.

### Install a specific version

Use that release's installer URL instead of `latest`. For example, **if
v0.0.9 has been published with installer files**:

```sh
curl -fsSL https://github.com/satankov/on-track/releases/download/v0.0.9/install.sh -o ontrack-install.sh && bash ontrack-install.sh
```

### Download first, then run

To inspect the script or choose installation options, download it separately:

```sh
curl -fsSL https://github.com/satankov/on-track/releases/latest/download/install.sh -o ontrack-install.sh
```

Open `ontrack-install.sh` in a text editor, then run:

```sh
bash ontrack-install.sh
```

For a custom data folder or port, use this **instead** of the default run command:

```sh
bash ontrack-install.sh --data-dir "$HOME/On Track Data" --port 4180 --no-open
```

Setup remembers these choices. `--no-open` skips opening the browser;
`--root /absolute/path` changes the application runtime folder; `--no-profile`
skips adding `ontrack` to your shell profile. Runtime and data folders must be
separate. Use `bash ontrack-install.sh --help` for all options.

## Manual setup

### 1. Install Node

Install [Node.js](https://nodejs.org/en/download) **24**, or **22.16 or newer on
the Node 22 line**. npm is included. Open a new terminal and check:

```sh
node --version
npm --version
```

### 2. Download On Track

Choose a version in [Releases](https://github.com/satankov/on-track/releases),
download **Source code (zip)**, and extract it. Open a terminal in the extracted
folder containing `package.json`. Git users can clone the repository and check
out a published release tag instead.

### 3. Install and start

```sh
npm run quickstart
```

Open [On Track](http://127.0.0.1:4173). Keep this terminal open while using the
app. Press **Ctrl+C** to stop. For later starts, run `npm start` from the same
folder.

For a custom data folder or port:

```sh
ON_TRACK_DATA_DIR="$HOME/On Track Data" ON_TRACK_PORT=4180 npm run quickstart
```

Supply the same variables with `npm start` on later launches.
See [manual updates](README.md#manual-updates) before installing a newer version.

## Files and existing projects

- Project data: `~/Library/Application Support/On Track/`.
- Application and private Node: `~/Library/Application Support/On Track Runtime/`.

To move an existing manual installation to the background command workflow,
follow [switching from manual setup](README.md#existing-projects-and-manual-installations).
For startup, download, or update problems, see [troubleshooting](README.md#if-something-goes-wrong).
