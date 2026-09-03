# Contributing to On Track

Thank you for helping improve a private-by-design personal project tracker.

## Before you start

- Search existing issues before opening a duplicate.
- Use an issue for a material feature or architecture change so scope and data-
  safety consequences can be discussed first.
- Never include a real On Track database, export, attachment, secret, NDA text,
  or other personal data in an issue, test, screenshot, or pull request.
- Read [the architecture](docs/ARCHITECTURE.md) and relevant ADRs before changing
  persistence, trust boundaries, packaging, or sync assumptions.

## Development setup

Use Node.js 24 LTS as the preferred maintainer runtime and the locked dependency
tree. Node.js 22 is also supported from version 22.16.0 and is exercised at its
exact floor in CI:

```sh
npm ci
npx playwright install chromium webkit
npm run dev
```

Development data can be isolated explicitly:

```sh
ON_TRACK_DATA_DIR=/absolute/disposable/path npm run dev
```

## Change workflow

1. Keep one change focused on one outcome.
2. Write a failing behavioral test before implementation when behavior changes.
3. Implement the smallest passing change, then refactor while tests stay green.
4. Run `npm run verify` before requesting review.
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
