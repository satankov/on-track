import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

const WINDOWS_PRIVATE_DIRECTORY = `
$ErrorActionPreference = 'Stop'
$path = $env:ON_TRACK_PRIVATE_DIRECTORY
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $path -AclObject $acl
$actual = Get-Acl -LiteralPath $path
if (-not $actual.AreAccessRulesProtected) { throw 'Unprotected directory' }
foreach ($access in $actual.Access) {
 if ($access.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $access.AccessControlType -ne 'Allow') { throw 'Unexpected directory access' }
}
`;

/** Restrict operational capabilities before writing metadata or checkpoints. */
export function ensurePrivateDirectory(path: string): string {
  if (!isAbsolute(path))
    throw new Error("A private directory must be absolute.");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Unsafe private directory.");
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(WINDOWS_PRIVATE_DIRECTORY, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        shell: false,
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, ON_TRACK_PRIVATE_DIRECTORY: path },
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        "Could not establish private On Track directory permissions.",
      );
  } else chmodSync(path, 0o700);
  return realpathSync(path);
}
