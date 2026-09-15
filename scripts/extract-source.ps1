param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination,[Parameter(Mandatory=$true)][string]$Inventory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$files=Get-Content -LiteralPath $Inventory -Raw | ConvertFrom-Json
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $seen=@{}
  foreach($entry in $zip.Entries) {
    $name=$entry.FullName
    if($seen.ContainsKey($name)) { throw 'Duplicate archive entry' }
    $seen[$name]=$true
    if(($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'Source links are unsupported' }
    if($name.EndsWith('/')) { continue }
    $expected=$files.PSObject.Properties[$name]
    if($null -eq $expected) { throw 'Unexpected source entry' }
    if($name -match '(^/|\\|:|(^|/)\.\.?(/|$))') { throw 'Unsafe source path' }
    if($entry.Length -ne $expected.Value.size) { throw 'Source size mismatch' }
    $target=Join-Path $Destination $name
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    $inputStream=$entry.Open()
    $output=[IO.File]::Open($target,[IO.FileMode]::CreateNew)
    try {
      $buffer=New-Object byte[] 65536
      $total=0L
      while(($count=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
        $total+=$count
        if($total -gt $expected.Value.size) { throw 'Source expansion limit exceeded' }
        $output.Write($buffer,0,$count)
      }
      if($total -ne $expected.Value.size) { throw 'Source is incomplete' }
    } finally { $output.Dispose();$inputStream.Dispose() }
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.Value.sha256) { throw 'Source checksum mismatch' }
  }
  foreach($property in $files.PSObject.Properties) { if(!$seen.ContainsKey($property.Name)){ throw 'Missing source entry' } }
} finally { $zip.Dispose() }
