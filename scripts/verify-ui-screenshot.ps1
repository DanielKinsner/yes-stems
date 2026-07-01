[CmdletBinding()]
param(
  [string]$Path = "docs/screenshots/yes-stems-installed-app.png",
  [int]$ExpectedWidth = 1920,
  [int]$ExpectedHeight = 1080
)

$ErrorActionPreference = "Stop"

$screenshotPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
if (-not (Test-Path -LiteralPath $screenshotPath)) {
  throw "Screenshot not found: $screenshotPath"
}

Add-Type -AssemblyName System.Drawing

$image = [System.Drawing.Image]::FromFile($screenshotPath)
try {
  if ($image.Width -ne $ExpectedWidth -or $image.Height -ne $ExpectedHeight) {
    throw "Screenshot is $($image.Width)x$($image.Height), expected ${ExpectedWidth}x${ExpectedHeight}."
  }

  Write-Host "UI screenshot dimensions ok: $($image.Width)x$($image.Height)"
} finally {
  $image.Dispose()
}
