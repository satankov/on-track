import { describe, expect, it } from "vitest";

import {
  findForbiddenTrackedDataFiles,
  validateReleaseContract,
} from "./release-contract.mjs";

const requiredFiles = [
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

describe("release contract", () => {
  it("accepts the exact Node 22.16 and Node 24 LTS support contract", () => {
    expect(
      validateReleaseContract({
        packageVersion: "0.0.1",
        lockfileVersion: "0.0.1",
        packageNodeEngine: "^22.16.0 || ^24.0.0",
        lockfileRootNodeEngine: "^22.16.0 || ^24.0.0",
        nvmrcVersion: "24",
        existingFiles: requiredFiles,
        trackedFiles: [],
      }),
    ).toEqual([]);
  });

  it.each([
    ["an unsupported package engine", { packageNodeEngine: ">=22" }],
    [
      "the disproved Node 22.13 floor",
      { packageNodeEngine: "^22.13.0 || ^24.0.0" },
    ],
    [
      "a stale lockfile engine",
      {
        packageNodeEngine: "^22.16.0 || ^24.0.0",
        lockfileRootNodeEngine: ">=24 <25",
      },
    ],
    [
      "an unsupported preferred runtime",
      {
        packageNodeEngine: "^22.16.0 || ^24.0.0",
        lockfileRootNodeEngine: "^22.16.0 || ^24.0.0",
        nvmrcVersion: "26",
      },
    ],
  ])("rejects %s", (_name, override) => {
    const errors = validateReleaseContract({
      packageVersion: "0.0.1",
      lockfileVersion: "0.0.1",
      existingFiles: requiredFiles,
      trackedFiles: [],
      ...override,
    });

    expect(errors.join("\n")).toContain("Node.js support contract");
  });

  it("accepts matching package, lockfile, and SemVer tag metadata", () => {
    expect(
      validateReleaseContract({
        packageVersion: "0.0.1",
        lockfileVersion: "0.0.1",
        tag: "v0.0.1",
        existingFiles: requiredFiles,
        trackedFiles: ["src/server/db/database.ts", "drizzle/0000_initial.sql"],
      }),
    ).toEqual([]);
  });

  it("allows a local check without a release tag", () => {
    expect(
      validateReleaseContract({
        packageVersion: "0.0.1",
        lockfileVersion: "0.0.1",
        existingFiles: requiredFiles,
        trackedFiles: [],
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "lockfile mismatch",
      { lockfileVersion: "0.0.0" },
      "package-lock.json version",
    ],
    ["invalid package version", { packageVersion: "1.0" }, "valid SemVer"],
    [
      "numeric prerelease with a leading zero",
      { packageVersion: "1.0.0-01", lockfileVersion: "1.0.0-01" },
      "valid SemVer",
    ],
    [
      "numeric prerelease segment with a leading zero",
      { packageVersion: "1.0.0-alpha.01", lockfileVersion: "1.0.0-alpha.01" },
      "valid SemVer",
    ],
    ["tag mismatch", { tag: "v0.0.2" }, "does not match"],
    ["invalid tag", { tag: "release-0.0.1" }, "must be v<SemVer>"],
  ])("rejects %s", (_name, override, expectedMessage) => {
    const errors = validateReleaseContract({
      packageVersion: "0.0.1",
      lockfileVersion: "0.0.1",
      tag: "v0.0.1",
      existingFiles: requiredFiles,
      trackedFiles: [],
      ...override,
    });

    expect(errors.join("\n")).toContain(expectedMessage);
  });

  it("reports every missing public release file", () => {
    const errors = validateReleaseContract({
      packageVersion: "0.0.1",
      lockfileVersion: "0.0.1",
      existingFiles: ["README.md"],
      trackedFiles: [],
    });

    expect(errors).toContain("Missing required release file: LICENSE");
    expect(errors).toContain("Missing required release file: CHANGELOG.md");
  });

  it("rejects a mismatched root package version inside the lockfile", () => {
    const errors = validateReleaseContract({
      packageVersion: "0.0.1",
      lockfileVersion: "0.0.1",
      lockfileRootVersion: "0.0.0",
      existingFiles: requiredFiles,
      trackedFiles: [],
    });

    expect(errors.join("\n")).toContain(
      'package-lock.json packages[""].version',
    );
  });

  it("requires the released version to have a changelog heading", () => {
    const errors = validateReleaseContract({
      packageVersion: "0.0.1",
      lockfileVersion: "0.0.1",
      lockfileRootVersion: "0.0.1",
      changelogContent: "# Changelog\n\n## [Unreleased]\n",
      existingFiles: requiredFiles,
      trackedFiles: [],
    });

    expect(errors.join("\n")).toContain(
      "CHANGELOG.md has no heading for 0.0.1",
    );
  });

  it("accepts matching Apache-2.0 license metadata", () => {
    expect(
      validateReleaseContract({
        packageVersion: "0.0.1",
        lockfileVersion: "0.0.1",
        packageLicense: "Apache-2.0",
        lockfileLicense: "Apache-2.0",
        existingFiles: requiredFiles,
        trackedFiles: [],
      }),
    ).toEqual([]);
  });

  it.each([
    ["package.json", { packageLicense: "PolyForm-Noncommercial-1.0.0" }],
    ["package-lock.json", { lockfileLicense: "PolyForm-Noncommercial-1.0.0" }],
    ["package.json", { packageLicense: "MIT" }],
  ])("rejects stale %s license metadata", (manifest, override) => {
    const errors = validateReleaseContract({
      packageVersion: "0.0.1",
      lockfileVersion: "0.0.1",
      packageLicense: "Apache-2.0",
      lockfileLicense: "Apache-2.0",
      existingFiles: requiredFiles,
      trackedFiles: [],
      ...override,
    });

    expect(errors.join("\n")).toContain(`${manifest} license`);
  });
});

describe("tracked data-file protection", () => {
  it("finds SQLite, journal, WAL, shared-memory, backup, and generic DB files", () => {
    expect(
      findForbiddenTrackedDataFiles([
        "private/on-track.sqlite",
        "private/on-track.sqlite-wal",
        "private/on-track.sqlite-shm",
        "private/on-track.sqlite-journal",
        "private/backup.sqlite-backup",
        "private/notes.db",
        "private/notes.db-wal",
        "private/old.sqlite3",
        "private/legacy.db3",
        "private/archive.s3db",
        "private/project.on-track-backup",
        "private/project.on-track-export",
        "on-track-backups/project.json",
        "on-track-exports/project.json",
      ]),
    ).toEqual([
      "private/on-track.sqlite",
      "private/on-track.sqlite-wal",
      "private/on-track.sqlite-shm",
      "private/on-track.sqlite-journal",
      "private/backup.sqlite-backup",
      "private/notes.db",
      "private/notes.db-wal",
      "private/old.sqlite3",
      "private/legacy.db3",
      "private/archive.s3db",
      "private/project.on-track-backup",
      "private/project.on-track-export",
      "on-track-backups/project.json",
      "on-track-exports/project.json",
    ]);
  });

  it("does not mistake source code, migrations, or documentation for user data", () => {
    expect(
      findForbiddenTrackedDataFiles([
        "src/server/db/database.ts",
        "src/server/db/database.test.ts",
        "drizzle/0000_initial.sql",
        "docs/database-design.md",
      ]),
    ).toEqual([]);
  });
});
