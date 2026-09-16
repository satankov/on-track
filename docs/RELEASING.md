# Releasing threadstr

threadstr uses reviewed version changes and automated tag-gated publication. The
authoritative version exists in `package.json`; `package-lock.json`, the changelog,
and release tag must agree.

## v0.0.7 experimental installer exception

The user approved v0.0.7 delivery on 2026-09-15 with real end-user installation
and OS validation deferred to the next release. This exception supersedes the
manual installation evidence requirement below for v0.0.7 only. Automated CI,
prepared lifecycle/recovery fixtures, release contracts, and runtime hash checks
remain mandatory. Installer instructions and release notes disclose the limit.
The first managed-compatible version and `MANAGED_MINIMUM_VERSION` are `0.0.7`.
Follow the [v0.0.7 publication commands](releases/v0.0.7.md); deferred acceptance
criteria live in [plan 0021](plans/0021-managed-install-and-cli.md#required-tracker-follow-up).

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
7. Before the first managed release, set the repository Actions variable
   `MANAGED_MINIMUM_VERSION` to the reviewed first protocol-aware stable version
   (`X.Y.Z`, without `v`). Keep that compatibility floor for later compatible
   releases; do not guess it from the current schema or silently raise it.

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
runtimes on Linux and macOS and for Node 24 on Windows. Managed lifecycle/update
checks run through the separate managed-install workflow. Prepared-artifact
smokes exercise real processes and disposable databases; they are not proof of
a first online install on a machine without Node/Git. Real installer, terminal
closure, PATH/new-shell, browser dispatch, and upgrade evidence must be recorded
for each advertised OS/architecture. Native attachment Open/Show smoke tests
remain separate desktop evidence.

## Prepare a version

1. Start a release branch from current `main` and choose an unused stable
   `X.Y.Z`. In the commands below, set `release_version` to that chosen value.
   Never reuse a published version or invent a managed compatibility floor.
2. Move completed changelog entries from **Unreleased** to a dated version.
3. Update both manifest versions without creating a tag:

   ```sh
   npm version "$release_version" --no-git-tag-version
   ```

4. Run `RELEASE_TAG="v$release_version" npm run release:check` and
   `npm run verify`. Complete the managed release checks below.
5. Open a release pull request titled `chore: release v<version>` and merge only
   after all required checks and review pass.

## Managed release assets and runtime verification

Manual source ZIP/Git installation remains supported. Managed installation
additionally requires these assets uploaded to the same release before it is
published:

- `on-track-vX.Y.Z.zip`: fixed committed source archive, with no enclosing folder.
- `managed-release.json`: protocol, build/schema identity, exact source inventory,
  compatibility floor, source hash/size, and pinned Node assets.
- `managed-bootstrap.mjs`: the bounded first-install helper.
- `install.sh` and `install.ps1`: generated installers with the release tag,
  helper SHA-256, and exact manifest SHA-256 substituted into their templates.

The source scripts retain template markers and intentionally refuse installation.
Do not upload them directly as standalone installers. Do not change the manifest
after rendering installers: their pinned digest authenticates those exact bytes
before source build scripts can execute.

From clean, committed source after `npm ci` and `npm run build`:

```sh
node scripts/verify-managed-runtime.mjs
npm run release:managed -- --output /absolute/path/to/empty-assets --minimum-version "$MANAGED_MINIMUM_VERSION"
```

The output directory must be empty and outside the source checkout. Packaging
refuses local changes/untracked files, unsafe or private/data entries, links,
Windows path aliases, and unsupported Git export attributes. Source limits are
10,000 regular files, 20 MiB per file, 100 MiB expanded, and 240-character safe
ASCII relative paths. These limits agree with the installer manifest contract.
The source fingerprint must match the verified build inputs; building assets
does not publish them.

`scripts/managed-runtime.json` pins Node 24.14.0 for macOS arm64/x64, Linux x64,
and Windows x64. The verification command downloads the official checksum list
and all four runtime archives with size/time limits, streams their SHA-256, and
requires exact pinned sizes/digests. It does not extract, install, or execute
downloads. Updating a runtime pin requires reviewing upstream runtime support
and security, refreshing the shell/PowerShell bootstrap constants, and repeating
native dependency and platform checks. Keep manifests and bootstrap pins aligned.

**Signing limitation:** this command does not verify Node's detached publisher
signature. The initial channel trusts the fixed HTTPS publisher, reviewed
checked-in hashes, and GitHub's immutable asset records. Hashes fetched from that
same channel are not independent signatures. Independent signing/key management
requires a separate reviewed implementation; do not describe these assets as
cryptographically publisher-signed by threadstr.

Before advertising a managed platform, record the exact OS version, architecture,
private Node patch, native SQLite installation result, first install without
system Node/Git, new-shell PATH, terminal closure, start/stop, and a real update
with recovery/persistence checks. The proposed platform matrix is not evidence
that every combination has passed. If a gate is missing, keep that release or
platform unadvertised instead of substituting a prepared smoke claim.

## Publish after merge

From an up-to-date, clean `main` checkout, verify the commit and then create and
push an annotated matching tag:

```sh
git tag -a "v$release_version" -m "threadstr v$release_version"
git push origin "v$release_version"
```

The release workflow checks out that exact revision, validates the version/tag,
runtime, and tracked-data contracts, verifies that the tagged commit belongs to
`main`, installs from the lockfile, and runs the complete Linux suite on Node
22.16 and 24 plus the managed workflow. The publish job verifies every pinned
official runtime archive, generates fixed assets, uploads them to a draft
GitHub Release with generated notes, and publishes the completed draft. A failed
verification gate prevents publication. An interrupted upload/publication can
leave a draft; inspect it before retrying rather than overwriting assets blindly.
Never move or reuse a published version tag; fix the issue in a new version.

README and platform guides disclose experimental installation and the next-release
branding boundary. After publication, update the current-release notice. Verify publication includes `install.sh` and `install.ps1`;
commands cannot work before those assets exist. Download the complete installer
successfully before executing it. Remove experimental wording only after the
deferred installation/platform validation passes in the next release.

## Rollback and incident response

GitHub Releases are immutable historical artifacts. If a release is defective,
mark it as affected in the changelog/security advisory and publish a corrected
new version. Do not overwrite its tag. Users choose when to run
`thr update` or install the corrected source release manually; normal use
does not poll for updates.

Managed upgrades refuse older releases. Before activation commits, the journal
can restore the matching old application/database pair. After commit, never
restore an old checkpoint automatically: users may already have saved new work.
Manual users must export backups and stop the server before upgrading. Retaining
old source alone does not undo a database migration. Preserve ambiguous journals
and checkpoints for recovery instead of deleting data or forcing a downgrade.

Release packaging also generates `INSTALL.md` with version-specific macOS/Linux
and PowerShell one-command setup plus links to the full manual/managed guides.
The release workflow prepends it to generated notes. These commands are only
usable after the corresponding assets are published.

## threadstr transition release gate

The next release introduces threadstr and `thr`; its version remains unselected.
Preserve the `on-track-vX.Y.Z.zip` asset pattern, repository URLs, bootstrap tokens,
manifest protocol, and managed compatibility floor `0.0.7`. Published v0.0.8
clients require these identities. See [compatibility](compatibility.md) and
[ADR-0010](adr/0010-threadstr-identity-and-cli-transition.md).

Before release, run `node scripts/managed-upgrade-compat.mjs --baseline v0.0.8`
after the build, plus the managed platform workflow. The harness uses unchanged
published source and a controlled candidate transport, not a live published upgrade.
Complete native OS and published-upgrade checks before claiming those guarantees.
Do not modify published assets, tags, or historical changelog entries.
