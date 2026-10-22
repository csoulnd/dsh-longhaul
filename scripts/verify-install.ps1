<#
.SYNOPSIS
  Verify that dsh-longhaul installs into a DSH profile and uninstalls cleanly.

.DESCRIPTION
  Requires DeepSeek Harness Desktop to be fully quit. Snapshots the profile's
  package.json, pnpm-lock.yaml, cordis.yml, and cordis.patch.yml, installs the
  local plugin, checks the bundle selection, uninstalls it, and compares the
  files byte-for-byte. Exits non-zero when Desktop is running, the plugin is not
  selected, or any snapshot differs after uninstall.

.PARAMETER Dsh
  Path to the dsh CLI. Defaults to the installed desktop CLI.

.PARAMETER Profile
  Profile name. Defaults to desktop.

.PARAMETER PluginPath
  Local plugin path. Defaults to the repository root.

.EXAMPLE
  pwsh -File scripts/verify-install.ps1
#>
param(
  [string]$Dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd",
  [string]$Profile = 'desktop',
  [string]$PluginPath = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$desktop = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($null -ne $desktop) {
  Write-Error 'DeepSeek Harness Desktop is running. Fully quit it, then rerun this script.'
}

if (-not (Test-Path $Dsh)) { throw "dsh CLI not found: $Dsh" }
if (-not (Test-Path (Join-Path $PluginPath 'package.json'))) { throw "plugin path has no package.json: $PluginPath" }

$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  throw "profile $Profile is not initialized; open Desktop once first."
}

$snapshot = Join-Path ([System.IO.Path]::GetTempPath()) ("longhaul-verify-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $snapshot | Out-Null
$files = @('package.json', 'pnpm-lock.yaml', 'cordis.yml', 'cordis.patch.yml')
foreach ($file in $files) {
  $source = Join-Path $profileDir $file
  if (Test-Path $source) { Copy-Item $source (Join-Path $snapshot $file) }
}

function Compare-Snapshot {
  foreach ($file in $files) {
    $before = Join-Path $snapshot $file
    $after = Join-Path $profileDir $file
    if (-not (Test-Path $before) -and -not (Test-Path $after)) { continue }
    if (-not (Test-Path $before) -or -not (Test-Path $after)) { throw "$file presence changed" }
    $left = (Get-FileHash $before).Hash
    $right = (Get-FileHash $after).Hash
    if ($left -ne $right) { throw "$file differs after uninstall" }
  }
}

try {
  Write-Host "Installing $PluginPath into profile $Profile..."
  & $Dsh plugin --profile $Profile add $PluginPath
  if ($LASTEXITCODE -ne 0) { throw "install failed with exit $LASTEXITCODE" }

  $manifest = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
  if ($manifest.dsh.profile.bundles -notcontains 'dsh-longhaul') {
    throw 'install succeeded but dsh-longhaul is not in dsh.profile.bundles'
  }
  if ($null -eq $manifest.dependencies.'dsh-longhaul') {
    throw 'install succeeded but dsh-longhaul is not a dependency'
  }
  Write-Host 'Install verified: dependency + bundle selection present.'

  Write-Host 'Uninstalling...'
  & $Dsh plugin --profile $Profile remove dsh-longhaul
  if ($LASTEXITCODE -ne 0) { throw "remove failed with exit $LASTEXITCODE" }

  $manifest = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
  if ($manifest.dsh.profile.bundles -contains 'dsh-longhaul') {
    throw 'uninstall left dsh-longhaul in dsh.profile.bundles'
  }
  if ($null -ne $manifest.dependencies.'dsh-longhaul') {
    throw 'uninstall left dsh-longhaul in dependencies'
  }
  Compare-Snapshot
  Write-Host 'Uninstall verified: profile files match the pre-install snapshot.'
} finally {
  Remove-Item $snapshot -Recurse -Force -ErrorAction SilentlyContinue
}
