# Launch hamuna.exe directly and capture stderr/exit code
$ErrorActionPreference = "Continue"
$Exe = Join-Path $env:LOCALAPPDATA "HamunaAgent\hamuna.exe"

# Kill any stale webview2 children from previous run
Write-Host "=== Killing stale msedgewebview2 ===" -ForegroundColor Cyan
Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Also kill any stale hamuna
Get-Process -Name hamuna -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

if (-not (Test-Path $Exe)) { throw "$Exe not found" }

# Check resources
Write-Host ""
Write-Host "=== Resources check ===" -ForegroundColor Cyan
$resources = @("nodejs\node.exe", "cuse.exe", "server-dist.js", "plugin-bridge-dist.mjs", "cli\hamuna.js", "tsx-runtime", "sharp-runtime", "shared", "bundled-skills", "bundled-agents", "cuse-latest.json")
foreach ($r in $resources) {
    $p = Join-Path (Split-Path $Exe -Parent) $r
    if (Test-Path $p) { Write-Host "  [OK] $r" -ForegroundColor Green }
    else { Write-Host "  [MISSING] $r" -ForegroundColor Red }
}

# Launch and capture
Write-Host ""
Write-Host "=== Launching $Exe (direct, with stderr capture) ===" -ForegroundColor Cyan
$outFile = Join-Path $env:TEMP "hamuna-launch.log"
$proc = Start-Process -FilePath $Exe -PassThru -NoNewWindow -RedirectStandardError $outFile -RedirectStandardOutput "$outFile.out"
Write-Host "  PID: $($proc.Id), StartTime: $($proc.StartTime)"

# Watch for 30 seconds
Write-Host ""
Write-Host "=== Watching 30s ===" -ForegroundColor Cyan
$EndTime = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $EndTime) {
    Start-Sleep -Seconds 3
    $alive = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null
    Write-Host "  [t=$([Math]::Round((New-TimeSpan -Start $proc.StartTime -End (Get-Date)).TotalSeconds,0))s] alive=$alive"
    if (-not $alive) { break }
}

# Final state
Write-Host ""
Write-Host "=== Final state ===" -ForegroundColor Cyan
$alive = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null
Write-Host "  Process alive: $alive"
& tasklist.exe /FI "IMAGENAME eq hamuna.exe" /FO TABLE
& tasklist.exe /FI "IMAGENAME eq msedgewebview2.exe" /FO TABLE | Select-Object -First 8 | Out-Host

Write-Host ""
Write-Host "=== hamuna launch log (stdout+stderr) ===" -ForegroundColor Cyan
if (Test-Path $outFile) {
    Get-Content $outFile -ErrorAction SilentlyContinue | Select-Object -Last 50 | ForEach-Object { Write-Host "  $_" }
}
if (Test-Path "$outFile.out") {
    Write-Host "  --- stdout ---" -ForegroundColor Yellow
    Get-Content "$outFile.out" -ErrorAction SilentlyContinue | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
}
