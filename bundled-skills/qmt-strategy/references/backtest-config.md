# QMT Backtest Configuration — Schema & Scenario Defaults

The 回测参数 block is what the user fills in the "回测参数" tab of the QMT strategy editor, **and** what `init` may override in code (`ContextInfo.start / end / capital`). This file is the schema + scenario-specific defaults; both surfaces must agree.

> Source of truth: [`qmt/qmt_innerapi_builtin_python.md`](../../qmt/qmt_innerapi_builtin_python.md) §回测参数 + [interface_operation.html §回测参数-字段描述](https://dict.thinktrader.net/innerApi/interface_operation.html).

---

## Full schema (every field with default)

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| 开始时间 | `'%Y%m%d'` or `'%Y-%m-%d %H:%M:%S'` | (空) | 回测起点；与 `ContextInfo.start` 同时存在时, **代码值为准** |
| 结束时间 | 同上 | (空) | 同上 |
| 基准 | `'000300.SH'` 等 | `'000300.SH'` | 收益参考基准（如沪深 300 `'000300.SH'`、中证 500 `'000905.SH'`、行业指数） |
| 初始资金 | float | `1000000` | 回测初始资金；与 `ContextInfo.capital` 同时存在时, **代码值为准** |
| 保证金比例 | float | `0.15` | 期货保证金比例 |
| 滑点 | float | `0.0` | 回测撮合时的滑点, 模拟真实交易的冲击成本 |
| 手续费类型 | enum | `'amount'` | `'amount'`(成交额比例) / `'fixed'`(固定值) |
| 买入印花税 | float | `0.001` | 买入印花税比例（仅卖出收取, 但回测中对称配置） |
| 卖出印花税 | float | `0.001` | 卖出印花税比例 |
| 最低佣金 | float | `5.0` | 单笔最低佣金（元） |
| 买入佣金 | float | `0.0003` | 买入标的时的佣金比例 |
| 平昨佣金 | float | `0.0003` | 股票、期货平昨佣金比例 |
| 平今佣金 | float | `0.0003` | 期货平今佣金比例 |
| 最大成交比例 | float (0~1) | `0.3` | 单 bar 最大成交量不超过 `同期成交量 × 此值`；点击'?'了解详情 |
| 默认周期 | `'1d'` etc. | `'1d'` | 模型运行默认主图周期 |
| 默认品种 | symbol | (空) | 主图默认品种；不填则用模型编辑时手动选 |
| 复权方式 | enum | `'front_ratio'` | 见下表 |

### 复权方式

| 值 | 含义 |
|---|---|
| `none` | 不复权 |
| `front` | 向前复权（普通前复权） |
| `back` | 向后复权 |
| `front_ratio` | **等比前复权（回测推荐）** |
| `back_ratio` | 等比后复权 |

> 推荐 `front_ratio`：配股/增发不会造成价格异常波动；买卖价格统一标准，便于历史还原。

---

## Scenario-specific defaults

The defaults below ship with QMT itself, but scenario affects the **right choice** — different scenarios want different defaults.

### 回测（默认场景）

| 字段 | 默认 | 推荐 |
|---|---|---|
| 最大成交比例 | 0.3 | 个股策略可放到 0.5；板块策略保留 0.3 |
| 滑点 | 0.0 | 高频策略改 0.001–0.005 |
| 手续费类型 | amount | 期货 / 期权改 fixed |
| 基准 | 沪深 300 | 视 universe: 沪深 300 / 中证 500 / 中证 1000 / 行业指数 |
| 复权 | front_ratio | front_ratio |
| 印花税 | 0.001（A 股） | 0.001 |

### 模拟信号（不真下单, 仅记录信号）

- 走 模型交易界面 → 模拟, 回测参数意义不大, 但 **initial capital** 仍用于 PnL 计算
- **把 backtest 当解释工具** — same defaults as 回测

### 实盘交易

- **回测参数 is irrelevant** in the strict sense (you're live). But QMT requires filling the panel anyway for 模型交易 上架.
- **商品端冻结**: 期货 / 期权 → 启用 固定值手续费 + 平今/平昨分设
- **股票端**: 印花税 卖出 = 0.001, 买入 = 0
- **最大成交比例**: 在回测阶段就该确认; 实盘以柜台限制为准（如科创板单笔 ≤ 10万股）

---

## The "everything filled" self-check

Before emitting the backtest config, every field of this checklist must have a value or an explicit default:

```
[ ] 开始时间 ____  [ ] 结束时间 ____
[ ] 基准 ____      [ ] 初始资金 ____
[ ] 复权方式 ____  [ ] 默认周期 ____
[ ] 最大成交比例 __
[ ] 滑点 ____      [ ] 手续费类型 ____
[ ] 买入佣金 ____  [ ] 卖出印花税 ____
[ ] 最低佣金 ____
[ ] (期货/期权) 保证金比例 ____ / 平昨佣金 ____ / 平今佣金 ____
```

If any field is "?", block on the user or call out the omission explicitly. Half-filled backtest config is the single most common cause of "my backtest looks different from the broker's".

---

## Code-side overrides (in `init`)

```python
def init(ContextInfo):
    ContextInfo.start = "2017-01-01 00:00:00"   # 起 — 覆盖面板
    ContextInfo.end   = "2020-01-01 00:00:00"   # 止 — 覆盖面板
    ContextInfo.capital = 10000000             # 初始资金 — 覆盖面板
```

> ⚠️ 三个字段都只在 init 设置生效, handlebar 中修改无效。
>
> ⚠️ 结束 ≤ 开始 → 计算范围为空，输出空绩效。

---

## Backtest result — interpretation sheet

When the user pastes a backtest result table:

| 指标 | 健康范围 | 红旗 |
|---|---|---|
| 年化收益率 | > 沪深 300 同期 1.5× | < 0 |
| 最大回撤 | < 15% | > 30%（仓位 / 止损问题） |
| 夏普比率 | > 1.5 | < 1（信号过密 / 成本吃掉 edge） |
| 信息比率 (IR) | > 0.5 | < 0.3（弱超额） |
| 胜率 | depends on 盈亏比 | 高胜率+低收益 = 砍掉亏损太快 |
| 跟踪误差 | 低 | 大量 rebalance / universe 散 |
| 年化波动率 | matches universe 性质 | 月度波动剧烈 = 没 风控 |

> 完整的"症状 → 原因 → 修法"表在 [`SKILL.md` §Result gate](../../bundled-skills/qmt-strategy/SKILL.md)。

---

## Known pitfalls that change the backtest

1. **没下载历史数据** → `[系统]ERROR: ****** 获取合约乘数和最小变动价位失败` → 右下角"行情 → 智能下载 → 过期合约列表"
2. **回测必须 副图模式运行**, 不要 主图 / 主图叠加 — 否则进场出场会异常
3. **股票 2% 价格笼子**: 实盘中超出价格笼子的单会被废单; 回测里要确认 price 是否在 bar 区间内
4. **数量超可用资金**: 回测撮合按可用数量部分成交; 实盘会废单 → 调小每笔金额或加可用资金检查
5. **基准的选择**: universe 是中小盘就跑中证 500 / 1000; 用沪深 300 跑小盘股会显著低估 IR
