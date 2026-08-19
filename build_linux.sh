#!/bin/bash
# HamunaAgent Linux 构建脚本 (v0.2.0+)
#
# 产出 AppImage + deb 到 src-tauri/target/release/bundle/{appimage,deb}。
# 所需系统依赖（Ubuntu 22.04+ / Debian 12+）：
#   sudo apt-get install -y \
#     build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev \
#     librsvg2-dev libwebkit2gtk-4.1-dev patchelf
# (详见 specs/tech_docs/linux_platform_guide.md)

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${PROJECT_DIR}/.env" ]; then
    set -a
    source "${PROJECT_DIR}/.env"
    set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${GREEN}🤖 HamunaAgent Linux 构建 (AppImage + deb)${NC}            ${CYAN}║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""

# 版本一致性
PKG_VERSION=$(grep '"version"' "${PROJECT_DIR}/package.json" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
TAURI_VERSION=$(grep '"version"' "${PROJECT_DIR}/src-tauri/tauri.conf.json" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
CARGO_VERSION=$(grep '^version = ' "${PROJECT_DIR}/src-tauri/Cargo.toml" | head -1 | sed 's/version = "\([^"]*\)".*/\1/')
if [ "$PKG_VERSION" != "$TAURI_VERSION" ] || [ "$PKG_VERSION" != "$CARGO_VERSION" ]; then
    echo -e "${YELLOW}⚠ 版本号不一致，请先运行 \`node scripts/sync-version.js\`${NC}"
    exit 1
fi
echo -e "${BLUE}[信息] 构建版本: ${PKG_VERSION}${NC}"
echo ""

HOST_ARCH=$(uname -m)
if [[ "$HOST_ARCH" == "aarch64" || "$HOST_ARCH" == "arm64" ]]; then
    DEFAULT_TARGET="aarch64-unknown-linux-gnu"
    SDK_TRIPLE="linux-arm64"
    NODE_ARCH="arm64"
else
    DEFAULT_TARGET="x86_64-unknown-linux-gnu"
    SDK_TRIPLE="linux-x64"
    NODE_ARCH="x64"
fi
TARGET="${1:-$DEFAULT_TARGET}"

# 依赖检查（仅 Debian/Ubuntu 通过 dpkg 精确校验；其它发行版跳过 + 提示等价包名）
echo -e "${BLUE}[1/6] 检查系统依赖...${NC}"
if command -v dpkg >/dev/null 2>&1; then
    # Ubuntu 版本 gate: 22.04+ 才有 libwebkit2gtk-4.1；20.04 仍停留在 4.0
    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        if [ "${ID:-}" = "ubuntu" ] && [ -n "${VERSION_ID:-}" ]; then
            major=$(echo "$VERSION_ID" | cut -d. -f1)
            if [ "${major:-0}" -lt 22 ] 2>/dev/null; then
                echo -e "${YELLOW}⚠ 检测到 Ubuntu ${VERSION_ID}。HamunaAgent 需要 Ubuntu 22.04+ (libwebkit2gtk-4.1)。${NC}"
                echo -e "${YELLOW}  20.04 仍使用 libwebkit2gtk-4.0，Tauri 2 不支持。升级系统或使用 22.04+ 构建机。${NC}"
                exit 1
            fi
        fi
    fi

    missing=()
    for pkg in pkg-config libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev patchelf; do
        if ! dpkg -s "$pkg" >/dev/null 2>&1; then
            missing+=("$pkg")
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}缺少系统依赖 (Debian/Ubuntu):${NC} ${missing[*]}"
        echo -e "${YELLOW}运行: sudo apt-get install -y ${missing[*]}${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ 系统依赖齐全 (Debian/Ubuntu)${NC}"
else
    echo -e "${YELLOW}⚠ 未检测到 dpkg (非 Debian/Ubuntu 发行版)${NC}"
    echo -e "${YELLOW}  请确保已安装: pkg-config, openssl-devel/libssl-dev, gtk3-devel/libgtk-3-dev,${NC}"
    echo -e "${YELLOW}    libayatana-appindicator-devel/libayatana-appindicator3-dev,${NC}"
    echo -e "${YELLOW}    librsvg2-devel/librsvg2-dev, webkit2gtk4.1-devel/libwebkit2gtk-4.1-dev,${NC}"
    echo -e "${YELLOW}    patchelf${NC}"
    echo -e "${YELLOW}  Tauri 构建如缺库会给出明确错误。继续...${NC}"
fi
echo ""

echo -e "${BLUE}[1.5/6] 检查 Rust / Node 构建依赖...${NC}"
for cmd in node npm rustc cargo rustup; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo -e "${RED}缺少命令: $cmd${NC}"
        if [ "$cmd" = "rustup" ] || [ "$cmd" = "rustc" ] || [ "$cmd" = "cargo" ]; then
            echo -e "${YELLOW}请通过 rustup 安装 Rust: https://rustup.rs${NC}"
        else
            echo -e "${YELLOW}请安装 Node.js 24+ / npm${NC}"
        fi
        exit 1
    fi
done
"${PROJECT_DIR}/scripts/ensure_rust_toolchain.sh" "$TARGET"
echo -e "${GREEN}✓ Rust / Node 构建依赖就绪${NC}"
echo ""

# TypeScript 检查
echo -e "${BLUE}[2/6] TypeScript 类型检查...${NC}"
cd "${PROJECT_DIR}"
if ! npm run typecheck; then
    echo -e "${RED}✗ TypeScript 检查失败${NC}"
    exit 1
fi
echo -e "${GREEN}✓ 通过${NC}"
echo ""

# Sidecar + Bridge + CLI 打包 —— 三件套统一通过 `npm run build:*`
# (`node scripts/esbuild-bundle.mjs <target>`)。Driver 内部 post-build：
# - cli: 复制 hamuna.cmd 到 resources/cli/
# - server: 校验产物不含硬编码 __dirname 路径
echo -e "${BLUE}[3/6] 打包 Sidecar / Bridge / CLI ...${NC}"
npm run build:server
npm run build:bridge
npm run build:cli

# 填充 tsx-runtime 资源（Plugin Bridge 通过绝对路径 --import 引用）。
# 用 npm 的 --os/--cpu 选择对应平台的 @esbuild/<triple>。
LINUX_TSX_CPU=$([[ "$(uname -m)" == "aarch64" || "$(uname -m)" == "arm64" ]] && echo "arm64" || echo "x64")
echo -e "${BLUE}[3.1/6] 填充 tsx-runtime (linux-${LINUX_TSX_CPU})...${NC}"
npm run build:tsx-runtime -- linux "${LINUX_TSX_CPU}"
echo -e "${GREEN}✓ 打包完成${NC}"
echo ""

# SDK 依赖目录占位（per-arch 在下方拷）
rm -rf src-tauri/resources/claude-agent-sdk
mkdir -p src-tauri/resources/claude-agent-sdk

# 预装 sharp 图像处理（替代 jimp，libvips 原生）
# Linux 单架构构建：只装当前 host 架构的 @img/sharp-linux-* + libvips
echo -e "${BLUE}[3.5/6] 预装 sharp 图像处理（libvips 原生）...${NC}"
SHARP_DIR="${PROJECT_DIR}/src-tauri/resources/sharp-runtime"
rm -rf "${SHARP_DIR}"
mkdir -p "${SHARP_DIR}"
cat > "${SHARP_DIR}/package.json" <<'SHARP_PKG'
{
  "name": "sharp-runtime",
  "private": true,
  "version": "1.0.0",
  "dependencies": { "sharp": "0.34.5" }
}
SHARP_PKG
(cd "${SHARP_DIR}" && npm install --no-audit --no-fund --no-save --ignore-scripts)
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ sharp 主包预装失败${NC}"
    exit 1
fi
# 只装 glibc 变体。AppImage 主程序/webkit 均链接 glibc，musl 宿主跑不了；
# 且 linuxdeploy 会扫描 AppDir 内所有 ELF，musl libvips 会因找不到
# libc.musl-x86_64.so.1 直接打包失败。
LINUX_ARCH_SUFFIX=$([[ "$(uname -m)" == "aarch64" || "$(uname -m)" == "arm64" ]] && echo "arm64" || echo "x64")
(cd "${SHARP_DIR}" && npm install --no-save --force --no-audit --no-fund --ignore-scripts \
    "@img/sharp-linux-${LINUX_ARCH_SUFFIX}@0.34.5" \
    "@img/sharp-libvips-linux-${LINUX_ARCH_SUFFIX}@1.2.4")
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ sharp Linux 平台包安装失败${NC}"
    exit 1
fi
# 验证 glibc 原生二进制存在（主目标）
SHARP_NODE="${SHARP_DIR}/node_modules/@img/sharp-linux-${LINUX_ARCH_SUFFIX}/lib/sharp-linux-${LINUX_ARCH_SUFFIX}.node"
if [ ! -f "$SHARP_NODE" ]; then
    echo -e "${RED}✗ sharp-linux-${LINUX_ARCH_SUFFIX}.node 缺失${NC}"
    exit 1
fi
# 删除 musl/其它平台包。musl 包里的 ELF 会触发 linuxdeploy 报
# "Could not find dependency: libc.musl-x86_64.so.1"；即使能打包，AppImage
# 的 glibc webkit 在 Alpine 上也跑不起来。
find "${SHARP_DIR}/node_modules/@img" -maxdepth 1 -type d \
    \( -name "sharp-linuxmusl*" -o -name "sharp-libvips-linuxmusl*" \
    -o -name "sharp-darwin*" -o -name "sharp-win32*" \
    -o -name "sharp-libvips-darwin*" -o -name "sharp-libvips-win32*" \
    -o -name "sharp-wasm32" \) \
    -exec rm -rf {} + 2>/dev/null || true
echo -e "${GREEN}✓ sharp 预装完成 (linux-${LINUX_ARCH_SUFFIX} glibc)${NC}"
echo ""

# 前端
echo -e "${BLUE}[4/6] 构建前端...${NC}"
npm run build:web
echo ""

# Tauri 构建
echo -e "${BLUE}[5/6] 构建 Tauri (AppImage + deb)...${NC}"

echo -e "  ${CYAN}目标: ${TARGET} (SDK: ${SDK_TRIPLE})${NC}"

# 确保 Node.js 匹配目标架构
"${PROJECT_DIR}/scripts/download_nodejs.sh"

# 拷贝 SDK native binary（glibc；musl 场景用户自行替换）
CLAUDE_SRC="${PROJECT_DIR}/node_modules/@anthropic-ai/claude-agent-sdk-${SDK_TRIPLE}/claude"
CLAUDE_DEST="${PROJECT_DIR}/src-tauri/resources/claude-agent-sdk/claude"
if [ ! -f "$CLAUDE_SRC" ]; then
    echo -e "${RED}✗ Claude native binary 不存在: $CLAUDE_SRC${NC}"
    echo -e "${YELLOW}  运行 npm install 以安装 @anthropic-ai/claude-agent-sdk-${SDK_TRIPLE}${NC}"
    exit 1
fi
cp "$CLAUDE_SRC" "$CLAUDE_DEST"
chmod +x "$CLAUDE_DEST"
echo -e "  ${GREEN}✓ Claude native binary (${SDK_TRIPLE}) 就绪${NC}"

# cuse externalBin stub —— Tauri v2 的 externalBin 是全局配置，不支持 per-platform 条件；
# cuse 不发 Linux 包，但 tauri.conf.json 仍声明 "binaries/cuse"。Runtime 层
# runtime.ts::getBundledCusePath()` 已硬 gate platform != linux，stub 永远不会被执行，
# 只为满足 Tauri 打包阶段的 "${name}-${target-triple}" 文件存在性 + linuxdeploy 的 ELF
# 校验（不能用空文件，linuxdeploy 会拒绝非 ELF 的 externalBin）。
# 用系统 `true` 二进制作 stub —— 有效 ELF、~30KB、host 架构匹配（script 默认 TARGET = host）。
# 不能用 `command -v true`：bash 把 `true` 当 shell 内建命令，`command -v` 只返 `"true"` 不带路径，
# `cp true ...` 直接 stat 失败。改用常见绝对路径 + -x 校验（merged-/usr 优先 /usr/bin/true，回退 /bin/true）。
CUSE_STUB="${PROJECT_DIR}/src-tauri/binaries/cuse-${TARGET}"
# trap 确保 build 失败时 stub 也不污染 git status；set -e 下任何非零退出都会触发
trap 'rm -f "$CUSE_STUB"' EXIT
mkdir -p "$(dirname "$CUSE_STUB")"
TRUE_BIN=""
for candidate in /usr/bin/true /bin/true; do
    if [ -x "$candidate" ]; then
        TRUE_BIN="$candidate"
        break
    fi
done
if [ -z "$TRUE_BIN" ]; then
    echo -e "${RED}✗ 找不到 \`true\` 二进制（/usr/bin/true 或 /bin/true），无法生成 cuse stub${NC}"
    exit 1
fi
cp "$TRUE_BIN" "$CUSE_STUB"
chmod +x "$CUSE_STUB"
echo -e "  ${GREEN}✓ cuse externalBin stub (from $TRUE_BIN): ${CUSE_STUB}${NC}"

# Tauri 的打包暂存目录不会清理已删除文件：上次失败构建残留的 musl sharp 包
# 会从 appimage_deb/data 再次进入 AppDir，导致 linuxdeploy 失败。
rm -rf "${PROJECT_DIR}/src-tauri/target/${TARGET}/release/bundle/appimage_deb"
rm -rf "${PROJECT_DIR}/src-tauri/target/${TARGET}/release/bundle/appimage/HamunaAgent.AppDir"
npm run tauri:build -- --target "$TARGET" --bundles appimage,deb

echo ""
BUNDLE_DIR="${PROJECT_DIR}/src-tauri/target/${TARGET}/release/bundle"

echo -e "${BLUE}[6/6] 输出产物${NC}"
APPIMAGE_PATH=$(find "${BUNDLE_DIR}/appimage" -name "*.AppImage" 2>/dev/null | head -1)
DEB_PATH=$(find "${BUNDLE_DIR}/deb" -name "*.deb" 2>/dev/null | head -1)

if [ -n "$APPIMAGE_PATH" ]; then
    APPIMAGE_SIZE=$(du -h "$APPIMAGE_PATH" | cut -f1)
    echo -e "  ${CYAN}AppImage:${NC} ${APPIMAGE_PATH} (${APPIMAGE_SIZE})"
fi
if [ -n "$DEB_PATH" ]; then
    DEB_SIZE=$(du -h "$DEB_PATH" | cut -f1)
    echo -e "  ${CYAN}deb:${NC} ${DEB_PATH} (${DEB_SIZE})"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Linux 构建完成!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
