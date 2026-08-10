#Requires -Version 5.1
<#
.SYNOPSIS
    Install (or refresh) the vendored easy_tdx package into the user Python
    environment so the `easy-tdx-mcp` console script is available on PATH
    and the extended_buildin_mcp/mcp.json entry can launch it bare.

.DESCRIPTION
    Mirror of scripts/install_easy_tdx.sh for Windows. Same marker-based
    idempotency, same soft-fail semantics.

    Why a pre-install step (not uvx --from on each MCP spawn):
      - uvx re-resolves the project + transitives per spawn (~5–10s hit).
      - Breaks offline-only builds where the PyPI cache isn't primed.
      - Pre-installing once turns the MCP entry into a bare
        `easy-tdx-mcp` invocation, just like download_uv.ps1 stages uvx.exe
        and download_python.ps1 stages the bundled Python.

.EXAMPLE
    .\scripts\install_easy_tdx.ps1              # idempotent
    .\scripts\install_easy_tdx.ps1 -Force       # reinstall
    .\scripts\install_easy_tdx.ps1 -Check       # verify, exit 1 on broken
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$NoMarker,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir  = Split-Path -Parent $ScriptDir
$SrcDir      = Join-Path $ProjectDir "stock-sources\easy_tdx"
$MarkerDir   = Join-Path $ProjectDir "src-tauri\resources"
$ConsoleScript = "easy-tdx-mcp"

# Guard: console script 在 PATH 上可能是 hollow install（src/easy_tdx 包树缺失时
# pip -e 产出空包，script 注册了但 import easy_tdx.mcp 失败）。校验真能 import。
function Test-EasyTdxImport {
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
    if (-not $py) { return $true }   # 无 python → 无法 import 校验，不误伤
    # 临时切 EAP=Continue：native command 写 stderr + EAP=Stop 会触发 RemoteException，
    # 把 Python traceback 泄漏到调用方控制台、干扰脚本诊断。隔离在函数内。
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $py.Source -c "import easy_tdx.mcp" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $prevPref
    }
}

function Write-Info  { param($msg) Write-Host "[easy-tdx] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "[easy-tdx] $msg" -ForegroundColor Green }
function Write-Warn2 { param($msg) Write-Host "[easy-tdx] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[easy-tdx] $msg" -ForegroundColor Red }

# ── Resolve version from pyproject.toml ──────────────────────────────────────

if (-not (Test-Path $SrcDir)) {
    Write-Warn2 "source dir missing: $SrcDir (was the stock-sources submodule not cloned?)"
    exit 0   # soft-fail
}

# easy_tdx 的 pyproject.toml::[tool.hatch.build.targets.wheel] 把
# ``web-ui/dist`` force-include 到 ``easy_tdx/web/dist``。dist 不存在时
# hatchling 抛 ``FileNotFoundError: Forced include not found``，editable install
# 整条 fail。这是 web 端 React 前端的 build 产物（CI 跑前先 npm run build），
# 与 easy_tdx 主入口 / MCP 完全无关 — MCP 只用 easy_tdx.mcp 下的代码。
#
# 兜底：探测一下 dist 是否存在；不存在就建一个占位 index.html，让 hatchling
# 能解析 force-include。占位文件不影响 MCP 路径（sys.modules 走 src/）。
$WebDist = Join-Path $SrcDir "web-ui\dist"
if (-not (Test-Path $WebDist)) {
    Write-Warn2 "web-ui\dist missing; creating stub so hatchling force-include resolves"
    New-Item -ItemType Directory -Path $WebDist -Force | Out-Null
    Set-Content -Path (Join-Path $WebDist "index.html") -Value @'
<!-- easy_tdx web-ui stub (created by install_easy_tdx.ps1; real build via npm run build in web-ui/) -->
'@
}

$versionLine = Select-String -Path (Join-Path $SrcDir "pyproject.toml") `
                             -Pattern '^version = "(.+)"$' `
                             | Select-Object -First 1
if (-not $versionLine) {
    Write-Err "could not parse version from $SrcDir\pyproject.toml"
    exit 1
}
$Version = $versionLine.Matches[0].Groups[1].Value
$Marker  = Join-Path $MarkerDir ".easy-tdx-installed-$Version"

# ── --check path ────────────────────────────────────────────────────────────

if ($Check) {
    $cmd = Get-Command $ConsoleScript -ErrorAction SilentlyContinue
    if ($cmd -and (Test-EasyTdxImport)) {
        Write-Ok "$ConsoleScript OK ($($cmd.Source))"
        exit 0
    }
    if (-not $cmd) {
        Write-Err "$ConsoleScript NOT FOUND on PATH"
        exit 1
    }
    Write-Err "$ConsoleScript found but 'import easy_tdx.mcp' FAILED (hollow install) — re-run: $PSCommandPath -Force"
    exit 1
}

# ── Idempotent short-circuit ────────────────────────────────────────────────

if (-not $Force -and (Test-Path $Marker)) {
    $cmd = Get-Command $ConsoleScript -ErrorAction SilentlyContinue
    if ($cmd -and (Test-EasyTdxImport)) {
        Write-Ok "$Version already installed (marker $Marker, pass -Force to reinstall)"
        exit 0
    }
    if (-not $cmd) {
        Write-Warn2 "marker says $Version but $ConsoleScript not on PATH — reinstalling"
    } else {
        Write-Warn2 "marker says $Version but 'import easy_tdx.mcp' FAILED (hollow install) — reinstalling"
    }
}

# ── Pick a pip ──────────────────────────────────────────────────────────────

# First verify Python itself is on PATH. Windows embeddable Python ships without
# pip and without python on PATH unless download_python.ps1 (or equivalent) has
# staged it. Without python we cannot even import-check, and `pip` as a bare
# command may resolve to a stale system wrapper that crashes on a different
# Python's site-packages. Refuse early with a clear hint so the caller doesn't
# mistake a no-op for "already installed".
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) { $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $pythonCmd) {
    Write-Warn2 "python / python3 not on PATH; cannot install easy_tdx."
    Write-Warn2 "         Run download_python.ps1 first, then re-run: $PSCommandPath"
    Write-Warn2 "         easy-tdx MCP will be unavailable at runtime."
    exit 0   # soft-fail
}

$pipCmd = $null
foreach ($name in @('pip3', 'pip')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { $pipCmd = $name; break }
}
if (-not $pipCmd) {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) { $pipCmd = 'uv-pip' }
}

if (-not $pipCmd) {
    Write-Warn2 "no pip / uv on PATH; cannot install easy_tdx."
    Write-Warn2 "         easy-tdx MCP will be unavailable at runtime."
    Write-Warn2 "         Install pip / uv then re-run: $PSCommandPath"
    exit 0   # soft-fail
}

# ── Install ─────────────────────────────────────────────────────────────────

Write-Info "installing easy_tdx $Version from $SrcDir (editable + [mcp])..."

# 国内镜像（清华）比 pypi.org / mirrors.aliyun.com 稳定得多，字节流截断少。
$IndexUrl = if ($env:PIP_INDEX_URL) { $env:PIP_INDEX_URL } else { 'https://pypi.tuna.tsinghua.edu.cn/simple' }
# PS 5.1 把空格分隔的字符串当成单个 argv；array splat `@X` 在 switch-case
# 块里又被 PS 解析成 here-string sentinel。最稳的做法是不用 splat，直接把
# 选项写成 8 个独立 token：
#   --quiet --index-url <url> --retries 5 --timeout 60

# 两步走：
#   (1) pip install hatchling — 把 PEP 517 build backend 装进主 site-packages。
#       easy_tdx 的 pyproject.toml 强制 hatchling 做 build backend；hatchling
#       不在主 site-packages 时 `pip install -e` 的 build-isolation 阶段会去
#       临时 venv 拉，临时 venv 里拉 hatchling wheel 字节流经常截断（pypi.org
#       / aliyun / 清华都中招过），最后报模糊的
#       ``BackendUnavailable: Cannot import 'hatchling.build'``，--retries 5 也
#       不吃。
#   (2) pip install -e ...[mcp] --no-build-isolation — 此时 hatchling 已就位，
#       不再需要临时 venv。easy_tdx 自身的运行时依赖（pandas/tzdata/click）
#       仍由 pip 解析；同样走清华源 + retries + timeout。
$tmpLog = Join-Path ([System.IO.Path]::GetTempPath()) "easy-tdx-install-$PID.log"
try {
    # 临时改 ErrorActionPreference = 'Continue'：pip 即使返回非零退出码，PS
    # 也不会把 stderr 包成 RemoteException 抛错（$ErrorActionPreference='Stop'
    # 默认下，外部命令 stderr 一行就会让整个脚本终止，$LASTEXITCODE 没机会
    # 被读）。子 scope 退出前还原回 'Stop'。
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    # Step 1: 装 hatchling 到主 site-packages。如果已经在则 --retries 5 不会
    # 触发重新下载；缺则触发一次 wheel 拉取，--retries 5 + 清华源吃 IncompleteRead。
    Write-Info "step 1/2: ensuring hatchling is available as build backend"
    $hatchlingLog = Join-Path ([System.IO.Path]::GetTempPath()) "easy-tdx-hatchling-$PID.log"
    switch ($pipCmd) {
        'pip3'   { & pip3 install --quiet --index-url $IndexUrl --retries 5 --timeout 60 hatchling 2>&1 | Out-File -FilePath $hatchlingLog -Encoding utf8 }
        'pip'    { & pip  install --quiet --index-url $IndexUrl --retries 5 --timeout 60 hatchling 2>&1 | Out-File -FilePath $hatchlingLog -Encoding utf8 }
        'uv-pip' { & uv pip install --system --index-url $IndexUrl hatchling 2>&1 | Out-File -FilePath $hatchlingLog -Encoding utf8 }
    }
    $hatchlingRc = $LASTEXITCODE
    if (Test-Path $hatchlingLog) { Remove-Item $hatchlingLog -Force -ErrorAction SilentlyContinue }
    if ($hatchlingRc -ne 0) {
        Write-Warn2 "hatchling install exited $hatchlingRc; falling back to build-isolation"
        # 不要 exit；让 step 2 自己再试一次 build-isolation（少数机器已经手动
        # 装过 hatchling 或 wheel 缓存里有了）。
    } else {
        # Verify hatchling actually importable — wheel 装下来了不一定 import 通。
        $verifyLog = Join-Path ([System.IO.Path]::GetTempPath()) "easy-tdx-verify-$PID.log"
        switch ($pipCmd) {
            'pip3'   { & pip3 show hatchling 2>&1 | Out-File -FilePath $verifyLog -Encoding utf8 }
            'pip'    { & pip  show hatchling 2>&1 | Out-File -FilePath $verifyLog -Encoding utf8 }
            'uv-pip' { & uv pip show hatchling 2>&1 | Out-File -FilePath $verifyLog -Encoding utf8 }
        }
        $verifyOut = (Get-Content $verifyLog -Raw -ErrorAction SilentlyContinue)
        if (Test-Path $verifyLog) { Remove-Item $verifyLog -Force -ErrorAction SilentlyContinue }
        if ($verifyOut -match 'Name:\s*hatchling') {
            Write-Ok "hatchling present"
        } else {
            Write-Warn2 "hatchling not detected after install; will fall back to build-isolation"
        }
    }

    # Step 2: 装 easy_tdx（editable + [mcp]）。先尝试 --no-build-isolation
    # （用主 site-packages 里的 hatchling）；失败回退 build-isolation。
    Write-Info "step 2/2: pip install -e $SrcDir[mcp] (no-build-isolation)"
    switch ($pipCmd) {
        'pip3'   { & pip3 install --quiet --index-url $IndexUrl --retries 5 --timeout 60 --no-build-isolation -e "$SrcDir[mcp]" 2>&1 | Out-File -FilePath $tmpLog -Encoding utf8 }
        'pip'    { & pip  install --quiet --index-url $IndexUrl --retries 5 --timeout 60 --no-build-isolation -e "$SrcDir[mcp]" 2>&1 | Out-File -FilePath $tmpLog -Encoding utf8 }
        'uv-pip' { & uv pip install --system --index-url $IndexUrl -e "$SrcDir[mcp]" 2>&1 | Out-File -FilePath $tmpLog -Encoding utf8 }
    }
    $rc = $LASTEXITCODE

    # Fallback: --no-build-isolation 失败 → 用 build-isolation 再试一次。
    if ($rc -ne 0) {
        Write-Warn2 "no-build-isolation install exited $rc; retrying with build-isolation"
        switch ($pipCmd) {
            'pip3'   { & pip3 install --quiet --index-url $IndexUrl --retries 5 --timeout 60 -e "$SrcDir[mcp]" 2>&1 | Out-File -FilePath $tmpLog -Encoding utf8 }
            'pip'    { & pip  install --quiet --index-url $IndexUrl --retries 5 --timeout 60 -e "$SrcDir[mcp]" 2>&1 | Out-File -FilePath $tmpLog -Encoding utf8 }
            'uv-pip' { & uv pip install --system --index-url $IndexUrl -e "$SrcDir[mcp]" 2>&1 | Out-File -FilePath $tmpLog -Encoding utf8 }
        }
        $rc = $LASTEXITCODE
    }

    $ErrorActionPreference = $prevPref
    if ($rc -ne 0) {
        Write-Warn2 "install exited $rc; tail of log:"
        Get-Content $tmpLog -Tail 20 | ForEach-Object { Write-Host "  $_" }
        Write-Warn2 "easy-tdx MCP may be broken at runtime; re-run after fixing pip/network:"
        Write-Warn2 "  $PSCommandPath -Force"
        exit 0   # soft-fail
    }
} finally {
    if (Test-Path $tmpLog) { Remove-Item $tmpLog -Force -ErrorAction SilentlyContinue }
}

# ── Marker (atomic write) ────────────────────────────────────────────────────

if (-not $NoMarker) {
    if (-not (Test-Path $MarkerDir)) { New-Item -ItemType Directory -Path $MarkerDir -Force | Out-Null }
    $tmp = "$Marker.tmp.$PID"
    Set-Content -Path $tmp -Value $Version -NoNewline
    Move-Item -Path $tmp -Destination $Marker -Force
}

# Verify
$cmd = Get-Command $ConsoleScript -ErrorAction SilentlyContinue
if ($cmd) {
    Write-Ok "$ConsoleScript available at $($cmd.Source)"
} else {
    Write-Warn2 "install finished but $ConsoleScript not on PATH"
    Write-Warn2 "         Check that pip's Scripts dir (e.g. $env:USERPROFILE\AppData\Roaming\Python\Python312\Scripts) is on PATH"
}