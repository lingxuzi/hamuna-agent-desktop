# HamunaAgent: persist the pip-installed `uvx` (Scripts) dir on the user's
# PATH so that future Sidecar restarts can spawn MCP stdio servers declared
# with `command: 'uvx'` via plain PATH lookup.
#
# Why this lives here:
#   - `pip install --user uv` drops uvx.exe at PEP 370's per-user site,
#     which on Windows defaults to %APPDATA%\Roaming\Python\Python312\Scripts\.
#     That path is NOT on the system PATH by default (per-user pip install
#     intentionally avoids touching env vars to stay zero-privilege).
#   - Sidecar's MCP spawn path (`agent-session.ts`) used to prepend a
#     bundled uvx dir to mcpEnv.PATH as a workaround. We removed the
#     bundle entirely (pip-only direction), so MCP spawn now depends on
#     `uvx` being reachable via system PATH.
#   - Registering the Scripts dir on HKCU\Environment\Path is per-user
#     (no UAC), takes effect on next process spawn (Sidecar restart),
#     and is broadcast via WM_SETTINGCHANGE so Explorer / cmd.exe
#     refresh their cached environment.
#
# Failure modes:
#   - python.exe not on PATH: `python -m site --user-site` errors.
#     We swallow (SilentlyContinue) and exit 0 — the Sidecar's spawn
#     fallback will surface a clearer hint than this installer step.
#   - Registry write denied: only possible if HKCU is locked down
#     (rare; HKCU by definition always writable by the current user).
#     Set-ItemProperty throws; we catch.
#   - HKCU\Environment\Path does not exist as REG_EXPAND_SZ: rare on
#     modern Windows; Get-ItemProperty returns nothing, our `if ($cur)`
#     handles the empty case (start with just our new entry).
#
# Args:
#   $pythonExe  — absolute path to the python.exe that ran pip
#                 (may be "python" if we let PATH resolve it).

param([string]$pythonExe)

$ErrorActionPreference = 'Stop'

try {
    # Resolve the actual user-site directory via the same Python we
    # just used to `pip install --user uv`. `python -m site --user-site`
    # returns the parent of the Scripts dir (e.g. C:\Users\x\AppData\
    # Roaming\Python\Python312\site-packages); we walk up one and append
    # "Scripts" because pip --user installs entry-point scripts into
    # site-packages' sibling Scripts dir.
    $userSite = & $pythonExe -m site --user-site 2>$null
    if (-not $userSite) {
        Write-Output "[uvx-path-setup] could not resolve user-site via '$pythonExe' — skipping PATH append"
        exit 0
    }
    $scriptsDir = Join-Path -Path (Split-Path -Parent -Path $userSite) -ChildPath 'Scripts'
    if (-not (Test-Path -LiteralPath $scriptsDir)) {
        Write-Output "[uvx-path-setup] Scripts dir not found at $scriptsDir — skipping PATH append"
        exit 0
    }

    $regPath = 'HKCU:\Environment'
    $name    = 'Path'

    # Read current user PATH. REG_EXPAND_SZ gets expanded for the
    # comparison check, which is what we want — duplicates are
    # deduplicated by literal substring match, not by registry-typed
    # raw value.
    $cur = (Get-ItemProperty -LiteralPath $regPath -Name $name -ErrorAction SilentlyContinue).$name
    $list = @()
    if ($cur) {
        # Split on ';' but tolerate stray whitespace.
        $list = $cur.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object { $_.Trim() }
    }

    # Idempotent: already on PATH? Bail without re-writing (avoids
    # bumping the registry last-write time on every install).
    if ($list -contains $scriptsDir) {
        Write-Output "[uvx-path-setup] $scriptsDir already on HKCU\Environment\Path"
        exit 0
    }

    # Prepend so uvx wins over any pre-existing user-installed copy
    # that might be stale (e.g. older `uv` from cargo or scoop).
    $newList = @($scriptsDir) + ($list | Where-Object { $_ -and $_ -ne $scriptsDir })
    $newValue = ($newList -join ';')

    Set-ItemProperty -LiteralPath $regPath -Name $name -Value $newValue -Type ExpandString

    # Broadcast WM_SETTINGCHANGE so shell-explorer / cmd.exe refresh
    # their cached environment. Already-running processes do NOT
    # pick up the new PATH (Windows behaviour; this is well-known
    # and not something we can fix here without a session restart).
    # P/Invoke SendMessageTimeout is the only documented way to do
    # this without a heavy COM dependency.
    Add-Type -Namespace Win32 -Name Broadcast -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern System.IntPtr SendMessageTimeout(
    System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam,
    uint fuFlags, uint uTimeout, out System.IntPtr lpdwResult);
'@
    [Win32.Broadcast]::SendMessageTimeout(
        [System.IntPtr]0xffff,   # HWND_BROADCAST
        [uint32]0x001A,          # WM_SETTINGCHANGE
        [System.IntPtr]0,
        [System.IntPtr][System.Runtime.InteropServices.Marshal]::StringToHGlobalAuto('Environment'),
        [uint32]2,               # SMTO_ABORTIFHUNG
        [uint32]1000,
        [ref][System.IntPtr]::Zero
    ) | Out-Null

    Write-Output "[uvx-path-setup] prepended $scriptsDir to HKCU\Environment\Path"
    exit 0
} catch {
    # Best-effort. Failure here is a soft fail — Sidecar's MCP spawn
    # fallback in agent-session.ts surfaces a clearer error than we
    # could in the installer, so let install proceed.
    Write-Output "[uvx-path-setup] failed: $($_.Exception.Message)"
    exit 0
}