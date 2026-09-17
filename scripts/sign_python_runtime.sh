#!/usr/bin/env bash
# Sign Python runtime + uv + agnes-video-25-mcp wheel Mach-O binaries with
# our Apple Developer ID + hardened runtime + entitlements. mirrors
# build_macos.sh 的签名循环 (line 412-449, sharp + vendor + node + claude),
# 但覆盖 python-build-standalone + uv site-packages + hosted-mcps wheel 三组.
#
# Why every Mach-O needs signing:
#   - Apple notarization 要求 bundle 内每个 native binary 都 hardened runtime
#     签名, 否则 notarytool 报 "The binary is not signed with a valid
#     Developer ID" 拒收.
#   - mach-o zipimport 形式 (agnes CLI bin) 也算 native binary.
#   - lib-dynload/*.so 是动态加载的, 也走公证.
#
# Why entitlements on python3 + agnes bin (not on uv / .so):
#   - python3 + agnes bin 是 entry point, 需要 JIT / dynamic linker
#     与主 app TCC 权限一致 (Screen Recording / Accessibility / AppleEvents).
#     sub-process 继承主 app 签名 → TCC 权限共享.
#   - uv 是 maturin-Rust 静态 binary, 不需要 JIT entitlement.
#   - lib-dynload/*.so 由 entry point 加载时继承其 entitlement, 不单独签.
#
# 为什么分开签 (而不是一个 codesign -f 把整目录递归):
#   - recursive -f 会把整个目录签成一个 bundle, 但 notarization 需要
#     bundle 内部的 native binary 各自带签名 (spctl --assess 递归验证).
#   - 分开签每个文件 + 给 .app 主 bundle 一个 final seal = notarytool 认可.

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

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
    echo "error: APPLE_SIGNING_IDENTITY not set (build_macos.sh sources .env before calling)" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTITLEMENTS="${PROJECT_DIR}/src-tauri/Entitlements.plist"

if [ ! -f "$ENTITLEMENTS" ]; then
    echo "error: entitlements not found: $ENTITLEMENTS" >&2
    exit 1
fi

PYTHON_DIR="${PROJECT_DIR}/src-tauri/resources/python-${ARCH}"
AGNES_DIR="${PROJECT_DIR}/src-tauri/resources/hosted-mcps/agnes-video-25-mcp-${ARCH}"

PY_ENTRY="${PYTHON_DIR}/bin/python3"
PY_DYNLOAD_DIR="${PYTHON_DIR}/lib/python3.12/lib-dynload"
AGNES_CLI="${AGNES_DIR}/bin/agnes-video-25-mcp"
AGNES_SO_DIR="${AGNES_DIR}/lib/python3.12/site-packages"

sign_with_entitlements() {
    local BINARY="$1"
    if [ ! -f "$BINARY" ]; then
        echo "warning: ${BINARY} not found, skip"
        return 0
    fi
    xattr -d com.apple.quarantine "$BINARY" 2>/dev/null || true
    if ! codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS" \
            --sign "$APPLE_SIGNING_IDENTITY" "$BINARY"; then
        echo "error: failed to sign ${BINARY}" >&2
        return 1
    fi
    echo "    signed (with entitlements): $(echo "$BINARY" | sed "s|.*/resources/||")"
}

sign_no_entitlements() {
    local BINARY="$1"
    if [ ! -f "$BINARY" ]; then
        echo "warning: ${BINARY} not found, skip"
        return 0
    fi
    xattr -d com.apple.quarantine "$BINARY" 2>/dev/null || true
    if ! codesign --force --options runtime --timestamp \
            --sign "$APPLE_SIGNING_IDENTITY" "$BINARY"; then
        echo "error: failed to sign ${BINARY}" >&2
        return 1
    fi
    echo "    signed: $(echo "$BINARY" | sed "s|.*/resources/||")"
}

echo ">>> [sign_python_runtime] darwin-${ARCH}"

# ---- python entry (needs entitlements) ----
echo ">>> python entry"
sign_with_entitlements "$PY_ENTRY"

# ---- python lib-dynload .so (each loaded individually, needs signing) ----
if [ -d "$PY_DYNLOAD_DIR" ]; then
    echo ">>> python lib-dynload .so"
    SIGNED=0
    while IFS= read -r so_file; do
        if sign_no_entitlements "$so_file"; then
            SIGNED=$((SIGNED + 1))
        fi
    done < <(find "$PY_DYNLOAD_DIR" -type f -name "*.so" 2>/dev/null)
    echo "    ${SIGNED} .so signed"
else
    echo "    warning: ${PY_DYNLOAD_DIR} not found, skip"
fi

# ---- uv binary (maturin Rust static, no entitlements) ----
# uv lives inside python-<arch>/lib/python3.12/site-packages/uv/
# find the actual binary (maturin places it in different subdirs across versions)
UV_BIN_DIR="${PYTHON_DIR}/lib/python3.12/site-packages/uv"
if [ -d "$UV_BIN_DIR" ]; then
    echo ">>> uv binary"
    SIGNED=0
    while IFS= read -r bin_file; do
        if sign_no_entitlements "$bin_file"; then
            SIGNED=$((SIGNED + 1))
        fi
    done < <(find "$UV_BIN_DIR" -type f -name "uv" -perm -u+x 2>/dev/null)
    if [ "$SIGNED" -eq 0 ]; then
        echo "    warning: no uv binary found under $UV_BIN_DIR"
    else
        echo "    ${SIGNED} uv binary signed"
    fi
fi

# ---- agnes CLI entry (needs entitlements, same reason as python3) ----
echo ">>> agnes CLI entry"
sign_with_entitlements "$AGNES_CLI"

# ---- agnes wheel .so (no entitlements, loaded by CLI bin) ----
if [ -d "$AGNES_SO_DIR" ]; then
    echo ">>> agnes wheel .so"
    SIGNED=0
    while IFS= read -r so_file; do
        if sign_no_entitlements "$so_file"; then
            SIGNED=$((SIGNED + 1))
        fi
    done < <(find "$AGNES_SO_DIR" -type f -name "*.so" 2>/dev/null)
    echo "    ${SIGNED} .so signed"
else
    echo "    warning: ${AGNES_SO_DIR} not found, skip"
fi

echo ">>> [sign_python_runtime] done"
