# Read build.log (likely UTF-16LE from PowerShell redirect), convert to UTF-8, dump tail + error lines
$ErrorActionPreference = "Continue"
$src = "D:\Coding\hamuna-agent-desktop\build.log"
$dst = "D:\Coding\hamuna-agent-desktop\build_utf8.log"

# Detect encoding by reading BOM
$bytes = [System.IO.File]::ReadAllBytes($src)
$enc = "ASCII"
if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
    $enc = "UTF-16LE"
} elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) {
    $enc = "UTF-16BE"
} elseif ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $enc = "UTF-8-BOM"
}
Write-Host "Detected encoding: $enc (file size $($bytes.Length) bytes)"

$content = [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::GetEncoding($enc))
[System.IO.File]::WriteAllText($dst, $content, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "=== Last 60 lines ===" -ForegroundColor Cyan
$content -split "`r?`n" | Select-Object -Last 60 | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "=== Error / failure markers ===" -ForegroundColor Red
$lines = $content -split "`r?`n"
$errLines = $lines | Select-String -Pattern "error|Error|ERROR|✗|失败|Error\(|E\d{4}|panic|FAILED|fatal" | Select-Object -First 30
$errLines | ForEach-Object { Write-Host $_.Line }
