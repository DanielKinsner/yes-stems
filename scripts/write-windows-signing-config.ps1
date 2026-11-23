param(
  [string]$CertificateThumbprint = $env:YES_STEMS_WINDOWS_CERT_THUMBPRINT,
  [string]$TimestampUrl = $env:YES_STEMS_WINDOWS_TIMESTAMP_URL,
  [string]$OutputPath = "build/tauri.windows-signing.json",
  [switch]$ClassicOnly,
  [switch]$UseTsp = ($env:YES_STEMS_WINDOWS_TIMESTAMP_TSP -eq "1")
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$fullOutputPath = [System.IO.Path]::GetFullPath((Join-Path -Path $RepoRoot -ChildPath $OutputPath))
$fullBuildRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $RepoRoot -ChildPath "build"))
if (-not $fullOutputPath.StartsWith($fullBuildRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write the generated signing config outside $fullBuildRoot"
}

$parent = Split-Path -Parent $fullOutputPath
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$config = [ordered]@{
  bundle = [ordered]@{
  }
}
if ($ClassicOnly) {
  # Tauri merges this over the resource map in tauri.conf.json. The different
  # JSON type intentionally replaces that map, producing a genuinely ML-free
  # installer even when a runtime happens to be staged in the checkout.
  $config.bundle.resources = @()
}
if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
  $thumbprint = $CertificateThumbprint.Replace(" ", "").ToUpperInvariant()
  if ($thumbprint -notmatch "^[0-9A-F]{40}$") {
    throw "YES_STEMS_WINDOWS_CERT_THUMBPRINT must be a 40-character SHA-1 certificate thumbprint."
  }
  if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
    throw "YES_STEMS_WINDOWS_TIMESTAMP_URL must be set to the timestamp server supplied by the certificate provider."
  }
  $config.bundle.windows = [ordered]@{
      certificateThumbprint = $thumbprint
      digestAlgorithm = "sha256"
      timestampUrl = $TimestampUrl
      tsp = [bool]$UseTsp
  }
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $fullOutputPath -Encoding UTF8
Write-Output $fullOutputPath
