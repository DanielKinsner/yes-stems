$ErrorActionPreference = "Stop"

. (Join-Path -Path $PSScriptRoot -ChildPath "demucs-runtime-contract.ps1")

$tempRoot = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "yes-stems-runtime-contract-$([guid]::NewGuid().ToString('N'))"
$fullTempRoot = [System.IO.Path]::GetFullPath($tempRoot)
$systemTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
if (-not $fullTempRoot.StartsWith($systemTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to create packaging fixture outside the system temp directory: $fullTempRoot"
}

function Assert-ThrowsLike {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$Pattern
  )

  try {
    & $Action
  }
  catch {
    if ($_.Exception.Message -notlike $Pattern) {
      throw "Expected error like '$Pattern', got '$($_.Exception.Message)'"
    }
    return
  }

  throw "Expected action to throw like '$Pattern'"
}

try {
  $checkpointRoot = Join-Path -Path $fullTempRoot -ChildPath "torch-cache/hub/checkpoints"
  New-Item -ItemType Directory -Force -Path $checkpointRoot | Out-Null
  Set-Content -LiteralPath (Join-Path -Path $fullTempRoot -ChildPath "demucs.exe") -Value "fixture runner" -NoNewline

  $fixtureModels = @(
    [pscustomobject]@{ Name = "model-a.th"; Sha256 = "" },
    [pscustomobject]@{ Name = "model-b.th"; Sha256 = "" }
  )
  foreach ($model in $fixtureModels) {
    $modelPath = Join-Path -Path $checkpointRoot -ChildPath $model.Name
    Set-Content -LiteralPath $modelPath -Value "fixture-$($model.Name)" -NoNewline
    $model.Sha256 = Get-YesStemsFileSha256 -Path $modelPath
  }

  $manifest = [ordered]@{
    kind = "yes-stems-demucs-runtime"
    runner = "fixture"
    demucs = "4.0.1"
    torch = "2.5.1"
    torchaudio = "2.5.1"
    models = @($fixtureModels | ForEach-Object { $_.Name })
  }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path -Path $fullTempRoot -ChildPath "manifest.json") -Encoding UTF8

  $result = Assert-YesStemsDemucsRuntime -ResourcePath $fullTempRoot -Models $fixtureModels
  if ($result.ModelCount -ne 2) {
    throw "Expected two verified fixture models"
  }

  Add-Content -LiteralPath (Join-Path -Path $checkpointRoot -ChildPath "model-a.th") -Value "corrupt"
  Assert-ThrowsLike -Action {
    Assert-YesStemsDemucsRuntime -ResourcePath $fullTempRoot -Models $fixtureModels
  } -Pattern "*SHA-256 mismatch*model-a.th*"

  Set-Content -LiteralPath (Join-Path -Path $checkpointRoot -ChildPath "model-a.th") -Value "fixture-model-a.th" -NoNewline
  Remove-Item -LiteralPath (Join-Path -Path $fullTempRoot -ChildPath "demucs.exe") -Force
  Assert-ThrowsLike -Action {
    Assert-YesStemsDemucsRuntime -ResourcePath $fullTempRoot -Models $fixtureModels
  } -Pattern "*Missing Demucs runner*"

  Write-Host "Demucs runtime contract tests passed."
}
finally {
  if (Test-Path -LiteralPath $fullTempRoot) {
    Remove-Item -LiteralPath $fullTempRoot -Recurse -Force
  }
}
