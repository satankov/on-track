# ADR-0007: Support Node.js 22.16 on macOS/Linux and Node.js 24 on Windows

## Status

Accepted for v0.0.4. This supersedes only ADR-0003's Node-24-only runtime
choice; source delivery and the tag-gated release pipeline remain unchanged.

## Context

The initial release selected Node.js 24 as one conservative supported runtime,
but the application does not use Node-24-only APIs. The locked source-build tree
dependency floor permits Node 22 from 22.13.0, but the first cross-platform run
exposed Windows filesystem failures at that version. Raising the floor to
22.16.0 and normalizing the known libuv file-identity inconsistency did not make
the full Windows test suite reliable. The same exact Node 22.16 revision passes
on macOS and Linux, while Node 24 passes on all three operating systems. Vite's
minimum is 22.12.0, and `better-sqlite3` declares Node 22 and 24 support.

Node 22.16 embeds libuv 1.49.2, whose Windows path-stat and descriptor-fstat
implementations can expose different upper bits for the same volume serial
number. On Track's attachment and staged-upload safety checks compare those two
views to prevent path replacement, so the runtime difference must be normalized
without discarding file identity.

On Track remains a source release, so development dependencies used by
`npm run quickstart` are part of the end-user runtime floor. Native SQLite must
also install and execute on every supported operating system.

## Decision

- Support the explicit npm engine range `^22.16.0 || ^24.0.0`; npm engine ranges
  cannot express an operating-system-specific alternative.
- Support Node 22.16 or newer on the Node 22 line only on macOS and Linux.
- Require Node 24 on Windows and reject unsupported runtime/platform pairs at
  server startup with a specific error.
- Exclude Node 22.0-22.15, odd-numbered majors, and unknown future majors.
- Keep Node 24 as the preferred maintainer runtime in `.nvmrc` while testing the
  exact Node 22.16 floor.
- Typecheck against Node 22 declarations so application code does not
  intentionally depend on a later major.
- Use exact BigInt device and inode values for file-identity checks. On Windows,
  compare the documented low 32 bits of the volume serial number while retaining
  exact inode equality, matching the correction shipped by later libuv versions.
- Run full Linux verification for both supported Node lines. Run clean native-
  install coverage for both lines on Linux and macOS and for Node 24 on Windows.
  Release publication waits for full verification on both lines.
- Retire Node 22 support no later than its upstream end-of-life date unless a
  later reviewed decision extends the compatibility policy.

## Alternatives considered

- Keep Node 24 only: smallest CI matrix, but imposes a newer runtime without a
  technical requirement.
- Declare `>=22.16`: concise, but silently claims support for EOL odd majors and
  untested future releases.
- Declare `>=22`: incorrectly includes unverified Node 22 minors.
- Support Node 20 as well: some runtime dependencies permit it, but the current
  source-build toolchain does not, and expanding the matrix further has no
  demonstrated alpha benefit.

## Consequences

Node 22 users on macOS and Linux can install and run v0.0.4, while Node 24 remains
supported on all three tested operating systems. CI and release verification
take longer, and dependency upgrades must preserve both lines or explicitly
revise this ADR. Node 22 reaches upstream end of life before Node 24, so
documentation and future releases must not imply indefinite support. The Windows
compatibility normalization keeps symlink, regular-file, canonical containment,
inode, and before/after identity checks intact.
Windows users must install Node 24. Because npm cannot encode this conditional
engine range, the server performs the platform-specific check before loading the
application and reports the required runtime directly.

## Verification

- Release-contract tests enforce the exact manifest and lockfile engine range.
- Runtime-policy tests prove that Windows rejects Node 22 and accepts Node 24,
  while macOS and Linux accept Node 22.16 and Node 24.
- CI performs clean installs, native SQLite loading, build, typecheck, and tests
  on Node 22.16 and 24 across Linux and macOS and on Node 24 on Windows.
- Full Linux verification, including browser E2E and dependency audit, runs on
  both supported Node lines in CI and before tagged publication.

## Sources

- [Node.js release schedule](https://github.com/nodejs/Release)
- [npm package engine metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#engines)
- [Node 22.16 bundled libuv version](https://raw.githubusercontent.com/nodejs/node/v22.16.0/deps/uv/include/uv/version.h)
- [libuv Windows volume-serial consistency fix](https://github.com/libuv/libuv/commit/82cdfb75ff9bbd0dc65820ca418b7c5d412ff4d7)
- [Windows volume information](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddk/ns-ntddk-_file_fs_volume_information)
- [CI evidence for the platform-specific support boundary](https://github.com/satankov/on-track/actions/runs/33753337308)
