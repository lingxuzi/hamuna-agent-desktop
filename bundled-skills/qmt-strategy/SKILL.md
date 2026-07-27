---
name: qmt-strategy
description: Writes, debugs, validates, and backtests 迅投 QMT (大QMT / miniQMT) strategies that run in the QMT editor's built-in Python 3.6 runtime. Use when the user asks to author / fix / optimize / explain / backtest a QMT strategy; when generating Python that uses `passorder`, `handlebar`, `ContextInfo`, `subscribe_quote`, `run_time`, `get_trade_detail_data`, `get_market_data_ex`, `get_full_tick`, or `set_basket`; when configuring QMT 回测参数 (period, capital, dividend, commission, benchmark, max-fill ratio); when interpreting QMT backtest output (年化、最大回撤、夏普、信息比率、胜率、跟踪误差); or when the user says "QMT策略", "在QMT跑", "回测一下", "大QMT", "miniQMT", "迅投QMT", "XtQuant", "XtQuantTrader", "passorder", "handlebar", "实盘策略", "模拟信号", "调试运行". Distinct from the native API (XtQuantTrader — external Python process, callback-based): use the qmt-nativeapi skill for that path. Reads `qmt/qmt_innerapi_builtin_python.md` as the canonical API surface; this skill decides the *workflow*, that document decides the *fact*.
author: HamunaAgent
version: 20260726
---

# qmt-strategy

Write and backtest strategies for 迅投 QMT's built-in Python 3.6 editor. Two surfaces this skill owns:

- **Strategy code** — the `init` + `handlebar` template plus `passorder` calls
- **Backtest** — the 回测参数 block, run, and result interpretation

The API surface is the **scenario** discipline (回测 / 调试 / 模拟 / 实盘). Once scenario is fixed, the right `passorder` flags, the right state-storage rule, and the right backtest config all fall out — almost every bug in QMT strategies is a missing scenario decision.

> **Single source of truth for the API**: [`qmt/qmt_innerapi_builtin_python.md`](../../qmt/qmt_innerapi_builtin_python.md). Read it for any function signature, constant, or pitfall. This skill decides the workflow, that document decides the fact.
>
> **Single source of truth for the alternative API (XtQuantTrader)**: [`specs/tech_docs/qmt_innerapi_guide.md`](../../specs/tech_docs/qmt_innerapi_guide.md). Use that path only when the user explicitly says they run from a separate `python.exe` process.

## The leading word: scenario

Every fork in a QMT strategy comes back to one question: **what scenario are we in?** The four scenarios:

| Scenario | Trigger | What it changes |
|---|---|---|
| **回测** | Editor → 回测 button | `passorder` synthesizes a fill against historical K-line; no broker; `quickTrade=0` standard |
| **调试运行** | Editor → 运行 button | Real-time ticks drive `handlebar`; no signals recorded; no broker |
| **模拟信号** | 模型交易 → 模拟 + 三角形运行 | `passorder` records signal but does **not** send to broker |
| **实盘交易** | 模型交易 → 实盘 + 三角形运行 | `passorder` sends to broker; signals recorded |

> ⚠️ 模拟 / 实盘 refer to **run mode**, not to the **account**. A real-broker account in 模拟 mode records signals only; a simulated-broker account in 实盘 mode would still try to "send" the (synthetic) order.

A strategy typically passes through several scenarios in this order: **回测 → 模拟信号 → 实盘交易**. Code written for one scenario is rarely portable to the next without `quickTrade` and state-handling changes — that's the #1 source of "works in backtest, breaks in live" bugs.

## The five steps

1. **Confirm scenario** — which scenario is the user in? (回测-only? 模拟-then-live? dual?) See [§Scenario gate](#scenario-gate).
2. **Lock the spec** — universe, frequency, indicators, signal-to-action mapping, account types, capital, period. See [§Spec gate](#spec-gate).
3. **Write the code** — emit the `init` + `handlebar` skeleton with scenario-correct discipline. See [§Code gate](#code-gate).
4. **Configure the backtest** — emit the 回测参数 block. See [§Backtest config gate](#backtest-config-gate).
5. **Interpret the result** — given a backtest output table, list concrete fixes. See [§Result gate](#result-gate).

Each step ends on a **completion criterion** the agent can check, not a vague feel.

### Scenario gate

- **What**: ask which scenario(s) the user wants to support. If they only say "backtest this", assume `回测-only`.
- **Why first**: every later step depends on it. Skipping this is the #1 reason strategies silently fail in 实盘.
- **Completion criterion**: scenario is named in the conversation. If multiple, list them in lifecycle order (e.g. `回测 → 模拟 → 实盘`).

### Spec gate

- **What**: pin down everything the backtest config and the code will need.
- **Lock these**:
  - 标的 universe (single stock / sector / index / 板块)
  - Frequency (日线 / 1m / 5m / tick)
  - Account type (`'STOCK' / 'CREDIT' / 'FUTURE' / 'FUTURE_OPTION' / 'STOCK_OPTION' / 'HUGANGTONG' / 'SHENGANGTONG'`)
  - Order type (23 买 / 24 卖 / 33 担保品买 / 27 融资买 / 0 期货开多 / 3 期货开空 / 50 期权开仓 / 60 ETF申购 / 35 一键买卖)
  - Entry / exit signals (indicator + threshold)
  - Position sizing rule (per-trade cash / per-trade volume / target-hold)
  - Backtest range (开始/结束时间)
  - Initial capital
  - Slippage, commission model
- **Completion criterion**: every cell of the backtest config block (see [references/backtest-config.md](references/backtest-config.md)) has a concrete value or an explicit default. No `<fill-in>`.

### Code gate

- **What**: emit Python 3.6 code that runs in QMT's editor.
- **Discipline checklist** (each item is a real failure mode):
  - First line: `#coding:gbk`
  - Indentation: pick one (`····` or `->`) and stick to it
  - Define both `init(ContextInfo)` and `handlebar(ContextInfo)` (handlebar is required even if empty)
  - `init` sets all state in plain globals (e.g. `class A(): pass`) — **never** put it in `ContextInfo` attrs that must persist across bars
  - **User-config block at top of file** — put `ACCOUNT_ID / ACCOUNT_TYPE / STOCK_CODE / LINE_FAST / LINE_SLOW / MAX_HOLD_BARS / START_DATE / END_DATE / INIT_CAPITAL` as module-level constants immediately after the imports so the user can edit without scrolling. `ACCOUNT_ID` and `ACCOUNT_TYPE` empty-by-default; in `init` resolve via `A.account = ACCOUNT_ID or account` (and similarly `accountType`) — same file works for **回测** (fill the constants) and **实盘/模拟** (leave empty, QMT injects via the model-trading interface). See [references/skeleton.md §1–§2](references/skeleton.md).
  - For 立即下单 (any of: `after_init` / `run_time` callback / `subscribe_quote` callback / non-last bar): `quickTrade=2`
  - For `handlebar` 逐 K 线生效: `quickTrade=0`. Add `if not C.is_last_bar(): return` gate at top of `handlebar` for 实盘 / 模拟 / 分钟线 / tick; for 日线回测 the gate is no-op (see §七 error 7)
  - Every `passorder` call passes a `m_strRemark` (length < 24) that the strategy can match back to its intent — required for state tracking and for tracking
  - State machine: a `waiting_dict` keyed by remark, with values = `m_nOrderStatus`; skip the stock when its status is still pending
  - 主图-dependent frequency pitfall: `handlebar` runs on **主图 tick** (3s for stocks, 0.5s for futures) — for 期货 strategies with a stock 主图, switch 主图 to a 期货 symbol or move work to `run_time` / `subscribe_quote`
  - For 两融 / 期货 / 期权, set `opType` correctly (23/24 for stock, 27/33/34 for 两融, 0/3/6 for 期货, 50/51 for 期权, 60/61 for ETF, 35 for 一键买卖)
  - Choose `prType` with awareness: `5` 最新价 (cheap, no 5 档 needed), `11` 限价 (specific price), `14` 对手价 (requires 五档 行情源), `42` 市价 (has 保护限价 on 沪市)
- **Completion criterion**: code is syntactically runnable in QMT Py3.6, scenario-correct on `quickTrade`, and remark tracking is present. Run the **discipline self-check** at the end of [references/skeleton.md](references/skeleton.md).

### Backtest config gate

- **What**: emit the 回测参数 block in the format QMT expects.
- **Required keys** (see [references/backtest-config.md](references/backtest-config.md) for the full schema):
  - 开始时间 / 结束时间 (`'%Y%m%d'` or `'%Y-%m-%d %H:%M:%S'`)
  - 基准 (default `'000300.SH'`)
  - 初始资金 (default 1,000,000)
  - 复权方式 (回测推荐 `'front_ratio'`)
  - 滑点 / 手续费类型 / 印花税 / 最低佣金
  - 最大成交比例 (cap single-bar fill vs同期成交量)
- **Completion criterion**: every key has a value or an explicit default. The user knows which keys they overrode.

### Result gate

- **What**: when the user pastes a backtest result table (年化 / 最大回撤 / 夏普 / 信息比率 / 胜率 / 跟踪误差), produce concrete fixes, not generic advice.
- **Pattern-matching table** (informs "where to look next"):

| Symptom | Likely cause | First fix |
|---|---|---|
| 年化高 but 最大回撤 > 30% | No 止损 / position sizing too aggressive | Add hard 止损 in `handlebar`; cap per-trade |
| 夏普 < 1 | 信号过密, 交易成本吃掉了 edge | 增加 signal 阈值; 调低 最大成交比例 |
| 信息比率 < 0.3 vs 基准 弱 | 信号对基准 alpha 弱 | 改用 中证 500 / 行业 基准; 或缩窄 universe |
| 胜率高 but 收益低 | 盈亏比 差; 砍掉亏损的快, 让盈利的跑 | 取消时间止损, 加移动止损 |
| 胜率低 but 收益高 | 反过来; 可能 噪声 大 | 加过滤器, 减小 frequency |
| 跟踪误差 大 | universe 散 / 频繁换仓 | 集中标的, 减 rebalance 频率 |
| 0 trades | `quickTrade=0` 但 `is_last_bar()` 没回 True; 或主图周期 < 1d 但 `quickTrade=0` 在 非最后分笔 调到了 | 加 `print` 调试; 改 `quickTrade=2` 验证信号确实生成 |

- **Completion criterion**: every listed symptom maps to ≥1 concrete code change. The user can act on the list without further questions.

## The 7 discipline errors (memorize these)

These are the failure modes that account for ~80% of "QMT strategy doesn't work":

1. **State in ContextInfo** → lost on bar change. Move to `class A(): pass` globals.
2. **Forgetting `quickTrade=2`** in `subscribe_quote` / `run_time` / `after_init` callbacks → signals silently dropped. Default `quickTrade=0` only fires on the **last tick of the bar**.
3. **Wrong `opType` for the account type** → broker rejects. 两融 = 27/33/34, 期货 = 0/3/6, 期权 = 50/51, ETF = 60/61, 组合 = 35.
4. **`m_strRemark` collision** (or longer than 24 chars) → can't track orders back to intent. Generate unique remark per intent.
5. **混用 innerApi and nativeApi** (e.g. calling `XtQuantTrader` from inside QMT editor's Py3.6) → ImportError. Inner runs in the editor, native runs from a separate `python.exe`.
6. **主图是股票 but 跑期货策略** → `handlebar` runs at 3s tick, not 0.5s. Switch 主图 to 期货 symbol, or move to `run_time`.
7. **No `is_last_bar()` gate** in `handlebar` for live-compatible code → strategy fires on every tick during the bar, not just at bar close; `passorder(quickTrade=0)` calls on non-last ticks are silently dropped.
   - **实盘 / 模拟 / 分钟线 / tick 场景**: gate **必须**有 (`if not C.is_last_bar(): return` 在 handlebar 顶部)
   - **回测 (日线) 场景**: gate 总是 True (no-op), 可省但**必须**有注释说明 (`# 日线回测时 is_last_bar 永远 True, 无需闸; 升级到实盘再补`). 加了 gate 不算错, 浪费一行; **删了 gate 不算错, 漏了注释才是错.**

## Branching

The skill has three main branches — different paths through these steps:

- **回测-only** — the user only wants backtest. Steps 1, 2, 3 (with `quickTrade=0`), 4, 5. Skip live mode.
- **模拟信号 → 实盘** — strategy going live. Steps 1, 2, 3 (with `quickTrade=2` and `m_strRemark` state machine), 4 (only for sanity check), 5.
- **Existing strategy fix** — user pastes broken code. Step 1, then jump to [§Code gate](#code-gate) and run the discipline self-check, then fix. Backtest interpretation is the user's, not ours.

## Reference files

- [`references/skeleton.md`](references/skeleton.md) — ready-to-copy `init` + `handlebar` templates, `passorder` constants, discipline self-check
- [`references/backtest-config.md`](references/backtest-config.md) — full 回测参数 block schema, scenario-specific defaults
- [`references/qmt_innerapi_builtin_python.md`](references/qmt_innerapi_builtin_python.md) — canonical API surface (read this for any function or constant)
