# ARCHITECTURE — hamuna-strategy-v2

> 一句话 (Round 14 重构后): **v2 skill = 纯文档入口 (SKILL.md / agents/ / references/);
> 全部代码在顶层独立 pip 包 `hamuna_quant_cli/` (`pip install hamuna-quant-cli`
> 后全局可用, console_script 名 `hamuna_quant_cli`).** 不重写 akquant, 不重写
> metrics, 不重写 schema adapter.

## 1. 分层

```
┌──────────────────────────────────────────────────────────────────┐
│  v2 skill (skills/hamuna-strategy-v2/) — 纯文档入口                │
│  SKILL.md / README.md / ARCHITECTURE.md                           │
│  references/{scaffolds,perf-arch,role-gates,strategy-directions,  │
│              pipeline,trading-rules,engine-and-data,qmt_coding_spec,│
│              backtest-result,config-schema,cli}.md                 │
│  agents/{coder,designer,auditor,auditor-smoke,backtester,...}.md  │
│  → Claude Code 用: claude 读这些文档 + 调 `hamuna_quant_cli <args>` │
└──────────────────────────────────────────────────────────────────┘
                              │ `pip install hamuna-quant-cli`
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  hamuna_quant_cli/  (顶层独立 pip 包, console_script: hamuna_quant_cli)│
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ __main__.py  argparse + 9 子命令                                ││
│  │   回测: run / check / upload / create / parity /                ││
│  │         qmt-translate / commit / dataset {list|fetch|manifest} ││
│  │   实盘: live run                                                ││
│  └──────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ akquant_runner.run_akquant_backtest  (回测引擎入口)              ││
│  │ akquant_data_adapter.load_prebuilt_to_akquant_with_limits       ││
│  │ akquant_schema_adapter.to_hamuna_result (13-key schema fold)    ││
│  │ prebuilt_resolver / prebuilt_downloader                         ││
│  │ cross_sectional_helpers.compute_vol_calendar                     ││
│  │ _metrics_15.compute_all                                          ││
│  │ qmt_translator / _test_akquant_parity                           ││
│  │ base_strategy (HamunaStrategy 可选基类)                          ││
│  │ live/{loader,runner}  (实盘 CLI)                                  ││
│  │ runtime/{discipline,backtest,server_client,http_client,cache}  ││
│  │ scripts/server.json (部署配置层)                                  ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
                              │ 委托
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              akquant 0.3.x  (外部 Rust + Python)                │
│  Strategy 基类 / Bar / on_bar / buy / sell / run_backtest / run_live │
└──────────────────────────────────────────────────────────────────┘
                              │ 上传 / 实盘回报
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│    server (Go + Gin, 不动)                                         │
│    PUT /api/v1/strategies/{strategy_id}/result                     │
│    校验 metrics 子 dict 15 key 全在 (server 不验 engine 字段)     │
│    desktop (Tauri, 不动)                                          │
│    spawn `hamuna_quant_cli live run <strategy.py>` 调实盘         │
└──────────────────────────────────────────────────────────────────┘
```

## 2. hamuna_quant_cli 代码量 (Round 14 重构后, 顶层独立 pip 包)

| 文件 | 行数 | 角色 |
|---|---|---|
| `hamuna_quant_cli/__init__.py` | 6 | version |
| `hamuna_quant_cli/__main__.py` | ~390 | argparse + 9 subcommand (合并回测 + 实盘) |
| `hamuna_quant_cli/akquant_runner.py` | ~580 | run_akquant_backtest (含 0.3.x compute_factors/filter_symbols wire) |
| `hamuna_quant_cli/akquant_data_adapter.py` | ~250 | prebuilt DataFrame + 涨跌停 clamp |
| `hamuna_quant_cli/akquant_schema_adapter.py` | ~190 | 13-key dict |
| `hamuna_quant_cli/prebuilt_resolver.py` | ~250 | 自适应 bundle / single |
| `hamuna_quant_cli/prebuilt_downloader.py` | ~150 | 云端预构建下载 |
| `hamuna_quant_cli/cross_sectional_helpers.py` | ~80 | vol_calendar |
| `hamuna_quant_cli/qmt_translator.py` | ~150 | akquant → QMT body 翻译 (本地 stub) |
| `hamuna_quant_cli/base_strategy.py` | ~80 | HamunaStrategy 可选基类 (no-op compute_factors/filter_symbols) |
| `hamuna_quant_cli/_metrics_15.py` | ~280 | 15-metric 单点 |
| `hamuna_quant_cli/_test_akquant_parity.py` | ~415 | 5 strategy parity test |
| `hamuna_quant_cli/live/{loader,runner}.py` | ~310 | 实盘 CLI (akquant.run_live 薄壳) |
| `hamuna_quant_cli/runtime/discipline.py` | 264 | **8 rule AST 静态审查** (Round 1 加 2 条) |
| `hamuna_quant_cli/runtime/backtest.py` | ~55 | thin wrapper |
| `hamuna_quant_cli/runtime/server_client.py` | ~95 | wholesale copy v1 |
| `hamuna_quant_cli/runtime/http_client.py` | ~230 | wholesale copy v1 |
| `hamuna_quant_cli/runtime/cache.py` | ~280 | wholesale copy v1 |
| **小计** | **~3855** (含 v1 复刻 ~623, 自有 ~3232) |

**部署配置层**: `hamuna_quant_cli/scripts/server.json` — CLI 连接 server 地址
(HTTP client 解析: `HAMUNA_SERVER` env > `scripts/server.json.api_base` >
默认 `localhost:8080`)。部署方管理, 部署时只改这一个文件切 server; 凭证与部署
分离 (`~/.hamuna/credentials.json` 只放 `api_key`, 不含 api_base)。详见 SKILL.md §部署配置层。

## 3. 复用清单 — v2 skill 不重复实现

| 用途 | 引用源 (现位于 hamuna_quant_cli/) | 行数 | 备注 |
|---|---|---|---|
| **回测 runner** | `hamuna_quant_cli.akquant_runner.run_akquant_backtest` | ~580 | 含 0.3.x compute_factors/filter_symbols wire |
| **数据 adapter** | `hamuna_quant_cli.akquant_data_adapter.load_prebuilt_to_akquant_with_limits` | ~250 | 涨跌停 clamp + filter pushdown |
| **metrics** | `hamuna_quant_cli._metrics_15.compute_all` | ~280 | 15-metric 单点 |
| **schema adapter** | `hamuna_quant_cli.akquant_schema_adapter.to_hamuna_result` | ~190 | 13-key dict |
| **prebuilt resolver** | `hamuna_quant_cli.prebuilt_resolver.resolve` | ~250 | 自适应 bundle / single |
| **downloader** | `hamuna_quant_cli.prebuilt_downloader` | ~150 | 云端预构建下载 |
| **cross_sectional helper** | `hamuna_quant_cli.cross_sectional_helpers.compute_vol_calendar` | ~80 | 周频 ranking |
| **实盘 CLI** | `hamuna_quant_cli.live.{loader,runner}` | ~310 | akquant.run_live 薄壳 |
| **纪律审查** | `hamuna_quant_cli.runtime.discipline` | 264 | 8 rule (Round 1 加 2 条) |
| **server client** | `hamuna_quant_cli.runtime.server_client` | ~95 | v1 已稳定的 API 客户端 |
| **HTTP 底座** | `hamuna_quant_cli.runtime.http_client` | ~230 | v1 已稳定 |
| **本地缓存** | `hamuna_quant_cli.runtime.cache` | ~280 | v1 已稳定 |
| **QMT coding spec** | `skills/hamuna-strategy/references/qmt_coding_spec.md` (copy) | ~1100 | QMT 规范不变 |

**v2 skill 引用源总数**: 13 个 (全部已存在). **v2 skill 文档定位: 纯文档入口, 不含 Python 代码**.

## 4. 数据流 — 完整路径

### 4.1 单标的 buyhold 6mo 2 标

```
[1] user writes strategy.py (含 class Foo(akquant.Strategy))
    ↓
[2] cmd_run: discipline.check_discipline(source, cfg)
    ↓ AST: 0 违规
[3] backtest.run(strategy_path, cfg)
    ↓ 注入 _strategy_name
[4] akquant_runner.run_akquant_backtest(strategy_path, cfg)
    ↓
[5] akquant_data_adapter.load_prebuilt_to_akquant_with_limits(
        universe=['600000.SH', '600036.SH'],
        start='20240701', end='20241231')
    ↓ pyarrow filter pushdown (220 MB)
    ↓ 涨跌停 clamp (一字板不成交)
    → DataFrame
    ↓
[6] akquant.run_backtest(
        strategy=Cls,
        data=df,
        symbols=['600000.SH', '600036.SH'],
        initial_cash=cfg['init_capital'],
        t_plus_one=True,
        execution_mode='NextOpen',
        show_progress=False)
    ↓
    → akquant.Result (equity, trades, positions)
    ↓
[7] akquant_schema_adapter.to_hamuna_result(result, cfg)
    ↓
    → 13-key dict {metrics (15), equity_curve, trades, universe, period,
                   params, monthly_metrics, monthly_bars, initial_capital,
                   final_capital, avg_holding_period, suggestions,
                   benchmark_curve}
    ↓
[8] cmd_run 落盘 result.json (json.dumps indent=2 ensure_ascii=False)
    ↓
[9] cmd_upload: server_client.upload_backtest_result(strategy_id, result)
    ↓
[10] PUT /api/v1/strategies/{strategy_id}/result
    ↓ server 验 metrics 15 key + period / initial_capital 范围
    ↓ mongo $set on `strategies.{_id}.backtest_results`
    → 200 OK
```

### 4.2 横截面策略 (5004 标 × 1.5y)

```
[1-3] 同 §4.1
[4] akquant_runner.run_akquant_backtest(strategy_path, cfg)
    ↓ 检测 cfg.cross_sectional
[5] akquant_data_adapter.load_prebuilt_to_akquant_with_limits(universe, start, end)
    → DataFrame (5004 标 × 1.5y ≈ 1.85M 行)
    ↓
[6] cross_sectional_helpers.compute_vol_calendar(
        df, lookback=20, rebalance_weekday=4)
    → vol_calendar: dict[str, dict[str, float]]
    ↓
[7] akquant.run_backtest(
        strategy=Cls,
        data=df,
        initial_cash=cfg['init_capital'],
        t_plus_one=True,
        strategy_kwargs={'vol_calendar': vol_calendar})   # NEW
    ↓
    → akquant.Result (1404 trades, 707 syms)
    ↓
[8] to_hamuna_result(result, cfg)
    → 13-key dict (peak RSS 2.6 GB, 跑通 471 s)
[9-10] 同 §4.1
```

## 5. 6-rule 纪律 — 触发链

```
[1] user writes strategy.py
    ↓
[2] cmd_run: discipline.check_discipline(source, cfg)
    │
    ├── rule 1: coding_not_utf8
    │     scan lines 1-3 for `# coding: <enc>`
    │     enc not in ('utf-8', 'utf8') → ERROR
    │
    ├── rule 2: missing_akquant_strategy_subclass
    │     ast.walk() all ClassDef, check bases
    │     no class Foo(Strategy) found → ERROR
    │
    ├── rule 3: qmt_global_leaked
    │     scan all Name/Attribute/Import for 14 QMT 标识符
    │     each hit → ERROR (deduped by line+name)
    │
    ├── rule 4: handlebar_not_akquant
    │     ast.walk() FunctionDef, name == 'handlebar'
    │     hit → ERROR
    │
    ├── rule 5: init_contextinfo_form
    │     ast.walk() FunctionDef, name == 'init', args[0] == 'ContextInfo'
    │     hit → ERROR
    │
    └── rule 6: bar_field_alias_trap
          for each def on_bar(self, bar), ast.walk() Attribute
          bar.<time|date> → ERROR (REPR ALIAS 陷阱)
    ↓
    list 非空 → 打印 + exit 3
    list 空 → continue to step [3] backtest.run
```

## 6. 与 v1 架构对比

```
            v1 (旧)                              v2 (新)
┌──────────────────────────┐      ┌──────────────────────────┐
│ strategy_cli (v1)        │      │ strategy_cli (v2)        │
│  ├── runtime/driver.py   │ ← 自建, ~880 行               │  ├── runtime/backtest.py │ ← thin wrapper, ~50 行
│  ├── runtime/market.py   │ ← 自建, ~600 行               │  ├── runtime/discipline.py│ ← NEW, ~264 行 (8 rule)
│  ├── runtime/metrics.py  │ ← 自建, ~400 行               │  ├── runtime/server_client.py │ ← copy v1
│  ├── runtime/context.py  │ ← 自建, ~200 行               │  ├── runtime/http_client.py   │ ← copy v1
│  ├── runtime/discipline.py│ ← 自建, ~350 行 (QMT 形态)   │  └── runtime/cache.py         │ ← copy v1
│  ├── runtime/server_client.py│ ← 自建, ~95 行            │           │
│  ├── runtime/http_client.py │ ← 自建, ~230 行            │           │ 委托
│  └── runtime/cache.py       │ ← 自建, ~280 行            │           ▼
│                                                            │  ┌──────────────────────────┐
│           │                                                │  │ hamuna_quant_cli//         │
│           │ 委托 (但其实大部分是自建)                        │  │  Phase B 已成熟           │
│           ▼                                                │  │  akquant_runner           │
│  ┌──────────────────────────┐                              │  │  akquant_data_adapter     │
│  │ server (Go + Gin)        │                              │  │  akquant_schema_adapter   │
│  │ QMT cloud gateway        │                              │  │  cross_sectional_helpers  │
│  │ QMT export shell         │                              │  │  _metrics_15              │
│  └──────────────────────────┘                              │  │  prebuilt_resolver        │
│                                                            │  │  prebuilt_downloader      │
│                                                            │  └──────────────────────────┘
└──────────────────────────┘                                  └──────────────────────────┘
```

**核心差异**:

| | v1 | v2 |
|---|---|---|
| 回测引擎 | 自建 driver (~880 行) | **akquant 0.3.x** (Rust) |
| 数据 IO | 自写 parquet | akquant_data_adapter (filter pushdown + clamp) |
| Metrics | 自写 (~400 行) | hamuna_quant_cli/._metrics_15 (~280 行, 与 v1 等价) |
| Schema 折 | driver 内联 | akquant_schema_adapter.to_hamuna_result |
| Discipline | QMT 形态 (7 rule) | **akquant 形态** (8 rule, NEW — Round 1 加 2 条) |
| v2 自有代码 | — | **~1085 行** (含 ~462 NEW) |
| v2 委托行数 | — | **~1750 行** (hamuna_quant_cli/ 12 模块) |

**实质**: v2 = 462 行 NEW + 623 行 copy v1 底座 + 0 行重写 akquant / metrics / schema.
**重写 0 行** 是关键 — v2 的价值在"切换引擎", 不在"重写业务逻辑".

## 7. 性能 & 资源 — 5004 标 × 1.5y benchmark

| 维度 | v1 driver | v2 akquant |
|---|---|---|
| 跑通时间 | ~3 h | **471.66 s** (≈ 8 min) |
| trades | ~1400 | **1404** (707 syms, 14.1%) |
| peak RSS | ~800 MB | **2.6 GB** |
| 数据 IO (filter pushdown 后) | — | **220 MB** (vs 8.4 GB 不 pushdown) |
| 撮合精度 | 简化 (无涨跌停 clamp) | 实盘约束 (一字板 clamp) |

**结论**: v2 在性能 + 撮合精度上胜出, peak RSS 高 3.3× 但吞吐高 22×.

## 8. ADR 对齐

| ADR | v2 兼容性 |
|---|---|
| ADR-0001 §1 "不自建回测引擎" | ✅ akquant 外部引擎 |
| ADR-002 "不引入私有 IR" | ✅ 用户写 akquant Python, 不翻译 |
| ADR-009 "Mongo+Redis only" | ✅ 数据走 prebuilt bundle, 不入 Mongo |
| ADR-011 "factor_templates admin-only" | ✅ 不冲突 |
| ADR-018 "Python client single" | ✅ v2 skill 仍 Python client |
| ADR-019 "Phase 1 server + frontend skeleton" | ✅ v2 skill 是 dev tool, 不动 backend |
| ADR-029 "strategy skeleton" §6 "driver 算 8 条核心 metrics" | ⚠️ 旧 ADR 描述 v1 driver, 加注 "v1 OR v2 二选一" |
| ADR-040 "AKQuant as v2 default backtest engine" | ✅ v2 skill 是 ADR-040 的实现 |

## 9. 不在 v2 范畴 (明确)

- ❌ 自建回测引擎 (ADR-0001 禁止)
- ❌ 私有 IR / DSL (ADR-002 禁止)
- ❌ 5m / tick / 多周期 (akquant Phase B 锁日线)
- ❌ ETF / 期权 / 期货 (akquant 0.3.x 仅股票)
- ❌ strategy_id 创建 (走 v1 cmd_create_strategy)
- ❌ QMT 导出实现 (走 v1 + cloud 端)
- ❌ realtime dashboard / live trading (v2 是离线回测)
- ❌ 替换 v1 (v1 + v2 并行, 用户选)
- ❌ 翻译 QMT strategy → akquant strategy (用户写新的)