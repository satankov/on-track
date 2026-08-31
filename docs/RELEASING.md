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
dependency audit. GitHub CI repeats it on a clean Linux runner and checks native
installation/tests on Linux, macOS, and Windows.

## Prepare a version

1. Start a release branch from current `main`.
2. Move completed changelog entries from **Unreleased** to a dated version.
3. Update both manifest versions without creating a tag:

   ```sh
   npm version 0.0.2 --no-git-tag-version
   ```

4. Run `RELEASE_TAG=v0.0.2 npm run release:check` and `npm run verify`.
5. Open a release pull request titled `chore: release v0.0.2` and merge only
   after all required checks and review pass.

For v0.0.1 the version and changelog files are already prepared.

## Publish after merge

From an up-to-date, clean `main` checkout, verify the commit and then create and
push an annotated matching tag:

```sh
git tag -a v0.0.2 -m "On Track v0.0.2"
git push origin v0.0.2
```

The release workflow checks out that exact revision, validates the version/tag
and tracked-data contract, verifies that the tagged commit belongs to `main`,
installs from the lockfile, runs the complete suite, and creates a GitHub Release
with generated notes. A failed gate creates no release. Never move or reuse a
published version tag; fix the issue in a new version.

## Rollback and incident response

GitHub Releases are immutable historical artifacts. If a release is defective,
mark it as affected in the changelog/security advisory and publish a corrected
new version. Do not overwrite its tag. Since v0.0.1 has no automatic updater,
users choose when to install the fixed source release.
