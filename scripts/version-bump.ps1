[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')]
  [string]$Version
)

# Sets the version in the three files that pin it, so a release only touches one command:
#   npm run version:bump -- -Version 0.2.0

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Set-Version {
  param([string]$RelativePath, [string]$Pattern)

  $full = Join-Path $root $RelativePath
  if (-not (Test-Path -LiteralPath $full)) {
    throw "not found: $RelativePath"
  }

  # Read/write as UTF-8 explicitly so non-ASCII bytes (e.g. an em-dash in a description)
  # survive round-tripping under Windows PowerShell 5.1, whose Get-Content defaults to ANSI.
  $content = [System.IO.File]::ReadAllText($full)
  $regex = [regex]::new($Pattern)
  if (-not $regex.IsMatch($content)) {
    throw "version field not found in $RelativePath (pattern: $Pattern)"
  }

  $replacement = '${1}' + $Version + '${2}'
  $updated = $regex.Replace($content, $replacement, 1)
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($full, $updated, $utf8NoBom)
  Write-Host "  $RelativePath -> $Version"
}

Write-Host "Setting version to ${Version}:"
Set-Version -RelativePath "package.json"             -Pattern '("version"\s*:\s*")[^"]+(")'
Set-Version -RelativePath "src-tauri/tauri.conf.json" -Pattern '("version"\s*:\s*")[^"]+(")'
Set-Version -RelativePath "src-tauri/Cargo.toml"      -Pattern '(?m)^(version\s*=\s*")[^"]+(")'
Write-Host "Done. Remember to update CHANGELOG.md and commit."
