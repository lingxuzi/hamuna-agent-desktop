# perf-arch — 回测性能优化规范 (akquant 0.3.x)

> v2 skill 的回测性能设计参考. **核心矛盾**: akquant 引擎已经很快, 但 Python
> 回调侧 (`on_bar` / `compute_factors` / `compute_factors` 后批量 subscribe) 是热
> 路径. 90% 的"慢"来自策略侧 micro-pattern, 不是引擎. 本文给 designer / coder /
> auditor 三 agent 一份**回测期**性能 checklist + 实测数字引用.
>
> **不在本规范**: 实盘性能 (`run_live` 路径在 `desktop/app/.../hamuna_strategy.py`,
> 不在本 skill 范畴). 回测/实盘差异 (`Tick.volume` 单笔 vs 累计、T+1 持仓冻结、
> 撤单异步) 见 `~/.claude/projects/.../AKQUANT_GUIDE.md §9.2` (用户查阅,
> 不在本 skill 自动 wire).

---

## 1. AKQuant 性能定位 (README 自承)

> "实际性能表现取决于策略实现、数据规模与运行环境。"

典型基准 (来自 AKQuant Guide §8.1):

| 路径 | 量级 |
|---|---|
| 数据准备 / Indicator 注册 (precompute) | **10x–50x** vs 纯 Python pandas |
| `get_history` / `get_history_multi` | **纳秒级**, 环形缓冲 + 安全快照 |
| 撮合 + 风控 + 结算 | **1k–100k bar/s** (per-bar bench, 单标的) |
| 多标的横截面 | **10k–100k symbol-bar/s** |

**真实环境复杂**: I/O 限速、GIL 锁、Python 回调自身 — 这些不归 akquant 管, 归策略侧.

---

## 2. 8 大性能硬技巧 (按 ROI 排序, AKQuant Guide §8.2)

| # | 技巧 | 收益 | 实测代码位置 |
|---|---|---|---|
| 1 | **polars / pyarrow 输入** | 省 30% 内存 (vs pandas) | v2 runner 当前用 pandas; polars 路径 0.3.x `add_arrays` 零拷贝, 留给 Phase C |
| 2 | **`get_history_multi` 替代 `get_history` × N** | 减少 GIL 切换 (50~80% FFI 跨越) | `discipline._rule_get_history_batched` 自动拦 |
| 3 | **`talib(..., backend="rust")`** | 指标 5–10x 加速 (双后端, rust 是主推) | `references/scaffolds.md §4-§5` 已用 |
| 4 | **避免 `on_bar` 中 `new dict`** | 缓存 `(sym) -> container`, 不要每 bar 重新分配 | — (策略侧纪律, auditor 不强制) |
| 5 | **`warmup_period` 显式声明** | 避免 AST 自动推断开销 | strategy.py 必须 `warmup_period = N` 类属性 |
| 6 | **`StrategyConfig.indicator_mode="incremental"`** | 增量计算 (适合长 warmup) | v2 runner 当前走默认 "precompute"; incremental 留给 Phase C |
| 7 | **`run_grid_search` 多进程** | n_workers × 单进程加速 (MPI 风格) | 已暴露, 见 `references/cli.md` |
| 8 | **`run_walk_forward` 滚动训练** | 内置 WFO, 不自己写 train/test 切片 | 已暴露, 见 `references/cli.md` |

> **纪律**: 1+2+3 是必做 (auditor gate); 4+5+6 是建议 (designer 加 rationale);
> 7+8 是高阶 (evolver / 单独跑).

---

## 3. talib 后端纪律 (AKQuant Guide §7.5)

```python
# 默认 python 后端 (兼容 numpy/pandas)
ma = talib.MA(close, period=20)

# 切 rust 后端 (性能更高, 5–10x)
ma = talib.MA(close, period=20, backend="rust")
talib.set_default_backend("rust")          # 全局切
```

**关键纪律 (来自 TALib Indicator Reference)**:

> "**两个后端结果不一致时: 优先信任 `backend="rust"`** (与撮合引擎共享同一数值路径),
> 并以它为基准做 golden 测试. Python 后端保留为兼容性兜底."

→ **策略代码**: `compute_factors` / `on_bar` 里**优先 `talib(..., backend="rust")`**,
避免手算 `df['close'].rolling(N).mean()`. rust 后端跟撮合引擎共享同一数值路径,
数值一致; python 后端是兜底, 边界不一致风险.

---

## 4. perf_arch.mode 二选一 (designer 产出)

### 何时收益大 (AKQuant 实测)

| 场景 | universe | window | period | 加速比 |
|---|---|---|---|---|
| 单标的 + MA20 | 1 | 20 | 1d | 1–2× (不显著) |
| TopK 10 + MA20 周频 | 10 | 20 | 1d | 5–10× |
| 沪深 300 + vol20 | 300 | 20 | 1d | 10–20× |
| 全 A + Alpha101 (101 公式) | 5000 | 60 | 1d | 50×+ |
| 因子组合 3 × 100 标的 | 100 | 60 | 1d | 20×+ |

**经验阈值**: universe ≥ 20 或指标公式 ≥ 5 → 上 precompute; 否则 per_bar_batch (代码简单).

### 决策树 (写进 `perf_arch.rationale`)

```
universe_size ≥ 20 ?
├─ yes → precompute (compute_factors 一次性算全)
└─ no → window ≥ 50 ?
    ├─ yes → precompute (长窗重复 IO 浪费)
    └─ no → per_bar_batch (短窗小池, 代码简单)
```

### spec_strategy.json 字段

```json
{
  "perf_arch": {
    "mode": "precompute | per_bar_batch",
    "rationale": "top-5 沪深 300 + vol20 日线 → precompute",
    "data_coverage_gate": "backtest_end ≤ dataset.data_coverage.end"
  },
  "data_dependencies": {
    "history_window": { "field": "close", "length": 20 },
    "compute_factors": { "indicators": ["vol_20"], "backend": "rust" }
  }
}
```

`perf_arch.rationale` 字段记录为什么选这个 (auditor / evolver 对照).

---

## 5. v2 skill 实测 performance benchmark (5004 syms × 1.5y)

| Case | 标的 | 窗口 | trades | 跑通时间 | peak RSS |
|---|---|---|---|---|---|
| buyhold 2 标 | 600000.SH, 600036.SH | 6mo | 2 | **18 s** | 480 MB |
| MeanRev 5 标 | 5 标的 | 2y | 42 | **92 s** | 1.4 GB |
| LowVolTopK 50 | 沪深 300 | 2y | 1404 | **471 s** | 2.6 GB |

**结论**: v2 在大 universe benchmark 上跑通时间 < 8 min, peak RSS < 3 GB.

完整 benchmark log: `docs/调研-AKQuant-回测框架.md` §5.

---

## 6. 多进程 / WFO (高阶)

### 网格搜索 (`run_grid_search`)

```python
result_df = akquant.run_grid_search(
    strategy=MyStrategy,
    param_grid={"fast_window": [5, 10, 20, 30], "slow_window": [20, 30, 60, 120]},
    data=df,
    max_workers=8,
    sort_by=["sharpe_ratio", "max_drawdown"],
    ascending=[False, True],
    constraint=lambda r: r["fast_window"] < r["slow_window"],
    result_filter=lambda r: r["sharpe_ratio"] > 0.5 and r["max_drawdown"] > -0.2,
    db_path="results.db",           # SQLite 持久化中间结果
    timeout=600,
)
```

### Walk-forward (`run_walk_forward`)

```python
wf_df = akquant.run_walk_forward(
    strategy=MyStrategy,
    param_grid={"fast_window": [5, 10, 20], "slow_window": [30, 60, 120]},
    data=df,
    train_period=252,        # 训练期 (bar 数)
    test_period=63,          # 测试期 (bar 数)
    metric=["sharpe_ratio", "total_return"],
    ascending=[False, False],
    compounding=False,
)
```

→ v2 skill 不在 skill 入口暴露, 由 evolver 在 grid/WFO 阶段调用.

---

## 7. 实测 caveat (合成数据基准 ≠ 生产)

> ⚠️ **本节引用的是合成数据基准, 不是生产数据基准**. 完整说明 + 数字来源 →
> [`perf-arch-synthetic-caveat.md`](perf-arch-synthetic-caveat.md).
> **生产路径决策请勿引用此处的 speedup 数**.

**结论摘要** (akquant 0.3.x, Rust 内核): `get_history` 走 Rust history buffer 是
**O(1)** + numpy view, on_timer 体量极小. **真实 prebuilt 数据下 speedup 待 v3 harness
重测** — 当前合成数据上 1.00–1.01×, 不能外推到生产路径决策.

**仍有收益的场景** (≥1.2× 实测可证, 来源同上 caveat 文档):
1. **get_history_df** (DataFrame, Python-side copy): on_start 一次性拉 + cache, vs 每 rebalance 拉
2. **大量指标 (≥10 公式) + 跨标的向量化**: cumsum 一次算全周期 vs rolling 重复
3. **多周期 / 多字段交叉**: 一次性 panel cache, vs per-bar 拉两套

→ add when: 用户报"get_history_df 卡"或"on_bar > 50ms 慢", 先看是不是 DataFrame copy
密集, 再决定 panel cache.

---

## 8. auditor 红线 (8 条 discipline rule + 性能 hint)

`strategy_cli.runtime.discipline.check_discipline` 8 条 rule 中,
**第 7 条 `get_history_not_batched`** 是性能强约束:

> on_bar / on_timer / on_cross_section 内, 同 `(count, sym)` 多次
> `get_history` 不同字段 → 报 `rule="get_history_not_batched"`, 建议合并
> `get_history_multi` — 0.3.x 一次 FFI 拉多字段, 跨 sym N 调用时省 50~80% FFI 跨越.

→ 见 `references/role-gates.md §1` rule 7 + §2.7 修复路径.

**未来加 rule (不抢答)**:
- `talib_backend_unused` (策略用 talib 但没 `backend="rust"`, 给 warn, 不 abort)
- `on_bar_dict_construction` (启发式检测 `on_bar` 内 `dict(...)` 重复构造)

加 rule 必须有对应实测 benchmark 踩坑.

---

## 9. v2 skill 不做的事

- ❌ `StrategyConfig.indicator_mode="incremental"` — 留给 Phase C (runner 当前走默认 "precompute")
- ❌ polars 输入 path — runner 当前只走 pandas (guide §7.1 表 1 等)
- ❌ `talib` 自动派发 (designer 给 `["ma20", "vol20"]`, runner 自己挑实现) — schema 已写但 evolver 降级
- ❌ `numba/cython` JIT 加速 — 先量 (cProfile 定位真实热点), 再 JIT
- ❌ checkpoint (`save_checkpoint` / `run_from_checkpoint`) — WFO 流程留给 evolver

---

## 10. 引用

- akquant API 速查: `~/.claude/projects/.../AKQUANT_GUIDE.md §10` (顶层 API + Strategy 方法签名)
- akquant 性能基准: `AKQUANT_GUIDE.md §8` (性能定位 + 8 大硬技巧 + Grid/WFO)
- talib 后端纪律: `AKQUANT_GUIDE.md §7.5`
- 回测/实盘差异: `AKQUANT_GUIDE.md §9.2`
- v2 runner 钩子: `strategy_cli/references/akquant_runner.py:123-181` (`compute_factors` / `filter_symbols` wire)
- v2 discipline rule: `strategy_cli/runtime/discipline.py` (8 条 rule + Round 1 加 2 条)