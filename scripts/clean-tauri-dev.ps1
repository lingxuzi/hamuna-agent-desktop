#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Windows counterpart of scripts/clean-tauri-dev.sh — force-clean stuck
    Tauri dev processes and the Vite dev-server port.

.DESCRIPTION
    Symptom this fixes: a previous `npm run tauri:dev` was closed from the
    console (Ctrl+C / killing the terminal / a crash), leaving the Vite dev
    server holding port 5173 or the compiled binary still resident. The next
    `npm run tauri:dev` then races those leftovers: the new WebView spins
    forever on localhost:5173, or cargo fails to overwrite a locked
    target\debug\hamuna.exe, and the user sees a blank window that never paints.

    What this kills (matched on full command line, not just image name):
      - npm / node wrappers around `tauri dev` and `vite`
      - cmd.exe /c shims for the beforeDevCommand chain
        (node scripts/esbuild-bundle.mjs, build:bridge, dev:web)
      - the compiled Tauri binary (src-tauri\target\debug\hamuna.exe)
      - msedgewebview2.exe whose ancestor is one of the above — this is the
        WebView2 runtime (the Windows analogue of macOS's WebKit helper
        processes). Only OUR webviews are touched; see the note below.
      - node.exe sidecars (server-dist.js) spawned by our app

    What this DOES NOT kill:
      - The INSTALLED app at %LOCALAPPDATA%\HamunaAgent\hamuna.exe and its
        WebView2 (dev-only patterns, see $Patterns below)
      - Another checkout's tauri dev (foreign-path veto, see Test-ForeignCheckout)
      - System processes, browser, IDE, or any other app's WebView2

.PARAMETER DryRun
    Report what would be killed without killing anything.

.PARAMETER KeepWebView
    Leave msedgewebview2.exe alone. Use when another Tauri/Electron app shares
    the machine and you would rather restart the app yourself than risk it.

.PARAMETER AlsoCloseInstalled
    ALSO quit the installed HamunaAgent (%LOCALAPPDATA%\HamunaAgent\hamuna.exe)
    and its descendants. This is what you need when `tauri dev` refuses to
    start: the installed app holds the tauri-plugin-single-instance lock for
    identifier `com.hamuna.app`, which the dev binary shares, so the dev process
    is killed before .setup() ever runs (see src-tauri/src/lib.rs).

    DESTRUCTIVE — it interrupts any in-flight agent turn and closes any open
    session. Closing the window is NOT a substitute: this app hides to tray, so
    a window-close leaves the lock held.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\clean-tauri-dev.ps1 -DryRun

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\clean-tauri-dev.ps1 -AlsoCloseInstalled
#>

param(
    [switch]$DryRun,
    [switch]$KeepWebView,
    [switch]$AlsoCloseInstalled
)

# Deliberately NOT `Set-StrictMode`/`$ErrorActionPreference = 'Stop'`: every
# kill / port query below can legitimately fail (process already gone, port
# already free, cmdlet unavailable). The script must run through every step so
# the final report is truthful.
$ErrorActionPreference = 'Continue'

$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# Vite dev server — hardcoded in vite.config.ts (`server.port`). Read it rather
# than duplicating the literal, so a config change can't silently desync this
# script (the .sh still lists 1420/1430, which this project no longer uses).
#
# Only the Vite port is listed. The management API and each Sidecar bind an
# EPHEMERAL port (`management_api.rs` binds port 0 and reads back `.port()`), so
# they cannot be enumerated ahead of time — they are freed by killing their
# owner process in step 1, not by a port sweep.
$PortsToClean = @()
$viteConfig = Join-Path $ProjectDir 'vite.config.ts'
if (Test-Path $viteConfig) {
    $match = Select-String -Path $viteConfig -Pattern 'port:\s*(\d+)' -AllMatches |
        Select-Object -First 1
    if ($match -and $match.Matches.Count -gt 0) {
        $PortsToClean += [int]$match.Matches[0].Groups[1].Value
    }
}
if ($PortsToClean.Count -eq 0) {
    $PortsToClean = @(5173)
    Write-Warning "Could not read a port from vite.config.ts; falling back to 5173."
}

# Matched against Win32_Process.CommandLine. Patterns are deliberately narrow:
# a bare 'node' or 'vite' would match every JS tool on the machine.
#
# The last pattern is the load-bearing one. A bare `hamuna\.exe` looks right and
# is wrong: the INSTALLED app runs from %LOCALAPPDATA%\HamunaAgent\hamuna.exe,
# and every WebView2 sub-process of it carries `--webview-exe-name=hamuna.exe`
# in argv. Matching either would make this script kill the user's real,
# installed HamunaAgent — collateral this script must never cause. Requiring the
# `target\<profile>\` prefix matches only the compiled dev binary. The dev app's
# webviews are still caught, by step 2's ancestor-chain walk, which is where
# the .sh handles WebKitWebProcess too.
$Patterns = @(
    'node.*\\tauri(\.js)?\s+dev',
    # Require `node_modules` in argv so this stays a dev-stack test and cannot
    # match an unrelated `node something.js`. The `\.bin\..\` hop has to be
    # allowed: npm's Windows shim is a .cmd that execs the resolved
    # `node "...\node_modules\.bin\\..\vite\bin\vite.js"`, which a strict
    # `node_modules[\\/](\.bin[\\/])?vite` would miss.
    'node.*node_modules.*[\\/](tauri|vite)[\\/]',
    'node.*node_modules.*[\\/](tauri|vite)\.(js|cmd)',
    'node.*esbuild-bundle\.mjs',
    'node.*build_?bridge',
    'npm-cli\.js\s+run\s+(tauri:dev|dev:web|build:server|build:bridge)',
    'npm(\.cmd)?\s+(run\s+)?(tauri:dev|dev:web|build:server|build:bridge)',
    # cmd.exe puts its own flags before /c: `/d /s /c vite`, not `/c vite`.
    'cmd(\.exe)?\s+(/\S+\s+)*/c\s+.*(tauri|vite|esbuild-bundle)',
    'target[\\/](debug|release)[\\/]hamuna\.exe'
)

# Substrings that, if present in a command line, mean the process belongs to a
# DIFFERENT checkout. Windows has no /proc/<pid>/cwd to check the equivalent of
# the .sh's is_in_this_project(), so scoping leans on the project path appearing
# in the command line (true for the node/npm/cmd wrappers) plus an explicit
# foreign-path veto below. A dev stack for another checkout runs under a
# different project root, so its command line will not contain this one.
$ProjectPathNeedle = $ProjectDir

$script:killed = 0

function Write-Stage([string]$text) {
    Write-Host "  $text" -ForegroundColor DarkGray
}

# NOTE the parameter names: `$pid` is a PowerShell AUTOMATIC read-only variable
# (the current process id). Any parameter or local named `$pid` throws
# "Cannot overwrite variable pid because it is read-only" — hence $procId here.
function Write-Kill([string]$label, [int]$procId, [string]$extra = '') {
    $script:killed++
    if ($DryRun) {
        Write-Host "  [dry] $label  pid=$procId$extra" -ForegroundColor Yellow
    }
    else {
        Write-Host "  killed  $label  pid=$procId$extra" -ForegroundColor DarkRed
    }
}

function Stop-ProcessById([int]$procId, [string]$label, [string]$extra = '') {
    # Never suicide: a mis-matched pattern must not kill the shell running us.
    if ($procId -le 0 -or $procId -eq $PID) { return }
    Write-Kill $label $procId $extra
    if ($DryRun) { return }
    # Stop-Process -Force is the direct analogue of `kill -9`: there is no
    # graceful-shutdown handshake a suspended/crashed dev process will honour.
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

function Get-ProcessTable {
    # CommandLine is null for some protected processes; drop those rather than
    # letting a null blow up the matcher.
    try {
        Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object { $_.CommandLine } |
            Select-Object ProcessId, ParentProcessId, Name, CommandLine
    }
    catch {
        # Get-CimInstance can be unavailable in constrained hosts; WMI is the
        # older spelling of the same query.
        Get-WmiObject Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine } |
            Select-Object ProcessId, ParentProcessId, Name, CommandLine
    }
}

function Test-MatchesStack([string]$commandLine) {
    foreach ($pat in $Patterns) {
        if ($commandLine -match $pat) { return $true }
    }
    return $false
}

# True when the command line explicitly points at a different project root.
# Only used to VETO a match — absence of our path is not by itself disqualifying,
# because `hamuna.exe` runs from target\debug with no project path in argv.
function Test-ForeignCheckout([string]$commandLine) {
    $hits = [regex]::Matches($commandLine, '(?i)([A-Z]:\\[^"\s]*hamuna-agent[^"\s]*)')
    foreach ($h in $hits) {
        $p = $h.Groups[1].Value
        if ($p -and -not $p.StartsWith($ProjectPathNeedle, [StringComparison]::OrdinalIgnoreCase)) {
            # Only veto if the referenced path is a plausible repo root that is
            # simply not ours (a target\debug\hamuna.exe under it).
            if ($p -match 'target[\\/](debug|release)') { return $true }
        }
    }
    return $false
}

function Get-AncestorChain([int]$startPid, [hashtable]$table, [int]$depth = 12) {
    $chain = @()
    $cur = $startPid
    for ($i = 0; $i -lt $depth; $i++) {
        $proc = $table[$cur]
        if (-not $proc) { break }
        $chain += $proc
        $parent = [int]$proc.ParentProcessId
        if ($parent -le 0 -or $parent -eq $cur) { break }
        $cur = $parent
    }
    return $chain
}

# Every transitive child of $rootPid, from the caller's pre-kill snapshot.
function Get-Descendants([int]$rootPid, [array]$all) {
    $out = @()
    $frontier = @($rootPid)
    $seen = @($rootPid)
    for ($depth = 0; $depth -lt 12 -and $frontier.Count -gt 0; $depth++) {
        $next = @()
        foreach ($p in $all) {
            $ppid = [int]$p.ParentProcessId
            if ($frontier -contains $ppid -and $seen -notcontains [int]$p.ProcessId) {
                $out += $p
                $next += [int]$p.ProcessId
                $seen += [int]$p.ProcessId
            }
        }
        $frontier = $next
    }
    return $out
}

Write-Host ''
Write-Host "Cleaning Tauri dev processes for: $ProjectDir" -ForegroundColor Cyan
if ($DryRun) { Write-Host '(DRY RUN — nothing will be killed)' -ForegroundColor Yellow }
Write-Host ''

# ONE snapshot, taken before a single kill, and every decision below reads it.
#
# Re-querying the process table after a kill is the bug this replaces, and it
# fails silently in two separate places. Windows does NOT re-parent orphans
# (unlike POSIX init), so a dead parent's children keep pointing at a pid that
# no longer exists: an ancestor walk that re-queries finds nothing at that pid,
# the chain truncates one link early, and the webview is judged an orphan and
# spared. The same re-query also loses track of a sidecar the moment the app
# dies. Matching against a pre-kill snapshot makes both lookups truthful.
$Snapshot = @(Get-ProcessTable)
$ByPid = @{}
foreach ($p in $Snapshot) { $ByPid[[int]$p.ProcessId] = $p }

# 0. Opt-in: quit the INSTALLED app, which otherwise blocks `tauri dev`.
#    This is a separate step, not part of $Patterns, precisely because the
#    default behaviour of this script is to leave the real app alone — the
#    normal case ("my dev stack is wedged") must not cost you your session.
if ($AlsoCloseInstalled) {
    Write-Stage '[0] installed app (opt-in, -AlsoCloseInstalled)'
    # "Installed" == a hamuna.exe that is NOT the cargo dev build. The dev
    # binary always lives under target\<profile>\; the shipped one does not.
    # Testing that way (rather than hardcoding %LOCALAPPDATA%) keeps this correct
    # if the app is ever installed per-user, to Program Files, or relocated.
    $installed = @($Snapshot | Where-Object {
        $_.Name -eq 'hamuna.exe' -and $_.CommandLine -notmatch 'target[\\/](debug|release)'
    })
    if ($installed.Count -eq 0) {
        Write-Stage '  not running'
    }
    foreach ($app in $installed) {
        Write-Host "  installed app: pid=$($app.ProcessId)" -ForegroundColor Red
        Write-Host "    $($app.CommandLine)" -ForegroundColor DarkGray
        if (-not $DryRun) {
            Write-Host '    this interrupts any in-flight agent turn and closes open sessions' -ForegroundColor Yellow
        }
        # Kill the app BEFORE its children. The reverse order would take out
        # every descendant in the tree, and that tree includes this dev box's
        # own tooling: the app spawns the Claude Agent SDK subprocess, whose
        # shell is the one running this script. Killing the host instead lets
        # the OS tear its own tree down, and we then clean up only the two
        # things that outlive it and keep holding resources — the sidecars and
        # the webview.
        Stop-ProcessById ([int]$app.ProcessId) 'installed app'
        foreach ($k in (Get-Descendants ([int]$app.ProcessId) $Snapshot)) {
            # --hamuna-sidecar is an explicit marker this project sets on every
            # sidecar it spawns. Matching it (rather than trusting the tree)
            # is what keeps an unrelated node process on the machine safe.
            $isSidecar = $k.CommandLine -match '--hamuna-sidecar'
            $isWebView = $k.Name -eq 'msedgewebview2.exe'
            if ($isSidecar -or $isWebView) {
                Stop-ProcessById ([int]$k.ProcessId) 'installed child' "  $($k.Name)"
            }
        }
    }
    if (-not $DryRun -and $installed.Count -gt 0) {
        # Give the OS a beat to release the single-instance mutex before the
        # caller launches the dev binary. Without this, `tauri dev` can race the
        # teardown and lose the lock contest again — which looks like the same
        # freeze, and sends you hunting for a cause that was already fixed.
        Start-Sleep -Milliseconds 800
    }
}

# 1. Terminate the running stack.
#    The .sh has a separate pre-pass for stopped (T) and zombie (Z) processes.
#    There is no direct Windows analogue: a suspended POSIX process needs
#    SIGCONT/SIGKILL, whereas a wedged Windows process is reliably reaped by
#    Stop-Process -Force, and Windows has no zombie state to reap. Matching
#    against the live process table covers both cases in one pass, so the
#    pre-pass is intentionally omitted rather than faked.
Write-Stage '[1/3] running stack'
$stack = $Snapshot | Where-Object { Test-MatchesStack $_.CommandLine }
# Children first: killing a parent re-parents its children, which would
# otherwise escape the parent-chain check used in step 2.
$stack = $stack | Sort-Object { -($_.CommandLine.Length) }
foreach ($p in $stack) {
    if (Test-ForeignCheckout $p.CommandLine) {
        Write-Stage "  skip (other checkout): pid=$($p.ProcessId) $($p.Name)"
        continue
    }
    Stop-ProcessById ([int]$p.ProcessId) $p.Name "  $($p.CommandLine.Substring(0, [Math]::Min(90, $p.CommandLine.Length)))"
}

# 2. Orphan WebView2 sub-processes — the Rust/app side is already dead but the
#    webview runtime is still alive holding localhost:5173. Without this the
#    port stays held even though the app that owned it is gone.
#    We only kill webviews whose ancestor chain reaches our stack, because
#    msedgewebview2.exe is shared with Teams / Outlook / every other Tauri and
#    Electron app on the box — killing them all would be collateral damage.
Write-Stage '[2/3] orphan WebView2 sub-processes'
if ($KeepWebView) {
    Write-Stage '  -KeepWebView set, skipping'
}
else {
    $webviews = @($Snapshot | Where-Object { $_.Name -eq 'msedgewebview2.exe' })
    if ($webviews.Count -eq 0) {
        Write-Stage '  none found'
    }
    foreach ($wv in $webviews) {
        # Walk the PRE-KILL snapshot: step 1 has already killed the dev app by
        # now, and a live query would break the chain at that dead pid and spare
        # exactly the webview this step exists to remove.
        $chain = Get-AncestorChain ([int]$wv.ProcessId) $ByPid
        $ours = $chain | Where-Object { Test-MatchesStack $_.CommandLine }
        if ($ours) {
            $root = ($ours | Select-Object -First 1)
            Stop-ProcessById ([int]$wv.ProcessId) 'msedgewebview2 (orphan)' "  ancestor=$($root.Name):$($root.ProcessId)"
        }
    }
}

# 3. Free the dev ports. The owning process should already be dead; this
#    catches TIME_WAIT and any fd holder we did not match above.
Write-Stage '[3/3] dev ports'
foreach ($port in $PortsToClean) {
    $holders = @()
    try {
        $holders = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
    }
    catch {
        # Older Windows / constrained host: netstat parses the same truth.
        $lines = & netstat.exe -ano -p TCP 2>$null | Select-String ":$port\s+.*LISTENING"
        $holders = $lines | ForEach-Object {
            ($_ -split '\s+')[-1]
        } | Where-Object { $_ -match '^\d+$' } | Select-Object -Unique
    }
    foreach ($h in $holders) {
        Stop-ProcessById ([int]$h) "port=$port holder"
    }
}

# 4. Report the state we actually left behind.
Write-Host ''
Write-Host '=== After cleanup ===' -ForegroundColor Cyan
$remaining = @()

$stillThere = Get-ProcessTable | Where-Object {
    (Test-MatchesStack $_.CommandLine) -and -not (Test-ForeignCheckout $_.CommandLine)
}
foreach ($p in $stillThere) {
    Write-Host "  still alive: pid=$($p.ProcessId) $($p.Name)  $($p.CommandLine)" -ForegroundColor Red
    $remaining += $p
}

foreach ($port in $PortsToClean) {
    $busy = $null
    try {
        $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    }
    catch { $busy = $null }
    if ($busy) {
        Write-Host "  port still held: $port  (pid $($busy.OwningProcess -join ', '))" -ForegroundColor Red
        $remaining += $port
    }
}

# The single-instance lock is the one failure that produces NO other symptom:
# no port held, no orphan process, no error — `tauri dev` just silently dies
# before .setup(). Report it explicitly rather than printing a reassuring "OK"
# that is actually the exact state that makes the next launch fail.
$lockHolder = @(Get-ProcessTable | Where-Object {
    $_.Name -eq 'hamuna.exe' -and $_.CommandLine -notmatch 'target[\\/](debug|release)'
})
if ($lockHolder.Count -gt 0) {
    Write-Host "  single-instance lock HELD by: pid=$($lockHolder.ProcessId -join ', ') (installed app)" -ForegroundColor Red
    Write-Host '    `tauri dev` will exit before .setup() until this is closed.' -ForegroundColor Red
    Write-Host '    Re-run with -AlsoCloseInstalled, or exit it from the tray.' -ForegroundColor Yellow
    $remaining += 'single-instance'
}
elseif ($AlsoCloseInstalled) {
    Write-Host '  single-instance lock: released' -ForegroundColor Green
}

Write-Host ''
if ($remaining.Count -eq 0) {
    Write-Host "OK - clean. $($script:killed) process(es) killed, port(s) $($PortsToClean -join ', ') free." -ForegroundColor Green
    Write-Host ''
    Write-Host "Next: cd `"$ProjectDir`" ; npm run tauri:dev" -ForegroundColor Gray
}
else {
    Write-Host "WARN - $($remaining.Count) stuck item(s) remain" -ForegroundColor Yellow
    Write-Host '  Inspect: Get-CimInstance Win32_Process | ? { $_.CommandLine -match "tauri|vite|hamuna" }' -ForegroundColor Gray
    Write-Host "  Ports:   Get-NetTCPConnection -LocalPort $($PortsToClean -join ',') -State Listen" -ForegroundColor Gray
    if (-not $DryRun) {
        Write-Host '  If cargo still cannot overwrite target\debug\hamuna.exe, a' -ForegroundColor Gray
        Write-Host '  virus scanner or the running app still holds the handle — reboot, or' -ForegroundColor Gray
        Write-Host '  stop the app from the tray, then re-run.' -ForegroundColor Gray
    }
}
