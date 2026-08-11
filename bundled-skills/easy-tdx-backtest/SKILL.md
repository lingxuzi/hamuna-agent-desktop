---
name: easy-tdx-backtest
description: Use the `easy_tdx` library (vendored at `stock-sources/easy_tdx/`) to query A-share market data and run quantitative trading backtests via its vectorized `BacktestEngine`. This skill is wired to the bundled `easy-tdx` MCP server (registered in `extended_buildin_mcp/mcp.json`); use those MCP tools when available. v2 exposes 22 MCP tools covering 行情/复权/指数/分时/财务/公告/板块/缠论/多策略组合/因子库/RSS 策展新闻. Trigger whenever the user wants to (a) write a new trading/backtest strategy in Python for `easy_tdx`, (b) run a backtest against A-share K-line data — real `TdxClient` data or synthetic — via `BacktestEngine`, (c) inspect a backtest result (performance metrics, equity curve, trades, positions) and explain or critique it, (d) tune engine parameters (commission / slippage / execution mode / position mode / warmup bars / stop-loss & take-profit), (e) load or debug a strategy file for the `easy-tdx` CLI (`easy-tdx backtest ... --strategy-file ...`), (f) adapt one of the bundled strategies under `stock-sources/easy_tdx/strategies/*.py` into a variant, (g) pull 指数 K 线 / 实时分时 / 除权除息 / 财务摘要 / 板块列表 / 巨潮公告 for a stock, (h) run 缠论分析 on K-line bars (分型/笔/线段/中枢/买卖点), (i) screen N 选 K strategy combinations ranked by total_return, (j) query curated RSS news across 12 industries via `get_news` / `news_sync_status` / `news_list_sources` (启动时 daemon thread 后台同步 ~108 个 tier-1 源到 `~/.easy_tdx/news.db`), or **(k) translate an `easy_tdx` Strategy class into 迅投 QMT innerApi Python code (init/handlebar/passorder)** for the QMT editor's built-in Python 3.6 runtime. Trigger proactively on phrases like "回测", "写个策略", "跑一下 easy_tdx", "MACD 策略", "缠论策略", "组合回测", "前复权", "除权除息", "easy-tdx backtest", "A 股回测", "通达信回测", "AI 新闻", "半导体快讯", "RSS 聚合", "行业新闻", **"导出 QMT", "翻译成 QMT", "QMT 代码", "在 QMT 跑", "回测转 QMT", "导出到 QMT", "QMT 策略", "迅投 QMT", "大QMT", "miniQMT", "XtQuant"**. Do NOT use this skill for non-`easy_tdx` frameworks (backtrader, vectorbt, zipline, quantstats, QStock, AKShare backtests, vn.py, MT5) — for those, recommend the user install the framework separately.
author: HamunaAgent
version: 2
---

# easy-tdx 回测引擎 Skill

`easy_tdx.backtest` 是一个**纯计算层**的向量化回测引擎：写 `Strategy` 子类，喂一个 OHLCV DataFrame，拿到 `BacktestResult`（绩效 + 资金曲线 + 交易记录 + 持仓快照 + 配置快照）。零网络依赖，可以完全离线用合成数据跑通。

**两个使用入口，二选一**：

1. **MCP 工具（推荐，AI Agent 自动可调）** —— `easy-tdx` MCP server 已经通过 `extended_buildin_mcp/mcp.json` 注册，Sidecar 启动后会作为内置 MCP 出现。**v2 共 22 个工具**：行情与复权（ping/get_kline/get_index_kline/get_quote/get_quote_batch/get_minute_time_data/get_xdxr_info/get_finance_info/get_market_stat/list_blocks）、公告（list_announcements）、指标与因子（list_indicators/compute_indicators/list_factors/compute_factors）、回测（run_backtest/run_combo_backtest/list_strategies）、缠论（run_chanlun）、策展新闻（get_news/news_sync_status/news_list_sources）。当你在对话里调用这些工具时，自动走这条路。
2. **Python 进程内调用** —— 直接 `import easy_tdx` 写脚本。仓库 `stock-sources/easy_tdx/src/easy_tdx/` 是 vendored 源码（**不要 `pip install`**），把 `src/` 加到 `sys.path` 即可。CLI 模式：`easy-tdx backtest SZ 000001 --strategy-file my_strategy.py --table`。

源码位置：`stock-sources/easy_tdx/`（仓库内 vendored 副本），完整 API 文档在 `stock-sources/easy_tdx/docs/backtest_usage.md`。

## Quick start — 最小可运行例子（Python 进程内）

```python
import pandas as pd
import numpy as np
import sys

# 仓库内 vendored 源码路径
sys.path.insert(0, "stock-sources/easy_tdx/src")

from easy_tdx.backtest import BacktestEngine, Strategy, crossover
from easy_tdx import MyTT

class DualMA(Strategy):
    def init(self):
        self.ma5 = self.I(MyTT.MA, self.data.close, 5)
        self.ma20 = self.I(MyTT.MA, self.data.close, 20)
        self.gold = crossover(self.ma5, self.ma20)
        self.death = crossover(self.ma20, self.ma5)

    def next(self):
        i = self._bar_index
        if self.gold[i] and self.position["size"] == 0:
            self.buy(size=0)              # size=0 = 全仓（引擎自动算 100 股整手）
        elif self.death[i] and self.position["size"] > 0:
            self.sell(size=0)

# 合成 200 根日线（无网络也能跑）
rng = np.random.default_rng(42)
close = 10 + np.cumsum(rng.normal(0, 0.2, 200))
df = pd.DataFrame({
    "datetime": pd.date_range("2024-01-01", periods=200, freq="D"),
    "open":   close + rng.uniform(-0.1, 0.1, 200),
    "close":  close,
    "high":   close + rng.uniform(0, 0.3, 200),
    "low":    close - rng.uniform(0, 0.3, 200),
    "vol":    rng.integers(10_000, 100_000, 200),
})

result = BacktestEngine(DualMA, cash=100_000, commission=0.0003).run(df)
print(result.summary())
print(result.performance["sharpe"], result.performance["max_drawdown"])
```

把上面贴到一个 `.py` 里 `python script.py` 就能出结果。

## MCP 工具用法（Agent 直接调，共 22 个）

### 行情与复权（10）

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `ping` | 健康检查，挑最优通达信 host | — |
| `get_kline` | 取个股历史 K 线 | `market`, `code`, `period` (DAY/WEEK/.../1MIN/.../60MIN), `count` (≤800), `adjust` (NONE/QFQ/HFQ) |
| `get_index_kline` | 取指数 K 线（沪深300/中证500/...） | `market`, `code`, `period`, `count`, `adjust`（指数无除权，adjust 接受但不生效） |
| `get_quote` | 单只实时报价 | `market`, `code` |
| `get_quote_batch` | 批量实时报价（≤80/req 自动分块） | `items: [{market, code}, ...]` |
| `get_minute_time_data` | 分时数据 | `market`, `code`, `date?` (None=当天; int=YYYYMMDD) |
| `get_xdxr_info` | 除权除息历史（分红/送转/配股/扩缩股） | `market`, `code` |
| `get_finance_info` | 最新财务摘要（总资产/净资产/净利润/股东人数） | `market`, `code` |
| `get_market_stat` | 大盘统计（涨跌/平/涨跌停家数） | — |
| `list_blocks` | 板块列表 | `filename?` (block_gn.dat 概念 / block_zs.dat 指数 / block_hy.dat 行业 / block_fg.dat 风格 / block_dq.dat 地区) |

### 公告（1）

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `list_announcements` | 巨潮资讯网公司公告（独立 HTTP，零 TDX 依赖） | `code`, `count?` (默认 30) |

### 指标 / 因子（4）

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `list_indicators` | 列出所有技术指标的元数据 | — |
| `compute_indicators` | 在 bars 上预计算技术指标 | `bars`, `indicators`, `params?`, `keep_ohlcv?`, `tail?` |
| `list_factors` | 列出所有量化因子（动量/质量/波动/成交量/估值/技术/缠论） | — |
| `compute_factors` | 在 bars 上预计算因子 | `bars`, `factors`（先调 `list_factors` 拿真实 `name`，**全小写下划线**：`momentum_20d` / `volatility_20d` / `pe_ratio` / `rsi_14` / `chanlun_mmd` 等；拼错会抛 ValueError 列可用清单） |

### 回测（3）

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `run_backtest` | 跑策略回测 | `strategy_file`, `market`, `code`, `cash`, `commission`, `execution`, `period`, `count`, `indicators?`, `output_format` (summary/full) |
| `run_combo_backtest` | 多策略组合回测：跑所有 N 选 K 组合，按 total_return 排序 | `strategy_files: [paths...]`, `market`, `code`, `cash`, `commission`, `execution`, `period`, `count`, `combo_sizes?` (默认 [2,3]), `mode?` (MAJORITY/AND/OR), `top_n?` (默认 20), `indicators?` |
| `list_strategies` | 列内置策略模板 | `directory?`（不传看 vendored 的 `strategies/`） |

### 缠论（1）

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `run_chanlun` | 对 bars 做缠论分析（分型/笔/线段/中枢/买卖点/背驰） | `bars`, `code`, `period?` (默认 DAY) |

**推荐工作流**（AI Agent 编排）：

1. `list_strategies` / `list_indicators` / `list_factors` 看可用模板与指标/因子清单
2. `get_kline(market, code, adjust="QFQ")` 拉目标标的的复权 K 线（**前复权通过 MAC 协议实现**；服务端返回负价时本地 NONE+XDXR 重算兜底，详见 "复权" 节）
3. （可选）`compute_indicators` / `compute_factors` 在 bars 上加特征列，让策略直接读
4. `run_backtest` 出单策略绩效；`run_combo_backtest(strategy_files=[...])` 跑 N 选 K 组合，按 total_return 降序取 top_n
5. 解读 `performance` 字段：总收益 / 年化 / 最大回撤 / 夏普 / 胜率
6. （可选）`run_chanlun(bars, code, period)` 对 K 线做缠论分析（分型/笔/线段/中枢/买卖点/背驰）
7. （可选）`get_xdxr_info` / `get_finance_info` / `list_announcements` 拉除权除息、财务、公告事件做归因
8. （可选）`get_market_stat` / `list_blocks` 看大盘状态与板块动向
9. 调优参数（`cash` / `commission` / `execution` / 策略本身），观察 `performance` 是否稳定

`strategy_file` 必须是绝对路径或相对 Sidecar 工作目录的路径（MCP 服务进程的 cwd = 仓库根目录）。文件需含一个 `XxxStrategy(Strategy)` 子类。

### 复权（`get_kline` 的 `adjust` 参数）

`adjust=QFQ/HFQ` 通过 **MAC 协议** 实现（`MacClient.get_stock_kline(adjust=Adjust.QFQ/HFQ)`），而不是裸调 `TdxClient.get_security_bars` 后再算。对深层历史重除权股（服务端 QFQ 返回负价），MAC 客户端内置 fallback：自动 fallback 到本地 `apply_forward_adjust(df_none, xdxr_df)` 重算。指数 K 线无除权除息，`adjust` 参数接受但不生效。

### 多策略组合回测（`run_combo_backtest`）

传入多个策略文件路径，引擎跑所有 N 选 K 组合（默认 2/3），按 `total_return` 降序返回前 N 名。`mode` 控制合并方式：`MAJORITY`（多数票）/ `AND`（全部满足才买）/ `OR`（任一满足就买）。返回的每条 result 含 `indices`（命中的策略索引）、`size`（组合大小）、`performance`（绩效字典）。

**MCP vs CLI 大小写差异**：MCP `run_combo_backtest(mode="MAJORITY")` 用大写枚举；CLI `--combo-mode majority` **只接受小写**。Agent 写代码时按调用入口选大小写,两者不能混。

### 缠论分析（`run_chanlun`）

`ChanlunAnalyser(code, frequency).process_klines(df)` 返回 `ChanlunResult`，dict 化后含 `bis`（笔列表）、`zss`（中枢列表）、`xds`（线段列表）、`mmds`（买卖点列表）、`bcs`（背驰列表）。需要 ≥20 根 bar；bars 直接来自 `get_kline` 输出。MCP 不暴露单根 tick-level 缠论（性能 + 数据量考虑）。

### 公告/财务/大盘（无策略的场景）

| 场景 | MCP 调用 |
|------|----------|
| 看个股最新公告 | `list_announcements(code='688017', count=10)` |
| 看个股最近一期财务 | `get_finance_info(market='SH', code='688017')` |
| 看大盘当日涨跌停家数 | `get_market_stat()` |
| 看概念/行业板块列表 | `list_blocks(filename='block_gn.dat')` |
| 看个股除权除息历史 | `get_xdxr_info(market='SH', code='600519')` |

### 策展新闻（RSS 聚合，独立数据源）

| 场景 | MCP 调用 |
|------|----------|
| 看 AI 行业最近 10 条 | `get_news(industry='ai', limit=10)` |
| 按关键词搜索 | `get_news(keyword='LLM', limit=30)` |
| 单源查询 | `get_news(industry='semi', source='SemiAnalysis', limit=5)` |
| 看上次 sync 元数据 / 诊断空数据 | `news_sync_status()` |
| 列源清单 / 行业列表 | `news_list_sources()` 或 `news_list_sources(industry='robot')` |

**数据流**：`run_server()` 启动时 `schedule_sync()` 在 daemon thread 里 fire-and-forget 抓 80+ 个 tier-1 RSS 源 → 入 `~/.easy_tdx/news.db` (WAL 模式, 7 天 TTL, redline 关键词入库前过滤)。首次 `get_news` 调用可能返回空 — 看 `news_sync_status().persisted.ok` 确认是否已完成首次 sync。覆盖 12 个行业: ai / semi / robot / auto / energy / bio / space / security / tech / consumer / macro / science。配置在 `stock-sources/easy_tdx/news-source/source.json`。

## Not exposed via MCP

下列 `easy_tdx` 模块 / 工具**未**暴露在 MCP。理由分别列出。

| 模块 | 不暴露理由 |
|------|-----------|
| `easy_tdx.realtime.*` | long-poll / WebSocket 推送，与 stdio MCP 的 request/response 协议冲突 |
| `easy_tdx.tray.*` | pystray 托盘要 GUI event loop，不能跑在 stdio 进程 |
| `easy_tdx.web.*` | FastAPI HTTP/WS server，与 MCP stdio 协议不同 |
| `easy_tdx.cli.*` | Click 命令行，走 shell 调即可（`easy-tdx backtest ...`） |
| `screen.SignalScanner` / `screen.StrengthRanker` | 需要 vipdoc 本地 `.day` 文件（用户可能没下） |
| `offline.read_*` | 同上，离线快照需要本地数据文件 |
| `portfolio.*Optimizer` / `RebalanceEngine` | 单次调用的研究工具，Agent 编排困难，且优化器耗时长 |
| `FactorAnalyzer.full_report` | 长文本报告不适合 MCP（>50KB），用 Python 进程内调用 |
| `get_security_list_all` | 网络重（~5000 stocks），应缓存而非 MCP 调 |
| `get_company_info_*` / `get_report_file` / `get_financial_file*` | 字节级下载，无 model 可操作性 |
| `get_fund_flow` | 当日快照，价值低，优先级低 |
| `asyncio.to_thread` 包裹每个 sync `client.get_*` 调用 | 性能优化 PR；当前 sync-in-async 不会卡死（FastMCP server 是单连接流）。**升级路径**：批量接口 + `to_thread` PR |

## 用真实行情数据（Python 进程内）

`easy_tdx` 走通达信协议，无需 API Key。`get_security_bars` 返回的列名是 `date`（不是 `datetime`）— **引擎内部会自动兼容**，不用手动 rename。

```python
from easy_tdx import TdxClient, Market, KlineCategory

client = TdxClient()
df = client.get_security_bars(Market.SZ, "000001", KlineCategory.DAY, 0, 500)
client.close()
# df 含 date/open/close/high/low/vol/amount —— 直接喂给 engine.run(df)
```

## 策略骨架

继承 `Strategy`，**只**实现两个方法：

| 方法 | 何时调用 | 干什么 |
|------|---------|--------|
| `init(self)` | 回测开始前一次 | 用 `self.I(func, *args)` 注册指标；缓存计算结果 |
| `next(self)` | 每根 K 线一次 | 读指标/价格、调 `self.buy()` / `self.sell()` 生成信号 |

**引擎用 close 作为持仓估算**（避免产生信号后看不到自己已建仓），实际成交价由 OrderSimulator 在下一根 bar 按 `execution` 模式撮合。

### 数据访问 `self.data`

```python
self.data.close[0]    # 当前 bar 收盘价
self.data.close[-1]   # 前一根（早期数据不足返回 nan，不抛错）
self.data.high[-2]    # 前两根最高
self.data.open.raw    # 整列 numpy ndarray，喂给 MyTT.MA 等指标
self.data.MACD_DIF    # DataFrame 里若有预计算列，直接拿
```

**负向索引越界返回 `nan` 而非 `IndexError`** —— `if self.data.close[-1] > ...` 在首根 bar 不会崩。如果用 MA20 这种要预热的指标，把 `warmup_bars=20` 传给 `BacktestEngine`，前 20 根不会调 `next()`、不产生信号。

### 指标注册 `self.I(...)`

`self.I()` 帮你把 `_SeriesAccessor` 自动解包成 numpy 数组再调用指标函数。返回值仍是 ndarray，多输出指标（MACD、BOLL、KDJ）解包成 tuple：

```python
self.dif, self.dea, self.macd = self.I(MyTT.MACD, self.data.close)
self.upper, self.mid, self.lower = self.I(MyTT.BOLL, self.data.close, 20)
self.rsi = self.I(MyTT.RSI, self.data.close, 14)
```

**MyTT 完整清单**（MA / EMA / SMA / MACD / KDJ / RSI / BOLL / WR / BIAS / PSY / CCI / TRIX / DMI / OBV / MFI / SAR / VWAP / AROON / FSL / ZHUOYAO / BIAS_SIGNAL 等）：见 `stock-sources/easy_tdx/src/easy_tdx/MyTT.py`，全部 1 级函数签名与通达信/同花顺一致。

**预计算指标列**（不写在 `init()` 里、让引擎算好后注入 DataFrame）：

```python
from easy_tdx.indicator import compute_indicators
df = compute_indicators(df, ["MACD", "KDJ", "BOLL"])  # 追加 MACD_DIF/DEA/HIST, KDJ_K/D/J, BOLL_UPPER/MID/LOWER 等列
# 策略里：self.upper = self.data.BOLL_UPPER
```

### 金叉检测 `crossover(a, b)`

`crossover(a, b)` 返回 bool ndarray，True 表示 **a 在该 bar 从下方穿越 b**（死叉用 `crossover(b, a)`）：

```python
self.gold = crossover(self.ma5, self.ma20)   # ma5 上穿 ma20
self.death = crossover(self.ma20, self.ma5)  # ma20 上穿 ma5
```

### 下单 `self.buy()` / `self.sell()`

```python
self.buy(size=100)                                       # 100 股
self.buy(size=0)                                         # 全仓（按 cash + 100 股整手 + 佣金率自动算）
self.buy(size=100, price=10.5)                           # 限价
self.buy(size=100, stop_loss=9.0, take_profit=12.0)      # 带止损/止盈
self.sell(size=0)                                        # 全部卖出
```

**SL/TP 触发时机**：信号在 bar N 产生，止损止盈在 bar N 检测（low ≤ stop_loss 或 high ≥ take_profit），但**成交延迟到 bar N+1 开盘**，若跳空取对持仓者更不利的实际开盘价（卖出取 `min(下根开盘, 触发价)`）。这避免「假设能在止损价精确成交」的前视偏差。

**当前持仓**：`self.position` 是 `{"size": float}`，正=多头，负=空头（v1 不支持做空）。

## 引擎配置 `BacktestEngine(...)`

| 参数 | 默认 | 何时调 |
|------|------|--------|
| `cash` | 100000 | 模拟资金起点 |
| `commission` | 0.0003 | 佣金率（万三），双向 |
| `min_commission` | 5.0 | 最低佣金（元/笔） |
| `stamp_tax` | 0.001 | 印花税率（千一），**仅卖出** |
| `slippage` | 0.0 | 每股固定滑点 |
| `execution` | `"next_open"` | 成交价规则：`next_open` / `next_close` / `this_close`(⚠未来函数) / `worst`(保守) / `best`(乐观)。**CLI `--execution` 只接受 `next_open` / `next_close`**;`this_close` / `worst` / `best` 只能用 Python `BacktestEngine(...)` 构造,CLI 传了报错 |
| `position_mode` | `"full"` | `full`(全仓自动整手) / `fixed`(严格按 size) / `percent`(size=占总资产比例) |
| `reject_policy` | `"reduce"` | 资金/持仓不足时：`reduce`(减到可执行) / `skip`(拒绝整笔) |
| `warmup_bars` | 0 | 前 N 根不调 `next()`、不产生信号（MA20 设 20） |
| `slippage_model` | None | 高级滑点模型对象（替代固定 `slippage`） |
| `execution_model` | None | 自定义成交模型（绕过默认 OrderSimulator） |
| `benchmark` | None | 用于 alpha/beta 计算的基准 DataFrame |

**A 股现实配置**：`commission=0.00025, min_commission=5.0, stamp_tax=0.001`（2023 后实际佣金率）。

## 结果对象 `BacktestResult`

```python
result = engine.run(df)

result.performance    # dict[str, float] — 19 项绩效指标
result.equity_curve   # DataFrame[datetime, cash, position_value, total, drawdown, drawdown_pct]
result.trades         # DataFrame[datetime, direction, size, price, commission, slippage, pnl, rejected]
result.positions      # DataFrame[datetime, size, avg_price, market_value, unrealized_pnl]
result.config         # dict — 引擎配置快照
result.diagnostic     # str | None — 引擎/分析器的诊断信息
result.summary()      # 打到 stdout 的人类可读摘要
result.to_json()      # 序列化为 JSON 字符串
result.to_dict()      # 序列化为 Python dict（DataFrame → records）
```

### 绩效指标 `result.performance`

| Key | 含义 |
|-----|------|
| `total_return` | 总收益率 |
| `annual_return` | 年化收益率 |
| `max_drawdown` | 最大回撤（比例） |
| `max_dd_duration` | 最大回撤持续 bar 数 |
| `sharpe` | 夏普比率（rf=3% 年化） |
| `sortino` | 索提诺比率（仅负收益标准差） |
| `calmar` | 年化收益 / 最大回撤 |
| `volatility` | 年化波动率 |
| `total_trades` | 完整闭环卖出次数 |
| `win_trades` / `lose_trades` | 盈利/亏损次数 |
| `win_rate` | 胜率 |
| `profit_factor` | 总盈利 / |总亏损| |
| `avg_win` / `avg_loss` / `max_win` / `max_loss` | 盈亏统计 |
| `rejected_trades` | 资金/持仓不足被拒次数 |
| `avg_holding_days` | 平均持仓天数（当前固定 5.0，待改进） |

## CLI 模式

策略写成 `.py` 文件（含一个 `Strategy` 子类），一行命令跑：

```bash
easy-tdx backtest SZ 000001 --strategy-file strategies/ma_cross.py --table
easy-tdx backtest SH 600519 --strategy-file my.py --cash 50000 --commission 0.0003 \
    --execution next_open --period DAILY --count 500 --adjust QFQ
easy-tdx backtest SZ 000001 --strategy-file macd_strategy.py --indicators MACD,KDJ
easy-tdx backtest SZ 000001 --strategy-file combo.py \
    --combo-strategies strategies/macd_cross.py,strategies/rsi_reversal.py \
    --combo-mode MAJORITY
```

CLI 文件**必须**有 `class XxxStrategy(Strategy):` 且只允许一个 Strategy 子类。

## 16 个内置策略参考

`stock-sources/easy_tdx/strategies/` 下：`ma_cross.py` `macd_cross.py` `kdj_golden.py` `rsi_reversal.py` `bollinger_breakout.py` `turtle_breakout.py` `trix_cross.py` `cci_breakout.py` `expma_cross.py` `dmi_trend.py` `bias_reversal.py` `obv_trend.py` `mfi_volume.py` `mtm_momentum.py` `volume_price.py` `zhuoyao_momentum.py` — 任选一个做模板改最稳。

`run_all_strategies.py` 是批量回测脚本：传入一个标的，依次跑全部 16 个策略输出对比表。

## 进阶用法（按需展开）

**多因子组合**：`from easy_tdx.backtest import CombinationRunner`，给多个 `Strategy` 类 + 合并模式（AND/OR/MAJORITY），引擎内做信号投票。CLI 用 `--combo-strategies a.py,b.py --combo-mode MAJORITY`。

**缠论分析**：`engine = BacktestEngine(ChanlunStrategy, chanlun_level="DAILY")`，引擎自动调 `ChanlunAnalyser`，策略内 `self.chanlun` 拿结果（dict 格式：mmd / fx / bi / zs 等）。

**高级滑点 + TWAP 执行**：
```python
from easy_tdx.backtest.slippage import PercentSlippage, SquareRootSlippage
from easy_tdx.backtest.execution import TWAPExecution

engine = BacktestEngine(
    MyStrategy,
    slippage_model=SquareRootSlippage(impact=0.1),
    execution_model=TWAPExecution(slices=5),
)
```

**成本归因**：`from easy_tdx.backtest.attribution import AttributionAnalyzer; AttributionAnalyzer().analyze(result)` — 把收益分解为价格 / 佣金 / 印花税 / 滑点四项贡献。

**参数寻优**：`from easy_tdx.backtest.optimizer import GridSearchOptimizer`，对策略 `init()` 中的参数做网格搜索 + 绩效排名。

## MCP 服务运维要点

`easy-tdx` MCP server 由 `extended_buildin_mcp/mcp.json` 注册：

- 命令：`uvx --from ./stock-sources/easy_tdx --with mcp>=1.10 easy-tdx-mcp`
- `uvx.exe` 是 Sidecar 自带的（位于 `src-tauri/resources/uvx.exe`，PATH 注入）
- Sidecar cwd 是仓库根目录，所以 `./stock-sources/easy_tdx` 是相对路径
- MCP 进程继承 Sidecar 的 `UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`（国内镜像）
- 服务进程在 stderr 打日志（`logging` 输出 `easy_tdx.mcp` logger）

**CLI 安装（可选,MCP 路径不需要）**：本地或 CI 里要直接跑 `easy-tdx backtest` 验证策略,装：

```bash
pip install -e ./stock-sources/easy_tdx
which easy-tdx && easy-tdx --version     # 验证装上
```

CLI 与 MCP 共用同一个 easy_tdx 包,不会版本漂移。如果 `which easy-tdx` 找不到,先排查 PATH 与 pip 是否落在同一 Python 环境(venv / uv tool)。

**首次启动较慢**（uvx 装 easy_tdx + mcp 依赖需要几秒到十几秒）。后续启动命中 uvx 缓存，几百毫秒。

如果 MCP 工具列表里看不到 `easy-tdx`，按顺序排查：

1. Settings → MCP 看 `easy-tdx` 是否启用
2. `~/.hamuna/logs/unified-{date}.log` 搜 `[easy_tdx.mcp]` 或 `[extended-builtin-mcp]`
3. 手工跑一遍 `uvx --from ./stock-sources/easy_tdx --with mcp>=1.10 easy-tdx-mcp`，看 uvx 报什么

## 生成策略 + CLI 验证回测（推荐落地路径）

用户明确要"写一个新策略并验证"时的标准流程：先读 vendored `strategies/` 里的骨架理解约定 → 自己写新策略(模板只是参考骨架,不是必须复制改) → 用合成数据离线 smoke test → CLI 跑真行情验证 → 解读指标 → 调参。每一步失败都能定位。

### Step 1. 理解骨架(模板只供参考,不要求复制)

`stock-sources/easy_tdx/strategies/` 下有 16 个内置策略(均为公开代码、纯计算、不联网)。**它们的作用是帮你理解 `Strategy` 子类的写法约定** —— `init()` 注册指标 / `next()` 出 BUY/SELL 信号 / `self.data` 访问 K 线 —— **而不是让你必须套模板写**。如果你的策略逻辑跟 16 个模板都不一样(比如多因子合成 + 持仓动态调权),直接照自己思路写,不要硬塞进某个模板里。

读模板的正确姿势：先调 `list_strategies` (MCP) 或 `ls stock-sources/easy_tdx/strategies/*.py` (本地),挑 1-2 个**结构上最像**的(比如你要写"双均线+止损",就读 `ma_cross.py` 看 BUY/SELL 怎么写、止损在哪儿加),只看骨架,不抄逻辑。

16 个模板按类型:

| 类型 | 文件 |
|------|------|
| 均线交叉 | `ma_cross.py` / `macd_cross.py` / `kdj_golden.py` / `trix_cross.py` / `expma_cross.py` |
| 反转 / 突破 | `rsi_reversal.py` / `bias_reversal.py` / `cci_breakout.py` / `bollinger_breakout.py` / `turtle_breakout.py` |
| 量价 / 动量 / 特色 | `obv_trend.py` / `mfi_volume.py` / `volume_price.py` / `mtm_momentum.py` / `dmi_trend.py` / `zhuoyao_momentum.py` |

### Step 2. 自己写新策略(空文件起,不复制)

写到 `~/.hamuna/tmp/my_strategy.py`(不进 git 的草稿区):

```python
from easy_tdx.backtest import Strategy, crossover
from easy_tdx import MyTT

class MyStrategy(Strategy):     # 类名 XxxStrategy 即可
    def init(self) -> None:
        # 注册指标 + 计算信号(只跑一次)
        self.ma5 = self.I(MyTT.MA, self.data.close, 5)
        self.ma20 = self.I(MyTT.MA, self.data.close, 20)
        self.golden = crossover(self.ma5, self.ma20)
        self.death = crossover(self.ma20, self.ma5)

    def next(self) -> None:
        # 每根 bar 出信号(从模板学到的就是这一行)
        if self.golden[self._bar_index] and self.position["size"] == 0:
            self.buy(size=0)
        elif self.death[self._bar_index] and self.position["size"] > 0:
            self.sell(size=0)
```

约定(从模板里看到的固定部分,**这才是模板真正教你的东西**):
- 类名以 `Strategy` 结尾(`XxxStrategy`)
- `init()` 注册指标 / `next()` 出 BUY/SELL 信号 — 这是引擎要求的方法,跟具体策略无关
- 想用预计算指标列(MACD/BOLL/KDJ 等),不要自己算 — 用 `self.data.MACD_DIF[0]` 直接读 DataFrame 列
- 引用周期变量要声明在 `init()` 里做 `self.xxx = self.I(MyTT.MA, self.data.close, N)`,不要写在 `next()` 里(每次 bar 重算)

逻辑(信号条件、止损规则、仓位管理)**完全由你决定**,没有"应该像哪个模板"的限制。

### Step 3. 离线 smoke test（推荐先跑）

合成 200 根 K 线(无网络),确认策略**逻辑可跑通**且**至少成交 1 笔**：

```python
# smoke_test.py — 跑完删掉即可
import sys; sys.path.insert(0, "stock-sources/easy_tdx/src")
import pandas as pd, numpy as np
from my_strategy import MyStrategy          # ← 你写的策略
from easy_tdx.backtest import BacktestEngine

rng = np.random.default_rng(42)
close = 10 + np.cumsum(rng.normal(0, 0.2, 200))
df = pd.DataFrame({
    "datetime": pd.date_range("2024-01-01", periods=200, freq="D"),
    "open":   close + rng.uniform(-0.1, 0.1, 200),
    "close":  close,
    "high":   close + rng.uniform(0, 0.3, 200),
    "low":    close - rng.uniform(0, 0.3, 200),
    "vol":    rng.integers(10_000, 100_000, 200),
})

result = BacktestEngine(MyStrategy, cash=100_000, warmup_bars=20).run(df)
print(result.summary())
assert result.performance["total_trades"] > 0, "策略 0 笔成交 → 看 init() 指标是否注册错"
```

### Step 4. CLI 跑真行情验证

```bash
# 装 easy-tdx CLI(可选,MCP 路径不需要)
pip install -e ./stock-sources/easy_tdx
which easy-tdx && easy-tdx --version

# 单策略回测(看表格)
easy-tdx backtest SZ 000001 \
    --strategy-file ~/.hamuna/tmp/my_strategy.py \
    --cash 100000 \
    --commission 0.0003 \
    --execution next_open \
    --period DAILY \
    --count 500 \
    --adjust QFQ \
    --table

# 缠论策略(自动注入 chanlun,无需手工调 run_chanlun)
easy-tdx backtest SZ 000001 \
    --strategy-file ~/.hamuna/tmp/chanlun_strategy.py \
    --chanlun-level DAILY \
    --table

# 多策略组合(N 选 K,合并信号)
easy-tdx backtest SZ 000001 \
    --combo-strategies ~/.hamuna/tmp/a.py,~/.hamuna/tmp/b.py \
    --combo-mode majority \
    --table

# 输出 JSON 给后续脚本处理
easy-tdx backtest SZ 000001 --strategy-file my_strategy.py --output json
```

**CLI 已知约束**(与 docs/backtest_usage.md 行为差异,写策略时务必注意)：
- `--execution` **只接受 `next_open` / `next_close`**。`this_close` / `worst` / `best` 是 `easy_tdx.backtest.BacktestEngine` Python API 支持,但 CLI 不接受 — 需要这三档走 Python 进程内
- `--combo-mode` **只接受小写** `majority` / `and` / `or`。MCP `run_combo_backtest` 用大写枚举,两者不能混
- `--strategy` DSL 表达式是 P1 占位,传了报错 — 现阶段只用 `--strategy-file`
- 不支持 `--slippage` / `--stamp-tax` 等 CLI flag,这些只能用 Python `BacktestEngine(...)` 构造

### Step 5. 解读输出

CLI 默认 JSON 输出,关键路径：

| 字段 | 含义 | 异常处理 |
|------|------|---------|
| `performance.total_return` | 总收益率 | < 0 不一定是 bug,要看 max_drawdown 是否在容忍范围 |
| `performance.annual_return` | 年化 | 与 total_return 对照,周期 < 1 年时年化会被放大 |
| `performance.max_drawdown` | 最大回撤 | > 30% 通常意味着策略在极端行情爆仓 |
| `performance.sharpe` | 夏普(rf=3% 年化) | < 0 策略无效;1-2 一般;> 2 强;> 3 异常(可能是 this_close 未来函数) |
| `performance.win_rate` | 胜率 | 配合 profit_factor 看(胜率低但盈亏比高也是好策略) |
| `performance.total_trades` | 完整闭环卖出次数 | 0 → 信号没触发(看 warmup_bars / 信号条件 / 数据长度) |
| `config.future_leak_warning` | 是否用了 this_close 等未来函数 | True 时所有结果偏高,别当真 |
| `diagnostic` | 引擎/分析器诊断字符串 | 非空 → 看 stderr |

### Step 6. 调优

固定其它参数,逐项扫：
1. 指标周期(MA5/MA20 → MA10/MA60)
2. SL/TP(`stop_loss` / `take_profit`)
3. 费率(`commission` / `stamp_tax`)
4. 仓位模式(`full` / `fixed` / `percent`)

每改一次重跑 Step 4,记 performance 数字到对照表。**任何一项改动让 sharpe 骤升/骤降 30%+,先怀疑 overfit / future leak / 数据范围不够**。

---

## 工作流速查

1. **明确目标**：用户想回测什么策略？什么标的？什么时间区间？初始资金？
2. **判断入口**：用户是否在 AI 对话里要 Agent 跑数据/回测？是 → 走 MCP 工具；不是（要落盘脚本）→ 走 Python 进程内
3. **拿到数据**：
   - 走 MCP：`get_kline("SZ", "000001", "DAY", 500)` 直接拿 JSON
   - 走 Python：`TdxClient().get_security_bars(Market.SZ, "000001", KlineCategory.DAY, 0, 500)` —— **必须 try/finally client.close()**
   - 无网络：合成 OHLCV DataFrame（参考 Quick Start 的 numpy 模板）
4. **写 Strategy 子类**：`init()` 注册指标 → `next()` 出信号。**先复制一个最接近的 `strategies/*.py` 改**,比从零写稳。如果用户明确要"生成 + 验证",走上面「生成策略 + CLI 验证回测」节,那里有完整 6 步
5. **跑回测**：`BacktestEngine(Strategy, cash=..., commission=..., execution=...).run(df)` 或 MCP `run_backtest`。MA 类策略记得 `warmup_bars`
6. **解读结果**：先看 `result.summary()` 的总收益/年化/最大回撤/夏普,再看 `result.equity_curve` 画资金曲线,最后 `result.trades` 检查是否有异常单(大单、回转过快)
7. **调优参数**：调指标周期、SL/TP、`commission`/`stamp_tax`/`slippage`,观察绩效是否稳定
8. **（可选）成本归因 / 寻优 / 多因子组合**

## Pit of success — 别踩这些坑

| 反模式 | 为什么错 | 正确做法 |
|--------|---------|---------|
| 策略里写 `df.iloc[i]` 直接拿 DataFrame 列 | 引擎用的是 numpy 数组代理，混用会错位 | 用 `self.data.close[0]` 或 `self.data.close.raw` |
| 跑最后一根 bar 时信号还在悬空 | `next_open` 模式下，最后一根的信号没下一根可成交 | 提醒用户，或用 `next_close` 模式 |
| 全仓买入被吞掉 0.x 股 | A 股 100 股整手，`size=0` 自动 floor 到 100 倍数 | 接受就好，或用 `position_mode="fixed"` + 自己算 |
| 用 `position_mode="percent"` 时算不清 size | size 是占总资产比例（0.5 = 50%），引擎算整手 | 文档说明在 `position_mode` 节 |
| 同一 bar 同时 BUY + SELL | 引擎会先 BUY 建仓再 SELL 平仓，但 `position["size"]` 状态没及时反映 | 用 `self.position["size"] > 0` 守门，而不是本地变量 |
| 写完策略发现 `total_trades = 0` | 信号在最后一根 bar，或 warmup_bars 设太大 | `print(len(result.trades))` 排查；`equity_curve` 末尾看 cash 是否等于 initial |
| 用 `this_close` 模式却没意识到未来函数 | 引擎诊断字段 `result.diagnostic` 会标记警告 | 主动检查 `diagnostic`；研究用途才用 |
| 想做空 | v1 不支持 | 等 v2；现版本 sell 数量会被截到当前持仓 |
| `client.get_security_bars` 返回 `date` 列 | 引擎自动兼容，但若你后处理 df 别 rename 成 `datetime` 又删 `date` —— 引擎会找不到列 | 直接传原 df，引擎自己处理 |
| `pip install easy-tdx` 装了 pypi 版本 | 跟仓库 vendored 的源码版本可能漂移，行为/接口差异常常发生在这种地方 | 用仓库内 vendored 路径：`sys.path.insert(0, "stock-sources/easy_tdx/src")`；CLI 用 `easy-tdx backtest ...`（仓库 CLI 不存在时再装 pypi） |
| 把 easy_tdx 跟 eltdx 搞混 | eltdx 是另一个通达信库，接口不同 | 本 skill 只谈 easy_tdx；MCP server 名是 `easy-tdx`，eltdx 是另一个 |

## 导出 QMT 代码（把 easy_tdx Strategy 翻译成 QMT innerApi）

> 适用：用户在 QMT 编辑器里跑策略（迅投大QMT / miniQMT），但回测研发在 `easy_tdx.backtest` 里完成 — 想把已经写好、回测验证过的策略文件直接落地成 QMT 可执行的 Python 3.6 代码。QMT innerApi 的 API 真相见 `docs/QMT_INNERAPI.md`（本仓库内有完整中文版）；workflow / discipline 见 `bundled-skills/qmt-strategy/SKILL.md`。**本节负责把 `Strategy` 子类 → `init/handlebar/passorder` 的翻译规则**，workflow / 11 条 discipline 自检 / 回测参数配置交给 qmt-strategy skill。

### 翻译速查（Strategy → QMT）

| `easy_tdx.backtest` 元素 | QMT innerApi 对应 | 关键差异 |
|---|---|---|
| `class XxxStrategy(Strategy)` | 模块顶层 + `def init(C)` + `def handlebar(C)` | 必须**同时**定义两个函数；类容器改函数 |
| `self.I(MyTT.MA, close, N)` | `C.get_market_data_ex(['close'], [stock], end_time, period, count) → ema/ma 手写` | QMT 不一定有 `talib`，手写 EMA/SMA/RSI（骨架函数见 §模板 A） |
| `crossover(a, b)` | 手动 `(pre_a <= pre_b) and (cur_a > cur_b)` | QMT Py3.6 无 helper |
| `self.data.close[0]` | `closes[-1]`（`get_market_data_ex` 返回 DataFrame） | 取数方式不同 |
| `self._bar_index` / `self.position["size"]` | `C.barpos` / `get_trade_detail_data(..., 'position')` | QMT 通过 `position` 对象查持仓 |
| `self.buy(size=0)` (全仓) | `account_obj.m_dAvailable → vol=available/price/100*100 → passorder(23, 1101, ..., 5, -1, vol, ..., C)` | opType=23 买, 24 卖; prType=5 最新价; price=-1 |
| `self.sell(size=0)` (全平) | `holding_vol = 持仓查询 → passorder(24, 1101, ..., 5, -1, holding_vol, ..., C)` | 同上 24 卖 |
| `stop_loss=N / take_profit=M` | `handlebar` 里手动检测 `last_price <= entry * (1-pct)` → 触发 `passorder(24, ...)` | QMT 没 stop_loss 参数内置；自己写 |
| `MyTT.MACD(close, 12, 26, 9)` → (dif, dea, macd) | 手写 `ema(close, 12) - ema(close, 26)` + `ema(dif, 9)` | 见 §模板 A 的 `ema()` |
| `MyTT.RSI(close, 14)` | Wilder 平滑 RSI（`rsi_calc()` 模板） | §模板 A 的 `rsi_calc()` |

### 翻译 5 步（workflow）

1. **先跑回测验证 easy_tdx 策略**：用 `run_backtest` / CLI 拿到 `result.performance`（总收益 / 夏普 / 最大回撤 / `total_trades>0`）。**没有验证过的策略不要翻译** — QMT 调试费时，回测先行最便宜。
2. **读 §模板 A**（下方）：拿到 `init(C)` + `handlebar(C)` 的骨架、`ema()` / `rsi_calc()` 助手、`MODE toggle` 顶部常量块。把 easy_tdx 策略里的 `init()` 指标逐个手写为 QMT 形式。
3. **映射信号条件**：金叉/死叉写 `(pre_a <= pre_b) and (cur_a > cur_b)`；全仓买入写 `available → vol → passorder(23, ...)`；硬止损写 `if last_price <= entry * (1 - pct): passorder(24, ...)`。
4. **填回测参数**：参考 `bundled-skills/qmt-strategy/references/backtest-config.md`。A 股默认：`front_ratio` 复权 / `0.0003` 佣金 / `0.001` 印花税 / `0.3` 最大成交比例 / 基准 `000300.SH`。
5. **跑 QMT discipline 自检**（11 条）：`bundled-skills/qmt-strategy/references/skeleton.md §11`。**最容易丢的 4 条**：① `#coding:gbk` 首行；② `class A` 状态容器（不放 ContextInfo attrs）；③ `m_strRemark` 每笔 < 24 字符；④ `quickTrade` 跟场景一致（日线回测 = 0；实盘 = 2）。

### 翻译模板 A — 完整 `init/handlebar/EMA/RSI` 骨架

```python
#coding:gbk
# type: ignore   # QMT 内置全局 (timetag_to_datetime / get_trade_detail_data / passorder / account) 无静态类型

import numpy as np


# === 用户配置 — 改这里 ================================================
MODE = 'backtest'                  # 'backtest' | 'live'
ACCOUNT_ID = 'testS'               # 回测: 任意字符串; 实盘: '' 用界面账号
ACCOUNT_TYPE = 'STOCK'             # 实盘: '' 用界面账号类型
STOCK_CODE = '000001.SZ'
START_DATE = "2020-01-01 00:00:00"
END_DATE   = "2024-12-31 00:00:00"
INIT_CAPITAL = 1000000
# =====================================================================


class A(object):
    """Runtime state — never on ContextInfo attrs (those deep-copy per bar)."""
    is_backtest = (MODE == 'backtest')
    quick_trade = 0 if is_backtest else 2     # 0=回测, 2=实盘
    entry_price = 0.0
    holding_vol = 0
    # init() 运行时注入
    stock = ''
    account = ''
    accountType = ''


def ema(values, period):
    """EMA 序列 (QMT 内置 Py3.6 不一定有 talib, 手写)."""
    vals = np.asarray(values, dtype=np.float64)
    if len(vals) < period:
        return np.full_like(vals, np.nan)
    alpha = 2.0 / (period + 1.0)
    out = np.empty_like(vals)
    seed = np.mean(vals[:period])
    out[:period - 1] = np.nan
    out[period - 1] = seed
    for k in range(period, len(vals)):
        out[k] = alpha * vals[k] + (1.0 - alpha) * out[k - 1]
    return out


def rsi_calc(values, period):
    """Wilder 平滑 RSI."""
    vals = np.asarray(values, dtype=np.float64)
    if len(vals) < period + 1:
        return np.full_like(vals, np.nan)
    diff = np.diff(vals)
    gains = np.where(diff > 0, diff, 0.0)
    losses = np.where(diff < 0, -diff, 0.0)
    avg_gain = np.empty(len(vals)); avg_gain[:] = np.nan
    avg_loss = np.empty(len(vals)); avg_loss[:] = np.nan
    avg_gain[period] = np.mean(gains[:period])
    avg_loss[period] = np.mean(losses[:period])
    for k in range(period + 1, len(vals)):
        avg_gain[k] = (avg_gain[k - 1] * (period - 1) + gains[k - 1]) / period
        avg_loss[k] = (avg_loss[k - 1] * (period - 1) + losses[k - 1]) / period
    rs = np.where(avg_loss == 0, np.inf, avg_gain / avg_loss)
    rsi = np.where(np.isinf(rs), 100.0, 100.0 - 100.0 / (1.0 + rs))
    return rsi


def init(C):
    A.stock = C.stockcode + '.' + C.market
    A.account     = ACCOUNT_ID   if ACCOUNT_ID   else account
    A.accountType = ACCOUNT_TYPE if ACCOUNT_TYPE else accountType
    A.entry_price = 0.0
    A.holding_vol = 0
    if A.is_backtest:
        C.start, C.end, C.capital = START_DATE, END_DATE, INIT_CAPITAL


def handlebar(C):
    # 日线回测 is_last_bar() 永远 True, 无需闸 (no-op)
    bar_date = timetag_to_datetime(C.get_bar_timetag(C.barpos), '%Y%m%d')
    need = 60        # 按策略最大指标周期设
    data = C.get_market_data_ex(['close'], [A.stock],
                                end_time=bar_date, period='1d',
                                subscribe=False, count=need)
    closes = data[A.stock]['close'].values
    if len(closes) < need:
        print(bar_date, '行情不足 跳过')
        return

    # === 在这里放策略核心: ema/ma/rsi → 信号 → passorder ===
    # ... 翻译自 easy_tdx Strategy.next() ...
    # ...
    # === passorder 调用样板 ===
    # 金叉全仓买入:
    #   vol = int(available / last_price / 100) * 100
    #   remark = f"{bar_date[4:]}_b_G"     # ≤24 字符, 唯一标识意图
    #   passorder(23, 1101, A.account, A.stock, 5, -1, vol,
    #             'easy_tdx_to_qmt', A.quick_trade, remark, C)
    # 死叉 / 止损全平:
    #   passorder(24, 1101, A.account, A.stock, 5, -1, holding_vol,
    #             'easy_tdx_to_qmt', A.quick_trade, remark, C)
```

### 翻译模板 B — `buy(size=0)` / `sell(size=0)` / `stop_loss` / `take_profit` 的标准映射

```python
# 1) 查持仓 (sell 前必查, 避免重复卖)
holdings = get_trade_detail_data(A.account, A.accountType, 'position')
holding_vol = 0
for h in holdings:
    if h.m_strInstrumentID + '.' + h.m_strExchangeID == A.stock:
        holding_vol = int(h.m_nCanUseVolume)
        break

# 2) 硬止损 / 止盈 (next bar 触发, 等效 easy_tdx 的 stop_loss=)
last_price = closes[-1]
if holding_vol > 0 and A.entry_price > 0:
    if last_price <= A.entry_price * (1 - 0.05):           # -5% 止损
        remark = f"{bar_date[4:]}_s_SL"
        passorder(24, 1101, A.account, A.stock, 5, -1, holding_vol,
                  'strategy_name', A.quick_trade, remark, C)
        A.entry_price = 0.0; A.holding_vol = 0
        return

# 3) buy(size=0) → 全仓 (100 股整手)
account_obj = get_trade_detail_data(A.account, A.accountType, 'account')[0]
available = int(account_obj.m_dAvailable)
vol = int(available / last_price / 100) * 100
remark = f"{bar_date[4:]}_b_G"
passorder(23, 1101, A.account, A.stock, 5, -1, vol,
          'strategy_name', A.quick_trade, remark, C)
A.entry_price = last_price; A.holding_vol = vol

# 4) sell(size=0) → 全平
remark = f"{bar_date[4:]}_s_D"
passorder(24, 1101, A.account, A.stock, 5, -1, holding_vol,
          'strategy_name', A.quick_trade, remark, C)
A.entry_price = 0.0; A.holding_vol = 0
```

### easy_tdx 与 QMT 关键差异（翻译时容易踩）

| 差异 | 说明 |
|---|---|
| **撮合时点** | easy_tdx 默认 `execution='next_open'`（信号在 bar N，成交在 bar N+1 开盘）→ QMT 回测撮合规则等价（指定价格在 K 线高低点间的按指定价撮合，超过按收盘价；委托量 > 可用量时按可用量部分成交） |
| **未来函数** | easy_tdx 用 `execution='this_close'` 是已知未来函数；QMT 内置 Py3.6 没这个概念，handlebar 永远是历史 K 线驱动 — 翻译时**不要**把"用当期收盘价成交"等价到 QMT（QMT 没有这模式） |
| **仓位对象** | easy_tdx `self.position["size"]` → QMT `get_trade_detail_data(..., 'position')` 每次都查一次；不要缓存跨 bar |
| **价格精度** | easy_tdx 用 numpy float64；QMT `passorder` 价格用 float，需自行 round 到分位 |
| **手续费 / 印花税** | easy_tdx 在 `BacktestEngine(...)` 构造时配 `commission` / `stamp_tax`；QMT 在「回测参数」面板填（亦可由代码覆盖） |
| **回测时间范围** | easy_tdx 在 df 里自然给；QMT 在 `init` 里 `C.start/end/capital` 或回测参数面板填 |
| **整手 / 最小单位** | 两边都 floor 到 100 股（股票）；期货一手 / 期权一张 |

### 落地检查清单（翻译完一行一行过）

1. ☐ 文件首行 `#coding:gbk`
2. ☐ 模块顶部 `# type: ignore`（QMT 全局无类型）
3. ☐ 顶部用户配置块（`MODE / ACCOUNT_ID / STOCK_CODE / *_PERIOD / STOP_LOSS_PCT / START_DATE / END_DATE / INIT_CAPITAL`）
4. ☐ `class A` 字段集中声明（pyright 友好）
5. ☐ `init(C)` 里 `A.account = ACCOUNT_ID or account`（空串走 QMT 注入）
6. ☐ `handlebar` 顶部 `if not C.is_last_bar(): return` 仅当「实盘 / 模拟 / 分钟线 / tick」加（**日线回测加注释说 no-op 即可**）
7. ☐ 每笔 `passorder` 有 `m_strRemark` 且 `<24` 字符
8. ☐ `opType` = 23 买 / 24 卖（STOCK）
9. ☐ `prType=5, price=-1` 最新价（最常用）
10. ☐ `quickTrade = 0 if MODE=='backtest' else 2`
11. ☐ 在 QMT 编辑器先跑一次「**副图模式**回测」（不要主图 / 主图叠加）

### 完工验证

把翻译出的 `.qmt.py` 粘到 QMT 编辑器 → 主图选目标品种（如 `000001.SZ`）→ 点「回测」→ 看绩效：

- **0 trades**：信号没触发 → 检查 `passorder` 路径是否进了分支 / `is_last_bar()` 闸是否误关 / 数据是否充足
- **回测结果与 easy_tdx 偏差大**：大概率是手续费 / 滑点 / 印花税配置差异；先把两边 `commission` / `stamp_tax` / `slippage` 对齐再排查
- **升级 live**：加 `subscribe_quote` / `run_time` / `waiting_dict` 状态机（详见 `bundled-skills/qmt-strategy/SKILL.md` Code gate）

> **不要凭印象写 passorder / opType / prType 常量**——以 `docs/QMT_INNERAPI.md` 的 §八 交易函数 / §enum 常量为准（库内有完整版 11000+ 行中文 API 文档）。

### 多标的组合策略的翻译（`PortfolioBacktestEngine` → QMT）

> 适用：easy_tdx 用 `PortfolioBacktestEngine(strategy, stocks=[...], total_cash=...)` 跑多标的同策略组合回测，翻译到 QMT innerApi。QMT 的多标的方式 = 顶层 `C.stock_list = [...]` + `get_market_data_ex(..., C.stock_list, ...)` 一次拉所有 K 线（见 `docs/QMT_INNERAPI.md` §数据函数 stock_list 用法）。

#### easy_tdx 与 QMT 多标的语义对照

| `PortfolioBacktestEngine` 元素 | QMT innerApi 对应 | 关键差异 |
|---|---|---|
| `stocks=[StockData(code, market, df), ...]` | `C.stock_list = ["000001.SZ", "600000.SH", ...]` (字符串列表, `stkcode.market` 格式) | QMT 一个代码字符串 vs easy_tdx `StockData` dataclass; `market` 与代码合并 |
| `total_cash=200_000` (共享资金池) | 一个资金账号, 全部标的共用 `available`; 需要**自己**按标的数均分预算 | QMT **没有**自动均分 — 策略里用 `vol = int(available / N / price / 100) * 100` |
| `allocation="equal"` (目前唯一实现) | 同上: 策略循环里对每个候选标的, 算出「预算份额 = available / N_remaining」 | QMT 实现位置在 `handlebar` 内, 需手动管理 `N_remaining` 状态 |
| `engine.run()` 自动遍历每个标的独立回测 | `handlebar` 顶部遍历 `C.stock_list`, 每个标的分别算信号 → 分别 `passorder` | QMT 是「单根主图 K 线驱动 + 显式循环标的」, 不是"按标的独立 engine" |
| `result.individual_results` (每标的独立绩效) | ❌ QMT 没有"每标的独立绩效"输出; 总绩效在回测结果表 | 若需标的级绩效, 在 `handlebar` 里维护 per-symbol equity 字典, 自己跑分析 |
| `result.combined_equity` (按日期对齐求和) | 资金加权总净值, 体现在账户 `total` (回测结果中) | 同上 |
| `result.total_performance` (只有 total_return / annual_return) | 回测结果表的年化 / 夏普 / 最大回撤 / 胜率 — **更全** | QMT 指标更标准, easy_tdx 的 total_performance 是简化版 |
| 跨标的再平衡 (卖出 A 加仓 B) | ❌ easy_tdx 也不支持; QMT 同样不支持 (但有 `set_basket` 篮子交易) | 若要真组合调仓, 走 `passorder(35, 2101, ..., basket_name, ...)` |
| MCP 工具 `run_backtest` (单标的) / `run_combo_backtest` (多策略投票) | ❌ **QMT 客户端内**没有 MCP; 只能粘到 QMT 编辑器跑回测 | 路径完全不一样 |

#### 翻译模板 C — `PortfolioBacktestEngine` → QMT

> 假设 easy_tdx 写了 `PortfolioBacktestEngine(MyStrategy, stocks=[...], total_cash=200000)`。翻译目标: 每个 bar 对每只候选标的独立算信号, 独立 `passorder`, 共用资金。

```python
#coding:gbk
# type: ignore
"""
easy_tdx PortfolioBacktestEngine 多标的策略 → QMT innerApi
=====================================================

对应 easy_tdx 模板::

    engine = PortfolioBacktestEngine(
        strategy=MyMultiStrategy,
        stocks=[
            StockData("000001", "SZ", df1),
            StockData("600000", "SH", df2),
            StockData("600519", "SH", df3),
        ],
        total_cash=300_000,
    )
    result = engine.run()

QMT 适配要点:
  - C.stock_list 列出全部候选标的 (字符串 'stkcode.market' 格式)
  - get_market_data_ex 一次拉所有标的的 close, 返回 {symbol: DataFrame}
  - handlebar 顶部遍历 stock_list, 每个标的独立算信号
  - 资金均分: vol = available / N_剩余标的 / price / 100 * 100
  - 单根主图 K 线驱动所有标的 (主图选哪个标的无所谓, 策略遍历所有)
  - 实盘/分钟线升级: 加 m_strRemark waiting_dict 防同一标的超单
"""

import numpy as np


# === 用户配置 — 改这里 ================================================
MODE = 'backtest'
ACCOUNT_ID = 'testS'
ACCOUNT_TYPE = 'STOCK'
# 多标的 (QMT 格式 'stkcode.market'; 与 easy_tdx StockData(code, market) 等价拼接)
STOCK_LIST = [
    '000001.SZ',
    '600000.SH',
    '600519.SH',
]
# MACD / RSI 参数
MACD_FAST, MACD_SLOW, MACD_SIGNAL = 12, 26, 9
RSI_PERIOD, RSI_OVERBOUGHT = 14, 70
STOP_LOSS_PCT = 0.05
START_DATE = "2020-01-01 00:00:00"
END_DATE   = "2024-12-31 00:00:00"
INIT_CAPITAL = 300000                  # total_cash
# =====================================================================


class A(object):
    """Runtime state — never on ContextInfo attrs (those deep-copy per bar)."""
    is_backtest = (MODE == 'backtest')
    quick_trade = 0 if is_backtest else 2
    # --- 运行时状态 ---
    account = ''
    accountType = ''
    # per-symbol 状态 (easy_tdx 是 engine 内部维护, QMT 要自己写)
    entry_price = {}                   # symbol -> last entry price
    waiting_dict = {}                  # symbol -> remark (防超单, 实盘必用)


def ema(values, period):
    vals = np.asarray(values, dtype=np.float64)
    if len(vals) < period:
        return np.full_like(vals, np.nan)
    alpha = 2.0 / (period + 1.0)
    out = np.empty_like(vals)
    seed = np.mean(vals[:period])
    out[:period - 1] = np.nan
    out[period - 1] = seed
    for k in range(period, len(vals)):
        out[k] = alpha * vals[k] + (1.0 - alpha) * out[k - 1]
    return out


def rsi_calc(values, period):
    vals = np.asarray(values, dtype=np.float64)
    if len(vals) < period + 1:
        return np.full_like(vals, np.nan)
    diff = np.diff(vals)
    gains = np.where(diff > 0, diff, 0.0)
    losses = np.where(diff < 0, -diff, 0.0)
    avg_gain = np.empty(len(vals)); avg_gain[:] = np.nan
    avg_loss = np.empty(len(vals)); avg_loss[:] = np.nan
    avg_gain[period] = np.mean(gains[:period])
    avg_loss[period] = np.mean(losses[:period])
    for k in range(period + 1, len(vals)):
        avg_gain[k] = (avg_gain[k - 1] * (period - 1) + gains[k - 1]) / period
        avg_loss[k] = (avg_loss[k - 1] * (period - 1) + losses[k - 1]) / period
    rs = np.where(avg_loss == 0, np.inf, avg_gain / avg_loss)
    rsi = np.where(np.isinf(rs), 100.0, 100.0 - 100.0 / (1.0 + rs))
    return rsi


def init(C):
    C.stock_list = STOCK_LIST          # QMT 标准多标的方式
    A.account     = ACCOUNT_ID   if ACCOUNT_ID   else account
    A.accountType = ACCOUNT_TYPE if ACCOUNT_TYPE else accountType
    A.entry_price = {s: 0.0 for s in C.stock_list}
    A.waiting_dict = {}
    if A.is_backtest:
        C.start, C.end, C.capital = START_DATE, END_DATE, INIT_CAPITAL


def get_holding_vol(symbol):
    """查 symbol 当前可用持仓 (QMT 没 self.position, 每次都查)."""
    holdings = get_trade_detail_data(A.account, A.accountType, 'position')
    for h in holdings:
        if h.m_strInstrumentID + '.' + h.m_strExchangeID == symbol:
            return int(h.m_nCanUseVolume)
    return 0


def handlebar(C):
    # 日线回测 is_last_bar() 永远 True, 无需闸 (no-op)
    bar_date = timetag_to_datetime(C.get_bar_timetag(C.barpos), '%Y%m%d')
    need = MACD_SLOW + MACD_SIGNAL + RSI_PERIOD + 5

    # 1. 一次拉所有标的 close (QMT 多标的标准 API)
    data = C.get_market_data_ex(
        ['close'], C.stock_list,
        end_time=bar_date, period='1d',
        subscribe=False, count=need,
    )
    # data = {symbol: DataFrame[datetime, close]}

    # 2. 共享资金 (QMT 不会自动均分, easy_tdx 也是预分配, 翻译时需对齐)
    account_obj = get_trade_detail_data(A.account, A.accountType, 'account')[0]
    available = int(account_obj.m_dAvailable)

    # 3. 遍历每个标的, 独立算信号, 独立下单
    for symbol in C.stock_list:
        if symbol not in data or len(data[symbol]) < need:
            print(bar_date, symbol, '行情不足 跳过')
            continue

        closes = data[symbol]['close'].values
        cur_dif = ema(closes, MACD_FAST)[-1] - ema(closes, MACD_SLOW)[-1]
        dea_series = ema(closes, MACD_SLOW) - ema(closes, MACD_SLOW)
        dea_val = ema(dea_series[~np.isnan(dea_series)], MACD_SIGNAL)[-1] \
            if np.any(~np.isnan(dea_series)) else np.nan
        pre_dif = ema(closes, MACD_FAST)[-2] - ema(closes, MACD_SLOW)[-2]
        pre_dea = ema(closes, MACD_SLOW)[-2] - ema(closes, MACD_SLOW)[-2]   # 同上, 需 EMA 化
        # 注: 上面的 dea/pre_dea 是简化示意, 实战请用统一的 ema(dif, MACD_SIGNAL) 序列;
        #     模板 A 已有完整 ema/rsi 实现, 这里为简洁保留 diff 形式, 翻译时统一替换.

        rsi_val = rsi_calc(closes, RSI_PERIOD)[-1]
        last_price = closes[-1]

        if np.isnan(cur_dif) or np.isnan(dea_val) or np.isnan(rsi_val):
            continue

        golden = (pre_dif <= pre_dea) and (cur_dif > dea_val)
        death  = (pre_dif >= pre_dea) and (cur_dif < dea_val)

        holding_vol = get_holding_vol(symbol)

        # 4. 硬止损
        if holding_vol > 0 and A.entry_price[symbol] > 0:
            stop = A.entry_price[symbol] * (1 - STOP_LOSS_PCT)
            if last_price <= stop:
                remark = f"{symbol}_{bar_date[4:]}_s_SL"
                passorder(24, 1101, A.account, symbol, 5, -1, holding_vol,
                          'multi_stock', A.quick_trade, remark, C)
                A.entry_price[symbol] = 0.0
                print(bar_date, symbol, '止损平仓', holding_vol)
                continue

        # 5. 死叉全平
        if holding_vol > 0 and death:
            remark = f"{symbol}_{bar_date[4:]}_s_D"
            passorder(24, 1101, A.account, symbol, 5, -1, holding_vol,
                      'multi_stock', A.quick_trade, remark, C)
            A.entry_price[symbol] = 0.0
            print(bar_date, symbol, '死叉平仓', holding_vol)
            continue

        # 6. 金叉 + RSI < 70 → 满仓等额买入 (按剩余候选标的数均分 available)
        if holding_vol == 0 and golden and rsi_val < RSI_OVERBOUGHT:
            # N_remaining = 未持仓的候选标的数 (实盘简化: 按 stock_list 总数等分)
            n_candidates = len(C.stock_list)
            budget = available / n_candidates
            vol = int(budget / last_price / 100) * 100     # 整手
            if vol < 100:
                print(bar_date, symbol, '可用资金不足 跳过')
                continue
            remark = f"{symbol}_{bar_date[4:]}_b_G"
            passorder(23, 1101, A.account, symbol, 5, -1, vol,
                      'multi_stock', A.quick_trade, remark, C)
            A.entry_price[symbol] = last_price
            print(bar_date, symbol, '开仓', vol, '股')
```

#### 关键差异与坑（多标的专属）

| 差异 / 坑 | 说明 |
|---|---|
| **共享资金 vs 预分配** | easy_tdx `PortfolioBacktestEngine` 是**预分配**子账户给每只标的（独立资金）；QMT **一个账号共用** `m_dAvailable`。**两种语义不一致** → 多标的信号同时满足时, 资金不够分。要么收紧候选标的数, 要么在策略里**手动维护未持仓标的数, 实时均分预算** |
| **驱动模型** | easy_tdx 是"按标的独立 engine 遍历"; QMT 是"主图单根 K 线驱动 + `handlebar` 内部循环标的"。主图选哪个标的**不影响**策略 — 策略里 `for symbol in C.stock_list` 才是真驱动 |
| **跨标的调仓** | 都没有。easy_tdx 每标的独立子账户; QMT `passorder` 是单笔单标的。要"卖出 A 加仓 B" 自己用 2 次 `passorder` 串起来 |
| **回测结果显示** | QMT 回测结果表**没有"标的级绩效"**。要 per-symbol equity, 自己在 `handlebar` 里维护字典 `equity_history[symbol] = [...]`, 回测完写 csv 自己分析 |
| **代码格式差异** | easy_tdx `StockData("000001", "SZ")` → QMT 必须合并为 `'000001.SZ'` 单字符串 |
| **`passorder` accountType 限制** | 单账号要支持多品种（股票 + ETF + ...）, accountType 用 `'STOCK'` 可覆盖常见品种; 真要走多账号, 用 `accountID='账号1,账号2'` 逗号分隔（见 `docs/QMT_INNERAPI.md` §八） |
| **标的级 SL/TP 状态** | 多标的时 `entry_price` / `bars_held` 必须 per-symbol 存字典, 不能单变量 — 否则 A 标的的入场价会覆盖 B 标的 |
| **实盘升级** | 多标的必须加 `waiting_dict`（per-symbol 状态机）防同一标的超单; 单标的模板的 `waiting_dict` 也要扩到字典形式 |

#### 多标的完工检查清单（在 §翻译完工验证之上再加 5 条）

12. ☐ `STOCK_LIST` 用 QMT 字符串格式 `'stkcode.market'`（不是 `StockData(code, market)`）
13. ☐ `init(C)` 里 `C.stock_list = STOCK_LIST` 显式赋值（即使 `STOCK_LIST` 是 const, 也得传给 QMT）
15. ☐ 资金均分逻辑按"剩余候选标的数"算, 而不是简单 `available / N`（否则同时多个金叉会全买爆仓）
14. ☐ per-symbol 状态用字典 `A.entry_price[symbol]`, **不用单变量**
16. ☐ 每个标的 `passorder` 的 `m_strRemark` 含 symbol 前缀, 便于按标的回溯委托（避免不同标的的 remark 撞车 → `order_callback` 误判）

## 生成 HTML 回测报告（Chart.js 单文件，可直接拖浏览器）

> CLI 只输出 JSON / table / csv。要把回测结果交付给**人**（不是 Agent 自己看）时，用 `scripts/report_backtest_html.py` 生成单文件 HTML：内嵌 Chart.js 画资金曲线 / 买卖点 / 回撤 / 月度收益，浏览器离线打开就有交互（hover 显示数值、可缩放时间轴）。

**为什么是 Chart.js 而不是 matplotlib**：
- 零 Python 渲染依赖（`matplotlib` 也不用装）
- canvas 矢量缩放，hover 显示日期 / 净值 / 交易点
- HTML ~60KB（matplotlib 嵌入 PNG 要 ~1MB）

**两步**：先拿 JSON，再渲染 HTML。

```bash
# 1. 跑回测，输出 JSON
easy-tdx backtest SZ 000001 \
    --strategy-file strategies/ma_cross_30_stop.py \
    --output json --cash 100000 --commission 0.0003 \
    --execution next_open --period DAILY --count 500 --adjust QFQ \
    > /tmp/result.json

# 2. 渲染 HTML 报告
python scripts/report_backtest_html.py /tmp/result.json /tmp/report.html \
    --title "MA5/MA30+5%止损 · 平安银行 500日回测"
```

打开 `/tmp/report.html`，会看到：
- 顶部 6 块 KPI（总收益 / 年化 / 最大回撤 / 夏普 / 胜率 / 交易次数）
- 资金曲线（含 BUY 红色三角 / SELL 绿色三角散点）+ 初始资金参考线
- 回撤面积图（红色填充）
- 月度收益柱状图（绿涨红跌，hover 显示百分比）
- 最近 30 笔交易明细（盈亏着色）
- 回测配置（资金 / 佣金 / 成交规则 / 持仓模式）

**JSON 字段约定**（如果上层 CLI 改了字段名要同步修脚本）：
- 顶层：`performance` / `equity_curve` / `trades` / `positions` / `config` / `diagnostic`
- `equity_curve[i]`：`datetime` / `cash` / `position_value` / **`total`**（账户净值）/ `drawdown_pct`
- `trades[i]`：`datetime` / **`direction`**（`'BUY'` / `'SELL'` 大写）/ `size` / `price` / `commission` / `pnl`

**当前字段映射写在 `scripts/report_backtest_html.py` 顶部注释**，改了要同步更新 SKILL.md。

**完全离线模式**（默认用 jsdelivr CDN，飞机 / 内网环境失败）：把 Chart.js 4 + chartjs-adapter-date-fns 下载到 `scripts/vendor/` 后改 HTML 里两个 `<script src>` 为相对路径。HTML 会从 ~60KB 涨到 ~330KB，但完全自包含。

## 自检（每写一个策略必跑一次）

完成后最少跑一次最小验证，确认：
1. `result.performance["total_trades"]` 是否符合预期（信号至少 1 笔成交，否则是策略没触发）
2. `result.equity_curve.tail()` 的 `total` 是否随价格变动（验证数据通路）
3. 随便一笔 trade 的 `pnl` 是否合理（验证 BUY 后 SELL 才计 pnl，BUY 单 pnl=0）

## 反例 — 这些不在本 skill 范围内

- `backtrader` / `vectorbt` / `zipline` / `quantstats` / `QStock` / `AKShare` 的回测
- 通达信公式编辑器（Pyramith 之类）写的非 Python 策略
- vn.py / MT5 平台级回测
- 想自己写撮合引擎 / 撮合规则 —— 这个 skill 只用 `easy_tdx.backtest` 内置引擎

如果你只能记住三件事：
1. 写策略 = `init()` 注册指标 + `next()` 出 BUY/SELL 信号
2. AI 对话里优先用 MCP 工具（v2 共 22 个：`get_kline` / `run_backtest` / `run_combo_backtest` / `run_chanlun` / `compute_indicators` / `compute_factors` / `list_announcements` / `get_news` / `news_sync_status` / `news_list_sources` 等）；要落盘脚本才走 Python `import easy_tdx`
3. 先复制 `stock-sources/easy_tdx/strategies/*.py` 里最接近的那个改 → 合成数据 smoke test → CLI 真行情验证（详见「生成策略 + CLI 验证回测」节）