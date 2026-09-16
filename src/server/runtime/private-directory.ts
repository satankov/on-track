import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

const WINDOWS_PRIVATE_DIRECTORY = `
$ErrorActionPreference = 'Stop'
# Use .NET directly: cold cmdlet module discovery can exceed the startup budget.
$PSModuleAutoLoadingPreference = 'None'
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
$path = $env:ON_TRACK_PRIVATE_DIRECTORY
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
# Persist only the owner and DACL we changed, not unset group/audit sections.
$directory = [IO.DirectoryInfo]::new($path)
$directory.SetAccessControl($acl)
$actual = $directory.GetAccessControl()
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or $rules[0].InheritanceFlags -ne [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' -or $rules[0].PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None) { throw 'Unexpected directory access' }
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
    if (
      (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT"
    )
      throw new Error(
        "Private threadstr directory permission check timed out.",
      );
    if (result.error || result.status !== 0)
      throw new Error(
        "Could not establish private threadstr directory permissions.",
      );
  } else chmodSync(path, 0o700);
  return realpathSync(path);
}
