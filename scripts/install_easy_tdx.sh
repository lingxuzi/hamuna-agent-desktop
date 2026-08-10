#!/bin/bash
# Install (or refresh) the vendored easy_tdx package into the user Python env
# so the `easy-tdx-mcp` console script becomes available globally and
# extended_buildin_mcp/mcp.json can launch it as a bare command.
#
# Why this script exists
# ----------------------
# easy_tdx lives at <repo>/stock-sources/easy_tdx/ — a vendored source tree
# that ships with HamunaAgent, not a PyPI release. Sidecar and the MCP loader
# run on the end user's machine at app start, so easy_tdx has to be present
# in some on-disk Python environment that `python -m easy_tdx.mcp` (or the
# `easy-tdx-mcp` console script) can resolve. Two options were considered:
#
#   A. uvx --from ./stock-sources/easy_tdx --with mcp easy-tdx-mcp
#      (no install, but every MCP startup re-resolves the project + transitives,
#       which inflates cold-start by ~5–10s and breaks offline-only builds.)
#
#   B. Pre-install into the user's Python via pip in this script.
#      (idempotent, <1s on subsequent runs thanks to the marker file; the
#       MCP entry shrinks to a bare `easy-tdx-mcp` invocation.)
#
# We pick B. This mirrors how download_uv.ps1 / download_python.ps1 stage
# their respective runtimes — one-time cost during install/setup, marker
# short-circuit afterwards.
#
# Behaviour
#   - If marker file (`.easy-tdx-installed-<version>`) exists and `easy-tdx-mcp`
#     is on PATH, exit 0 immediately (no network).
#   - Otherwise: `pip install -e ./stock-sources/easy_tdx[mcp]`
#     (editable install so dev edits to the vendored source reflect immediately
#     without re-running this script; the [mcp] extra pulls in the mcp SDK.)
#   - Write the marker file so reruns are noops.
#
# Flags
#   --force       Re-install even if the marker says it's current.
#   --no-marker   Don't write the marker (debugging).
#   --check       Just verify the install; non-zero exit if broken.
#
# Failure semantics: soft-fail with a yellow warning. Easy_tdx isn't load-bearing
# for the rest of HamunaAgent — if pip is missing or the network is down, the
# easy-tdx MCP entry will fail at startup and the agent gracefully skips it.
# We follow the same convention as download_cuse.sh / download_uv.ps1.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${PROJECT_DIR}/stock-sources/easy_tdx"

FORCE=0
WRITE_MARKER=1
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    --no-marker) WRITE_MARKER=0 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ── Resolve version (pyproject.toml:: [project].version) ────────────────────
VERSION=$(grep -E '^version = ' "${SRC_DIR}/pyproject.toml" | head -1 \
          | sed -E 's/^version = ["'\'']([^"'\'']+)["'\''].*/\1/')
if [ -z "${VERSION}" ]; then
  echo "[easy-tdx] could not parse version from ${SRC_DIR}/pyproject.toml" >&2
  exit 1
fi

MARKER_DIR="${PROJECT_DIR}/src-tauri/resources"
MARKER="${MARKER_DIR}/.easy-tdx-installed-${VERSION}"
CONSOLE_SCRIPT="easy-tdx-mcp"

# Guard: console script 在 PATH 上可能是 hollow install（src/easy_tdx 包树缺失时
# pip -e 产出空包，script 注册了但 import easy_tdx.mcp 失败）。校验真能 import。
import_check() {
  if command -v python3 >/dev/null 2>&1; then
    if ! python3 -c "import easy_tdx.mcp" >/dev/null 2>&1; then
      echo "[easy-tdx] WARNING: 'import easy_tdx.mcp' FAILED — hollow install detected" >&2
      return 1
    fi
  fi
  return 0
}

# ── Preflight ──────────────────────────────────────────────────────────────

# --check path: just verify the CLI is importable + on PATH
if [ "${CHECK_ONLY}" -eq 1 ]; then
  if command -v "${CONSOLE_SCRIPT}" >/dev/null 2>&1; then
    if import_check; then
      echo "[easy-tdx] ${CONSOLE_SCRIPT} OK ($(command -v "${CONSOLE_SCRIPT}"))"
      exit 0
    fi
    echo "[easy-tdx] ${CONSOLE_SCRIPT} found but 'import easy_tdx.mcp' FAILED (hollow install) — re-run: $0 --force" >&2
    exit 1
  fi
  echo "[easy-tdx] ${CONSOLE_SCRIPT} NOT FOUND on PATH" >&2
  exit 1
fi

# Idempotent short-circuit: marker present + script on PATH + import OK
if [ "${FORCE}" -ne 1 ] && [ -f "${MARKER}" ] && command -v "${CONSOLE_SCRIPT}" >/dev/null 2>&1 && import_check; then
  echo "[easy-tdx] ${VERSION} already installed (marker ${MARKER}, pass --force to reinstall)"
  exit 0
fi

# Pick the right Python. We want the same Python the Sidecar uses at runtime:
# the bundled Node.js doesn't help, but `python3` from PATH or python.org's
# installer (used on Windows by download_python.ps1) is good enough. uv
# ships its own Python for uvx-style invocations, but for `pip install -e`
# we need a real user-owned environment so the console script lands in
# `~/Library/Python/<ver>/bin` / `~/.local/bin`. Verify python3 first —
# without it, `pip` as a bare command may resolve to a stale system wrapper
# pointing at a Python that no longer exists (e.g. after python.org installer
# upgrade). Refuse early with a single hint so the caller doesn't mistake a
# no-op for "already installed".
if ! command -v python3 >/dev/null 2>&1; then
  echo "[easy-tdx] WARNING: python3 not on PATH; cannot install easy_tdx." >&2
  echo "[easy-tdx]          Install Python 3.10+ then re-run: $0" >&2
  echo "[easy-tdx]          easy-tdx MCP will be unavailable at runtime." >&2
  exit 0   # soft-fail
fi

PIP=""
if command -v pip3 >/dev/null 2>&1; then
  PIP="pip3"
elif command -v pip >/dev/null 2>&1; then
  PIP="pip"
elif command -v uv >/dev/null 2>&1; then
  # Fallback to `uv pip install --system` if no pip is present
  PIP="uv-pip"
fi

if [ -z "${PIP}" ]; then
  echo "[easy-tdx] WARNING: no pip / uv on PATH; cannot install easy_tdx." >&2
  echo "[easy-tdx]          easy-tdx MCP will be unavailable at runtime." >&2
  echo "[easy-tdx]          Install pip / uv then re-run: $0" >&2
  exit 0   # soft-fail
fi

if [ ! -d "${SRC_DIR}" ]; then
  echo "[easy-tdx] WARNING: source dir missing: ${SRC_DIR}" >&2
  echo "[easy-tdx]          Was the stock-sources submodule not cloned?" >&2
  exit 0   # soft-fail
fi

# easy_tdx 的 pyproject.toml::[tool.hatch.build.targets.wheel] 把
# ``web-ui/dist`` force-include 到 ``easy_tdx/web/dist``。dist 不存在时
# hatchling 抛 ``FileNotFoundError: Forced include not found``，editable install
# 整条 fail。这是 web 端 React 前端的 build 产物（CI 跑前先 npm run build），
# 与 easy_tdx 主入口 / MCP 完全无关 — MCP 只用 easy_tdx.mcp 下的代码。
#
# 兜底：探测一下 dist 是否存在；不存在就建一个占位 index.html，让 hatchling
# 能解析 force-include。占位文件不影响 MCP 路径（sys.modules 走 src/）。
WEB_DIST="${SRC_DIR}/web-ui/dist"
if [ ! -d "${WEB_DIST}" ]; then
  echo "[easy-tdx] web-ui/dist missing; creating stub so hatchling force-include resolves" >&2
  mkdir -p "${WEB_DIST}"
  printf '<!-- easy_tdx web-ui stub (created by install_easy_tdx.sh; real build via npm run build in web-ui/) -->\n' \
    > "${WEB_DIST}/index.html"
fi

# ── Install ────────────────────────────────────────────────────────────────

echo "[easy-tdx] installing easy_tdx ${VERSION} from ${SRC_DIR} (editable + [mcp])..."

# 国内镜像（清华）比 pypi.org / mirrors.aliyun.com 稳定得多，字节流截断少。
PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"

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
#       仍由 pip 解析；同样走清华源 + retries + timeout。失败时回退
#       build-isolation 给一次机会（少数机器已经手动装过 hatchling 或 wheel
#       缓存里有了）。
set +e
echo "[easy-tdx] step 1/2: ensuring hatchling is available as build backend"
case "${PIP}" in
  pip3|pip)
    ${PIP} install --quiet --index-url "${PIP_INDEX_URL}" --retries 5 --timeout 60 hatchling 2>&1 | tail -10
    hatchling_rc=$?
    ;;
  uv-pip)
    uv pip install --system --index-url "${PIP_INDEX_URL}" hatchling 2>&1 | tail -10
    hatchling_rc=$?
    ;;
esac

if [ "${hatchling_rc}" -ne 0 ]; then
  echo "[easy-tdx] WARNING: hatchling install exited ${hatchling_rc}; falling back to build-isolation" >&2
else
  # 验证 hatchling 真的 importable（wheel 装下来不一定就 import 通）
  case "${PIP}" in
    pip3|pip)
      ${PIP} show hatchling 2>&1 | grep -q '^Name: hatchling' && echo "[easy-tdx] hatchling OK" || echo "[easy-tdx] WARNING: hatchling not detected; will fall back" >&2
      ;;
    uv-pip)
      uv pip show hatchling 2>&1 | grep -q '^Name: hatchling' && echo "[easy-tdx] hatchling OK" || echo "[easy-tdx] WARNING: hatchling not detected; will fall back" >&2
      ;;
  esac
fi

echo "[easy-tdx] step 2/2: pip install -e ${SRC_DIR}[mcp] (no-build-isolation)"
case "${PIP}" in
  pip3|pip)
    ${PIP} install --quiet --index-url "${PIP_INDEX_URL}" --retries 5 --timeout 60 --no-build-isolation -e "${SRC_DIR}[mcp]" 2>&1 | tail -20
    rc=$?
    ;;
  uv-pip)
    # uv 默认从当前 env 找 build backend，不需要 --no-build-isolation。
    uv pip install --system --index-url "${PIP_INDEX_URL}" -e "${SRC_DIR}[mcp]" 2>&1 | tail -20
    rc=$?
    ;;
esac

# Fallback: --no-build-isolation 失败 → 用 build-isolation 再试一次（少数机器
# 已经手动装过 hatchling 或 wheel 缓存里有了）。
if [ "${rc}" -ne 0 ]; then
  echo "[easy-tdx] no-build-isolation install exited ${rc}; retrying with build-isolation" >&2
  case "${PIP}" in
    pip3|pip)
      ${PIP} install --quiet --index-url "${PIP_INDEX_URL}" --retries 5 --timeout 60 -e "${SRC_DIR}[mcp]" 2>&1 | tail -20
      rc=$?
      ;;
    uv-pip)
      uv pip install --system --index-url "${PIP_INDEX_URL}" -e "${SRC_DIR}[mcp]" 2>&1 | tail -20
      rc=$?
      ;;
  esac
fi
set -e

if [ "${rc}" -ne 0 ]; then
  echo "[easy-tdx] WARNING: install exited ${rc}; easy-tdx MCP may be broken at runtime." >&2
  echo "[easy-tdx]          Re-run after fixing pip/network: $0 --force" >&2
  exit 0   # soft-fail (setup should not be blocked)
fi

# Write marker (atomic write via tmp + mv)
if [ "${WRITE_MARKER}" -eq 1 ]; then
  mkdir -p "${MARKER_DIR}"
  TMP="${MARKER}.tmp.$$"
  echo "${VERSION}" > "${TMP}"
  mv "${TMP}" "${MARKER}"
fi

# Verify install
if command -v "${CONSOLE_SCRIPT}" >/dev/null 2>&1; then
  echo "[easy-tdx] OK — ${CONSOLE_SCRIPT} available at $(command -v "${CONSOLE_SCRIPT}")"
else
  echo "[easy-tdx] WARNING: install finished but ${CONSOLE_SCRIPT} not on PATH" >&2
  echo "[easy-tdx]          Check that pip's script dir (e.g. ~/.local/bin) is on PATH" >&2
fi