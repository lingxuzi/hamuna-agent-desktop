#!/usr/bin/env bash
# Stage agnes-video-25-mcp (PyPI MCP server) into
# src-tauri/resources/hosted-mcps/agnes-video-25-mcp-<arch>/ using uv pip
# install --target. After this, `bin/agnes-video-25-mcp` is a runnable
# Mach-O (pip-installed console script) that multimedia-creator MCP spawns
# via PATH lookup.
#
# Why `pip install --target` (vs wheel prefetch like windows §HostedMcpPrefetch):
#   - pip install 同时拉 wheel + 解析 transitive deps + 生成 bin/ entry script,
#     一步到位. windows 端 hosted-mcp-prefetch.ps1 也是 `pip download`,
#     区别只是 macOS 不需要 download + 解压两步, 直接 --target install 即可.
#   - 不需要 wrapper shell script: pip 的 console_scripts 已经生成可执行
#     CLI entry point, user 拍板「pip 安装后可以直接执行这个 cli」.
#
# Why read pin from hosted_mcps/agnes-video-25/pyproject.toml (not mcp.json):
#   - 单源事实 (windows NSIS 同款): pyproject.toml::version 是 upstream package
#     version, mcp.json 不持有 pin (用户拍板 mcp.json 维持 bare `command`).
#   - bump-on-commit.mjs::AGNES_MCP auto-bump 改这个文件 + PyPI 比对.
#
# bump flow:
#   1. 上游发 PyPI agnes-video-25-mcp==<new>
#   2. bump-on-commit.mjs 拉 PyPI latest, mismatch 时 patch pyproject.toml version
#   3. 本脚本下次跑拉新 wheel 进 Resources/

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="${PROJECT_DIR}/src-tauri/resources/python-${ARCH}/bin/python3"
PYPROJECT="${PROJECT_DIR}/hosted_mcps/agnes-video-25/pyproject.toml"
TARGET_DIR="${PROJECT_DIR}/src-tauri/resources/hosted-mcps/agnes-video-25-mcp-${ARCH}"
CLI_BIN="${TARGET_DIR}/bin/agnes-video-25-mcp"

if [ ! -x "$PYTHON_BIN" ]; then
    echo "error: ${PYTHON_BIN} not found. Run download_python_mac.sh ${ARCH} + install_uv.sh ${ARCH} first." >&2
    exit 1
fi

if [ ! -f "$PYPROJECT" ]; then
    echo "error: ${PYPROJECT} not found." >&2
    exit 1
fi

# 解析 pyproject.toml 的 version 字段. 用 node 因为 node 在 macOS 上一定可用
# (npm 自带) 且语法稳定; 避免引入新 python dep 来解析 TOML.
PIN_VERSION="$(node -e '
const fs = require("fs");
const text = fs.readFileSync(process.argv[1], "utf8");
const match = text.match(/^version\s*=\s*"([^"]+)"/m);
if (!match) process.exit(1);
process.stdout.write(match[1]);
' "$PYPROJECT")"

if [ -z "$PIN_VERSION" ]; then
    echo "error: failed to parse version from $PYPROJECT" >&2
    exit 1
fi
echo ">>> [stage_agnes_mcp] pyproject pin = ${PIN_VERSION}"

# Astral PyPI 镜像 (与 install_uv.sh 同)
UV_INDEX_URL="${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple/}"

echo ">>> [stage_agnes_mcp] uv pip install --target ${TARGET_DIR}"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

# `--python` 让 uv 锁定到 bundled python, 避免它 auto-download portable python.
# `UV_PYTHON_PREFERENCE=only-system` 是双保险 (同时在 instances.rs 的 sidecar env
# 注入), 防止 uv 在没找到 system python 时静默下载.
UV_PYTHON_PREFERENCE=only-system \
UV_INDEX_URL="$UV_INDEX_URL" \
"$PYTHON_BIN" -m uv pip install \
    --python "$PYTHON_BIN" \
    --target "$TARGET_DIR" \
    "agnes-video-25-mcp==${PIN_VERSION}"

if [ ! -x "$CLI_BIN" ]; then
    echo "error: ${CLI_BIN} not found or not executable after install" >&2
    echo "       (pip-installed console_scripts must produce a Mach-O entry point)" >&2
    exit 1
fi

# `file` 验证 CLI 是 Mach-O (不是 shell wrapper / shebang 文本). 如果是
# shebang 形式 (`#!/path/to/python3`) 那还需要 python3 在 PATH 上, 而我们
# 走的是 uv-managed `python -m` 形态, shebang 会指向 python-build-standalone
# 的具体路径 → 装机时路径变了就坏. mach-o zipimport 形态无此问题.
CLI_FILE_TYPE="$(file -b "$CLI_BIN" 2>/dev/null || true)"
if [[ "$CLI_FILE_TYPE" != *"Mach-O"* ]]; then
    echo "warning: ${CLI_BIN} file type = ${CLI_FILE_TYPE:-unknown} (expected Mach-O)" >&2
    echo "         will continue but launchpad smoke test must verify exit code 0" >&2
fi

# 实际调用一次, 确保 CLI 入口 + transitively-installed deps 都能跑.
# stdout / stderr 都吞掉, 只看 exit code; 真用户场景 Sidecar spawn 时会捕获这些.
if ! "$CLI_BIN" --help >/dev/null 2>&1; then
    echo "error: agnes-video-25-mcp CLI smoke test failed (--help exited non-zero)" >&2
    exit 1
fi

# 双验证: 调 `python -m agnes_video_25.server` 入口同样可用.
if ! "$PYTHON_BIN" -m agnes_video_25.server --help >/dev/null 2>&1; then
    echo "warning: python -m agnes_video_25.server smoke test failed (non-fatal, CLI bin OK)" >&2
fi

echo ">>> [stage_agnes_mcp] agnes-video-25-mcp==${PIN_VERSION} staged for darwin-${ARCH}"
