import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute, relative, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { privateDirectory } from "./state.js";
import { statIfPresent, type UninstallPlan } from "./uninstall-plan.js";

// Fixed code, literal JSON paths, no shell interpolation or force-killing.
export const WINDOWS_UNINSTALL_CLEANUP = String.raw`
param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference='Stop'
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$job=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$receipt=[IO.Path]::Combine([IO.Path]::GetDirectoryName($JobFile),'result.txt')
$ready=[IO.Path]::Combine([IO.Path]::GetDirectoryName($JobFile),'ready')
function Directory-Safe([string]$path) {
  $dir=[IO.DirectoryInfo]::new($path)
  if(-not $dir.Exists -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw "Unsafe cleanup directory: $path"}
  if($dir.Parent){Directory-Safe $dir.Parent.FullName}
}
function Remove-Tree([string]$path) {
  $dir=[IO.DirectoryInfo]::new($path)
  if($dir.Attributes -band [IO.FileAttributes]::ReparsePoint){$dir.Delete();return}
  foreach($file in $dir.GetFiles()) {$file.Delete()}
  foreach($child in $dir.GetDirectories()) {Remove-Tree $child.FullName}
  $dir.Delete()
}
try {
  Directory-Safe $job.plan.root
  $marker=[IO.Path]::Combine($job.plan.root,'.on-track-uninstall.json')
  $saved=Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  if($saved.token -cne $job.token){throw 'Cleanup identity changed'}
  $wait=@()
  foreach($identity in $job.processes) {
    try {$p=[Diagnostics.Process]::GetProcessById([int]$identity.pid)} catch {continue}
    if($p.MainModule.FileName -ine $identity.executable){continue}
    # Capturing an OS process object before readiness avoids acting on a reused PID.
    $null=$p.StartTime
    $wait+=,$p
  }
  foreach($item in $job.plan.app) {
    if([IO.File]::Exists($item.path) -or [IO.Directory]::Exists($item.path)) {
      Directory-Safe ([IO.Path]::GetDirectoryName($item.path))
      $info=Get-Item -LiteralPath $item.path -Force
      if($info.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked cleanup target'}
      $created=([DateTimeOffset]$info.CreationTimeUtc).ToUnixTimeMilliseconds()
      if([Math]::Abs($created-$item.birthtimeMs) -gt 2){throw 'Cleanup target changed'}
    }
  }
  [IO.File]::WriteAllText($ready,'ready')
  foreach($p in $wait){if(-not $p.WaitForExit(60000)){throw 'Launcher still running; retry cleanup after it exits'}}
  Directory-Safe $job.plan.root
  $saved=Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  if($saved.token -cne $job.token){throw 'Cleanup identity changed'}
  foreach($item in $job.plan.app) {
    if(-not ([IO.File]::Exists($item.path) -or [IO.Directory]::Exists($item.path))){continue}
    Directory-Safe ([IO.Path]::GetDirectoryName($item.path))
    $info=Get-Item -LiteralPath $item.path -Force
    $created=([DateTimeOffset]$info.CreationTimeUtc).ToUnixTimeMilliseconds()
    if(($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or [Math]::Abs($created-$item.birthtimeMs) -gt 2){throw 'Cleanup target changed'}
    if($item.directory){Remove-Tree $item.path}else{[IO.File]::Delete($item.path)}
  }
  $bin=[IO.Path]::Combine($job.plan.root,'bin')
  $old=[string][Environment]::GetEnvironmentVariable('Path','User')
  $next=($old -split ';' | Where-Object {$_ -cne $bin}) -join ';'
  if($old -cne $next){[Environment]::SetEnvironmentVariable('Path',$next,'User')}
  # Keep ownership inodes stable across concurrent process startup.
  [IO.File]::Delete($marker)
  foreach($path in $job.plan.directories) {
    if([IO.Directory]::Exists($path)) {
      Directory-Safe $path
      if([IO.Directory]::GetFileSystemEntries($path).Length -eq 0){[IO.Directory]::Delete($path)}
    }
  }
  $retained=@()
  foreach($path in @($job.plan.root,$job.plan.data)) {
    if([IO.Directory]::Exists($path)){$retained+=[IO.Directory]::GetFileSystemEntries($path)}
  }
  [IO.File]::WriteAllText($receipt,('Uninstall complete. Retained paths:'+([Environment]::NewLine)+($retained -join [Environment]::NewLine)))
  [IO.File]::Delete($ready)
  [IO.File]::Delete($JobFile)
  [IO.File]::Delete($PSCommandPath)
} catch {
  [IO.File]::WriteAllText($receipt,('Cleanup incomplete: '+$_.Exception.Message+'. Rerun cleanup.ps1 with the same -JobFile after resolving the error.'))
  exit 1
}
`;

export async function scheduleWindowsCleanup(
  plan: UninstallPlan,
  token: string,
  interpreter: string,
): Promise<string> {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !isAbsolute(systemRoot))
    throw new Error("Cannot locate system PowerShell for cleanup.");
  const temporaryRoot = realpathSync(tmpdir());
  for (const root of [plan.root, plan.data]) {
    const path = relative(root, temporaryRoot);
    if (
      path === "" ||
      (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
    )
      throw new Error(
        "Choose a temporary directory outside the runtime and data roots before retrying uninstall.",
      );
  }
  const directory = privateDirectory(
    mkdtempSync(join(temporaryRoot, "threadstr-uninstall-")),
  );
  const script = join(directory, "cleanup.ps1"),
    job = join(directory, "job.json");
  writeFileSync(script, WINDOWS_UNINSTALL_CLEANUP, { flag: "wx", mode: 0o600 });
  writeFileSync(
    job,
    JSON.stringify({
      plan,
      token,
      processes: [
        { pid: process.pid, executable: process.execPath },
        { pid: process.ppid, executable: interpreter },
      ],
    }),
    { flag: "wx", mode: 0o600 },
  );
  const home = join(systemRoot, "System32/WindowsPowerShell/v1.0");
  const child = spawn(
    join(home, "powershell.exe"),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-JobFile",
      job,
    ],
    {
      cwd: directory,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        PSModulePath: join(home, "Modules"),
        WinPSModulePath: join(home, "Modules"),
      },
    },
  );
  let failure: Error | undefined;
  let exited = false;
  child.once("error", (error) => {
    failure = error;
  });
  child.once("exit", () => {
    exited = true;
  });
  child.unref();
  const receipt = join(directory, "result.txt"),
    deadline = Date.now() + 15000;
  while (!statIfPresent(join(directory, "ready"))) {
    if (failure || exited || Date.now() > deadline)
      throw new Error(
        `Windows cleanup did not become ready. Inspect ${receipt}; retry ${script} with -JobFile ${job}.`,
        { cause: failure },
      );
    await delay(100);
  }
  if (statIfPresent(receipt)) throw new Error(readFileSync(receipt, "utf8"));
  return receipt;
}
