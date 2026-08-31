# ADR-0003: Source release and tag-gated delivery pipeline

## Status

Accepted for v0.0.1. Its original MIT-license choice was superseded first by
ADR-0004 and finally by ADR-0005; the source-delivery and tag-gated pipeline
decisions remain current.

## Context

On Track needs a reproducible first public release and a professional path for
later versions. The runtime currently includes a native SQLite dependency, while
native application packaging, signing identities, and supported installer formats
have not been designed or verified. Publishing an npm package is also misleading:
the application is a local service and browser UI, not a reusable library.

Release automation crosses a privileged boundary because it can write repository
releases. It must not bypass verification or grant write access to ordinary CI.

## Decision

Distribute v0.0.1 as a GitHub source release requiring Node.js 24. Users run
`npm run quickstart` once from a source checkout and stop the foreground process
with `Ctrl+C`. ADR-0005 defines the current public source license.

Development uses pull requests with required CI and security checks. A release PR
updates `package.json`, `package-lock.json`, and `CHANGELOG.md`. After it merges,
an owner creates an annotated SemVer tag such as `v0.0.1`. The tag workflow:

1. checks out the immutable tagged revision;
2. verifies package, lockfile, and tag agreement plus repository data hygiene;
3. reruns the complete quality and security suite; and
4. uses GitHub's runner-provided CLI to create the GitHub Release with generated
   notes.

Only the final release job receives `contents: write`; normal CI is read-only.
Third-party actions are pinned to full commit SHAs.

## Alternatives considered

- **Native installers now:** best eventual user experience, but requires
  packaging, signing, update, platform, and encryption/data-path decisions that
  would turn the thin release slice into a new product phase.
- **Docker:** reproducible but poor for a personal desktop workflow and introduces
  volume/port ownership complexity.
- **npm publication:** not appropriate for an end-user application and risks
  implying a supported global CLI contract.
- **Release Please immediately:** useful when maintainers want automated version
  selection and release PRs, but it adds token/PR-trigger configuration and hides
  part of the first-release learning loop. It can replace the manual release PR
  later without changing the tag validation contract.
- **Background start/stop scripts:** introduce platform-specific daemon and stale
  PID handling. A foreground process with `Ctrl+C` is simpler and safer for alpha.

## Consequences

The first release is honest and reproducible but is not a native one-click
installer. Users need Node.js 24 and npm. Release versioning remains an explicit,
reviewable maintainer action while build, test, security, validation, and GitHub
publication are automated. Repository owners must enable documented GitHub branch
and release settings after creating the remote.

## Verification

Unit tests cover the release contract. CI exercises the project on the supported
operating-system matrix. The tag workflow reruns the authoritative local
verification command before any release write. A fresh-copy smoke test verifies
the documented quick-start path and confirms data stays outside the checkout.
