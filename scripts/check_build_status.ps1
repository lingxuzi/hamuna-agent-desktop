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

# Bundled MCP runtime (Windows-only) — Sidecar falls back to these paths
# when system `python` / `uvx` is missing. Missing here = ddg-search and
# other uvx-driven builtin MCPs will fail at startup with command_not_found.
Write-Host "`n=== Bundled MCP runtime (Windows) ===" -ForegroundColor Cyan
$projectRoot = "D:\Coding\hamuna-agent-desktop"
$pythonExe = Join-Path $projectRoot "src-tauri\resources\python312\python.exe"
$uvxExe = Join-Path $projectRoot "src-tauri\resources\uvx.exe"
if (Test-Path $pythonExe) {
    Write-Host "  python312/python.exe: OK" -ForegroundColor Green
} else {
    Write-Host "  python312/python.exe: MISSING (run .\scripts\download_python.ps1)" -ForegroundColor Yellow
}
if (Test-Path $uvxExe) {
    Write-Host "  uvx.exe:              OK" -ForegroundColor Green
} else {
    Write-Host "  uvx.exe:              MISSING (run .\scripts\download_uv.ps1)" -ForegroundColor Yellow
}
