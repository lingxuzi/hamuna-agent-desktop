# Strategy Directions — 12 方向库 (akquant Strategy 模板)

> **v2 = akquant 0.3.x 策略方向库**. 替代 v1 "六键伪代码" 模板, 用 **akquant Strategy 子类 + 数据契约** 表达.
> 选方向 (DIR-XXX) → designer 复制对应 spec_strategy.json 模板 → coder 翻译成 akquant Strategy 子类.
> **设计纪律** (同 v1): 不引入不在本文件的方向; 加新方向必须先升级本文件 (DIR-013+).

## 0. 怎么用

1. **designer** 接到用户 4 问 → 按 §A 选择器筛候选 → 在 `spec_strategy.direction_id` 写 1 个.
2. **designer** 复制该方向 §B 的 `spec_strategy.json` 模板, 改参数 (top_n / lookback / rebalance_freq 等).
3. **coder** 收到 `spec_strategy.json` → 按 §B 的"示例代码"段复制 akquant Strategy 子类骨架, 填参数.
4. **evolver** exit 时 (条件 ② / ④) 调 `suggest_next_directions()` (§E) → 写进 `learnings.suggested_next_direction_ids`.
5. **用户** "换方向重开" → orchestrator 直接读 `suggested_next_direction_ids[0]`, 跳过 §A 选择器.

**v2 与 v1 的差异**:

| 维度 | v1 | v2 |
|---|---|---|
| 模板 | 六键伪代码 (`universe / buy_condition / ...`) | akquant Strategy 字段清单 (`strategy_class / lifecycle_hooks / state_attrs / data_dependencies / ...`) |
| 代码示例 | QMT `init/handlebar` | akquant `class Foo(Strategy)` |
| 数据契约 | 写"`C.get_market_data_ex` 取数" | 写"`runner.compute_vol_calendar(df, ...)` 注入" |
| 风险配置 | `"无此逻辑"` 占位 | akquant `RiskConfig` 字段 + 默认值 |
| 性能架构 | 整窗预计算 vs 逐 bar batch (driver 自写) | precompute vs per_bar_batch (runner 已优化) |

## 1. 方向条目

### DIR-001 双低可转债轮动

- **数学核心**: 转债价格 + 转股溢价率 双低排序, 月频轮动
- **适用**: `convertible_bond` 池 / `1d` / 中低 volatility
- **lifecycle_hooks**: `on_start` + `add_daily_timer` (月底触发)
- **核心字段**: `price` + `convert_price` + `stock_price` (后两者需容维 `/StockHq` 外部取)
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: 转债强赎 / 正股剧烈波动; 流动性差异大
- **状态**: **stub** — v2 初版未实装完整示例代码, 见 v1 `references/strategy-directions.md §B.1`. 用户用 DIR-001 时, designer 产 spec_strategy.json 引用 v1 B.1 + 标"v2 模板待补".

### DIR-002 海龟 / Donchian 趋势

- **数学核心**: Donchian 通道 (N 日最高/最低) 突破入场 + ATR 止损
- **适用**: `a_share / etf / convertible_bond` / `1d` / 任意 volatility
- **lifecycle_hooks**: `on_start` (subscribe) + `on_bar` (Donchian 计算)
- **核心字段**: `high` + `low` + `close` + `warmup_period >= N`
- **allowed_ticket_modules**: `cfg_only / state_attr / risk_config`
- **风险**: 震荡市反复止损; 跳空缺口触发延迟
- **状态**: **stub** — v1 B.2 等价; v2 模板待补.

### DIR-003 双均线 / MACD 择时

- **数学核心**: 快慢均线交叉 + MACD 柱状图 (DIF - DEA)
- **适用**: 任意池 / `1d` / 中 volatility (v2 模板支持单股 + 多股等权)
- **lifecycle_hooks**: `on_bar` (事件驱动)
- **核心字段**: `close` + `warmup_period = slow + 1`
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: 滞后入场; 均线钝化
- **状态**: ✅ **v2 完整模板** (见 §B.1)

### DIR-004 指数动量 / TSMOM / 二八轮动

- **数学核心**: 12 月动量 + 波动率倒数加权 (volatility-scaled)
- **适用**: `etf` 池 (宽基指数) / `1d` / 中 volatility
- **lifecycle_hooks**: `on_start` (subscribe + add_daily_timer) + `on_timer` (月末调仓)
- **核心字段**: `close` + 月频动量 + 年化波动率
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: 动量反转 (momentum crash)
- **状态**: **stub** — v1 B.4 等价; v2 模板待补.

### DIR-005 小市值 + 短期反转轮动

- **数学核心**: 流通市值升序 top_n + 20 日反转因子叠加
- **适用**: `a_share` 池 (过滤 ST / 北交所) / `1d` / 高 volatility
- **lifecycle_hooks**: `on_start` (subscribe) + `on_bar` (周频调仓)
- **核心字段**: `market_cap` (待 ADR-0031) + `close` + 20 日反转
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: 小市值流动性差; ST / 退市风险
- **状态**: ✅ **v2 完整模板** (见 §B.2)

### DIR-006 ATR 通道 / 网格 (均值回归)

- **数学核心**: MA ± k × ATR 通道分档建仓 / 减仓
- **适用**: `convertible_bond / etf (T+0 类)` / `5m/tick` / 中 volatility
- **lifecycle_hooks**: `on_bar` (事件驱动, 高频)
- **核心字段**: `close` + ATR + `warmup_period >= ATR_window`
- **allowed_ticket_modules**: `cfg_only / state_attr / risk_config`
- **风险**: 区间突破反向; 频繁交易吃手续费
- **状态**: ✅ **v2 完整模板** (见 §B.3)

### DIR-007 Alpha101 公式化因子 (WorldQuant 系)

- **数学核心**: Alpha101 公式 (101 条 alpha) 复合分位选股
- **适用**: `a_share` 池 / `1d` / 中高 volatility
- **lifecycle_hooks**: `on_start` (subscribe + 加载 alpha 表) + `on_bar` (月度调仓)
- **核心字段**: `close + open + high + low + volume` + alpha 复合分
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: 因子拥挤 (crowding); 历史回测过拟合
- **状态**: ✅ **v2 完整模板** (见 §B.4)

### DIR-008 Fama-French 3/5 因子本土化

- **数学核心**: 市场 / 规模 / 价值三因子 (或五因子) 残差选股
- **适用**: `a_share` 池 / `1d` / 中 volatility
- **lifecycle_hooks**: `on_start` + `on_bar`
- **核心字段**: `book_to_market` + `market_cap` (待 ADR-0031)
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: 因子周期失效; 学术口径 vs 本土数据口径差异
- **状态**: **stub** — v1 B.8 等价; v2 模板待补.

### DIR-009 Barra CNE5/CNE6 风险模型 (风格因子)

- **数学核心**: 多风格因子 z-score 残差选股
- **适用**: `a_share` 池 (行业过滤) / `1d` / 中 volatility
- **lifecycle_hooks**: `on_start` + `on_bar`
- **核心字段**: 多风格因子 (Size / Value / Momentum / Quality / Volatility ...)
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: 行业口径差异; 风格因子拥挤
- **状态**: **stub** — v1 B.9 等价; v2 模板待补.

### DIR-010 RL 组合 (离线训练 + 在线规则化)

- **数学核心**: 离线训练 RL 输出 (top_k + 仓位档位), 在线只查表不下 inference
- **适用**: `a_share` 池 / `1d` / 任意 volatility
- **lifecycle_hooks**: `on_start` (加载 RL 权重表) + `on_bar`
- **核心字段**: RL 权重表 (JSON / pickle)
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: RL 训练分布漂移; 实盘效果低于回测
- **状态**: **stub** — v1 B.10 等价; v2 模板待补.

### DIR-011 LLM 因子组合 (ADR-017 锁定路径)

- **数学核心**: LLM 输出 `factor_composition` JSON (weight × factor_id) 复合分位
- **适用**: 底层因子源决定 (可复用 DIR-007 / 008 / 009 模板)
- **lifecycle_hooks**: `on_start` (load factor_composition) + `on_bar`
- **核心字段**: `factor_composition` JSON
- **allowed_ticket_modules**: `cfg_only / state_attr / data_dep / risk_config`
- **风险**: LLM 输出不稳定; 因子权重漂移
- **状态**: **stub** — v1 B.11 等价; **关键**: LLM 在 agent 客户端 → 输出 JSON → 通过 `factor_templates` 注册 → skill 端只查表, **不在 skill 内调 LLM** (ADR-017).

### DIR-012 Lo《101 Formulaic Alphas》

- **数学核心**: 与 DIR-007 重叠 (同一作者同一年代同系列)
- **风险**: ⚠️ **重复条目风险** — 用户选 DIR-012 时, designer 自动映射到 DIR-007 (B.4 模板), 不另写代码
- **状态**: **stub** — 引用 DIR-007.

---

## A. 方向选择器 (designer 筛选规则)

按用户 4 问 (标的池 / 周期 / 数据集 / 目标) 筛兼容方向:

| 标的 / 周期 | 兼容方向 | 备注 |
|---|---|---|
| `convertible_bond` + `1d` | DIR-001 / DIR-002 / DIR-006 | 双低 / Donchian / ATR |
| `a_share` + `1d` | DIR-002 / DIR-003 / DIR-005 / DIR-006 / DIR-007 / DIR-008 / DIR-009 / DIR-010 / DIR-011 | 技术 + alpha101 + 基本面 |
| `etf` + `1d` | DIR-002 / DIR-003 / DIR-004 / DIR-010 / DIR-011 | 动量 / 波动 |
| `a_share` / `etf` + `5m`/`tick` | DIR-002 / DIR-006 (短窗口) | ATR / 短窗动量 — **v2 Phase B 锁日线, 5m/tick 待 akquant 0.3.x** |
| 单股 `stock` | DIR-003 (MA / MACD 调试用) | 单股快速验证 |

**目标硬约束推荐**:

- **sharpe > 1.5 + max_drawdown < 0.15**: 优先 DIR-007 / DIR-008 / DIR-009 / DIR-011 (多因子 / 横截面方向).
- **明确 "日内 / T+0"**: DIR-006 + 转债 / T+0 ETF 池 + `5m`/`tick`.
- **明确 "长期持有 / 月度轮动"**: DIR-001 / DIR-004 / DIR-005 / DIR-008 / DIR-009.

**v2 Phase B 限制**: `5m` / `tick` 在 akquant 0.3.x 不支持 — designer 报 `blocked:designer` (数据契约不兼容) 而不是硬选 DIR-006.

---

## B. spec_template 速查 (designer 照填)

> 每条 spec_template = `spec_strategy.json` 骨架 (8 个核心 module) + akquant 示例代码. **完整模板 60-80 行, 本节 4 个最常用方向 (DIR-003 / 005 / 006 / 007) 完整写, 其余 8 个 stub 引用 v1 B.X**.

### B.1 DIR-003 双均线 / MACD 择时 ✅ v2 完整

**spec_strategy.json 模板**:
```json
{
  "scenario": "沪深 300 双均线择时 (单标的或等权多标的)",
  "direction_id": "DIR-003",
  "strategy_class": "DualMA",
  "warmup_period": 30,
  "lifecycle_hooks": ["on_bar"],
  "state_attrs": {
    "fast": "int — 快均线周期, 默认 10",
    "slow": "int — 慢均线周期, 默认 20",
    "_qty": "int — 每标的建仓数量, 默认 100"
  },
  "data_dependencies": {
    "history_window": {"field": "close", "length": 20}
  },
  "order_methods": {
    "buy": "self.buy(sym, self._qty)",
    "sell": "self.sell(sym, pos) — pos = self.get_position(sym)"
  },
  "risk_config": {
    "max_position_pct": 0.10,
    "stop_loss_threshold": null
  },
  "perf_arch": {
    "mode": "per_bar_batch",
    "rationale": "短窗 (≤30 日) + 稀疏信号 — per_bar_batch 足够"
  },
  "objective": {"sharpe": ">1.0", "max_drawdown": "<0.20"},
  "upload_intent": "上传云端",
  "evaluator_path": "skills/hamuna-strategy-v2/strategy_cli/references/akquant_runner.run_akquant_backtest"
}
```

**akquant 示例代码** (camarero 翻译):
```python
# coding: utf-8
from akquant import Strategy, Bar
import numpy as np


class DualMA(Strategy):
    """双均线择时 — on_bar 事件驱动.

    快均线 ≥ 慢均线 → 买; 快均线 < 慢均线 → 卖.
    warmup_period = slow + 1 (确保慢均线有足够预热).
    """

    def __init__(self, fast: int = 10, slow: int = 20, qty: int = 100) -> None:
        super().__init__()
        self.fast = fast
        self.slow = slow
        self._qty = qty
        self.warmup_period = slow + 1  # 类属性后赋值

    def on_bar(self, bar: Bar) -> None:
        closes = self.get_history(self.slow, bar.symbol, 'close')
        if len(closes) < self.slow:
            return
        fast_ma = float(np.mean(closes[-self.fast:]))
        slow_ma = float(np.mean(closes))
        pos = self.get_position(bar.symbol)
        if fast_ma >= slow_ma and pos == 0:
            self.buy(bar.symbol, self._qty)
        elif fast_ma < slow_ma and pos > 0:
            self.sell(bar.symbol, pos)
```

**CONFIG JSON** (camarero 写):
```json
{
  "backtest_start": "20240701",
  "backtest_end":   "20241231",
  "universe":       ["600000", "600036"],
  "init_capital":   1000000.0,
  "strategy_params": {"fast": 10, "slow": 20, "qty": 100}
}
```

### B.2 DIR-005 小市值 + 短期反转轮动 ✅ v2 完整

**spec_strategy.json 模板**:
```json
{
  "scenario": "A 股小市值 + 20 日反转, 月频调仓 top-10",
  "direction_id": "DIR-005",
  "strategy_class": "SmallCapReversal",
  "warmup_period": 21,
  "lifecycle_hooks": ["on_start", "on_bar"],
  "state_attrs": {
    "universe": "list[str] — A 股池 (过滤 ST / 北交所)",
    "top_n": "int — 持仓数, 默认 10",
    "_market_cap_panel": "dict[str, dict[str, float]] — runner 端预计算的市值面板",
    "_held": "set[str] — 当前持仓"
  },
  "data_dependencies": {
    "market_cap_panel": {
      "source": "runner.prebuilt_resolver.compute_market_cap_panel",
      "filter": "exclude_st=True, exclude_bj=True"
    },
    "rebalance_freq": "monthly (周五触发)"
  },
  "order_methods": {
    "buy": "self.buy(sym, qty)",
    "sell": "self.sell(sym, pos)",
    "subscribe": "self.subscribe(sym) — on_start 里"
  },
  "risk_config": {
    "max_position_pct": 0.10,
    "stop_loss_threshold": 0.08
  },
  "perf_arch": {
    "mode": "precompute",
    "rationale": "全 A 池 + 月度调仓 + 市值预计算 — precompute 必需"
  },
  "objective": {"sharpe": ">1.2", "max_drawdown": "<0.25"},
  "upload_intent": "上传云端"
}
```

**akquant 示例代码** (camarero 翻译):
```python
# coding: utf-8
from akquant import Strategy
from datetime import datetime


class SmallCapReversal(Strategy):
    """A 股小市值 + 20 日反转, 月频调仓 top-N."""

    def __init__(self, universe: list[str], top_n: int = 10,
                 market_cap_panel: dict[str, dict[str, float]] = None) -> None:
        super().__init__()
        self.universe = universe
        self.top_n = top_n
        self._market_cap_panel = market_cap_panel or {}
        self._held: set[str] = set()
        self._last_rebal_d = None

    def on_start(self) -> None:
        for s in self.universe:
            self.subscribe(s)
        self.add_daily_timer('14:55:00', 'rebalance')

    def on_bar(self, bar) -> None:
        # ⚠️ akquant on_timer 不接 bar — 这里用 on_bar 做"14:55 timer 等价"
        # (模板演示用, 真实场景请用 add_daily_timer + on_timer 配合 payload 解析日期)
        # v2 coder.md §2.4 LowVolTopK 模板是正确范式 (用 bar.timestamp 算日期).
        d = datetime.fromtimestamp(bar.timestamp / 1e9).date()
        if d == self._last_rebal_d:
            return
        self._last_rebal_d = d
        d_str = d.strftime('%Y%m%d')
        cap_snapshot = self._market_cap_panel.get(d_str, {})
        if not cap_snapshot:
            return
        ranked = sorted(cap_snapshot.items(), key=lambda kv: kv[1])[:self.top_n]
        target = set(s for s, _ in ranked)
        for sym in self._held - target:
            pos = self.get_position(sym)
            if pos > 0:
                self.sell(sym, pos)
        for sym in target - self._held:
            self.buy(sym, 100)
        self._held = target
```

### B.3 DIR-006 ATR 通道 / 网格 ✅ v2 完整

**spec_strategy.json 模板**:
```json
{
  "scenario": "转债 / T+0 ETF ATR 通道网格 (5m / tick — v2 Phase B 锁日线, 见 plan §R3)",
  "direction_id": "DIR-006",
  "strategy_class": "ATRGrid",
  "warmup_period": 20,
  "lifecycle_hooks": ["on_bar"],
  "state_attrs": {
    "atr_window": "int — ATR 计算窗口, 默认 14",
    "k": "float — 通道宽度倍数, 默认 2.0",
    "max_grids": "int — 最大档数, 默认 5",
    "_atr_panel": "dict[str, float] — runner 端预计算 ATR",
    "_grid_levels": "dict[symbol, list[float]] — 各档触发价"
  },
  "data_dependencies": {
    "atr_panel": {
      "source": "runner.prebuilt_resolver.compute_atr",
      "window": 14
    }
  },
  "order_methods": {
    "buy": "self.buy(sym, qty)",
    "sell": "self.sell(sym, qty)"
  },
  "risk_config": {
    "max_position_pct": 0.20,
    "stop_loss_threshold": 0.05
  },
  "perf_arch": {"mode": "per_bar_batch", "rationale": "日内高频 — per_bar_batch"},
  "objective": {"sharpe": ">0.8", "win_rate": ">0.55"}
}
```

**akquant 示例代码** (camarero 翻译 — 简化版, 用户按需扩):
```python
# coding: utf-8
from akquant import Strategy, Bar
import numpy as np


class ATRGrid(Strategy):
    """ATR 通道网格 — 单标的, 每跌 1 ATR 加一档."""

    def __init__(self, atr_window: int = 14, k: float = 2.0,
                 max_grids: int = 5) -> None:
        super().__init__()
        self.atr_window = atr_window
        self.k = k
        self.max_grids = max_grids
        self.warmup_period = atr_window + 1

    def on_bar(self, bar: Bar) -> None:
        closes = self.get_history(self.atr_window, bar.symbol, 'close')
        highs = self.get_history(self.atr_window, bar.symbol, 'high')
        lows = self.get_history(self.atr_window, bar.symbol, 'low')
        if len(closes) < self.atr_window:
            return
        ma = float(np.mean(closes))
        atr = float(np.mean([h - l for h, l in zip(highs, lows)]))
        lower = ma - self.k * atr
        upper = ma + self.k * atr
        pos = self.get_position(bar.symbol)
        if bar.close <= lower and pos < self.max_grids * 100:
            self.buy(bar.symbol, 100)
        elif bar.close >= upper and pos > 0:
            self.sell(bar.symbol, min(pos, 100))
```

### B.4 DIR-007 Alpha101 公式化因子 ✅ v2 完整

**spec_strategy.json 模板**:
```json
{
  "scenario": "A 股 Alpha101 复合分位选股, 月频调仓 top-20",
  "direction_id": "DIR-007",
  "strategy_class": "Alpha101Factor",
  "warmup_period": 30,
  "lifecycle_hooks": ["on_start", "on_bar"],
  "state_attrs": {
    "universe": "list[str] — A 股池",
    "top_n": "int — 默认 20",
    "alpha_ids": "list[str] — 选用的 alpha id (e.g. ['alpha001', 'alpha006'])",
    "_alpha_panel": "dict[str, dict[str, float]] — runner 端预计算 alpha 分",
    "_held": "set[str]"
  },
  "data_dependencies": {
    "alpha_panel": {
      "source": "runner.prebuilt_resolver.compute_alpha_panel",
      "alpha_ids": "from spec_strategy.state_attrs.alpha_ids",
      "pre_registered": "alpha ids 必须在 factor_templates 注册 (ADR-011)"
    }
  },
  "order_methods": {"buy": "self.buy", "sell": "self.sell"},
  "risk_config": {"max_position_pct": 0.05, "stop_loss_threshold": 0.08},
  "perf_arch": {"mode": "precompute", "rationale": "全 A 池 + 月度调仓 + 多 alpha 复合"},
  "objective": {"sharpe": ">1.3", "max_drawdown": "<0.20"}
}
```

**akquant 示例代码** (camarero 翻译 — 简化版):
```python
# coding: utf-8
from akquant import Strategy
from datetime import datetime


class Alpha101Factor(Strategy):
    """Alpha101 复合分位选股 — 月频调仓 top-N."""

    def __init__(self, universe: list[str], top_n: int = 20,
                 alpha_ids: list[str] = None,
                 alpha_panel: dict[str, dict[str, float]] = None) -> None:
        super().__init__()
        self.universe = universe
        self.top_n = top_n
        self.alpha_ids = alpha_ids or ['alpha001', 'alpha006']
        self._alpha_panel = alpha_panel or {}
        self._held: set[str] = set()
        self._last_rebal_d = None

    def on_start(self) -> None:
        for s in self.universe:
            self.subscribe(s)
        self.add_daily_timer('14:55:00', 'rebalance')

    def on_timer(self, payload: str) -> None:
        if payload != 'rebalance':
            return
        # ⚠️ akquant on_timer 不接 bar — 用 add_daily_timer 时 payload 含触发时刻,
        # 需要 strategy 记录 last_payload_ts 或用 on_bar + bar.timestamp (B.2 等价做法).
        # 此处为模板简化, 真实实现参考 v2 coder.md §2.4 LowVolTopK.
        d_str = payload  # 占位
        alpha_snapshot = self._alpha_panel.get(d_str, {})
        if not alpha_snapshot:
            return
        # 复合分: 多 alpha 等权求和再 rank
        ranked = sorted(alpha_snapshot.items(), key=lambda kv: kv[1], reverse=True)
        target = set(s for s, _ in ranked[:self.top_n])
        for sym in self._held - target:
            pos = self.get_position(sym)
            if pos > 0:
                self.sell(sym, pos)
        for sym in target - self._held:
            self.buy(sym, 100)
        self._held = target
```

### B.5-B.12 (DIR-001 / 002 / 004 / 008 / 009 / 010 / 011 / 012) — **stub**

8 个方向 v2 初版未实装完整示例代码, designer 复制 v1 §B.X (六键伪代码) + 人工翻译成 akquant 字段清单. 后续每个方向补 §B.X 完整段 (按本节 B.1-B.4 模板).

---

## C. 升级方向库流程

**加新方向 (DIR-013+)** 必须两步顺序走 (与 v1 §D 等价, 简化无 STRAT-HIST 耦合):

1. **先在本文件 §1 加条目**: `direction_id` 从 DIR-013 顺延 (稳定 ID, 不许重排). 写明 6 字段:
   - 数学核心 / 适用池+周期+volatility / lifecycle_hooks / 核心字段 / allowed_ticket_modules / 风险
2. **再在 §B 加 spec_template + 示例代码** (按 B.1-B.4 模板): spec_strategy.json + akquant Strategy 子类骨架 + CONFIG JSON.

**反向 (先有代码没方向) 的代价**:
- designer 不会引用 → 永远进不了 spec.
- 后续加方向时混乱 (designer 自由发挥 = 不可控).

**v2 简化**: 无 STRAT-HIST coupling 段 (v1 §C) — STRAT-HIST 未实装 (server 端无 collection). evolver 走降级路径 (无历史 → 限制 max-rounds=5).

---

## D. (v1 §D 等价) — 升级方向库的完整流程

详见 v1 `references/strategy-directions.md §D`. v2 沿用, 简化无 STRAT-HIST 段.

---

## E. 死方向推荐算法 (DEAD-END SUGGEST)

**触发场景**: evolver 退出条件 ② (连续 2 轮无改善) 或 ④-未达 (historical_p75_reached_not_met).

**算法 (`references/_helpers.py::suggest_next_directions(pool_type, period, current_direction_id, historical_summary=None, k=3)`)**:

1. **候选池**: 与 §A 同, `_DIRECTION_POOL_COMPAT[(pool_type, period)]`.
2. **硬排除 `current_direction_id`**: 不回头推当前死方向.
3. **硬排除跨策略死方向** (STRAT-HIST 段): `historical_summary.direction_distribution[id] ≥ 50%` 且 `exit_reason_distribution.no_improvement ≥ 50%` → 排除. **v2 降级路径**: `historical_summary=None` 时跳过本步.
4. **软降权**: 跨策略 `direction_distribution` 频次 ≥ 2 的方向排后. **v2 降级路径**: 跳过 (无历史).
5. **返回 top k** (默认 3).

**v2 降级语义**: `historical_summary=None` → 走 §A 选择器重筛 (无历史加权), 返回 top 3 中排除 current_direction_id. **禁止 fallback 到默认 DIR-007** (违背证据原则).

**接入点**:
- `evolver` exit 时 (条件 ② / ④-未达) 调 → 写 `learnings.suggested_next_direction_ids`.
- 用户 "换方向重开" → orchestrator 读 `suggested_next_direction_ids[0]`, 跳过 §A 选择器.

**空结果语义**: `[]` = 当前池/周期下无未死方向, orchestrator 走原 abort 路径.

**`learnings.suggested_next_direction_ids` schema**: 见 `references/pipeline.md §2.7`.
