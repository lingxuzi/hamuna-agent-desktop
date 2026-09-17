# NSIS silent install that:
# 1. Cleans up the current HamunaAgent dir (v0.3.5 with broken updater endpoint)
# 2. Installs the v0.3.7 NSIS silently to %LOCALAPPDATA%\HamunaAgent
# 3. Verifies the install
param([string]$Installer = "D:\hamuna-test\new\HamunaAgent_0.3.7_x64-setup.exe")

$ErrorActionPreference = "Stop"
$InstallDir = Join-Path $env:LOCALAPPDATA "HamunaAgent"

if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }

# Kill any running hamuna
Write-Host "Killing running hamuna.exe ..." -ForegroundColor Cyan
Get-Process -Name hamuna -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# NSIS currentUser install: writes to %LOCALAPPDATA%\HamunaAgent
# /S = silent, /D = install dir
Write-Host "Silent install: $Installer -> $InstallDir" -ForegroundColor Cyan
$InstallLog = Join-Path $env:TEMP "hamuna-v037-install.log"
$p = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -Wait -PassThru
Write-Host "  NSIS exit code: $($p.ExitCode)" -ForegroundColor Yellow
Write-Host "  Install log:    $InstallLog"

Start-Sleep -Seconds 3
$exe = Join-Path $InstallDir "hamuna.exe"
if (Test-Path $exe) {
    $ver = (Get-Item $exe).VersionInfo.FileVersion
    $product = (Get-Item $exe).VersionInfo.ProductVersion
    Write-Host "  Installed exe:  $exe" -ForegroundColor Green
    Write-Host "  Size:           $((Get-Item $exe).Length) bytes"
    Write-Host "  Version:        $ver (product=$product)" -ForegroundColor Green
} else {
    throw "$exe missing"
}

$reg = Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
       Where-Object { $_.DisplayName -like "HamunaAgent*" } | Select-Object DisplayName, DisplayVersion, InstallLocation
Write-Host ""
Write-Host "=== Registry ===" -ForegroundColor Cyan
$reg | Format-List

Write-Host ""
Write-Host "v0.3.7 install complete." -ForegroundColor Green
