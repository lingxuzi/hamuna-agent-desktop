#Requires -Version 5.1
<#
.SYNOPSIS
    Fetch the latest Astral uv Windows binary and install it as
    src-tauri\resources\uvx.exe so the Windows installer can bundle it via
    bundle.resources.

.DESCRIPTION
    HamunaAgent bundles uv (which provides uvx) on Windows so MCP servers
    declared with `command: 'uvx'` work out-of-the-box. Astral publishes a
    single self-contained binary:
        https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip

    We pull the latest tag, fetch its `.sha256` sidecar from the same
    release, and extract `uv.exe` as `uvx.exe` (the install hook is uvx-
    shaped, not uv- shaped). SHA-256 verification reuses Astral's GitHub
    sidecar file — same trust model as cuse's R2 sidecar.

.EXAMPLE
    .\scripts\download_uv.ps1                  # Latest version
    .\scripts\download_uv.ps1 -Version 0.5.5   # Pin a specific release tag
    .\scripts\download_uv.ps1 -Force           # Re-download even if up-to-date
    .\scripts\download_uv.ps1 -Clean           # Remove existing uvx.exe
#>
[CmdletBinding()]
param(
    [string]$Version = "",
    [switch]$Force,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$ReleaseApiBase = "https://api.github.com/repos/astral-sh/uv/releases"
$DownloadBase   = "https://releases.astral.sh/github/uv/releases/download"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir  = Split-Path -Parent $ScriptDir
$TargetDir   = Join-Path $ProjectDir "src-tauri\resources"
$TargetBinary = Join-Path $TargetDir "uvx.exe"
$Marker      = Join-Path $TargetDir ".uv-version"

function Write-Info  { param($msg) Write-Host "[uv] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "[uv] $msg" -ForegroundColor Green }
function Write-Warn2 { param($msg) Write-Host "[uv] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[uv] $msg" -ForegroundColor Red }

# ── Preflight ─────────────────────────────────────────────────────────────

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

Get-ChildItem $TargetDir -Filter "uvx.tmp.*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

if ($Clean) {
    Write-Info "Cleaning existing uvx.exe..."
    if (Test-Path $TargetBinary) { Remove-Item $TargetBinary -Force }
    if (Test-Path $Marker) { Remove-Item $Marker -Force }
}

# ── Resolve version ───────────────────────────────────────────────────────

# Short-circuit FIRST if already up-to-date AND binary passes a PE-header
# smoke check. Doing this before the GitHub API query means: if the dev
# machine already has uvx.exe staged (the common case), running this
# script is a pure local operation with **zero** network traffic. Pin
# -Version <tag> explicitly to force re-resolve from the network; without
# it, the marker wins and we never touch GitHub. This is the same
# "downloaded = downloaded, no re-fetch" invariant as download_python.ps1.

if (-not $Force -and -not $Version -and (Test-Path $Marker) -and (Test-Path $TargetBinary)) {
    $current = (Get-Content $Marker -Raw).Trim()
    $ok = $false
    try {
        $fs = [System.IO.File]::OpenRead($TargetBinary)
        $buf = New-Object byte[] 2
        $read = $fs.Read($buf, 0, 2)
        $fs.Close()
        if ($read -eq 2 -and $buf[0] -eq 0x4D -and $buf[1] -eq 0x5A) { $ok = $true }
    } catch { $ok = $false }
    if ($ok) {
        Write-Ok "uv $current already staged as $TargetBinary (pass -Version <tag> or -Force to re-resolve)"
        exit 0
    }
    Write-Warn2 "Marker says $current but binary is missing/corrupt - re-downloading"
}

if (-not $Version) {
    Write-Info "Querying latest uv release from $ReleaseApiBase/latest..."
    try {
        # GitHub API needs a User-Agent (otherwise 403).
        $headers = @{ 'User-Agent' = 'hamuna-download-uv' }
        $latest = Invoke-RestMethod -Uri "$ReleaseApiBase/latest" -Headers $headers -TimeoutSec 30 -ErrorAction Stop
        # Astral tags use plain `0.5.5` (no v-prefix).
        $Version = $latest.tag_name
    } catch {
        Write-Err "Failed to query GitHub Releases API: $($_.Exception.Message)"
        Write-Err "  URL: $ReleaseApiBase/latest"
        Write-Err "  Check network / rate limits / pin -Version <tag>."
        exit 1
    }
    if (-not $Version) {
        Write-Err "GitHub response missing tag_name"
        exit 1
    }
}
$Version = $Version.Trim()

# Defensive: reject unusual tag shapes. Astral uses MAJOR.MINOR.PATCH
# optionally with a leading `v` — nothing else should ever appear here.
if ($Version -notmatch '^v?[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$') {
    Write-Err "Refusing unsafe version string: $Version"
    exit 1
}
if ($Version -notmatch '^v') { $Version = "$Version" }

Write-Info "Target version: $Version"

# If user pinned a -Version that already matches the staged one, also
# short-circuit (covers the "wanting to verify it really is this tag"
# case without burning bandwidth).
if (-not $Force -and (Test-Path $Marker) -and (Test-Path $TargetBinary)) {
    $current = (Get-Content $Marker -Raw).Trim()
    if ($current -eq $Version) {
        $ok = $false
        try {
            $fs = [System.IO.File]::OpenRead($TargetBinary)
            $buf = New-Object byte[] 2
            $read = $fs.Read($buf, 0, 2)
            $fs.Close()
            if ($read -eq 2 -and $buf[0] -eq 0x4D -and $buf[1] -eq 0x5A) { $ok = $true }
        } catch { $ok = $false }
        if ($ok) {
            Write-Ok "uv $Version already installed as $TargetBinary (use -Force to re-download)"
            exit 0
        }
        Write-Warn2 "Marker says $Version but binary is missing/corrupt - re-downloading"
    }
}

# ── Download ──────────────────────────────────────────────────────────────

$ArchiveName = "uv-x86_64-pc-windows-msvc.zip"
$ArchiveUrl  = "$DownloadBase/$Version/$ArchiveName"
$ShaUrl      = "$ArchiveUrl.sha256"

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "hamuna-uv-$(Get-Random)"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $ArchivePath = Join-Path $TmpDir $ArchiveName
    $HashFile    = Join-Path $TmpDir "$ArchiveName.sha256"

    Write-Info "Downloading $ArchiveName + .sha256..."
    try {
        $oldProgress = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        # GitHub download URLs are CDN-fronted; release tag redirects work
        # but the `.sha256` sidecar lives next to the binary and returns a
        # plain text body with the hex digest.
        Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath -UseBasicParsing -TimeoutSec 300 -ErrorAction Stop
        Invoke-WebRequest -Uri $ShaUrl     -OutFile $HashFile    -UseBasicParsing -TimeoutSec 30  -ErrorAction Stop
    } catch {
        Write-Err "Download failed: $($_.Exception.Message)"
        Write-Err "  URL: $ArchiveUrl"
        exit 1
    } finally {
        $ProgressPreference = $oldProgress
    }

    # ── Verify checksum ───────────────────────────────────────────────────

    Write-Info "Verifying SHA-256..."
    $expected = ((Get-Content $HashFile -Raw) -split '\s+')[0].Trim().ToLower()
    if ($expected -notmatch '^[a-f0-9]{64}$') {
        $preview = if ($expected.Length -gt 80) { $expected.Substring(0, 80) } else { $expected }
        Write-Err "Malformed .sha256 sidecar (expected 64 hex chars, got: '$preview')"
        exit 1
    }
    $actual = (Get-FileHash $ArchivePath -Algorithm SHA256).Hash.ToLower()

    if ($expected -ne $actual) {
        Write-Err "SHA-256 mismatch!"
        Write-Err "  expected: $expected"
        Write-Err "  actual:   $actual"
        exit 1
    }
    Write-Ok "SHA-256 verified"

    # ── Extract and install ───────────────────────────────────────────────

    Write-Info "Extracting..."
    $ExtractDir = Join-Path $TmpDir "extract"
    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force

    # Astral uv zip is flat: `uv.exe` directly inside.
    $SrcBin = Join-Path $ExtractDir "uv.exe"
    if (-not (Test-Path $SrcBin)) {
        $SrcBin = Get-ChildItem $ExtractDir -Recurse -Filter "uv.exe" -File | Select-Object -First 1 -ExpandProperty FullName
        if (-not $SrcBin) {
            Write-Err "Archive does not contain uv.exe"
            exit 1
        }
    }

    # PE magic smoke check (same as cuse script).
    try {
        $fs = [System.IO.File]::OpenRead($SrcBin)
        $buf = New-Object byte[] 2
        $read = $fs.Read($buf, 0, 2)
        $fs.Close()
        if ($read -ne 2 -or $buf[0] -ne 0x4D -or $buf[1] -ne 0x5A) {
            Write-Err "Downloaded binary is not a valid Windows PE executable"
            exit 1
        }
    } catch {
        Write-Err "Could not verify PE header on downloaded binary: $($_.Exception.Message)"
        exit 1
    }

    # Atomic install.
    $TmpTarget = "$TargetBinary.tmp.$PID"
    Copy-Item $SrcBin $TmpTarget -Force
    Move-Item -Path $TmpTarget -Destination $TargetBinary -Force

    Set-Content -Path $Marker -Value $Version -NoNewline

    Write-Ok "uv $Version installed as uvx.exe:"
    Write-Ok "  $TargetBinary"
} finally {
    if (Test-Path $TmpDir) {
        Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}