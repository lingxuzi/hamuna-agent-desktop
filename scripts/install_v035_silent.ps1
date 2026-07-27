# Install v0.3.5 NSIS silently, return install path
# Usage: .\scripts\install_v035_silent.ps1
$ErrorActionPreference = "Stop"

$Installer = "D:\hamuna-test\old\HamunaAgent_0.3.5_x64-setup.exe"
if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }

$InstallLog = Join-Path $env:TEMP "hamuna-v035-install.log"
Write-Host "Silent install v0.3.5 ..." -ForegroundColor Cyan
Write-Host "  Installer: $Installer"
Write-Host "  Log:       $InstallLog"

# NSIS currentUser mode → %LOCALAPPDATA%\HamunaAgent (not Program Files)
$InstallDir = Join-Path $env:LOCALAPPDATA "HamunaAgent"
$p = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -Wait -PassThru
Write-Host "  NSIS exit code: $($p.ExitCode)" -ForegroundColor Yellow
Write-Host "  Install dir:    $InstallDir"

Start-Sleep -Seconds 3
# Cargo package name is "hamuna" (lowercase) → binary is hamuna.exe, not HamunaAgent.exe
$exe = Join-Path $InstallDir "hamuna.exe"
if (Test-Path $exe) {
    $ver = (Get-Item $exe).VersionInfo.FileVersion
$InstallDir = "${env:ProgramFiles}\HamunaAgent"
$p = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -Wait -PassThru
Write-Host "  NSIS exit code: $($p.ExitCode)" -ForegroundColor Yellow
Write-Host "  Install dir:    $InstallDir"

# Wait for the app to appear
Start-Sleep -Seconds 3
$exe = Join-Path $InstallDir "HamunaAgent.exe"
if (Test-Path $exe) {
    $ver = (Get-Item $exe).VersionInfo.FileVersion
    Write-Host "  Installed exe:  $exe" -ForegroundColor Green
    Write-Host "  Version:        $ver" -ForegroundColor Green
} else {
    Write-Host "  WARNING: $exe not found" -ForegroundColor Red
    throw "Install failed"
}

# Also dump registry
$reg = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
       Where-Object { $_.DisplayName -like "HamunaAgent*" } | Select-Object DisplayName, DisplayVersion, InstallLocation
$reg | Format-List

Write-Host ""
Write-Host "v0.3.5 install complete." -ForegroundColor Green
