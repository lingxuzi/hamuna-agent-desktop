# v2 Engine & Data — akquant 0.3.x + prebuilt 数据流

> v2 不重复实现回测引擎 / 数据加载 / metrics 计算 — 全部委托 `hamuna_quant_cli//`.
> 本页只讲 **v2 怎么串起来**, 不讲 akquant 内部细节.

## 1. 一句话架构

```
strategy.py (akquant.Strategy)
    ↓ cmd_run 加载 + 纪律 self-check
strategy_cli.runtime.backtest.run(strategy_path, cfg)
    ↓ 注入 _strategy_name, 调 runner
strategy_cli.references.akquant_runner.run_akquant_backtest(strategy_path, cfg)
    ↓ 委托: data adapter + cross_sectional helper + akquant.run_backtest + schema adapter
13-key dict (15 metrics)
```

**v2 不持有任何引擎代码**, 只持参数解析 + 纪律 + 单步编排.

## 2. akquant 0.3.x — 引擎契约

### 2.1 Strategy 父类

```python
from akquant import Strategy, Bar

class MyStrat(Strategy):
    warmup_period = 20          # 类属性, akquant 预热 N bar 再开始 on_bar

    def __init__(self):          # akquant 用 self, 不用 ContextInfo
        ...

    def on_start(self):          # 可选; 启动回调 (subscribe + add_timer)
        ...

    def on_bar(self, bar: Bar):  # 必填 (或 on_tick, 不可同时)
        # bar.timestamp 是 int ns (Unix epoch nanoseconds)
        # bar.close / bar.open / bar.high / bar.low / bar.volume 都是 float
        # ⚠ bar.time / bar.date 是 REPR ALIAS, getattr 返 None — 别用!
        ...
```

### 2.2 Bar 字段表 (实战踩过的坑标 ⚠)

| 字段 | 类型 | 来源 | 备注 |
|---|---|---|---|
| `bar.timestamp` | `int` (ns) | akquant 注入 | **唯一日期字段**; `datetime.fromtimestamp(ts/1e9).date()` |
| `bar.symbol` | `str` | akquant 注入 | 标的代码 (e.g. `"600000.SH"`) |
| `bar.open` | `float` | 数据 | 开盘价 |
| `bar.high` | `float` | 数据 | 最高价 |
| `bar.low` | `float` | 数据 | 最低价 |
| `bar.close` | `float` | 数据 | 收盘价 |
| `bar.volume` | `float` | 数据 | 成交量 (手) |
| `bar.amount` | `float` | 数据 (可选) | 成交额 |
| `bar.time` | ⚠ REPR ALIAS | `__repr__` | **getattr 返 None**, 别用! |
| `bar.date` | ⚠ REPR ALIAS | `__repr__` | **getattr 返 None**, 别用! |

**纪律 check** (`discipline._rule_bar_field_uses_timestamp`) 会拦 `bar.time` / `bar.date` —

### 2.3 ⚠ universe 注入 — 收 `universe` 参数的策略必须有 (实战踩过)

策略 `__init__` 若收 `universe` (多标 / 横截面 / on_start 要 subscribe 的策略), **runner 必须通过
`strategy_params={'universe': universe}` 注入**, 否则 `universe=[]` → on_start 空订阅 → **0 trades
(静默, 不报错)**.

```python
# akquant 0.3.x 机制: run_backtest(**kwargs) 里
if "strategy_params" in kwargs and isinstance(s_params, dict):
    kwargs.update(s_params)   # → Strategy.__init__(universe=...)

# runner 注入条件: strategy.__init__ 签名里有 `universe` 参数
if 'universe' in inspect.signature(strat_cls.__init__).parameters:
    kwargs['strategy_params'] = {'universe': universe}
```

**踩坑记录 (2026-08-15)**: `akquant_runner.py` 原漏传 `strategy_params`, `HighWinrateLowDrawdown`
(universe=None) 真实数据 0 trades; 合成数据 (synth_run 显式传 universe) 掩盖了此 bug, 显示 38 trades.
**教训: 合成数据会掩盖 runner 注入缺失 — 跑真实 prebuilt 才能暴露.**

**修复位置**: `strategy_cli/references/akquant_runner.py` — 已加注入 + `_selfcheck()` 回归断言
(monkeypatch 验收 universe 注入 / 不收不注入).
实战基准跑 5004 标 × 1.5y 时踩过, 当天 fix.

### 2.3 报单 / 持仓 API

```python
self.buy(symbol, qty)                     # 市价多
self.sell(symbol, qty)                    # 市价空
self.order_target_percent(pct, symbol)    # 目标仓位比例 (e.g. 0.95 = 95%)
self.order_target_volume(symbol, qty)     # 目标持仓数
self.get_position(symbol) -> int          # 当前持仓 (T+1 区分总持仓/可用)
self.close_all()                          # 全平
```

### 2.4 横截面策略 — `add_daily_timer`

```python
class CrossSectionStrat(Strategy):
    def __init__(self):
        self.universe = ["sh600519", "sz000858"]

    def on_start(self):
        for s in self.universe:
            self.subscribe(s)
        self.add_daily_timer("14:55:00", "rebalance")  # A 股收盘前 5min 调仓

    def on_timer(self, payload):
        if payload != "rebalance":
            return
        # 计算分数 → 选 top → order_target_percent
        ...
```

**不要**在 `on_bar` 里靠 `bar.timestamp.weekday()` 触发调仓 — 跨标不齐, 时间戳偏移会乱.
**走 `add_daily_timer`** 是 akquant 官方推荐.

### 2.5 Phase B 锁死 — 不支持

| 不支持 | 原因 | 替代 |
|---|---|---|
| ❌ 5m / tick / 多周期 | akquant 0.3.x Phase B 锁日线 | 等 akquant 0.3.x |
| ❌ 期权 / 期货 | akquant Phase B 仅股票 | 等 akquant 0.4.x |
| ❌ 实时盘中断恢复 | v2 离线回测 | 接 QMT gateway 走 v1 path |

## 3. 数据流 — prebuilt parquet + filter pushdown

### 3.1 S3 / MinIO key layout (不变)

```
<datasetID>/<universe>/<dt>/_merged/all.parquet
```

例:
```
minio://hamuna-datasets/daily_bars_v3/hs300/2025-08-01/_merged/all.parquet
minio://hamuna-datasets/daily_bars_v3/zz500/2025-08-01/_merged/all.parquet
```

### 3.2 resolver 自适应 bundle / single

`strategy_cli.references.prebuilt_resolver.resolve(universe, start, end)` 自动选:
- **bundle 模式**: 如果整个区间是单个 `_merged/all.parquet`, 直接 pyarrow 读全表 → 快
- **single 模式**: 如果按日切片 (e.g. `2025-08-01/all.parquet` + `2025-08-02/all.parquet` + ...), 走 pyarrow filter pushdown

### 3.3 filter pushdown (减少 IO)

```python
import pyarrow.parquet as pq
table = pq.read_table(
    "s3://.../all.parquet",
    columns=["date", "symbol", "close", "volume"],
    filters=[
        ("date", ">=", "2024-07-01"),
        ("date", "<=", "2024-12-31"),
        ("symbol", "in", ["600000.SH", "600036.SH"]),
    ],
)
```

**收益**: 5004 标 × 1.5y benchmark 里, filter pushdown 把 IO 从 8.4 GB 降到 220 MB (38×).
**纪律**: 永远传 `columns=` + `filters=`, 别 `pd.read_parquet` 全量.

### 3.4 涨跌停 clamp (A 股规则)

`load_prebuilt_to_akquant_with_limits` 自动 clamp:
- 涨停 (≥10% / 科创 20%): `high = low = prev_close * 1.10`
- 跌停: `high = low = prev_close * 0.90`
- 一字板: `open = high = low = close = prev_close * (1±limit)`

这是 A 股真实成交约束 (一字板当天不能成交). 不 clamp 会高估流动性.

### 3.5 cross-sectional helpers

`strategy_cli.references.cross_sectional_helpers.compute_vol_calendar`:
```python
vol_cal = compute_vol_calendar(
    df,                       # akquant 注入的 DataFrame
    lookback=20,              # 20 日收益标准差
    rebalance_weekday=4,      # 周五调仓 (0=周一)
)
# 返 dict[str, dict[str, float]] = {date_str: {symbol: vol}}
# 策略 __init__ 接 vol_calendar, on_bar 里 dict.get(date) 算排名
```

实战模板: `examples/low_vol_topk_strategy.py` (5004 标 × 1.5y benchmark 验证).

## 4. 数据可得性 — 怎么下载

### 4.1 列出可得数据集

```bash
python -c "from strategy_cli.references.prebuilt_downloader import list_datasets; \
  print(list_datasets())"
```

### 4.2 列出已下载 universe

```bash
ls ~/.hamuna/data/prebuilt/<datasetID>/
# 例: hs300  zz500  csi1000  all_a
```

### 4.3 触发下载 (首次 / 缺包)

```bash
python -c "from strategy_cli.references.prebuilt_downloader import download; \
  download(dataset_id='daily_bars_v3', universe='hs300', \
           start='2024-01-01', end='2024-12-31')"
```

→ 落到 `~/.hamuna/data/prebuilt/daily_bars_v3/hs300/2024-01-01/.../all.parquet`.

## 5. metrics — 15 key 怎么算的

v2 metrics 全部由 `strategy_cli.references._metrics_15.compute_all(equity, trades, benchmark)` 算:

```
equity = akquant.equity_curve (ndarray)
trades = akquant.trades (list[dict])
benchmark = prebuilt benchmark 数据 (沪深 300 默认)
```

返回 14 key + 1 alias (`annualized_return`). **与 v1 driver 算法一致**, 数值精度 < 1e-6 差异.
Server 端拿到的 metrics 在两种 engine 之间无缝替换.

## 6. 与 v1 的差异 (cheat sheet)

| 维度 | v1 driver | v2 akquant |
|---|---|---|
| 引擎 | 自建 Python 撮合 (~880 行) | Rust + Python (akquant) |
| 数据 | 自建 parquet 读 + 自写 metrics | akquant 内置 + hamuna_quant_cli/._metrics_15 |
| 实测吞吐 | ~30 标/秒 (5004 标 × 1.5y → ~3h) | ~36 标/秒 (同 benchmark → 471s = ~8 min) |
| peak RSS | ~800 MB | ~2.6 GB (Rust runtime) |
| 撮合精度 | 简化 (无涨跌停 clamp) | 实盘约束 (一字板 clamp) |
| metrics 算法 | 自写 | hamuna_quant_cli/._metrics_15 (与 v1 等价, 数值 < 1e-6 差异) |
| 维护成本 | 高 (自己改) | 低 (akquant 升级) |

**结论**: v2 在性能 + 撮合精度上胜出, 但吃更多 RSS. Phase B 锁日线 + 股票.

## 7. 故障排查 — 5 个最常见错

| 现象 | 原因 | 排查 |
|---|---|---|
| `akquant AttributeError: 'Bar' object has no attribute 'time'` | 用 `bar.time` 取日期 | 改 `datetime.fromtimestamp(bar.timestamp/1e9).date()` |
| `FileNotFoundError: ~/.hamuna/data/prebuilt/daily_bars_v3/hs300/2025-XX-XX/_merged/all.parquet` | 该 dt 切片没下 | 跑 `prebuilt_downloader.download(...)` |
| `KeyError: 'benchmark'` in `_metrics_15` | 基准数据缺失 | 默认 benchmark = 沪深 300; 检查 `~/.hamuna/data/prebuilt/daily_bars_v3/hs300/` |
| `akquant run_backtest: timeout` | warmup_period 设太大 (≥ 252) | 缩到 ≤ 60; 横截面策略用 `add_daily_timer`, 别全 on_bar |
| `Result has 14 metrics keys, expected 15` | runner 端 schema_adapter 版本不对 | `pip install --upgrade hamuna_quant_cli/` |
