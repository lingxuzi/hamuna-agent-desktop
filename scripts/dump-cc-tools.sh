#!/bin/bash
# spawn CC CLI 拿 tools + 第一个请求
CC=$(find node_modules/@anthropic-ai/claude-agent-sdk-* -name "claude" -type f 2>/dev/null | head -1)
echo "CC binary: $CC"
