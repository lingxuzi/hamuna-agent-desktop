# v2 Backtest Result Schema — 13 顶层 key + 15 metrics

> **真实 schema (从 `strategy_cli.references.akquant_schema_adapter.to_hamuna_result` 输出读)**.
> 与 v1 driver.run_backtest() 输出**完全一致** (同 13 顶层 key, 同 15 metrics 命名) — server 端
> `model.BacktestResult` (Go struct, backend/internal/model/model.go:74-90) **不区分 v1 / v2 engine**.
> v2 跑通的 result 直接走 `cmd_upload` → `PUT /api/v1/strategies/{id}/result`, server 落 mongo, 无差别.

## 1. 13 顶层 key (真实)

| key | type | 说明 |
|---|---|---|
| `metrics` | dict (15-key) | **15 metrics 字典** (M1+M2+alias, 见 §2) |
| `equity_curve` | list[dict] | 净值曲线, 每 bar 1 行 `{date, nav}` |
| `trades` | list[dict] | 成交明细, 每成交 1 行 `{symbol, side, price, qty, timestamp, ...}` |
| `universe` | list[str] | 标的代码 list (sorted), 从 cfg.pool 展开 |
| `period` | {start, end} | 回测区间 (YYYYMMDD str) |
| `params` | dict | cfg 快照 (排除 `backtest_start` / `backtest_end`; 含 `_akquant_extra` 子键给 UI 不消费的 akquant 多出字段) |
| `monthly_metrics` | dict[year, dict[month, value]] | 按月聚合的 metrics (year=2024 → month→value) |
| `monthly_bars` | list[dict] | 月度柱子图数据 `{year, month, monthly_return, nav_at_end, trades_in_month, win_rate_in_month}` |
| `initial_capital` | float | 初始资金 (from cfg.init_capital) |
| `final_capital` | float \| None | 末笔净值 |
| `avg_holding_period` | float \| None | 平均持仓天数 (从 open 到 close) |
| `suggestions` | list[str] | runner 给的优化建议 (e.g. "考虑加止损") |
| `benchmark_curve` | list | akquant 单策略无自动基准 → 空 list (v1 driver 也没填) |

**与 v1 driver 输出**: 13 顶层 key **一一对应** (`v1 driver.run_backtest()` line 113-127), 上传协议同.

**与 server `model.BacktestResult`** (Go struct): 12 个 omitempty 字段 + 1 必填 `metrics` = 13 字段.

## 2. `metrics` 15-key (真实)

### 2.1 M1 (10 个, 基础指标)

| key | type | 单位 | 说明 |
|---|---|---|---|
| `total_return` | float | ratio | 区间总收益 (e.g. 0.091 = 9.1%) |
| `annual_return` | float \| None | ratio | 年化收益 (CAGR) — 短窗口可能 None |
| `sharpe` | float | ratio | 年化 Sharpe (无风险利率 = 0, 日收益年化 252) |
| `max_drawdown` | float | ratio (负) | 最大回撤, e.g. -0.18 = 回撤 18% |
| `volatility` | float | ratio | 年化波动率 (日收益 std × √252) |
| `win_rate` | float \| None | ratio (0~1) | 胜率 — 0 trades 时 None |
| `profit_loss_ratio` | float \| None | ratio | 盈亏比 (平均盈利 / 平均亏损, abs) |
| `avg_holding_period` | float \| None | days | 平均持仓天数 |
| `profit_factor` | float \| None | ratio | 利润因子 (总盈利 / 总亏损) |
| `sortino` | float | ratio | Sortino ratio (下行风险调整) |

### 2.2 M2 (4 个, 衍生指标)

| key | type | 单位 | 说明 |
|---|---|---|---|
| `calmar` | float \| None | ratio | Calmar ratio (年化收益 / abs(最大回撤)) |
| `var_95` | float \| None | ratio | 95% VaR (历史法, 日收益分位数) |
| `benchmark_total_return` | float \| None | ratio | 基准收益 — akquant 单策略无自动基准, **目前为 None** |
| `excess_return` | float \| None | ratio | 超额收益 (策略 - 基准) — 同上, **目前为 None** |

### 2.3 alias (1 个, volatility 别名)

| key | type | 等价于 | 说明 |
|---|---|---|---|
| `annual_volatility` | float | `volatility` | **deprecated alias**, 早期 v1 客户端期望这个 key; v2 直接给 `volatility`, 同步带 alias |

**总数**: M1(10) + M2(4) + alias(1) = **15 keys**.

**NaN 处理**: 不可计算字段 (e.g. 0 trades → win_rate=None, profit_loss_ratio=None) 经 schema_adapter
转 None (JSON 不支持 NaN literal, 后端 model 拒 NaN).

## 3. 数值示例 (BuyHold 沪深 300 2 标的 6mo, 实测)

```json
{
  "metrics": {
    "total_return": 0.000903959,
    "annual_return": null,
    "sharpe": 1.4390481232123447,
    "max_drawdown": -0.0004945079848299216,
    "volatility": 0.0012484380751515813,
    "win_rate": null,
    "profit_loss_ratio": null,
    "avg_holding_period": null,
    "benchmark_total_return": null,
    "excess_return": null,
    "sortino": 1.5805469615922636,
    "calmar": 3.7166944490319226,
    "var_95": 0.00010136569836594056,
    "profit_factor": null,
    "annual_volatility": 0.0012484380751515813
  },
  "equity_curve": [
    { "date": "20240701", "nav": 1000000.0 },
    { "date": "20240702", "nav": 1000076.959 },
    { "...": "..." }
  ],
  "trades": [],
  "universe": ["600000.SH", "600036.SH"],
  "period": { "start": "20240701", "end": "20241231" },
  "params": {
    "pool": {"hs300": {"codes": ["600000.SH", "600036.SH"]}},
    "init_capital": 1000000.0,
    "_strategy_name": "buyhold",
    "_symbol_names": {"600000.SH": "浦发银行", "600036.SH": "招商银行"},
    "_akquant_extra": {}
  },
  "monthly_bars": [
    {"year": 2024, "month": 7, "monthly_return": 0.0001, "nav_at_end": 1000057.959, "trades_in_month": 0, "win_rate_in_month": null}
  ],
  "monthly_metrics": {"2024": {"7": 0.0001}},
  "initial_capital": 1000000.0,
  "final_capital": 1000903.959,
  "avg_holding_period": null,
  "suggestions": [],
  "benchmark_curve": []
}
```

> 注: buyhold 策略在 2024-07-01 当天就成交 (warms up 1 bar), 所以 trades 字段为 0 (T+1 限制下
> buyhold 全程不卖). 实际 6mo buyhold 实跑 trades=0 是正常的.

## 4. 与 server 端的对齐契约 (实测对齐)

### 4.1 PUT 路由

```
PUT /api/v1/strategies/{strategy_id}/result
Content-Type: application/json
Authorization: Bearer <jwt-or-api-key>

Body: 13 顶层 key dict (上面 §1)
```

### 4.2 server 端 `model.BacktestResult` (Go struct) 字段对应

| Go 字段 | JSON key | 类型 |
|---|---|---|
| `Metrics` | `metrics` | map[string]float64 (必填, 后端会校验 15 keys 是否齐) |
| `EquityCurve` | `equity_curve` | []EquityPoint |
| `Trades` | `trades` | []Trade |
| `Universe` | `universe` | []string |
| `Period` | `period` | Period (含 Start/End) |
| `Params` | `params` | map[string]any |
| `MonthlyMetrics` | `monthly_metrics` | map[string]map[string]float64 (omitempty) |
| `MonthlyBars` | `monthly_bars` | []MonthlyBar (omitempty) |
| `InitialCapital` | `initial_capital` | float64 (omitempty) |
| `FinalCapital` | `final_capital` | float64 (omitempty) |
| `AvgHoldingPeriod` | `avg_holding_period` | float64 (omitempty) |
| `Suggestions` | `suggestions` | []string (omitempty) |

**注意**: server 端 Go struct **没有 `benchmark_curve` 字段**, 但 JSON 里多一个 key 会被 mongo
$set 直接吞下 (mongo 不校验 schema). 不破, 只是 dead data.

### 4.3 server 端校验规则 (从代码 + smoke 推)

- `metrics` 必填, 缺一不可 (后端 model 拒绝)
- `equity_curve` 至少 1 行 (空会落 mongo 空 array, UI 端空白)
- `period.start` < `period.end` (顺序错 → 422)
- `initial_capital` 必须 > 0 (资金为 0 → 422)
- **没有 engine / version / run_started_at / strategy_id / logs / _meta 字段校验** —
  这 6 个字段在 plan 里**想象错**, 实际 server 不要求, runner 也不产.
  v1 driver + v2 akquant 都**不**写这 6 个字段 — server 落 mongo 时 mongo 直接忽略.

## 5. 常见疑问

### 5.1 同一 strategy_id, v1 跑过又 v2 跑过, 怎么算?

以最后上传的为准 (server 端覆盖写, mongo `$set` on `strategies.{_id}.result`).
mongo 不留 history — 想看历史需前端按 `updated_at` 字段过滤.
**没有 engine 字段区分** — v1 / v2 输出同 schema, 区分靠 audit log (server 端 application log).

### 5.2 metrics.annual_volatility 跟 volatility 啥区别?

**没区别**, 都是年化波动率. 早期 v1 客户端期望 `annual_volatility` (来自 v0 协议),
v1.5+ 改用 `volatility`. v2 runner 同步两个字段 (alias) 给老客户端兼容.

### 5.3 trades 为空合法吗?

合法. server 端不校验 trade 数. 实测 buyhold 6mo (T+1 全程不卖) trades=0.

### 5.4 benchmark_curve 为什么是空?

akquant 0.3.x 不自动算基准 (没指定 `benchmark` 参数). runner 给空 list 占位.
**未来**: 等 akquant 0.3.x 加 benchmark 参数后填.

### 5.5 字段顺序重要吗?

不重要. JSON 顺序无关语义. server 按 key 名查.
