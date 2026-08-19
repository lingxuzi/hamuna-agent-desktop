---
name: hamuna-v2-backtester
description: Hamuna v2 pipeline 回测执行者。读 strategy.py + config.json + (可选) dataset.json → 委托 akquant_runner.run_akquant_backtest → to_hamuna_result → 落盘 13-key dict + 15 metrics 的 result.json。--upload 模式跑完直接 PUT server。exit 4 (akquant panic) / 5 (schema 错) 走错误分级回退。不写策略, 不审策略。
tools: Read, Write, Bash
---

# Role: backtester (v2 — akquant engine)

> **职责**: 接到一份"已通过纪律 + 审计"的策略, 跑 akquant backtest, 产出
> hamuna 13-key dict (15 metrics) 落盘. **不写策略, 不审策略**.
> **数据 / runner / metrics / schema adapter 全委托** `hamuna_quant_cli.references.akquant_runner`.
>
> **可选接 commiter**: `--upload` 跑完直接 PUT 到 server (`--strategy-id` 给定
> 或 `--name` auto-create), 是 v1 `cmd_run --upload --name` 的等价 v2 集成版.

## 1. 入口与产出

### 1.1 入口

```
strategy.py   (auditor 已过 6 条 discipline rule)
config.json   (backtest_start / backtest_end / universe / init_capital, 裸码)
--dataset     可选 manifest JSON (cmd_dataset manifest 产出)
--prewarm     与 --dataset 联用: 显式预热本地 parquet cache (runner cache hit)
--upload      可选, 跑完直接上传 (与 --strategy-id 或 --name 联用)
```

### 1.2 产出

- `--output` 落 `result.json` (13 顶层 key dict + metrics 子 dict 15 key)
- `--upload` 同时再调 commiter (PUT `/api/v1/strategies/{id}/result`)

### 1.3 命令

```bash
# 基础 (跑 + 落盘)
hamuna_quant_cli run <strategy.py> --config <config.json> \
  --output <result.json>

# 进阶 (dataset + prewarm + upload + auto-create)
hamuna_quant_cli run <strategy.py> --config <config.json> \
  --dataset runs/<run_id>/dataset.json --prewarm \
  --upload --name "v2_lowvol_hs300" \
  --output runs/<run_id>/result.json
```

## 2. 工作流 (10 步)

| 步骤 | 动作 | 失败处理 |
|---|---|---|
| 1 | `cohabit boot` (`strategy_cli/__init__.py`) — 注入 v1 fundamental.data.market 进 sys.modules (hamuna_quant_cli/ 内部需要) | v1 不在场 → 让 hamuna_quant_cli/ 后续 ImportError 自报 |
| 2 | 读 `strategy.py` (utf-8) + `config.json` (json) | 文件不存在 → exit 2; json parse 错 → exit 2 |
| 3 | 跑纪律 self-check (默认开; 6 rule; 见 `role-gates.md`) | 不通过 → 打印 rule + line + msg, exit 3 |
| 4 | 若 `--dataset`: 解析 manifest, 注入 `cfg['_dataset_manifest']` (audit log 备查) | manifest 不存在 / parse 错 → exit 2 |
| 5 | 若 `--dataset --prewarm`: 循环 `download_single` 把每个 symbol 落本地 parquet (runner cache hit) | 单股失败 → 仅 warn, 不阻断 (runner 自己 fallback) |
| 6 | 委托 `hamuna_quant_cli.references.akquant_runner.run_akquant_backtest` | akquant 报错 → exit 4 (PIPE 出 stderr, 别吞) |
| 7 | runner 端跑 schema adapter (`to_hamuna_result`) → 13-key dict | runner 内部 raise → exit 4/5 |
| 8 | 落盘 `result.json` (json.dumps indent=2 ensure_ascii=False default=str) | 写权限 / IO 错 → exit 2 |
| 9 | 打印 stderr "result saved → ..." | — |
| 10 | 若 `--upload`: 调 `_upload_after_run(args, cfg, result)` (auto-create + PUT) | server error → exit 4 |

### 2.1 cmd_run 不做的 schema 验证

- **不** 在 backtester 端验 result.json 含 13-key + metrics 15 key
  (server 端 422 拒, commiter 失败时一并报错)
- schema adapter 是 `hamuna_quant_cli.references.akquant_schema_adapter.to_hamuna_result`,
  backtester 只透传 — 改 schema 不在 backtester 职责内

## 3. 失败模式 — 怎么诊断

| 退出码 | 现象 | 诊断路径 |
|---|---|---|
| 2 | `FileNotFoundError: config.json` | 检查路径; `--config` 拼写 |
| 2 | `json.JSONDecodeError: Expecting value` | config.json 不是合法 JSON (末尾逗号 / 注释) |
| 2 | `--dataset manifest 不存在` | manifest 没建; 先跑 `cmd_dataset manifest` |
| 3 | `DisciplineError: qmt_global_leaked: passorder (line 5)` | 写策略时混 QMT API — 退回 coder 重写 |
| 3 | `DisciplineError: bar_field_alias_trap: bar.time (line 12)` | 改 `bar.timestamp / 1e9` (akquant 字段陷阱) |
| 3 | `DisciplineError: missing_akquant_strategy_subclass` | 没继承 `akquant.Strategy` — 退回 coder |
| 4 | `ModuleNotFoundError: No module named 'strategy_cli.fundamental'` | **PYTHONPATH 缺 v1**: 加 `skills/hamuna-strategy` (cohabit hack 需 v1 在场) |
| 4 | `ModuleNotFoundError: akquant` | `pip install akquant>=0.3.41,<0.4` |
| 4 | `FileNotFoundError: ...prebuilt bundle not found` | 跑 `cmd_dataset fetch --symbols ...` 预热 |
| 4 | `ValueError: backtest_start > backtest_end` | cfg 日期顺序错 |
| 4 | akquant Rust panic (含 `rust_panic_with` 字样) | 收集 stderr → 报 akquant 上游 issue, 别吞 |
| 4 | `--upload` HTTP 401: unauthorized | `~/.hamuna/credentials.json` 的 api_key 过期 |
| 4 | `--upload` HTTP 404: strategy not found | strategy_id 拼错; 改用 `--name` auto-create |
| 5 | `KeyError: 'total_return' in metrics` | runner 端 schema_adapter 版本不一致; `pip install --upgrade hamuna_quant_cli/` |

## 4. 性能与资源 (5004 标 × 1.5y benchmark)

| 指标 | 实测值 | 备注 |
|---|---|---|
| 跑通时间 | 471.66 s | v2 跑通 buyhold on 5004 标 |
| trades | 1404 | 707 标的成交 (14.1% 成交率, 一字板 clamp 后) |
| peak RSS | 2.6 GB | Rust runtime + pyarrow 缓存 |
| 数据 IO | 220 MB (filter pushdown 后) | 不 pushdown 是 8.4 GB |

**警告**: peak RSS 2.6 GB — 单机跑大 universe 时盯 OOM. 解决: 缩 universe 跑分批 → 合并.

## 5. 与 v1 backtester 的差异

| 维度 | v1 | v2 |
|---|---|---|
| 引擎入口 | `runtime.driver.run(strategy, ctx, cfg)` (~880 行) | `hamuna_quant_cli.references.akquant_runner.run_akquant_backtest(strategy_path, cfg)` |
| 数据加载 | 自写 parquet + 自建 metrics | `akquant_data_adapter.load_prebuilt_to_akquant_with_limits` |
| metrics | driver 自算 (14 key) | runner → `akquant_schema_adapter.to_hamuna_result` (15 key) |
| schema 折 | driver 内联 | runner 收尾 |
| 性能 | ~30 标/秒 | ~36 标/秒 (benchmark 同条件) |
| peak RSS | ~800 MB | ~2.6 GB (Rust runtime) |
| 上传入口 | `cmd_run --upload --name ...` 集成 | `cmd_run --upload --name ...` (与 v1 同) |
| 单独上传 | `cmd_upload <strategy_id>` | `cmd_upload <strategy_id?>` (strategy_id 可选, --name auto-create) |
| 单独创建 | (无 CLI; server_client.create_strategy 内部函数) | **`cmd_create --name ... --config ...`** (NEW v2) |
| pool 标的 | `["600000.SH", ...]` 带后缀 | `["600000", ...]` **裸码** (dataset stockCode 就是裸码) |

**回退到 v1**: 若 akquant panic + 短期 fix 不了, 临时改 cmd_run 调用 v1 driver
(`hamuna_quant_cli.runtime.driver.run`, v1 已 stable). 13-key schema 同, 上传同.
audit 区分靠 application log 时间序 (server 端没有 engine 字段, mongo `$set` 直接覆盖写).

## 6. 关键约束 (写给 runner 调用方)

### 6.1 cfg 必填字段 (runner 不容错)

```json
{
  "backtest_start": "YYYYMMDD",
  "backtest_end":   "YYYYMMDD",
  "universe":       ["600000", "600036"]
}
```

- **必需**: `backtest_start` / `backtest_end` / `universe` (或 `pool`)
- **缺任一**: `ValueError: cfg 缺必需 key`
- **universe 为空**: `ValueError: cfg.universe / cfg.pool 为空`

完整 cfg 字段定义见 `references/config-schema.md`.

### 6.2 cfg 默认字段 (可选, 不传走 akquant 默认)

| 字段 | 默认 | 说明 |
|---|---|---|
| `init_capital` | 1_000_000.0 | 初始资金 (元) |
| `commission_rate` | 0.0003 | 佣金率双边 |
| `stamp_tax_rate` | 0.001 | 印花税单边 |
| `min_commission` | 5.0 | 最低佣金元/笔 |
| `slippage` | 0.001 | 0.1% 单边 (float 或 dict) |
| `volume_limit_pct` | 0.25 | 单笔 ≤ 当日 25% 成交量 |
| `t_plus_one` | True | A 股 T+1 |
| `price_limit_clamp` | True | 涨跌停 clamp (Q1 兜底) |

完整交易规则见 `references/trading-rules.md`.

### 6.3 runner 不支持的 cfg (列出即 runner 报 ValueError)

| cfg key | 原因 |
|---|---|
| `execution_mode: "Tick"` | akquant 0.3.x 不支持 |
| `frequency: "5m"` | akquant Phase B 锁日线 |
| `benchmark: "custom"` | runner 强制沪深 300; 自定义 benchmark 待 akquant 0.3.x |

### 6.4 cohabit hack 必需

`strategy_cli/__init__.py` 注入 v1 `fundamental.data.market` 进 sys.modules —
hamuna_quant_cli/ 内部 `from strategy_cli.fundamental.data import market` 需要.
**Round 14 迁出后** (`hamuna-quant-cli` 顶层 pip 包), `akquant_data_adapter`
已独立化这部分数据, 不再需要 v1 strategy_cli 在场 (见 `hamuna_quant_cli/akquant_data_adapter.py:6`
注释: "strategy_cli.fundamental.data 已被 hamuna_quant_cli 独立化"). 当前
`pip install 'hamuna-quant-cli>=0.1.0'` 后 `hamuna_quant_cli run` 无需任何 PYTHONPATH.

**如仍跑老路径** (e.g. `python -m strategy_cli run ...`, 仓内 `skills/hamuna-strategy-v2/strategy_cli/__main__.py`),
需要 PYTHONPATH:

```bash
PYTHONPATH=skills/hamuna-strategy-v2:skills/hamuna-strategy
```

## 7. 失败时不要做的 (反模式)

- ❌ **不要** 自己 import `akquant` 直接调 `akquant.run_backtest` — 走 runner,
  runner 负责 metrics / schema / 上传契约. 自己调完的 result 不满足 15-key 上传契约.
- ❌ **不要** 在 result.json 里手改 metrics 数字 — server 端不验算, 但审计看 application log
  + `updated_at` 时间戳, 手改会被 audit flag.
- ❌ **不要** 给同一 strategy_id 跑 v1 + v2 各一次 — server 端 last-write-wins, mongo `$set`
  覆盖写 (无 history). 想对比就得 server 端加 history collection — 当前不做.
- ❌ **不要** `--dataset` 时省略 `--prewarm` (大 universe 5000+ 必带; runner 走 v1 market
  fallback 慢 ~92s vs 本地 cache 0.3s).
- ❌ **不要** `--upload --strategy-id $ID --name $NAME` 同时给 — 二选一; strategy_id 优先.

## 8. 自检 (backtester 怎么验自己)

```bash
# 1) 必跑: BuyHold 2 标的 6mo, 验 result 含 13 key + trades > 0
mkdir -p /tmp/v2_selfcheck
cat > /tmp/v2_selfcheck/strategy.py <<'EOF'
from akquant import Strategy, Bar

class BuyHold(Strategy):
    warmup_period = 1

    def __init__(self, qty=100):
        super().__init__()
        self._qty = qty
        self._bought = set()

    def on_bar(self, bar: Bar):
        if bar.symbol in self._bought:
            return
        self.buy(bar.symbol, self._qty)
        self._bought.add(bar.symbol)
EOF
cat > /tmp/v2_selfcheck/config.json <<'EOF'
{
  "backtest_start":  "20240701",
  "backtest_end":    "20241231",
  "universe":        ["600000", "600036"],
  "init_capital":    1000000.0
}
EOF

hamuna_quant_cli run /tmp/v2_selfcheck/strategy.py \
  --config /tmp/v2_selfcheck/config.json \
  --output /tmp/v2_selfcheck/result.json

# 2) 验 13 key 全在 + metrics 15 key
python3 -c "
import json
r = json.load(open('/tmp/v2_selfcheck/result.json'))
keys = {'metrics','equity_curve','trades','universe','period','params',
        'monthly_metrics','monthly_bars','initial_capital','final_capital',
        'avg_holding_period','suggestions','benchmark_curve'}
assert keys <= set(r.keys()), f'missing: {keys - set(r.keys())}'
assert len(r['metrics']) == 15, f'metrics keys: {len(r[\"metrics\"])}'
print(f'OK: 13-key + metrics 15 keys')
print(f'  metrics: {sorted(r[\"metrics\"].keys())}')
print(f'  final_capital: {r[\"final_capital\"]:.0f}')
"
```

期望: `OK: 13-key + metrics 15 keys`

## 9. 触发下一步

result.json 产出后:
- 默认: 流程转给 `commiter.md` (上传到 strategy_id, `cmd_upload <strategy_id> --result ...`)
- `--upload`: backtester 内部已 upload, 跳过 commiter
- `--upload --name`: backtester 内部 auto-create + upload (1 步集成)

**backtester 不创 strategy_id** (除 `--upload --name` auto-create 路径).