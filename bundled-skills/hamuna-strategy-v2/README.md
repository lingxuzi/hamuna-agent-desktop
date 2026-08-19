# README — hamuna-strategy-v2

> **akquant 回测引擎 + akquant 策略规范**. 替代 v1 自建 driver, 与 v1 并行.

---

## 1. v2 是什么

`hamuna-strategy-v2/` 是一个**新的子 skill**, 走顶层独立 pip 包 CLI `hamuna_quant_cli`
(`pip install hamuna-quant-cli` 后 `hamuna_quant_cli <args>` 全局可用),
与 v1 共享底座鉴权 (`~/.hamuna/credentials.json` 放 api_key), 但走**完全不同的回测路径**:

| 维度 | v1 | v2 |
|---|---|---|
| 引擎 | 自建 Python driver (~880 行) | **akquant 0.3.x** (Rust + Python) |
| 策略规范 | QMT: `init(ContextInfo)` + `handlebar(ContextInfo)` | **akquant: `class Foo(akquant.Strategy)` + `on_bar(self, bar)`** |
| 数据加载 | 自建 parquet 读 | `akquant_data_adapter.load_prebuilt_to_akquant_with_limits` |
| metrics | driver 自算 | `hamuna_quant_cli._metrics_15.compute_all` |
| schema 折 | driver 内联 | `akquant_schema_adapter.to_hamuna_result` |
| 上传协议 | hamuna 13-key dict | hamuna 13-key dict (同) |
| QMT 导出 | ✅ (走 v1 + cloud) | ❌ (v2 skill 不再负责 — QMT 端策略由用户在 QMT 客户端维护) |

**v2 skill 自身无 Python 代码** (Round 14 重构后): 全部代码在顶层 `hamuna_quant_cli/`
独立 pip 包. v2 skill 仅保留 `SKILL.md / README.md / ARCHITECTURE.md / references/ / agents/` 作为文档入口.
**v2 不重复实现**: akquant 引擎 / 数据 IO / metrics / schema adapter. 全委托 `hamuna_quant_cli/`.

## 2. 何时用 v2, 何时用 v1

| 场景 | 推荐 |
|---|---|
| 写新策略 (单标的 / 横截面 / 跨标轮动) | **v2** (akquant 性能 + 撮合更好) |
| 已有 QMT 旧策略, 不想重写 | v1 (QMT-style 不变) |
| 跑 5m / tick / 多周期 | **v1** (akquant Phase B 锁日线) |
| 接 QMT 实盘 gateway | **v1** (cloud 端 QMT) |
| 跑 akquant benchmark / 大 universe 回测 | **v2** (5004 标 × 1.5y 验证过) |
| 给老 client 兼容 (server 端 v1 result) | v1 或 v2 (audit log 时间序区分) |

**互不破**: 同一 strategy_id, v1 跑过一次 + v2 跑过一次, server 端 last-write-wins
(mongo $set on `strategies.{_id}.result`). audit 按 application log 时间序看.

## 3. 迁移指南 — v1 → v2

### 3.1 QMT-style 旧策略改写

| v1 写法 | v2 改写 |
|---|---|
| `# coding: gbk` | `# coding: utf-8` (或删行) |
| `def init(ContextInfo):` | `def __init__(self):` 或 `def on_start(self):` |
| `ContextInfo.set_universe(['600000.SH'])` | `self.subscribe('600000.SH')` (在 on_start) |
| `def handlebar(ContextInfo):` | `def on_bar(self, bar: Bar):` |
| `bar.time` | `datetime.fromtimestamp(bar.timestamp / 1e9).date()` |
| `passorder(23, 1101, sym, 0, 0, 100, ...)` | `self.buy(sym, 100)` |
| `set_basket({sym: vol})` | `for s, v in target.items(): self.order_target_percent(v/init_capital, symbol=s)` |
| `is_last_bar()` | (akquant daily 全是 last-bar, 删) |
| `quickTrade = 2` | (akquant on_bar 自动, 删) |
| `m_strRemark` | (akquant 不支持, 写到 self._log) |

### 3.2 CLI 命令迁移

| v1 | v2 |
|---|---|
| `python -m strategy_cli run strategy.py --config cfg.json --output result.json` | `hamuna_quant_cli run strategy.py --config cfg.json --output result.json` (默认开纪律 self-check) |
| `python -m strategy_cli check strategy.py --config cfg.json` | `hamuna_quant_cli check strategy.py --config cfg.json` |
| `python -m strategy_cli upload id --config cfg.json --output result.json` | `hamuna_quant_cli upload id --result result.json` (**`--config` 去掉, `--result` 不变**) |
| `python -m strategy_cli run-and-upload strategy.py --config cfg.json --id id` | 两步: `run` + `upload` (见 §4) |
| `python -m strategy_cli create-strategy --name ... --source ...` | `hamuna_quant_cli create --name ... --source ... --engine akquant-0.3.x` (顶层包自带 create 子命令) |

### 3.3 CONFIG 迁移

v2 cfg 兼容 v1 cfg (相同 schema), 不需要改. 但 v2 支持 v1 不支持的字段:

```json
{
  "...": "...",
  "cross_sectional": {              // NEW (v2 才有)
    "lookback": 20,
    "rebalance_weekday": 4,
    "top_k": 5
  }
}
```

→ runner 端调 `compute_vol_calendar` 注入 strategy `__init__(vol_calendar=...)`.

### 3.4 哪些 v1 cfg 字段 v2 不支持 (写就 runner 报错)

| 字段 | 原因 |
|---|---|
| `frequency: "5m"` | akquant 锁日线 |
| `execution_mode: "Tick"` | akquant 0.3.x 不支持 |
| `benchmark: "custom"` | runner 强制沪深 300 |

## 3.5 策略生成规范 (akquant 0.3.x — 兼容回测, 实盘接入见 desktop)

> **分层**: v2 skill 本体 = 离线回测 (`hamuna_quant_cli run`); 实盘接入
> 在 `desktop/app/src-tauri/resources/hamuna_strategy.py live run`, 不在本 skill
> 范畴. akquant 0.3.x `Strategy` 是双引擎一等公民 — 同一份 .py 在两边都能跑, 业务
> 侧不感知 IO 路径. v2 runner 在 `run_backtest` 之前自动 wire `compute_factors` /
> `filter_symbols` 钩子.

```python
from akquant import Strategy, IntParam, ListParam
import pandas as pd


class MyStrat(Strategy):
    # 0.3.x 内联参数字段 (替代旧 __init__ 签名)
    fast    = IntParam(5, ge=2, le=200)
    slow    = IntParam(20, ge=3, le=500)
    top_k   = IntParam(10, ge=1, le=50)
    universe = ListParam(item_type=str, default=[])

    warmup_period = 21

    def on_start(self) -> None:
        for s in self.params.universe:
            self.subscribe(s)

    # 可选 — 引擎加载 df 后调一次 (回测 prebuilt / 实盘 {sym: df})
    # 用 akquant.talib 内置 MA (rust 后端 5-10x, 公式等同 pandas)
    def compute_factors(self, df: pd.DataFrame) -> dict[str, pd.DataFrame]:
        from akquant import talib
        factors = {}
        syms = df["symbol"].unique() if "symbol" in df.columns else df.keys()
        for sym in syms:
            sub = df[df["symbol"] == sym].copy() if "symbol" in df.columns else df[sym].copy()
            closes = sub["close"].to_numpy()
            sub["ma_fast"] = talib.MA(closes, self.params.fast)
            sub["ma_slow"] = talib.MA(closes, self.params.slow)
            factors[sym] = sub
        return factors

    # 可选 — 限定 universe (df 进入引擎前调一次)
    def filter_symbols(self, factors: dict[str, pd.DataFrame]) -> list[str]:
        # 默认不动 factors — 改成你的逻辑
        return list(factors.keys())

    def on_bar(self, bar) -> None:
        closes = self.get_history(self.params.slow, bar.symbol, 'close')
        if len(closes) < self.params.slow:
            return
        if closes[-1] > closes[-self.params.fast]:
            self.buy(bar.symbol, 100)
```

**回测** (v2 skill 主线):
```bash
hamuna_quant_cli run my_strategy.py --config my_config.json --output result.json
```

**实盘** (独立文件, 不在本 skill 范畴):
```bash
python desktop/app/src-tauri/resources/hamuna_strategy.py live run my_strategy.py \
  --mode paper --broker qmt --market-broker qmt_market \
  --symbols sh600000,sz600036 \
  --gateway-options "qmt_account_id=8888888888,qmt_paper=1"
```

完整模板见 [`references/scaffolds.md`](references/scaffolds.md) §2-§5.

---

## 4. 端到端 smoke (10 行)

```bash
# 0) 安装 (一次性, Round 14 后无需 PYTHONPATH)
pip install 'hamuna-quant-cli>=0.1.0'
# akquant 是 hamuna-quant-cli 的依赖, 自动拉

# 1) 写策略
cat > /tmp/s.py <<'EOF'
# coding: utf-8
from akquant import Strategy
class S(Strategy):
    warmup_period = 1
    def on_bar(self, bar):
        if self.get_position(bar.symbol) == 0:
            self.buy(bar.symbol, 100)
EOF

# 2) 写 cfg
cat > /tmp/c.json <<'EOF'
{
  "backtest_start": "20240701",
  "backtest_end":   "20241231",
  "pool":           {"hs300": {"codes": ["600000.SH", "600036.SH"]}},
  "init_capital":   1000000.0
}
EOF

# 3) 静态审查
hamuna_quant_cli check /tmp/s.py --config /tmp/c.json
# 期望 stderr: "纪律 self-check 通过 (0 条)"

# 4) 跑回测
hamuna_quant_cli run /tmp/s.py --config /tmp/c.json --output /tmp/r.json
# 期望 stderr: "result saved → /tmp/r.json"
# 期望 /tmp/r.json 含 13 顶层 key + metrics 子 dict 15 个 key (与 v1 driver 同 schema)

# 5) 创 strategy 拿 id (hamuna_quant_cli 自带 create)
STRATEGY_ID=$(hamuna_quant_cli create \
  --name "v2_smoke_$(date +%s)" --source /tmp/s.py --engine "akquant-0.3.x" \
  | jq -r '.id')

# 6) 上传 result
hamuna_quant_cli upload "$STRATEGY_ID" --result /tmp/r.json
# 期望 stdout: { "id": "...", "updated_at": "..." }
```

完整验证 (含失败排查) → [`references/cli.md`](references/cli.md).

## 5. 已知 benchmark (v2 端到端)

| Case | 标的 | 窗口 | trades | 跑通时间 | peak RSS |
|---|---|---|---|---|---|
| buyhold 2 标 | 600000.SH, 600036.SH | 6mo | 2 | 18 s | 480 MB |
| MeanRev 5 标 | 5 标的 | 2y | 42 | 92 s | 1.4 GB |
| LowVolTopK 50 | 沪深 300 | 2y | 1404 | 471 s | 2.6 GB |

**结论**: v2 在大 universe benchmark 上跑通时间 < 8 min, peak RSS < 3 GB. 实测可投.

完整 benchmark log: `docs/调研-AKQuant-回测框架.md` §5.

## 6. 关联文档

- 顶层入口: [`SKILL.md`](SKILL.md)
- 架构 + 复用清单: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- CLI 详解: [`references/cli.md`](references/cli.md)
- Schema: [`references/backtest-result.md`](references/backtest-result.md)
- 引擎 + 数据: [`references/engine-and-data.md`](references/engine-and-data.md)
- 6 条纪律: [`references/role-gates.md`](references/role-gates.md)
- QMT 导出 (v2 skill 不再负责): v2 不再产出 QMT 格式代码 — QMT 端策略由用户在 QMT 客户端维护。QMT 编码规范参考见 [`references/qmt_coding_spec.md`](references/qmt_coding_spec.md) (本文件保留供查阅, 不再 export)。

## 7. 关联 skill

- v1 skill (旧, **不变**): [`../hamuna-strategy/`](../hamuna-strategy/)
- akquant 框架手册: [`~/.claude/skills/akquant/SKILL.md`]
- 项目根: [`../../CLAUDE.md`](../../CLAUDE.md)