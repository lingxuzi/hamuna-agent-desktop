; HamunaAgent NSIS Installer Hooks
; - PREINSTALL: Kill all HamunaAgent processes before file replacement
;   Prevents file-lock failures when updating node.exe / claude.exe / etc.

; Shared cleanup logic — kill all processes launched from our install directory,
; plus orphan SDK/MCP processes that reference .hamuna in their command line.
; Uses ExecutablePath for install-dir processes (precise, matches the locked file)
; and CommandLine for orphans (SDK/MCP may be system node, not our binary).
!macro _HAMUNA_KILL_PROCESSES
  DetailPrint "Cleaning up HamunaAgent background processes..."

  ; 1. Kill ALL processes whose executable lives under our install directory.
  ;    Covers node.exe (sidecar / MCP via bundled npx), claude.exe (SDK), and any future binaries.
  ;    Uses ExecutablePath — the actual on-disk binary — so we won't false-positive
  ;    on processes that merely mention our path in their arguments.
  nsExec::ExecToLog 'powershell -NoProfile -Command "$ErrorActionPreference=\"SilentlyContinue\"; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like \"$INSTDIR\*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"'

  ; 2. Kill orphan SDK/MCP child processes that may use system node
  ;    (their executable is NOT under $INSTDIR, but their CommandLine references .hamuna)
  nsExec::ExecToLog 'powershell -NoProfile -Command "$ErrorActionPreference=\"SilentlyContinue\"; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \"*claude-agent-sdk*\" -and $_.CommandLine -like \"*.hamuna*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"'
  nsExec::ExecToLog 'powershell -NoProfile -Command "$ErrorActionPreference=\"SilentlyContinue\"; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \"*.hamuna\mcp\*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"'

  ; Brief wait for processes to fully terminate and release file locks
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _HAMUNA_KILL_PROCESSES

  ; Legacy cleanup: remove orphaned bun.exe from pre-0.2.0 installs (Bun→Node migration,
  ; v0.2.0). Recent builds bundle Node, not Bun; this just sweeps any ancient leftover.
  Delete "$INSTDIR\bun.exe"

  ; Upgrade-path cleanup for bundled nodejs/ (TODO #187).
  ; Older installers (pre-v0.3.205) staged a partial nodejs/ tree — `node.exe`
  ; without `npm.cmd` / `npx.cmd` / the matching `node_modules/`. NSIS's
  ; `File /a` overwrites files by name but does NOT remove files that were
  ; present on disk and absent from the new resource map, so upgrading from
  ; such a build leaves a mixed-validity tree: `node.exe` is fresh, but
  ; `npm.cmd` / `npx.cmd` / `node_modules/npm/bin/npx-cli.js` may be missing or
  ; stale. Result on first MCP spawn: sidecar's `cmd_probe_provider_network`
  ; reports `node is not recognized` because the .cmd shim can't find its
  ; node_modules sibling, even though `node.exe` itself is reachable.
  ;
  ; Wipe the whole tree so Section Install's `File /a` lays down the v0.3.205+
  ; complete distribution (npm.cmd + npx.cmd + node_modules/) on top of a known-
  ; empty directory. /REBOOTOK lets pending file handles defer the delete to
  ; next boot rather than failing the install outright.
  RMDir /REBOOTOK "$INSTDIR\nodejs"
!macroend

; REMOVED (v0.3.18): easy_tdx vendored package + easy-tdx-mcp console script.
; Per-user Python install is still staged by installer.nsi (see Section PythonInstall
; + installer.nsi L717-725) for the uvx-driven MCPs (ddg-search, stock-datasource),
; which is the only reason this file retains `Software\Python\PythonCore\3.12` lookups.
;
; The old NSIS_HOOK_POSTINSTALL block resolved Python 3.12 from HKCU, then ran
;   $python.exe -m pip install --no-build-isolation -e "$INSTDIR\stock-sources\easy_tdx[mcp]"
; (with a build-isolation fallback). That path is gone because:
;   - extended_buildin_mcp/mcp.json no longer registers easy-tdx-mcp.
;   - The 7 stock-sources/easy_tdx/* entries were removed from
;     tauri.windows.conf.json bundle.resources, so $INSTDIR\stock-sources\easy_tdx\
;     is no longer staged by Section Install.
; uvx-driven MCPs spawn at first use via `uvx run` and need no preinstalled package.
;
; The Python registry lookup (`Software\Python\PythonCore\3.12\InstallPath`) is also
; gone now: nothing in the NSIS hook chain still needs the path.

!macro NSIS_HOOK_POSTINSTALL
  ; No post-install Python work left.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Kill all HamunaAgent processes before uninstall (same file-lock issue as update)
  !insertmacro _HAMUNA_KILL_PROCESSES

  ; Legacy cleanup: remove orphaned bun.exe from pre-0.2.0 installs so it doesn't
  ; survive uninstall (the NSIS uninstaller only tracks files it installed).
  Delete "$INSTDIR\bun.exe"
!macroend
