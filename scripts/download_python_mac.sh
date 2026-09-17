#!/usr/bin/env bash
# Fetch python-build-standalone (Astral) for darwin-{arm64,x64} and stage it
# under src-tauri/resources/python-<arch>/. Tauri `bundle.resources` then
# ships the whole directory inside HamunaAgent.app/Contents/Resources/.
#
# Why python-build-standalone:
#   - self-contained, no Homebrew / pyenv dependency at install time
#   - cpython Mach-O statically linked, predictable lipo output
#   - same vendor as uv → zero ABI surprise
#   - mirrors scripts/download_python.ps1 (Windows install-time path)
#
# Why a separate dir per arch (python-arm64 / python-x64):
#   - user 拍板「两个 arch 都 ship」
#   - build_macos.sh Both 模式两次 build 共用 src-tauri/resources/ staging,
#     同名目录会污染 next build (download_nodejs.sh 同款 design)
#   - runtime 按 process.arch 解析, 永远拿到对的那份
#
# Pin bump: 跑 `shasum -a 256 <downloaded>.tar.gz`, 把 hash + 新的 tag
# 同步进 PYTHON_VERSION / PYTHON_TAG / EXPECTED_SHA_<ARCH>。

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "usage: $0 <arm64|x64>" >&2
    exit 1
fi

ARCH="$1"
case "$ARCH" in
    arm64) TRIPLE="aarch64-apple-darwin"; EXPECTED_ARCH="arm64" ;;
    x64)   TRIPLE="x86_64-apple-darwin";  EXPECTED_ARCH="x86_64" ;;
    *) echo "error: arch must be arm64 or x64, got: $ARCH" >&2; exit 1 ;;
esac

# python-build-standalone release tag. Astral 在每个 cpython patch release
# 出新 tag; bump 时改这一个常量 + 下面 EXPECTED_SHA_<ARCH>。
PYTHON_VERSION="3.12.7"
PYTHON_TAG="20250918"
PYTHON_TARBALL="cpython-${PYTHON_VERSION}+${PYTHON_TAG}-${TRIPLE}-install_only.tar.gz"

# Astral 提供 GitHub release + Cloudflare CDN. CI runner 在美区,
# 偶尔 GFW 干扰时 fallback 到 CDN. SHA-256 hard-pin 防止 MITM / 半路断流.
EXPECTED_SHA_arm64="<TODO: pin on first download — see comments above>"
EXPECTED_SHA_x64="<TODO: pin on first download — see comments above>"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${PROJECT_DIR}/src-tauri/resources/python-${ARCH}"
TARBALL_PATH="${TARGET_DIR}.tar.gz"

mkdir -p "$(dirname "$TARGET_DIR")"

echo ">>> [download_python_mac] fetching python-build-standalone ${PYTHON_VERSION}+${PYTHON_TAG} for darwin-${ARCH}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DOWNLOAD_URL_PRIMARY="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/${PYTHON_TARBALL}"
DOWNLOAD_URL_FALLBACK="https://astral-sh.github.io/python-build-standalone/${PYTHON_TAG}/${PYTHON_TARBALL}"

if ! curl --fail --silent --show-error --location --retry 3 --retry-delay 5 \
        --output "$TARBALL_PATH" "$DOWNLOAD_URL_PRIMARY"; then
    echo ">>> [download_python_mac] primary URL failed, trying CDN fallback"
    curl --fail --silent --show-error --location --retry 3 --retry-delay 5 \
        --output "$TARBALL_PATH" "$DOWNLOAD_URL_FALLBACK"
fi

echo ">>> [download_python_mac] verifying SHA-256"
EXPECTED_VAR="EXPECTED_SHA_${ARCH}"
EXPECTED="${!EXPECTED_VAR}"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" = "<TODO: pin on first download — see comments above>" ]; then
    echo "error: SHA-256 not pinned for ${ARCH}. Run 'shasum -a 256 $TARBALL_PATH'" >&2
    echo "       and set EXPECTED_SHA_${ARCH} in this script." >&2
    exit 1
fi
ACTUAL="$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')"
if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "error: SHA-256 mismatch for python-${ARCH}:" >&2
    echo "  expected: $EXPECTED" >&2
    echo "  actual:   $ACTUAL" >&2
    exit 1
fi

echo ">>> [download_python_mac] extracting to $TARGET_DIR"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
tar -xzf "$TARBALL_PATH" -C "$TARGET_DIR" --strip-components=1

# python-build-standalone 的 install_only 产物已经包含 bin/, lib/, include/.
# 把整个目录搬到 TARGET_DIR; 不要嵌套一层 `python/` 子目录.

PYTHON_BIN="${TARGET_DIR}/bin/python3"
if [ ! -x "$PYTHON_BIN" ]; then
    echo "error: ${PYTHON_BIN} not found or not executable after extract" >&2
    exit 1
fi

# lipo 验证 arch (build_macos.sh::validate_macho_binary 同款)
ARCHES="$(lipo -archs "$PYTHON_BIN" 2>/dev/null || true)"
if [[ " $ARCHES " != *" $EXPECTED_ARCH "* ]]; then
    echo "error: python-${ARCH} arch mismatch: expected ${EXPECTED_ARCH}, got ${ARCHES:-unknown}" >&2
    exit 1
fi

# 跑一次确保 dynamic linker OK (LibreSSL / ncurses 链接检查)
"$PYTHON_BIN" -c "import sys; print(f'>>> [download_python_mac] python {sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]} ({ARCH}) OK')"

echo ">>> [download_python_mac] done: ${TARGET_DIR}"
