# Launch Tauri dev mode. This:
# 1. Kills any running production hamuna (to free port + avoid conflict)
# 2. Runs `npm run tauri:dev` which starts Vite dev server + Tauri dev build
# 3. The app window opens with webview devtools enabled (F12 or right-click)
# Dev mode uses the SAME tauri.conf.json as production, so the R2 endpoint +
# pubkey config is identical. Network requests to R2 will be visible in devtools.

$ErrorActionPreference = "Continue"
$ProjectDir = "D:\Coding\hamuna-agent-desktop"
Set-Location $ProjectDir

# Kill any production hamuna first
Write-Host "Killing production hamuna..." -ForegroundColor Cyan
Get-Process -Name "hamuna" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "msedgewebview2" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Note: npm run tauri:dev is long-running. We run it via Start-Process so this
# script returns immediately and the dev server keeps running in the background.
Write-Host ""
Write-Host "Starting Tauri dev mode (background)..." -ForegroundColor Cyan
Write-Host "  Vite dev server will start on http://localhost:5173" -ForegroundColor Yellow
Write-Host "  Tauri app window will open shortly" -ForegroundColor Yellow
Write-Host "  Press F12 in the app window to open DevTools" -ForegroundColor Yellow
Write-Host ""

# Use Start-Process with -NoNewWindow so npm output is captured but doesn't block.
# Redirect output to dev.log for inspection.
$devProcess = Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "tauri:dev") `
    -WorkingDirectory $ProjectDir `
    -RedirectStandardOutput "$ProjectDir\dev-stdout.log" `
    -RedirectStandardError "$ProjectDir\dev-stderr.log" `
    -NoNewWindow `
    -PassThru

Write-Host "  npm PID: $($devProcess.Id)" -ForegroundColor Green
Write-Host "  Output: $ProjectDir\dev-stdout.log" -ForegroundColor Green
Write-Host "  Errors: $ProjectDir\dev-stderr.log" -ForegroundColor Green
Write-Host ""
Write-Host "Waiting for Vite dev server to be ready..." -ForegroundColor Cyan

# Poll for Vite to be ready (port 5173 listening)
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try {
        $conn = Test-NetConnection -ComputerName "127.0.0.1" -Port 5173 -InformationLevel Quiet -WarningAction SilentlyContinue
        if ($conn) {
            $ready = $true
            Write-Host "  Vite ready on port 5173 (took ~$($i*2)s)" -ForegroundColor Green
            break
        }
    } catch {}
}

if (-not $ready) {
    Write-Host "  Vite didn't start within 120s. Check dev-stdout.log / dev-stderr.log" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Dev mode launched ===" -ForegroundColor Cyan
Write-Host "  When the app window opens:" -ForegroundColor Yellow
Write-Host "    1. F12 (or right-click > Inspect) opens DevTools" -ForegroundColor Yellow
Write-Host "    2. Network tab shows the actual manifest GET to R2" -ForegroundColor Yellow
Write-Host "    3. Console shows the [Updater] log lines from Rust" -ForegroundColor Yellow
Write-Host "    4. Settings > About > Developer > 'Test Update Connectivity' runs manual check" -ForegroundColor Yellow
