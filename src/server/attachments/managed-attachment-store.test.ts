import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ManagedAttachmentChangedError,
  ManagedAttachmentStore,
  ManagedAttachmentTooLargeError,
  ManagedAttachmentUnavailableError,
  syncManagedAttachmentDirectory,
} from "./managed-attachment-store.js";

describe("managed attachment storage", () => {
  let dataDirectory: string;

  beforeEach(() => {
    dataDirectory = mkdtempSync(join(tmpdir(), "on-track-attachments-"));
  });

  afterEach(() => {
    chmodSync(dataDirectory, 0o700);
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  function createStore(namespaces = ["namespace-a"]): ManagedAttachmentStore {
    let index = 0;
    return new ManagedAttachmentStore(dataDirectory, {
      namespaceFactory: () => namespaces[index++] ?? "namespace-fallback",
      temporaryNameFactory: () => "temporary-a",
    });
  }

  it("publishes private files at generated repository-owned paths", () => {
    const store = createStore();

    const created = store.create({
      attachmentId: "attachment-a",
      filename: " quarterly:plan?.pdf. ",
      content: Buffer.from("managed bytes"),
    });

    expect(created).toMatchObject({
      storagePath:
        "attachments/v1/namespace-a/attachment-a/quarterly_plan_.pdf",
      byteSize: 13,
      status: "available",
    });
    expect(created.modifiedAt).toEqual(expect.any(Number));
    expect(store.read(created.storagePath)).toMatchObject({
      content: Buffer.from("managed bytes"),
      byteSize: 13,
      modifiedAt: created.modifiedAt,
    });
    expect(store.resolveAvailablePath(created.storagePath)).toBe(
      join(
        realpathSync(dataDirectory),
        "attachments",
        "v1",
        "namespace-a",
        "attachment-a",
        "quarterly_plan_.pdf",
      ),
    );
    expect(store.resolveSafeContainingDirectory(created.storagePath)).toBe(
      join(
        realpathSync(dataDirectory),
        "attachments",
        "v1",
        "namespace-a",
        "attachment-a",
      ),
    );

    if (process.platform !== "win32") {
      expect(lstatSync(join(dataDirectory, "attachments")).mode & 0o777).toBe(
        0o700,
      );
      expect(
        lstatSync(store.resolveAvailablePath(created.storagePath)).mode & 0o777,
      ).toBe(0o600);
    }
  });

  it("normalizes Windows-reserved names and bounds UTF-8 filename bytes", () => {
    const store = createStore([
      "namespace-a",
      "namespace-b",
      "namespace-c",
      "namespace-d",
      "namespace-e",
    ]);

    const reserved = store.create({
      attachmentId: "attachment-a",
      filename: "CON.txt",
      content: Buffer.from("a"),
    });
    const long = store.create({
      attachmentId: "attachment-b",
      filename: `${"🙂".repeat(100)}.pdf`,
      content: Buffer.from("b"),
    });
    const empty = store.create({
      attachmentId: "attachment-c",
      filename: " .. ",
      content: Buffer.from("c"),
    });
    const reservedConsole = store.create({
      attachmentId: "attachment-d",
      filename: "CONOUT$.log",
      content: Buffer.from("d"),
    });
    const reservedPort = store.create({
      attachmentId: "attachment-e",
      filename: "COM¹.txt",
      content: Buffer.from("e"),
    });

    expect(reserved.storagePath).toBe(
      "attachments/v1/namespace-a/attachment-a/_CON.txt",
    );
    expect(
      Buffer.byteLength(long.storagePath.split("/").at(-1)!, "utf8"),
    ).toBeLessThanOrEqual(180);
    expect(long.storagePath.endsWith(".pdf")).toBe(true);
    expect(empty.storagePath.endsWith("/attachment")).toBe(true);
    expect(reservedConsole.storagePath.endsWith("/_CONOUT$.log")).toBe(true);
    expect(reservedPort.storagePath.endsWith("/_COM¹.txt")).toBe(true);
  });

  it("bounds long extensionless managed filenames", () => {
    const store = createStore();
    const created = store.create({
      attachmentId: "attachment-a",
      filename: "a".repeat(300),
      content: Buffer.from("content"),
    });

    expect(
      Buffer.byteLength(created.storagePath.split("/").at(-1)!, "utf8"),
    ).toBe(180);
  });

  it("does not expose a trailing dot when truncating a long extension", () => {
    const store = createStore();
    const created = store.create({
      attachmentId: "attachment-a",
      filename: `${"a".repeat(179)}.${"b".repeat(40)}`,
      content: Buffer.from("content"),
    });
    const managedFilename = created.storagePath.split("/").at(-1)!;

    expect(managedFilename.endsWith(".")).toBe(false);
    expect(store.read(created.storagePath).content).toEqual(
      Buffer.from("content"),
    );
  });

  it("uses unique generated namespaces by default", () => {
    const store = new ManagedAttachmentStore(dataDirectory);

    const first = store.create({
      attachmentId: "attachment-a",
      filename: "same.txt",
      content: Buffer.from("first"),
    });
    const second = store.create({
      attachmentId: "attachment-a",
      filename: "same.txt",
      content: Buffer.from("second"),
    });

    expect(first.storagePath).not.toBe(second.storagePath);
    expect(store.read(first.storagePath).content).toEqual(Buffer.from("first"));
    expect(store.read(second.storagePath).content).toEqual(
      Buffer.from("second"),
    );
  });

  it("syncs each newly published directory entry", () => {
    const synced: string[] = [];
    const store = new ManagedAttachmentStore(dataDirectory, {
      namespaceFactory: () => "namespace-a",
      temporaryNameFactory: () => "temporary-a",
      directorySync: (path) => synced.push(path),
    });

    store.create({
      attachmentId: "attachment-a",
      filename: "durable.txt",
      content: Buffer.from("content"),
    });

    const expectedDirectories = [
      dataDirectory,
      join(dataDirectory, "attachments"),
      join(dataDirectory, "attachments", "v1"),
      join(dataDirectory, "attachments", "v1", "namespace-a"),
      join(dataDirectory, "attachments", "v1", "namespace-a", "attachment-a"),
    ];
    for (const directory of expectedDirectories) {
      expect(synced).toContain(directory);
    }
    expect(synced.at(-1)).toBe(expectedDirectories.at(-1));
  });

  it("rolls back publication when durable directory sync fails", () => {
    const storagePath = "attachments/v1/namespace-a/attachment-a/durable.txt";
    const absolutePath = join(dataDirectory, ...storagePath.split("/"));
    const attachmentDirectory = dirname(absolutePath);
    const store = new ManagedAttachmentStore(dataDirectory, {
      namespaceFactory: () => "namespace-a",
      temporaryNameFactory: () => "temporary-a",
      directorySync: (path) => {
        if (path === attachmentDirectory && existsSync(absolutePath)) {
          const error = new Error("forced directory sync failure") as Error & {
            code: string;
          };
          error.code = "EIO";
          throw error;
        }
      },
    });

    expect(() =>
      store.create({
        attachmentId: "attachment-a",
        filename: "durable.txt",
        content: Buffer.from("content"),
      }),
    ).toThrow(/forced directory sync failure/);
    expect(existsSync(absolutePath)).toBe(false);
    expect(store.observe(storagePath).status).toBe("missing");
  });

  it("does not hide real directory-sync failures", () => {
    expect(() =>
      syncManagedAttachmentDirectory(join(dataDirectory, "missing")),
    ).toThrow();
  });

  it("rejects relative data directories and invalid generated components", () => {
    expect(() => new ManagedAttachmentStore("relative-data")).toThrow(
      /must be absolute/,
    );
    expect(
      () =>
        new ManagedAttachmentStore(dataDirectory, {
          maximumReadableBytes: 0,
        }),
    ).toThrow(/read limit is invalid/);

    expect(() =>
      createStore(["../namespace"]).create({
        attachmentId: "attachment-a",
        filename: "file.txt",
        content: Buffer.from("content"),
      }),
    ).toThrow(/namespace is invalid/);
    expect(() =>
      createStore().create({
        attachmentId: "../attachment",
        filename: "file.txt",
        content: Buffer.from("content"),
      }),
    ).toThrow(/attachment ID is invalid/);

    const invalidTemporaryNameStore = new ManagedAttachmentStore(
      dataDirectory,
      {
        namespaceFactory: () => "namespace-a",
        temporaryNameFactory: () => "../temporary",
      },
    );
    expect(() =>
      invalidTemporaryNameStore.create({
        attachmentId: "attachment-a",
        filename: "file.txt",
        content: Buffer.from("content"),
      }),
    ).toThrow(/temporary name is invalid/);
  });

  it("refuses a non-directory managed root", () => {
    writeFileSync(join(dataDirectory, "attachments"), "not a directory");

    expect(() => new ManagedAttachmentStore(dataDirectory)).toThrow(
      /directory is unsafe/,
    );
  });

  it("never overwrites a collision and removes its temporary file", () => {
    const store = createStore(["namespace-a", "namespace-a"]);
    const first = store.create({
      attachmentId: "attachment-a",
      filename: "same.txt",
      content: Buffer.from("first"),
    });

    expect(() =>
      store.create({
        attachmentId: "attachment-a",
        filename: "same.txt",
        content: Buffer.from("second"),
      }),
    ).toThrow();
    expect(
      readFileSync(store.resolveAvailablePath(first.storagePath), "utf8"),
    ).toBe("first");
    expect(
      readdirSync(
        dirname(store.resolveAvailablePath(first.storagePath)),
      ).filter((name) => name.includes("temporary-a")),
    ).toEqual([]);
  });

  it("observes external edits without changing attachment identity", () => {
    const store = createStore();
    const created = store.create({
      attachmentId: "attachment-a",
      filename: "mutable.txt",
      content: Buffer.from("before"),
    });
    const path = store.resolveAvailablePath(created.storagePath);

    writeFileSync(path, Buffer.alloc(0));
    const observed = store.observe(created.storagePath);

    expect(observed).toMatchObject({
      status: "available",
      storagePath: created.storagePath,
      byteSize: 0,
    });
    expect(observed.modifiedAt).toEqual(expect.any(Number));
    expect(store.read(created.storagePath).content).toEqual(Buffer.alloc(0));
  });

  it("resolves a safe containing directory when the target is missing", () => {
    const store = createStore();
    const created = store.create({
      attachmentId: "attachment-a",
      filename: "mutable.txt",
      content: Buffer.from("before"),
    });
    unlinkSync(store.resolveAvailablePath(created.storagePath));

    expect(store.resolveSafeContainingDirectory(created.storagePath)).toBe(
      join(
        realpathSync(dataDirectory),
        "attachments",
        "v1",
        "namespace-a",
        "attachment-a",
      ),
    );
  });

  it("bounds reads after an external file grows", () => {
    const store = new ManagedAttachmentStore(dataDirectory, {
      namespaceFactory: () => "namespace-a",
      temporaryNameFactory: () => "temporary-a",
      maximumReadableBytes: 4,
    });
    const created = store.create({
      attachmentId: "attachment-a",
      filename: "large.txt",
      content: Buffer.from("12345"),
    });

    expect(() => store.read(created.storagePath)).toThrow(
      ManagedAttachmentTooLargeError,
    );
  });

  it("rejects a file that changes while its descriptor is being read", () => {
    let managedPath = "";
    let changed = false;
    const store = new ManagedAttachmentStore(dataDirectory, {
      namespaceFactory: () => "namespace-a",
      temporaryNameFactory: () => "temporary-a",
      descriptorRead: (descriptor, buffer, offset, length, position) => {
        const bytesRead = readSync(
          descriptor,
          buffer,
          offset,
          length,
          position,
        );
        if (!changed && managedPath) {
          changed = true;
          writeFileSync(managedPath, "changed while reading");
        }
        return bytesRead;
      },
    });
    const created = store.create({
      attachmentId: "attachment-a",
      filename: "mutable.txt",
      content: Buffer.from("before"),
    });
    managedPath = store.resolveAvailablePath(created.storagePath);

    expect(() => store.read(created.storagePath)).toThrow(
      ManagedAttachmentChangedError,
    );
  });

  it.runIf(process.platform !== "win32")(
    "rejects a pathname atomically replaced while reading",
    () => {
      let managedPath = "";
      let replaced = false;
      const store = new ManagedAttachmentStore(dataDirectory, {
        namespaceFactory: () => "namespace-a",
        temporaryNameFactory: () => "temporary-a",
        descriptorRead: (descriptor, buffer, offset, length, position) => {
          const bytesRead = readSync(
            descriptor,
            buffer,
            offset,
            length,
            position,
          );
          if (!replaced && managedPath) {
            replaced = true;
            const replacementPath = `${managedPath}.replacement`;
            writeFileSync(replacementPath, "after!");
            renameSync(replacementPath, managedPath);
          }
          return bytesRead;
        },
      });
      const created = store.create({
        attachmentId: "attachment-a",
        filename: "mutable.txt",
        content: Buffer.from("before"),
      });
      managedPath = store.resolveAvailablePath(created.storagePath);

      expect(() => store.read(created.storagePath)).toThrow(
        ManagedAttachmentChangedError,
      );
      expect(readFileSync(managedPath, "utf8")).toBe("after!");
    },
  );

  it("rejects an unexpected early end while reading", () => {
    const store = new ManagedAttachmentStore(dataDirectory, {
      namespaceFactory: () => "namespace-a",
      temporaryNameFactory: () => "temporary-a",
      descriptorRead: () => 0,
    });
    const created = store.create({
      attachmentId: "attachment-a",
      filename: "short.txt",
      content: Buffer.from("content"),
    });

    expect(() => store.read(created.storagePath)).toThrow(
      ManagedAttachmentChangedError,
    );
  });

  it.each([
    "/absolute/file.txt",
    "../attachments/v1/ns/id/file.txt",
    "attachments/v1/../../outside.txt",
    "attachments/v1/ns/./file.txt",
    "attachments/v1/ns/id/../file.txt",
    "attachments/v1/ns/id/subdirectory/file.txt",
    "attachments\\v1\\ns\\id\\file.txt",
    "C:\\attachments\\v1\\ns\\id\\file.txt",
    "\\\\server\\share\\file.txt",
    "attachments/v1/ns/id/file\0.txt",
    "attachments/v1/ns/id/file:name.txt",
    "attachments/v1/ns:bad/id/file.txt",
    "other/v1/ns/id/file.txt",
  ])("rejects unsafe repository path %s", (storagePath) => {
    const store = createStore();

    expect(store.observe(storagePath)).toEqual({
      status: "unsafe",
      storagePath,
    });
    expect(() => store.read(storagePath)).toThrow(
      ManagedAttachmentUnavailableError,
    );
    expect(() => store.resolveAvailablePath(storagePath)).toThrow(
      ManagedAttachmentUnavailableError,
    );
    expect(() => store.resolveSafeContainingDirectory(storagePath)).toThrow(
      ManagedAttachmentUnavailableError,
    );
    expect(store.remove(storagePath)).toBe("unsafe");
  });

  it.runIf(process.platform !== "win32")(
    "refuses a symlinked managed root",
    () => {
      const outsideDirectory = join(dataDirectory, "outside-root");
      mkdirSync(outsideDirectory);
      symlinkSync(outsideDirectory, join(dataDirectory, "attachments"));

      expect(() => new ManagedAttachmentStore(dataDirectory)).toThrow(
        /directory is unsafe/,
      );
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects symlinked targets and ancestors without reading outside the root",
    () => {
      const store = createStore();
      const created = store.create({
        attachmentId: "attachment-a",
        filename: "linked.txt",
        content: Buffer.from("managed"),
      });
      const managedPath = store.resolveAvailablePath(created.storagePath);
      const outsidePath = join(dataDirectory, "outside.txt");
      writeFileSync(outsidePath, "outside");
      unlinkSync(managedPath);
      symlinkSync(outsidePath, managedPath);

      expect(store.observe(created.storagePath)).toEqual({
        status: "unsafe",
        storagePath: created.storagePath,
      });
      expect(() => store.read(created.storagePath)).toThrow(
        ManagedAttachmentUnavailableError,
      );
      expect(store.remove(created.storagePath)).toBe("removed");
      expect(readFileSync(outsidePath, "utf8")).toBe("outside");

      const namespacePath = join(
        dataDirectory,
        "attachments",
        "v1",
        "namespace-link",
      );
      const outsideDirectory = join(dataDirectory, "outside-directory");
      mkdirSync(join(outsideDirectory, "attachment-b"), { recursive: true });
      writeFileSync(
        join(outsideDirectory, "attachment-b", "outside.txt"),
        "outside ancestor",
      );
      symlinkSync(outsideDirectory, namespacePath);
      const ancestorPath =
        "attachments/v1/namespace-link/attachment-b/outside.txt";

      expect(store.observe(ancestorPath)).toEqual({
        status: "unsafe",
        storagePath: ancestorPath,
      });
      expect(() => store.resolveSafeContainingDirectory(ancestorPath)).toThrow(
        ManagedAttachmentUnavailableError,
      );
      expect(store.remove(ancestorPath)).toBe("unsafe");
      expect(
        readFileSync(
          join(outsideDirectory, "attachment-b", "outside.txt"),
          "utf8",
        ),
      ).toBe("outside ancestor");
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects a Windows junction that escapes the managed root",
    () => {
      const store = createStore();
      const outsideDirectory = join(dataDirectory, "outside-junction");
      mkdirSync(join(outsideDirectory, "attachment-a"), { recursive: true });
      writeFileSync(
        join(outsideDirectory, "attachment-a", "outside.txt"),
        "outside",
      );
      symlinkSync(
        outsideDirectory,
        join(dataDirectory, "attachments", "v1", "namespace-junction"),
        "junction",
      );
      const storagePath =
        "attachments/v1/namespace-junction/attachment-a/outside.txt";

      expect(store.observe(storagePath)).toEqual({
        status: "unsafe",
        storagePath,
      });
      expect(store.remove(storagePath)).toBe("unsafe");
    },
  );

  it("distinguishes missing and non-regular managed paths", () => {
    const store = createStore();
    const created = store.create({
      attachmentId: "attachment-a",
      filename: "missing.txt",
      content: Buffer.from("managed"),
    });
    const path = store.resolveAvailablePath(created.storagePath);
    unlinkSync(path);

    expect(store.observe(created.storagePath)).toEqual({
      status: "missing",
      storagePath: created.storagePath,
    });
    expect(store.remove(created.storagePath)).toBe("missing");

    mkdirSync(path);
    expect(store.observe(created.storagePath)).toEqual({
      status: "unsafe",
      storagePath: created.storagePath,
    });
  });

  it.runIf(process.platform !== "win32")(
    "reports unreadable files without exposing their absolute paths",
    () => {
      const store = createStore();
      const created = store.create({
        attachmentId: "attachment-a",
        filename: "private.txt",
        content: Buffer.from("managed"),
      });
      const path = store.resolveAvailablePath(created.storagePath);
      chmodSync(path, 0o000);

      try {
        expect(store.observe(created.storagePath)).toEqual({
          status: "unreadable",
          storagePath: created.storagePath,
        });
        expect(() => store.read(created.storagePath)).toThrow(
          ManagedAttachmentUnavailableError,
        );
      } finally {
        chmodSync(path, 0o600);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "reports unreadable managed ancestors distinctly",
    () => {
      const store = createStore();
      const created = store.create({
        attachmentId: "attachment-a",
        filename: "private.txt",
        content: Buffer.from("managed"),
      });
      const path = store.resolveAvailablePath(created.storagePath);
      const namespaceDirectory = dirname(dirname(path));
      chmodSync(namespaceDirectory, 0o000);

      try {
        expect(store.observe(created.storagePath)).toEqual({
          status: "unreadable",
          storagePath: created.storagePath,
        });
        expect(store.remove(created.storagePath)).toBe("unreadable");
      } finally {
        chmodSync(namespaceDirectory, 0o700);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "reports a non-writable attachment directory as unreadable on removal",
    () => {
      const store = createStore();
      const created = store.create({
        attachmentId: "attachment-a",
        filename: "private.txt",
        content: Buffer.from("managed"),
      });
      const path = store.resolveAvailablePath(created.storagePath);
      const attachmentDirectory = dirname(path);
      chmodSync(attachmentDirectory, 0o500);

      try {
        expect(store.remove(created.storagePath)).toBe("unreadable");
      } finally {
        chmodSync(attachmentDirectory, 0o700);
      }
    },
  );

  it("removes managed files and prunes empty owned directories", () => {
    const store = createStore();
    const created = store.create({
      attachmentId: "attachment-a",
      filename: "remove.txt",
      content: Buffer.from("managed"),
    });
    const path = store.resolveAvailablePath(created.storagePath);
    const attachmentDirectory = dirname(path);

    expect(store.remove(created.storagePath)).toBe("removed");
    expect(existsSync(path)).toBe(false);
    expect(existsSync(attachmentDirectory)).toBe(false);
    expect(store.observe(created.storagePath).status).toBe("missing");
  });
});
