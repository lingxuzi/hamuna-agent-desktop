# Pipeline — 八角色流水线契约 (akquant 对齐)

> **v2 = 8-role pipeline** (orchestrator 主 agent + designer + dataset-loader + coder + auditor + backtester + evolver-research + evolver + commiter). 替代 v1 8-role 但**全部对齐 akquant Strategy 字段**.
> 角色定义见 `agents/<role>.md`. 本文是 **handoff artifact schema + spawn 模板**.

## 1. 角色总表

| 角色 | 输入 | 产出 artifact | 完成标准 | 失败分支 | 红线 |
|---|---|---|---|---|---|
| **orchestrator** | 用户需求 + 4 问 | 任务卡 + 调度 + manifest | 调度 8 角色 + 失败重试 + 用户确认转达 | 角色连续失败 → 报用户 | 不写代码/不调 akquant |
| **designer** | 4 问 + availability + 引擎 API | `spec_strategy.json` (akquant Strategy 字段清单) | 8 module 全填 (strategy_class/lifecycle_hooks/state_attrs/data_dependencies/order_methods/risk_config/perf_arch/objective) | 引擎不支持域 / 数据覆盖不足 → `blocked:designer` | 不写代码/不引入 DIR-013+ |
| **dataset-loader** | spec_strategy.json | `dataset.json` (manifest + availability) | 复用 v1 `cmd_dataset manifest` | 数据空洞 → `blocked:data`; 凭证 → `blocked:credentials` | 不 mock / 不静默复用旧整包 |
| **coder** | spec_strategy.json + dataset.json | `strategy.py` + `config.json` | `cmd_check` 全过 8 rule + warmup_period 与 strategy_class 一致 | spec 歧义 → `blocked:designer` | 不写 QMT / 不跑回测 |
| **auditor** | strategy.py + config.json | `audit_report` (8 rule + 静态审查) | 8 rule 全过 + akquant API 合规 | 违规 → `blocked:redo_coder` | 不写策略代码 |
| **backtester** | strategy.py + config.json + dataset.json | `result.json` (13-key + 15 metrics) | exit 0 + 无 NaN + 13/15 key 齐 | akquant panic → exit 4; 缺键 → exit 5 | 不 import akquant 直跑 / 不改 result |
| **auditor-smoke** *(可选)* | strategy.py + config.json + result.json | `parity_report.json` | akquant parity 跑通 | FAIL → 报 akquant 上游 | 仅在 akquant 升级时跑 |
| **evolver-research** | metrics_summary + change_history + spec_strategy.json | `candidates[]` (1-3 ranked) | 距离目标值评分 + history 反查 + alternative_considered | 0 candidate → 报 evolver | 只 Read 不 Write / 不出 ticket |
| **evolver** | candidates + metrics_summary + user_signals | `change_ticket` / `exit` / `escalate_to_user` | 恰一变量 + evidence_paths + alternative_considered + revert_point | 退出三条件 → exit + learnings; 同方向 fail≥2 → escalate | 一票一变量 / 不绕过 evidence_paths |
| **commiter** | result.json + strategy_id | `{strategy_id, upload_response}` | server 200 + 13-key 完整 | 401 → `blocked:credentials`; 422 → 报用户 | 不创 strategy_id (auto-create 由 `--upload --name` 路径) |

---

## 2. Handoff artifact schema

**统一信封**: `{status:"ok"|"blocked", artifact, summary}`. `blocked` 时 `artifact.phase` ∈ {`redo_coder`, `credentials`, `data`, `designer`, `evolver`} 指明回退点.

### 2.1 `spec_strategy.json` (designer → coder)

**v2 schema** — akquant Strategy 字段清单, 替 v1 "六键伪代码":

```json
{
  "scenario": "一句话: 标的 + 周期 + 信号 + 目标",
  "direction_id": "DIR-005",
  "strategy_class": "LowVolTopK",
  "warmup_period": 21,
  "lifecycle_hooks": ["on_start", "on_bar", "on_timer"],
  "state_attrs": {
    "_vol_cal": "dict[str, dict[str, float]] — runner 端 compute_vol_calendar 预计算",
    "_top_k": "int — top 持仓数",
    "_held": "set[str] — 当前持仓"
  },
  "data_dependencies": {
    "vol_calendar": {
      "source": "runner.prebuilt_resolver.compute_vol_calendar(df, lookback, weekday)",
      "lookback": 20,
      "rebalance_weekday": 4
    },
    "history_window": {"field": "close", "length": 20}
  },
  "order_methods": {
    "buy": "self.buy(sym, qty)",
    "sell": "self.sell(sym, qty)",
    "rebalance": "self.order_target_percent(pct, symbol=s)",
    "subscribe": "self.subscribe(sym) — on_start 里"
  },
  "risk_config": {
    "max_position_pct": 0.10,
    "max_account_drawdown": 0.20,
    "stop_loss_threshold": null
  },
  "perf_arch": {
    "mode": "precompute | per_bar_batch",
    "rationale": "长窗 + 全 A 池 → precompute; 短窗/稀疏 → per_bar_batch",
    "data_coverage_gate": "backtest_end ≤ dataset.data_coverage.end"
  },
  "objective": {"sharpe": ">1.5", "max_drawdown": "<0.15"},
  "upload_intent": "本地回测 | 上传云端",
  "evaluator_path": "skills/hamuna-strategy-v2/strategy_cli/references/akquant_runner.run_akquant_backtest"
}
```

**字段约束**:

- `strategy_class` ∈ `class Foo(akquant.Strategy)` 子类名, `warmup_period` 必须 ≥ `lifecycle_hooks` 内最深的指标 (`history_window.length`)
- `lifecycle_hooks` ∈ {`on_start`, `on_bar`, `on_timer`, `on_order`, `on_trade`, `on_stop`}
- `state_attrs` 必须是 `__init__` 里声明的字段; 每个字段含类型注释 + 来源
- `data_dependencies.<name>.source` 必须是 `runner.*` / `akquant.*` 公开 API (auditor 验)
- `order_methods` 每个 API 必须在 akquant 0.3.x 白名单内 (`buy / sell / order_target_* / subscribe / cancel_order`)
- `risk_config` 空 = 走 akquant default; `null` 字段 = akquant 端不设该阈值
- `perf_arch.mode` ∈ {`precompute`, `per_bar_batch`}; v2 akquant Runner 已优化, **不要**在 `state_attrs` 写自建 panel (v1 时代遗留)
- `objective` 阈值向量格式: `{"<metric>": "<op><value>"}`, op ∈ {`>`, `>=`, `<`, `<=`, `==`}
- `direction_id` ∈ `references/strategy-directions.md` §1 (DIR-001 ~ DIR-012). **不引入新方向** — 加新方向先升级 strategy-directions.md

**六键 ↔ v1 对应** (designer 迁移参考):

| v1 spec.json 六键 | v2 spec_strategy.json 对应 |
|---|---|
| `universe` | `data_dependencies` + `pool` 字段 (由 cfg.json 补) |
| `buy_condition` | `data_dependencies.history_window` + `state_attrs._vol_cal` 等数据契约 |
| `sell_condition` | 同上 (与 buy 共用 data_dependencies) |
| `take_profit` | `risk_config.stop_loss_threshold` (akquant 风控字段) + `order_methods.sell` |
| `stop_loss` | 同上 |
| `position` | `risk_config.max_position_pct` + `order_methods.order_target_percent` |

### 2.2 `audit_report` (orchestrator 合并 → coder)

v2 简化: 不分 P2 worker, 直接 auditor 单 agent 产. 8 rule (见 `references/role-gates.md`):

```json
{
  "compliance_passes": ["coding_utf8", "akquant_subclass", "no_qmt_globals", "no_handlebar", "no_init_contextinfo", "bar_field_alias"],
  "code_review_passes": ["warmup_consistent", "lifecycle_hooks_match_spec", "data_dep_source_valid"],
  "issues": [
    {
      "id": "ISS-001",
      "file": "strategy.py",
      "line": 12,
      "rule": "bar_field_alias_trap",
      "msg": "on_bar 第 12 行用 bar.time — akquant REPR ALIAS, getattr 返 None",
      "fix": "改 datetime.fromtimestamp(bar.timestamp / 1e9).date()"
    }
  ]
}
```

### 2.3 `dataset.json` (dataset-loader → backtester)

**完全复用 v1 契约**. v2 用 `cmd_dataset manifest` 走 v1 同一路径. Schema 同 v1 §2.3 (略 — v2 不再重写).

### 2.4 `metrics_summary` (backtester → evolver-research)

```json
{
  "core_metrics": {
    "total_return": 0.12, "annual_return": 0.08, "sharpe": 1.3,
    "max_drawdown": 0.18, "volatility": 0.15, "win_rate": 0.55,
    "profit_loss_ratio": 1.4, "sortino": 1.7, "calmar": 0.7,
    "var_95": -0.08, "profit_factor": 1.5, "annual_volatility": 0.15,
    "benchmark_total_return": 0.10, "excess_return": 0.02,
    "avg_holding_period": 30.5
  },
  "anomalies": [
    {"trigger": "win_rate=0", "fix": "extend backtest_end", "fallback": "check signal sign"}
  ],
  "vs_prev_delta": {"sharpe": "+0.1", "max_drawdown": "-0.02"},
  "distance_to_objective": {"sharpe": 0.13, "max_drawdown": 0.20},
  "vs_prev_trend": {"sharpe": "↑", "max_drawdown": "→"}
}
```

13-key + 15 metrics = `result.json` (v1 同 schema). v2 不变.

### 2.5 `change_ticket` (evolver → orchestrator → 用户确认)

```json
{
  "variable": "risk_config.max_position_pct",
  "from": 0.10,
  "to": 0.15,
  "spec_module": "risk_config",
  "reason": "max_drawdown 未达 0.15 阈值, 推测单标的仓位过紧",
  "expected_effect": "sharpe 可能提升 0.1-0.2",
  "revert_point": "若 max_drawdown > 0.18 回退 from 值",
  "evidence_paths": [
    "metrics_summary.distance_to_objective.max_drawdown=0.20",
    "metrics_summary.anomalies[0].trigger=win_rate<0.45"
  ],
  "alternative_considered": [
    {"variable": "risk_config.stop_loss_threshold", "score": 0.62, "why_not": "已试过, 见 change_history 第 3 条 applied_delta=0.001"}
  ],
  "confidence": "high"
}
```

**`spec_module` ∈ {**:
- `cfg_only` — 纯 config (cost / backtest 窗口 / 初始资金), 直接给 coder
- `strategy_class` — 改 strategy_class 名字 (慎用, 等于换策略)
- `lifecycle_hook` — 改 on_bar/on_timer/on_start 实现
- `state_attr` — 改 __init__ 状态字段 (e.g. `_top_k` 加权)
- `data_dep` — 改 data_dependencies (e.g. lookback 调整)
- `risk_config` — 改 RiskConfig 字段
- `perf_arch` — 改 precompute / per_bar_batch (改动大, 慎用)

**}: 8 个, 全部对应 spec_strategy.json 的 module**.

**`spec_module ≠ cfg_only` → orchestrator 先让 designer 更新 spec_strategy.json, 再给 coder**.

### 2.6 `{strategy_id, export_path}` (commiter 终产物)

```json
{ "strategy_id": "strat_xxx", "upload_response": {...}, "export_path": "platform → my_strategies → <name> → export QMT" }
```

v1 §2.6 等价. v2 不变.

### 2.7 `learnings` (evolver exit 时落盘, 跨策略检索)

落 `<workspace>/hamuna-strategies/<stem>/learnings.md`:

```markdown
# <stem> learnings (YYYY-MM-DD exit)

## dead_ends (连续 2 轮 <0.5% applied_delta 的变量)
- risk_config.max_position_pct: 0.10→0.15 (round 3), 0.3% delta → skip
- data_dep.history_window.length: 20→30 (round 5), 0.2% delta → skip

## user_signals (用户接受/拒绝的 ticket 摘要)
- 接受: round 1 cost.commission_bps 5→3 (改善净利润)
- 拒绝: round 4 加 dual_MA (用户: "太复杂, 先看其它方向")

## applicable_to (适用池型 / 周期)
- pool: a_share
- period: 1d
- 不适用: 5m/tick (策略逻辑含日线 close)

## spec_snapshot (定格该 exit 时刻的策略规格)
- spec_strategy.json path: <workspace>/hamuna-strategies/<stem>/spec_strategy.json
- final metrics: {sharpe: 1.32, max_drawdown: 0.12, win_rate: 0.55}

## suggested_next_direction_ids (仅 exit_reason ∈ {no_improvement, historical_p75_reached_not_met} 时产出)
- 由 evolver exit 时调 suggest_next_directions(...) 算得.
- v2 降级路径: historical_summary=None → 走 §A 选择器重筛, 返回 top 3 中排除 current_direction_id.
- 空 [] = 无替代建议, orchestrator 走原 abort 路径.
```

### 2.8 `strategy-history` (STRAT-HIST, v2 降级 stub)

**v2 未实装** — server 端无 `strategy-history` collection. evolver 走降级路径:

```python
# v2 evolver-research / evolver 输入契约
historical_summary = None  # v2 永远 None, 不读跨策略索引
historical_dead_ends = None
historical_p75_metrics = None
```

**降级语义**:
- `same_variable_fail_count` 只看本策略 `change_history.jsonl` (单策略内部计数, 不跨策略)
- `same_direction_fail_count` 默认空 dict (无跨策略死亡统计)
- `historical_p75_reached` exit 条件默认 False (永不命中, evolver 不靠此 exit)

**何时实装**: server 端加 `strategy-history` collection + `/api/v1/strategy-history` endpoint 后, evolver 输入契约升级. 不在 v2 初版范围.

---

## 3. 角色 spawn prompt 模板

每段统一结构: **公共头 → 输入契约 → 任务 → gate 约束 → 红线 → 输出格式**.

公共头 (每段开头必带):
```
你是 hamuna-strategy-v2 流水线的 {角色}. 你不直接对用户提问; 用户确认由 orchestrator 转达.
你的产出用统一信封返回: {status:"ok"|"blocked", artifact, summary}.
宿主技能目录: skills/hamuna-strategy-v2. CLI: PYTHONPATH=<v2 根>:skills/hamuna-strategy hamuna_quant_cli ...
纪律与反例黑名单: 你的角色定义 (agents/<role>.md) 已内联本节必需规则.
strategy_cli 是黑盒: 只调公开工具, 不打开 strategy_cli/** 源码.
```

### 3.1 designer

```
输入契约:
  - 需求对齐记录: <4 问答案, orchestrator 内联>
  - dataset-loader 的 availability 摘要: <内联: 覆盖标的数/加载方式(load_path)/窗口/data_coverage>
  - 引擎 API 清单: akquant 0.3.x 公开 API (strategy-patterns.md / api-reference.md)
任务:
  1. 把对齐记录 + availability 规格化成 spec_strategy.json (schema 见 §2.1):
     - strategy_class = akquant Strategy 子类名
     - lifecycle_hooks = 用哪些 hook (on_start / on_bar / on_timer)
     - state_attrs = __init__ 声明的所有状态字段 + 类型注释
     - data_dependencies = 数据契约 (history_window / vol_calendar / etc)
     - order_methods = akquant 下单 API 白名单
     - risk_config = RiskConfig 字段 (空走 default)
     - perf_arch = precompute vs per_bar_batch 二选一 + rationale
     - objective = 阈值向量 {"<metric>": "<op><value>"}
  2. 引用 §A 方向选择器筛 direction_id (DIR-XXX), 复制对应 §B spec_template, 改参数.
  3. 回测窗口对齐 availability.data_coverage (backtest_end 不得超出).
  4. 需求含糊 / 引擎不支持域 (5m/tick / 期权 / 多周期) → blocked:designer.
gate 约束:
  - 8 module 全填 (无某 module 写空 / null + 注释)
  - direction_id ∈ DIR-001~DIR-012 (不引入新方向)
  - objective 阈值向量格式合法
  - data_dependencies.source 必须是 runner.* / akquant.* 公开 API
红线:
  - 不写策略代码 (那是 coder)
  - 不引入不在 strategy-directions.md 的新方向
输出:
  - ok: {status:"ok", artifact: spec_strategy.json (含 8 module), summary:"spec 就绪: 低波动 top-5 周频"}
  - blocked: {status:"blocked", artifact:{phase:"designer", scenarios:[3反例]}, summary:"需求冲突: 标的=期权但 v2 不支持"}
```

### 3.2 coder

```
输入契约:
  - spec_strategy.json: <内联> (8 module 全填, 数据契约定死)
  - dataset-loader 的 availability 摘要: <内联>
  - 编码规范 (内联): agents/coder.md §2 (4 个范式模板 + 关键纪律表)
  - **上一轮 auditor issues[]: <issue_id 列表>** (循环轮由 orchestrator 注入)
任务:
  1. 按 spec_strategy → code 映射机械翻译:
     strategy_class → class Foo(akquant.Strategy):
     lifecycle_hooks → def on_start/on_bar/on_timer(self, ...) 实现
     state_attrs → __init__(self, ...): 声明所有字段 + 类型
     data_dependencies.history_window → self.get_history(n, sym, field)
     data_dependencies.vol_calendar → __init__(vol_calendar=...) 由 runner 注入
     order_methods.buy → self.buy(sym, qty)
     order_methods.sell → self.sell(sym, qty)
     order_methods.rebalance → self.order_target_percent(pct, symbol=s)
     risk_config → 走 akquant run_backtest 的 risk_config 参数 (不在 Strategy 类内)
     perf_arch → 不写自建 panel (v2 Runner 已优化)
  2. 写 strategy.py (utf-8, class Foo(akquant.Strategy)) + config.json (backtest_start/end/pool/init_capital/strategy_params).
  3. 自检: hamuna_quant_cli check strategy.py --config config.json (8 rule 全过).
  4. spec 歧义 → blocked:designer, 不自己猜.
gate 约束:
  - # coding: utf-8 (非 gbk)
  - 8 rule 全过 (auditor 验)
  - warmup_period ≥ max(history_window.length)
  - on_bar 首行: if len(self.get_history(...)) < n: return (warmup 跳过模式)
红线:
  - 不写 QMT globals (passorder / set_basket / ContextInfo)
  - 不写 def init(ContextInfo) / def handlebar
  - 不在 on_bar 里用 bar.time / bar.date (改 bar.timestamp)
  - 不跑回测 (那是 backtester)
输出:
  - ok: {status:"ok", artifact:{py_path, cfg_path}, summary:"code 就绪, 8 rule 全过"}
  - blocked: {status:"blocked", artifact:{phase:"designer", question}, summary:"spec 未定义出场条件"}
```

### 3.3 dataset-loader

```
输入契约:
  - spec_strategy.json 路径: <内联> (含 data_dependencies + pool 字段)
任务:
  1. PYTHONPATH=skills/hamuna-strategy hamuna_quant_cli dataset --config <spec> --name <name>
  2. 固化 manifest 到 ~/.hamuna/datasets/, 产 availability 摘要 (覆盖标的数/加载方式/窗口).
  3. availability 摘要回传给 orchestrator → 触发 designer② 定稿 (本文 §3.1).
gate 约束:
  - 不 mock 兜底 (黑名单 #2)
  - 本地已有旧整包但下载失败 → 显式报错 (旧数据 = 过期数据)
红线:
  - 不跑回测 (那是 backtester)
  - 不写策略代码 (那是 coder)
输出:
  - ok: {status:"ok", artifact: {manifest_path, availability}, summary:"数据集就绪: 全A 5327 只, 整包"}
  - blocked: {status:"blocked", artifact:{phase:"data"|"credentials", detail}, summary:"池全失败 / 凭证..."}
```

### 3.4 backtester

```
输入契约:
  - strategy.py + config.json + dataset.json (loader 产出) + audit_report (auditor 已 ok 通过)
任务:
  1. PYTHONPATH=skills/hamuna-strategy-v2:skills/hamuna-strategy hamuna_quant_cli run strategy.py --config config.json --dataset <manifest> --output result.json
  2. exit 0 → 读 result.json, 产 metrics_summary (schema §2.4).
  3. exit 3 (auditor 违规) / KeyError → blocked:redo_coder; akquant panic → exit 4 报用户.
gate 约束:
  - 不 import akquant 直跑 (走 runner, runner 负责 metrics/schema/上传契约)
  - 不在 result.json 里手改 metrics
红线:
  - 不创 strategy_id (除 --upload --name auto-create 路径)
输出:
  - ok: {status:"ok", artifact: {result_path, metrics_summary}, summary:"回测就绪: sharpe=1.3 win_rate=0.55"}
  - blocked: {status:"blocked", artifact:{phase:"redo_coder"|"akquant", detail}, summary:"akquant panic: ..."}
```

### 3.5 evolver-research

```
输入契约:
  - metrics_summary (来自 backtester)
  - change_history (orchestrator 维护, Read <workspace>/hamuna-strategies/<stem>/change_history.jsonl)
  - spec_strategy.json (designer 产出)
  - user_signals (orchestrator 内联累计)
  - historical_summary=None (v2 降级 — 无 STRAT-HIST)
任务:
  1. distance_to_objective 评分: 遍历 spec.objective 阈值向量, 与 core_metrics 逐项比对 → 最大距离指标 = 优先候选维度.
  2. anomalies → 候选映射: 每条 anomaly.fix 提取具体变量名.
  3. vs_prev_trend 过滤: ↑变量不再下调; ↓/→ 优先调.
  4. history 反查: 同 variable fail ≥2 → 排除; 同 direction fail ≥2 → 排除, 反向入候选 (v2 降级: 单策略内部计数).
  5. 候选维度 (按距离目标值排序):
     - cfg_only: cost.commission_bps / init_capital / backtest 窗口
     - state_attr: spec_strategy.json state_attrs 字段 (e.g. _top_k / lookback)
     - data_dep: spec_strategy.json data_dependencies 字段 (e.g. history_window.length)
     - risk_config: spec_strategy.json risk_config 字段 (e.g. max_position_pct / stop_loss_threshold)
     - perf_arch: spec_strategy.json perf_arch 字段 (改动大, 慎用)
  6. alternative_considered 必填 (≥1 被拒替代 + 拒绝理由).
  7. confidence: high (anomaly 直接命中 + 未试过) / medium (已试过) / low (仅趋势推断).
gate 约束:
  - 只 Read 不 Write (change_history 只读, 不落盘)
  - 最多 3 candidate (超过 → 留 score top 3)
  - 不出 ticket (那是 evolver)
红线:
  - 不挑 ticket (那是 evolver)
  - 不重复试已试过 2 次失败的变量
输出:
  - ok: {status:"ok", artifact: {candidates:[], history_patterns:{...}}, summary:"候选就绪: #1 risk_config.max_position_pct 0.10→0.15"}
  - 0 candidate: {status:"ok", artifact: {candidates:[]}, summary:"无可行候选, 建议 exit"}
```

### 3.6 evolver

```
输入契约:
  - evolver-research 产出 (candidates[] + history_patterns)
  - metrics_summary (来自 backtester)
  - change_history (Read <workspace>/.../change_history.jsonl)
  - user_signals (orchestrator 内联)
  - spec_strategy.direction_id
任务:
  1. 判定退出三条件 (任一命中 → exit + learnings):
     ① 用户说"够了/导出" (orchestrator 内联 user_signals)
     ② 连续 2 轮 applied_delta <0.5% (change_history 尾部 2 条)
     ③ objective 全部达标 (objective_met(core_metrics, spec.objective) == True)
     ④ historical_p75_reached (v2 降级: 默认 False, 不参与判定)
  2. 判 escalate 路径 (非退出条件时):
     - evolver-research.history_patterns.same_direction_fail_count[any] ≥ 2 → escalate (同方向连续失败)
     - #1 candidate.spec_module == "strategy_class" → escalate (换策略影响面大)
     - 触发: {escalate_to_user: {reason, options:[continue, adjust_objective, abort, switch_to_suggested_direction]}}
  3. 否则从 candidates[0] 包 change_ticket (schema §2.5):
     - spec_module 8 选 1 (对应 spec_strategy.json 8 module)
     - evidence_paths[] (V 外部验证): metrics_summary.<field_path>
     - alternative_considered[] (V A/B 比对): 透传 evolver-research 的被拒项
     - revert_point 必须可判 (e.g. "若 sharpe 下降 >0.2 回退 from 值")
gate 约束:
  - 一票一变量 (黑名单 #5)
  - spec_module ≠ cfg_only → 先回 designer 更新 spec_strategy.json, 再给 coder
  - 不重复试已试过 2 次失败的变量 (trust evolver-research 聚合)
红线:
  - 不自行改代码 (那是 coder)
  - 不绕过 evidence_paths 直接出 ticket
  - 不通过 cfg_only 偷偷换方向 (有 direction_id 时 spec_module 必须 ∈ direction_allowed_modules)
输出:
  - ok (ticket): {status:"ok", artifact: change_ticket, summary:"改 risk_config.max_position_pct 0.10→0.15"}
  - exit: {status:"ok", artifact: {exit:true, reason, learnings}, summary:"退出: 无实质改善"}
  - escalate: {status:"ok", artifact: {escalate_to_user: {reason, options, evidence_paths}}, summary:"连续 2 轮同方向失败, 需用户介入"}
```