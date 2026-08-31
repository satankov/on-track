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
> **v0.0.1 is an early plaintext alpha.** Data stays local by default, but the
> database is not yet encrypted and backup/restore is not implemented. Do not use
> it for confidential, NDA-bound, or irreplaceable information yet.

## What works in v0.0.1

- Create and switch between personal project chats.
- Customize each project's title and accent.
- Add multiline plain-text notes with keyboard-friendly controls.
- Keep state after closing and restarting the application.
- Use the main flow at desktop and mobile browser widths.
- Run without accounts, telemetry, or an internet connection after installation.

Attachments, built-in TODO/open-question/decision labels, filtering, encryption,
backup/restore, native installers, and peer-to-peer iPhone sync are roadmap work.

## Quick start

### Prerequisite

Install [Node.js 24 LTS](https://nodejs.org/) (npm is included), then download or
clone this repository and open a terminal in its folder.

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

On Track stores `on-track.sqlite` in the operating system's application-data
folder, **outside the Git checkout**:

| Operating system | Default folder                                           |
| ---------------- | -------------------------------------------------------- |
| macOS            | `~/Library/Application Support/On Track/`                |
| Windows          | `%APPDATA%/On Track/`                                    |
| Linux            | `$XDG_DATA_HOME/on-track/` or `~/.local/share/on-track/` |

SQLite databases, journals, backups, exports, and common local development
artifacts are ignored by Git. The release check also fails if a database file is
ever tracked. You can isolate evaluation data with an absolute disposable path:

```sh
ON_TRACK_DATA_DIR=/absolute/path/to/on-track-data npm start
```

PowerShell equivalent:

```powershell
$env:ON_TRACK_DATA_DIR = "C:\absolute\path\to\on-track-data"
npm start
```

Local ownership is not the same as encryption: anyone who can read your account's
application-data directory can currently read the database.

## Project direction

- [Product vision and roadmap](docs/PROJECT.md)
- [Architecture and data boundaries](docs/ARCHITECTURE.md)
- [v0.0.1 release plan](docs/plans/0002-v0.0.1-release-readiness.md)
- [Localhost stack decision](docs/adr/0001-localhost-typescript-sqlite.md)
- [Encryption posture](docs/adr/0002-defer-at-rest-encryption.md)
- [Source release decision](docs/adr/0003-source-release-pipeline.md)
- [Apache-2.0 license decision](docs/adr/0005-apache-2-license.md)
- [Security policy](SECURITY.md)

## License

On Track is open-source software under the [Apache License 2.0](LICENSE). It may
be used, modified, and distributed for personal or commercial purposes subject
to the license terms. The software is provided without warranties or conditions.
