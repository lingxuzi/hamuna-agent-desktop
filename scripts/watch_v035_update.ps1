# Watch the installed HamunaAgent v0.3.5 for ~150s (60s startup delay + download time):
# - Process startup / webview2 child PIDs
# - Network connections (looking for R2 manifest GET)
# - File system events (downloaded .nsis.zip in %TEMP%)
# - Log lines
# This proves the Rust-side auto-update check fires and successfully downloads
# v0.3.7 if the manifest advertises it.

$ErrorActionPreference = "Continue"

# currentUser NSIS mode → %LOCALAPPDATA%\HamunaAgent
$InstallDir = Join-Path $env:LOCALAPPDATA "HamunaAgent"
$Exe = Join-Path $InstallDir "hamuna.exe"
$UserData = Join-Path $env:LOCALAPPDATA "HamunaAgent"
$LogsDir = Join-Path $UserData "logs"
$WatchSeconds = 150

Write-Host "=== Watching HamunaAgent for $WatchSeconds seconds ===" -ForegroundColor Cyan
Write-Host "  Exe:     $Exe"
Write-Host "  LogsDir: $LogsDir"
Write-Host ""

if (-not (Test-Path $Exe)) { throw "$Exe not found" }

# Baseline
Write-Host "[1/5] Baseline %TEMP% updater artifacts ..." -ForegroundColor Blue
$TempBefore = @(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".zip", ".exe", ".sig" -and $_.Name -match "(nsis|tauri|updat|hamuna)" -and $_.LastWriteTime -gt (Get-Date).AddMinutes(-5) })

# Launch
Write-Host ""
Write-Host "[2/5] Launching $Exe ..." -ForegroundColor Blue
$proc = Start-Process -FilePath $Exe -PassThru
Write-Host "  PID: $($proc.Id), StartTime: $($proc.StartTime)"

# Watch loop
$EndTime = (Get-Date).AddSeconds($WatchSeconds)
$LastNetCount = 0
$NewTempFiles = @()
$LogLastSize = 0
$LogFile = $null
$i = 0
while ((Get-Date) -lt $EndTime) {
    Start-Sleep -Seconds 5
    $i++
    $t = [Math]::Round($i * 5, 0)

    # Network: ESTABLISHED connections to :443 (R2)
    try {
        $conns = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
            Where-Object { $_.RemotePort -eq 443 } |
            Select-Object -First 10)
        if ($conns.Count -gt $LastNetCount) {
            Write-Host "  [t=${t}s] New :443 ESTABLISHED conns ($($conns.Count)):" -ForegroundColor Yellow
            $conns | ForEach-Object {
                $procName = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName
                Write-Host "    PID=$($_.OwningProcess) ($procName) $_.LocalAddress:$($_.LocalPort) -> $_.RemoteAddress"
            }
            $LastNetCount = $conns.Count
        }
    } catch {}

    # %TEMP% updater artifacts (new since launch)
    try {
        $now = @(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in ".zip", ".exe", ".sig" -and $_.Name -match "(nsis|tauri|updat|hamuna)" -and $_.LastWriteTime -gt $proc.StartTime })
        if ($now.Count -gt 0 -and $now.Count -ne $NewTempFiles.Count) {
            $NewTempFiles = $now
            Write-Host "  [t=${t}s] New updater artifacts in TEMP:" -ForegroundColor Yellow
            $now | ForEach-Object { Write-Host "    $($_.FullName) ($([Math]::Round($_.Length/1MB,1)) MB)" }
        }
    } catch {}

    # Logs
    try {
        if (Test-Path $LogsDir) {
            $logs = @(Get-ChildItem $LogsDir -File -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -gt $proc.StartTime -and $_.Length -gt 0 } |
                Sort-Object LastWriteTime -Descending)
            if ($logs.Count -gt 0) {
                $lf = $logs[0]
                if ($lf.Length -ne $LogLastSize) {
                    $LogLastSize = $lf.Length
                    $LogFile = $lf
                    $recent = Get-Content $lf.FullName -Tail 3 -ErrorAction SilentlyContinue
                    if ($recent) {
                        Write-Host "  [t=${t}s] Log ($($lf.Name), $([Math]::Round($lf.Length/1KB,0))KB):" -ForegroundColor DarkCyan
                        $recent | ForEach-Object { Write-Host "    $_" }
                    }
                }
            }
        }
    } catch {}

    # Also: check for HamunaAgent.log in app data root
    try {
        $altLog = Join-Path $UserData "HamunaAgent.log"
        if (Test-Path $altLog) {
            $info = Get-Item $altLog
            if ($info.Length -ne $LogLastSize -and $LogFile -ne $altLog) {
                $LogLastSize = $info.Length
                $LogFile = $altLog
                $recent = Get-Content $altLog -Tail 3 -ErrorAction SilentlyContinue
                if ($recent) {
                    Write-Host "  [t=${t}s] HamunaAgent.log ($([Math]::Round($info.Length/1KB,0))KB):" -ForegroundColor DarkCyan
                    $recent | ForEach-Object { Write-Host "    $_" }
                }
            }
        }
    } catch {}
}

Write-Host ""
Write-Host "[3/5] Post-watch inventory ..." -ForegroundColor Blue
Write-Host "  HamunaAgent still running: $((Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null)"
& tasklist.exe /FI "IMAGENAME eq hamuna.exe" /FO TABLE
Write-Host ""
Write-Host "[4/5] msedgewebview2 processes:" -ForegroundColor Blue
& tasklist.exe /FI "IMAGENAME eq msedgewebview2.exe" /FO TABLE | Select-Object -First 6

Write-Host ""
Write-Host "[5/5] TEMP updater/downloaded files (since launch):" -ForegroundColor Blue
$newT = @(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".zip", ".exe", ".sig" -and $_.Name -match "(nsis|tauri|updat|hamuna)" -and $_.LastWriteTime -gt $proc.StartTime })
if ($newT.Count -eq 0) { Write-Host "  (none)" -ForegroundColor Yellow }
$newT | Select-Object FullName, @{n="SizeMB";e={[Math]::Round($_.Length/1MB,2)}}, LastWriteTime |
    Format-Table -AutoSize | Out-String | Write-Host

# Leave process running
Write-Host ""
Write-Host "Process $proc.Id still running. Use Stop-Process -Id $proc.Id to terminate." -ForegroundColor Green
