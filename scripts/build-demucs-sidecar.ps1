param(
  [string]$Python = "python",
  [string]$Venv = ".venv-demucs",
  [string]$ResourceDir = "src-tauri/resources/demucs-runtime",
  [switch]$SkipModelDownload
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path -Path $RepoRoot -ChildPath "build/demucs-sidecar"
$DistRoot = Join-Path -Path $BuildRoot -ChildPath "dist"
$WorkRoot = Join-Path -Path $BuildRoot -ChildPath "work"
$ResourcePath = Join-Path -Path $RepoRoot -ChildPath $ResourceDir
$SourceEntry = Join-Path -Path $RepoRoot -ChildPath "scripts/demucs-sidecar.py"
$SetupScript = Join-Path -Path $RepoRoot -ChildPath "scripts/setup-demucs.ps1"

function Resolve-RepoChild {
  param([string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $repoPath = [System.IO.Path]::GetFullPath($RepoRoot)
  if (-not $fullPath.StartsWith($repoPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside repo: $fullPath"
  }
  return $fullPath
}

Push-Location $RepoRoot

try {
  $VenvPython = Join-Path -Path $Venv -ChildPath "Scripts/python.exe"
  if (-not (Test-Path -LiteralPath $VenvPython)) {
    $VenvPython = Join-Path -Path $Venv -ChildPath "bin/python"
  }
  if (-not (Test-Path -LiteralPath $VenvPython)) {
    & $SetupScript -Python $Python -Venv $Venv
    $VenvPython = Join-Path -Path $Venv -ChildPath "Scripts/python.exe"
    if (-not (Test-Path -LiteralPath $VenvPython)) {
      $VenvPython = Join-Path -Path $Venv -ChildPath "bin/python"
    }
  }
  if (-not (Test-Path -LiteralPath $VenvPython)) {
    throw "Could not find Python inside $Venv after setup."
  }

  & $VenvPython -m pip install --upgrade pip
  & $VenvPython -m pip install -r requirements-demucs.txt
  & $VenvPython -m pip install "pyinstaller==6.21.0"

  $safeBuildRoot = Resolve-RepoChild $BuildRoot
  if (Test-Path -LiteralPath $safeBuildRoot) {
    Remove-Item -LiteralPath $safeBuildRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $DistRoot, $WorkRoot | Out-Null

  & $VenvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --name demucs `
    --distpath $DistRoot `
    --workpath $WorkRoot `
    --specpath $BuildRoot `
    --collect-all demucs `
    --collect-all dora `
    --collect-all julius `
    --collect-all lameenc `
    --collect-all numpy `
    --collect-all openunmix `
    --collect-all soundfile `
    --collect-all torchaudio `
    --hidden-import numpy.core.multiarray `
    --hidden-import numpy._core.multiarray `
    $SourceEntry

  $builtRuntime = Join-Path -Path $DistRoot -ChildPath "demucs"
  $builtExe = Join-Path -Path $builtRuntime -ChildPath "demucs.exe"
  if (-not (Test-Path -LiteralPath $builtExe)) {
    throw "PyInstaller did not produce $builtExe"
  }

  $safeResourcePath = Resolve-RepoChild $ResourcePath
  New-Item -ItemType Directory -Force -Path $safeResourcePath | Out-Null
  Get-ChildItem -LiteralPath $safeResourcePath -Force |
    Where-Object { $_.Name -ne ".gitkeep" } |
    Remove-Item -Recurse -Force

  Copy-Item -Path (Join-Path -Path $builtRuntime -ChildPath "*") -Destination $safeResourcePath -Recurse -Force

  $checkpointTarget = Join-Path -Path $safeResourcePath -ChildPath "torch-cache/hub/checkpoints"
  New-Item -ItemType Directory -Force -Path $checkpointTarget | Out-Null

  $models = @(
    @{
      Name = "955717e8-8726e21a.th"
      Url = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th"
    },
    @{
      Name = "5c90dfd2-34c22ccb.th"
      Url = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th"
    }
  )

  foreach ($model in $models) {
    $target = Join-Path -Path $checkpointTarget -ChildPath $model.Name
    if (-not (Test-Path -LiteralPath $target)) {
      $cached = Join-Path -Path $env:USERPROFILE -ChildPath ".cache/torch/hub/checkpoints/$($model.Name)"
      if (Test-Path -LiteralPath $cached) {
        Copy-Item -LiteralPath $cached -Destination $target -Force
      }
      elseif ($SkipModelDownload) {
        throw "Missing model weight $($model.Name); rerun without -SkipModelDownload to stage an offline bundle."
      }
      else {
        Invoke-WebRequest -Uri $model.Url -OutFile $target
      }
    }
  }

  $manifest = [ordered]@{
    kind = "yes-stems-demucs-runtime"
    runner = "pyinstaller"
    demucs = "4.0.1"
    torch = "2.5.1"
    torchaudio = "2.5.1"
    models = @($models | ForEach-Object { $_.Name })
  }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path -Path $safeResourcePath -ChildPath "manifest.json") -Encoding UTF8

  & (Join-Path -Path $safeResourcePath -ChildPath "demucs.exe") --help *> $null
  Write-Host "Standalone Demucs runtime staged at $safeResourcePath"
}
finally {
  Pop-Location
}
