import { spawn } from "node:child_process";
import {
  closeSync,
  openSync,
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
  $job=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
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

// The bootstrap is not detached: detached PowerShell may exit without running.
// Its child is created by Windows PowerShell, outside Node's kill-on-exit job.
export const WINDOWS_UNINSTALL_START = String.raw`
$ErrorActionPreference='Stop'
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$command='& $env:THREADSTR_UNINSTALL_SCRIPT -JobFile $env:THREADSTR_UNINSTALL_JOB'
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
Start-Process -FilePath ([IO.Path]::Combine($PSHOME,'powershell.exe')) -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -WindowStyle Hidden -RedirectStandardError $env:THREADSTR_UNINSTALL_STDERR -ErrorAction Stop
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
  const stderrPath = join(directory, "stderr.txt");
  const stderr = openSync(stderrPath, "wx", 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(
      join(home, "powershell.exe"),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(WINDOWS_UNINSTALL_START, "utf16le").toString("base64"),
      ],
      {
        cwd: directory,
        detached: false,
        stdio: ["ignore", "ignore", stderr],
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          THREADSTR_UNINSTALL_SCRIPT: script,
          THREADSTR_UNINSTALL_JOB: job,
          THREADSTR_UNINSTALL_STDERR: join(directory, "cleanup-stderr.txt"),
          PSModulePath: join(home, "Modules"),
          WinPSModulePath: join(home, "Modules"),
        },
      },
    );
  } finally {
    closeSync(stderr);
  }
  let failure: Error | undefined;
  let exited = false;
  let exitCode: number | null = null;
  child.once("error", (error) => {
    failure = error;
  });
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
  });
  child.unref();
  const receipt = join(directory, "result.txt"),
    deadline = Date.now() + 15000;
  while (!statIfPresent(join(directory, "ready"))) {
    if (
      failure ||
      (exited && exitCode !== 0) ||
      statIfPresent(receipt) ||
      Date.now() > deadline
    ) {
      const detail = [
        receipt,
        stderrPath,
        join(directory, "cleanup-stderr.txt"),
      ]
        .filter((path) => statIfPresent(path))
        .map((path) => readFileSync(path, "utf8").trim())
        .filter(Boolean)
        .join("\n");
      const reason = failure
        ? failure.message
        : exited && exitCode !== 0
          ? `helper launcher exited with exit code ${exitCode ?? "unknown"}`
          : "helper readiness timed out";
      throw new Error(
        `Windows cleanup did not become ready (${reason}). Inspect ${receipt} and ${stderrPath}; retry ${script} with -JobFile ${job}.${detail ? `\n${detail}` : ""}`,
        { cause: failure },
      );
    }
    await delay(100);
  }
  if (statIfPresent(receipt)) throw new Error(readFileSync(receipt, "utf8"));
  return receipt;
}
