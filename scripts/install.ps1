param(
 [string]$Root = (Join-Path $env:LOCALAPPDATA 'On Track Runtime'),
 [string]$DataDir,
 [int]$Port,
 [string]$AdoptFrom,
 [switch]$NoProfile,
 [switch]$NoOpen,
 [switch]$Help
)
$ErrorActionPreference = 'Stop'
# Use this PowerShell's built-in modules even when launched through Node from pwsh.
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
$Release = '__ONTRACK_RELEASE__'
$BootstrapHash = '__ONTRACK_BOOTSTRAP_SHA256__'
$ManifestHash = '__ONTRACK_MANIFEST_SHA256__'
function Receive-Asset([string]$Address, [string]$Destination, [long]$MaximumBytes) {
 $uri = [Uri]$Address
 for ($redirect = 0; $redirect -lt 4; $redirect++) {
  if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or @('nodejs.org','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com') -notcontains $uri.Host) { throw 'Untrusted download address.' }
  $request = [Net.HttpWebRequest]::Create($uri)
  $request.AllowAutoRedirect = $false
  $request.Timeout = 180000
  $request.ReadWriteTimeout = 30000
  $response = $request.GetResponse()
  try {
   if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) { $uri = New-Object Uri($uri, $response.Headers['Location']); continue }
   if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt $MaximumBytes) { throw 'Invalid download response.' }
   $inputStream = $response.GetResponseStream()
   $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew)
   try {
    $buffer = New-Object byte[] 65536
    $total = 0
    while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
     $total += $count
     if ($total -gt $MaximumBytes) { throw 'Download exceeds limit.' }
     $outputStream.Write($buffer, 0, $count)
    }
   } finally { $outputStream.Dispose(); $inputStream.Dispose() }
   return
  } finally { $response.Dispose() }
 }
 throw 'Too many download redirects.'
}

if ($Help) { Write-Output 'install.ps1 [-Root PATH] [-DataDir PATH] [-Port N] [-AdoptFrom PATH] [-NoProfile] [-NoOpen]'; exit 0 }
if ($Release.StartsWith('__')) { throw 'Use an installer generated for a published release. Manual setup remains npm run quickstart.' }
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Managed setup supports Windows x64 only. Use manual installation.' }
if (-not [IO.Path]::IsPathRooted($Root)) { throw 'Installation root must be absolute.' }
if ((Test-Path -LiteralPath $Root) -and ((Get-Item -LiteralPath $Root).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation root cannot be a link.' }
[IO.Directory]::CreateDirectory($Root) | Out-Null
# Protect executable storage before creating or downloading any executable bytes.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
# Persist only the changed owner/DACL, not an unset primary group or audit section.
(Get-Item -LiteralPath $Root).SetAccessControl($acl)
$verified = Get-Acl -LiteralPath $Root
$rules = @($verified.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if (-not $verified.AreAccessRulesProtected -or $verified.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Could not protect installation directory.' }

$claim = Join-Path $Root '.bootstrap-claim'
# FileMode.CreateNew fails atomically if a competing or interrupted setup owns this root.
$claimStream = [IO.File]::Open($claim, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
 $stage = Join-Path $Root ('bootstrap.' + [Guid]::NewGuid().ToString('N'))
 [IO.Directory]::CreateDirectory($stage) | Out-Null
 $archive = Join-Path $stage 'node.zip'
 [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
 Write-Output 'Preparing the private Node runtime...'
 Receive-Asset 'https://nodejs.org/download/release/v24.14.0/node-v24.14.0-win-x64.zip' $archive 40000000
 if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne '313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66') { throw 'Node checksum verification failed.' }
 Expand-Archive -LiteralPath $archive -DestinationPath $stage
 $nodeDir = Join-Path $stage 'node-v24.14.0-win-x64'
 $bootstrap = Join-Path $stage 'managed-bootstrap.mjs'
 Receive-Asset "https://github.com/satankov/on-track/releases/download/$Release/managed-bootstrap.mjs" $bootstrap 1000000
 if ((Get-FileHash -LiteralPath $bootstrap -Algorithm SHA256).Hash.ToLower() -ne $BootstrapHash) { throw 'Bootstrap checksum verification failed.' }
 $forward = @()
 if ($DataDir) { $forward += @('--data-dir', $DataDir) }
 if ($Port) { $forward += @('--port', "$Port") }
 if ($AdoptFrom) { $forward += @('--adopt-from', $AdoptFrom) }
 if ($NoProfile) { $forward += '--no-profile' }
 if ($NoOpen) { $forward += '--no-open' }
 Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
 Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
 $env:ONTRACK_BOOTSTRAP_MANIFEST_SHA256 = $ManifestHash
 $env:ONTRACK_BOOTSTRAP_RELEASE = $Release
 & (Join-Path $nodeDir 'node.exe') $bootstrap $Root $nodeDir @forward
 if ($LASTEXITCODE -ne 0) { throw 'Setup failed. Preserve the bootstrap directory for diagnostics.' }
 Remove-Item -LiteralPath $stage -Recurse -Force
 Write-Output 'On Track is ready. Open a new terminal to use ontrack.'
} finally {
 $claimStream.Dispose()
 Remove-Item -LiteralPath $claim
}
