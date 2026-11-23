param(
  [string]$ResourceDir = "src-tauri/resources/demucs-runtime",
  [switch]$SkipRunnerProbe
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ResourcePath = Join-Path -Path $RepoRoot -ChildPath $ResourceDir

. (Join-Path -Path $PSScriptRoot -ChildPath "demucs-runtime-contract.ps1")

$result = Assert-YesStemsDemucsRuntime -ResourcePath $ResourcePath -ProbeRunner:(-not $SkipRunnerProbe)
Write-Host "Verified Demucs runtime at $($result.ResourcePath) with $($result.ModelCount) model checkpoints."
