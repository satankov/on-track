# On Track

**Your projects, remembered like a chat — private on your own computer.**

On Track is an open-source personal project tracker for managers, project
managers, and anyone whose decisions, meeting notes, questions, and next steps
are scattered across folders, email, spreadsheets, and chats with themselves.

Each project becomes a simple private stream. Add a note as naturally as sending
yourself a message, return later, and keep the context together. On Track is not
a team messenger: there are no accounts, members, presence indicators, cloud
services, analytics, or remote runtime assets.

> [!IMPORTANT]
> **This is an early plaintext alpha.** Data stays local by default, and the app
> can export/import versioned backups containing the database and attachments,
> but local data and backups are not yet encrypted. Do not use it for
> confidential, NDA-bound, or irreplaceable information yet.

## What works in this checkout

- Create and switch between personal project chats.
- Customize each project's title and accent.
- Add multiline Markdown notes with keyboard-friendly controls.
- Copy, edit, timestamp-adjust, and delete notes.
- Attach local files to notes, filter messages with files, open eligible files
  through the operating system's default association, and show them in their
  managed folder. Executable and launcher-like files are blocked from Open.
- Export and restore one versioned `.on-track-backup` bundle from Settings.
- Keep state after closing and restarting the application.
- Use the main flow at desktop and mobile browser widths.
- Run without accounts, telemetry, or an internet connection after installation.

Native Open/Show in Folder has been manually reported working on one macOS host.
Windows and Linux native-action smoke verification, built-in TODO/open-question/
decision labels, encryption, native installers, and peer-to-peer iPhone sync are
roadmap work. Open delegates to an installed default application; On Track does
not provide embedded PowerPoint or document editing.

## Quick start

### Prerequisite

Install [Node.js](https://nodejs.org/) 22.16 or newer on the Node 22 LTS line, or
Node.js 24 LTS (npm is included). Then download or clone this repository and
open a terminal in its folder. Odd-numbered Node releases are not supported.

### First run — one command

```sh
npm run quickstart
```

This installs the exact locked dependencies, builds the browser UI and local
server, applies database migrations, and starts On Track. Open
[http://127.0.0.1:4173](http://127.0.0.1:4173).

Press **Ctrl+C** in that terminal to stop the application. Your project data
remains on your computer for the next start.

### Later starts

```sh
npm start
```

If you download a newer source version, run `npm run quickstart` once again so
its exact dependencies and build output are refreshed.

## Where your data lives

On Track stores `on-track.sqlite` and managed attachment files in the operating
system's application-data folder, **outside the Git checkout**:

| Operating system | Default folder                                           |
| ---------------- | -------------------------------------------------------- |
| macOS            | `~/Library/Application Support/On Track/`                |
| Windows          | `%APPDATA%/On Track/`                                    |
| Linux            | `$XDG_DATA_HOME/on-track/` or `~/.local/share/on-track/` |

SQLite databases, journals, backups, exports, and common local development
artifacts are ignored by Git. The release check also fails if a database file is
ever tracked. Use the Settings button at the bottom of the sidebar to export or
restore a versioned backup bundle. Restore replaces current local projects and
files rather than merging them. The v0.0.4 alpha accepts only backups created by
v0.0.4; it does not restore v0.0.3/schema-2 bundles. A live v0.0.3 database is
still migrated during startup. You can isolate evaluation data with an absolute
disposable path:

```sh
ON_TRACK_DATA_DIR=/absolute/path/to/on-track-data npm start
```

PowerShell equivalent:

```powershell
$env:ON_TRACK_DATA_DIR = "C:\absolute\path\to\on-track-data"
npm start
```

Local ownership is not the same as encryption: anyone who can read your account's
application-data directory can currently read the database and attachments.

## Project direction

- [Product vision and roadmap](docs/PROJECT.md)
- [Architecture and data boundaries](docs/ARCHITECTURE.md)
- [v0.0.1 release plan](docs/plans/0002-v0.0.1-release-readiness.md)
- [Localhost stack decision](docs/adr/0001-localhost-typescript-sqlite.md)
- [Encryption posture](docs/adr/0002-defer-at-rest-encryption.md)
- [Source release decision](docs/adr/0003-source-release-pipeline.md)
- [Apache-2.0 license decision](docs/adr/0005-apache-2-license.md)
- [Managed attachment and native-action decision](docs/adr/0006-managed-mutable-attachments-and-native-file-actions.md)
- [Node 22/24 runtime decision](docs/adr/0007-node-22-and-24-runtime-support.md)
- [Security policy](SECURITY.md)

## License

On Track is open-source software under the [Apache License 2.0](LICENSE). It may
be used, modified, and distributed for personal or commercial purposes subject
to the license terms. The software is provided without warranties or conditions.
