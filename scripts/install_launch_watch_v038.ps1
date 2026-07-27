# v0.3.8: silent install + launch + watch for auto-check
# Installs v0.3.8 NSIS (replaces v0.3.7 in place), launches, watches 150s for:
# - :443 connection to R2 (Cloudflare IPs, NOT 40.99.32.18 Azure)
# - Manifest fetch
# - .nsis.zip download in %TEMP%
# - Log lines: "Downloading update..." or "Updater" messages
param([int]$WatchSeconds = 150)

$ErrorActionPreference = "Continue"

$Installer = "D:\Coding\hamuna-agent-desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\HamunaAgent_0.3.8_x64-setup.exe"
$InstallDir = Join-Path $env:LOCALAPPDATA "HamunaAgent"

if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }

# Kill any running v0.3.7
Write-Host "=== Killing running v0.3.7 ===" -ForegroundColor Cyan
Get-Process -Name hamuna -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Install v0.3.8 (replaces v0.3.7 in place via NSIS upgrade)
Write-Host ""
Write-Host "=== Silent install v0.3.8 ===" -ForegroundColor Cyan
$InstallLog = Join-Path $env:TEMP "hamuna-v038-install.log"
$p = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -Wait -PassThru
Write-Host "  NSIS exit: $($p.ExitCode)"
Write-Host "  Install dir: $InstallDir"

Start-Sleep -Seconds 3
$exe = Join-Path $InstallDir "hamuna.exe"
if (Test-Path $exe) {
    $ver = (Get-Item $exe).VersionInfo.FileVersion
    $size = (Get-Item $exe).Length
    Write-Host "  Installed: $exe" -ForegroundColor Green
    Write-Host "  Version:   $ver" -ForegroundColor Green
    Write-Host "  Size:      $size bytes"
} else {
    throw "$exe missing"
}

# Launch
Write-Host ""
Write-Host "=== Launching v$ver ===" -ForegroundColor Cyan
$proc = Start-Process -FilePath $exe -PassThru
Write-Host "  PID: $($proc.Id), StartTime: $($proc.StartTime)"

# Watch
$EndTime = (Get-Date).AddSeconds($WatchSeconds)
$HamunaPids = @($proc.Id)
$NewTempFiles = @()
$LogFile = $null
$LogLastSize = 0
$LogPath = Join-Path $env:USERPROFILE ".hamuna\logs\unified-$(Get-Date -Format 'yyyy-MM-dd').log"
$i = 0
Write-Host ""
Write-Host "=== Watching $WatchSeconds seconds (60s startup delay + download) ===" -ForegroundColor Cyan

while ((Get-Date) -lt $EndTime) {
    Start-Sleep -Seconds 5
    $i++
    $t = [Math]::Round($i * 5, 0)
    $alive = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null

    # Add webview2 children to PID set
    try {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" -ErrorAction SilentlyContinue
        $HamunaPids = @($proc.Id) + @($children.ProcessId)
    } catch {}

    # Network: hamuna :443 connections — distinguish R2 (Cloudflare) vs other
    try {
        $conns = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
            Where-Object { $_.RemotePort -eq 443 -and $HamunaPids -contains $_.OwningProcess })
        if ($conns.Count -gt 0) {
            $r2Conns = @($conns | Where-Object { $_.RemoteAddress -notlike '40.*' -and $_.RemoteAddress -notlike '52.*' })
            $otherConns = @($conns | Where-Object { $_.RemoteAddress -like '40.*' -or $_.RemoteAddress -like '52.*' })
            if ($r2Conns.Count -gt 0) {
                Write-Host "  [t=${t}s] R2 connection! (Cloudflare, not Azure)" -ForegroundColor Green
                $r2Conns | ForEach-Object {
                    $pname = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName
                    Write-Host "    PID=$($_.OwningProcess) ($pname) $_.LocalAddress:$($_.LocalPort) -> $_.RemoteAddress"
                }
            }
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

    # Log tail (updater messages)
    if ($LogFile -or (Test-Path $LogPath)) {
        $lf = if ($LogFile) { $LogFile } else { Get-Item $LogPath }
        if ($lf.Length -ne $LogLastSize) {
            $LogLastSize = $lf.Length
            $LogFile = $lf
            $tail = Get-Content $lf.FullName -Tail 5 -ErrorAction SilentlyContinue
            $updaterLines = $tail | Where-Object { $_ -match 'updat|Updat|0\.3\.[89]|pub-2d5b7e|download\.hamuna|R2' }
            if ($updaterLines) {
                Write-Host "  [t=${t}s] Updater log lines:" -ForegroundColor Yellow
                $updaterLines | ForEach-Object { Write-Host "    $_" }
            }
        }
    }

    if (-not $alive -and $t -gt 10) {
        Write-Host "  [t=${t}s] hamuna process exited" -ForegroundColor Red
        break
    }
}

Write-Host ""
Write-Host "=== Post-watch state ===" -ForegroundColor Cyan
& tasklist.exe /FI "IMAGENAME eq hamuna.exe" /FO TABLE
Write-Host ""
Write-Host "Process $proc.Id still running: $((Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null)"

if ($NewTempFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "=== Downloaded files ===" -ForegroundColor Cyan
    $NewTempFiles | Select-Object FullName, @{n="SizeMB";e={[Math]::Round($_.Length/1MB,2)}}, LastWriteTime |
        Format-Table -AutoSize | Out-Host
}

# Final log dump for updater-related
Write-Host ""
Write-Host "=== Final updater log lines ===" -ForegroundColor Cyan
if (Test-Path $LogPath) {
    Get-Content $LogPath -Encoding UTF8 | Select-String -Pattern 'updat|Updat|0\.3\.[89]|pub-2d5b7e|download\.hamuna|R2|Manifest|endpoint|connect' |
        Select-Object -First 30 |
        ForEach-Object { Write-Host "  $($_.Line)" }
}
