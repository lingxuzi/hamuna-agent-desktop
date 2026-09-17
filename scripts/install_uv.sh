#!/usr/bin/env bash
# Install uv into the python-build-standalone staged under
# src-tauri/resources/python-<arch>/ via `python -m pip install uv==<pin>`.
#
# Why `python -m pip install uv` instead of pip-installing a standalone uv binary:
#   - maturin 编译的 uv 在 macOS 上依赖 site-packages 上下文 (动态加载 _uv.so);
#     直接 exec uv 二进制会 `Library not loaded`. windows 端
#     `runtime.ts::findPipInstalledUvxScriptsDir` 的 comment 明确这一点.
#   - caller's `python -m uv` 入口天然正确, 无需 wrapper script
#
# Why pin uv 0.11.33 (与 windows release 同步):
#   - windows NSIS §UvxFallback + uvx-path-setup.ps1 都 hard-pin 0.11.33
#   - 跨平台心智一致: 升级 uv 必须 windows + macOS 同步 bump, 单一数字源
#
# bump 时改 UV_PIN; expect wheel 在 PyPI 上 stable.

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "usage: $0 <arm64|x64>" >&2
    exit 1
fi

ARCH="$1"
case "$ARCH" in
    arm64|x64) ;;
    *) echo "error: arch must be arm64 or x64, got: $ARCH" >&2; exit 1 ;;
esac

# 与 windows installer.nsi §UvxFallback 同 pin. bump 时同步改两边.
UV_PIN="0.11.33"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="${PROJECT_DIR}/src-tauri/resources/python-${ARCH}/bin/python3"

if [ ! -x "$PYTHON_BIN" ]; then
    echo "error: ${PYTHON_BIN} not found. Run download_python_mac.sh ${ARCH} first." >&2
    exit 1
fi

# Astral PyPI 镜像 (windows 端 uvx-path-setup.ps1 同样用清华镜像).
# macOS CI runner 在美区, 这里设 mirror 不影响 CI; 本地开发者 + 中国用户受益.
PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple/}"
UV_INDEX_URL="${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple/}"

echo ">>> [install_uv] upgrading pip"
"$PYTHON_BIN" -m pip install --upgrade pip --quiet --no-warn-script-location \
    --index-url "$PIP_INDEX_URL" >/dev/null

echo ">>> [install_uv] installing uv==${UV_PIN} into python-${ARCH}"
"$PYTHON_BIN" -m pip install "uv==${UV_PIN}" --quiet --no-warn-script-location \
    --index-url "$PIP_INDEX_URL" >/dev/null

# 验证 `python -m uv --version` 报对的 pin.
# Why 不是 `uv --version`: maturin uv 在 macOS 上 exec 时找不到 site-packages;
# `python -m uv` 通过 module loader 拿到正确上下文.
ACTUAL_VERSION="$("$PYTHON_BIN" -m uv --version 2>&1 | head -n1 | awk '{print $2}')"
if [ "$ACTUAL_VERSION" != "$UV_PIN" ]; then
    echo "error: uv version pin failed: expected ${UV_PIN}, got ${ACTUAL_VERSION:-empty}" >&2
    exit 1
fi

echo ">>> [install_uv] uv ${UV_PIN} installed into python-${ARCH} (verified via python -m uv)"
