[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$branch = (git branch --show-current).Trim()
if ($branch -ne "main") {
  throw "Expected branch main, but current branch is '$branch'."
}

Write-Host "Branch ok: main"
