[CmdletBinding()]
param(
  [string]$Url = "http://127.0.0.1:4173/",
  [string]$Output = "docs/screenshots/yes-stems-installed-app.png",
  [int]$Width = 1280,
  [int]$Height = 800
)

$ErrorActionPreference = "Stop"

function Find-Browser {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "Chrome or Edge is required to capture the UI screenshot."
}

function Remove-TempProfile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $tempRoot = [System.IO.Path]::GetFullPath($env:TEMP)
  $target = [System.IO.Path]::GetFullPath($Path)
  if (-not $target.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove temporary browser profile outside TEMP: $target"
  }

  Remove-Item -LiteralPath $target -Recurse -Force
}

function Test-PreviewUrl {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ge 400) {
      throw "Preview server returned HTTP $($response.StatusCode)."
    }
  } catch {
    throw "Preview URL is not reachable: $Url. Start it with npm run preview:local."
  }
}

$browser = Find-Browser
Test-PreviewUrl -Url $Url
$outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
$outputDir = Split-Path -Parent $outputPath
if ($outputDir) {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$profile = Join-Path $env:TEMP ("yes-stems-chrome-shot-" + [Guid]::NewGuid().ToString("N"))

try {
  $browserArgs = @(
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=$profile",
    "--window-size=$Width,$Height",
    "--hide-scrollbars",
    "--screenshot=$outputPath",
    $Url
  )

  & $browser @browserArgs

  if (-not (Test-Path -LiteralPath $outputPath)) {
    throw "Browser did not create screenshot at $outputPath. Is the preview server running?"
  }

  Get-Item -LiteralPath $outputPath
} finally {
  Remove-TempProfile -Path $profile
}
