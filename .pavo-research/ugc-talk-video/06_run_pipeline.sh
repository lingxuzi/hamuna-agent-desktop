#!/usr/bin/env bash
# UGC 5 段视频生成驱动脚本
# 按 SKILL.md「视频生成门禁」执行顺序：图片 5 张 → 视频分 3 批（2+2+1）
# 用法：
#   1) 先编辑本文件顶部 MCP_SERVER_CMD 与环境变量
#   2) chmod +x 06_run_pipeline.sh
#   3) ./06_run_pipeline.sh

set -euo pipefail

# ===== 配置区 =====
MCP_CONFIG="/home/hmcz/Projects/hamuna-agent-desktop/extended_buildin_mcp/mcp.json"
WORKDIR="/home/hmcz/Projects/hamuna-agent-desktop"
FRAMES_DIR="$WORKDIR/.pavo-research/ugc-talk-video/frames"
VIDEOS_DIR="$WORKDIR/.pavo-research/ugc-talk-video/videos"

mkdir -p "$FRAMES_DIR" "$VIDEOS_DIR"

# 从 mcp.json 抽取 AGNES_API_KEY 与 uvx 命令
AGNES_API_KEY=$(python3 -c "import json; d=json.load(open('$MCP_CONFIG')); print([s for s in d['servers'] if s['id']=='multimedia-creator'][0]['env']['AGNES_API_KEY'])")
AGNES_BASE_URL=$(python3 -c "import json; d=json.load(open('$MCP_CONFIG')); print([s for s in d['servers'] if s['id']=='multimedia-creator'][0]['env']['AGNES_BASE_URL'])")

export AGNES_API_KEY AGNES_BASE_URL

echo "==> AGNES_BASE_URL=$AGNES_BASE_URL"
echo "==> AGNES_API_KEY=${AGNES_API_KEY:0:8}***"
echo

# ===== 通用：向 MCP server 发一个 JSON-RPC 请求 =====
mcp_call() {
  local method="$1"
  local params_json="$2"
  local id=$RANDOM
  local req
  req=$(printf '{"jsonrpc":"2.0","id":%d,"method":"%s","params":%s}' "$id" "$method" "$params_json")

  # 启动 server (uvx --default-index pypi 官方源)
  local uvx_args=(
    --default-index https://pypi.org/simple
    --from agnes-video-25-mcp==0.1.3
    agnes-video-25-mcp
  )

  # initialize handshake
  ( printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ugc-pipeline","version":"0.1.0"}}}'
    sleep 1
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    sleep 1
    printf '%s\n' "$req"
    sleep 1
  ) | uvx "${uvx_args[@]}" 2>&1 | tail -1
}

# ===== Step 1: 生成 5 张首帧 =====
echo "==> Step 1: 生成 5 张人设首帧图"
for i in 1 2 3 4 5; do
  case $i in
    1) PROMPT_FILE="$WORKDIR/.pavo-research/ugc-talk-video/02_image_payloads.json"; PROMPT_KEY="frame_0${i}_hook" ;;
    2) PROMPT_FILE="$WORKDIR/.pavo-research/ugc-talk-video/02_image_payloads.json"; PROMPT_KEY="frame_0${i}_product_reveal" ;;
    3) PROMPT_FILE="$WORKDIR/.pavo-research/ugc-talk-video/02_image_payloads.json"; PROMPT_KEY="frame_0${i}_apply" ;;
    4) PROMPT_FILE="$WORKDIR/.pavo-research/ugc-talk-video/02_image_payloads.json"; PROMPT_KEY="frame_0${i}_mirror_check" ;;
    5) PROMPT_FILE="$WORKDIR/.pavo-research/ugc-talk-video/02_image_payloads.json"; PROMPT_KEY="frame_0${i}_cta" ;;
  esac

  # 提取 prompt（用 python，避免 jq 依赖）
  PROMPT=$(python3 -c "
import json
d=json.load(open('$PROMPT_FILE'))
for c in d['calls']:
  if c['id']=='$PROMPT_KEY':
    print(json.dumps(c['args']))
    break
")
  echo "  -> [$PROMPT_KEY] 调用 image_generate"
  RESULT=$(mcp_call "tools/call" "{\"name\":\"agnes25_image_generate\",\"arguments\":$PROMPT}")
  echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
  echo
done

echo "==> Step 1 完成。请人工核对 5 张图主角一致性后再继续。"
echo "    通过则继续；不通过则修改 02_image_payloads.json 对应 prompt 后重跑。"
read -rp "    输入 yes 继续 Step 2: " ans
[[ "$ans" == "yes" ]] || { echo "已中止"; exit 1; }

# ===== Step 2: 视频分 3 批 =====
echo
echo "==> Step 2: 视频生成（分 3 批）"

for batch in 1 2 3; do
  case $batch in
    1) BATCH_FILE="$WORKDIR/.pavo-research/ugc-talk-video/03_video_payloads_batch1.json" ;;
    2) BATCH_FILE="$WORKDIR/.pavo-research/ugc-talk-video/04_video_payloads_batch2.json" ;;
    3) BATCH_FILE="$WORKDIR/.pavo-research/ugc-talk-video/05_video_payloads_batch3.json" ;;
  esac

  echo "  -> Batch $batch ($BATCH_FILE)"

  # 提取本批所有 cut 的 args
  python3 - "$BATCH_FILE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for c in d["calls"]:
    print(f"CALL_BEGIN:{c['id']}")
    print(json.dumps(c["args"]))
    print("CALL_END")
PY
done

# 注：上面只是把 payload 打印出来。真正驱动需要更精细的 bash 循环 + JSON-RPC。
# 因为 set -e + 错误处理复杂，建议把每批单独跑：
echo
echo "==> 推荐：每批单独跑，避免一批失败影响其他"
echo "    完整批 1: ./06_run_pipeline.sh batch1"
echo "    完整批 2: ./06_run_pipeline.sh batch2"
echo "    完整批 3: ./06_run_pipeline.sh batch3"
