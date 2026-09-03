# Releasing On Track

On Track uses reviewed version changes and automated tag-gated publication. The
authoritative version exists in `package.json`; `package-lock.json`, the changelog,
and release tag must agree.

## One-time GitHub repository setup

After the repository is public, an owner should:

1. Set the default branch to `main`.
2. Add a ruleset requiring pull requests, one approving review, resolved
   conversations, linear history, and the CI, portability, dependency-review,
   and CodeQL checks. Block force pushes and branch deletion.
3. Add a tag ruleset targeting `v*.*.*`: restrict tag creation, update, and
   deletion to the repository's release administrators. A release tag must point
   to a commit already on protected `main`.
4. Enable Dependabot alerts/security updates, secret scanning and push protection,
   private vulnerability reporting, and CodeQL default/setup visibility.
5. Enable immutable releases and require two-factor authentication for maintainers.
6. Keep workflow permissions read-only by default. Do not enable approval-free
   workflows from forks.

These are remote administrative changes and are intentionally not made by source
files.

## Development and test flow

Every change follows this path:

```text
issue/design -> branch -> RED/GREEN tests -> npm run verify -> pull request
             -> CI + security + review -> merge to main
```

`npm run verify` is the local source of truth: release contract, build, types,
lint/format, coverage, migration integration, real-browser E2E, and production
dependency audit. GitHub CI repeats it on clean Linux runners using Node 22.16
and 24, then checks native SQLite dependency installation/tests for both
runtimes on Linux, macOS, and Windows. Native desktop launcher smoke tests
remain separate manual release evidence.

## Prepare a version

1. Start a release branch from current `main`.
2. Move completed changelog entries from **Unreleased** to a dated version.
3. Update both manifest versions without creating a tag:

   ```sh
   npm version 0.0.4 --no-git-tag-version
   ```

4. Run `RELEASE_TAG=v0.0.4 npm run release:check` and `npm run verify`.
5. Open a release pull request titled `chore: release v0.0.4` and merge only
   after all required checks and review pass.

## Publish after merge

From an up-to-date, clean `main` checkout, verify the commit and then create and
push an annotated matching tag:

```sh
git tag -a v0.0.4 -m "On Track v0.0.4"
git push origin v0.0.4
```

The release workflow checks out that exact revision, validates the version/tag,
runtime, and tracked-data contracts, verifies that the tagged commit belongs to
`main`, installs from the lockfile, runs the complete suite on Node 22.16 and 24,
and creates a GitHub Release with generated notes. A failed gate creates no
release. Never move or reuse a published version tag; fix the issue in a new
version.

## Rollback and incident response

GitHub Releases are immutable historical artifacts. If a release is defective,
mark it as affected in the changelog/security advisory and publish a corrected
new version. Do not overwrite its tag. On Track has no automatic updater, so
users choose when to install the fixed source release.
