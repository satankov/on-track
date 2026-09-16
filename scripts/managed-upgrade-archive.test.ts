import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createFixtureArchive } from "./managed-upgrade-archive.mjs";
import { extractVerifiedSource } from "../src/server/cli/archive.js";
import type { ManagedReleaseManifest } from "../src/server/cli/release.js";

test("fixture ZIP preserves nested paths and exact bytes for the release extractor", async () => {
  const base = mkdtempSync(join(tmpdir(), "threadstr-fixture-zip-"));
  try {
    const source = join(base, "source with spaces é");
    mkdirSync(join(source, "nested"), { recursive: true });
    const files = {
      "package.json": Buffer.from("{}\r\n"),
      "nested/file.txt": Buffer.from("preserved bytes\r\n"),
      ".gitignore": Buffer.from("nested/\n"),
    };
    for (const [path, bytes] of Object.entries(files))
      writeFileSync(join(source, path), bytes);
    const archive = join(base, "candidate.zip");
    createFixtureArchive(source, archive);
    const manifest = {
      sourceFiles: Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [
          path,
          {
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ]),
      ),
    } as ManagedReleaseManifest;
    const destination = join(base, "extracted");
    await extractVerifiedSource(archive, destination, manifest);
    for (const [path, bytes] of Object.entries(files))
      expect(readFileSync(join(destination, path))).toEqual(bytes);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
