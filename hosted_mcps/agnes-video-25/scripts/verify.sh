#!/usr/bin/env bash
# verify.sh — env check + import check for agnes-video-25 MCP service.
# Does NOT call the upstream API (no quota cost).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PACKAGE_ROOT"

pass=0
fail=0

check() {
    local label="$1"; shift
    if "$@"; then
        printf "  \033[32mPASS\033[0m  %s\n" "$label"
        pass=$((pass + 1))
    else
        printf "  \033[31mFAIL\033[0m  %s\n" "$label"
        fail=$((fail + 1))
    fi
}

echo "==> agnes-video-25 verify"
echo ""

# 1. pyproject + entry point declared
echo "[1/4] manifest"
check "pyproject.toml exists"        test -f "$PACKAGE_ROOT/pyproject.toml"
check "server module path exists"    test -f "$PACKAGE_ROOT/src/agnes_video_25/server.py"

# 2. python + uv available
echo ""
echo "[2/4] toolchain"
check "python3 >= 3.10"             python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"
check "uv available"                command -v uv >/dev/null

# 3. import check (no network)
echo ""
echo "[3/4] import"
if command -v uv >/dev/null; then
    if uv run --quiet python -c "from agnes_video_25.server import mcp; print('imported ok')" 2>/tmp/uv_err.log; then
        printf "  \033[32mPASS\033[0m  agnes_video_25.server imports cleanly\n"
        pass=$((pass + 1))
    else
        printf "  \033[31mFAIL\033[0m  import failed (run \`uv sync\` first):\n"
        cat /tmp/uv_err.log
        fail=$((fail + 1))
    fi
else
    printf "  \033[33mSKIP\033[0m  uv not present, skipping import check\n"
fi

# 4. tool registry: enumerate MCP tools without starting server
echo ""
echo "[4/4] tool registry"
if command -v uv >/dev/null; then
    expected_tools=(
        agnes25_video_submit agnes25_video_status agnes25_video_wait agnes25_video_generate
        agnes25_image_generate agnes25_image_generate_v2 agnes25_image_edit
    )
    for tool in "${expected_tools[@]}"; do
        if uv run --quiet python -c "from agnes_video_25.server import mcp; tools = [t.name for t in mcp._tool_manager._tools.values()]; assert '$tool' in tools, f'missing $tool in {tools}'; print('ok')" 2>/tmp/uv_err.log; then
            printf "  \033[32mPASS\033[0m  tool declared: %s\n" "$tool"
            pass=$((pass + 1))
        else
            printf "  \033[31mFAIL\033[0m  tool declared: %s\n" "$tool"
            cat /tmp/uv_err.log
            fail=$((fail + 1))
        fi
    done
fi

echo ""
echo "==> $pass passed, $fail failed"
exit $fail
