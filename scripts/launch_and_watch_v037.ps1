# Launch v0.3.7 and watch for the auto-update check (60s) + download
# Also: after update is detected, try to find + invoke the "Restart to Update" button via UIA
param([int]$WatchSeconds = 180)

$ErrorActionPreference = "Continue"

$InstallDir = Join-Path $env:LOCALAPPDATA "HamunaAgent"
$Exe = Join-Path $InstallDir "hamuna.exe"
$HamunaAppData = Join-Path $env:LOCALAPPDATA "HamunaAgent"

# Kill any stale processes
Write-Host "=== Killing stale processes ===" -ForegroundColor Cyan
Get-Process -Name hamuna -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Verify v0.3.7 install
if (-not (Test-Path $Exe)) { throw "$Exe missing" }
$installedVer = (Get-Item $Exe).VersionInfo.FileVersion
Write-Host "Installed version: $installedVer" -ForegroundColor Cyan

# Baseline
Write-Host ""
Write-Host "=== Baseline ===" -ForegroundColor Cyan
$TempBefore = @(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".zip", ".exe", ".sig" -and $_.Name -match "(nsis|tauri|updat|hamuna)" -and $_.LastWriteTime -gt (Get-Date).AddMinutes(-5) })
Write-Host "  TEMP updater artifacts (last 5min): $($TempBefore.Count)"

# Launch
Write-Host ""
Write-Host "=== Launching $Exe ===" -ForegroundColor Cyan
$proc = Start-Process -FilePath $Exe -PassThru
Write-Host "  PID: $($proc.Id), StartTime: $($proc.StartTime)"

# Watch
$EndTime = (Get-Date).AddSeconds($WatchSeconds)
$LastNetCount = 0
$NewTempFiles = @()
$UpdateDetected = $false
$HamunaChildPids = @()
$HamunaPid = $proc.Id
$i = 0
while ((Get-Date) -lt $EndTime) {
    Start-Sleep -Seconds 5
    $i++
    $t = [Math]::Round($i * 5, 0)

    $alive = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null

    # Network: look for hamuna child :443 connections to R2
    try {
        $hamunaPids = @($proc.Id)
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" -ErrorAction SilentlyContinue
        $hamunaPids += $children.ProcessId
        $HamunaChildPids = $hamunaPids
        $conns = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
            Where-Object { $_.RemotePort -eq 443 -and $hamunaPids -contains $_.OwningProcess })
        if ($conns.Count -gt 0) {
            $remote = ($conns | Select-Object -ExpandProperty RemoteAddress -Unique)
            Write-Host "  [t=${t}s] hamuna :443 conns ($($conns.Count)) to: $($remote -join ', ')" -ForegroundColor Yellow
        }
    } catch {}

    # %TEMP% updater artifacts (new since launch)
    try {
        $now = @(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in ".zip", ".exe", ".sig" -and $_.Name -match "(nsis|tauri|updat|hamuna)" -and $_.LastWriteTime -gt $proc.StartTime })
        if ($now.Count -gt 0 -and $now.Count -ne $NewTempFiles.Count) {
            $NewTempFiles = $now
            Write-Host "  [t=${t}s] New updater artifacts in TEMP:" -ForegroundColor Green
            $now | ForEach-Object { Write-Host "    $($_.FullName) ($([Math]::Round($_.Length/1MB,1)) MB)" }
        }
    } catch {}

    # Pending update in hamuna app data
    try {
        $pending = Get-ChildItem $HamunaAppData -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "pending|update.*\.(zip|exe|sig)$" -and $_.LastWriteTime -gt $proc.StartTime -and $_.Length -gt 100 }
        if ($pending.Count -gt 0 -and -not $UpdateDetected) {
            Write-Host "  [t=${t}s] Update pending in app data:" -ForegroundColor Green
            $pending | ForEach-Object { Write-Host "    $($_.FullName) ($([Math]::Round($_.Length/1MB,1)) MB)" }
            $UpdateDetected = $true
        }
    } catch {}

    if (-not $alive -and $t -gt 10) {
        Write-Host "  [t=${t}s] hamuna process exited" -ForegroundColor Red
        break
    }
}

Write-Host ""
Write-Host "=== Post-watch state ===" -ForegroundColor Cyan
& tasklist.exe /FI "IMAGENAME eq hamuna.exe" /FO TABLE
Write-Host ""
Write-Host "Update detected: $UpdateDetected"
Write-Host "hamuna PIDs (incl. children): $($HamunaChildPids -join ', ')"
Write-Host "Process $proc.Id still running: $((Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null)"

if ($NewTempFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "=== Downloaded files ===" -ForegroundColor Cyan
    $NewTempFiles | Select-Object FullName, @{n="SizeMB";e={[Math]::Round($_.Length/1MB,2)}}, LastWriteTime |
        Format-Table -AutoSize | Out-Host
}
