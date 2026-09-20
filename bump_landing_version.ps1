# Bump the landing page's hard-coded Windows download version from the R2
# production manifest. Windows mirror of `bump_landing_version.sh`. Run this
# after `publish_windows.ps1` uploads a new build so the landing page's CTA
# points at the new installer.
#
# Source-of-truth = R2 prod bucket, same `update/windows-x86_64.json` that
# `src-tauri/src/updater.rs::check_update_on_startup` reads via Tauri updater.
#
# What it changes in `pages/landing/index.html`:
#   - `KNOWN_VERSION`     (script const)
#   - `KNOWN_INSTALLER`   (script const)
#   - `KNOWN_SIZE_MB`     (script const, rounded from HEAD Content-Length)
#   - HTML fallback <span data-i18n="hero.anchor.ver">× 1
#   - HTML fallback <span class="v" id="dl-ver">× 1
#   - i18n dict `hero.anchor.ver` × 2 (en + zh)
#
# What it does NOT do:
#   - Does not push to remote. Commit the diff yourself, or hook into the
#     publish script yourself.
#   - Does not regenerate CSS / rebuild web. `pages/landing/` is static, no build.

$ErrorActionPreference = "Stop"

$R2Base    = "https://pub-2d5b7e0153e94f999bdfea020fb31629.r2.dev"
$Manifest  = "$R2Base/update/windows-x86_64.json"
$Landing   = Join-Path $PSScriptRoot "pages/landing/index.html"

if (-not (Test-Path $Landing)) {
  Write-Error "landing not found at $Landing (run from repo root)"
}

Write-Host "fetching $Manifest ..."
$json = (Invoke-WebRequest -Uri $Manifest -UseBasicParsing -TimeoutSec 15).Content
$manifest = $json | ConvertFrom-Json
$ver   = $manifest.version
$inst  = $manifest.downloads.installer
if (-not $inst) { $inst = $manifest.url }

if (-not $ver -or -not $inst) {
  Write-Error "failed to parse version/installer from manifest`n$json"
}

# Cloudflare R2 needs a plain UA on HEAD requests; default PowerShell UA gets 403.
$sizeBytes = $null
try {
  $h = Invoke-WebRequest -Uri $inst -Method Head -UseBasicParsing -TimeoutSec 15 `
    -Headers @{ "User-Agent" = "hamuna-bump/1.0" }
  $cl = $h.Headers["Content-Length"]
  if ($cl) { $sizeBytes = [int64]$cl }
} catch {
  Write-Warning "HEAD $inst failed: $($_.Exception.Message); keeping existing KNOWN_SIZE_MB"
}
if ($sizeBytes -and $sizeBytes -gt 0) {
  # Round to nearest MB (ceil-ish: 251_445_867 -> 240).
  $sizeMb = [int][Math]::Ceiling($sizeBytes / 1MB)
} else {
  $existing = Select-String -Path $Landing -Pattern 'KNOWN_SIZE_MB\s*=\s*([0-9]+)' `
    | ForEach-Object { ($_.Matches[0].Groups[1].Value) }
  $sizeMb = if ($existing) { [int]$existing[0] } else { 0 }
}

Write-Host ""
Write-Host "manifest says:"
Write-Host "  version   = $ver"
Write-Host "  installer = $inst"
Write-Host "  size      = $sizeMb MB ($sizeBytes bytes)"
Write-Host ""

$src = Get-Content -Raw -Path $Landing -Encoding UTF8
$new = $src

# JS const block.
$new = [regex]::Replace($new, 'const KNOWN_VERSION\s*=\s*"[^"]*";',
  "const KNOWN_VERSION = ""$ver"";", 1)
$new = [regex]::Replace($new, 'const KNOWN_INSTALLER\s*=\s*`[^`]*`;',
  "const KNOWN_INSTALLER = ``$inst``;", 1)
$new = [regex]::Replace($new, 'const KNOWN_SIZE_MB\s*=\s*[0-9]+;',
  "const KNOWN_SIZE_MB = $sizeMb;", 1)

# HTML fallback <span> for hero anchor + dl-meta version row.
$new = [regex]::Replace($new, '(data-i18n="hero\.anchor\.ver">)v[0-9]+\.[0-9]+\.[0-9]+(<)',
  "`$1v$ver`$2", 1)
$new = [regex]::Replace($new, '(id="dl-ver">)v[0-9]+\.[0-9]+\.[0-9]+(<)',
  "`$1v$ver`$2", 1)

# i18n dict `hero.anchor.ver` x 2 (en + zh).
$new = [regex]::Replace($new, '("hero\.anchor\.ver":\s*)"v[0-9]+\.[0-9]+\.[0-9]+"',
  "`$1""v$ver""")

if ($new -eq $src) {
  Write-Host "no changes (landing already at v$ver, $sizeMb MB)"
  return
}

Set-Content -Path $Landing -Value $new -Encoding UTF8 -NoNewline
Write-Host "updated $Landing"
Write-Host ""
Write-Host "next: review diff, commit, push. landing is static - no rebuild needed."