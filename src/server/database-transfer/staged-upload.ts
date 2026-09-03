import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import {
  fileIdentity,
  isSameFileIdentity,
  type FileIdentity,
} from "../file-identity.js";

const STAGING_DIRECTORY_NAME = ".transfer-staging";
const GENERATED_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface StagedUpload {
  byteSize: number;
  filePath: string;
  dispose(): void;
}

export interface StageUploadOptions {
  maximumBytes: number;
  nameFactory?: () => string;
  descriptorSync?: (descriptor: number) => void;
  descriptorWrite?: (
    descriptor: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
  ) => number;
}

export class StagedUploadTooLargeError extends Error {
  constructor(
    readonly byteSize: number,
    readonly maximumBytes: number,
  ) {
    super("The uploaded backup exceeds the staging size limit.");
    this.name = "StagedUploadTooLargeError";
  }
}

export async function stageUpload(
  dataDirectory: string,
  source: AsyncIterable<Uint8Array>,
  options: StageUploadOptions,
): Promise<StagedUpload> {
  requireStageInputs(dataDirectory, options.maximumBytes);

  const { canonicalPath: canonicalStagingDirectory, path: stagingDirectory } =
    ensurePrivateStagingDirectory(dataDirectory);
  const generatedName = (options.nameFactory ?? randomUUID)();
  if (
    typeof generatedName !== "string" ||
    !GENERATED_NAME.test(generatedName)
  ) {
    throw new TypeError("The generated staging name is invalid.");
  }

  const filePath = join(stagingDirectory, `upload-${generatedName}.tmp`);
  const descriptorWrite = options.descriptorWrite ?? writeSync;
  const descriptorSync = options.descriptorSync ?? fsyncSync;
  let descriptor: number | undefined;
  let createdIdentity: FileIdentity | undefined;
  let byteSize = 0;

  try {
    descriptor = openSync(
      filePath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    createdIdentity = fileIdentity(fstatSync(descriptor, { bigint: true }));

    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("Upload chunks must be Uint8Array values.");
      }
      if (chunk.byteLength > options.maximumBytes - byteSize) {
        throw new StagedUploadTooLargeError(
          byteSize + chunk.byteLength,
          options.maximumBytes,
        );
      }

      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = descriptorWrite(
          descriptor,
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        if (written < 1 || written > chunk.byteLength - offset) {
          throw new Error("The staged upload could not make write progress.");
        }
        offset += written;
      }
      byteSize += chunk.byteLength;
    }

    fchmodSync(descriptor, 0o600);
    descriptorSync(descriptor);
    const descriptorIdentity = fileIdentity(
      fstatSync(descriptor, { bigint: true }),
    );
    closeSync(descriptor);
    descriptor = undefined;
    const identity = lstatSync(filePath, { bigint: true });
    if (
      identity.isSymbolicLink() ||
      !identity.isFile() ||
      !isSameFileIdentity(fileIdentity(identity), descriptorIdentity) ||
      realpathSync(filePath) !==
        join(canonicalStagingDirectory, `upload-${generatedName}.tmp`)
    ) {
      throw new Error("The staged upload file is unsafe.");
    }

    return createStagedUpload(filePath, byteSize, fileIdentity(identity));
  } catch (error) {
    if (descriptor !== undefined) closeIgnoringErrors(descriptor);
    if (createdIdentity) {
      unlinkIfIdentityMatches(filePath, createdIdentity);
    }
    throw error;
  }
}

function requireStageInputs(dataDirectory: string, maximumBytes: number): void {
  if (!isAbsolute(dataDirectory)) {
    throw new TypeError("The On Track data directory must be absolute.");
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("The staging size limit is invalid.");
  }
}

function ensurePrivateStagingDirectory(dataDirectory: string): {
  canonicalPath: string;
  path: string;
} {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const dataIdentity = lstatSync(dataDirectory);
  if (dataIdentity.isSymbolicLink() || !dataIdentity.isDirectory()) {
    throw new Error("The On Track data directory is unsafe.");
  }

  const stagingDirectory = join(dataDirectory, STAGING_DIRECTORY_NAME);
  try {
    mkdirSync(stagingDirectory, { mode: 0o700 });
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  }

  const stagingIdentity = lstatSync(stagingDirectory);
  if (stagingIdentity.isSymbolicLink() || !stagingIdentity.isDirectory()) {
    throw new Error("The transfer staging directory is unsafe.");
  }
  chmodSync(stagingDirectory, 0o700);

  const canonicalDataDirectory = realpathSync(dataDirectory);
  const canonicalStagingDirectory = realpathSync(stagingDirectory);
  const pathFromRoot = relative(
    canonicalDataDirectory,
    canonicalStagingDirectory,
  );
  if (pathFromRoot !== STAGING_DIRECTORY_NAME || isAbsolute(pathFromRoot)) {
    throw new Error("The transfer staging directory is unsafe.");
  }

  return {
    canonicalPath: canonicalStagingDirectory,
    path: stagingDirectory,
  };
}

function createStagedUpload(
  filePath: string,
  byteSize: number,
  identity: FileIdentity,
): StagedUpload {
  let disposed = false;
  return {
    byteSize,
    filePath,
    dispose() {
      if (disposed) return;
      try {
        const current = lstatSync(filePath, { bigint: true });
        if (
          !current.isSymbolicLink() &&
          current.isFile() &&
          isSameFileIdentity(fileIdentity(current), identity)
        ) {
          unlinkSync(filePath);
        }
        disposed = true;
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error;
        disposed = true;
      }
    },
  };
}

function closeIgnoringErrors(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch {
    // Preserve the upload or filesystem error that triggered cleanup.
  }
}

function unlinkIfIdentityMatches(
  filePath: string,
  identity: FileIdentity,
): void {
  try {
    const current = lstatSync(filePath, { bigint: true });
    if (
      !current.isSymbolicLink() &&
      current.isFile() &&
      isSameFileIdentity(fileIdentity(current), identity)
    ) {
      unlinkSync(filePath);
    }
  } catch {
    // Cleanup is best-effort here; the caller still receives the root failure.
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
