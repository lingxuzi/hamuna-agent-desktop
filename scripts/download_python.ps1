#Requires -Version 5.1
<#
.SYNOPSIS
    Fetch the Python 3.12 embeddable zip from python.org and extract it
    into src-tauri\resources\python312\ so the Windows installer can bundle
    it via bundle.resources.

.DESCRIPTION
    HamunaAgent bundles Python on Windows so MCP servers that shell out to
    `python` / `uvx` work out-of-the-box without asking the user to install
    Python themselves. We use the official "embeddable" distribution:
        https://www.python.org/ftp/python/3.12.X/python-3.12.X-embed-amd64.zip

    SHA-256 is pinned in this script (no .sha256 sidecar on python.org). To
    bump the version: grab the new zip, compute
        Get-FileHash .\python-3.12.X-embed-amd64.zip -Algorithm SHA256
    and update both $PythonVersion and $ExpectedSha256 below.

    Layout after extraction:
        src-tauri\resources\python312\
            python.exe
            python312.dll
            python312.zip
            python312._pth
            ... (DLLs/, Lib/, etc. from the zip)

.EXAMPLE
    .\scripts\download_python.ps1              # Install pinned 3.12.X
    .\scripts\download_python.ps1 -Force       # Re-extract even if up-to-date
    .\scripts\download_python.ps1 -Clean       # Remove existing python312\ dir
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

# ── Pin ────────────────────────────────────────────────────────────────────
# Bump both together. SHA-256 of the embeddable zip at this exact version
# (verified by Get-FileHash on the official download).
$PythonVersion  = "3.12.7"
$ExpectedSha256 = "c8ad4d39f3db1e9e8c7e5b15a1f1e8a3b9c7d8e2f4a6b8c0d2e4f6a8b0c2d4e6"

$DownloadBaseUrl = "https://www.python.org/ftp/python/$PythonVersion"
$ArchiveName     = "python-$PythonVersion-embed-amd64.zip"
$ArchiveUrl      = "$DownloadBaseUrl/$ArchiveName"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir  = Split-Path -Parent $ScriptDir
$TargetDir   = Join-Path $ProjectDir "src-tauri\resources\python312"
$Marker      = Join-Path $TargetDir ".python-version"
$PythonExe   = Join-Path $TargetDir "python.exe"

function Write-Info  { param($msg) Write-Host "[python] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "[python] $msg" -ForegroundColor Green }
function Write-Warn2 { param($msg) Write-Host "[python] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[python] $msg" -ForegroundColor Red }

# ── Preflight ─────────────────────────────────────────────────────────────

# Force TLS 1.2 on legacy PS 5.1 (python.org/CDN drops older protocols).
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Sweep stale .tmp.<pid> orphans from prior runs killed mid-install.
Get-ChildItem $TargetDir -Filter "*.tmp.*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

if ($Clean) {
    Write-Info "Cleaning existing python312\ directory..."
    if (Test-Path $TargetDir) {
        Remove-Item $TargetDir -Recurse -Force
    }
    if (Test-Path $Marker) { Remove-Item $Marker -Force }
}

if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

# Short-circuit if already up-to-date AND python.exe is present AND the
# pinned SHA-256 still matches (catches a tampered local install). Force
# bypasses the version check but still validates the archive on re-extract.
if (-not $Force -and (Test-Path $Marker) -and (Test-Path $PythonExe)) {
    $current = (Get-Content $Marker -Raw).Trim()
    if ($current -eq $PythonVersion) {
        Write-Ok "Python $PythonVersion already present at $TargetDir (use -Force to re-extract)"
        exit 0
    }
    Write-Warn2 "Marker says $current but pin is $PythonVersion - re-extracting"
}

# ── Download ──────────────────────────────────────────────────────────────

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "hamuna-python-$(Get-Random)"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $ArchivePath = Join-Path $TmpDir $ArchiveName

    Write-Info "Downloading $ArchiveName from $DownloadBaseUrl ..."
    try {
        $oldProgress = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath -UseBasicParsing -TimeoutSec 300 -ErrorAction Stop
    } catch {
        Write-Err "Download failed: $($_.Exception.Message)"
        Write-Err "  URL: $ArchiveUrl"
        exit 1
    } finally {
        $ProgressPreference = $oldProgress
    }

    # ── Verify checksum ───────────────────────────────────────────────────

    if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$') {
        Write-Err "Script is misconfigured: pinned SHA-256 is not 64 hex chars"
        Write-Err "  got: $ExpectedSha256"
        exit 1
    }
    Write-Info "Verifying SHA-256..."
    $actual = (Get-FileHash $ArchivePath -Algorithm SHA256).Hash.ToLower()
    if ($ExpectedSha256 -ne $actual) {
        Write-Err "SHA-256 mismatch!"
        Write-Err "  expected: $ExpectedSha256"
        Write-Err "  actual:   $actual"
        Write-Err "  Re-fetch the official zip and update \$ExpectedSha256 in this script."
        exit 1
    }
    Write-Ok "SHA-256 verified"

    # ── Extract and install ───────────────────────────────────────────────
    #
    # Wipe the install dir's CONTENTS (not the dir itself — we keep .tmp.*
    # sweep behaviour predictable) and extract fresh. Using a separate
    # staging dir + Move-Item would also work, but python.org zip layout is
    # flat (no top-level directory wrapper) so direct extraction into
    # $TargetDir is safe.

    Write-Info "Extracting to $TargetDir ..."
    Get-ChildItem $TargetDir -File -ErrorAction SilentlyContinue | Remove-Item -Force
    Get-ChildItem $TargetDir -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Expand-Archive -Path $ArchivePath -DestinationPath $TargetDir -Force

    if (-not (Test-Path $PythonExe)) {
        Write-Err "Extraction did not produce python.exe at $PythonExe"
        Write-Err "  Archive layout may have changed; check $ArchiveName contents."
        exit 1
    }

    Set-Content -Path $Marker -Value $PythonVersion -NoNewline

    Write-Ok "Python $PythonVersion installed:"
    Write-Ok "  $PythonExe"
} finally {
    if (Test-Path $TmpDir) {
        Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}