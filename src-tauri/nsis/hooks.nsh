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
!macroend

; HamunaAgent: After Section Install copies stock-sources/easy_tdx/ into
; place, run the vendored easy_tdx install via the per-user Python we just staged in
; Section PythonInstall. Without this, extended_buildin_mcp/mcp.json's bare
; `easy-tdx-mcp` invocation would ModuleNotFoundError on first Sidecar spawn.
;
; Path note: Tauri's NSIS template (installer.nsi L747-749) installs each
; bundle.resources value verbatim under $INSTDIR, NOT under $INSTDIR\resources.
; So easy_tdx lands at $INSTDIR\stock-sources\easy_tdx\pyproject.toml.
; (The Rust runtime resolves the same files at $INSTDIR\resources\ via
; BaseDirectory::Resource, but that's the API-side lookup; on disk the NSIS
; installer dropped them at the root.)
;
; Why a sub-shell (not in-process pip):
;   - currentUser install does not elevate; the HKCU\Environment PATH that
;     python-installer.exe /PrependPath=1 writes is NOT visible to this NSIS
;     process or its children — only to shells launched after `SendMessage
;     WM_SETTINGCHANGE`. We can't await that from a single ExecWait.
;   - So we resolve Python's InstallPath from HKCU\Software\Python\PythonCore\3.12
;     directly (the official installer writes it), then call
;     "$PythonPath\python.exe" -m pip install -e <stock-sources\easy_tdx>.
;     If Python didn't install (best-effort section, see installer.nsi L717-725),
;     skip with a clear log line — easy_tdx MCP will be unavailable until the
;     user installs Python manually.
;
; Soft-fail by design: a missing pip / network blip only disables one optional MCP.
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing vendored easy_tdx package (provides easy-tdx-mcp console script)..."

  ; Verify easy_tdx source landed under our install dir (NSIS Section Install runs
  ; BEFORE this macro, so stock-sources/easy_tdx/pyproject.toml exists).
  IfFileExists "$INSTDIR\stock-sources\easy_tdx\pyproject.toml" easy_tdx_source_present 0
    ; easy_tdx source missing — bail out cleanly
    DetailPrint "  ⛔ $INSTDIR\stock-sources\easy_tdx\pyproject.toml not found; skipping easy_tdx install."
    DetailPrint "     The NSIS bundle missing the easy_tdx resources — check tauri.windows.conf.json bundle.resources."
    Goto easy_tdx_postinstall_done

  easy_tdx_source_present:
    ; Resolve Python 3.12 install path from the registry the official installer wrote.
    ReadRegStr $0 HKCU "Software\Python\PythonCore\3.12\InstallPath" ""
    ${If} $0 == ""
      DetailPrint "  ⛔ Python 3.12 not found in registry; skipping easy_tdx install."
      DetailPrint "     Install Python 3.12 manually then run: pip install -e $INSTDIR\stock-sources\easy_tdx[mcp]"
      Goto easy_tdx_postinstall_done
    ${EndIf}

    ; -m pip install with --no-build-isolation: hatchling must be on the system
    ; site-packages or the PEP 517 build will reach for a temp venv and truncate
    ; byte streams from PyPI mirrors. Matches the two-step install pattern in
    ; scripts/install_easy_tdx.ps1 so dev-mode + production install converge.
    nsExec::ExecToLog '"$0python.exe" -m pip install --quiet --retries 5 --timeout 60 --no-build-isolation -e "$INSTDIR\stock-sources\easy_tdx[mcp]"'

    Pop $1
    ${If} $1 == "0"
      DetailPrint "  ✓ easy_tdx installed."
    ${Else}
      ; Fallback: retry with build-isolation in case hatchling isn't present.
      nsExec::ExecToLog '"$0python.exe" -m pip install --quiet --retries 5 --timeout 60 -e "$INSTDIR\stock-sources\easy_tdx[mcp]"'
      Pop $1
      ${If} $1 == "0"
        DetailPrint "  ✓ easy_tdx installed (with build-isolation)."
      ${Else}
        DetailPrint "  ⚠ easy_tdx install failed (exit $1). easy-tdx MCP will be unavailable."
        DetailPrint "     Run manually: $0python.exe -m pip install -e $INSTDIR\stock-sources\easy_tdx[mcp]"
      ${EndIf}
    ${EndIf}

  easy_tdx_postinstall_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Kill all HamunaAgent processes before uninstall (same file-lock issue as update)
  !insertmacro _HAMUNA_KILL_PROCESSES

  ; Legacy cleanup: remove orphaned bun.exe from pre-0.2.0 installs so it doesn't
  ; survive uninstall (the NSIS uninstaller only tracks files it installed).
  Delete "$INSTDIR\bun.exe"
!macroend
