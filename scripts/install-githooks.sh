#!/bin/sh
# 安装「每次 commit 自动 bump 版本号」的 git hook。
# 把 .githooks/pre-commit 复制到 .git/hooks/pre-commit（本机生效；hook 不进 git）。
# 复用全局 chain-repo-hook 约定：若本机已有全局 hooksPath，仓库级 hook 会被自动调用。
# 用法: bash scripts/install-githooks.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/.githooks/pre-commit"
GIT_DIR="$REPO_ROOT/.git/hooks"

[ -f "$SRC" ] || { echo "[install-githooks] 源文件不存在: $SRC"; exit 1; }
[ -d "$GIT_DIR" ] || { echo "[install-githooks] 不是 git 仓库: $GIT_DIR"; exit 1; }

cp "$SRC" "$GIT_DIR/pre-commit"
chmod +x "$GIT_DIR/pre-commit"

echo "[install-githooks] 已安装 $GIT_DIR/pre-commit"
echo "[install-githooks] 后续每次 commit 将自动 bump patch 版本号（CI 与已 staged 版本自动跳过）"
