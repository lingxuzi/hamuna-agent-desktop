@echo off
REM Cleanup broken v0.3.7 artifacts on R2 staging bucket (hamuna-agent)
REM - updates/windows-x86_64.json (advertises v0.3.7 with v0.3.5 binaries)
REM - releases/v0.3.7/*.nsis.zip (does not exist; .exe/.zip are v0.3.5)
REM - releases/v0.3.7/*.sig (stale signature)
REM publish_windows.ps1 will rewrite the manifest + re-upload correct binaries.
REM
REM Uses rclone temp config from .env (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID / R2_BUCKET).
setlocal enabledelayedexpansion

cd /d "%~dp0\.."

REM Load .env into process env
for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
    set "LINE=%%A"
    if not "!LINE:~0,1!"=="#" (
        for /f "tokens=*" %%C in ("%%B") do (
            set "VALUE=%%C"
            REM strip inline # comment
            for /f "tokens=1*" %%D in ("!VALUE!") do set "VALUE=%%D"
            set "!LINE!=!VALUE!"
        )
    )
)

if "%R2_BUCKET%"=="" set "R2_BUCKET=hamuna-agent"
set "RCLONE_CFG=%TEMP%\rclone-cleanup-%RANDOM%.conf"
> "%RCLONE_CFG%" echo [r2]
>>"%RCLONE_CFG%" echo type = s3
>>"%RCLONE_CFG%" echo provider = Cloudflare
>>"%RCLONE_CFG%" echo env_auth = true
>>"%RCLONE_CFG%" echo endpoint = https://%R2_ACCOUNT_ID%.r2.cloudflarestorage.com
>>"%RCLONE_CFG%" echo acl = private

set RCLONE_CONFIG=%RCLONE_CFG%
set RCLONE_CONFIG_R2_ACCESS_KEY_ID=%R2_ACCESS_KEY_ID%
set RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=%R2_SECRET_ACCESS_KEY%

echo === R2 bucket: %R2_BUCKET% ===
echo.
echo [1/3] Listing current update/ and releases/v0.3.7/ ...
rclone lsf --max-depth 1 r2:%R2_BUCKET%/update/ 2>nul
echo ---
rclone lsf r2:%R2_BUCKET%/releases/v0.3.7/ 2>nul
echo.
echo [2/3] Deleting broken v0.3.7 manifest + stale release dir ...
rclone deletefile r2:%R2_BUCKET%/update/windows-x86_64.json
rclone purge r2:%R2_BUCKET%/releases/v0.3.7/ 2>nul
echo.
echo [3/3] Verifying deletion ...
rclone lsf r2:%R2_BUCKET%/update/ 2>nul
rclone lsf r2:%R2_BUCKET%/releases/v0.3.7/ 2>nul
echo.
echo Done. Safe to run publish_windows.ps1 next.
del "%RCLONE_CFG%" >nul 2>&1
endlocal
