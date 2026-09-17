# config-schema — strategy_cli CONFIG 字段权威定义 (v2)

> **谁读 cfg**: `strategy_cli.runtime.backtest.run(strategy_path, cfg)` 把 cfg
> **透传** 给 `strategy_cli.references.akquant_runner.run_akquant_backtest`
> (wholesale, 一字不改). 本文档是 cfg 字段的**权威来源** — auditor / coder /
> dataset-loader / backtester 全用此比对.
>
> **不读 cfg 的字段**: akquant.run_backtest 还有 `data` / `symbols` / `strategy` /
> `show_progress`, 但这 4 个由 runner 内部填, **用户不传**.

## 1. 字段总表

| 字段 | 类型 | 必需 | 默认 | 含义 |
|---|---|---|---|---|
| `backtest_start` | str (YYYYMMDD) | ✅ | — | 回测窗口起点 (含) |
| `backtest_end` | str (YYYYMMDD) | ✅ | — | 回测窗口终点 (含) |
| `pool` 或 `universe` | dict \| list[str] | ✅ | — | 标的池 (二选一) |
| `init_capital` | float | — | 1_000_000.0 | 初始资金 (元) |
| `slippage` | float \| dict | — | 0.001 (percent) | 滑点 (详见 §3) |
| `commission_rate` | float | — | 0.0003 | 佣金率 (双边) |
| `stamp_tax_rate` | float | — | 0.001 | 印花税率 (卖出) |
| `min_commission` | float | — | 5.0 | 最低佣金 (元/笔) |
| `volume_limit_pct` | float | — | 0.25 | 单笔成交量上限占当日比例 |
| `t_plus_one` | bool | — | True | A 股 T+1 规则 |
| `price_limit_clamp` | bool | — | True | 涨跌停 clamp 兜底 (Q1) |
| `start_time` / `end_time` | str | — | — | 透传给 akquant.run_backtest 的可选 kwarg |
| `_dataset_manifest` | dict | — | — | **v2 注入**: cmd_run --dataset 写入, runner 暂未短路读取 |
| `_symbol_names` | dict[str, str] | — | — | runner 自己从 bundle 解析, 用户不传 |

## 2. 必需字段

### 2.1 `backtest_start` / `backtest_end`

```json
{"backtest_start": "20240701", "backtest_end": "20241231"}
```

- **格式**: 8 位 YYYYMMDD 字符串 (不是 ISO `2024-07-01`, 不是 Unix timestamp)
- **必需** — runner 入口先验, 缺一个 → `ValueError: cfg 缺必需 key: backtest_start`
- **顺序**: start < end (顺序错 hamuna schema adapter 后续会拒)
- **窗口宽度**: 建议 ≥ 60 交易日 (akquant warmup 默认 + 策略自身窗口)
- **数据可达性**: window 内必须有 prebuilt 数据, 否则
  `FileNotFoundError: 未取到 bar 数据`

### 2.2 `pool` 或 `universe`

两个 key 等价 (runner 先读 pool, fallback universe):

```json
{
  "pool": {
    "a_share": {
      "codes": ["600000", "600036"]
    }
  }
}
```

或简化版:

```json
{
  "universe": ["600000", "600036"]
}
```

- **空** → `ValueError: cfg.universe / cfg.pool 为空`
- **多 symbol**: runner 暂不阻断, 实际跑通靠 akquant 0.3.x multi-symbol DataFrame
- **symbols 形态**: 用 **6 位裸码** (e.g. `600000`), **不要带 `.SH` / `.SZ` / `.BJ`
  后缀** — 容维 A 股整包 stockCode 就是裸码 (落盘 parquet 文件名 `600000_1d_fq1.parquet`,
  见 `prebuilt_downloader._dataset_path: bare = symbol.split('.')[0]`)
- **板别判断**: 不依赖后缀 — 走前 3 位前缀 (60x=沪市主板 10%, 00x=深市主板 10%,
  30x=创业板 20%, 688x=科创板 20%, 见 `_PRICE_LIMIT_RULES`)
- **兼容带后缀输入**: runner 内部 `split('.')[0]` 自动剥, 写 `600000.SH` 也行
  (但不推荐 — 见 §7 与 v1 差异)

#### pool 的嵌套语义

`runner._universe_from_cfg` 解析:

```python
pool = {"a_share": {"codes": ["600000", ...]},
        "b_share": {"sub_universe": ["...", ...]}}
# 展开 → ["600000", ..., "...", ...] (sorted + dedup)
```

支持:
- `pool["xxx"]["codes"]`
- `pool["xxx"]["sub_universe"]`
- `pool["xxx"]` 直接是 list (e.g. `pool["a_share"] = ["600000", "600036"]`)

## 3. 默认字段 (可选, 不传走 akquant 默认)

### 3.1 `init_capital`

```json
{"init_capital": 1000000.0}
```

- 默认 `1_000_000.0` (100 万)
- 类型: float (元)
- **0 / 负数**: akquant 会拒 (建议校验, runner 不主动验)
- 影响: `final_capital` / `total_return` / 持仓规模

### 3.2 `slippage`

```json
{"slippage": 0.001}
```

或 dict 形态 (akquant 0.3.x+ 强制 dict):

```json
{"slippage": {"type": "percent", "value": 0.001}}
```

- 默认 `0.001` (即 0.1% 单边)
- runner 自动转: float → `{"type": "percent", "value": float(slippage)}`
- **0**: 理想撮合 (不建议, 实盘不可达)
- **> 0.01** (1%): 实盘罕见, 通常是手写撮合层有问题

### 3.3 `commission_rate`

```json
{"commission_rate": 0.0003}
```

- 默认 `0.0003` (万分之三, 双边)
- 实际券商佣金: 万 1.5 ~ 万 3 (散户)
- 调高会显著降低高频策略收益 (趋势策略影响小)

### 3.4 `stamp_tax_rate`

```json
{"stamp_tax_rate": 0.001}
```

- 默认 `0.001` (千分之一, 仅卖出)
- A 股印花税 2023-08 后从 0.1% 降到 0.05%, 想精确回测改 `0.0005`

### 3.5 `min_commission`

```json
{"min_commission": 5.0}
```

- 默认 `5.0` 元/笔
- 实盘多数券商无最低 (但有 5 元起步, 看券商)

### 3.6 `volume_limit_pct`

```json
{"volume_limit_pct": 0.25}
```

- 默认 `0.25` (单笔 ≤ 当日 25% 成交量)
- akquant 用来防"瞬时吃掉所有流动性"
- 调小更保守 (大资金场景), 调大会被监管盯

### 3.7 `t_plus_one`

```json
{"t_plus_one": true}
```

- 默认 `True` (A 股规则: 当日买次日才能卖)
- **必须 True**: A 股策略关掉会拿到不可能收益
- 港股 / 美股策略可改 False

### 3.8 `price_limit_clamp`

```json
{"price_limit_clamp": true}
```

- 默认 `True` (Q1 兜底)
- akquant 0.3.x 实测不原生拒单 (orders=1, rejected=0), 高频价
  可能超出涨跌停 — clamp 把 high / low 收紧到 ±limit_pct 范围
- 板别: 60x / 00x → 10%, 30x / 688x → 20%
- **关掉**: 可能拿到"撮合到涨停板之外"的虚假成交 (qa / 学术研究场景)

## 4. 可选透传

### 4.1 `start_time` / `end_time`

runner 存在性探测后透传 (直接给 akquant.run_backtest):

```json
{"start_time": "09:30:00", "end_time": "15:00:00"}
```

- 仅分钟级 / tick 策略有用 (日线忽略)
- v2 仅支持日线, 传不传等价

## 5. v2 注入字段 (用户不传, 系统写)

### 5.1 `_dataset_manifest`

```json
{
  "_dataset_manifest": {
    "symbols": ["600000.SH", "600036.SH"],
    "start": "20240701",
    "end": "20241231",
    "rows": 245,
    "columns": ["close", "high", "low", "open", "symbol", "timestamp", "volume"],
    "created_at": "2026-08-14T01:35:00Z",
    "schema": "hamuna_quant_cli//v1"
  }
}
```

- 来源: `strategy_cli run --dataset <manifest.json>` 时 cmd_run 注入 cfg
- 用途: audit log / 复跑溯源 (知道这轮用了哪个固化数据集)
- runner 当前**未短路读取** (仍跑 resolver) — 信息性, 不影响结果
- 用户不传 (让 cmd_run 自动写)

### 5.2 `_symbol_names`

- runner 自己从 prebuilt bundle 解析 `{symbol: stockName}`
- 来源: `df['stockName']` (若 data_adapter 已 drop 则空 dict)
- 用户不传

## 6. 完整 config.json 模板

最小 (仅必需):

```json
{
  "backtest_start": "20240701",
  "backtest_end":   "20241231",
  "universe": ["600000", "600036"]
}
```

推荐 (含交易成本):

```json
{
  "backtest_start":  "20240701",
  "backtest_end":    "20241231",
  "universe":        ["600000", "600036"],
  "init_capital":    1000000.0,
  "commission_rate": 0.0003,
  "stamp_tax_rate":  0.0005,
  "slippage":        0.001,
  "volume_limit_pct": 0.25,
  "t_plus_one":      true,
  "price_limit_clamp": true
}
```

## 7. 与 v1 cfg 字段的差异

| 字段 | v1 必有? | v2 必有? | 差异 |
|---|---|---|---|
| `backtest_start` / `backtest_end` | ✅ | ✅ | 同 |
| `pool` (含 `a_share.codes`) | ✅ | ✅ | v2 也支持 `universe` list 简化 |
| `pool.codes` 形态 | 带 `.SH`/`.SZ` 后缀 | **6 位裸码** (e.g. `600000`) | **v2 改了**: dataset stockCode 是裸码, 不要市场前后缀; runner 内部 `split('.')[0]` 兼容带后缀输入 |
| `init_capital` | ✅ | — (默认 1M) | v1 显式必填, v2 默认 |
| `commission_rate` | ✅ | — (默认 0.0003) | 同上 |
| `stamp_tax_rate` | — | — (默认 0.001) | v2 加印花税, v1 默认 0 |
| `t_plus_one` | ✅ | — (默认 True) | v1 显式必填, v2 默认 |
| `slippage` | — | — (默认 0.001) | v2 默认浮点, runner 自动转 dict |
| `volume_limit_pct` | — | — (默认 0.25) | **v2 新增** (akquant 防吃流动性) |
| `price_limit_clamp` | — | — (默认 True) | **v2 新增** (Q1 兜底, 关掉会拿到虚价) |
| `mode` (backtest_daily) | ✅ | ❌ | v1 用 mode 决定纪律豁免; v2 纪律统一走 cfg 解析 |
| `account_type` | ✅ | ❌ | v1 用于区分个人/机构; v2 不区分 |
| `_dataset_manifest` | ❌ | — (注入) | **v2 新增** (cmd_run --dataset 注入) |

## 8. cfg 校验失败码

| 现象 | exit code | 修复 |
|---|---|---|
| `cfg 缺必需 key: backtest_start` | 4 (runner ValueError) | 补字段 |
| `cfg.universe / cfg.pool 为空` | 4 | 补 pool 或 universe |
| `未取到 bar 数据` | 4 (FileNotFoundError) | 跑 `dataset fetch --symbols ...` 预热, 或改 window |
| `akquant.run_backtest 报参数错` | 4 | 看 stderr 调参数 (e.g. initial_cash=0) |

## 9. 自检 (auditor 怎么验 cfg)

最小审计:

```bash
# 1) JSON 合法
python3 -c "import json; json.load(open('config.json'))"

# 2) 必需字段齐
python3 -c "
import json, sys
c = json.load(open('config.json'))
miss = [k for k in ('backtest_start', 'backtest_end') if k not in c]
if miss:
    sys.exit(f'缺必需 key: {miss}')
pool = c.get('pool') or c.get('universe') or []
if not pool:
    sys.exit('pool / universe 空')
"

# 3) cfg 类型 + 默认推断
python3 -c "
import json
c = json.load(open('config.json'))
print(f'  init_capital={c.get(\"init_capital\", 1_000_000.0)} (默认 1M)')
print(f'  commission_rate={c.get(\"commission_rate\", 0.0003)} (默认 万三)')
print(f'  t_plus_one={c.get(\"t_plus_one\", True)} (默认 True)')
print(f'  price_limit_clamp={c.get(\"price_limit_clamp\", True)} (默认 True)')
"

# 4) 纪律 self-check (auditor 6 rule)
hamuna_quant_cli check strategy.py --config config.json
# 期望: "纪律 self-check 通过 (0 条)"
```