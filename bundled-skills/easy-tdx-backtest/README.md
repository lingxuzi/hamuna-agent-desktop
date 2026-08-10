# easy-tdx-backtest

> Skill 让 AI Agent 用 `easy_tdx` 跑 A 股策略回测 / 缠论 / 因子研究 / RSS 策展新闻。

## 这是什么

`easy_tdx.backtest` 是一个**纯计算层**的向量化回测引擎(零网络依赖,可完全离线)。
本 skill 把它的能力封装成 Claude Code / Cursor / 自定义 Agent 能直接调的工具集。

**两套入口,二选一**:

| 入口 | 适合 | 命令 |
|------|------|------|
| **MCP 工具** (`easy-tdx` server) | Agent 在对话里自动调 | `easy-tdx-mcp`(Sidecar 自启) |
| **Python / CLI** | 落盘脚本 / CI / 本地验证 | `easy-tdx backtest ...` |

完整 22 个工具 + 完整工作流见 [`SKILL.md`](./SKILL.md)。

## 安装

Agent 视角:无需操作,Sidecar 启动时自动从 `extended_buildin_mcp/mcp.json` 拉起 `easy-tdx-mcp`。

人 / CI 视角(要直接跑 CLI):

```bash
pip install -e ./stock-sources/easy_tdx
easy-tdx --version    # 验证装上
```

源码在 `stock-sources/easy_tdx/`(vendored,**不要 `pip install easy-tdx` 装 pypi 版本**,会与 vendored 漂移)。

## 覆盖范围

| 模块 | 暴露为 MCP 工具 | 在 SKILL.md 哪节 |
|------|-----------------|----------------|
| 行情 / 复权 | `get_kline` / `get_quote` / `get_index_kline` / `get_quote_batch` / `get_minute_time_data` / `get_xdxr_info` / `get_finance_info` / `get_market_stat` / `list_blocks` / `ping` | 「MCP 工具用法」 |
| 公告 | `list_announcements`(巨潮) | 同上 |
| 指标 / 因子 | `list_indicators` / `compute_indicators` / `list_factors` / `compute_factors` | 同上 |
| 回测 | `run_backtest` / `run_combo_backtest` / `list_strategies` | 同上 |
| 缠论 | `run_chanlun` | 同上 |
| 策展新闻 | `get_news` / `news_sync_status` / `news_list_sources` | 同上 |

**不暴露**:`realtime` 流式行情 / `tray` 托盘 / `web` HTTP / `cli` 命令行 / `screen`/`offline` 本地快照 / `portfolio` 优化器 / `FactorAnalyzer` 长报告 / `get_security_list_all` 网络重 / `get_company_info_*` 字节下载。理由详见 SKILL.md 「Not exposed via MCP」。

## 16 个内置策略骨架

`stock-sources/easy_tdx/strategies/*.py` — 纯计算、无副作用,**只用来参考 `Strategy` 子类的写法约定**(`init()` / `next()` / `self.data` / `self.I(...)` / `self.buy()` / `self.sell()` 这些固定契约),**不是要你复制改**。新策略应该照自己思路写,不要硬塞进某个模板里。

按类型分:

- 均线交叉:`ma_cross` / `macd_cross` / `kdj_golden` / `trix_cross` / `expma_cross`
- 反转 / 突破:`rsi_reversal` / `bias_reversal` / `cci_breakout` / `bollinger_breakout` / `turtle_breakout`
- 量价 / 动量 / 特色:`obv_trend` / `dmi_trend` / `mfi_volume` / `volume_price` / `mtm_momentum` / `zhuoyao_momentum`

每个含 docstring 第一行说明策略意图,Agent 写新策略前可读 1-2 个结构最像的学骨架,逻辑(信号条件 / 止损 / 仓位)完全自由。

## 风险与边界

| 风险 | 缓解 |
|------|------|
| 网络依赖 | `run_backtest` / `get_kline` / `list_announcements` / news 工具都要联网;`compute_*` / `list_*` / `run_chanlun` / Python `BacktestEngine.run(df)` 离线 |
| 资金风险(实盘) | 本 skill 只做研究/回测,**不接实盘交易**;策略文件执行的资金参数都是模拟 |
| 执行风险(策略文件) | CLI 用 `importlib` 执行 strategy_file,等价于跑任意 Python 代码;默认信任 AI 生成的策略,不要拿不明来源的 .py 直接跑 |
| 数据漂移 | `pip install easy-tdx`(pypi 版本)与 vendored 源码可能漂移,**始终用 vendored 路径** |
| 框架混淆 | 本 skill 只覆盖 `easy_tdx`;`backtrader` / `vectorbt` / `zipline` / `quantstats` / QStock / AKShare / vn.py / MT5 不在范围 |

## 不做什么

- 不接实盘交易 API(中泰 / 华泰 / 国君 / Interactive Brokers …)
- 不做实时行情推送(WebSocket)
- 不跑机器学习模型(这是回测 skill,不是 ML skill)
- 不替代量化研究平台(MiniQ / 米筐 / 优矿 …)

## 触发示例

用户说以下任意一条,本 skill 应被触发:

- "写一个双均线策略" / "跑一下 easy_tdx" / "MACD 策略" / "缠论策略" / "组合回测"
- "前复权" / "除权除息" / "easy-tdx backtest" / "A 股回测" / "通达信回测"
- "回测" / "通达信" / "策略" / "缠论" / "分型" / "笔" / "线段" / "中枢" / "买卖点" / "背驰"
- "AI 新闻" / "半导体快讯" / "RSS 聚合" / "行业新闻"

不触发:用户说"backtrader 怎么用" / "vectorbt 教程" / "vn.py 接入 IB" — 推荐安装对应框架。

## 排错速查

| 现象 | 看哪 |
|------|------|
| MCP 工具列表里看不到 `easy-tdx` | Settings → MCP 看 `easy-tdx` 是否启用 / `~/.hamuna/logs/unified-{date}.log` 搜 `[easy_tdx.mcp]` |
| `easy-tdx` 命令找不到 | `pip install -e ./stock-sources/easy_tdx` + `which easy-tdx` |
| 策略 0 笔成交 | `warmup_bars` 设太大 / 信号条件写错 / 数据 < 指标预热长度 |
| `sharpe` 异常高 | 大概率是 `this_close` 未来函数 — 看 `result.config.future_leak_warning` |
| 回测结果与 CLI 不一致 | MCP `run_backtest` 与 CLI 用同一引擎,但 CLI 多了 `--execution` / `--combo-mode` 等限制 — 见 SKILL.md 「CLI 已知约束」 |

## 文档位置

- 本 README:面向人,介绍 skill 边界与依赖
- [`SKILL.md`](./SKILL.md):面向 AI,完整 22 工具用法 / 工作流(挑骨架 → 自己写 → smoke → CLI 验证 → HTML 报告) / 性能指标解读 / pit-of-success
- 仓库 vendored 源码 API:`stock-sources/easy_tdx/docs/backtest_usage.md`