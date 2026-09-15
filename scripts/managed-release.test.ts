import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createManagedManifest,
  packageManagedRelease,
  validateSourceEntries,
} from "./managed-release.mjs";

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0))
    rmSync(path, { recursive: true, force: true });
});
const entry = (path: string, mode = "100644", contents = "source") => ({
  path,
  mode,
  bytes: Buffer.from(contents),
});
const description = {
  protocol: 1,
  version: "0.0.9",
  releaseId: "v0.0.9",
  buildId: "b".repeat(64),
  schemaVersion: 7,
  migrationMarker: 123,
};
const pins = JSON.parse(
  readFileSync(new URL("./managed-runtime.json", import.meta.url), "utf8"),
);
describe("managed release packaging", () => {
  it("keeps executable bootstrap runtime pins identical to the reviewed manifest pins", () => {
    const shell = readFileSync(
      new URL("./install.sh", import.meta.url),
      "utf8",
    );
    const powershell = readFileSync(
      new URL("./install.ps1", import.meta.url),
      "utf8",
    );
    for (const [platform, value] of Object.entries(pins.runtimes)) {
      const runtime = value as { version: string; sha256: string };
      const script = platform.startsWith("win-") ? powershell : shell;
      expect(script).toContain(runtime.version);
      expect(script).toContain(runtime.sha256);
    }
  });
  it("inventories exact source bytes and accepts executable regular scripts", () => {
    expect(
      validateSourceEntries([
        entry("src/main.ts"),
        entry("scripts/install.sh", "100755"),
      ]),
    ).toEqual({
      "src/main.ts": {
        sha256: createHash("sha256").update("source").digest("hex"),
        size: 6,
      },
      "scripts/install.sh": {
        sha256: createHash("sha256").update("source").digest("hex"),
        size: 6,
      },
    });
  });
  it.each([
    "../outside",
    "/absolute",
    "C:/root",
    "a/question?.txt",
    "a/nonascii-ü.txt",
    "a/" + "x".repeat(239),
    "a\\b",
    "a/CON.txt",
    "a/file.",
    "a/file ",
    "a/.env",
    ".codex/private/CONTEXT.md",
    "db.sqlite-wal",
    "node_modules/pkg/index.js",
    "a/.on-track-update-journal.json",
  ])("rejects unsafe or private source path %s", (path) => {
    expect(() => validateSourceEntries([entry(path)])).toThrow(
      /Unsafe|private|data/,
    );
  });
  it("rejects links and case-insensitive aliases", () => {
    expect(() => validateSourceEntries([entry("linked", "120000")])).toThrow(
      /regular/,
    );
    expect(() =>
      validateSourceEntries([entry("src/Name.ts"), entry("src/name.ts")]),
    ).toThrow(/alias/);
    expect(() =>
      validateSourceEntries([
        entry("src/Folder/a.ts"),
        entry("src/folder/b.ts"),
      ]),
    ).toThrow(/alias/);
  });
  it("uses the installer's file count and byte limits", () => {
    expect(() =>
      validateSourceEntries(
        Array.from({ length: 10_001 }, (_, index) => entry(`src/${index}`)),
      ),
    ).toThrow(/inventory/);
    expect(() =>
      validateSourceEntries([
        { ...entry("src/large"), bytes: Buffer.alloc(20 * 1024 * 1024 + 1) },
      ]),
    ).toThrow(/file size/);
    const bytes = Buffer.alloc(20 * 1024 * 1024);
    expect(() =>
      validateSourceEntries(
        Array.from({ length: 6 }, (_, index) => ({
          ...entry(`src/${index}`),
          bytes,
        })),
      ),
    ).toThrow(/expanded/);
  });
  it("makes a manifest with exact fixed asset identity", () => {
    const manifest = createManagedManifest({
      description,
      commit: "a".repeat(40),
      minimumVersion: "0.0.8",
      sourceBytes: Buffer.from("zip"),
      sourceFiles: validateSourceEntries([entry("src/main.ts")]),
      runtimes: pins.runtimes,
    });
    expect(manifest).toMatchObject({
      formatVersion: 1,
      managedProtocol: 1,
      browserApiProtocol: 1,
      migrationScope: "database-only",
      version: "0.0.9",
      minimumUpgradeVersion: "0.0.8",
      source: {
        name: "on-track-v0.0.9.zip",
        url: "https://github.com/satankov/on-track/releases/download/v0.0.9/on-track-v0.0.9.zip",
        size: 3,
      },
      runtimes: pins.runtimes,
    });
  });
  it("refuses an invented minimum version or an untrusted runtime URL", () => {
    const input = {
      description,
      commit: "a".repeat(40),
      minimumVersion: "0.1.0",
      sourceBytes: Buffer.from("zip"),
      sourceFiles: {},
      runtimes: pins.runtimes,
    };
    expect(() => createManagedManifest(input)).toThrow(/minimum/i);
    expect(() =>
      createManagedManifest({
        ...input,
        minimumVersion: "0.0.8",
        runtimes: {
          ...pins.runtimes,
          "win-x64": {
            ...pins.runtimes["win-x64"],
            url: "https://example.com/node.zip",
          },
        },
      }),
    ).toThrow(/runtime/i);
  });
  it("packages committed source only and renders versioned installer assets", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "ontrack-package-test-"));
    cleanup.push(temporary);
    const root = join(temporary, "repo");
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "0.0.9" }),
    );
    writeFileSync(
      join(root, "scripts/managed-bootstrap.mjs"),
      "console.log('bootstrap');\n",
    );
    for (const name of ["install.sh", "install.ps1"])
      writeFileSync(
        join(root, "scripts", name),
        "__ONTRACK_RELEASE__ __ONTRACK_BOOTSTRAP_SHA256__ __ONTRACK_MANIFEST_SHA256__\n",
      );
    writeFileSync(
      join(root, "scripts/managed-runtime.json"),
      JSON.stringify(pins),
    );
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git(["init", "--quiet"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Fixture",
    ]);
    const output = join(temporary, "assets");
    await packageManagedRelease({
      root,
      output,
      minimumVersion: "0.0.9",
      describe: () => description,
    });
    const manifest = JSON.parse(
      readFileSync(join(output, "managed-release.json"), "utf8"),
    );
    const instructions = readFileSync(join(output, "INSTALL.md"), "utf8");
    expect(instructions).toContain("/releases/download/v0.0.9/install.sh");
    expect(instructions).toContain("/releases/download/v0.0.9/install.ps1");
    expect(instructions).toContain("npm run quickstart");
    const names = execFileSync(
      "unzip",
      ["-Z1", join(output, manifest.source.name)],
      { encoding: "utf8" },
    );
    expect(names.split("\n")).toContain("package.json");
    expect(readFileSync(join(output, "install.sh"), "utf8")).toBe(
      `v0.0.9 ${createHash("sha256")
        .update(readFileSync(join(output, "managed-bootstrap.mjs")))
        .digest("hex")} ${createHash("sha256")
        .update(readFileSync(join(output, "managed-release.json")))
        .digest("hex")}\n`,
    );
    expect(manifest.source.sha256).toBe(
      createHash("sha256")
        .update(readFileSync(join(output, manifest.source.name)))
        .digest("hex"),
    );
    writeFileSync(join(root, "untracked.txt"), "local");
    await expect(
      packageManagedRelease({
        root,
        output: join(temporary, "dirty"),
        minimumVersion: "0.0.9",
        describe: () => description,
      }),
    ).rejects.toThrow(/committed|clean/);
  });
});
