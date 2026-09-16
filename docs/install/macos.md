# Install threadstr on macOS

> **Next-release guidance:** this branch prepares threadstr and `thr`. The latest
> published release is still [On Track v0.0.8](https://github.com/satankov/on-track/releases/tag/v0.0.8),
> whose installer provides `ontrack`. Until the next release is published, the
> `latest` downloads below install v0.0.8; use its
> [installation guide](https://github.com/satankov/on-track/tree/v0.0.8/docs/install)
> and `ontrack` commands. v0.0.9 is the selected candidate and is not yet published.

## Quick setup — one command

> **Experimental managed installation:** platform validation is ongoing.
> [Manual setup](#manual-setup) remains available.

Open Terminal and run:

```sh
curl -fsSL https://github.com/satankov/on-track/releases/latest/download/install.sh -o thr-install.sh && bash thr-install.sh --no-open
```

Setup downloads a private Node runtime, installs the dependencies, builds
threadstr, and starts the server in the background. Open the address printed by
setup in your browser; you can then close Terminal. `--no-open` skips automatic
browser opening. v0.0.8 fixes the published v0.0.7 installer's
`forward[@]: unbound variable` error in macOS's bundled Bash. For an already
saved v0.0.7 installer, `--no-open` remains the workaround. Git, a system Node
installation, and administrator access are not required.

Target: Apple Silicon and Intel Macs. Platform verification is still pending.
Internet access and `bash`, `curl`, `tar`, `unzip`, `zipinfo`, `mktemp`, and
`shasum` or `sha256sum` are required. Setup reports any missing tools.

Open a **new terminal** after setup, then use:

```sh
thr stop
thr run
thr status
thr update
```

Run `thr run` after a reboot. See [commands and updates](README.md#commands-and-updates)
for logs and updating to a specific version.

### Install a specific version

Use the exact tag of an already published release with installer assets. Replace
`vX.Y.Z` below with that tag; the placeholder is not a selected next version:

```sh
release_tag=vX.Y.Z
curl -fsSL "https://github.com/satankov/on-track/releases/download/$release_tag/install.sh" -o thr-install.sh && bash thr-install.sh --no-open
```

### Download first, then run

To inspect the script or choose installation options, download it separately:

```sh
curl -fsSL https://github.com/satankov/on-track/releases/latest/download/install.sh -o thr-install.sh
```

Open `thr-install.sh` in a text editor, then run:

```sh
bash thr-install.sh --no-open
```

For a new custom data folder or port, use this **instead** of the default run
command. Existing users must substitute their recorded data path; do not switch
to the sample path during an upgrade:

```sh
bash thr-install.sh --data-dir "$HOME/threadstr Data" --port 4180 --no-open
```

Setup remembers these choices. `--no-open` skips opening the browser;
`--root /absolute/path` changes the application runtime folder; `--no-profile`
skips adding `thr` to your shell profile. Runtime and data folders must be
separate. Use `bash thr-install.sh --help` for all options.

## Manual setup

### 1. Install Node

Install [Node.js](https://nodejs.org/en/download) **24**, or **22.16 or newer on
the Node 22 line**. npm is included. Open a new terminal and check:

```sh
node --version
npm --version
```

### 2. Download threadstr

Choose a version in [Releases](https://github.com/satankov/on-track/releases),
download **Source code (zip)**, and extract it. Open a terminal in the extracted
folder containing `package.json`. Git users can clone the repository and check
out a published release tag instead.

### 3. Install and start

```sh
npm run quickstart
```

Open [threadstr](http://127.0.0.1:4173). Keep this terminal open while using the
app. Press **Ctrl+C** to stop. For later starts, run `npm start` from the same
folder.

For a custom data folder or port (reuse your existing data path when upgrading):

```sh
ON_TRACK_DATA_DIR="$HOME/threadstr Data" ON_TRACK_PORT=4180 npm run quickstart
```

Supply the same variables with `npm start` on later launches.
See [manual updates](README.md#manual-updates) before installing a newer version.

## Files and existing projects

- Project data: `~/Library/Application Support/On Track/`.
- Application and private Node: `~/Library/Application Support/On Track Runtime/`.

To move an existing manual installation to the background command workflow,
follow [switching from manual setup](README.md#existing-projects-and-manual-installations).
For startup, download, or update problems, see [troubleshooting](README.md#if-something-goes-wrong).

The retained legacy data and runtime names are deliberate; see
[compatibility guidance](../compatibility.md).
