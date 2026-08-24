#!/bin/bash

# 检查 agent-browser 是否已全局安装
if command -v agent-browser &> /dev/null; then
    echo "agent-browser 已全局安装，跳过安装步骤"
    exit 0
fi

echo "agent-browser 未安装，开始安装流程..."

# 第一步：检查 Node.js 是否已安装
if ! command -v node &> /dev/null; then
    echo "Node.js 未安装，请先安装 Node.js 22+（macOS: brew install node@22；Linux: 参考 https://nodejs.org）"
    exit 1
else
    echo "Node.js 已安装: $(node --version)"
fi

# 第二步：安装 agent-browser
echo "开始安装 agent-browser..."
npm install -g agent-browser --registry=https://registry.npmmirror.com

if [ $? -ne 0 ]; then
    echo "错误: agent-browser 安装失败"
    exit 1
fi

echo "agent-browser 安装成功"
