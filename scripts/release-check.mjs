import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  requiredReleaseFiles,
  validateReleaseContract,
} from "./release-contract.mjs";

function readManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readTrackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "git ls-files failed");
  }

  return result.stdout.split("\0").filter(Boolean);
}

function requireVersion(manifest, path) {
  if (typeof manifest.version !== "string") {
    throw new Error(`${path} must contain a string version`);
  }
  return manifest.version;
}

function requireLicense(manifest, path) {
  if (typeof manifest.license !== "string") {
    throw new Error(`${path} must contain a string license`);
  }
  return manifest.license;
}

function requireLockfileRootVersion(lockfile) {
  const version = lockfile.packages?.[""]?.version;
  if (typeof version !== "string") {
    throw new Error('package-lock.json packages[""].version must be a string');
  }
  return version;
}

function releaseTag() {
  if (process.env.RELEASE_TAG) {
    return process.env.RELEASE_TAG;
  }
  if (process.env.GITHUB_REF_TYPE === "tag") {
    return process.env.GITHUB_REF_NAME;
  }
  return undefined;
}

try {
  const packageManifest = readManifest("package.json");
  const packageVersion = requireVersion(packageManifest, "package.json");
  const packageLicense = requireLicense(packageManifest, "package.json");
  const lockfile = readManifest("package-lock.json");
  const lockfileVersion = requireVersion(lockfile, "package-lock.json");
  const lockfileRootVersion = requireLockfileRootVersion(lockfile);
  const lockfileLicense = requireLicense(
    lockfile.packages?.[""] ?? {},
    'package-lock.json packages[""]',
  );
  const tag = releaseTag();
  const errors = validateReleaseContract({
    packageVersion,
    packageLicense,
    lockfileVersion,
    lockfileRootVersion,
    lockfileLicense,
    changelogContent: readFileSync("CHANGELOG.md", "utf8"),
    tag,
    existingFiles: requiredReleaseFiles.filter((path) => existsSync(path)),
    trackedFiles: readTrackedFiles(),
  });

  if (errors.length > 0) {
    console.error("Release check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    const tagDescription = tag ? ` for ${tag}` : "";
    console.log(
      `Release contract is valid${tagDescription} (v${packageVersion}).`,
    );
  }
} catch (error) {
  console.error(
    `Release check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
