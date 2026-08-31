export const requiredReleaseFiles = [
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/RELEASING.md",
  ".nvmrc",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/release.yml",
];

export const expectedLicense = "Apache-2.0";

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const databasePathPattern =
  /(?:^|\/)[^/]+\.(?:sqlite3?|db3?|s3db)(?:[-.](?:wal|shm|journal|backup|bak))?$/i;
const onTrackBackupOrExportPattern =
  /(?:\.on-track-(?:backup|export)$|(?:^|\/)on-track-(?:backups|exports)(?:\/|$))/i;

export function findForbiddenTrackedDataFiles(trackedFiles) {
  return trackedFiles.filter(
    (path) =>
      databasePathPattern.test(path) || onTrackBackupOrExportPattern.test(path),
  );
}

export function validateReleaseContract(input) {
  const errors = [];

  if (
    input.packageLicense !== undefined &&
    input.packageLicense !== expectedLicense
  ) {
    errors.push(
      `package.json license must be ${expectedLicense}: ${String(input.packageLicense)}`,
    );
  }

  if (
    input.lockfileLicense !== undefined &&
    input.lockfileLicense !== expectedLicense
  ) {
    errors.push(
      `package-lock.json license must be ${expectedLicense}: ${String(input.lockfileLicense)}`,
    );
  }

  if (!semverPattern.test(input.packageVersion)) {
    errors.push(
      `package.json version must be valid SemVer: ${input.packageVersion}`,
    );
  }

  if (input.lockfileVersion !== input.packageVersion) {
    errors.push(
      `package-lock.json version ${String(input.lockfileVersion)} does not match package.json version ${input.packageVersion}`,
    );
  }

  if (
    input.lockfileRootVersion !== undefined &&
    input.lockfileRootVersion !== input.packageVersion
  ) {
    errors.push(
      `package-lock.json packages[""].version ${String(input.lockfileRootVersion)} does not match package.json version ${input.packageVersion}`,
    );
  }

  if (input.changelogContent !== undefined) {
    const heading = `## [${input.packageVersion}]`;
    const hasVersionHeading = input.changelogContent
      .split(/\r?\n/)
      .some((line) => line === heading || line.startsWith(`${heading} - `));
    if (!hasVersionHeading) {
      errors.push(`CHANGELOG.md has no heading for ${input.packageVersion}`);
    }
  }

  if (input.tag !== undefined) {
    if (!input.tag.startsWith("v") || !semverPattern.test(input.tag.slice(1))) {
      errors.push(`Release tag must be v<SemVer>: ${input.tag}`);
    } else if (input.tag !== `v${input.packageVersion}`) {
      errors.push(
        `Release tag ${input.tag} does not match package version v${input.packageVersion}`,
      );
    }
  }

  const existingFiles = new Set(input.existingFiles);
  for (const requiredFile of requiredReleaseFiles) {
    if (!existingFiles.has(requiredFile)) {
      errors.push(`Missing required release file: ${requiredFile}`);
    }
  }

  for (const path of findForbiddenTrackedDataFiles(input.trackedFiles)) {
    errors.push(`User data file must not be tracked by Git: ${path}`);
  }

  return errors;
}
