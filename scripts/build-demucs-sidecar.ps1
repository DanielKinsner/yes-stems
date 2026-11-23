param(
  [string]$Python = "python",
  [string]$Venv = ".venv-demucs",
  [string]$ResourceDir = "src-tauri/resources/demucs-runtime",
  [string]$ModelMirrorBaseUrl = $env:YES_STEMS_MODEL_MIRROR_BASE_URL,
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

. (Join-Path -Path $PSScriptRoot -ChildPath "demucs-runtime-contract.ps1")

function Resolve-RepoChild {
  param(
    [string]$Path,
    [string]$ExpectedParent = $RepoRoot
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $repoPath = [System.IO.Path]::GetFullPath($RepoRoot)
  $repoPrefix = $repoPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside repo: $fullPath"
  }

  $parentPath = [System.IO.Path]::GetFullPath($ExpectedParent)
  $parentPrefix = $parentPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside expected parent ${parentPath}: $fullPath"
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

  $resourcesRoot = Join-Path -Path $RepoRoot -ChildPath "src-tauri/resources"
  $safeResourcePath = Resolve-RepoChild -Path $ResourcePath -ExpectedParent $resourcesRoot
  New-Item -ItemType Directory -Force -Path $safeResourcePath | Out-Null
  Get-ChildItem -LiteralPath $safeResourcePath -Force |
    Where-Object { $_.Name -ne ".gitkeep" } |
    Remove-Item -Recurse -Force

  Copy-Item -Path (Join-Path -Path $builtRuntime -ChildPath "*") -Destination $safeResourcePath -Recurse -Force

  $checkpointTarget = Join-Path -Path $safeResourcePath -ChildPath "torch-cache/hub/checkpoints"
  New-Item -ItemType Directory -Force -Path $checkpointTarget | Out-Null

  $models = Get-YesStemsDemucsModels

  foreach ($model in $models) {
    $target = Join-Path -Path $checkpointTarget -ChildPath $model.Name
    if (-not (Test-Path -LiteralPath $target)) {
      $cached = Join-Path -Path $env:USERPROFILE -ChildPath ".cache/torch/hub/checkpoints/$($model.Name)"
      if (Test-YesStemsFileSha256 -Path $cached -ExpectedSha256 $model.Sha256) {
        Copy-Item -LiteralPath $cached -Destination $target -Force
      }
      elseif ($SkipModelDownload) {
        throw "Missing model weight $($model.Name); rerun without -SkipModelDownload to stage an offline bundle."
      }
      else {
        if (Test-Path -LiteralPath $cached) {
          Write-Warning "Ignoring cached model $cached because its SHA-256 does not match the release contract."
        }

        $downloadUrls = @($model.Url)
        if (-not [string]::IsNullOrWhiteSpace($ModelMirrorBaseUrl)) {
          $downloadUrls += "$($ModelMirrorBaseUrl.TrimEnd('/'))/$($model.Name)"
        }

        $downloaded = $false
        $downloadPath = "$target.download"
        foreach ($downloadUrl in $downloadUrls) {
          try {
            if (Test-Path -LiteralPath $downloadPath) {
              Remove-Item -LiteralPath $downloadPath -Force
            }
            Invoke-WebRequest -Uri $downloadUrl -OutFile $downloadPath
            Assert-YesStemsFileSha256 -Path $downloadPath -ExpectedSha256 $model.Sha256 -Label "downloaded model $($model.Name)"
            Move-Item -LiteralPath $downloadPath -Destination $target -Force
            $downloaded = $true
            break
          }
          catch {
            Write-Warning "Model download failed from ${downloadUrl}: $($_.Exception.Message)"
            if (Test-Path -LiteralPath $downloadPath) {
              Remove-Item -LiteralPath $downloadPath -Force
            }
          }
        }

        if (-not $downloaded) {
          throw "Could not download a verified copy of model weight $($model.Name)."
        }
      }
    }

    Assert-YesStemsFileSha256 -Path $target -ExpectedSha256 $model.Sha256 -Label "staged model $($model.Name)"
  }

  $modelHashes = [ordered]@{}
  foreach ($model in $models) {
    $modelHashes[$model.Name] = $model.Sha256
  }

  $manifest = [ordered]@{
    kind = "yes-stems-demucs-runtime"
    runner = "pyinstaller"
    demucs = "4.0.1"
    torch = "2.5.1"
    torchaudio = "2.5.1"
    models = @($models | ForEach-Object { $_.Name })
    modelSha256 = $modelHashes
  }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path -Path $safeResourcePath -ChildPath "manifest.json") -Encoding UTF8

  Assert-YesStemsDemucsRuntime -ResourcePath $safeResourcePath -Models $models -ProbeRunner | Out-Null
  Write-Host "Standalone Demucs runtime staged at $safeResourcePath"
}
finally {
  Pop-Location
}
