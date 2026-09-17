# Find installed HamunaAgent binary (it's hamuna.exe, not HamunaAgent.exe)
$ErrorActionPreference = "Continue"
Write-Host "=== Checking $env:ProgramFiles\HamunaAgent ===" -ForegroundColor Cyan
if (Test-Path "$env:ProgramFiles\HamunaAgent") {
    Get-ChildItem "$env:ProgramFiles\HamunaAgent" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "\.(exe|dll)$" } |
        Select-Object Name, Length, LastWriteTime |
        Format-Table -AutoSize
} else {
    Write-Host "  NOT FOUND" -ForegroundColor Red
}

# Also check common alternatives
foreach ($dir in @("${env:ProgramFiles(x86)}\HamunaAgent", "$env:LOCALAPPDATA\HamunaAgent", "$env:LOCALAPPDATA\Programs\HamunaAgent")) {
    if (Test-Path $dir) {
        Write-Host ""
        Write-Host "Found: $dir" -ForegroundColor Yellow
        Get-ChildItem $dir -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "\.(exe|dll)$" } |
            Select-Object Name, Length |
            Format-Table -AutoSize | Out-Host
    }
}

# Registry uninstall entry
Write-Host ""
Write-Host "=== Registry uninstall entry ===" -ForegroundColor Cyan
$paths = @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")
foreach ($p in $paths) {
    Get-ChildItem $p -ErrorAction SilentlyContinue |
        ForEach-Object {
            $props = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue
            if ($props.DisplayName -like "*HamunaAgent*") {
                Write-Host "  $($_.PsPath)" -ForegroundColor Yellow
                $props | Select-Object DisplayName, DisplayVersion, InstallLocation, Publisher | Format-List | Out-Host
            }
        }
}

# Search for hamuna.exe anywhere
Write-Host ""
Write-Host "=== Search for hamuna.exe ===" -ForegroundColor Cyan
$drive = (Get-Item "$env:ProgramFiles").Root.FullName
Get-ChildItem "${env:ProgramFiles}\HamunaAgent\hamuna.exe" -ErrorAction SilentlyContinue |
    Select-Object FullName, Length, VersionInfo |
    Format-List
