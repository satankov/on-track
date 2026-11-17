# Contributing to threadstr

Search the [issue tracker](https://github.com/satankov/on-track/issues) before
reporting a bug or proposing a feature. For a bug, include your threadstr
version, operating system, steps to reproduce it, and what you expected to
happen. Use fictional projects and files in reports, screenshots, and tests.
Report suspected vulnerabilities through the [security policy](SECURITY.md).

For changes to storage, packaging, or how data moves between systems, open an
issue to discuss the design and its effect on existing projects. The
[architecture guide](docs/ARCHITECTURE.md) and [decision records](docs/adr/)
describe the existing constraints.

## Development setup

Use Node.js 24 LTS as the preferred maintainer runtime and the locked dependency
tree. On macOS and Linux, Node.js 22 is also supported from version 22.16.0 and
is exercised at its exact floor in CI. Windows development requires Node.js 24.
In PowerShell, use `npm.cmd` and `npx.cmd` if script execution is restricted.

```sh
npm ci
npx playwright install chromium webkit
```

Start the development server with a separate data folder to keep test projects
away from your own workspace. Pick an absolute path on your computer.

**macOS or Linux**

```sh
ON_TRACK_DATA_DIR=/absolute/disposable/path npm run dev
```

**Windows PowerShell**

```powershell
$env:ON_TRACK_DATA_DIR = "C:\absolute\disposable\path"
npm.cmd run dev
```

Open the local URL printed by Vite. Press Ctrl+C in the terminal to stop.

## Change workflow

1. Keep one change focused on one outcome.
2. Write a failing behavioral test before implementation when behavior changes.
3. Implement the smallest passing change, then refactor while tests stay green.
4. Run `npm run verify` before requesting review. It builds the app and runs
   type, lint, formatting, coverage, migration, browser, dependency, release,
   and managed CLI checks.
5. Review the entire diff for data loss, security, regression, and missing tests.
6. Use a [Conventional Commit](https://www.conventionalcommits.org/) title such
   as `feat: add note labels` or `fix: preserve drafts after save failure`.

Database changes require a new checked-in migration. Never edit a migration that
has shipped. Tests must use disposable databases and must not inspect a user's
default data directory.

## Pull requests

Describe the user-visible outcome, tests, migration/data impact, security impact,
and remaining limitations. CI must pass on Linux, macOS, and Windows where the
workflow applies. Maintainers may request an ADR for durable architecture choices.

Do not submit third-party code without explicit maintainer approval and documented
license compatibility. Unless explicitly stated otherwise, an intentionally
submitted contribution is licensed under [Apache License 2.0](LICENSE), as
described in section 5 of that license. Submit only work you have the right to
contribute.
