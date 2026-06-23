param(
  [string]$Input,
  [string]$OutputRoot = (Join-Path $env:TEMP "yes-stems-installed-demucs-smoke")
)

$ErrorActionPreference = "Stop"

function Get-InstallLocation {
  $keys = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\YES Stems",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\YES Stems"
  )

  foreach ($key in $keys) {
    if (Test-Path -LiteralPath $key) {
      $item = Get-Item -LiteralPath $key
      $location = $item.GetValue("InstallLocation")
      if ($location) {
        return $location.Trim('"')
      }
    }
  }

  throw "YES Stems is not installed."
}

function New-SyntheticWav {
  param([string]$Path)

  $sampleRate = 44100
  $seconds = 2
  $channels = 2
  $bitsPerSample = 16
  $frames = $sampleRate * $seconds
  $dataBytes = $frames * $channels * 2

  $writer = [System.IO.BinaryWriter]::new([System.IO.File]::Create($Path))
  try {
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes("RIFF"))
    $writer.Write([int](36 + $dataBytes))
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes("WAVE"))
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes("fmt "))
    $writer.Write([int]16)
    $writer.Write([short]1)
    $writer.Write([short]$channels)
    $writer.Write([int]$sampleRate)
    $writer.Write([int]($sampleRate * $channels * $bitsPerSample / 8))
    $writer.Write([short]($channels * $bitsPerSample / 8))
    $writer.Write([short]$bitsPerSample)
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes("data"))
    $writer.Write([int]$dataBytes)

    for ($i = 0; $i -lt $frames; $i++) {
      $left = [Math]::Sin(2 * [Math]::PI * 220 * $i / $sampleRate)
      $right = [Math]::Sin(2 * [Math]::PI * 440 * $i / $sampleRate)
      $writer.Write([short]($left * 12000))
      $writer.Write([short]($right * 12000))
    }
  }
  finally {
    $writer.Dispose()
  }
}

function Assert-Stems {
  param(
    [string]$Directory,
    [string[]]$Names
  )

  foreach ($name in $Names) {
    $path = Join-Path -Path $Directory -ChildPath $name
    if (-not (Test-Path -LiteralPath $path)) {
      throw "Missing expected stem: $path"
    }
  }
}

$install = Get-InstallLocation
$runtime = Join-Path -Path $install -ChildPath "demucs-runtime"
$demucs = Join-Path -Path $runtime -ChildPath "demucs.exe"
$torchHome = Join-Path -Path $runtime -ChildPath "torch-cache"

if (-not (Test-Path -LiteralPath $demucs)) {
  throw "Installed Demucs runtime not found: $demucs"
}

if (-not $Input) {
  $Input = Join-Path -Path $env:TEMP -ChildPath "yes-stems-installed-smoke.wav"
  New-SyntheticWav -Path $Input
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP)
if (-not $resolvedOutput.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clear output outside TEMP: $resolvedOutput"
}
if (Test-Path -LiteralPath $resolvedOutput) {
  Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

$env:TORCH_HOME = $torchHome
$fourOut = Join-Path -Path $resolvedOutput -ChildPath "four"
$sixOut = Join-Path -Path $resolvedOutput -ChildPath "six"

& $demucs -n htdemucs -d cpu --int24 -o $fourOut $Input
if ($LASTEXITCODE -ne 0) {
  throw "Installed htdemucs smoke failed with exit code $LASTEXITCODE"
}

& $demucs -n htdemucs_6s -d cpu --int24 -o $sixOut $Input
if ($LASTEXITCODE -ne 0) {
  throw "Installed htdemucs_6s smoke failed with exit code $LASTEXITCODE"
}

$trackName = [System.IO.Path]::GetFileNameWithoutExtension($Input)
$fourStemDir = Join-Path -Path $fourOut -ChildPath "htdemucs/$trackName"
$sixStemDir = Join-Path -Path $sixOut -ChildPath "htdemucs_6s/$trackName"

Assert-Stems -Directory $fourStemDir -Names @("bass.wav", "drums.wav", "other.wav", "vocals.wav")
Assert-Stems -Directory $sixStemDir -Names @("bass.wav", "drums.wav", "guitar.wav", "other.wav", "piano.wav", "vocals.wav")

Write-Host "Installed YES Stems Demucs smoke passed."
Write-Host "Install: $install"
Write-Host "Output: $resolvedOutput"
