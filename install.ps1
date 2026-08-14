# dsh-LorebookMD - one-click install into DSH (PowerShell installer)
#
# Normal install = copy the plugin package into the DSH profile's
# node_modules:
# - plugin source deps (@deepseek-ai/*) are resolved by the profile
#   runtime directly (no junction chain required)
# - the browser bundle (lib/client.js) is built automatically when missing

$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$profileNm = Join-Path $env:USERPROFILE '.dsh\profiles\web\node_modules'
$dest = Join-Path $profileNm 'dsh-lorebookmd'
$bundle = Join-Path $src 'lib\client.js'

# --- 1. ensure the browser bundle exists ---
if (-not (Test-Path $bundle)) {
  Write-Host '[install] lib\client.js missing, building browser bundle...'
  Push-Location $src
  & node (Join-Path $src '.dsh-tools\tsdown\run.mjs')
  $buildExit = $LASTEXITCODE
  Pop-Location
  if ($buildExit -ne 0) {
    Write-Host '[install] build failed. Run "npm run bundle" to diagnose.'
    exit 1
  }
}

# --- 2. locate the DSH profile ---
if (-not (Test-Path $profileNm)) {
  Write-Host "[install] DSH profile not found: $profileNm"
  Write-Host '[install] Confirm DSH is installed (default profile at ~\.dsh\profiles\web).'
  exit 1
}

# --- 3. copy-install (replaces previous install; node_modules is excluded,
#        the profile runtime resolves plugin deps itself) ---
if (Test-Path $dest) {
  Write-Host '[install] previous install found, removing...'
  Remove-Item $dest -Recurse -Force
}
robocopy $src $dest /E /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Host '[install] copy failed.'
  exit 1
}

Write-Host ''
Write-Host '[install] done: dsh-LorebookMD installed to'
Write-Host "  $dest"
Write-Host ''
Write-Host '[install] To load it, pick one:'
Write-Host '[install]   1. Temporary mount: double-click start-dsh-plugin.cmd'
Write-Host '[install]      (loads this folder''s cordis.yml via --patch)'
Write-Host '[install]   2. Permanent mount: append this folder''s cordis.yml'
Write-Host '[install]      entries into'
Write-Host "      $env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml"
Write-Host '[install]      then start DSH normally (start-dsh.cmd).'
Write-Host ''
Write-Host '[install] To update: rerun this script after code changes'
Write-Host '[install] (it rebuilds and re-copies automatically).'
