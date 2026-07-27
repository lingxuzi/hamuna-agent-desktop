# QMT Strategy Skeleton — Code Templates & Constants

Ready-to-copy templates and constant tables for QMT strategy code. All facts verified against [`qmt/qmt_innerapi_builtin_python.md`](../../qmt/qmt_innerapi_builtin_python.md); this file is a **disclosed reference** loaded on demand, not a duplicated source of truth.

---

## 1. Recommended template — `MODE` toggle (回测 / 实盘)

```python
#coding:gbk
"""
Dual-MA strategy on 600000.SH.
MODE switch: 改 MODE 即可回测 / 实盘切换.
  - 'backtest': 设 C.start/end/capital, 不下实单, quickTrade=0
  - 'live':     不设 start/end/capital, 走柜台, quickTrade=2

升级到 'live' 仍需补:
  1. handlebar 顶部 `if not C.is_last_bar(): return` 闸 (分钟线时)
  2. `subscribe_quote` / `run_time` 行情驱动 (若需 tick 级信号)
  3. `m_strRemark` 状态机 (waiting_dict, 防超单)
  4. `order_callback` / `deal_callback` 监听回报
"""

import numpy as np


# === 用户配置 — 改这里 ================================================
MODE = 'backtest'                       # 'backtest' | 'live'
ACCOUNT_ID = 'testS'                   # 回测: 任意字符串; 实盘: '' 用界面账号
ACCOUNT_TYPE = 'STOCK'                 # 实盘: '' 用界面账号类型
STOCK_CODE = '600000.SH'               # 标的
LINE_FAST = 5                          # 快线周期
LINE_SLOW = 20                         # 慢线周期
MAX_HOLD_BARS = 10                     # 最大持仓 bars
START_DATE = "2020-01-01 00:00:00"     # 仅回测生效
END_DATE   = "2024-12-31 00:00:00"     # 仅回测生效
INIT_CAPITAL = 1000000                 # 仅回测生效
# =====================================================================


class A:
    """Runtime state — never on ContextInfo attrs (those deep-copy per bar)."""
    pass


A.line1         = LINE_FAST
A.line2         = LINE_SLOW
A.max_hold_bars = MAX_HOLD_BARS
A.bars_held     = 0
A.is_backtest   = (MODE == 'backtest')   # 模式旗标
A.quick_trade   = 0 if A.is_backtest else 2   # 0=回测, 2=实盘


def init(C):
    A.stock = C.stockcode + '.' + C.market   # 也可用 STOCK_CODE 锁死

    # 优先用户配置;空则用 QMT 模型交易界面注入的 globals (account / accountType)
    A.account     = ACCOUNT_ID   if ACCOUNT_ID   else account
    A.accountType = ACCOUNT_TYPE if ACCOUNT_TYPE else accountType

    A.bars_held = 0

    # 仅回测: 覆盖面板同名字段; 实盘跳过, 免污染下次回测
    if A.is_backtest:
        C.start   = START_DATE
        C.end     = END_DATE
        C.capital = INIT_CAPITAL

    # 'live' 升级时, 在这里补 subscribe_quote / run_time / waiting_dict init


def handlebar(C):
    # (无 is_last_bar() 闸 —
    #   回测 quickTrade=0 + 日线 = no-op;
    #   实盘 quickTrade=2 = 系统不丢单;
    #   仅分钟线 / tick 实盘需加回)

    # 1. 取最近 max(line1,line2)+1 根日线收盘价
    bar_date = timetag_to_datetime(C.get_bar_timetag(C.barpos), '%Y%m%d')
    data = C.get_market_data_ex(
        ['close'], [A.stock],
        end_time=bar_date, period='1d',
        subscribe=False,                        # 日线 = 本地 bar 即可, 不订阅
        count=max(A.line1, A.line2) + 1,
    )
    closes = data[A.stock]['close'].values
    if len(closes) < max(A.line1, A.line2) + 1:
        print(bar_date, '行情不足 跳过')
        return

    pre_fast = np.mean(closes[-A.line1 - 1: -1])
    pre_slow = np.mean(closes[-A.line2 - 1: -1])
    cur_fast = np.mean(closes[-A.line1:])
    cur_slow = np.mean(closes[-A.line2:])
    golden   = (pre_fast <= pre_slow) and (cur_fast > cur_slow)
    death    = (pre_fast >= pre_slow) and (cur_fast < cur_slow)

    # 2. 当前持仓
    holdings = get_trade_detail_data(A.account, A.accountType, 'position')
    holding_vol = 0
    for h in holdings:
        if h.m_strInstrumentID + '.' + h.m_strExchangeID == A.stock:
            holding_vol = int(h.m_nCanUseVolume)
            break

    # 3. 出场
    if holding_vol > 0:
        A.bars_held += 1
        if death or A.bars_held >= A.max_hold_bars:
            reason = 'D' if death else 'H'
            remark = f"{bar_date[4:]}_s_{reason}"      # MMDD_s_X → ≤24 chars
            passorder(24, 1101, A.account, A.stock, 5, -1, holding_vol,
                      'dual_ma', A.quick_trade, remark, C)
            A.bars_held = 0
            print(bar_date, '平仓', reason)
        return

    # 4. 入场
    if golden:
        account_obj = get_trade_detail_data(A.account, A.accountType, 'account')[0]
        available = int(account_obj.m_dAvailable)
        last_price = closes[-1]
        vol = int(available / last_price / 100) * 100          # 向下取整到 100 股
        if vol < 100:
            print(bar_date, '可用资金不足 跳过')
            return
        remark = f"{bar_date[4:]}_b_G"                          # MMDD_b_G (golden)
        passorder(23, 1101, A.account, A.stock, 5, -1, vol,
                  'dual_ma', A.quick_trade, remark, C)
        A.bars_held = 0
        print(bar_date, '开仓', vol, '股')

```

---

## 2. 实盘 / 模拟 + `run_time` / `subscribe_quote` 模板

> 与 §1 共用同一份 user-config 块;**留空 `ACCOUNT_ID = ''` 与 `ACCOUNT_TYPE = ''`**, QMT 自动用模型交易界面所选账号。

```python
#coding:gbk
"""
实盘/模拟盘模板:
  - ACCOUNT_ID / ACCOUNT_TYPE 留空 → 模型交易界面选什么用什么
  - 所有回调内 passorder 必须 quickTrade=2
  - 用 m_strRemark 跟踪委托状态 (waiting_dict)
"""

import time, datetime


# === 用户配置 — 改这里 ================================================
# (复刻 §1 的常量块; 回测 ↔ 实盘切换只改 ACCOUNT_ID / ACCOUNT_TYPE)
ACCOUNT_ID = ''                       # ← 实盘: 留空
ACCOUNT_TYPE = ''                     # ← 实盘: 留空
STOCK_CODE = '600000.SH'
# =====================================================================


class A:
    pass


A.waiting_dict = {}                    # 投资备注 → m_nOrderStatus
A.withdraw_secs = 30                   # 超时撤单间隔 (秒)


def init(C):
    A.stock = C.stockcode + '.' + C.market
    A.account     = ACCOUNT_ID   if ACCOUNT_ID   else account
    A.accountType = ACCOUNT_TYPE if ACCOUNT_TYPE else accountType

    # 行情订阅 — 回调内 passorder 必须 quickTrade=2
    def on_quote(data):
        for s in data:
            last = data[s].get('lastPrice')
            # ... 行情驱动信号 ...
            # passorder(23, 1101, A.account, s, 5, -1, vol,
            #           'dual_ma', 2, remark, C)
            pass

    C.subscribe_quote(A.stock, period='1d', dividend_type='none',
                      result_type='dict', callback=on_quote)
    C.run_time("f", "1nSecond", "2019-10-14 13:20:00")


def f(C):
    # 定时器回调 — passorder 必须 quickTrade=2
    now = datetime.datetime.now()
    t = now.strftime('%H%M%S')
    if t < '093000' or t > '150000':
        return
    # ... 业务逻辑 ...
    # passorder(..., quickTrade=2, ..., C)

```
---

## 3. `passorder` 完整签名

```python
passorder(opType, orderType, account, symbol, prType, price,
          volume, [userOrderId], [quickTrade], [strRemark], ContextInfo)
```

| 参 | 必填 | 说明 |
|---|---|---|
| `opType` | ✔ | 委托类型 (见下表) |
| `orderType` | ✔ | 下单方式 (`1101` 数量 / `1102` 金额 / `2101` 组合数量 / `2102` 组合权重) |
| `account` | ✔ | 账号字符串（界面选时不用填） |
| `symbol` | ✔ | 迅投代码 `'600000.SH'` / `'rb2401.SF'` |
| `prType` | ✔ | 报价类型 (见下表) |
| `price` | ✔ | 价格；`prType=5` 时传 `-1` 或 `0`；`prType=42` 沪市保护限价, `0`=自动填涨跌停价 |
| `volume` | ✔ | 数量（股票=股, 期货=手, 期权=张）；`orderType=1102` 时=金额元 |
| `userOrderId` | ✗ | 委托标识串, 长度 < 24 |
| `quickTrade` | ✗ | `0`(默认) / `1` / `2`（见 quickTrade 表） |
| `strRemark` | ✗ | 投资备注, 长度 < 24, 用于回溯委托 / 状态机 |
| `ContextInfo` | ✔ | 必传, `handlebar` 内就是入参 `C` |

### `opType` (委托类型)

| 值 | 含义 | 适用账号 |
|---|---|---|
| 0 | 期货开多 | FUTURE |
| 3 | 期货开空 | FUTURE |
| 6 | 期货四键平多（优先平今） | FUTURE |
| 23 | 股票买 | STOCK |
| 24 | 股票卖 | STOCK |
| 27 | 融资买入 | CREDIT |
| 32 | 直接还款 | CREDIT |
| 33 | 担保品买入 | CREDIT |
| 34 | 担保品卖出 | CREDIT |
| 35 | 一键买卖（组合 / 篮子） | STOCK |
| 50 | 期权开仓买 | STOCK_OPTION / FUTURE_OPTION |
| 51 | 期权平仓卖 | STOCK_OPTION / FUTURE_OPTION |
| 60 | ETF 申购 | STOCK |
| 61 | ETF 赎回 | STOCK |
| 75 | 专项直接还款 | CREDIT |

### `prType` (报价类型)

| 值 | 含义 | 备注 |
|---|---|---|
| 5 | 最新价 | 最常用；`price=-1` 即可 |
| 11 | 限价 | 必填具体价格 |
| 14 | 对手价 | **需行情源为五档**（`get_full_tick` 才能取到盘口） |
| 42 | 市价 | 沪市有保护限价；`price=0` 自动填涨跌停价 |

### `quickTrade`

| 值 | 行为 | 何时用 |
|---|---|---|
| `0`（默认） | 仅 K 线最后 tick 生效, 其他分笔信号丢弃 | `handlebar` 逐 K 线生效 |
| `1` | 最新 K 线时立即生效, 历史 K 线无效 | `handlebar` 盘中立即下单 |
| `2` | 任何调用立即生效, 不等待 | `run_time` / `subscribe_quote` / `after_init` 回调 |

### `accountType` 字符串

`'STOCK' / 'CREDIT' / 'FUTURE' / 'FUTURE_OPTION' / 'STOCK_OPTION' / 'HUGANGTONG' / 'SHENGANGTONG'`

### 委托状态码 (`m_nOrderStatus`)

| 值 | 含义 | 是否可撤 |
|---|---|---|
| 48 / 49 / 50 / 51 / 52 | 可撤 | ✔ |
| 53 | 部撤 | ✘ |
| 54 | 已撤 | ✘ |
| 55 | 待报 | ✔ |
| 56 | 已成 | ✘ |
| 57 | 废单 | ✘ |
| 86 / 255 | 可撤 | ✔ |

> 标准超时撤单白名单: `[48, 49, 50, 51, 52, 55, 86, 255]`

---

## 4. 投资备注 (m_strRemark) 状态机 — 标准模板

```python
A.waiting_dict = {}      # remark → m_nOrderStatus
A.all_order_ref_dict = {} # remark → 委托时间戳
A.withdraw_secs = 30     # 超时未成交则撤单重报

# 下单
remark = f"{now.strftime('%Y%m%d%H%M%S')}_{stock}_buy_{vol}股"
passorder(23, 1101, A.acct, stock, 14, -1, vol,
          'strategy_name', 2, remark, C)
A.waiting_dict[stock] = remark
A.all_order_ref_dict[remark] = time.time()

# 查委托, 更新状态
order_list = get_trade_detail_data(A.acct, A.acct_type, 'order')
ref_dict = {o.m_strRemark: int(o.m_nOrderStatus) for o in order_list}

# 查到了(56/53/54) → 从 waiting_dict 删除
del_list = []
for stock in A.waiting_dict:
    rmk = A.waiting_dict[stock]
    if rmk in ref_dict and ref_dict[rmk] in [56, 53, 54, 57]:
        del_list.append(stock)
for s in del_list:
    del A.waiting_dict[s]

# 下单判断时, 有 pending 的品种跳过
for stock in stocks:
    if stock in A.waiting_dict:
        print(f"{stock} 未查到成交, 暂停报单 {A.waiting_dict[stock]}")
        continue
```

---

## 5. 通用查询模板

```python
def to_dict(obj):
    """将 m_* 属性转字典"""
    return {a: getattr(obj, a) for a in dir(obj)
            if a[:2] == 'm_' and not a.startswith('m__')}

# 委托 / 成交 / 持仓 / 资金
orders = get_trade_detail_data(account, 'stock', 'order')
deals = get_trade_detail_data(account, 'stock', 'deal')
positions = get_trade_detail_data(account, 'stock', 'position')
accounts = get_trade_detail_data(account, 'stock', 'account')

# 单笔字段示例（订单）
# o.m_strInstrumentID, o.m_strExchangeID, o.m_strInstrumentName
# o.m_nOffsetFlag, o.m_nVolumeTotalOriginal, o.m_dTradedPrice
# o.m_nVolumeTraded, o.m_dTradeAmount
# o.m_strOrderSysID, o.m_strRemark, o.m_nOrderStatus
```

---

## 6. 交易回调（全局函数, 非 method）

```python
def order_callback(C, O):
    print('委托变化:', O.m_strRemark, O.m_strOrderSysID, O.m_nOrderStatus)

def deal_callback(C, D):
    print('成交回报:', D.m_strRemark, D.m_strOrderSysID, D.m_dPrice, D.m_nVolume)
```

---

## 7. 行情订阅 + 全推

```python
# 订阅（受订阅数限制, 默认 ~300, 超出返回前值填充）
num = C.subscribe_quote(stock, period='1d', dividend_type='none',
                        result_type='dict', callback=on_quote)
C.unsubscribe_quote(num)   # 释放

# 全推（无订阅上限, 50ms 更新, 无 5 档盘口除非行情源改五档）
full_tick = C.get_full_tick(['600000.SH', '000001.SZ'])
# full_tick[symbol]['lastPrice'] / 'lastClose' / 'open' / 'high' / 'low'
#                       / 'volume' / 'amount' / 'openInt' / 'bidPrice' / 'askPrice' ...

# 本地数据（回测用）
data = C.get_market_data_ex(['open', 'high', 'low', 'close'],
                            [stock], period='1d', subscribe=False,
                            count=100)
```

### `period` 取值

`'1d' / '1m' / '3m' / '5m' / '15m' / '30m' / '1h' / '2h' / '1w' / '1mon' / '1q' / '1hy' / '1y' / 'tick'`

### `dividend_type` 取值

`'none' / 'front' / 'back' / 'front_ratio' / 'back_ratio'`

> 回测推荐 `'front_ratio'`（等比前复权）

---

## 8. 调度器

```python
import datetime as dt

# 定时器
tid = ContextInfo.schedule_run(
    on_timer,
    '20231231235959',          # 起始时间（历史时间 → 一次间隔后开始）
    3,                          # 触发次数
    dt.timedelta(seconds=60),   # 间隔
    'my_timer'                  # 任务组名（用于取消）
)
# ContextInfo.cancel_schedule_run('my_timer')
```

---

## 9. 篮子 / 组合

```python
basket = {
    'name': 'basket1',
    'stocks': [
        {'stock': '600000.SH', 'weight': 0.11, 'quantity': 100, 'optType': 23},
        {'stock': '600028.SH', 'weight': 0.11, 'quantity': 200, 'optType': 24},
    ]
}
set_basket(basket)

# 按数量下单 (orderType=2101, volume=篮子份数)
passorder(35, 2101, account, 'basket1', 5, 1, 2, '', 2, 'remark', C)
# 按权重下单 (orderType=2102, volume=总额元)
passorder(35, 2102, account, 'basket2', 5, 1, 10000, '', 2, 'remark', C)
```

---

## 10. ContextInfo 属性表

| 属性 | 读 / 写 | 含义 |
|---|---|---|
| `start` / `end` | **写** (仅 init) | 回测起止, `'%Y-%m-%d %H:%M:%S'` |
| `capital` | **写** (仅 init) | 回测初始资金 |
| `period` | 只读 | `'1d'` / `'1m'` / ... |
| `barpos` | 只读 | 当前 K 线索引（从 0） |
| `time_tick_size` | 只读 | 当前图 K 线数 |
| `stockcode` | 只读 | 主图代码（如 `'000300'`） |
| `market` | 只读 | 主图市场（如 `'SH'`） |
| `dividend_type` | 只读 | 主图复权方式 |
| `benchmark` | 只读 (回测) | 回测基准 |
| `do_back_test` | 只读 | 是否回测模式 |
| `is_last_bar()` | 方法 | 是否最新 K 线 |

> ⚠️ `start / end` 与"回测参数面板"同时设置时, **以代码值为准**；`end ≤ start` → 计算范围为空。

---

## 11. Code-discipline self-check (in 11 questions)

Before delivering the code to the user, run this checklist:

1. ☐ File starts with `#coding:gbk`?
2. ☐ Indentation consistent (`····` xor `->`)?
3. ☐ Both `init` and `handlebar` defined?
4. ☐ Runtime state in `class A(): pass` globals, **not** in `ContextInfo` attrs (except for回测 init-only settings like `start/capital`)?
5. ☐ Every `passorder` has `quickTrade=2` if called from `after_init` / `run_time` / `subscribe_quote` / `non-last bar`?
6. ☐ `is_last_bar()` gate in `handlebar` — scenario-aware:
   - **回测 (日线)**: gate 总是 True (no-op), 可删但**必须有注释说明**
   - **实盘 / 模拟 / 分钟线 / tick**: gate **必须**有, 否则非最后 tick 的 `passorder` 被系统静默丢弃
7. ☐ Every `passorder` has a `m_strRemark` (length < 24) that uniquely identifies the intent?
8. ☐ `opType` matches the account type (e.g. `opType=23/24` for STOCK, `27/33/34` for CREDIT, `0/3/6` for FUTURE, `50/51` for STOCK_OPTION, `60/61` for ETF)?
9. ☐ For 期货 strategy with a stock 主图: 主图 switched to 期货 symbol, OR work moved to `run_time` / `subscribe_quote`?
10. ☐ For `prType=14` or `get_full_tick` 5 档: 行情源 confirmed as 五档 level?
11. ☐ **User-config block at top of file?** `ACCOUNT_ID / ACCOUNT_TYPE / STOCK_CODE / LINE_FAST / LINE_SLOW / MAX_HOLD_BARS / START_DATE / END_DATE / INIT_CAPITAL` declared as module-level constants right after the imports (not buried inside `init`), and `ACCOUNT_ID / ACCOUNT_TYPE` resolved via `A.account = ACCOUNT_ID or account` fallback in `init`?

If any ☐ is unchecked, the strategy will have a known failure mode. Fix before delivery.
