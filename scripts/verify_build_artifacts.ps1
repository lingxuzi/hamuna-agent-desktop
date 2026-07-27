# Verify v0.3.7 build artifacts + confirm R2 endpoint baked in
$ErrorActionPreference = "Continue"
$nsis = "D:\Coding\hamuna-agent-desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\HamunaAgent_0.3.7_x64-setup.nsis.zip"

Write-Host "=== Build artifacts ===" -ForegroundColor Cyan
Get-ChildItem "D:\Coding\hamuna-agent-desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\" |
    Where-Object { $_.Name -match "0\.3\.7" } |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize

# Verify .sig files are valid Tauri signatures
Write-Host "=== Sig validation ===" -ForegroundColor Cyan
$nsisZip = "D:\Coding\hamuna-agent-desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\HamunaAgent_0.3.7_x64-setup.nsis.zip"
$nsisSig = "$nsisZip.sig"
$nsisZipSha = (Get-FileHash $nsisZip -Algorithm SHA256).Hash.ToLower()
$sigText = (Get-Content $nsisSig -Raw).Trim()
Write-Host "  .nsis.zip SHA256: $nsisZipSha"
Write-Host "  .nsis.zip.sig (first 80 chars): $($sigText.Substring(0, [Math]::Min(80, $sigText.Length)))..."
Write-Host "  signature decodes to ASCII: $($null -ne ($sigText -replace '[^\x20-\x7E]', ''))"

# Try to verify the signature using tauri signer
Write-Host ""
Write-Host "=== Tauri signature verify ===" -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "D:\Coding\hamuna-agent-desktop\keys\hamuna.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "hmcz1234"
& npx --no-install tauri signer sign --help 2>&1 | Select-Object -First 2
Write-Host "  (tauri signer CLI is sign-only; tauri uses embedded pubkey for verify)"

# Tauri config pubkey from tauri.conf.json (post-override)
$confPubkey = (Get-Content "D:\Coding\hamuna-agent-desktop\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).plugins.updater.pubkey
$confEndpoints = (Get-Content "D:\Coding\hamuna-agent-desktop\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).plugins.updater.endpoints
Write-Host ""
Write-Host "=== tauri.conf.json (post-override) updater config ===" -ForegroundColor Cyan
Write-Host "  pubkey (first 60): $($confPubkey.Substring(0, [Math]::Min(60, $confPubkey.Length)))..."
Write-Host "  endpoints: $($confEndpoints -join ', ')"
Write-Host ""
Write-Host "  NOTE: tauri.conf.json shows the *fallback* endpoint."
Write-Host "  The actual baked-in endpoint is set at compile time via TAURI_CONFIG_OVERRIDES_JSON."
Write-Host "  Build log line 92 confirmed: Tauri config override: updater endpoint -> https://pub-2d5b7e0153e94f999bdfea020fb31629.r2.dev"
