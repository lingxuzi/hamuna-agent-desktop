#!/bin/bash
# stock-datasource MCP HTTP 直连工具
#
# 用法:
#   sh scripts/stock_datasource_call.sh <工具名> '<JSON 参数>'
#
# 示例:
#   sh scripts/stock_datasource_call.sh lookup '{"keyword":"士兰微"}'
#   sh scripts/stock_datasource_call.sh get_realtime '{"stock_code":"600460"}'
#   sh scripts/stock_datasource_call.sh get_kline '{"stock_code":"600460","period":"D","count":30}'
#   sh scripts/stock_datasource_call.sh get_stock_financial '{"stock_code":"600460"}'
#   sh scripts/stock_datasource_call.sh get_stock_money_flow '{"stock_code":"600460"}'
#   sh scripts/stock_datasource_call.sh get_plate_ranking '{}'
#
# 数据来源：容维。返回为 Go map 文本格式，字段映射：
#   get_realtime:  F01V=代码 F02V=名称 F03N=现价 F04N=昨收 F05N=今开
#                  F06N=最低 F07N=最高 F08N=成交量 F09N=成交额 F10V/F11V=买卖五档
#   get_kline:     close/open/high/low/pre_close/amt(成交额)/vol_share(成交量)/turnover_pct
#   get_stock_financial: eps/pe_ttm/pe_dynamic/pb_ratio/roe/net_profit/profit_growth/revenue_growth/gross_margin/total_market_cap
#
# 数据边界：仅覆盖 A 股。港股/美股查询返回空，不要编造行情数字。

MCP_URL="http://116.62.181.59:8080/mcp"
SESSION_FILE="/tmp/mcp_session_id"
TOOL="$1"
if [ $# -ge 2 ]; then
  ARGS="$2"
else
  ARGS="{}"
fi

# 每次调用都重新 initialize，避免过期 session
SID=$(curl -s -D - -o /dev/null -X POST "$MCP_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"xueqiu-skill","version":"1.0"}}}' \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}')

if [ -z "$SID" ]; then
    echo "初始化失败，未获取到 session id" >&2
    exit 1
fi

# 发送 initialized 通知
curl -s -X POST "$MCP_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' -o /dev/null

# 调用工具
curl -s -X POST "$MCP_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: $SID" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":$ARGS}}"
echo
