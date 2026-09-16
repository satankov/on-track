import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { extractVerifiedSource } from "./archive.js";
import type { ManagedReleaseManifest } from "./release.js";
import { conflictingPowerShellModulePath } from "../../test/powershell-module-fixture.js";
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(link = false) {
  const base = mkdtempSync(join(tmpdir(), "threadstr-archive-"));
  roots.push(base);
  const root = join(base, "source");
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "package.json"), "{}");
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "file.txt"), "verified content");
  if (link) symlinkSync("package.json", join(root, "link"));
  execFileSync("git", ["-C", root, "add", "--all"]);
  const tree = execFileSync("git", ["-C", root, "write-tree"], {
    encoding: "utf8",
  }).trim();
  const archive = join(base, "source.zip");
  writeFileSync(
    archive,
    execFileSync("git", ["-C", root, "archive", "--format=zip", tree]),
  );
  const sourceFiles = Object.fromEntries(
    ["package.json", "nested/file.txt", ...(link ? ["link"] : [])].map(
      (path) => {
        const bytes = readFileSync(join(root, path));
        return [
          path,
          {
            sha256: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.length,
          },
        ];
      },
    ),
  );
  return {
    base,
    archive,
    manifest: { sourceFiles } as ManagedReleaseManifest,
    destination: join(base, "extracted"),
  };
}
it("extracts fixed ZIP entries as regular files only after checking their individual digests", async () => {
  const f = fixture();
  if (process.platform === "win32")
    vi.stubEnv("PSModulePath", conflictingPowerShellModulePath(f.base));
  await extractVerifiedSource(f.archive, f.destination, f.manifest);
  expect(readFileSync(join(f.destination, "nested/file.txt"), "utf8")).toBe(
    "verified content",
  );
});
it("refuses unlisted and missing entries instead of broadly unpacking a source archive", async () => {
  const f = fixture();
  delete f.manifest.sourceFiles["nested/file.txt"];
  await expect(
    extractVerifiedSource(f.archive, f.destination, f.manifest),
  ).rejects.toThrow(/entry|extraction/);
});
it("aborts on a per-entry checksum mismatch", async () => {
  const f = fixture();
  f.manifest.sourceFiles["package.json"].sha256 = "0".repeat(64);
  await expect(
    extractVerifiedSource(f.archive, f.destination, f.manifest),
  ).rejects.toThrow(/checksum|extraction/);
});
it("bounds decompression by the declared per-entry size", async () => {
  const f = fixture();
  f.manifest.sourceFiles["nested/file.txt"].size = 1;
  await expect(
    extractVerifiedSource(f.archive, f.destination, f.manifest),
  ).rejects.toThrow(/limit|extraction/);
});
it.skipIf(process.platform === "win32")(
  "rejects source links even when their content digest is listed",
  async () => {
    const f = fixture(true);
    await expect(
      extractVerifiedSource(f.archive, f.destination, f.manifest),
    ).rejects.toThrow(/link/);
  },
);
