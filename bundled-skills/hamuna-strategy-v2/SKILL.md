---
name: hamuna-strategy-v2
description: 用 akquant 0.3.x 引擎写 A 股策略 (`class Foo(akquant.Strategy)` + `on_bar`), 通过 `hamuna_quant_cli` 独立 pip 包跑回测 / 实盘 (Round 14 重构). 当用户想用 akquant / 引擎回测 / 写新策略 / 量化策略 / 均线 / 动量 / 横截面轮动, 或说 "hamuna" / "回测一下" / "跑回测" / "写个策略" / "用 akquant" / "hamuna_quant_cli", 或提到 A 股 / 沪深 300 / 日线股票池时使用。替代 v1 自建 driver + QMT-style 规范; QMT 导出仍走 v1 + cloud。用户未指定引擎时, 日线股票策略默认 v2 (自动调 `hamuna_quant_cli`)。
author: HamunaAgent
version: 20260818
---
# hamuna-strategy-v2

> **hamuna quant 驱动的 A 股回测 skill** (本地实测 0.3.41). 替代 v1 自建 driver + QMT-style 策略规范.  
> **Round 14 重构**: 全部代码移到顶层独立 pip 包 `hamuna-quant-cli` (`pip install hamuna-quant-cli` 后
> `hamuna_quant_cli <args>` 直接可用). v2 skill 仅保留 SKILL.md / agents/ / references/ 作为
> 文档入口. **QMT 导出路径完全不动** (仍由 v1 + cloud 端支撑). v1 与 v2 并行, 用户选 engine.
>
> **分层 (重要)**:
>
> - **v2 skill 本体 = 离线回测** — 写策略 → `hamuna_quant_cli run` 跑回测 → `upload` 上传 metrics.
> - **实盘接入 = `hamuna_quant_cli live run`** (顶层独立 pip 包, pip install 后 PATH 上).
> desktop Tauri 启动器自动 spawn `hamuna_quant_cli live run <strategy.py>` (Round 14 重构, 替代
> 老的 `python <driver.py>`). v2 skill 不直接驱动实盘, 但 0.3.x 策略代码的 `compute_factors/ filter_symbols/on_bar` 形态 **设计上兼容回测与实盘 (双引擎一等公民)**.
>
> **0.3 加速原语** (runner 自动启用, 不改 strategy 也能拿到):
>
> - `history_depth` 推断 — 长窗策略 -20~40% elapsed, 短窗无害
> - `start_time / end_time` 引擎内切片 — 大 universe 省内存 + 正确处理 warmup
> - `lot_size=100` A 股整手 — 替代 qmt_translator 的 `int(qty/100)*100` 拆单
> - `commission_policy` dict 形态 — 0.3+ 推荐写法, 行为等价 `commission_rate`
>
> **0.3 新 API** (strategy 改写才生效, 见 `references/engine-and-data.md` §6):
>
> - `Strategy.get_history_multi(count, sym, fields)` — 一次 FFI 拉多字段
> - `Strategy.on_cross_section(...)` — 引擎保证 cross-section 数据一致 (替代 `schedule_daily+on_timer`)
> - `Strategy.indicator_mode="precompute"` + `register_precomputed_indicator(...)` — O(1) on_bar 读指标
> - `akquant.run_walk_forward(...)` / `run_grid_search(...)` — 引擎级 WFO + grid

## 自动安装 (skill 触发时一次性检查)

Claude Code 触发本 skill 时, 第一次跑 `hamuna_quant_cli` 前**自动检测**:

```bash
# 1) 检测命令存在
if ! command -v hamuna_quant_cli >/dev/null 2>&1; then
    echo "[hamuna-strategy-v2] hamuna_quant_cli 未安装, 开始 pip install..."
    pip install 'hamuna-quant-cli>=0.1.0' || python -m pip install 'hamuna-quant-cli>=0.1.0'
fi
# 2) 验证可调
hamuna_quant_cli --version 2>&1 || python -m hamuna_quant_cli --version
```

> **pip install hint**: 国内镜像源加 `--index-url https://pypi.tuna.tsinghua.edu.cn/simple`
> (清华). akquant 是 hamuna-quant-cli 的依赖, 自动拉.

> **desktop (Tauri) 启动器**: 启动策略前 Rust 调用 `check_runtime_env_cmd` 检测
> python + hamuna_quant_cli, 缺哪个弹窗提示 `pip install hamuna-quant-cli`.

## 一句话定位

> 写一份 `class MyStrat(akquant.Strategy)`, `cmd_run` 跑回测, `cmd_upload` 把 13-key
> 结果传 server. **没有私有 IR / DSL / 自建引擎**.

---

## 快速开始 (3 步)

### 1. 安装 (独立 pip 包, 无需 PYTHONPATH)

```bash
pip install 'hamuna-quant-cli>=0.1.0'
# 安装后 `hamuna_quant_cli` 直接是 shell 命令; 也可 `python -m hamuna_quant_cli`
# akquant 是 hamuna-quant-cli 的依赖, 自动拉
```

**本地源码装** (开发 v2 skill 时):

```bash
pip install -e .   # 在 hamuna-strategy-platform 根目录
```

**Windows wheel** (release):

```bash
pip install hamuna_quant_cli-0.1.0-py3-none-any.whl
```

### 2. 写策略 + CONFIG

```python
# my_strategy.py
# coding: utf-8
from akquant import Strategy, Bar

class MyStrat(Strategy):
    warmup_period = 20
    def on_bar(self, bar: Bar):
        if self.get_position(bar.symbol) == 0:
            self.buy(bar.symbol, 100)
```

```json
// my_config.json
{
  "backtest_start": "20240701",
  "backtest_end":   "20241231",
  "pool":           {"hs300": {"codes": ["600000.SH", "600036.SH"]}},
  "init_capital":   1000000.0
}
```

### 3. 跑回测 + 上传

```bash
# 回测 (hamuna_quant_cli 是 console_script, 直接调)
hamuna_quant_cli run my_strategy.py --config my_config.json --output result.json

# 也可走 module 入口 (兼容老 PYTHONPATH 工作流)
python -m hamuna_quant_cli run my_strategy.py --config my_config.json --output result.json

# 上传 (假设 strategy_id 已有, 由 hamuna_quant_cli create 拿)
hamuna_quant_cli upload <strategy_id> --result result.json
```

> **变更说明**: v2 skill 早期 (≤ 2026-08-17) 代码在 `strategy_cli/` 子目录, 需要
> `PYTHONPATH=$PWD/skills/hamuna-strategy-v2`. 自 Round 14 起代码搬到顶层
> `hamuna_quant_cli/` 包, `pip install` 后全局可用, 不再需要 PYTHONPATH. v2 skill
> 仅保留 SKILL.md / README.md / ARCHITECTURE.md / references/ / agents/ 作为文档
> 入口.

---

## 策略生成规范 (akquant 0.3.x — 兼容回测, 实盘接入见 desktop)

> **核心约束**: 一份 `my_strategy.py` 必须能跑 `hamuna_quant_cli run` (回测, 本 skill 主线);
> 想跑实盘 → 走 `desktop/app/src-tauri/resources/hamuna_strategy.py live run` (独立
> 文件, **不在 v2 skill 范畴**). akquant 0.3.x 的 `Strategy` 是双引擎一等公民, 策略
> 形态天然兼容; v2 runner 在 `run_backtest` 之前自动接入 `compute_factors` /
> `filter_symbols` 钩子.
>
> **scope 边界**: 本节讲"如何写策略代码"; 实盘侧的 `LiveContext` wire / 下单 / 风控
> 不在本 skill — 见 `desktop/app/src-tauri/resources/hamuna_strategy.py`.

### 必须遵守 (8 条纪律, 写错过不了 `cmd_check`)


| #   | 规范                                   | 说明                                                                                                                                                                                                                                             |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `class MyStrat(akquant.Strategy)`    | **强制** — `hamuna_quant_cli.runtime.discipline` 自检 `issubclass(cls, akquant.Strategy)` (也接受 `HamunaStrategy`, 自身继承 akquant.Strategy)                                                                                                                |
| 2   | **0.3.x 内联参数字段**                     | `IntParam / FloatParam / BoolParam / ChoiceParam / DateRangeParam / ListParam` — 旧 `__init__(self, universe: list[str])` 形参写法 0.3.x 会触发 `universe_init_style_deprecated` (runner 拿不到 universe → 静默 0 trades). `self.fast` → `self.params.fast` |
| 3   | 文件编码 `# coding: utf-8`               | akquant Python 是 utf-8 契约; QMT 旧 GBK 写法会被 `coding_not_utf8` 拦                                                                                                                                                                                  |
| 4   | `on_bar(self, bar)`                  | 主交易逻辑, 每根 bar 闭合触发                                                                                                                                                                                                                             |
| 5   | `compute_factors(self, df)` (可选)     | 向量化预计算因子, **runner 加载 prebuilt df 后调一次**。回测传 prebuilt DataFrame; 实盘侧在 `hamuna_strategy.py` 走 `bridge_server /data/history` 拼 `{sym: df}`                                                                                                       |
| 6   | `filter_symbols(self, factors)` (可选) | 基于 factors 选最终 universe, **df 进入引擎前调一次**。返的 sym 必须是 cfg.universe 子集, 否则 runner 剔除 + warn                                                                                                                                                       |
| 7   | `on_start` 内 `subscribe`             | 实盘必需; 回测可选 (engine 自动 subscribe 已限定 universe)                                                                                                                                                                                                  |
| 8   | `warmup_period` 设大                   | ≥ 策略最大窗口 (e.g. slow=60 → warmup=61), 避免 warmup 期乱下单                                                                                                                                                                                            |


### 可选 — 充分利用 akquant 0.3.x 内置 API


| API                                                                                | 何时用                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `akquant.talib.MA / EMA / RSI / MACD / STDDEV / ROC / ATR / KDJ / Bollinger / ...` | **103 个内置技术指标** — 双后端 (python / rust, 5-10x), `talib.set_default_backend("rust")` 全局切。`**compute_factors` / on_bar 里优先用 talib,别自己手算 `rolling().mean()`**                                                                                     |
| `akquant.factor.FactorEngine(data=df).run(expressions={...})`                      | **因子表达式** — `Rank(Ts_Mean(Close,5))` 风格 Alpha101,Polars 驱动并行 + 自动对齐                                                                                                                                                                          |
| `self.get_history(count, sym, field)`                                              | on_bar 拿历史 — 纳秒级环形缓冲 + 安全快照 (返回 ndarray)                                                                                                                                                                                                     |
| `self.get_history_multi(count, sym, fields)`                                       | 一次拉多字段 — 减少 FFI 切换 (`get_history_not_batched` rule 拦老写法)                                                                                                                                                                                     |
| `self.get_history_multi_symbol(count, syms, field)`                                | 跨标同字段 — 横截面比较                                                                                                                                                                                                                                |
| `self.indicator(name, **kwargs)`                                                   | 注册过的指标 O(1) 查表                                                                                                                                                                                                                               |
| `self.register_indicator(name, fn, backend="auto")`                                | 自定义指标 (rust 后端 5-10x),或 `@register_indicator(name=..., backend="rust")` 装饰器                                                                                                                                                                  |
| `self.register_precomputed_indicator(...)`                                         | O(1) on_bar 读指标 (跟 `indicator_mode="precompute"` 配对)                                                                                                                                                                                         |
| `self.get_position(sym)` / `self.get_positions()`                                  | 持仓查询                                                                                                                                                                                                                                         |
| `self.get_account()`                                                               | 账户快照 (cash / equity)                                                                                                                                                                                                                         |
| `on_cross_section(date, ts)`                                                       | **横截面同周期调仓** — engine 保证数据一致, 替代老 `add_daily_timer + on_timer`. **注意**: v2 runner 当前**不主动 wire** `on_cross_section` (仅 wire `compute_factors/filter_symbols`); 想用需在 `hamuna_strategy.py` 走实盘 hook. 回测侧推荐走 `compute_factors` 一次性算 + on_bar 触发 |
| `self.order_target_value / order_target_percent`                                   | 目标金额/百分比下单                                                                                                                                                                                                                                   |
| `self.rebalance_weights(target_dict)`                                              | 一次性多资产调仓 (sell-first then buy-second)                                                                                                                                                                                                        |
| `self.place_bracket / place_trailing_stop`                                         | 复杂订单 (止损止盈 / 移动止损)                                                                                                                                                                                                                           |


### v2 skill 引擎接入点 (回测侧, 用户不感知)

```python
# akquant_runner.run_akquant_backtest 内部 (回测启动期):
strat_inst = strat_cls()                               # 实例化 (走 params 校验)
if hasattr(strat_inst, 'compute_factors'):
    factors = strat_inst.compute_factors(df)            # 必返 dict[str, DataFrame], 否则 raise TypeError
if hasattr(strat_inst, 'filter_symbols'):
    user_filtered = strat_inst.filter_symbols(factors) # 必返 list[str], 空 list → 退 cfg.universe (warn)
# → 切 df + 喂 akquant.run_backtest(strategy=strat_cls, data=df_filtered, symbols=filtered, ...)
```

实盘侧 `compute_factors/filter_symbols` 走 `bridge_server /data/history` 拼 `{sym: df}`,
代码详见 `desktop/app/src-tauri/resources/hamuna_strategy.py::_fetch_live_factors` /
`run_live` 内 class mode 路径.

### 完整模板示例

参见 [`references/scaffolds.md`](references/scaffolds.md) §2-§5 — 5 个即抄即改模板:

- §2 buyhold (入门)
- §3 dual_ma (趋势)
- §4 momentum_rotation (横截面 + compute_factors)
- §5 low_vol_topk (实战 + compute_factors)
- §6 add_daily_timer (定时调仓)

---

## 资源索引


| 资源                                                                                     | 何时读                                                                                                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`SKILL.md`](SKILL.md) (本文件)                                                           | 主入口, 快速开始                                                                                                                              |
| [`README.md`](README.md)                                                               | v2 定位 + 与 v1 区别 + 迁移指南                                                                                                                 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                                                   | 架构图 + 复用 hamuna_quant_cli/ 清单                                                                                                          |
| [`references/cli.md`](references/cli.md)                                               | 3 子命令 (run / check / upload) 详解 + 故障排查                                                                                                 |
| [`references/backtest-result.md`](references/backtest-result.md)                       | 13-key dict + 15 metrics schema                                                                                                        |
| [`references/engine-and-data.md`](references/engine-and-data.md)                       | akquant 引擎契约 + prebuilt 数据流                                                                                                            |
| [`references/config-schema.md`](references/config-schema.md)                           | config.json 字段总表 (必需/默认/不支持)                                                                                                           |
| [`references/trading-rules.md`](references/trading-rules.md)                           | T+1 / 涨跌停 / 印花税 — designer/coder 写 spec 时对照                                                                                            |
| [`references/perf-arch.md`](references/perf-arch.md)                                   | 性能架构决策 (precompute vs per_bar_batch) — designer 产 `perf_arch.mode` 时读                                                                  |
| [`references/perf-arch-synthetic-caveat.md`](references/perf-arch-synthetic-caveat.md) | **合成数据基准 caveat** — perf-arch.md 引用的 1.01× speedup 来自合成 GBM, **不可作生产决策依据**                                                             |
| [`references/scaffolds.md`](references/scaffolds.md)                                   | 5 个模板 + 选型指南 (coder 参考, 非天花板)                                                                                                          |
| [`references/role-gates.md`](references/role-gates.md)                                 | 6 条纪律 self-check (auditor gate)                                                                                                        |
| [`~~references/qmt-export.md~~`](references/qmt-export.md)                             | **已删除** (2026-08-18) — v2 skill 不再负责 QMT 导出                                                                                            |
| [`references/qmt_coding_spec.md`](references/qmt_coding_spec.md)                       | **QMT 编写规范** (与 v1 同, 不变 — 仅供查阅, 不再 export)                                                                                            |
| [`references/pipeline.md`](references/pipeline.md)                                     | **8-role handoff artifact schema + spawn 模板** (designer/coder/evolver 等角色契约)                                                           |
| [`references/strategy-directions.md`](references/strategy-directions.md)               | **12 方向库** (DIR-001~012) + akquant Strategy spec_template + §A 方向选择器 + §E suggest_next_directions 降级                                   |
| [`agents/coder.md`](agents/coder.md)                                                   | 写策略的角色 (4 种范式 + 关键纪律)                                                                                                                  |
| [`agents/auditor.md`](agents/auditor.md)                                               | 静态审查 (6 条 rule)                                                                                                                        |
| [`agents/auditor-smoke.md`](agents/auditor-smoke.md)                                   | akquant parity smoke (升级时跑)                                                                                                            |
| [`agents/backtester.md`](agents/backtester.md)                                         | 跑回测的角色                                                                                                                                 |
| [`agents/commiter.md`](agents/commiter.md)                                             | **5 步打包上传 (QMT 翻译 + bundle + PUT result + POST code + POST export)** — ADR-0023/0025 对齐, server 是 QMT shell 渲染的 single source of truth |
| [`agents/designer.md`](agents/designer.md)                                             | **需求 → spec_strategy.json** (8 module 全填, akquant Strategy 字段清单 + 数据契约)                                                                |
| [`agents/evolver-research.md`](agents/evolver-research.md)                             | **ranked candidates** (1-3, 8-dim spec_module + evidence_paths + alternative_considered)                                               |
| [`agents/evolver.md`](agents/evolver.md)                                               | **change_ticket / exit / escalate** (判退出三条件, 同方向 fail≥2 升级)                                                                            |
| [`agents/orchestrator.md`](agents/orchestrator.md)                                     | **8-role pipeline 调度** (含 designer + evolver 迭代循环, max-rounds=5)                                                                       |


---

## 关键纪律 (写错就过不了 auditor)


| 错                                                                                 | 对                                                                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `def init(ContextInfo): ...`                                                      | `def __init__(self): ...` 或 `def on_start(self): ...`                             |
| `def handlebar(ContextInfo): ...`                                                 | `def on_bar(self, bar: Bar): ...`                                                 |
| `passorder(23, 1101, sym, ...)`                                                   | `self.buy(sym, qty)` / `self.sell(sym, qty)`                                      |
| `set_basket({sym: vol})`                                                          | `for s, v in target.items(): self.order_target_percent(v/init_capital, symbol=s)` |
| `bar.time` / `bar.date` 取日期                                                       | `datetime.fromtimestamp(bar.timestamp / 1e9).date()`                              |
| `# coding: gbk`                                                                   | `# coding: utf-8` (或删行, 默认 utf-8)                                                 |
| `class Foo:` (无继承)                                                                | `class Foo(akquant.Strategy):`                                                    |
| `__init__(self, universe: list[str], ...)` 注入参数                                   | `universe: list = ListParam(default=[])` 类字段, 读 `self.params.universe` (0.3.x 强制) |
| `self.get_history(n, sym, "close")` × `self.get_history(n, sym, "volume")` 同函数反复调 | `self.get_history_multi(n, sym, fields=("close", "volume"))` (0.3.x 一次性 FFI)      |


完整 8 条 rule + 修复路径 → [`references/role-gates.md`](references/role-gates.md).

---

## v2 vs v1 (一句话)


|        | v1 (旧)                                | v2 (新)                                            |
| ------ | ------------------------------------- | ------------------------------------------------- |
| 引擎     | 自建 driver                             | **akquant 0.3.x**                                 |
| 策略规范   | QMT `init(ContextInfo)` + `handlebar` | **akquant `class Foo(Strategy)` + `on_bar(bar)`** |
| QMT 导出 | ✅ (走 v1 + cloud)                      | ✅ (走 v1 + cloud, 不动)                              |
| 上传协议   | hamuna 13-key dict                    | hamuna 13-key dict (**同**)                        |


**互不破**: v1 与 v2 用同一份 server, 同一份 13-key schema, 同一份 strategy_id.
server 端 `model.BacktestResult` (Go struct) 不区分 v1 / v2 (无 engine 字段), audit log 按
`strategy_id` 时间序看 (`updated_at` 字段).

详细迁移 → [`README.md` §3 迁移指南](README.md#3-迁移指南-v1--v2).

---

## 关键约束 (read first)

1. **不支持 5m / tick / 多周期**: akquant 0.3.x 仍锁日线 (Phase B 范围). 想做分钟级 → 等 akquant Phase C.
2. **不支持 ETF / 期权 / 期货**: akquant 0.3.x 仅股票.
3. **strategy_id 由 v1 创建**: v2 不开创建入口. 想跑新策略, 先 `hamuna_quant_cli create --name <...> --source my_strategy.py --engine akquant-0.3.x` 拿 id.
4. **QMT 导出仍是 v1 + cloud**: v2 不引入 QMT API. 真要跑 QMT 实盘 → 走 v1 + cloud export (QMT 必须 v1 写法). 想跑 akquant 策略实盘 → `desktop/app/src-tauri/resources/hamuna_strategy.py live run` (独立, 不在本 skill 范畴).
5. **akquant Bar 字段陷阱**: `bar.time` / `bar.date` 是 REPR ALIAS, getattr 返 None — 用 `bar.timestamp`.

---

## 自检 (smoke)

```bash
# 1) check 静态审查
hamuna_quant_cli check my_strategy.py --config my_config.json
# 期望: "纪律 self-check 通过 (0 条)"

# 2) run 实跑
hamuna_quant_cli run my_strategy.py --config my_config.json --output result.json
# 期望: result.json 含 13 顶层 key (metrics / equity_curve / trades / universe / period /
#         params / monthly_metrics / monthly_bars / initial_capital / final_capital /
#         avg_holding_period / suggestions / benchmark_curve), metrics 子 dict 15 key

# 3) qmt-translate (本地 stub, audit/对照版)
hamuna_quant_cli qmt-translate my_strategy.py my_config.json \
  --spec spec_strategy.json --output _qmt_my_strategy.py
# 期望: _qmt_my_strategy.py 含 # -*- coding: gbk -*- + CONFIG = {...} + def init(C)/def handlebar(C)

# 4) upload (单步, metrics only)
hamuna_quant_cli upload <id> --result result.json
# 期望: server 响应 200

# 5) commit (5 步打包上传, 含 QMT 翻译 + bundle + cloud export)
hamuna_quant_cli commit <id> \
  --strategy my_strategy.py --result result.json \
  --config my_config.json --spec spec_strategy.json
# 期望: 5 步全 ✓, 落地 runs/<id>/bundle.tar.gz + runs/<id>/<id>.qmt.py
```

完整端到端验证 → [`references/cli.md` §5 故障排查](references/cli.md#5-故障排查-5-个最常见错).

---

| [`references/cli.md`](references/cli.md) | 3 子命令 (run / check / upload) 详解 + 故障排查 |
| [`references/backtest-result.md`](references/backtest-result.md) | 13-key dict + 15 metrics schema |
| [`references/engine-and-data.md`](references/engine-and-data.md) | akquant 0.3.x 引擎契约 + prebuilt 数据流 |
| [`references/config-schema.md`](references/config-schema.md) | config.json 字段总表 (必需/默认/不支持) |
| [`references/trading-rules.md`](references/trading-rules.md) | T+1 / 涨跌停 / 印花税 — designer/coder 写 spec 时对照 |
| [`references/perf-arch.md`](references/perf-arch.md) | 性能架构决策 (precompute vs per_bar_batch) — designer 产 `perf_arch.mode` 时读 |
| [`references/perf-arch-synthetic-caveat.md`](references/perf-arch-synthetic-caveat.md) | **合成数据基准 caveat** — perf-arch.md 引用的 1.01× speedup 来自合成 GBM, **不可作生产决策依据** |
| [`references/scaffolds.md`](references/scaffolds.md) | **5 个模板全部 akquant 0.3.x 风格 (IntParam/ListParam + compute_factors/filter_symbols)** + 选型指南 |
| [`references/role-gates.md`](references/role-gates.md) | **8 条纪律 self-check** (auditor gate; Round 1 加 2 条: `get_history_not_batched` / `universe_init_style_deprecated`) |
| [`~~references/qmt-export.md~~`](references/qmt-export.md) | **已删除** (2026-08-18) — v2 skill 不再负责 QMT 导出 |
| [`references/qmt_coding_spec.md`](references/qmt_coding_spec.md) | **QMT 编写规范** (v1 专用; v2 严禁使用, 仅供查阅 — 读者扫一眼会被误导, 跳过它) |
| [`references/pipeline.md`](references/pipeline.md) | **8-role handoff artifact schema + spawn 模板** (designer/coder/evolver 等角色契约) |
| [`references/strategy-directions.md`](references/strategy-directions.md) | **12 方向库** (DIR-001~012) + akquant 0.3.x Strategy spec_template + §A 方向选择器 + §E suggest_next_directions 降级 |
| [`agents/coder.md`](agents/coder.md) | 写策略的角色 (4 种范式 + 关键纪律) |
| [`agents/auditor.md`](agents/auditor.md) | 静态审查 (**8 条 rule**, Round 1 加 2 条) |
| [`agents/auditor-smoke.md`](agents/auditor-smoke.md) | akquant parity smoke (升级时跑) |
| [`agents/backtester.md`](agents/backtester.md) | 跑回测的角色 |
| [`agents/commiter.md`](agents/commiter.md) | **5 步打包上传 (QMT 翻译 + bundle + PUT result + POST code + POST export)** — ADR-0023/0025 对齐, server 是 QMT shell 渲染的 single source of truth |
| [`agents/designer.md`](agents/designer.md) | **需求 → spec_strategy.json** (8 module 全填, akquant 0.3.x Strategy 字段清单 + 数据契约) |
| [`agents/evolver-research.md`](agents/evolver-research.md) | **ranked candidates** (1-3, 8-dim spec_module + evidence_paths + alternative_considered) |
| [`agents/evolver.md`](agents/evolver.md) | **change_ticket / exit / escalate** (判退出三条件, 同方向 fail≥2 升级) |
| [`agents/orchestrator.md`](agents/orchestrator.md) | **8-role pipeline 调度** (含 designer + evolver 迭代循环, max-rounds=5) |

---

> **生产路径绝不接受 mock 数据或合成数据** — 任何策略评估 / 上传 / 迭代优化必须用真实
> prebuilt 数据 (`hamuna_quant_cli` A 股整包) + 真实涨跌停 clamp + 真实 T+1 撮合.
> Mock 数据仅限 `_selfcheck()` 单元测试, 显式门控 `HAMUNA_SELFTEST=1`.

### 4 条硬规则 (违反任一即视为不合规验证)


| #   | 规则                                                   | 违反案例                                                                                       | 检测点                                                                                       |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | **不许用 mock HTTP server 模拟 server 端 commit / upload** | `/tmp/v2_smoke/mock_server.py` 返 `mock_strat_001` — 看似 200 OK, 实则 server 端无 strategy_id 记录 | orchestrator commiter step 验 `strategy_id` 不是 `mock_*` 前缀; 不通过 → 阻断                       |
| 2   | **不许用合成 GBM 数据评估策略 metrics**                         | `synth_run.py` 用 sin 调制 drift + cos 调制 vol, 高胜率策略天然过拟合这种数据                                 | backtester 验数据源 hash 与 prebuilt bundle SHA 一致; 不通过 → exit 5                               |
| 3   | **不许用合成数据 benchmark 推 perf_arch 决策**                 | `perf-arch-synthetic-caveat.md` 数字仅作上限参考, 不能引用到生产路径                                        | designer 产 spec_strategy.perf_arch.mode 时不读合成数字; 走 designer 默认规则                          |
| 4   | **不许用 mock DataFrame / `_Mock*` 验 result.json 上传**   | `akquant_schema_adapter._MockResult` 仅限 schema adapter 单元测试                                | orchestrator commiter 验 result.json 含 `data_integrity.source='prebuilt_bundle'`; 不通过 → 阻断 |


### 数据完整性 attestation (v2.1 提案)

`result.json` 顶层新增 `data_integrity` 字段 (server 端可选择性验):

```json
{
  "metrics": {...},
  "data_integrity": {
    "source": "prebuilt_bundle",
    "bundle_path": "hamuna_strategies/__bundle__all_a_D.parquet",
    "symbols_count": 4,
    "rows_count": 1840,
    "sha256_of_df": "a3f5...",
    "clamp_enabled": true,
    "generated_at": "2026-08-15T01:23:45Z"
  },
  ...
}
```

→ 当前**未实现**, 仅作提案. server 端配合改 schema 后启用.

### 单元测试 mock (允许场景)

`_selfcheck()` 内的 mock DataFrame / `_MockMetrics` / `_MockResult` 是**允许**的, 但显式门控:

```bash
# 显式启用 (单元测试时)
HAMUNA_SELFTEST=1 python -c "from hamuna_quant_cli.references._metrics_15 import _selfcheck; _selfcheck()"

# 默认行为 (防止误调)
python -c "from hamuna_quant_cli.references._metrics_15 import _selfcheck; _selfcheck()"
# → RuntimeError: _selfcheck() 用 mock nav+trades 验 metrics 公式, 不用于 prod 数据校验.
#    设置 HAMUNA_SELFTEST=1 显式启用.
```

涉及模块: `akquant_data_adapter` / `akquant_schema_adapter` / `cross_sectional_helpers` / `_metrics_15`.

---

## 部署配置层 — `scripts/server.json`

CLI 连接的 server 地址走**部署配置层** `scripts/server.json`（HTTP client 解析顺序:
`HAMUNA_SERVER` env &gt; `scripts/server.json.api_base` &gt; 默认 `http://localhost:8080`）。

- **部署方**管理该文件（不在用户 `~/.hamuna` 下）; 部署时只改这一个文件即可切 server。
- **凭证与部署分离**: `~/.hamuna/credentials.json` 只放 `api_key`, 不含 api_base（见 `runtime/http_client.py`）。
- 默认值无需改; 改错格式（非法 JSON / 缺 `api_base`）会静默回落默认 server, 不报错。

---

## 关联文档

- v1 skill (旧): [`../hamuna-strategy/SKILL.md`](../hamuna-strategy/SKILL.md) — QMT-style + 自建 driver, **不变**
- akquant 框架: [`~/.claude/skills/akquant/SKILL.md`] — akquant API 完整手册
- 项目根: [`../../CLAUDE.md`](../../CLAUDE.md) — A 股量化平台整体定位

