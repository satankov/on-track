import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  defaultInstallRoot,
  installCommand,
  validateLocalBrowserUrl,
  updateProfile,
} from "./platform.js";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
test("platform defaults separate runtime from data", () => {
  expect(defaultInstallRoot("darwin", "/Users/test", {})).toBe(
    "/Users/test/Library/Application Support/On Track Runtime",
  );
  expect(defaultInstallRoot("linux", "/home/test", {})).toBe(
    "/home/test/.local/share/on-track-runtime",
  );
  expect(defaultInstallRoot("win32", "C:\\Users\\Test", {})).toBe(
    "C:\\Users\\Test\\AppData\\Local\\On Track Runtime",
  );
  expect(() => defaultInstallRoot("freebsd", "/home/test", {})).toThrow(
    /supported/,
  );
});
test("browser adapter accepts only local threadstr addresses", () => {
  expect(validateLocalBrowserUrl("http://127.0.0.1:3000/")).toBe(
    "http://127.0.0.1:3000/",
  );
  for (const url of [
    "https://example.com",
    "file:///tmp/a",
    "http://localhost:3000",
    "http://x@127.0.0.1:3000/",
    "http://127.0.0.1:3000/?x=1",
  ])
    expect(() => validateLocalBrowserUrl(url)).toThrow();
});
test("profile block preserves content and is idempotent", () => {
  const text = updateProfile("# keep\n", "/a b/é/bin");
  expect(text).toContain("# keep\n");
  expect(updateProfile(text, "/a b/é/bin")).toBe(text);
  expect(text).toContain("export PATH=");
});
test("no-profile creates executable command without touching home profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "threadstr-platform-"));
  roots.push(root);
  mkdirSync(join(root, "runtimes"), { recursive: true });
  const command = await installCommand(root, { noProfile: true });
  expect(readFileSync(command, "utf8")).toContain("command.mjs");
  expect(readFileSync(join(root, "bin", "command.mjs"), "utf8")).toContain(
    "active.json",
  );
});

test("atomic profile replacement preserves existing permissions and content", async () => {
  const { writeProfileAtomically } = await import("./platform.js");
  const { writeFileSync, statSync, readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "threadstr-profile-"));
  roots.push(root);
  const path = join(root, "profile");
  writeFileSync(path, "# custom\n", { mode: 0o640 });
  const originalMode = statSync(path).mode & 0o777;
  writeProfileAtomically(path, "/some/bin");
  writeProfileAtomically(path, "/some/bin");
  expect(readFileSync(path, "utf8")).toContain("# custom\n");
  expect(statSync(path).mode & 0o777).toBe(originalMode);
  expect(readdirSync(root)).toEqual(["profile"]);
});
