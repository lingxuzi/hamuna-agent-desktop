# Hunt the v0.3.7 binary for the baked-in updater endpoint.
# Tauri 2 embeds the config as a packed tar; strings aren't always raw.
# We scan the last 8MB and also try Python-style byte search across the whole file.

$ErrorActionPreference = "Continue"
$Exe = Join-Path $env:LOCALAPPDATA "HamunaAgent\hamuna.exe"
if (-not (Test-Path $Exe)) { $Exe = "D:\Coding\hamuna-agent-desktop\src-tauri\target\x86_64-pc-windows-msvc\release\hamuna.exe" }
$len = (Get-Item $Exe).Length
Write-Host "Binary: $Exe ($len bytes)" -ForegroundColor Cyan

# Method 1: scan the last 8MB for URL-like strings
$stream = [System.IO.File]::OpenRead($Exe)
$tail = [Math]::Min(8MB, $len)
$stream.Position = $len - $tail
$buf = New-Object byte[] $tail
$null = $stream.Read($buf, 0, $buf.Length)
$stream.Close()
$txt = [System.Text.Encoding]::ASCII.GetString($buf)
$parts = $txt -split '[ -]+'
$matches = $parts | Where-Object { $_ -match 'https?://' -and ($_ -match 'update|\.json|hamuna|r2\.dev|pub-2d5b7e') } | Sort-Object -Unique
Write-Host ""
Write-Host "=== Tail-8MB URL-shaped strings ===" -ForegroundColor Cyan
$matches | Select-Object -First 30

# Method 2: scan the whole binary for key substrings
Write-Host ""
Write-Host "=== Whole-file substring scan ===" -ForegroundColor Cyan
$keyStrings = @(
    'pub-2d5b7e0153e94f999bdfea020fb31629',
    'download.hamuna.io',
    'update.windows-x86_64.json',
    'update/{target}.json',
    'updater',
    'hamuna.io',
    'r2.cloudflarestorage.com',
    'windows-x86_64.json'
)
$bytes = [System.IO.File]::ReadAllBytes($Exe)
$ascii = [System.Text.Encoding]::ASCII.GetString($bytes)
foreach ($s in $keyStrings) {
    $count = ([regex]::Matches($ascii, [regex]::Escape($s))).Count
    Write-Host "  '$s': $count occurrences"
}

# Method 3: scan whole binary in UTF-8 (Tauri's tar may have multi-byte)
$utf8 = [System.Text.Encoding]::UTF8.GetString($bytes)
Write-Host ""
Write-Host "=== UTF-8 scan ===" -ForegroundColor Cyan
foreach ($s in $keyStrings) {
    $count = ([regex]::Matches($utf8, [regex]::Escape($s))).Count
    Write-Host "  '$s': $count occurrences (utf8)"
}

# Method 4: find any .json URLs in the binary
Write-Host ""
Write-Host "=== All .json URL strings in binary ===" -ForegroundColor Cyan
$jsonUrls = [regex]::Matches($utf8, 'https?://[^\s"<>{}\\^`\|]+\.json') | ForEach-Object { $_.Value } | Sort-Object -Unique
$jsonUrls | Select-Object -First 30
