$script:YesStemsDemucsModels = @(
  [pscustomobject]@{
    Name = "955717e8-8726e21a.th"
    Url = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th"
    Sha256 = "8726E21A993978C7BA086D3872E7608D7D5BFCA646CA4ACA459FFDA844FAA8B4"
  },
  [pscustomobject]@{
    Name = "5c90dfd2-34c22ccb.th"
    Url = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th"
    Sha256 = "34C22CCB381C6F9FDBF324F04E1E2FE21AAAF293F5DED163A162697FF9A02DDD"
  }
)

function Get-YesStemsDemucsModels {
  return @($script:YesStemsDemucsModels)
}

function Get-YesStemsFileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace("-", "")
  }
  finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Test-YesStemsFileSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }

  $actual = Get-YesStemsFileSha256 -Path $Path
  return $actual.Equals($ExpectedSha256, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-YesStemsFileSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [string]$Label = "file"
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing $Label at $Path"
  }

  $actual = Get-YesStemsFileSha256 -Path $Path
  if (-not $actual.Equals($ExpectedSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "SHA-256 mismatch for $Label at ${Path}: expected $ExpectedSha256, got $actual"
  }
}

function Assert-YesStemsDemucsRuntime {
  param(
    [Parameter(Mandatory = $true)][string]$ResourcePath,
    [object[]]$Models = (Get-YesStemsDemucsModels),
    [switch]$ProbeRunner
  )

  $fullResourcePath = [System.IO.Path]::GetFullPath($ResourcePath)
  if (-not (Test-Path -LiteralPath $fullResourcePath -PathType Container)) {
    throw "Missing Demucs runtime directory at $fullResourcePath"
  }

  $runner = Join-Path -Path $fullResourcePath -ChildPath "demucs.exe"
  if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    throw "Missing Demucs runner at $runner"
  }

  $manifestPath = Join-Path -Path $fullResourcePath -ChildPath "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Missing Demucs runtime manifest at $manifestPath"
  }

  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  }
  catch {
    throw "Invalid Demucs runtime manifest at ${manifestPath}: $($_.Exception.Message)"
  }

  if ($manifest.kind -ne "yes-stems-demucs-runtime") {
    throw "Unexpected Demucs runtime manifest kind '$($manifest.kind)' at $manifestPath"
  }

  foreach ($field in "runner", "demucs", "torch", "torchaudio") {
    if ([string]::IsNullOrWhiteSpace([string]$manifest.$field)) {
      throw "Demucs runtime manifest is missing '$field' at $manifestPath"
    }
  }

  $manifestModels = @($manifest.models)
  foreach ($model in $Models) {
    if ($manifestModels -notcontains $model.Name) {
      throw "Demucs runtime manifest does not declare $($model.Name)"
    }

    $modelPath = Join-Path -Path $fullResourcePath -ChildPath "torch-cache/hub/checkpoints/$($model.Name)"
    Assert-YesStemsFileSha256 -Path $modelPath -ExpectedSha256 $model.Sha256 -Label "model $($model.Name)"
  }

  if ($manifestModels.Count -ne $Models.Count) {
    throw "Demucs runtime manifest declares $($manifestModels.Count) models; expected $($Models.Count)"
  }

  if ($ProbeRunner) {
    & $runner --help *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "Demucs runner probe failed with exit code $LASTEXITCODE at $runner"
    }
  }

  return [pscustomobject]@{
    ResourcePath = $fullResourcePath
    Runner = $runner
    ModelCount = $Models.Count
  }
}
