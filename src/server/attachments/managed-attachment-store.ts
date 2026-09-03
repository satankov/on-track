import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, relative, win32 } from "node:path";

import { MAX_ATTACHMENT_BYTES } from "../../domain/validation.js";
import {
  fileIdentity,
  isSameFileIdentity,
  type FileIdentity,
} from "../file-identity.js";

const STORAGE_PREFIX = ["attachments", "v1"] as const;
const MAX_MANAGED_FILENAME_BYTES = 180;
const GENERATED_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WINDOWS_RESERVED_BASENAME =
  /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i;

export type ManagedAttachmentStatus =
  "available" | "missing" | "unreadable" | "unsafe";

export interface ManagedAttachmentObservation {
  storagePath: string;
  status: ManagedAttachmentStatus;
  byteSize?: number;
  modifiedAt?: number;
}

export interface ManagedAttachmentFile extends ManagedAttachmentObservation {
  status: "available";
  byteSize: number;
  modifiedAt: number;
}

export interface ManagedAttachmentRead {
  content: Buffer;
  byteSize: number;
  modifiedAt: number;
}

export interface ManagedAttachmentStoreOptions {
  namespaceFactory?: () => string;
  temporaryNameFactory?: () => string;
  maximumReadableBytes?: number;
  directorySync?: (path: string) => void;
  descriptorRead?: (
    descriptor: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => number;
}

interface ParsedStoragePath {
  absolutePath: string;
  attachmentDirectory: string;
  namespaceDirectory: string;
  storagePath: string;
}

interface OpenedManagedFile extends ParsedStoragePath {
  canonicalPath: string;
  changedAt: number;
  descriptor: number;
  identity: FileIdentity;
  modifiedAt: number;
  modifiedAtPrecise: number;
  byteSize: number;
  mode: number;
}

export interface ManagedAttachmentTarget {
  absolutePath: string;
  containingDirectory: string;
  managedFilename: string;
  mode: number;
}

export class ManagedAttachmentUnavailableError extends Error {
  constructor(
    readonly status: Exclude<ManagedAttachmentStatus, "available">,
    readonly storagePath: string,
  ) {
    super(`The managed attachment is ${status}.`);
    this.name = "ManagedAttachmentUnavailableError";
  }
}

export class ManagedAttachmentChangedError extends Error {
  constructor() {
    super("The managed attachment changed while it was being read.");
    this.name = "ManagedAttachmentChangedError";
  }
}

export class ManagedAttachmentTooLargeError extends Error {
  constructor(readonly byteSize: number) {
    super("The managed attachment is too large to read.");
    this.name = "ManagedAttachmentTooLargeError";
  }
}

export class ManagedAttachmentStore {
  private readonly namespaceFactory: () => string;
  private readonly temporaryNameFactory: () => string;
  private readonly managedRoot: string;
  private readonly canonicalManagedRoot: string;
  private readonly maximumReadableBytes: number;
  private readonly directorySync: (path: string) => void;
  private readonly descriptorRead: NonNullable<
    ManagedAttachmentStoreOptions["descriptorRead"]
  >;

  constructor(
    private readonly dataDirectory: string,
    options: ManagedAttachmentStoreOptions = {},
  ) {
    if (!isAbsolute(dataDirectory)) {
      throw new TypeError("The On Track data directory must be absolute.");
    }

    this.namespaceFactory = options.namespaceFactory ?? randomUUID;
    this.temporaryNameFactory = options.temporaryNameFactory ?? randomUUID;
    this.maximumReadableBytes =
      options.maximumReadableBytes ?? MAX_ATTACHMENT_BYTES;
    if (
      !Number.isSafeInteger(this.maximumReadableBytes) ||
      this.maximumReadableBytes < 1
    ) {
      throw new TypeError("The managed attachment read limit is invalid.");
    }
    this.directorySync =
      options.directorySync ?? syncManagedAttachmentDirectory;
    this.descriptorRead = options.descriptorRead ?? readSync;

    ensurePrivateDirectory(dataDirectory, this.directorySync);
    const attachmentsRoot = join(dataDirectory, STORAGE_PREFIX[0]);
    ensurePrivateDirectory(attachmentsRoot, this.directorySync);
    this.managedRoot = join(attachmentsRoot, STORAGE_PREFIX[1]);
    ensurePrivateDirectory(this.managedRoot, this.directorySync);

    const canonicalDataDirectory = realpathSync(dataDirectory);
    this.canonicalManagedRoot = realpathSync(this.managedRoot);
    if (
      !isContainedPath(canonicalDataDirectory, this.canonicalManagedRoot) ||
      canonicalDataDirectory === this.canonicalManagedRoot
    ) {
      throw new Error(
        "The managed attachment root is outside the data directory.",
      );
    }
  }

  create(input: {
    attachmentId: string;
    filename: string;
    content: Uint8Array;
  }): ManagedAttachmentFile {
    const namespace = requireGeneratedComponent(
      this.namespaceFactory(),
      "namespace",
    );
    const attachmentId = requireGeneratedComponent(
      input.attachmentId,
      "attachment ID",
    );
    const filename = sanitizeManagedFilename(input.filename);
    const storagePath = posix.join(
      STORAGE_PREFIX[0],
      STORAGE_PREFIX[1],
      namespace,
      attachmentId,
      filename,
    );
    const parsed = this.parseStoragePath(storagePath);

    ensurePrivateDirectory(parsed.namespaceDirectory, this.directorySync);
    ensurePrivateDirectory(parsed.attachmentDirectory, this.directorySync);

    const temporaryName = requireGeneratedComponent(
      this.temporaryNameFactory(),
      "temporary name",
    );
    const temporaryPath = join(
      parsed.attachmentDirectory,
      `.${filename}.${temporaryName}.tmp`,
    );
    let descriptor: number | undefined;
    let published = false;

    try {
      descriptor = openSync(
        temporaryPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          noFollowFlag(),
        0o600,
      );
      writeFileSync(descriptor, input.content);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      chmodSync(temporaryPath, 0o600);

      linkSync(temporaryPath, parsed.absolutePath);
      published = true;
      unlinkSync(temporaryPath);
      this.directorySync(parsed.attachmentDirectory);

      return this.requireAvailable(storagePath);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      unlinkIfPresent(temporaryPath);
      if (published && existsSync(parsed.absolutePath)) {
        unlinkIfPresent(parsed.absolutePath);
        syncDirectoryAfterCleanup(parsed.attachmentDirectory);
      }
      this.pruneEmptyDirectories(parsed);
      throw error;
    }
  }

  observe(storagePath: string): ManagedAttachmentObservation {
    try {
      return this.requireAvailable(storagePath);
    } catch (error) {
      if (error instanceof ManagedAttachmentUnavailableError) {
        return { storagePath, status: error.status };
      }
      throw error;
    }
  }

  read(storagePath: string): ManagedAttachmentRead {
    const opened = this.openManagedFile(storagePath);
    try {
      if (opened.byteSize > this.maximumReadableBytes) {
        throw new ManagedAttachmentTooLargeError(opened.byteSize);
      }
      const content = Buffer.alloc(opened.byteSize);
      let offset = 0;
      while (offset < content.length) {
        const bytesRead = this.descriptorRead(
          opened.descriptor,
          content,
          offset,
          content.length - offset,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const extra = Buffer.alloc(1);
      const extraBytes = this.descriptorRead(
        opened.descriptor,
        extra,
        0,
        1,
        opened.byteSize,
      );
      const finalStat = fstatSync(opened.descriptor);
      const finalIdentity = fileIdentity(
        fstatSync(opened.descriptor, { bigint: true }),
      );
      if (
        !finalStat.isFile() ||
        !isSameFileIdentity(finalIdentity, opened.identity) ||
        finalStat.size !== opened.byteSize ||
        finalStat.mtimeMs !== opened.modifiedAtPrecise ||
        finalStat.ctimeMs !== opened.changedAt ||
        offset !== opened.byteSize ||
        extraBytes !== 0
      ) {
        throw new ManagedAttachmentChangedError();
      }
      try {
        const currentTarget = lstatSync(opened.absolutePath, { bigint: true });
        const currentIdentity = fileIdentity(currentTarget);
        const currentCanonicalPath = realpathSync(opened.absolutePath);
        if (
          currentTarget.isSymbolicLink() ||
          !currentTarget.isFile() ||
          !isSameFileIdentity(currentIdentity, opened.identity) ||
          !isContainedPath(this.canonicalManagedRoot, currentCanonicalPath)
        ) {
          throw new ManagedAttachmentChangedError();
        }
      } catch (error) {
        if (error instanceof ManagedAttachmentChangedError) throw error;
        throw new ManagedAttachmentChangedError();
      }
      return {
        content,
        byteSize: finalStat.size,
        modifiedAt: Math.trunc(finalStat.mtimeMs),
      };
    } finally {
      closeSync(opened.descriptor);
    }
  }

  resolveAvailablePath(storagePath: string): string {
    return this.resolveAvailableTarget(storagePath).absolutePath;
  }

  resolveAvailableTarget(storagePath: string): ManagedAttachmentTarget {
    const opened = this.openManagedFile(storagePath);
    closeSync(opened.descriptor);
    return {
      absolutePath: opened.canonicalPath,
      containingDirectory: realpathSync(opened.attachmentDirectory),
      managedFilename: opened.storagePath.split("/").at(-1)!,
      mode: opened.mode,
    };
  }

  resolveSafeContainingDirectory(storagePath: string): string {
    const parsed = this.parseStoragePath(storagePath);
    const status = this.inspectAncestors(parsed);
    if (status !== "available") {
      throw new ManagedAttachmentUnavailableError(status, storagePath);
    }
    return realpathSync(parsed.attachmentDirectory);
  }

  remove(storagePath: string): "removed" | "missing" | "unreadable" | "unsafe" {
    let parsed: ParsedStoragePath;
    try {
      parsed = this.parseStoragePath(storagePath);
    } catch (error) {
      if (
        error instanceof ManagedAttachmentUnavailableError &&
        error.status === "unsafe"
      ) {
        return "unsafe";
      }
      throw error;
    }

    const ancestorStatus = this.inspectAncestors(parsed);
    if (ancestorStatus !== "available") return ancestorStatus;

    let target;
    try {
      target = lstatSync(parsed.absolutePath);
    } catch (error) {
      return classifyFileError(error);
    }
    if (!target.isFile() && !target.isSymbolicLink()) return "unsafe";

    try {
      unlinkSync(parsed.absolutePath);
      this.pruneEmptyDirectories(parsed);
      return "removed";
    } catch (error) {
      return classifyFileError(error);
    }
  }

  private requireAvailable(storagePath: string): ManagedAttachmentFile {
    const opened = this.openManagedFile(storagePath);
    closeSync(opened.descriptor);
    return {
      storagePath,
      status: "available",
      byteSize: opened.byteSize,
      modifiedAt: opened.modifiedAt,
    };
  }

  private openManagedFile(storagePath: string): OpenedManagedFile {
    const parsed = this.parseStoragePath(storagePath);
    const ancestorStatus = this.inspectAncestors(parsed);
    if (ancestorStatus !== "available") {
      throw new ManagedAttachmentUnavailableError(ancestorStatus, storagePath);
    }

    try {
      const target = lstatSync(parsed.absolutePath);
      if (target.isSymbolicLink() || !target.isFile()) {
        throw new ManagedAttachmentUnavailableError("unsafe", storagePath);
      }

      if (
        !isContainedPath(
          this.canonicalManagedRoot,
          realpathSync(parsed.absolutePath),
        )
      ) {
        throw new ManagedAttachmentUnavailableError("unsafe", storagePath);
      }

      const descriptor = openSync(
        parsed.absolutePath,
        constants.O_RDONLY | noFollowFlag(),
      );
      try {
        const stat = fstatSync(descriptor);
        const descriptorIdentity = fileIdentity(
          fstatSync(descriptor, { bigint: true }),
        );
        if (!stat.isFile()) {
          throw new ManagedAttachmentUnavailableError("unsafe", storagePath);
        }
        const finalTarget = lstatSync(parsed.absolutePath, { bigint: true });
        const finalIdentity = fileIdentity(finalTarget);
        const canonicalPath = realpathSync(parsed.absolutePath);
        if (
          finalTarget.isSymbolicLink() ||
          !finalTarget.isFile() ||
          !isSameFileIdentity(finalIdentity, descriptorIdentity) ||
          !isContainedPath(this.canonicalManagedRoot, canonicalPath)
        ) {
          throw new ManagedAttachmentUnavailableError("unsafe", storagePath);
        }
        return {
          ...parsed,
          canonicalPath,
          changedAt: stat.ctimeMs,
          descriptor,
          identity: descriptorIdentity,
          byteSize: stat.size,
          modifiedAt: Math.trunc(stat.mtimeMs),
          modifiedAtPrecise: stat.mtimeMs,
          mode: stat.mode,
        };
      } catch (error) {
        closeSync(descriptor);
        throw error;
      }
    } catch (error) {
      if (error instanceof ManagedAttachmentUnavailableError) throw error;
      throw new ManagedAttachmentUnavailableError(
        classifyFileError(error),
        storagePath,
      );
    }
  }

  private inspectAncestors(
    parsed: ParsedStoragePath,
  ): "available" | "missing" | "unreadable" | "unsafe" {
    for (const directory of [
      parsed.namespaceDirectory,
      parsed.attachmentDirectory,
    ]) {
      try {
        const stat = lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return "unsafe";
        const canonicalDirectory = realpathSync(directory);
        if (!isContainedPath(this.canonicalManagedRoot, canonicalDirectory)) {
          return "unsafe";
        }
      } catch (error) {
        return classifyFileError(error);
      }
    }
    return "available";
  }

  private parseStoragePath(storagePath: string): ParsedStoragePath {
    if (
      storagePath.includes("\0") ||
      storagePath.includes("\\") ||
      posix.isAbsolute(storagePath) ||
      win32.isAbsolute(storagePath)
    ) {
      throw new ManagedAttachmentUnavailableError("unsafe", storagePath);
    }

    const segments = storagePath.split("/");
    if (
      segments.length !== 5 ||
      segments[0] !== STORAGE_PREFIX[0] ||
      segments[1] !== STORAGE_PREFIX[1] ||
      segments.some(
        (segment) =>
          segment.length === 0 || segment === "." || segment === "..",
      ) ||
      !GENERATED_COMPONENT.test(segments[2]) ||
      !GENERATED_COMPONENT.test(segments[3]) ||
      sanitizeManagedFilename(segments[4]) !== segments[4]
    ) {
      throw new ManagedAttachmentUnavailableError("unsafe", storagePath);
    }

    const namespaceDirectory = join(this.managedRoot, segments[2]);
    const attachmentDirectory = join(namespaceDirectory, segments[3]);
    const absolutePath = join(attachmentDirectory, segments[4]);
    if (!isContainedPath(this.managedRoot, absolutePath)) {
      throw new ManagedAttachmentUnavailableError("unsafe", storagePath);
    }
    return {
      storagePath,
      absolutePath,
      namespaceDirectory,
      attachmentDirectory,
    };
  }

  private pruneEmptyDirectories(parsed: ParsedStoragePath): void {
    for (const directory of [
      parsed.attachmentDirectory,
      parsed.namespaceDirectory,
    ]) {
      try {
        rmdirSync(directory);
      } catch {
        return;
      }
    }
  }
}

function ensurePrivateDirectory(
  path: string,
  directorySync: (path: string) => void,
): void {
  let created = false;
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("A managed attachment directory is unsafe.");
    }
  } else {
    mkdirSync(path, { mode: 0o700 });
    created = true;
  }
  chmodSync(path, 0o700);
  directorySync(path);
  if (created) directorySync(dirname(path));
}

function requireGeneratedComponent(value: string, label: string): string {
  if (!GENERATED_COMPONENT.test(value)) {
    throw new TypeError(`The generated attachment ${label} is invalid.`);
  }
  return value;
}

function sanitizeManagedFilename(filename: string): string {
  let safe = filename
    .normalize("NFC")
    .trim()
    .split("")
    .map((character) =>
      isUnsafeFilenameCharacter(character) ? "_" : character,
    )
    .join("")
    .replace(/[. ]+$/g, "");
  if (!safe || safe === "." || safe === "..") safe = "attachment";
  safe = protectWindowsReservedName(safe);
  safe = truncateFilename(safe, MAX_MANAGED_FILENAME_BYTES).replace(
    /[. ]+$/g,
    "",
  );
  if (!safe) safe = "attachment";
  return protectWindowsReservedName(safe);
}

function protectWindowsReservedName(filename: string): string {
  const stem = filename.split(".", 1)[0].replace(/[. ]+$/g, "");
  return WINDOWS_RESERVED_BASENAME.test(stem) ? `_${filename}` : filename;
}

function isUnsafeFilenameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127 || '<>:"/\\|?*'.includes(character);
}

function truncateFilename(filename: string, maximumBytes: number): string {
  if (Buffer.byteLength(filename, "utf8") <= maximumBytes) return filename;

  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : "";
  const boundedExtension =
    Buffer.byteLength(extension, "utf8") <= 32 ? extension : "";
  const basename = boundedExtension
    ? filename.slice(0, -boundedExtension.length)
    : filename;
  const basenameBudget = maximumBytes - Buffer.byteLength(boundedExtension);
  let truncated = "";
  for (const character of basename) {
    if (Buffer.byteLength(truncated + character, "utf8") > basenameBudget) {
      break;
    }
    truncated += character;
  }
  return `${truncated || "attachment"}${boundedExtension}`;
}

function isContainedPath(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${posix.sep}`) &&
    !pathFromRoot.startsWith(`..${win32.sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function classifyFileError(
  error: unknown,
): Exclude<ManagedAttachmentStatus, "available"> {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  if (code === "ENOENT") return "missing";
  if (code === "EACCES" || code === "EPERM") return "unreadable";
  return "unsafe";
}

function noFollowFlag(): number {
  return constants.O_NOFOLLOW ?? 0;
}

export function syncManagedAttachmentDirectory(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  return (
    code === "EINVAL" ||
    code === "ENOTSUP" ||
    code === "ENOSYS" ||
    (process.platform === "win32" &&
      (code === "EACCES" || code === "EPERM" || code === "EISDIR"))
  );
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (classifyFileError(error) !== "missing") throw error;
  }
}

function syncDirectoryAfterCleanup(path: string): void {
  try {
    syncManagedAttachmentDirectory(path);
  } catch {
    // The operation already failed; cleanup durability is best effort here.
  }
}
