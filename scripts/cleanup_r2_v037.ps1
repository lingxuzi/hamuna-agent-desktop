# Cleanup broken v0.3.7 artifacts on R2 staging bucket (hamuna-agent)
$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $ProjectDir
$rclone = Join-Path $ProjectDir "rclone.exe"
if (-not (Test-Path $rclone)) { throw "rclone.exe not found at $rclone" }

# Load .env
$EnvFile = Join-Path $ProjectDir ".env"
if (-not (Test-Path $EnvFile)) { throw ".env not found" }
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        $name = $Matches[1].Trim()
        $value = $Matches[2].Trim()
        if ($value -match '^"([^"]*)"' -or $value -match "^'([^']*)'") { $value = $Matches[1] }
        else { $value = $value -replace '\s+#.*$', ''; $value = $value.Trim() }
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}
if (-not $env:R2_BUCKET) { $env:R2_BUCKET = "hamuna-agent" }
$Bucket = $env:R2_BUCKET

$rcloneCfg = [System.IO.Path]::GetTempFileName()
@"
[r2]
type = s3
provider = Cloudflare
env_auth = true
endpoint = https://$($env:R2_ACCOUNT_ID).r2.cloudflarestorage.com
acl = private
"@ | Set-Content $rcloneCfg -Encoding UTF8
$env:RCLONE_CONFIG = $rcloneCfg
$env:RCLONE_CONFIG_R2_ACCESS_KEY_ID = $env:R2_ACCESS_KEY_ID
$env:RCLONE_CONFIG_R2_SECRET_ACCESS_KEY = $env:R2_SECRET_ACCESS_KEY

# Run rclone, capture all output, return exit code. Throws on failure.
function Invoke-RClone {
    param([string[]]$Args, [string]$What)
    $out = & $rclone @Args 2>&1
    $rc = $LASTEXITCODE
    if ($rc -ne 0) {
        Write-Host "  FAIL ($What, exit=$rc):" -ForegroundColor Red
        $out | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        return $false
    }
    return $true
}

try {
    Write-Host "=== R2 bucket: $Bucket ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[1/4] Listing current state ..." -ForegroundColor Blue
    Write-Host "  update/:" -ForegroundColor Yellow
    & $rclone lsf "r2:${Bucket}/update/"
    Write-Host "  releases/v0.3.7/:" -ForegroundColor Yellow
    & $rclone lsf "r2:${Bucket}/releases/v0.3.7/"
    Write-Host ""

    Write-Host "[2/4] Deleting updater manifest (update/windows-x86_64.json) ..." -ForegroundColor Blue
    Invoke-RClone @("delete", "r2:${Bucket}/update/windows-x86_64.json") "delete manifest" | Out-Null
    Write-Host ""

    Write-Host "[3/4] Purging releases/v0.3.7/ ..." -ForegroundColor Blue
    Invoke-RClone @("purge", "r2:${Bucket}/releases/v0.3.7/") "purge v0.3.7 dir" | Out-Null
    Write-Host ""

    Write-Host "[4/4] Verifying deletion ..." -ForegroundColor Blue
    Write-Host "  update/:" -ForegroundColor Yellow
    & $rclone lsf "r2:${Bucket}/update/"
    Write-Host "  releases/v0.3.7/:" -ForegroundColor Yellow
    $rc = & $rclone lsf "r2:${Bucket}/releases/v0.3.7/" 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Host "  (dir does not exist - clean)" -ForegroundColor Green }
    Write-Host ""
    Write-Host "Done. Safe to run publish_windows.ps1 next." -ForegroundColor Green
}
finally {
    Remove-Item $rcloneCfg -Force -ErrorAction SilentlyContinue
}
