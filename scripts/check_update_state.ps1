# Check hamuna.exe network + temp + logs
$ErrorActionPreference = "Continue"

Write-Host "=== hamuna.exe processes ===" -ForegroundColor Cyan
& tasklist.exe /FI "IMAGENAME eq hamuna.exe" /FO TABLE

Write-Host ""
Write-Host "=== hamuna.exe :443 connections ===" -ForegroundColor Cyan
$procs = Get-Process -Name hamuna -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    Write-Host "  PID $($p.Id): CPU=$([Math]::Round($p.CPU,1))s, WS=$([Math]::Round($p.WS/1MB,0))MB"
}
Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
    Where-Object { $_.RemotePort -eq 443 -and $procs.Id -contains $_.OwningProcess } |
    Select-Object OwningProcess, LocalAddress, LocalPort, RemoteAddress, RemotePort |
    Format-Table -AutoSize | Out-Host

Write-Host ""
Write-Host "=== %TEMP% updater artifacts (since 60s ago) ===" -ForegroundColor Cyan
$cutoff = (Get-Date).AddSeconds(-180)
Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".zip", ".exe", ".sig" -and $_.Name -match "(nsis|tauri|updat|hamuna)" -and $_.LastWriteTime -gt $cutoff } |
    Select-Object FullName, @{n="SizeMB";e={[Math]::Round($_.Length/1MB,2)}}, LastWriteTime |
    Format-Table -AutoSize | Out-Host

Write-Host ""
Write-Host "=== HamunaAgent logs ===" -ForegroundColor Cyan
$logPaths = @(
    (Join-Path $env:LOCALAPPDATA "HamunaAgent\logs"),
    (Join-Path $env:LOCALAPPDATA "HamunaAgent")
)
foreach ($lp in $logPaths) {
    if (Test-Path $lp) {
        Get-ChildItem $lp -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "\.(log|txt)$" -and $_.Length -gt 0 } |
            ForEach-Object {
                Write-Host "  $($_.FullName) ($([Math]::Round($_.Length/1KB,0))KB, $($_.LastWriteTime))" -ForegroundColor Yellow
                Get-Content $_.FullName -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
            }
    }
}

Write-Host ""
Write-Host "=== Pending update on disk (hamuna dir) ===" -ForegroundColor Cyan
$hamunaAppData = Join-Path $env:LOCALAPPDATA "HamunaAgent"
if (Test-Path $hamunaAppData) {
    Get-ChildItem $hamunaAppData -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "update|pending|nsis|\.sig$" -and $_.Length -gt 100 } |
        Select-Object FullName, @{n="SizeMB";e={[Math]::Round($_.Length/1MB,2)}}, LastWriteTime |
        Format-Table -AutoSize | Out-Host
}
