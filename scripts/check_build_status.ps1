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
