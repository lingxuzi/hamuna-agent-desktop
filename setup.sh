#!/bin/bash
# HamunaAgent 开发环境初始化脚本
# 首次 clone 仓库后运行此脚本

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}🤖 HamunaAgent 开发环境初始化${NC}              ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# 检查依赖
check_install() {
    local name=$1
    local check_cmd=$2
    local install_hint=$3
    
    echo -n "  检查 $name... "
    if eval "$check_cmd" &> /dev/null; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗${NC}"
        echo -e "    ${YELLOW}请安装: $install_hint${NC}"
        return 1
    fi
}

echo -e "${BLUE}[1/6] 检查依赖${NC}"
MISSING=0

check_install "Node.js" "node --version" "https://nodejs.org (≥ v20)" || MISSING=1
check_install "npm" "npm --version" "随 Node.js 安装" || MISSING=1
check_install "Rust" "rustc --version" "https://rustup.rs" || MISSING=1
check_install "Cargo" "cargo --version" "随 Rust 安装" || MISSING=1
check_install "rustup" "rustup --version" "https://rustup.rs" || MISSING=1

echo ""
if [ $MISSING -eq 1 ]; then
    echo -e "${RED}请先安装上述缺失的依赖，然后重新运行此脚本${NC}"
    exit 1
fi

# 固定 Rust toolchain/components，避免 rustfmt/clippy 或 IDE 使用系统 Rust 漂移。
echo -e "${BLUE}[1.5/6] 准备 Rust toolchain / components${NC}"
"${PROJECT_DIR}/scripts/ensure_rust_toolchain.sh"
echo ""

# 下载 Node.js 二进制（Sidecar + MCP Server + 社区工具 统一 runtime）
echo ""
echo -e "${BLUE}[2/6] 下载 Node.js 运行时${NC}"
"${PROJECT_DIR}/scripts/download_nodejs.sh"
echo ""

# 下载 cuse computer-use 二进制（macOS only — cuse 不出 Linux 包，
# Windows 走 setup_windows.ps1）。download_cuse.sh 自带版本短路：
# 已有正确版本 + Mach-O 烟雾测试通过 → exit 0，重跑也是 noop。
# 网络失败 / R2 短暂不可用属软失败：dev 模式 getBundledCusePath() 返
# null → MCP 优雅 skip + warn，用户事后可手动重跑 download_cuse.sh，
# 不应阻断整个 setup（其他 99% 的功能跟 cuse 无关）。
echo -e "${BLUE}[3/6] 下载 cuse computer-use 二进制${NC}"
if [[ "$(uname -s)" == "Darwin" ]]; then
    if ! "${PROJECT_DIR}/scripts/download_cuse.sh"; then
        echo -e "${YELLOW}⚠ cuse 下载失败（网络或 R2 不可用）— computer-use 功能在 dev 模式下将不可用${NC}"
        echo -e "${YELLOW}  网络恢复后可重跑：./scripts/download_cuse.sh${NC}"
    fi
else
    echo -e "${YELLOW}  非 macOS，跳过（cuse 当前只发 macOS / Windows 包）${NC}"
fi
echo ""

# Install easy_tdx Python package (vendored at stock-sources/easy_tdx).
# The easy-tdx MCP entry in extended_buildin_mcp/mcp.json invokes the bare
# `easy-tdx-mcp` console script, so this MUST happen before the MCP loader
# tries to spawn it. Hard dependency on Python being on PATH (system Python on
# dev machines; download_python.ps1 is Windows-only): gate the call so a missing
# python surfaces a single hint instead of a stacked "no pip" failure.
# Soft-fail by design — missing easy_tdx only disables one optional MCP, never
# blocks setup. See scripts/install_easy_tdx.sh.
echo -e "${BLUE}[3.5/6] 安装 easy_tdx Python 包（提供 easy-tdx-mcp 控制台脚本）${NC}"
if ! command -v python3 >/dev/null 2>&1; then
    echo -e "${YELLOW}⛔ python3 未就绪,跳过 easy_tdx 安装${NC}"
    echo -e "${YELLOW}  ⚠ easy-tdx MCP 在 dev 模式下将不可用${NC}"
    echo -e "${YELLOW}    修复: 装 python3 + pip 后重跑 ./scripts/install_easy_tdx.sh --force${NC}"
elif ! "${PROJECT_DIR}/scripts/install_easy_tdx.sh"; then
    echo -e "${YELLOW}⚠ easy_tdx 安装失败 — easy-tdx MCP 在 dev 模式下将不可用${NC}"
    echo -e "${YELLOW}  网络/pip 恢复后重跑：./scripts/install_easy_tdx.sh --force${NC}"
fi
echo ""

# 安装依赖（使用 npm — v0.2.0 起不再依赖 Bun）
echo -e "${BLUE}[4/6] 安装依赖${NC}"
npm install
if [[ "$(uname -s)" == "Darwin" ]]; then
    echo -e "  ${CYAN}Validating Claude Agent SDK native package...${NC}"
    "${PROJECT_DIR}/scripts/ensure_claude_sdk_package.sh"
fi
# Rebuild native addons (e.g. better-sqlite3) against bundled Node.js ABI —
# system `node` may differ in NODE_MODULE_VERSION and produce binaries that
# crash in our runtime with ERR_DLOPEN_FAILED.
NODE_BIN="${PROJECT_DIR}/src-tauri/resources/nodejs/bin/node"
if [ -x "$NODE_BIN" ]; then
    echo -e "  ${CYAN}Rebuilding native addons against bundled Node...${NC}"
    PATH="${PROJECT_DIR}/src-tauri/resources/nodejs/bin:$PATH" npm rebuild
fi
echo -e "${GREEN}✓ 依赖安装完成${NC}"
echo ""

# 安装 Rust 依赖
echo -e "${BLUE}[5/6] 检查 Rust 依赖${NC}"
cd src-tauri
cargo check --quiet 2>/dev/null || cargo fetch
cd ..
echo -e "${GREEN}✓ Rust 依赖准备完成${NC}"
echo ""

# 准备默认工作区 (mino) — 优先从本地缓存复制，避免每次 setup.sh 都重新 clone。
# 首次运行仍需联网一次（克隆到 ~/.hamuna/setup-cache/mino），之后只做本地拷贝。
# 强制刷新缓存：MINO_REFRESH=1 ./setup.sh
# 强制走 HTTPS（绕过 SSH 探测）：MINO_REPO_URL=https://.../openmino.git ./setup.sh
MINO_DIR="${PROJECT_DIR}/mino"
MINO_CACHE_DIR="${MINO_CACHE_DIR:-${HAMUNA_HOME:-$HOME/.hamuna}/setup-cache/mino}"
MINO_REPO_URL_SSH="${MINO_REPO_URL_SSH:-git@github.com:hAcKlyc/openmino.git}"
MINO_REPO_URL_HTTPS="${MINO_REPO_URL_HTTPS:-https://github.com/hAcKlyc/openmino.git}"

ensure_mino_cache() {
  if [ -z "${MINO_REFRESH}" ] && [ -f "${MINO_CACHE_DIR}/CLAUDE.md" ]; then
    echo -e "  ${GREEN}✓ 命中本地缓存 ${MINO_CACHE_DIR}${NC}"
    return 0
  fi
  echo -e "  ${CYAN}克隆 openmino 到本地缓存 (${MINO_CACHE_DIR})...${NC}"
  mkdir -p "$(dirname "$MINO_CACHE_DIR")"
  rm -rf "$MINO_CACHE_DIR"
  # SSH 优先（已配 key 的开发者更快），失败回落到 HTTPS。
  if [ -n "${MINO_REPO_URL}" ]; then
    git clone --depth 1 "${MINO_REPO_URL}" "$MINO_CACHE_DIR" && return 0
    echo -e "  ${YELLOW}指定 MINO_REPO_URL 克隆失败${NC}" >&2
    return 1
  fi
  if git clone --depth 1 "$MINO_REPO_URL_SSH" "$MINO_CACHE_DIR" 2>/dev/null; then
    return 0
  fi
  echo -e "  ${YELLOW}SSH 克隆失败，回落到 HTTPS...${NC}"
  git clone --depth 1 "$MINO_REPO_URL_HTTPS" "$MINO_CACHE_DIR"
}

echo -e "${BLUE}[6/6] 准备默认工作区 (mino)${NC}"
if ! ensure_mino_cache; then
  echo -e "${RED}✗ mino 克隆失败${NC}" >&2
  echo -e "${YELLOW}  提示：可手动把 openmino 放到 ${MINO_DIR} 后重新运行${NC}" >&2
  exit 1
fi

# 从缓存拷贝到项目目录，剥离 .git（避免 Tauri 资源打包权限问题 + rerun-if-changed 性能开销）。
rm -rf "$MINO_DIR"
mkdir -p "$MINO_DIR"
cp -R "${MINO_CACHE_DIR}/." "$MINO_DIR/"
rm -rf "${MINO_DIR}/.git"
echo -e "${GREEN}✓ mino 默认工作区已就绪${NC}"
echo ""

# 完成
echo -e "${BLUE}✓ 初始化完成!${NC}"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  开发环境准备就绪!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "  后续步骤:"
echo ""
echo "  ${BLUE}开发模式:${NC}"
echo "    ./start_dev.sh"
echo ""
echo "  ${BLUE}运行 Tauri 应用:${NC}"
echo "    npm run tauri:dev"
echo ""
echo "  ${BLUE}构建 macOS 安装包:${NC}"
echo "    ./build_macos.sh"
echo ""
