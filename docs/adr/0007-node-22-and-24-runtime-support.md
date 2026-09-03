# ADR-0007: Support Node.js 22.13 and 24 LTS lines

## Status

Accepted for v0.0.4. This supersedes only ADR-0003's Node-24-only runtime
choice; source delivery and the tag-gated release pipeline remain unchanged.

## Context

The initial release selected Node.js 24 as one conservative supported runtime,
but the application does not use Node-24-only APIs. The locked source-build tree
supports Node 22 from 22.13.0: ESLint and jsdom establish that minimum, Vite's
minimum is 22.12.0, and `better-sqlite3` declares Node 22 and 24 support.

On Track remains a source release, so development dependencies used by
`npm run quickstart` are part of the end-user runtime floor. Native SQLite must
also install and execute on every supported operating system.

## Decision

- Support the explicit npm engine range `^22.13.0 || ^24.0.0`.
- Exclude Node 22.0-22.12, odd-numbered majors, and unknown future majors.
- Keep Node 24 as the preferred maintainer runtime in `.nvmrc` while testing the
  exact Node 22.13 floor.
- Typecheck against Node 22 declarations so application code does not
  intentionally depend on a later major.
- Run full Linux verification and clean native-install coverage on Linux,
  macOS, and Windows for both supported Node lines. Release publication waits
  for full verification on both lines.
- Retire Node 22 support no later than its upstream end-of-life date unless a
  later reviewed decision extends the compatibility policy.

## Alternatives considered

- Keep Node 24 only: smallest CI matrix, but imposes a newer runtime without a
  technical requirement.
- Declare `>=22.13`: concise, but silently claims support for EOL odd majors and
  untested future releases.
- Declare `>=22`: incorrectly includes dependency-incompatible Node 22 minors.
- Support Node 20 as well: some runtime dependencies permit it, but the current
  source-build toolchain does not, and expanding the matrix further has no
  demonstrated alpha benefit.

## Consequences

Node 22 users can install and run v0.0.4, while Node 24 remains supported. CI and
release verification take longer, and dependency upgrades must preserve both
lines or explicitly revise this ADR. Node 22 reaches upstream end of life before
Node 24, so documentation and future releases must not imply indefinite support.

## Verification

- Release-contract tests enforce the exact manifest and lockfile engine range.
- CI performs clean installs, native SQLite loading, build, typecheck, and tests
  on Node 22.13 and 24 across Linux, macOS, and Windows.
- Full Linux verification, including browser E2E and dependency audit, runs on
  both supported Node lines in CI and before tagged publication.

## Sources

- [Node.js release schedule](https://github.com/nodejs/Release)
- [npm package engine metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#engines)
