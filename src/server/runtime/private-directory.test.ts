import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ensurePrivateDirectory } from "./private-directory.js";
import { conflictingPowerShellModulePath } from "../../test/powershell-module-fixture.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "threadstr-private-"));
  roots.push(root);
  return root;
}

it("repeatedly protects a directory and makes newly written capabilities owner-only", () => {
  const root = fixture();
  const path = join(root, "private directory");
  if (process.platform === "win32")
    vi.stubEnv("PSModulePath", conflictingPowerShellModulePath(root));
  mkdirSync(path, { mode: 0o755 });
  if (process.platform !== "win32") chmodSync(path, 0o755);
  expect(ensurePrivateDirectory(path)).toBe(realpathSync(path));
  expect(ensurePrivateDirectory(path)).toBe(realpathSync(path));
  const capability = join(path, "capability.json");
  writeFileSync(capability, "{}", { mode: 0o600 });
  if (process.platform === "win32") {
    // Inspect the actual Windows ACL, independently of the production verifier.
    const script = `
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$directory = [IO.DirectoryInfo]::new($env:THREADSTR_TEST_DIRECTORY).GetAccessControl()
$capability = [IO.FileInfo]::new($env:THREADSTR_TEST_CAPABILITY).GetAccessControl()
foreach ($acl in @($directory, $capability)) {
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Unexpected capability access' }
}
if (-not $directory.AreAccessRulesProtected -or $directory.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unexpected directory owner or inheritance' }
`;
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        env: {
          ...process.env,
          THREADSTR_TEST_DIRECTORY: path,
          THREADSTR_TEST_CAPABILITY: capability,
        },
        windowsHide: true,
        timeout: 15_000,
      },
    );
  } else {
    expect(statSync(path).mode & 0o777).toBe(0o700);
    expect(statSync(capability).mode & 0o777).toBe(0o600);
  }
});

it("refuses relative paths, regular files, and directory links", () => {
  expect(() => ensurePrivateDirectory("relative")).toThrow(/absolute/);
  const root = fixture();
  const file = join(root, "file");
  writeFileSync(file, "unchanged");
  expect(() => ensurePrivateDirectory(file)).toThrow();
  const link = join(root, "link");
  symlinkSync(root, link, process.platform === "win32" ? "junction" : "dir");
  expect(() => ensurePrivateDirectory(link)).toThrow(/Unsafe/);
});
