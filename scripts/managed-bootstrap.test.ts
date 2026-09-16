import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";
// @ts-expect-error Maintainer/bootstrap entry is plain JavaScript.
import {
  validateSourceManifest,
  getBytes,
  extractSource,
} from "./managed-bootstrap.mjs";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const file = { sha256: sha("{}"), size: 2 };
const manifest = () => ({
  formatVersion: 1,
  managedProtocol: 1,
  browserApiProtocol: 1,
  migrationScope: "database-only",
  version: "0.0.9",
  source: {
    name: "on-track-v0.0.9.zip",
    url: "https://github.com/satankov/on-track/releases/download/v0.0.9/on-track-v0.0.9.zip",
    size: 100,
    sha256: "a".repeat(64),
  },
  sourceFiles: { "package.json": file, "package-lock.json": file },
});
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
test("bootstrap validates fixed source origin and contents before build", () => {
  expect(validateSourceManifest(manifest()).version).toBe("0.0.9");
  for (const path of [
    "../outside",
    "/tmp/target",
    "folder\\other",
    "CON",
    "a/../b",
    "file:stream",
    "a.",
    "file?",
  ]) {
    const value = manifest();
    Object.assign(value.sourceFiles, { [path]: file });
    expect(() => validateSourceManifest(value)).toThrow();
  }
  const wrong = manifest();
  wrong.source.url = "https://example.com/source.zip";
  expect(() => validateSourceManifest(wrong)).toThrow();
});
test("downloader refuses hostile redirect and oversized response", async () => {
  await expect(
    getBytes("https://github.com/file", 4, async () => new Response("12345")),
  ).rejects.toThrow(/limit/);
  await expect(
    getBytes(
      "https://github.com/file",
      10,
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:9/" },
        }),
    ),
  ).rejects.toThrow(/Untrusted/);
  expect(
    (
      await getBytes(
        "https://github.com/file",
        4,
        async () => new Response("1234"),
      )
    ).toString(),
  ).toBe("1234");
});
test("source extraction validates real ZIP bytes before writing and rejects extra entries", () => {
  const root = mkdtempSync(join(tmpdir(), "threadstr-zip-"));
  dirs.push(root);
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "package-lock.json"), "{}");
  const archive = join(root, "source.zip");
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "package.json", "package-lock.json"]);
  const tree = execFileSync("git", ["-C", root, "write-tree"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(
    archive,
    execFileSync("git", ["-C", root, "archive", "--format=zip", tree]),
  );
  extractSource(archive, join(root, "out"), manifest().sourceFiles);
  expect(readFileSync(join(root, "out/package.json"), "utf8")).toBe("{}");
  expect(() =>
    extractSource(archive, join(root, "wrong"), { "package.json": file }),
  ).toThrow(/entries|preparation/);
  expect(() =>
    extractSource(archive, join(root, "hash"), {
      "package.json": { size: 2, sha256: "0".repeat(64) },
      "package-lock.json": file,
    }),
  ).toThrow(/integrity|preparation/);
});
test("unpublished bootstrap help succeeds without networking", () => {
  const result = spawnSync("bash", ["scripts/install.sh", "--help"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("--adopt-from");
  const unpublished = spawnSync("bash", ["scripts/install.sh"], {
    encoding: "utf8",
  });
  expect(unpublished.status).toBe(1);
  expect(unpublished.stderr).toContain("published release");
});

test("pinned manifest hash rejects mutated source before any extraction", async () => {
  // @ts-expect-error Plain bootstrap entry.
  const { verifyManifestBytes } = await import("./managed-bootstrap.mjs");
  const bytes = Buffer.from(JSON.stringify(manifest()));
  expect(verifyManifestBytes(bytes, sha(bytes.toString())).version).toBe(
    "0.0.9",
  );
  expect(() => verifyManifestBytes(bytes, "0".repeat(64))).toThrow(/checksum/);
  expect(() => verifyManifestBytes(bytes, undefined)).toThrow(/checksum/);
});
test("bootstrap uses identical filename and expansion limits as managed CLI", () => {
  const value = manifest();
  Object.assign(value.sourceFiles, { "é.txt": file });
  expect(() => validateSourceManifest(value)).toThrow();
  const oversized = manifest();
  Object.assign(
    oversized.sourceFiles,
    Object.fromEntries(
      Array.from({ length: 6 }, (_, n) => [
        "large" + n,
        { sha256: "a".repeat(64), size: 20 * 1024 * 1024 },
      ]),
    ),
  );
  expect(() => validateSourceManifest(oversized)).toThrow(/contents/);
});
test("installer verifies private root and manifest before executable preparation", () => {
  const ps = readFileSync("scripts/install.ps1", "utf8");
  const protect = ps.indexOf(
    "(Get-Item -LiteralPath $Root).SetAccessControl($acl)",
  );
  const verify = ps.indexOf("$verified.AreAccessRulesProtected");
  const claim = ps.indexOf("$claim = Join-Path");
  expect(protect).toBeGreaterThanOrEqual(0);
  expect(verify).toBeGreaterThan(protect);
  expect(claim).toBeGreaterThan(verify);
  expect(ps).toContain("__ONTRACK_MANIFEST_SHA256__");
  const shell = readFileSync("scripts/install.sh", "utf8");
  expect(shell.indexOf('chmod 700 "$root"')).toBeLessThan(
    shell.indexOf("node_name="),
  );
  expect(shell).toContain("ONTRACK_BOOTSTRAP_MANIFEST_SHA256=");
});
