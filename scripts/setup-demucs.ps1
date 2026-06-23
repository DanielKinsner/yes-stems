param(
  [string]$Python = "python",
  [string]$Venv = ".venv-demucs"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

try {
  & $Python -m venv $Venv

  $VenvPython = Join-Path -Path $Venv -ChildPath "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $VenvPython)) {
    $VenvPython = Join-Path -Path $Venv -ChildPath "bin/python"
  }

  $DemucsExe = Join-Path -Path $Venv -ChildPath "Scripts\demucs.exe"
  if (-not (Test-Path -LiteralPath $DemucsExe)) {
    $DemucsExe = Join-Path -Path $Venv -ChildPath "bin/demucs"
  }

  & $VenvPython -m pip install --upgrade pip
  & $VenvPython -m pip install -r requirements-demucs.txt
  & $VenvPython -m demucs --help *> $null

  Write-Host "Demucs runtime is ready at $DemucsExe"
}
finally {
  Pop-Location
}
