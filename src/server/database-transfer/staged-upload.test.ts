import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stageUpload, StagedUploadTooLargeError } from "./staged-upload.js";

async function* chunks(...values: Array<Uint8Array>) {
  yield* values;
}

describe("streamed database-transfer upload staging", () => {
  let dataDirectory: string;

  beforeEach(() => {
    dataDirectory = mkdtempSync(join(tmpdir(), "on-track-upload-"));
  });

  afterEach(() => {
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  it("writes chunks incrementally to an exclusive private generated file", async () => {
    let writeCalls = 0;
    const staged = await stageUpload(
      dataDirectory,
      chunks(Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5])),
      {
        maximumBytes: 5,
        nameFactory: () => "generated-token",
        descriptorWrite(descriptor, buffer, offset, length) {
          writeCalls += 1;
          return writeSync(descriptor, buffer, offset, Math.min(length, 2));
        },
      },
    );

    expect(staged.byteSize).toBe(5);
    expect(readFileSync(staged.filePath)).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect(writeCalls).toBeGreaterThan(2);
    expect(basename(staged.filePath)).toBe("upload-generated-token.tmp");
    expect(lstatSync(staged.filePath).isSymbolicLink()).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(staged.filePath).mode & 0o777).toBe(0o600);
      expect(
        statSync(join(dataDirectory, ".transfer-staging")).mode & 0o777,
      ).toBe(0o700);
    }

    staged.dispose();
  });

  it("fsyncs the staged bytes before resolving", async () => {
    const events: Array<string> = [];
    const descriptorSync = vi.fn(() => events.push("fsync"));

    const staged = await stageUpload(dataDirectory, chunks(Buffer.from("db")), {
      maximumBytes: 10,
      nameFactory: () => "sync-proof",
      descriptorSync,
    });
    events.push("resolved");

    expect(events).toEqual(["fsync", "resolved"]);
    expect(descriptorSync).toHaveBeenCalledOnce();
    staged.dispose();
  });

  it("removes the staged file when durable sync fails", async () => {
    await expect(
      stageUpload(dataDirectory, chunks(Buffer.from("db")), {
        maximumBytes: 10,
        nameFactory: () => "sync-failure",
        descriptorSync() {
          throw new Error("disk sync failed");
        },
      }),
    ).rejects.toThrow("disk sync failed");

    expect(
      existsSync(
        join(dataDirectory, ".transfer-staging", "upload-sync-failure.tmp"),
      ),
    ).toBe(false);
  });

  it("removes the partial file when the source fails", async () => {
    async function* failingSource() {
      yield Buffer.from("partial");
      throw new Error("upload disconnected");
    }

    await expect(
      stageUpload(dataDirectory, failingSource(), {
        maximumBytes: 20,
        nameFactory: () => "source-failure",
      }),
    ).rejects.toThrow("upload disconnected");

    expect(
      existsSync(
        join(dataDirectory, ".transfer-staging", "upload-source-failure.tmp"),
      ),
    ).toBe(false);
  });

  it("enforces the byte limit while streaming and removes the partial file", async () => {
    await expect(
      stageUpload(
        dataDirectory,
        chunks(Buffer.from("123"), Buffer.from("456")),
        { maximumBytes: 5, nameFactory: () => "too-large" },
      ),
    ).rejects.toMatchObject({
      name: "StagedUploadTooLargeError",
      maximumBytes: 5,
      byteSize: 6,
    });

    expect(
      existsSync(
        join(dataDirectory, ".transfer-staging", "upload-too-large.tmp"),
      ),
    ).toBe(false);
  });

  it("rejects invalid chunks and removes the partial file", async () => {
    async function* invalidSource(): AsyncIterable<Uint8Array> {
      yield Buffer.from("valid");
      yield "not bytes" as unknown as Uint8Array;
    }

    await expect(
      stageUpload(dataDirectory, invalidSource(), {
        maximumBytes: 20,
        nameFactory: () => "invalid-chunk",
      }),
    ).rejects.toThrow(TypeError);
    expect(
      existsSync(
        join(dataDirectory, ".transfer-staging", "upload-invalid-chunk.tmp"),
      ),
    ).toBe(false);
  });

  it("never removes or overwrites an existing colliding stage", async () => {
    const stagingDirectory = join(dataDirectory, ".transfer-staging");
    const existingPath = join(stagingDirectory, "upload-collision.tmp");
    await stageUpload(dataDirectory, chunks(), {
      maximumBytes: 1,
      nameFactory: () => "setup",
    }).then((staged) => staged.dispose());
    writeFileSync(existingPath, "keep me", { mode: 0o600 });

    await expect(
      stageUpload(dataDirectory, chunks(Buffer.from("replace")), {
        maximumBytes: 20,
        nameFactory: () => "collision",
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(existingPath, "utf8")).toBe("keep me");
  });

  it("rejects relative roots and attacker-controlled generated names", async () => {
    await expect(
      stageUpload("relative", chunks(), {
        maximumBytes: 1,
        nameFactory: () => "safe",
      }),
    ).rejects.toThrow("must be absolute");
    await expect(
      stageUpload(dataDirectory, chunks(), {
        maximumBytes: 1,
        nameFactory: () => "../../escape",
      }),
    ).rejects.toThrow("generated staging name is invalid");
    expect(existsSync(join(dataDirectory, "escape"))).toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "rejects a symlinked staging directory",
    async () => {
      const outside = mkdtempSync(join(tmpdir(), "on-track-upload-outside-"));
      symlinkSync(outside, join(dataDirectory, ".transfer-staging"));

      try {
        await expect(
          stageUpload(dataDirectory, chunks(Buffer.from("secret")), {
            maximumBytes: 20,
            nameFactory: () => "symlink",
          }),
        ).rejects.toThrow("staging directory is unsafe");
        expect(existsSync(join(outside, "upload-symlink.tmp"))).toBe(false);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("disposes successful staging idempotently", async () => {
    const staged = await stageUpload(dataDirectory, chunks(Buffer.from("db")), {
      maximumBytes: 10,
      nameFactory: () => "dispose",
    });

    staged.dispose();
    staged.dispose();

    expect(existsSync(staged.filePath)).toBe(false);
  });

  it("does not delete a file that replaced the staged upload", async () => {
    const staged = await stageUpload(dataDirectory, chunks(Buffer.from("db")), {
      maximumBytes: 10,
      nameFactory: () => "replaced",
    });
    const movedPath = join(dataDirectory, "moved-stage");
    renameSync(staged.filePath, movedPath);
    writeFileSync(staged.filePath, "replacement", { mode: 0o600 });

    staged.dispose();

    expect(readFileSync(staged.filePath, "utf8")).toBe("replacement");
  });

  it("reports overflow with a typed error", () => {
    expect(new StagedUploadTooLargeError(11, 10)).toBeInstanceOf(
      StagedUploadTooLargeError,
    );
  });
});
