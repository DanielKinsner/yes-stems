param(
  [string]$CertificateThumbprint = $env:YES_STEMS_WINDOWS_CERT_THUMBPRINT,
  [string]$TimestampUrl = $env:YES_STEMS_WINDOWS_TIMESTAMP_URL,
  [string]$ResourceDir = "src-tauri/resources/demucs-runtime",
  [string]$SignToolPath = $env:TAURI_WINDOWS_SIGNTOOL_PATH,
  [switch]$UseTsp = ($env:YES_STEMS_WINDOWS_TIMESTAMP_TSP -eq "1")
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ResourcePath = [System.IO.Path]::GetFullPath((Join-Path -Path $RepoRoot -ChildPath $ResourceDir))

function Resolve-SignTool {
  if (-not [string]::IsNullOrWhiteSpace($SignToolPath)) {
    if (-not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) {
      throw "TAURI_WINDOWS_SIGNTOOL_PATH does not point to a file: $SignToolPath"
    }
    return [System.IO.Path]::GetFullPath($SignToolPath)
  }

  $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $kitsRoot = Join-Path -Path ${env:ProgramFiles(x86)} -ChildPath "Windows Kits/10/bin"
  $candidate = Get-ChildItem -Path (Join-Path -Path $kitsRoot -ChildPath "*/x64/signtool.exe") -File -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if ($candidate) {
    return $candidate.FullName
  }

  throw "Could not find signtool.exe. Install the Windows SDK or set TAURI_WINDOWS_SIGNTOOL_PATH."
}

$thumbprint = $CertificateThumbprint.Replace(" ", "").ToUpperInvariant()
if ($thumbprint -notmatch "^[0-9A-F]{40}$") {
  throw "YES_STEMS_WINDOWS_CERT_THUMBPRINT must be a 40-character SHA-1 certificate thumbprint."
}
if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
  throw "YES_STEMS_WINDOWS_TIMESTAMP_URL must be set to the timestamp server supplied by the certificate provider."
}
if (-not (Test-Path -LiteralPath $ResourcePath -PathType Container)) {
  throw "Missing Demucs runtime directory at $ResourcePath"
}

$signTool = Resolve-SignTool
$targets = @(
  Get-ChildItem -LiteralPath $ResourcePath -Recurse -File |
    Where-Object { $_.Extension -in ".exe", ".dll", ".pyd" } |
    Sort-Object FullName
)
if ($targets.Count -eq 0) {
  throw "No signable Demucs runtime binaries were found at $ResourcePath"
}

foreach ($target in $targets) {
  $arguments = @("sign", "/sha1", $thumbprint, "/fd", "SHA256")
  if ($UseTsp) {
    $arguments += @("/tr", $TimestampUrl, "/td", "SHA256")
  }
  else {
    $arguments += @("/t", $TimestampUrl)
  }
  $arguments += $target.FullName

  & $signTool @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed to sign $($target.FullName) with exit code $LASTEXITCODE"
  }

  & $signTool verify /pa $target.FullName *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Authenticode verification failed for $($target.FullName)"
  }
}

Write-Host "Signed and verified $($targets.Count) Demucs runtime binaries."
