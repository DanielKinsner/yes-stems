param(
  [switch]$ClassicOnly,
  [switch]$RequireSigning,
  [switch]$UseTsp = ($env:YES_STEMS_WINDOWS_TIMESTAMP_TSP -eq "1")
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$VerifyRuntimeScript = Join-Path -Path $PSScriptRoot -ChildPath "verify-demucs-runtime.ps1"
$SignRuntimeScript = Join-Path -Path $PSScriptRoot -ChildPath "sign-windows-runtime.ps1"
$SigningConfigScript = Join-Path -Path $PSScriptRoot -ChildPath "write-windows-signing-config.ps1"
$TauriCommand = Join-Path -Path $RepoRoot -ChildPath "node_modules/.bin/tauri.cmd"

if (-not (Test-Path -LiteralPath $TauriCommand -PathType Leaf)) {
  throw "Missing local Tauri CLI at $TauriCommand. Run npm ci first."
}

$hasSigningCertificate = -not [string]::IsNullOrWhiteSpace($env:YES_STEMS_WINDOWS_CERT_THUMBPRINT)
if ($RequireSigning -and -not $hasSigningCertificate) {
  throw "A signed build requires YES_STEMS_WINDOWS_CERT_THUMBPRINT and YES_STEMS_WINDOWS_TIMESTAMP_URL."
}

Push-Location $RepoRoot
$previousClassicOverride = $env:YES_STEMS_ALLOW_CLASSIC_ONLY_BUNDLE
try {
  $tauriArguments = @("build")
  if ($ClassicOnly) {
    $env:YES_STEMS_ALLOW_CLASSIC_ONLY_BUNDLE = "1"
    Write-Warning "Building an explicit classic-DSP-only installer with the local ML resource excluded."
  }
  else {
    & $VerifyRuntimeScript
    if ($LASTEXITCODE -ne 0) {
      throw "Demucs runtime verification failed with exit code $LASTEXITCODE"
    }
  }

  if ($hasSigningCertificate) {
    if ($ClassicOnly) {
      Write-Host "Classic-only bundle requested; no Demucs runtime binaries need signing."
    }
    else {
      & $SignRuntimeScript -UseTsp:$UseTsp
      if ($LASTEXITCODE -ne 0) {
        throw "Demucs runtime signing failed with exit code $LASTEXITCODE"
      }
    }
    $signingConfig = & $SigningConfigScript -ClassicOnly:$ClassicOnly -UseTsp:$UseTsp | Select-Object -Last 1
    $tauriArguments += @("--config", $signingConfig)
  }
  elseif ($RequireSigning) {
    throw "Signing was required, but no Windows signing certificate was configured."
  }
  else {
    Write-Warning "Building unsigned. Set YES_STEMS_WINDOWS_CERT_THUMBPRINT and YES_STEMS_WINDOWS_TIMESTAMP_URL for a signed build."
    if ($ClassicOnly) {
      $classicConfig = & $SigningConfigScript -ClassicOnly | Select-Object -Last 1
      $tauriArguments += @("--config", $classicConfig)
    }
  }

  & $TauriCommand @tauriArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri Windows build failed with exit code $LASTEXITCODE"
  }
}
finally {
  $env:YES_STEMS_ALLOW_CLASSIC_ONLY_BUNDLE = $previousClassicOverride
  Pop-Location
}
