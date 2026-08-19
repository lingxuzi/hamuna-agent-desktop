# perf-arch — 合成数据基准 caveat

> **⚠️ 本文档所有数字来自合成数据 (`/tmp/v2_smoke/bench_perf.py`), 不是生产 prebuilt 数据基准**.
> 合成数据用 `GBM + sin 调制 drift + cos 调制 vol` 生成, 不能代表真实 A 股数据分布.
> **生产路径决策请勿引用本文 speedup 数** — 等 v3 harness 在真实 prebuilt 上重测.

## 1. 合成数据生成器 (`bench_perf.py`)

```python
def gen_universe(n: int, days: int = 375, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    base = np.cumprod(1 + rng.normal(0.0005, 0.015, days), axis=0) * 10.0
    rows = []
    for i in range(n):
        sym = f"{600000 + i:06d}.SH"
        noise = rng.normal(0, 0.005, days)
        close = base * (1 + noise)
        high = close * (1 + np.abs(rng.normal(0, 0.003, days)))
        low = close * (1 - np.abs(rng.normal(0, 0.003, days)))
        vol = rng.integers(1_000_000, 50_000_000, days)
        ...
```

**已知偏差**:

| 偏差 | 真实数据 | 合成数据 | 影响 |
|---|---|---|---|
| 涨跌停 clamp | 10% / 20% 真实命中 | 随机 GBM 不 clamp | backtest 看到"不可能价格", 策略评估失真 |
| 成交量自相关 | 真实数据有日内/周内 pattern | `rng.integers` 无自相关 | volume-based 信号 (量价齐升等) 评估失真 |
| 极端事件分布 | 真实数据有 fat tail | 正态分布无 fat tail | 风险指标 (max_drawdown) 显著低估 |
| T+1 / 撮合约束 | 真实约束 | 无 | 信号换手率可能高估 |
| 行业 / 风格因子 | 真实存在 | 全标同分布 (`base` 同源) | cross-section 排名测试失真 |

## 2. 合成基准数字 (仅作上限参考)

60 → 100 → 300 标的 × 1.5y × 5 指标 (MA20/MA60/RSI14/zscore/rvol) benchmark:

| universe | per_bar_batch | precompute_panel | speedup |
|---|---|---|---|
| 30 | 1.87s | 1.84s | 1.01× |
| 100 | 6.10s | 6.04s | 1.01× |
| 300 | 18.11s | 18.18s | 1.00× |

**结论**: akquant 0.3.x (Rust 内核) 下, `get_history` 已经走 Rust history buffer 是 **O(1)** + numpy view 返,
不再 IO, Python on_timer 体量极小. 上面的"5–50×"是按**纯 Python + pandas** 估算 — akquant 下加速比 ≈ 1×.

## 3. 真实数据基准何时来 (v3 plan)

需满足:

1. **真实 prebuilt bundle**: `hamuna_quant_cli` A 股整包 (`__bundle__all_a_D.parquet`, 220 MB filter pushdown 后)
2. **真涨跌停 clamp**: `akquant_data_adapter.clamp_to_price_limit` 默认开 (Phase B 已就绪)
3. **真 universe 分布**: 沪深 300 / 中证 500 / 全 A 三档 (与 [5004 标 × 1.5y benchmark](#) 同口径)
4. **真撮合**: `execution_mode='NextOpen'` + `t_plus_one=True` + slippage dict
5. **多次重复**: 同一策略 ≥3 次不同 seed (mock 数据无 seed 影响)

→ 预计 v3 harness 在 `bench/` 目录加 `perf_real.py`, 跑完落 `bench_out/perf_real_<ts>.json`,
给出与本文对照表. **未完成前, 不引用本文 speedup 数做生产决策**.

## 4. 真实数据下仍有收益的场景 (≥1.2× 可证)

虽然合成数据上 ≈1×, 真实数据下因**Python-side DataFrame copy 密集**仍可能获得收益:

1. **get_history_df** (DataFrame, Python-side copy): on_start 一次性拉 + cache, vs 每 rebalance 拉, **3–5×**
2. **大量指标 (≥10 公式) + 跨标的向量化**: cumsum 一次算全周期 vs rolling 重复, **2–3×**
3. **多周期 / 多字段交叉 (1d close + 30m volume)**: 一次性 panel cache, vs per-bar 拉两套, **2×**

→ add when: 用户报 "get_history_df 卡" 或 "on_bar > 50ms 慢", 先看是不是 DataFrame copy 密集, 再决定 panel cache.

## 5. 引用 / 关联

- 主文档: [`perf-arch.md`](perf-arch.md) — 留一行引导, 不在此重复结论
- bench 脚本 (dev only): `/tmp/v2_smoke/bench_perf.py` — **NOT for production validation**
- akquant API: `~/.claude/skills/akquant/references/api-reference.md` `get_history` / `get_history_df`
- 数据契约: `hamuna_quant_cli/references/cross_sectional_helpers.py:22` `compute_vol_calendar`