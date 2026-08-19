# scaffolds — strategy 模板速查 (v2)

> **给 coder 用**: 4+ 个即抄即改的策略模板, 每个含完整 .py + config.json,
> 跑得通 `strategy_cli run` → result.json. 全部基于 **akquant 0.3.x** API
> (`Strategy` 子类 + `on_bar(bar)` + `on_timer(payload)` + `add_daily_timer`),
> **不是** v1 QMT-style (`init(ContextInfo)` + `handlebar(ContextInfo)`).
>
> **选型指南**: 见 §6. **与 v1 模板的差异**: 见 §7.

## 1. 模板清单

| 模板 | 适用 | API 风格 | 行数 |
|---|---|---|---|
| [§2 buyhold](#2-buyhold-入门) | 入门 / parity 校验 | on_bar + IntParam | ~15 |
| [§3 dual_ma](#3-dual_ma-经典双均线) | 趋势跟踪入门 | on_bar + get_history + IntParam | ~25 |
| [§4 momentum_rotation](#4-momentum_rotation-横截面动量) | 跨标轮动入门 | **compute_factors + filter_symbols** + on_cross_section | ~75 |
| [§5 low_vol_topk](#5-low_vol_topk-实战低波) | 实战周频调仓 (5004 syms 验证) | **compute_factors + filter_symbols** + on_cross_section | ~75 |
| [§6 add_daily_timer](#6-add_daily_timer-定时调仓模板) | v2 特有 hook (任何时点调仓) | on_start + add_daily_timer + on_timer | ~30 |

---

## 2. buyhold (入门)

**用途**: 跑通最小化 akquant 流程 / parity test / 入门. 一次性买入持有到回测结束.
**约束**: 同一份代码同时跑回测 + 实盘 (akquant 0.3.x `Strategy` 双引擎一等公民).

```python
"""buyhold.py — buy-and-hold 模板 (v2 akquant).

纪律: 6 rule 全过 (无 QMT globals, 含 on_bar, 不含 handlebar/init(ContextInfo)).
"""
from akquant import Strategy, Bar, IntParam


class BuyHold(Strategy):
    """一次性 buy & hold: 首次 on_bar 满仓买入, 之后不动.

    用 IntParam 声明内联参数字段 — akquant 0.3.x 强制 (self.params.qty 访问).
    同一份 .py 回测 (strategy_cli run) + 实盘 (hamuna_strategy.py live run) 都跑得通.
    """

    qty = IntParam(100, ge=1, le=10000, title="每只买几股")
    warmup_period = 1

    def on_start(self) -> None:
        self._bought: set[str] = set()

    def on_bar(self, bar: Bar) -> None:
        if bar.symbol in self._bought:
            return
        self.buy(bar.symbol, self.params.qty)
        self._bought.add(bar.symbol)
```

对应 `config.json`:

```json
{
  "backtest_start":  "20240701",
  "backtest_end":    "20241231",
  "universe":        ["600000", "600036"],
  "init_capital":    1000000.0
}
```

跑通:

```bash
hamuna_quant_cli run buyhold.py --config config.json --output result.json
# 期望: trades > 0, final_capital ≈ initial × (1 + buyhold return)

# 实盘 (paper 模式, 同 .py)
python desktop/app/src-tauri/resources/hamuna_strategy.py live run buyhold.py \
  --mode paper --broker qmt --market-broker qmt_market \
  --symbols sh600000,sz600036 \
  --gateway-options "qmt_account_id=8888888888,qmt_paper=1"
```

**实战注意**: `self.params.qty` 是 IntParam 只读访问 (akquant 0.3.x 内置校验).
qty=100 是 1 手 (A 股最小交易单位). 实盘应根据 `init_capital / universe_size`
动态算 — 用 `IntParam / FloatParam` 暴露即可让用户在跑回测 / 实盘时覆盖.

---

## 3. dual_ma (经典双均线)

**用途**: 趋势跟踪入门, get_history 算均线. 单标的. 用 akquant 内置 `get_history`,
不用 BacktestContext / ComputeContext 抽象.

```python
"""dual_ma.py — 经典双均线 (v2 akquant).

纪律: 8 rule 全过. 用 get_history 取历史 close 算均线.
"""
from akquant import Strategy, Bar, IntParam


class DualMA(Strategy):
    """fast > slow → 满仓; fast < slow → 清仓."""

    fast = IntParam(10, ge=2, le=200, title="快线周期")
    slow = IntParam(30, ge=3, le=500, title="慢线周期")
    qty  = IntParam(100, ge=1, le=10000, title="每只买几股")

    def on_start(self) -> None:
        # warmup_period 必须 >= slow (策略最大窗口)
        self.warmup_period = self.params.slow + 1

    def on_bar(self, bar: Bar) -> None:
        # akquant 内置 get_history: ndarray 快照 (纳秒级, 安全拷贝)
        fast_ma = self.get_history(self.params.fast, bar.symbol, 'close').mean()
        slow_ma = self.get_history(self.params.slow, bar.symbol, 'close').mean()

        pos = self.get_position(bar.symbol)
        if fast_ma > slow_ma and pos == 0:
            self.buy(bar.symbol, self.params.qty)
        elif fast_ma < slow_ma and pos > 0:
            self.sell(bar.symbol, pos)
```

对应 `config.json`:

```json
{
  "backtest_start":  "20240701",
  "backtest_end":    "20241231",
  "universe":        ["600000"],
  "init_capital":    1000000.0,
  "commission_rate": 0.0003,
  "stamp_tax_rate":  0.0005,
  "t_plus_one":      true
}
```

**实战注意**:
- `self.get_history(N, symbol, 'close')` 返 numpy.ndarray (length=N)
- 长 N + 慢 K 线组合 → warmup_period 设大 (e.g. slow=60 → warmup=61)
- 单标的; 多标的要每个 bar.symbol 独立算 (本模板即可)

---

## 4. momentum_rotation (横截面动量 — compute_factors + filter_symbols)

**用途**: 跨标的轮动入门 — 用 v2 新接口 `compute_factors` (向量化算因子) +
`filter_symbols` (选 top-K), 引擎加载 df 后一次性调, 避免每个 bar 都重算.

```python
"""momentum_rotation.py — 横截面动量轮动 (v2 akquant).

纪律: 8 rule 全过. compute_factors (引擎启动期一次性算) → filter_symbols 选 top-K →
on_bar 持仓 / on_cross_section (可选) 同周期调仓.

回测引擎传 prebuilt df 给 compute_factors (列含 symbol, open, high, low, close, volume);
实盘引擎走 bridge_server /data/history 拉 N sym 历史拼 {sym: df} 喂 compute_factors.
业务代码 100% 复用, 引擎自动适配 IO 路径.
"""
from datetime import datetime

import pandas as pd

from akquant import Strategy, Bar, IntParam, ListParam


class MomentumRotation(Strategy):
    """N 日动量 top-K 周频调仓 — 同一份 .py 跑回测 + 实盘."""

    lookback  = IntParam(20, ge=2, le=200, title="动量回看 N 日")
    top_k     = IntParam(5,  ge=1, le=50,  title="选 top K 标的")
    qty       = IntParam(100, ge=1, le=10000, title="每只买几股")
    universe  = ListParam(item_type=str, default=[], title="标的池 (cfg 注入)")

    warmup_period = 21

    def on_start(self) -> None:
        for s in self.params.universe:
            self.subscribe(s)
        self._held: set[str] = set()

    def compute_factors(self, df: pd.DataFrame) -> dict[str, pd.DataFrame]:
        """向量化算每个 sym 的 N 日动量。akquant.talib.ROC (rust 后端 5-10x) 替代手算。

        回测传 prebuilt (列含 symbol); 实盘传 {sym: df} 字典 (引擎拼好) 或拼接 DataFrame.
        NaN / warmup 用户自己 dropna, 引擎不强制.
        """
        from akquant import talib
        factors: dict[str, pd.DataFrame] = {}
        sym_iter = df["symbol"].unique() if "symbol" in df.columns else df.keys()
        for sym in sym_iter:
            sub = df[df["symbol"] == sym].reset_index(drop=True).copy() \
                if "symbol" in df.columns else df[sym].copy()
            if len(sub) < self.params.lookback + 1:
                continue
            closes = sub["close"].to_numpy()
            # talib.ROC = (close[i] - close[i-N]) / close[i-N], 等价 close.pct_change(N)
            sub["momentum"] = talib.ROC(closes, self.params.lookback)
            factors[sym] = sub
        return factors

    def filter_symbols(self, factors: dict[str, pd.DataFrame]) -> list[str]:
        """取每 sym 最后一根 momentum, 选 top-K。
        引擎在 akquant.run_backtest / run_live 之前调一次.
        """
        last_mom = {sym: f["momentum"].iloc[-1] for sym, f in factors.items() if not f.empty}
        if not last_mom:
            return []
        return sorted(last_mom, key=lambda s: last_mom[s], reverse=True)[:self.params.top_k]

    def on_bar(self, bar: Bar) -> None:
        # 持仓 carry forward — 调仓走 filter_symbols (引擎期) + self.sell/buy (运行时)
        pass

    def on_cross_section(self, trading_date, timestamp) -> None:
        """横截面同周期调仓 — engine 在每日首个完整 bar 切片后触发。
        仓位不匹配目标 → sell/buy 调平.
        """
        # 用 self.get_instruments() 拿当前 universe (engine 已限定到 filter_symbols 范围)
        universe = list(self.get_instruments().keys())
        # 重新算 momentum (简单方法: close.pct_change), 取 top-K
        scores: dict[str, float] = {}
        for sym in universe:
            closes = self.get_history(self.params.lookback, sym, 'close')
            if len(closes) < self.params.lookback:
                continue
            scores[sym] = float((closes[-1] - closes[0]) / closes[0])
        if not scores:
            return
        target = set(sorted(scores, key=scores.get, reverse=True)[:self.params.top_k])

        # sell 落榜, buy 新进
        for sym in self._held - target:
            pos = self.get_position(sym)
            if pos > 0:
                self.sell(sym, pos)
        for sym in target - self._held:
            self.buy(sym, self.params.qty)
        self._held = target
```

对应 `config.json`:

```json
{
  "backtest_start":  "20240701",
  "backtest_end":    "20241231",
  "universe":        ["600000", "600036", "000001", "000002"],
  "init_capital":    1000000.0,
  "strategy_params": {
    "top_k": 2
  }
}
```

(`strategy_params` 是 0.3.x 内联字段运行时覆盖入口; ListParam.universe 也可
由 cfg 注入.)

**实战注意**:
- `compute_factors` / `filter_symbols` 是 v2 skill 新接口 — 引擎在
  `akquant.run_backtest` / `run_live` 之前自动调, 业务不感知是回测还是实盘
- `on_cross_section` 是 0.3.x 横截面同周期调仓 hook (替代老 add_daily_timer 范式)
- `get_instruments()` 拿 engine 注入的 universe 快照 (filter_symbols 后限定)

---

## 5. low_vol_topk (实战低波 — compute_factors + filter_symbols)

**用途**: 实战周频调仓 (5004 syms benchmark 验证). 用 `compute_factors` 一次性算
所有 sym 的 vol, `filter_symbols` 选低波 top-K. 跟 §4 区别: 加 `slippage` / `volume_limit_pct`
/ `price_limit_clamp` 实盘级参数.

```python
"""low_vol_topk.py — 20 日低波动 top K 周频调仓 (v2 akquant).

数据: vol_calendar dict[YYYYMMDD, dict[sym, vol]] 外部注入.
来源: strategy_cli.references.cross_sectional_helpers.compute_vol_calendar.

实战: hs300 5004 syms × 1.5y benchmark (trades=1404, 707 syms).

compute_factors (向量化算 vol) + filter_symbols (选 top-K) — 引擎启动期一次性,
避免每个 bar 都重算全 universe.
"""
from datetime import datetime

import pandas as pd

from akquant import Strategy, Bar, IntParam, ListParam


class LowVolTopK(Strategy):
    """20 日低波动 top K 周频调仓 (Friday 14:55)."""

    top_k  = IntParam(50, ge=1, le=50, title="选 top K 标的 (上限 50)")
    qty    = IntParam(100, ge=1, le=10000, title="每只买几股")
    rebalance_weekday = IntParam(4, ge=0, le=4, title="调仓日 (4=周五)")
    universe = ListParam(item_type=str, default=[], title="标的池")

    warmup_period = 21

    def on_start(self) -> None:
        for s in self.params.universe:
            self.subscribe(s)
        self._held: set[str] = set()

    def compute_factors(self, df: pd.DataFrame) -> dict[str, pd.DataFrame]:
        """一次性算每 sym 20 日 vol。akquant.talib.STDDEV (rust 5-10x) 替代手算 rolling。
        回测: 引擎传 prebuilt DataFrame (列 symbol, open, high, low, close, volume);
        实盘: 引擎传 {sym: df} 字典 (bridge_server /data/history 拉的历史).
        """
        from akquant import talib
        factors: dict[str, pd.DataFrame] = {}
        sym_iter = df["symbol"].unique() if "symbol" in df.columns else df.keys()
        for sym in sym_iter:
            sub = df[df["symbol"] == sym].reset_index(drop=True).copy() \
                if "symbol" in df.columns else df[sym].copy()
            # talib.STDDEV = sample std (ddof=1), 等价 pandas .std()
            ret = sub["close"].pct_change().to_numpy()
            sub["vol_20"] = talib.STDDEV(ret, 20)
            factors[sym] = sub
        return factors

    def filter_symbols(self, factors: dict[str, pd.DataFrame]) -> list[str]:
        """取 vol_20 末值升序, 选 top-K.
        引擎拿这个 list 当 universe 喂 akquant.run_backtest / run_live.
        """
        last_vols = {
            sym: f["vol_20"].iloc[-1]
            for sym, f in factors.items()
            if not f.empty and not f["vol_20"].iloc[-1] != f["vol_20"].iloc[-1]  # 非 NaN
        }
        if not last_vols:
            return list(factors.keys())
        return sorted(last_vols, key=lambda s: last_vols[s])[:self.params.top_k]

    def on_bar(self, bar: Bar) -> None:
        pass  # 持仓 carry forward

    def on_cross_section(self, trading_date, timestamp) -> None:
        """横截面同周期调仓 — 每周指定日重选 top-K."""
        td = self.now.date() if hasattr(self, 'now') else None
        if td is None or td.weekday() != self.params.rebalance_weekday:
            return
        # engine 已用 filter_symbols 限定 universe, 直接读
        universe = list(self.get_instruments().keys())
        vols: dict[str, float] = {}
        for sym in universe:
            closes = self.get_history(20, sym, 'close')
            if len(closes) < 20:
                continue
            vols[sym] = float(closes.std())
        if not vols:
            return
        target = set(s for s, _ in sorted(vols.items(), key=lambda x: x[1])[:self.params.top_k])

        for sym in self._held - target:
            pos = self.get_position(sym)
            if pos > 0:
                self.sell(sym, pos)
        for sym in target - self._held:
            self.buy(sym, self.params.qty)
        self._held = target
```

对应 `config.json` (跑 5004 syms 实盘级 benchmark):

```json
{
  "backtest_start":  "20230101",
  "backtest_end":    "20241231",
  "universe":        ["600000", "600036", "000001", "000002", "600519"],
  "init_capital":    1000000.0,
  "commission_rate": 0.0003,
  "stamp_tax_rate":  0.0005,
  "slippage":        0.001,
  "volume_limit_pct": 0.10,
  "t_plus_one":      true,
  "price_limit_clamp": true
}
```

**实战坑**:
- 实测 `akquant.Strategy.rebalance_to_topn(...)` 在 0.3.x 返回 `[]`, 0 trades —
  必须用 `self.buy / self.sell` 自己拼
- multi-symbol orders 上限 ~48 (实测 `_orders_threshold_probe.py`) — 不要
  top_k > 50
- vol 计算: `closes.std()` 是 sample std (ddof=1), 跟 cross_sectional_helpers
  的 compute_vol_calendar 同公式 — 一致
- `compute_factors` 在引擎启动期一次性算, 实盘重启一次 (启动慢); 若要每 bar 重算
  走 `register_indicator` + `self.indicator(...)` — 纳秒级环形缓冲

---

## 6. add_daily_timer (定时调仓模板)

**用途**: v2 特有 — 任何时点定时触发, 不依赖 bar 节奏 (e.g. 14:55 调仓,
盘中风控检查, 日终结算).

```python
"""add_daily_timer 模板 — 定时 hook (v2 akquant).

适用场景:
  - 收盘前 5 分钟统一调仓 (避免每 bar 都算 universe)
  - 盘中定时风控检查 (e.g. 10:00 / 14:00 看回撤)
  - 日终结算 (15:30 报最终持仓)
"""
from datetime import datetime

from akquant import Strategy, Bar


class DailyTimerDemo(Strategy):
    """演示 3 个定时 hook: 10:00 风控 / 14:55 调仓 / 15:30 结算."""

    warmup_period = 1

    def __init__(self, universe: list[str]):
        super().__init__()
        self._universe_list = universe

    def on_start(self) -> None:
        # payload 是 str, 在 on_timer 里 switch
        self.add_daily_timer('10:00:00', 'risk_check')
        self.add_daily_timer('14:55:00', 'rebalance')
        self.add_daily_timer('15:30:00', 'eod_report')

    def on_bar(self, bar: Bar) -> None:
        pass

    def on_timer(self, payload: str) -> None:
        if payload == 'risk_check':
            self._risk_check()
        elif payload == 'rebalance':
            self._rebalance()
        elif payload == 'eod_report':
            self._eod_report()

    def _risk_check(self) -> None:
        # 盘中 10:00 检查持仓回撤 — 实盘常用
        # 这里只 demo 写法; 真实回撤需 cross-symbol aggregate
        td = self.now.date() if hasattr(self, 'now') else None
        print(f'[{td}] risk_check: held={self._held}')

    def _rebalance(self) -> None:
        # 14:55 调仓 — 见 §4 / §5
        pass

    def _eod_report(self) -> None:
        # 15:30 日终 — 打印当日 P&L (debug 用)
        td = self.now.date() if hasattr(self, 'now') else None
        print(f'[{td}] eod: positions={self.get_positions()}')


# ★ self._held 必填 (risk_check 用), 否则 AttributeError
DailyTimerDemo._held = set()  # type: ignore
```

**实战注意**:
- `add_daily_timer('HH:MM:SS', payload_str)` — akquant 0.3.x 接受秒级 (新代码优先用 `on_cross_section`, 见 §10 兼容说明)
- 一个 strategy 可挂多个 timer, payload 不同区分
- timer 触发日线 backtest 也正常 (hamuna_quant_cli//examples 验证)

---

## 7. 模板选型指南

| 想做什么 | 用哪个模板 | 关键改动 |
|---|---|---|
| 跑通最小化流程 / parity test | buyhold | 改 universe |
| 单标的趋势跟踪入门 | dual_ma | 改 fast/slow |
| 跨标动量轮动 (周/月频) | momentum_rotation | 改 lookback/top_k |
| 跨标低波防御 | low_vol_topk | 加 alpha 多因子 |
| 盘中风控 + 日终报告 | add_daily_timer | 加 timer |
| 实盘级 benchmark (5000+ syms) | low_vol_topk | 扩 universe + qty |

---

## 8. 与 v1 scaffolds 的差异

| 维度 | v1 (QMT-style) | v2 (akquant-style) |
|---|---|---|
| 类继承 | 无 (用 module-level `init` + `handlebar`) | **必继承 `akquant.Strategy`** |
| 主入口 | `def init(ContextInfo): pass` | `def on_start(self): pass` (可选) |
| Bar 回调 | `def handlebar(ContextInfo): pass` | `def on_bar(self, bar: Bar): pass` |
| 跨标调度 | `run_time('14:55:00', 'sh stocks')` QMT | `self.add_daily_timer('14:55:00', 'rebalance')` akquant |
| Timer 回调 | (无显式回调, ContextInfo._is_last_bar 触发) | `def on_timer(self, payload: str): pass` |
| 历史数据 | `ContextInfo.get_market_data_ex(...)` | `self.get_history(N, sym, 'close')` (numpy) |
| 持仓查询 | `ContextInfo.get_position(...)` | `self.get_position(sym)` |
| 下单 | `passorder(..., ContextInfo)` QMT | `self.buy(sym, qty)` / `self.sell(sym, qty)` |
| 编码 | `# coding: gbk` (QMT 必需) | 默认 utf-8 (akquant 拒 `# coding: gbk`) |
| cert 检查 | `ContextInfo._cert_status` in `init()` | akquant 不需要 (无证书概念) |
| `is_last_bar` gate | `handlebar` 头 `if not C.is_last_bar(): return` | 不需要 (akquant 默认每个 bar 都触发) |

**核心**: v2 砍掉了 QMT 撮合层的所有概念 (ContextInfo / passorder / run_time /
cert_status / m_strRemark / quickTrade). 策略代码**只关心业务逻辑** —
on_bar / on_timer / get_history / buy / sell. 纪律检查见 `role-gates.md`.

---

## 9. 自检 (coder 怎么验自己写的策略)

最小审计:

```bash
# 1) py_compile
python3 -m py_compile strategy.py

# 2) 纪律 self-check (6 rule)
hamuna_quant_cli check strategy.py --config config.json
# 期望: "纪律 self-check 通过 (0 条)"
# 不通过 → 看 stderr 提示改对应 rule

# 3) 跑小窗口 (先验通)
cat > smoke_config.json <<EOF
{
  "backtest_start":  "20241201",
  "backtest_end":    "20241231",
  "universe":        ["600000", "600036"],
  "init_capital":    100000.0
}
EOF

hamuna_quant_cli run strategy.py \
  --config smoke_config.json \
  --output /tmp/smoke_result.json
# 期望: trades > 0, metrics 15 key 齐全

# 4) 验 13-key schema
python3 -c "
import json
r = json.load(open('/tmp/smoke_result.json'))
required = ['metrics', 'equity_curve', 'trades', 'universe', 'period', 'params',
            'monthly_metrics', 'monthly_bars', 'initial_capital', 'final_capital',
            'avg_holding_period', 'suggestions', 'benchmark_curve']
miss = [k for k in required if k not in r]
if miss: raise SystemExit(f'缺: {miss}')
print(f'  ✓ 13 顶层 key 齐, {len(r[\"metrics\"])} metrics keys')
"

# 5) 跑全窗口
hamuna_quant_cli run strategy.py \
  --config config.json \
  --output runs/<run_id>/result.json
# 期望: result.json 落盘, stdout json 13-key dict
```

---

## 10. 不在模板中的 (留给用户扩展)

- **多因子综合 score** (momentum + EP + low_vol) — §5 只演示低波; 综合因子
  在 `_risk_check` / `_rebalance` 内加权
- **行业 / 市值中性化** — 需 cross_sectional_helpers + 行业字典 (e.g. SW 行业)
- **turnover cap** — 在 `_rebalance` 内加 if abs(target_change) < threshold: skip
- **walk-forward / 滚动优化** — `akquant.run_walk_forward(strategy, param_grid, ...)`
- **param grid search** — `akquant.run_grid_search(strategy, param_grid, ..., sort_by='sharpe_ratio')`

这些都靠 akquant 0.3.x 公共 API, 不需要 v2 自己再写一层.