# v2 CLI — `hamuna_quant_cli` (akquant engine)

> **Round 14 重构后**: v2 skill 的 CLI 已迁出 `strategy_cli/` 子目录, 搬到顶层独立
> pip 包 `hamuna_quant_cli/` (`pip install hamuna-quant-cli` 后 `hamuna_quant_cli
> <args>` 全局可用). 数据 / runner / metrics / schema adapter / discipline 全委托
> `hamuna_quant_cli/`. CLI 只做: 参数解析 + 纪律 self-check + 单步编排 + 落盘.

## 1. 安装 & 环境

### 1.1 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `akquant` | 0.3.x (≥ 0.3.41, < 0.4) | 回测引擎 (Rust + Python) |
| `pandas`, `numpy`, `pyarrow` | latest | 数据 / akquant 内置 |
| `hamuna-quant-cli` | ≥ 0.1.0 (本仓) | runner / data adapter / metrics / schema / discipline |

### 1.2 安装 (一键)

```bash
pip install 'hamuna-quant-cli>=0.1.0'
# 安装后 `hamuna_quant_cli` 直接是 shell 命令; 也可 `python -m hamuna_quant_cli`
# akquant 是 hamuna-quant-cli 的依赖, 自动拉

# 国内镜像源加 --index-url (清华)
pip install 'hamuna-quant-cli>=0.1.0' \
  --index-url https://pypi.tuna.tsinghua.edu.cn/simple

# 本地源码装 (开发 v2 skill 时)
# 在 hamuna-strategy-platform 根目录
pip install -e .
```

### 1.3 验证安装

```bash
hamuna_quant_cli --version
# 期望: hamuna-quant-cli 0.1.0 (或当前版本)

hamuna_quant_cli run --help
# 期望: usage 显示 run 子命令 + 参数表
```

> **桌面端 (Tauri) 启动器**: 启动策略前 Rust 调用 `check_runtime_env_cmd` 检测
> python + hamuna_quant_cli, 缺哪个弹窗提示 `pip install hamuna-quant-cli`.

---

## 2. 回测子命令 (回测主线)

### 2.1 `run` — 跑回测 → `result.json`

```
hamuna_quant_cli run <strategy.py> --config <json> [--output <json>]
                                   [--skip-discipline]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `strategy` (位置) | ✅ | 策略 `.py` 路径, 含 `akquant.Strategy` 子类 (on_bar API) |
| `--config` | ✅ | CONFIG JSON 路径 (backtest_start / backtest_end / pool / init_capital) |
| `--output` |  | 落盘 JSON 路径. 不传 → stdout |
| `--skip-discipline` |  | 跳过纪律 self-check (qa / 旧策略兼容. **正式 coder 必须不传**) |

**退出码**:
- `0` = OK
- `2` = 入参错 (config 解析失败 / 文件不存在)
- `3` = 纪律 self-check 未通过 (打印违规清单 + 规则名 + 行号)
- `4` = akquant 跑挂 (数据缺失 / import 错 / 参数错, 看 stderr)
- `5` = hamuna 13-key schema 折叠失败 (runner 报 schema 错)

**最小可跑**:

```bash
mkdir -p /tmp/v2_smoke
cat > /tmp/v2_smoke/strategy.py <<'EOF'
from akquant import Strategy

class BuyHold(Strategy):
    warmup_period = 1
    def on_bar(self, bar):
        if self.get_position(bar.symbol) == 0:
            self.buy(bar.symbol, 100)
EOF
cat > /tmp/v2_smoke/config.json <<'EOF'
{
  "backtest_start": "20240701",
  "backtest_end":   "20241231",
  "pool":           {"a_share": {"codes": ["600000.SH", "600036.SH"]}},
  "init_capital":   1000000.0
}
EOF
hamuna_quant_cli run /tmp/v2_smoke/strategy.py \
  --config /tmp/v2_smoke/config.json \
  --output /tmp/v2_smoke/result.json
# 期望 stderr: "result saved → /tmp/v2_smoke/result.json"
```

**result.json 形态**: 13 顶层 key dict. 详细字段契约见 [`backtest-result.md`](backtest-result.md).

### 2.2 `check` — 纯静态纪律 self-check (不回测)

```
hamuna_quant_cli check <strategy.py> --config <json>
```

**只读源码 + cfg**, 跑 AST 静态分析 (8 条 rule, 见 [`role-gates.md`](role-gates.md)).
**不预热数据集 / 不调 akquant** — 用于 coder / auditor 在写完策略后立刻自查.

**退出码**: 0 = 通过; 3 = 违规 (打印 rule + line + msg).

```bash
hamuna_quant_cli check /tmp/v2_smoke/strategy.py \
  --config /tmp/v2_smoke/config.json
# 期望 stderr: "纪律 self-check 通过 (0 条)"
```

### 2.3 `upload` — 上传 `result.json` 到 `strategy_id`

```
hamuna_quant_cli upload <strategy_id> --result <result.json>
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `strategy_id` (位置) | ✅ | server 端 strategy 的 `_id` (`hamuna_quant_cli create` 返的 24 字符串) |
| `--result` | ✅ | 本地 `result.json` (`run` 子命令产出) |

**退出码**:
- `0` = 上传成功
- `2` = 本地 result.json 缺失 / JSON 解析失败
- `4` = server 端 `ServerError` (HTTP 401 / 4xx / 5xx, 看 stderr)
- `5` = result 字段不满足 15-key 契约 (server 拒)

**使用前提**: `~/.hamuna/credentials.json` 必须有 `api_key` (server 端 register_login 签发).
**重要**: strategy_id 跟 engine 绑定 (由 `hamuna_quant_cli create --engine akquant-0.3.x` 时写入).
v2 upload 只是把"已经跑通的本地 result.json"绑到对应 id. **不创建新 strategy, 不替换 source.**

```bash
hamuna_quant_cli upload 655a...c0 \
  --result /tmp/v2_smoke/result.json
# 期望 stdout: { "id": "...", "updated_at": "...", ... }
```

---

## 3. 与 v1 CLI 的差异 (cheat sheet)

| 维度 | v1 (旧) | v2 (新) |
|---|---|---|
| 入口 | `python -m strategy_cli` (v1 skill 自带) | **`hamuna_quant_cli`** (顶层独立 pip 包) |
| 策略规范 | QMT-style: `init(ContextInfo)` + `handlebar(ContextInfo)` | akquant: `class Foo(akquant.Strategy)` + `on_bar(self, bar: Bar)` |
| 引擎 | 自建 driver `runtime/driver.py` (~880 行) | 委托 `hamuna_quant_cli.akquant_runner` |
| 文件编码 | `# coding: gbk` (QMT 编辑器契约) | `# coding: utf-8` (akquant 契约) |
| 报单 | `passorder(23, ...)` | `self.buy(symbol, qty)` / `self.sell(symbol, qty)` |
| 调仓 | `set_basket` / `get_basket` | `self.order_target_percent` / `self.get_position` |
| 组合 | `ContextInfo` 全局 | `self` 实例 + `add_daily_timer` |
| Bar 字段 | `bar.time` / `bar.close` (QMT) | `bar.timestamp` (int ns) / `bar.close` (akquant 0.3.x: `bar.time` 是 REPR ALIAS, 返 None!) |
| result schema | hamuna 13-key dict | hamuna 13-key dict (**同**) |
| 上传路由 | `PUT /api/v1/strategies/{id}/result` | `PUT /api/v1/strategies/{id}/result` (**同**) |
| 是否支持 tick / 5m | ✅ (QMT 编辑器) | ❌ (akquant Phase B 锁日线) |

**id 一致性**: 同一 strategy_id, v1 跑 + v2 跑 → 都产生 13-key dict; 上传协议不变.
**互斥**: 不要把同一 strategy 同时用 v1 + v2 跑 (id 会冲突, 以最后上传为准).

---

## 4. 故障排查 (5 个最常见错)

| 现象 | 退出码 | 排查 |
|---|---|---|
| `ModuleNotFoundError: akquant` | 4 | `pip install 'akquant>=0.3.41,<0.4'` (或 `uv add 'akquant>=0.3.41,<0.4'`) |
| `FileNotFoundError: ...prebuilt bundle not found` | 4 | 检查 `~/.hamuna/data/prebuilt/` 有无数据集 (云端 `hamuna_quant_cli.references.prebuilt_downloader` 下) |
| `ValueError: backtest_start > backtest_end` | 4 | CONFIG 日期顺序错 |
| `DisciplineError: qmt_global_leaked: passorder` | 3 | 旧 v1 策略 → 写 v2 时改 `self.buy` |
| `DisciplineError: bar_field_alias_trap` | 3 | `bar.time` → `datetime.fromtimestamp(bar.timestamp/1e9).date()` |

---

## 5. 不支持的 (明确)

- ❌ 5m / tick / 多周期 (akquant Phase B 锁日线, 与 v1 一致)
- ❌ 实时盘中断恢复 (v2 是离回测, 不接 QMT gateway)
- ❌ 跨包版本混用 (`hamuna-quant-cli<0.1` 时代有 `strategy_cli` 子目录, 0.1+ 已迁出)
- ❌ 私有 IR / DSL 翻译 (ADR-002; v2 策略就是用户写的 akquant Python)