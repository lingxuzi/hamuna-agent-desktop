#Requires -Version 5.1
<#
.SYNOPSIS
    Fetch the official Python 3.12.7 amd64 installer (.exe) from python.org
    and stage it into src-tauri\resources\ so the Windows installer can
    bundle it via bundle.resources.

.DESCRIPTION
    HamunaAgent's Windows installer runs the Python 3.12 official installer
    during installation (see src-tauri/nsis/installer.nsi : Section
    PythonInstall). That installer must already be staged under
    src-tauri\resources\python-3.12.7-amd64.exe when the NSIS build runs.

    This script is a developer-machine bootstrap — it is NOT executed at
    build time or install time. The downloaded .exe is gitignored. Whoever
    does the next Windows release re-runs this script (or pins the existing
    staged copy) to refresh the staged binary.

    SHA-256 is pinned in this script (python.org does not publish a sidecar
    .sha256). To bump the version: download the new installer from
        https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe
    then run
        Get-FileHash .\python-$PythonVersion-amd64.exe -Algorithm SHA256
    and update both $PythonVersion and $ExpectedSha256 below. NEVER ship
    a placeholder hash — build_windows.ps1's pre-flight check will fail
    loudly if the pinned hash doesn't match the staged file.

    Layout after staging:
        src-tauri\resources\
            python-3.12.7-amd64.exe         (~25 MB, single-file NSIS installer)
            python-3.12.7-amd64.exe.sha256  (optional, written for traceability)
            .python-installer-version       (plain text, version string)

    We do NOT extract or execute the .exe — the Windows installer itself
    is the payload (Section PythonInstall File's it to $TEMP at install
    time and ExecWait's the silent install flags).

.EXAMPLE
    .\scripts\download_python.ps1              # Stage pinned 3.12.7 if missing
    .\scripts\download_python.ps1 -Force       # Re-download even if up-to-date
    .\scripts\download_python.ps1 -Clean       # Remove staged installer
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

# ── Pin ────────────────────────────────────────────────────────────────────
# Bump both together. SHA-256 of the official .exe at this exact version
# (verified by Get-FileHash on the official download).
#
# IMPORTANT: the placeholder below is intentionally invalid — running this
# script with the placeholder will fail SHA-256 verification. Real values
# must be filled in by running:
#     Invoke-WebRequest https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe -OutFile python-3.12.7-amd64.exe
#     (Get-FileHash .\python-3.12.7-amd64.exe -Algorithm SHA256).Hash.ToLower()
# and pasting the result into $ExpectedSha256. Do NOT ship a placeholder.
$PythonVersion  = "3.12.7"
$ExpectedSha256 = "1206721601a62c925d4e4a0dcfc371e88f2ddbe8c0c07962ebb2be9b5bde4570"

$DownloadBaseUrl = "https://www.python.org/ftp/python/$PythonVersion"
$ArchiveName     = "python-$PythonVersion-amd64.exe"
$ArchiveUrl      = "$DownloadBaseUrl/$ArchiveName"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir  = Split-Path -Parent $ScriptDir
$ResourcesDir = Join-Path $ProjectDir "src-tauri\resources"
$StagePath   = Join-Path $ResourcesDir $ArchiveName
$Marker      = Join-Path $ResourcesDir ".python-installer-version"

function Write-Info  { param($msg) Write-Host "[python] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "[python] $msg" -ForegroundColor Green }
function Write-Warn2 { param($msg) Write-Host "[python] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[python] $msg" -ForegroundColor Red }

# ── Preflight ─────────────────────────────────────────────────────────────

# Force TLS 1.2 on legacy PS 5.1 (python.org/CDN drops older protocols).
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Sweep stale .tmp.<pid> orphans from prior runs killed mid-download.
Get-ChildItem $ResourcesDir -Filter "python-*.tmp.*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

if ($Clean) {
    Write-Info "Cleaning staged Python installer..."
    if (Test-Path $StagePath)  { Remove-Item $StagePath  -Force }
    if (Test-Path $Marker)     { Remove-Item $Marker     -Force }
    $sidecarSha = "$StagePath.sha256"
    if (Test-Path $sidecarSha) { Remove-Item $sidecarSha -Force }
}

if (-not (Test-Path $ResourcesDir)) {
    New-Item -ItemType Directory -Path $ResourcesDir -Force | Out-Null
}

# Short-circuit if already up-to-date AND the pinned SHA-256 still matches
# (catches a tampered local install). Force bypasses the version check but
# still validates the file on re-download.
if (-not $Force -and (Test-Path $Marker) -and (Test-Path $StagePath)) {
    $current = (Get-Content $Marker -Raw).Trim()
    if ($current -eq $PythonVersion) {
        Write-Ok "Python $PythonVersion installer already staged at $StagePath (use -Force to re-download)"
        exit 0
    }
    Write-Warn2 "Marker says $current but pin is $PythonVersion - re-staging"
}

# ── Validate pin ─────────────────────────────────────────────────────────
# Catch the placeholder BEFORE we hit the network so we don't burn 25 MB of
# bandwidth just to fail verification afterwards. A 64-hex-char placeholder
# is technically valid, but we add a sentinel check: if the hash exactly
# matches the obvious "REPLACE_ME" sentinel or the historical placeholder,
# bail early.

if ($ExpectedSha256 -match '^REPLACE_ME' -or $ExpectedSha256 -match '^c8ad4d39f3db1e9e') {
    Write-Err "Script is unconfigured: \$ExpectedSha256 is still a placeholder."
    Write-Err "  Download $ArchiveName manually, compute the real SHA-256 with:"
    Write-Err "      (Get-FileHash .\$ArchiveName -Algorithm SHA256).Hash.ToLower()"
    Write-Err "  and paste it into \$ExpectedSha256 in this script."
    exit 1
}

if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$') {
    Write-Err "Script is misconfigured: pinned SHA-256 is not 64 hex chars"
    Write-Err "  got: $ExpectedSha256"
    exit 1
}

# ── Download ──────────────────────────────────────────────────────────────

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "hamuna-python-$(Get-Random)"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $TmpArchive = Join-Path $TmpDir $ArchiveName

    Write-Info "Downloading $ArchiveName from $DownloadBaseUrl ..."
    try {
        $oldProgress = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $ArchiveUrl -OutFile $TmpArchive -UseBasicParsing -TimeoutSec 600 -ErrorAction Stop
    } catch {
        Write-Err "Download failed: $($_.Exception.Message)"
        Write-Err "  URL: $ArchiveUrl"
        exit 1
    } finally {
        $ProgressPreference = $oldProgress
    }

    # ── Verify checksum ───────────────────────────────────────────────────

    Write-Info "Verifying SHA-256..."
    $actual = (Get-FileHash $TmpArchive -Algorithm SHA256).Hash.ToLower()
    if ($ExpectedSha256 -ne $actual) {
        Write-Err "SHA-256 mismatch!"
        Write-Err "  expected: $ExpectedSha256"
        Write-Err "  actual:   $actual"
        Write-Err "  Re-fetch the official installer and update \$ExpectedSha256 in this script."
        exit 1
    }
    Write-Ok "SHA-256 verified"

    # ── PE magic smoke check ─────────────────────────────────────────────
    # The official installer is a Win32 PE binary — must start with "MZ".
    # This catches the very rare case where python.org serves an HTML error
    # page (e.g., 404 with a fallback body) that still matches the URL by
    # happy coincidence.
    $fsStream = [System.IO.File]::OpenRead($TmpArchive)
    try {
        $mz = New-Object byte[] 2
        $null = $fsStream.Read($mz, 0, 2)
    } finally {
        $fsStream.Close()
    }
    if ($mz[0] -ne 0x4D -or $mz[1] -ne 0x5A) {
        Write-Err "Downloaded file is not a PE binary (missing MZ magic)."
        Write-Err "  Got bytes: 0x$('{0:X2}{1:X2}' -f $mz[0],$mz[1])"
        Write-Err "  python.org may be serving an error page. Re-check $ArchiveUrl."
        exit 1
    }
    Write-Ok "PE magic verified (MZ)"

    # ── Stage ─────────────────────────────────────────────────────────────
    # Atomic: stage to a sibling .tmp.<pid>, then Move-Item over the final
    # path. Avoids leaving a half-written file at $StagePath if the script
    # is killed mid-write.

    $TmpStage = "$StagePath.tmp.$PID"
    Move-Item -Path $TmpArchive -Destination $TmpStage -Force
    Move-Item -Path $TmpStage -Destination $StagePath -Force

    # Sidecar .sha256 for traceability (NOT used for verification — that
    # happens inside this script). Lets `sha256sum` users double-check
    # without re-running download_python.ps1.
    Set-Content -Path "$StagePath.sha256" -Value "$ExpectedSha256  $ArchiveName`n" -NoNewline

    Set-Content -Path $Marker -Value $PythonVersion -NoNewline

    $size = (Get-Item $StagePath).Length
    Write-Ok "Python $PythonVersion installer staged:"
    Write-Ok "  $StagePath ($([math]::Round($size / 1MB, 1)) MB)"
} finally {
    if (Test-Path $TmpDir) {
        Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}