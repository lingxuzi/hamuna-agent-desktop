# Quick process & build status check
$ErrorActionPreference = "Continue"

# Active build-related processes
Write-Host "=== Build-related processes ===" -ForegroundColor Cyan
Get-Process | Where-Object { $_.ProcessName -match "^(rustc|cargo|node|powershell|cmd)$" -or $_.CommandLine -match "build_windows|tauri build" } |
    Select-Object Id, ProcessName, @{n="CPU_s";e={[Math]::Round($_.CPU,1)}}, @{n="WS_MB";e={[Math]::Round($_.WS/1MB,0)}} |
    Sort-Object CPU_s -Descending | Format-Table -AutoSize

# Build log status
Write-Host "=== Build log ===" -ForegroundColor Cyan
$log = "D:\Coding\hamuna-agent-desktop\build.log"
if (Test-Path $log) {
    $len = (Get-Item $log).Length
    Write-Host "Size: $len bytes"
    $last = Get-Content $log -Tail 3 -ErrorAction SilentlyContinue
    Write-Host "Last 3 lines:"
    $last | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "build.log missing"
}

# Bundled MCP runtime (Windows-only) — `python-installer.exe` is staged for
# the NSIS installer to run at install-time (per-user, lands at
# %LocalAppData%\Programs\Python\Python312 with pip + launcher on PATH).
# `uvx.exe` is bundled as a single-file resource; Sidecar falls back to
# it when system `uvx` is missing (ddg-search and other uvx-driven builtin
# MCPs would otherwise fail with command_not_found).
Write-Host "`n=== Bundled MCP runtime (Windows) ===" -ForegroundColor Cyan
$projectRoot = "D:\Coding\hamuna-agent-desktop"
$pythonInstaller = Join-Path $projectRoot "src-tauri\resources\python-3.12.7-amd64.exe"
$uvxExe = Join-Path $projectRoot "src-tauri\resources\uvx.exe"
if (Test-Path $pythonInstaller) {
    Write-Host "  python-3.12.7-amd64.exe: OK" -ForegroundColor Green
} else {
    Write-Host "  python-3.12.7-amd64.exe: MISSING (run .\scripts\download_python.ps1)" -ForegroundColor Yellow
}
if (Test-Path $uvxExe) {
    Write-Host "  uvx.exe:                 OK" -ForegroundColor Green
} else {
    Write-Host "  uvx.exe:                 MISSING (run .\scripts\download_uv.ps1)" -ForegroundColor Yellow
}
