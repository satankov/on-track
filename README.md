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

## Quick start

### macOS and Linux

> **Experimental in v0.0.7:** platform validation is ongoing.
> [Manual setup](#manual-setup) remains available.

Open Terminal and run:

```sh
curl -fsSL https://github.com/satankov/on-track/releases/latest/download/install.sh -o ontrack-install.sh && bash ontrack-install.sh --no-open
```

Setup downloads Node and the application dependencies, builds On Track, and
starts the server in the background. Open the address printed by setup in your
browser. `--no-open` avoids a v0.0.7 installer bug in macOS's bundled Bash and
skips automatic browser opening. Git and a preinstalled Node are not required.
You can close Terminal after setup finishes.

Open a new terminal to use:

```sh
ontrack stop              # Stop the server
ontrack run               # Start it again
ontrack update            # Install the latest stable version and start it
```

After restarting your computer, run `ontrack run` again.

The published v0.0.7 updater currently fails with HTTP 415 before activation.
Its fix is not yet published; see [update limitations](docs/install/README.md#commands-and-updates).

Full guides, including specific versions and custom settings:
[macOS](docs/install/macos.md) · [Linux](docs/install/linux.md) ·
[Windows](docs/install/windows.md).

### Manual setup

1. Install [Node.js](https://nodejs.org/en/download): **24** on Windows;
   **24** or **22.16+ on the Node 22 line** on macOS/Linux. npm is included.
2. Download **Source code (zip)** from [Releases](https://github.com/satankov/on-track/releases)
   and extract it, or clone this repository with Git.
3. Open a terminal in the extracted folder and run:

   ```sh
   npm run quickstart
   ```

Open [On Track](http://127.0.0.1:4173). Keep the terminal open; **Ctrl+C** stops
it. For later starts, run `npm start` from the same folder. After downloading a
new source version, run `npm run quickstart` there again. On PowerShell, use
`npm.cmd` in place of `npm` if script execution is blocked.

## What works in this checkout

- Create and switch between personal project chats; click On Track to return Home.
- Resume each project at its remembered reading position during the current
  browser session. First visits open near current work and the first future
  message; future messages remain accessible through normal scrolling.
- Pin important projects above the activity-sorted project list, and independently
  collapse Pinned and Projects during the current browser session.
- Customize each project's title and accent.
- Add multiline Markdown notes with a compact, selection-aware formatting strip
  for bold, italic, links, quotes, lists, checklists, code, and GFM tables. The
  add/edit input grows to eight lines before scrolling internally.
- Attribute a message to a participant from the compact Sender row. Participant
  messages use neutral bubbles on the left with a stable colored sender name and
  retain the same labels, filters, files, and message actions as your own notes.
- Apply permanent Pin and Attention labels plus project-enabled Todo, Decision,
  Open question, Risk, and Milestone labels, then filter history by label.
- Expand and collapse long Markdown notes, with a persisted per-project default
  configured from Edit project.
- Copy, edit, timestamp-adjust, and delete notes.
- Schedule future-dated messages and see where the history crosses into the
  future through a silent full-width fade that clears as timestamps arrive.
- Scan plain-text previews of the latest message up to the current time and current
  or earlier Attention status directly in the project sidebar.
- Attach local files to notes, filter messages with files, open eligible files
  through the operating system's default association, and show them in their
  managed folder. Executable and launcher-like files are blocked from Open.
- Filter messages containing Markdown/GFM links with the automatic Links filter
  after Files, without applying a label.
- Export selected projects or all projects to one `.on-track-backup` bundle.
- Preview backup projects, then import selected projects by merging independent
  copies or replacing the whole database.
- Keep project data after closing and restarting the application. Reading
  positions and sidebar collapse state reset when the browser reloads.
- Use the main flow at desktop and mobile browser widths.
- Run without accounts, telemetry, or an internet connection after installation.

Native Open/Show in Folder has been manually reported working on one macOS host.
Windows and Linux native-action smoke verification, encryption, native
installers, and peer-to-peer iPhone sync are roadmap work. Open delegates to an
installed default application; On Track does not provide embedded PowerPoint or
document editing.

### Markdown assistance

Use the `M↓` control beside Attach and Timestamp to reveal the compact Markdown
strip. Select existing text before choosing an action to format that selection;
with no selection, the editor inserts an editable placeholder. Quote inserts a
Markdown blockquote (`> text`), and Table inserts a two-column GFM table
skeleton. The same strip is available while adding or editing a message.

The common shortcuts work whenever the message textarea is focused, even while
the strip is closed:

| Action                        | Shortcut           |
| ----------------------------- | ------------------ |
| Bold / Italic / Link / Code   | Cmd/Ctrl+B/I/K/E   |
| Numbered list / Bulleted list | Cmd/Ctrl+Shift+7/8 |
| Checklist / Quote             | Cmd/Ctrl+Shift+9/. |

Cmd/Ctrl+Enter continues to submit the message. Table is click/tap only.

### Participant attribution

Use the sender control beside Markdown, Attachments, and Timestamp to reveal one
compact row. Leave **You** selected for the usual right-aligned note, or enter a
sender name to place that message on the left. The selected name stays in the
composer for consecutive messages until you choose **You**. Sender names are
plain attribution text; On Track still has no participant accounts or shared
project access.

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
import a versioned backup bundle. Export and import lists select all projects by
default, including pinned and archived projects. **Export all** always includes
every project; **Export selected** includes only checked projects and their files.

Import first previews the backup. **Merge DB** (the default) adds selected projects
as independent copies, preserving existing projects. Names that exactly match an
existing or another imported project receive a UTC import timestamp, for example
`Roadmap_2026-09-09_14-30-00Z`, and a counter when needed. **Replace whole DB**
removes all current projects and files after confirmation; only the selected
imported projects remain. Neither mode merges individual messages.

Preview and import each transfer the file locally for validation. Do not retry
an import automatically if its result could not be confirmed; refresh and inspect
your projects first. Backups remain plaintext. Each bundle is limited to 2 GiB,
10,000 attachments, 100 MiB per attachment, and 1 GiB total attachment bytes.
Explicit project selections allow up to 10,000 projects and 1 MiB of options.
A merge can grow the workspace beyond one bundle's limits; use selective export
for smaller project sets.

The current checkout uses schema 7 and accepts schema-7 and schema-6 backups plus
strictly validated schema-5, schema-4 development, and v0.0.4/schema-3 backups; it
does not restore v0.0.3/schema-2 bundles. Older
supported databases migrate during startup. You can isolate evaluation data
with an absolute disposable path:

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
- [Managed CLI delivery decision](docs/adr/0008-managed-install-and-cli.md)
- [Security policy](SECURITY.md)

## License

On Track is open-source software under the [Apache License 2.0](LICENSE). It may
be used, modified, and distributed for personal or commercial purposes subject
to the license terms. The software is provided without warranties or conditions.
