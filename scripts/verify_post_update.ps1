# Post-update verification: confirm installed app is now v0.3.7
# Usage: .\scripts\verify_post_update.ps1
$ErrorActionPreference = "Stop"

$InstallDir = "${env:ProgramFiles}\HamunaAgent"
$Exe = Join-Path $InstallDir "HamunaAgent.exe"
$R2Base = "https://pub-2d5b7e0153e94f999bdfea020fb31629.r2.dev"

Write-Host "=== Post-update verification ===" -ForegroundColor Cyan
Write-Host ""

# 1. Installed exe version
Write-Host "[1/4] Installed exe version" -ForegroundColor Blue
if (Test-Path $Exe) {
    $ver = (Get-Item $Exe).VersionInfo.FileVersion
    $product = (Get-Item $Exe).VersionInfo.ProductVersion
    Write-Host "  Path:    $Exe"
    Write-Host "  Size:    $((Get-Item $Exe).Length) bytes"
    Write-Host "  Version: $ver (product=$product)"
} else {
    Write-Host "  X $Exe missing!" -ForegroundColor Red
    throw "Install missing"
}

# 2. Registry
Write-Host ""
Write-Host "[2/4] Registry uninstall entry" -ForegroundColor Blue
$reg = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
       Where-Object { $_.DisplayName -like "HamunaAgent*" } | Select-Object DisplayName, DisplayVersion, InstallLocation, Publisher
$reg | Format-List

# 3. R2 manifest (should now reference v0.3.7 with v0.3.7 binaries, not v0.3.5)
Write-Host ""
Write-Host "[3/4] R2 manifest" -ForegroundColor Blue
$manifest = Invoke-RestMethod -Uri "$R2Base/update/windows-x86_64.json" -UseBasicParsing -TimeoutSec 15
$manifest | ConvertTo-Json -Depth 5
Write-Host ""
$badRefs = $manifest.url + " " + ($manifest.downloads | ConvertTo-Json -Compress)
if ($badRefs -match "0\.3\.5") {
    Write-Host "  WARNING: manifest still references v0.3.5 binaries!" -ForegroundColor Red
}

# 4. Process
Write-Host ""
Write-Host "[4/4] Running HamunaAgent processes" -ForegroundColor Blue
& tasklist.exe /FI "IMAGENAME eq HamunaAgent.exe" /FO TABLE
& tasklist.exe /FI "IMAGENAME eq msedgewebview2.exe" /FO TABLE | Select-Object -First 6

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Green
$expectedVer = "0.3.7"
$actualVer = $ver
if ($actualVer -like "$expectedVer*") {
    Write-Host "  PASS: installed version $actualVer matches expected $expectedVer" -ForegroundColor Green
} else {
    Write-Host "  FAIL: installed $actualVer != expected $expectedVer" -ForegroundColor Red
}
