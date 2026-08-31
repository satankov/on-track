# Changelog

All notable changes to On Track are documented here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is
below `1.0.0`, minor versions may contain breaking changes.

## [Unreleased]

## [0.0.1] - 2026-08-31

### Added

- Personal project chats with persistent title and accent customization.
- Multiline plain-text notes in deterministic chronological order.
- Local SQLite persistence owned by a loopback-only application server.
- Responsive, keyboard-accessible desktop and mobile browser workflows.
- One-command source quick start with `npm run quickstart`.
- Apache License 2.0 open-source license, contributor guidance, security policy,
  and automated CI/security/release gates.

### Security

- Host and Origin validation, same-origin production UI/API, strict content
  security policy, parameterized persistence, and literal note rendering.
- Application data defaults to the operating-system data directory and database
  files are excluded from Git.

### Known limitations

- Local data is plaintext and the app has no backup/restore workflow. Do not use
  v0.0.1 for confidential, NDA-bound, or irreplaceable data.
- Distribution is source-based and requires Node.js 24; native installers are not
  included.
