# Test the install interface directly via NSIS silent install.
# The Tauri `install_pending_update` command wraps this exact NSIS invocation
# (per the Rust code in src-tauri/src/updater.rs::install_pending_update).
# Running this proves the underlying install mechanism works.

$ErrorActionPreference = "Continue"

$Installer = "D:\Coding\hamuna-agent-desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\HamunaAgent_0.3.8_x64-setup.exe"
$InstallDir = Join-Path $env:LOCALAPPDATA "HamunaAgent"

if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }

Write-Host "=== BEFORE: installed state ===" -ForegroundColor Cyan
$regBefore = Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "HamunaAgent*" } | Select-Object DisplayName, DisplayVersion, InstallLocation, InstallDate
$regBefore | Format-List
$exeBefore = Join-Path $InstallDir "hamuna.exe"
if (Test-Path $exeBefore) {
    Write-Host "  exe: $exeBefore"
    Write-Host "  size: $((Get-Item $exeBefore).Length) bytes"
    Write-Host "  mtime: $((Get-Item $exeBefore).LastWriteTime)"
}

# Kill any running hamuna
Write-Host ""
Write-Host "=== Killing running hamuna ===" -ForegroundColor Cyan
Get-Process -Name hamuna -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Run NSIS installer with /S (silent) — same args the Tauri updater uses
Write-Host ""
Write-Host "=== Running NSIS installer (silent) ===" -ForegroundColor Cyan
Write-Host "  $Installer /S /D=$InstallDir"

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -Wait -PassThru
$stopwatch.Stop()
Write-Host "  NSIS exit code: $($p.ExitCode)" -ForegroundColor Yellow
Write-Host "  Duration: $($stopwatch.Elapsed.TotalSeconds) sec"

Start-Sleep -Seconds 3

# Verify install completed
Write-Host ""
Write-Host "=== AFTER: installed state ===" -ForegroundColor Cyan
$regAfter = Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "HamunaAgent*" } | Select-Object DisplayName, DisplayVersion, InstallLocation, InstallDate
$regAfter | Format-List
$exeAfter = Join-Path $InstallDir "hamuna.exe"
if (Test-Path $exeAfter) {
    Write-Host "  exe: $exeAfter"
    Write-Host "  size: $((Get-Item $exeAfter).Length) bytes"
    Write-Host "  mtime: $((Get-Item $exeAfter).LastWriteTime)"
    $ver = (Get-Item $exeAfter).VersionInfo.FileVersion
    Write-Host "  version: $ver" -ForegroundColor Green
}

# Verify the installed exe can actually launch (doesn't crash immediately)
Write-Host ""
Write-Host "=== Launch test ===" -ForegroundColor Cyan
$proc = Start-Process -FilePath $exeAfter -PassThru
Write-Host "  PID: $($proc.Id), Started: $($proc.StartTime)"
Start-Sleep -Seconds 8
$alive = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null
Write-Host "  After 8s alive: $alive" -ForegroundColor $(if ($alive) { "Green" } else { "Red" })
if (-not $alive) {
    Write-Host "  CRASHED. Checking panic log..." -ForegroundColor Red
    $panics = Get-ChildItem "$env:USERPROFILE\.hamuna\logs\crash" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-2) }
    if ($panics) {
        $panics | ForEach-Object { Get-Content $_.FullName | Select-Object -First 10 }
    }
}
Get-Process -Id $proc.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Install interface: $(if ($p.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }) ===" -ForegroundColor $(if ($p.ExitCode -eq 0) { "Green" } else { "Red" })
