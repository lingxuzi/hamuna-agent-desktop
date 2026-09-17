# QMT 策略编码规范（innerApi / 内置 Python 编辑器）

> 本文档是迅投 QMT **内置 Python 编辑器策略**（`init` / `handlebar` / `passorder` 体系）的完整编码规范。
> 它把 `docs/QMT_INNERAPI.md`（dict.thinktrader.net `/innerApi/` 文档集转储，11227 行）提炼成可直接照做的规则；多标的回测细节见 `docs/QMT多标的.md`。
>
> **本规范只覆盖 innerApi（编辑器内置 Py3.6）**。另一套链路 XtQuantTrader / `xtquant`（外部 python.exe 进程）函数与回调机制完全不同，不可混用（详见 §1）。
>
> 速查版见 `docs/QMT_字段速查.md`（字段）、`docs/QMT_innerApi_vs_RWAPI.md`（innerApi vs 容维）。

---

## 1. 术语澄清：innerApi vs nativeApi（`xtquant`）

| 维度 | innerApi（本文） | nativeApi / `xtquant` |
|---|---|---|
| 运行位置 | QMT 编辑器内 Py3.6 | 外部 python.exe 进程 |
| 主入口 | `passorder(...)` | `XtQuantTrader.connect()` |
| K 线驱动 | `handlebar(C)` 必填 | 自写 `run_forever()` |
| 数据 | `C.get_market_data_ex` / `get_full_tick` | `xtdata.get_market_data*` |
| Python 版本 | 3.6（固定） | 3.6 / 3.11 / 3.12 / 3.13 |

**判断标准**：策略在 QMT 客户端里点「运行 / 回测」→ innerApi；策略在 `python.exe` 里 `from xtquant.xttrader import XtQuantTrader` → nativeApi。

> 来源：`docs/QMT_INNERAPI.md` §一 概述、§二 使用须知。

---

## 2. 运行机制 / 运行模式 / quickTrade

### 三种运行机制（决定策略怎么被触发）

| 机制 | 函数 | 触发节奏 | 匹配需求 |
|---|---|---|---|
| 逐 K 线驱动 | `handlebar(C)` | 历史 K 线每根一次 + 盘中主图 tick 驱动 | 在实盘模拟逐 K 线效果 |
| 事件驱动 | `C.subscribe_quote(stock, period, callback=...)` | 订阅品种 tick 到达 | 盘中随分笔行情判断交易 |
| 定时任务 | `C.run_time("f", "1nSecond", "2019-10-14 13:20:00")` | 固定间隔 | 盘中固定时间间隔判断交易 |

### 四种运行模式

| 模式 | 入口 | `passorder` 行为 |
|---|---|---|
| 调试运行模式 | 编辑器点「运行」 | 实时行情运算，**不记录交易信号** |
| 回测模式 | 编辑器点「回测」 | 按回测参数撮合历史行情，记录交易 |
| 模拟信号模式 | 模型交易界面选「模拟」+ 运行 | **不真下单**，仅记录信号到「策略信号」栏 |
| 实盘交易模式 | 模型交易界面选「实盘」+ 运行 | **真下单** + 记录信号 |

> 「模拟 / 实盘」是运行模式，与「账号是实盘 / 模拟」无关。模拟柜台账号需另申请。
> 来源：`docs/QMT_INNERAPI.md` §二 使用须知、§四 变量约定 mode、§三 界面操作「回测、运行两种模式的区别」。

### `quickTrade` 参数（`passorder` 第 9 参）

| 值 | 行为 | 何时用 |
|---|---|---|
| `0`（默认） | 只在 K 线**结束分笔**时产生有效信号 | `handlebar` 逐 K 线生效 |
| `1` | 当前 K 线为**最新 K 线**时才有效，历史 K 线无效 | `handlebar` 盘中立即下单 |
| `2` | 任何情况下调用都有效，不丢信号 | `run_time` / `subscribe` 回调 / `after_init` 内下单 |

> **关键**：定时器、`subscribe` 回调、`after_init` 中调用 `passorder` 必须传 `2`，否则信号会被系统丢弃。
> 常规建议：K 线结束下单传 `0`，盘中立即下单传 `1`，**不推荐常驻 `2`**（会闪烁）。
> 来源：`docs/QMT_INNERAPI.md` §十四 常见问题「快速交易参数 quickTrade」「QMT 下单失败」。

---

## 3. `ContextInfo` 逐 K 线保存机制（必读）

**机制**：`ContextInfo` 每次 `handlebar` 调用前深拷贝一次，**bar 结束时才把修改保存**。盘中主图每个分笔到达会触发 `handlebar`，但只有 K 线结束时最后一个分笔的修改生效；其余分笔的修改被回滚。

**影响**：
1. `ContextInfo` 存数据每次分笔都深拷贝，拖慢策略 → 高频数据不要塞 `ContextInfo`
2. `ContextInfo` 适合记录**逐 K 线生效**的信号（`quickTrade=0`），不适合立刻下单
3. `quickTrade=2` 立即下单时，委托状态必须用**普通全局变量**保存（典型 `class A(): pass` 实例），**不能**放 `ContextInfo` 属性

> 来源：`docs/QMT_INNERAPI.md` §十四 常见问题「系统对象 ContextInfo 逐 k 线保存的机制」、§六 系统函数 init。

---

## 4. `passorder` 完整签名与常量

```python
passorder(opType, orderType, accountid, orderCode, prType, price, volume,
          strategyName, quickTrade, userOrderId, ContextInfo)
```

参数位（QMT_INNERAPI.md §八）：
| 位 | 参数 | 说明 |
|---|---|---|
| 1 | `opType` | 操作号（交易类型），见下 |
| 2 | `orderType` | 下单方式：`1101` 按数量 / `1102` 按金额 / `2101` 组合按股票数量 / `2102` 组合按权重 |
| 3 | `accountid` | 资金账号；编辑器界面运行需手动赋值，模型交易界面自动注入 |
| 4 | `orderCode` | 品种代码（`000001.SZ` / `rb2405.SF`）或篮子名 |
| 5 | `prType` | 报价类型，见下 |
| 6 | `price` | 价格（最新价 `-1`，限价填具体价） |
| 7 | `volume` | 下单量（股 / 张 / 手） |
| 8 | `strategyName` | 策略名称 |
| 9 | `quickTrade` | 0 / 1 / 2，见 §2 |
| 10 | `userOrderId` | **投资备注承载位**（`m_strRemark`），< 24 字符 |
| 11 | `ContextInfo` | 策略上下文 |

### `opType` 委托类型（精选）

| 值 | 含义 | 示例 |
|---|---|---|
| 0 / 3 | 期货开多 / 开空 | `passorder(0, 1101, acc, 'rb2405.SF', 5, -1, 10, '名', 1, '备注', C)` |
| 6 / 7 | 期货四键平多 / 平空（优先平今） | |
| 23 / 24 | 股票买 / 卖 | `passorder(23, 1101, acc, '000001.SZ', 5, 0, 100, '名', 1, '备注', C)` |
| 25 / 26 | 组合买 / 组合卖 | |
| 27 / 28 | 融资买入 / 融券卖出（两融） | |
| 29 / 31 | 买券还券 / 卖券还款（两融） | |
| 33 / 34 | 担保品买 / 担保品卖（两融） | |
| 35 | 一键买卖（组合 / 篮子） | `passorder(35, 2101, acc, 'basket1', 5, -1, 2, '名', 2, '备注', C)` |
| 36 | 信用账号一键买卖 | |
| 50 / 51 / 52 / 53 | 期权开仓买 / 平仓卖 / 开仓卖 / 平仓买 | |
| 60 / 61 | ETF 申购 / 赎回 | |
| 75 | 专项直接还款（两融） | |

> 完整表见 `docs/QMT_INNERAPI.md` §十二 枚举常量 opType（期货六键/四键/两键、股票/ETF/可转债买卖、融资融券、组合、ETF期权、ETF申赎、专项两融、可转债转股/回售）。

### `prType` 报价类型

| 值 | 含义 | 备注 |
|---|---|---|
| 5 | 最新价 | 最常用；`price` 填 `-1` |
| 11 | 限价 | 必填具体价格 |
| 14 | 对手价 | **需行情源为五档**，否则报「对手价无效」 |
| 42 | 市价 | 沪市有保护限价，`price=0` 自动填涨跌停价 |

### `accountType`（字符串）

`'STOCK' / 'CREDIT' / 'FUTURE' / 'FUTURE_OPTION' / 'STOCK_OPTION' / 'HUGANGTONG' / 'SHENGANGTONG'`

### 委托状态码（`m_nOrderStatus`）

| 值 | 含义 |
|---|---|
| 48 / 49 / 50 / 51 / 52 | 可撤 |
| 53 | 部撤 |
| 54 | 已撤 |
| 55 | 待报 |
| 56 | 已成 |
| 57 | 废单 |
| 86 / 255 | 可撤（超时撤单监控白名单） |

> 来源：`docs/QMT_INNERAPI.md` §八 passorder、§十二 枚举常量、§十三 完整示例「调整至目标持仓」。

---

## 5. symbol 代码约定

**格式**：`交易标的代码.交易所代码`，如 `000001.SZ`（不区分大小写，期货除外）。

| 交易所 | 简称 | 示例 |
|---|---|---|
| 上海 / 深圳 / 北京 | SH / SZ / BJ | `600000.SH` / `000001.SZ` / `830779.BJ` |
| 香港 / 沪港通 / 深港通 | HK / HGT / SGT | |
| 中金所 | IF | `IC2311.IF` |
| 上期所 | SF | `rb2405.SF` |
| 大商所 | DF | `m2311.DF` |
| 郑商所 | ZF | `FG305.ZF` |
| 上能源 | INE | `sc2311.INE` |
| 广期所 | GF | `lc2405.GF` |
| 上证期权 / 深证期权 | SHO / SZO | `10005334.SHO` |
| 板块指数 | BKZS | `290001.BKZS` |

> ⚠️ **期货 symbol 严格区分大小写**：`AP401.ZF` 不能写成 `ap401.ZF`，`rb2401.SF` 不能写成 `RB2401.SF`。
> ⚠️ **期货主连 / 加权合约仅回测模式可用**：`rb00.SF`（主连，未平滑）、`rbJQ00.SF`（加权，更平滑）。

来源：`docs/QMT_INNERAPI.md` §四 变量约定 symbol_code。

---

## 6. 行情三态 + 取数函数

### 行情数据三种来源

| 类型 | 接口 | 特点 |
|---|---|---|
| 本地数据 | `get_market_data_ex(subscribe=False)` | 回测用；需先用 `download_history_data` 或界面「数据管理」补历史 |
| 全推数据 | `get_full_tick` / `subscribe_whole_quote` | 客户端启动后自动增量推送，50ms 更新；**无订阅上限、无历史、无 5 档**（除非行情源改五档） |
| 订阅 | `subscribe_quote` + `get_market_data_ex(subscribe=True)` | 4 种基础周期（分笔 / 1m / 5m / 1d），有最大订阅数（默认 ~300，多周期累加计数）；**超出返回前值填充** |

### 取数函数对比

| 函数 | 用途 | 备注 |
|---|---|---|
| `download_history_data(stock, period, start, end, incrementally)` | 下载指定区间到本地 | 增量下载时 `startTime` 留空 |
| `get_market_data_ex(subscribe=False)` | 取本地数据 | 回测推荐；多标的时各标的 DataFrame 维度相同、索引相同 |
| `get_full_tick(stock_list)` | 取全推最新值 | 50ms；无历史、无 5 档（除非行情源改五档） |
| `subscribe_quote(stock, period, callback)` | 订阅行情 | 4 种基础周期；超限订阅不更新；Lv1 / Lv2 互不影响计数 |
| `unsubscribe_quote(订阅号)` | 反订阅 | 释放槽位 |
| `get_market_data_ex(subscribe=True)` | 取订阅 / 本地 | 自动订阅但无订阅号 → 停策略释放 |
| `get_local_data` | 取本地数据 | 盘中不更新；**不推荐**（用 `subscribe=False` 替代） |

> ⚠️ **不建议** `set_universe / get_history_data / get_market_data`（早期订阅股票池，无法反订阅）。
> ⚠️ `get_full_tick` **不能用于回测**（只能取最新分笔，无历史）。
> ⚠️ 订阅数超限返回的数据**用前值填充**。

### 行情中心 vs 交易中心

- **行情中心**控制单支订阅（`subscribe_quote`）
- **交易中心**影响全推数据（`get_full_tick` / `subscribe_whole_quote`）
- 对手价（`prType=14`）无效、全推无 5 档 → 把**全推行情**级别改成五档

来源：`docs/QMT_INNERAPI.md` §七 行情函数、§十四 常见问题。

---

## 7. `get_market_data_ex` 完整签名（多标的核心）

```python
ContextInfo.get_market_data_ex(
    fields=[],            # 数据字段 list，如 ['close','open']
    stock_code=[],        # 合约代码 list，如 ['000001.SZ','600519.SH']
    period='follow',      # 'tick' | '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w' | ...
    start_time='',        # %Y%m%d 或 %Y%m%d%H%M%S，空=最早
    end_time='',          # 同上，空=最新
    count=-1,             # 数据个数
    dividend_type='follow', # 'none' | 'front' | 'back' | 'front_ratio' | 'back_ratio'
    fill_data=True,
    subscribe=True)       # False=只读本地（回测用）
```

**返回值**：`dict { stock_code: pd.DataFrame }`，DataFrame 的 index 为 `time`，columns 为 `fields`；**各标的 DataFrame 维度相同、索引相同**。

**field 字段**（Bar）：`time / open / high / low / close / volume / amount / settle / openInterest / preClose / suspendFlag`
**tick 字段**：`time / lastPrice / lastClose / open / high / low / close / volume / amount / settle / openInterest / stockStatus`

> 来源：`docs/QMT_INNERAPI.md` §七 行情函数 get_market_data_ex。

### 周期 / 复权约定

- 基础周期：`tick / 1m / 5m / 1d`（实际存储）；其他为合成周期（3m 由 1m 合成；15m/30m/1h/2h 由 5m 合成；2d/1w/1mon/1q/1hy/1y 由 1d 合成）
- 取合成周期历史数据，需要下载**对应基础周期**（取 15m 需下 5m；同时用 5m 和 15m 只需下 5m）
- **回测推荐 `front_ratio`（等比前复权）**——配股 / 增发不会造成价格异常
- 取 2h 数据 → 先下 5m 数据

来源：`docs/QMT_INNERAPI.md` §七 download_history_data、§十四「QMT 在回测时如何选择复权方式」。

---

## 7.5 数据结构全集（`docs/QMT_INNERAPI.md` §五）

> 三类对象：**数据类**（`get_market_data_ex` / `get_full_tick` / `subscribe_quote` 回调返回）+ **交易类**（`get_trade_detail_data` / 交易回调返回，字段前缀 `m_`）。编码查字段先看本节，不用翻原文。

### 数据类

#### Bar（K 线，`get_market_data_ex` 的 field 名）

| 字段 | 类型 | 含义 |
|---|---|---|
| `time` | int | 时间戳 |
| `open` / `high` / `low` / `close` | float | OHLC |
| `volume` | float | 成交量（手） |
| `amount` | float | 成交额 |
| `settelementPrice` | float | 今结算 |
| `openInterest` | float | 持仓量（股票为状态） |
| `preClose` | float | 前收盘价 |
| `suspendFlag` | int | 停牌：1 停牌 / 0 不停牌 |

#### Tick（`get_full_tick` / `subscribe_quote` 回调 / `get_market_data_ex(period='tick')`）

| 字段 | 类型 | 含义 |
|---|---|---|
| `time` | int | 时间戳 |
| `stime` | string | 时间戳字符串 |
| `lastPrice` | float | 最新价 |
| `open` / `high` / `low` | float | 盘口开 / 高 / 低 |
| `lastClose` | float | 前收盘价 |
| `amount` | float | 成交总额 |
| `volume` | int | 成交总量（手） |
| `pvolume` | int | 原始量（股，未股手转换）【不推荐】 |
| `stockStatus` | int | 证券状态（同 openInt） |
| `openInt` | int | 股票=状态码 / 非股票=持仓量 |
| `transactionNum` | float | 成交笔数 |
| `lastSettlementPrice` / `settlementPrice` | float | 昨 / 今结算 |
| `askPrice` / `askVol` / `bidPrice` / `bidVol` | list | 多档委卖 / 委买价量 |

> 旧 `get_market_data` 变体另含 `timetag` / `pe`（股票=市盈率，ETF=iopv）；`get_market_data` 不推荐（§6）。

#### Level2（需 L2 行情源）

| 对象 | 核心字段 |
|---|---|
| `l2quote` | = Tick 结构（快照） |
| `l2quoteaux` | `avgBidPrice`/`avgOffPrice` 委买委卖均价、`totalBid/OffQuantity` 总量、`withdrawBid/OffQuantity` 买入/卖出撤单量 |
| `l2order`（逐笔委托） | `price`/`volume`/`entrustNo`/`entrustType`/`entrustDirection`（**0 未知 / 1 买入 / 2 卖出 / 3 撤买 / 4 撤卖**，上交所撤单在方向里） |
| `l2transaction`（逐笔成交） | `price`/`volume`/`amount`/`tradeIndex`/`buyNo`/`sellNo`/`tradeType`/`tradeFlag`（**0 未知 / 1 外盘主买 / 2 内盘主卖 / 3 撤单**） |
| `l2transactioncount` | 大单统计：`ddx`/`ddy`/`ddz` + `bid/off/unactiveBid/netInflow` × `most/big/medium/small` × `Amount/Volume` + `*Dx` 增量（L1 数据 `netInflow*` 返回 0） |
| `l2orderqueue` | 委买委卖队列（原文档未展开字段表） |

### 交易类（`get_trade_detail_data` / 回调对象）

> 方向常量（EEntrustBS）：股票买卖**恒 48（买）/ 49（卖）**；开平看 `m_nOffsetFlag`（EOffset：48 开/买、49 平/卖、51 平今、52 平昨）。

**Account**（资金）：`m_dBalance` 总资产 / `m_dAssureAsset` 净资产 / `m_dInstrumentValue` 总市值 / `m_dStockValue`·`m_dLoanValue`·`m_dFundValue` 股票·债券·基金市值 / `m_dAvailable` 可用金额 / `m_dFetchBalance` 可取金额 / `m_dFrozenCash`·`m_dFrozenMargin`·`m_dFrozenCommission` 冻结 / `m_dPositionProfit` 持仓盈亏 / `m_dRisk` 风险度 / `m_strTradingDate` 交易日

**Order**（委托，防超单 / 撤单状态机核心，§11）：`m_strInstrumentID` 证券代码 / `m_nDirection` 买卖 / `m_nOffsetFlag` 开平 / `m_dLimitPrice` 委托价 / `m_nVolumeTotalOriginal` 委托数量 / `m_nVolumeTraded` 已成 / `m_nVolumeTotal` 剩余 / `m_nOrderStatus` 状态（§4）/ `m_strOrderSysID` 合同编号（撤单用）/ `m_dTradedPrice` 成交均价 / `m_strRemark` **投资备注** / `m_nTaskId` 任务号

**Deal**（成交）：`m_strInstrumentID` / `m_nDirection` / `m_nOffsetFlag` / `m_dPrice` 成交均价 / `m_nVolume` / `m_dTradeAmount` / `m_strOrderSysID` / `m_strTradeID` / `m_strRemark`

**Position**（持仓）：`m_strInstrumentID` / `m_nVolume` 持仓量 / `m_nCanUseVolume` **可用数量（可卖）** / `m_nOnRoadVolume` 在途 / `m_nYesterdayVolume` 昨仓 / `m_nFrozenVolume` 冻结 / `m_dOpenPrice` 持仓成本（=(总买−总卖)/剩余数）/ `m_dMarketValue` 市值 / `m_dPositionCost`·`m_dPositionProfit` 成本·盈亏（股票不适用）/ `m_dFloatProfit` 浮动盈亏 / `m_dProfitRate` 盈亏比例 / `m_dLastPrice` 最新价

**PositionStatistics**（期货统计）：`m_nPosition` / `m_nYestodayPosition` / `m_nTodayPosition` / `m_nCanCloseVol` 可平 / `m_dAvgPrice` 均价 / `m_dPositionProfit`

> `CCreditAccountDetail` = Account 的两融扩展（`m_nBrokerType`：1 期货 / 2 股票 / 3 信用 / 5 期货期权 / 6 股票期权 / 7 沪港通 / 11 深港通）。
> **转字典**：`{a: getattr(obj, a) for a in dir(obj) if a[:2] == 'm_'}`（§8）。
> 完整 40+ Account 字段（期权 / 黄金 / 港股通专用）与 Order/Deal/Position 全字段见 `docs/QMT_INNERAPI.md` §五。

---

## 8. 交易查询与回调

### `get_trade_detail_data`

```python
get_trade_detail_data(accountID, strAccountType, strDatatype[, strategyName])
# strDatatype: 'ACCOUNT' | 'POSITION' | 'ORDER' | 'DEAL' | 'POSITION_STATISTICS' | ...
```

返回对象字段前缀 `m_`：

**委托（`order`）**：`m_strInstrumentID / m_strExchangeID / m_nOffsetFlag / m_nVolumeTotalOriginal / m_dTradedPrice / m_nVolumeTraded / m_dTradeAmount / m_strOrderSysID / m_strRemark / m_nOrderStatus`
**成交（`deal`）**：`m_strInstrumentID / m_nOffsetFlag / m_dPrice / m_nVolume / m_dTradeAmount / m_strRemark / m_strOrderSysID`
**持仓（`position`）**：`m_strInstrumentID / m_strExchangeID / m_nVolume(持仓量) / m_nCanUseVolume(可用) / m_dOpenPrice(成本价) / m_dInstrumentValue(市值) / m_dPositionCost / m_dPositionProfit`
**资金（`account`）**：`m_dBalance(总资产) / m_dAssureAsset(净资产) / m_dInstrumentValue(总市值) / m_dTotalDebit(总负债) / m_dAvailable(可用) / m_dPositionProfit`

> 完整字段表见 §7.5 数据结构全集。

**重要**：`get_trade_detail_data` 与四个回调都是从**客户端本地缓存**读取，不是实时查柜台。有交易主推 50ms 刷新一次，无主推 1–6s 一次。**卖出后立刻查可能查不到委托，可用资金也不会立即变多。**

### 交易回调（全局函数）

```python
def account_callback(C, A): ...    # 资金账号状态变化
def task_callback(C, T): ...       # 账号任务状态变化
def order_callback(C, O): ...      # 委托状态变化
def deal_callback(C, D): ...       # 成交回报
def position_callback(C, P): ...   # 持仓状态变化
def orderError_callback(C, O): ... # 异常下单
```

### 把 `m_*` 转字典（推荐）

```python
def to_dict(obj):
    return {attr: getattr(obj, attr)
            for attr in dir(obj) if attr[:2] == 'm_'}
```

来源：`docs/QMT_INNERAPI.md` §五 数据结构、§八 交易函数、§九 成交回报实时主推函数、§十三 完整示例。

---

## 9. 篮子 / 组合交易（多标的一键下单）

```python
basket = {
    'name': 'basket1',
    'stocks': [
        {'stock': '600000.SH', 'weight': 0.11, 'quantity': 100, 'optType': 23},
        {'stock': '600028.SH', 'weight': 0.11, 'quantity': 200, 'optType': 24},
    ]
}
set_basket(basket)
# 按数量下单：orderType=2101, volume=篮子份数（每份按 quantity 下单）
passorder(35, 2101, account, 'basket1', 5, -1, 2, '名', 2, '备注', C)
# 按权重下单：orderType=2102, volume=总额（元）
passorder(35, 2102, account, 'basket2', 5, -1, 10000, '名', 2, '备注', C)
```

- `set_basket(basketDict)`：设置 `passorder` 的股票篮子，仅用于 `passorder` 篮子交易
- `get_basket(basketName)`：取出篮子
- 上例一键买卖 2 份 → `600000.SH` 买 200 股，`600028.SH` 卖 400 股
- 组合 opType：`25` 组合买 / `26` 组合卖 / `35` 普通账号一键买卖 / `36` 信用账号一键买卖

来源：`docs/QMT_INNERAPI.md` §八 get_basket / set_basket、§十二 opType 组合交易。

---

## 10. 调度器与定时

```python
# run_time：定时触发
C.run_time("f", "1nSecond", "2019-10-14 13:20:00")   # 秒级间隔用 nSecond
C.run_time("f", "5nSecond", "2019-10-14 13:20:00")

# schedule_run：可取消的任务组
tid = ContextInfo.schedule_run(on_timer, '20231231235959', 3,
                               dt.timedelta(seconds=60), 'my_timer')
ContextInfo.cancel_schedule_run('my_timer')
```

> ⚠️ `run_time` 回调里 `passorder` 必须传 `quickTrade=2`。
> ⚠️ 定时器在第一次运行前可能先等待一个 period。
> ⚠️ 所有策略在**同一个线程**跑，任意策略 `sleep / 死循环 / 加锁` 会卡全局。要并行 → 极简模式 + `xtquant`。

来源：`docs/QMT_INNERAPI.md` §六 schedule_run / run_time / cancel_schedule_run、§十四 常见问题。

---

## 10.5 量化框架（pandas / numpy / talib / 财务 / 因子）

### 自带库：pandas + numpy + **talib**（官方示例即 `import talib`）

QMT 编辑器内**自带 pandas / numpy / talib**（官方策略示例顶部惯例：`#coding:gbk` + `import pandas as pd` + `import numpy as np` + `import talib`）。行情 DataFrame 直接喂 talib 指标（`talib.SMA` / `talib.MA` / `talib.EMA` / `talib.MACD` / `talib.RSI` …）：

```python
#coding:gbk
import pandas as pd
import numpy as np
import talib
def init(C): pass
def handlebar(C):
    df = C.get_market_data_ex(['close'], [C.stock], period='1d', subscribe=False)[C.stock]
    close = df['close'].values
    ma_fast = talib.SMA(close, 10)          # 快线
    ma_slow = talib.SMA(close, 20)          # 慢线
    macd, signal, hist = talib.MACD(close)  # 12/26/9
```

> **第三方库白名单**：非内置库（如 `sklearn`）会被 `ImportError: Forbidden: Module xxx not in whitelist!` 拦截 —— 需券商后台开启白名单控制（§13.1）。财务指标计算 → 官方用 `numpy`/`talib` 自己算，不依赖第三方。

### 财务数据（`get_financial_data` / `get_raw_financial_data`）

> 财务数据从**本地下载**取数（界面「数据管理 - 财务数据」先补充）。表名：资产负债表 `ASHAREBALANCESHEET` / 利润表 `ASHAREINCOME` / 现金流量表 `ASHARECASHFLOW` / 股本表 `CAPITALSTRUCTURE` / 指标表 `PERSHAREINDEX`（表名不区分大小写）。

**用法 1（批量）** `C.get_financial_data(fieldList, stockList, startDate, endDate, report_type='announce_time')`

- `fieldList`：`['ASHAREBALANCESHEET.fix_assets', '利润表.净利润']`（表名/中文别名皆可）
- 返回类型按「代码数 × 时间范围」：`=1,=1 → Series`；`=1,>1 → DataFrame(时间×字段)`；`>1,=1 → DataFrame(代码×字段)`；`>1,>1 → Panel(代码, 时间, 字段)`

**用法 2（单点）** `C.get_financial_data(tabname, colname, market, code, report_type, barpos)` → `float`，如 `C.get_financial_data('ASHAREBALANCESHEET', 'fix_assets', 'SH', '600000', C.barpos)`

**`get_raw_financial_data`**：同用法 1 签名，但**不填充每个交易日**（只返回财报发布日），适合 `after_init` 一次性拉全历史。

**`report_type` 二选一（防未来函数）**：

| 取值 | 语义 | 未来数据 |
|---|---|---|
| `announce_time`（默认） | 按**公告期**（实际发布日）取数 | **不会取到未来数据** ✓ |
| `report_time` | 按**报告期**取数 | ⚠️ **可能取到未来数据** |

> 回测里指标计算**一律 `announce_time`**；`report_time` 只有明确要"报告期归属"且容忍未来函数时才用。官方财务示例：`after_init` 里 `get_raw_financial_data(fieldList, stockList, '20150101', '20300101', report_type='report_time')` 遍历输出净利润/营收（配 `to_zw()` 中文金额格式化）。

### 数据/能力函数速查（`get_market_data_ex` 之外的取数）

| 函数 | 用途 | 备注 |
|---|---|---|
| `C.get_last_volume(stock)` | 最新流通股本（股） | |
| `C.get_total_share(stock)` | 总股数 | |
| `C.get_instrument_detail(stock, iscomplete=False)` | 合约详情 dict | `OpenDate` 上市日 / `ExpireDate` 退市日 / `PriceTick` 最小变动 / `VolumeMultiple` 合约乘数 / `UpStopPrice`·`DownStopPrice` 涨跌停价 / `FloatVolume`·`TotalVolume` 流通·总股本 / `InstrumentStatus` 停牌（≤0 正常 / ≥1 停牌天数）；`OpenDate` 特殊值：`19700101` 新股 / `19700103` 新债 / `19700104` 可转债 / `19700105` 配股 |
| `C.get_contract_multiplier(code)` | 合约乘数 | 期货 |
| `C.get_contract_expire_date(codemarket)` | 期货到期日 | |
| `C.get_main_contract('IF00.IF')` | 期货主力合约 | 需下「历史主力合约」数据 |
| `C.get_st_status(stock)` / `C.get_his_st_data(stock)` | 历史 ST 区间 | 需下「过期合约 K 线」数据；返回 `{'ST': [[start,end],...]}` |
| `C.get_divid_factors(stock)` | 除权除息日 + 复权因子 | dict `{时间戳: [每股红利, 送转, 转赠, 配股, 配股价, 是否股改, 复权系数]}` |
| `C.get_weight_in_index(index, stock)` | 指数绝对权重（%，如 1.6134=1.6134%） | |
| `C.get_stock_list_in_sector(sector)` | 板块成份股 | 支持自定义板块 |
| `C.get_trading_dates(stock, start, end, count, period='1d')` | 交易日/K 线时间列表 | `init` 里不可用，用 `after_init` |
| `C.get_open_date(stock)` | 上市日期（int，如 19910403） | |
| `C.get_stock_name(stock)` | 证券名称 | |
| `C.get_option_detail_data(code)` / `get_option_list` / `get_option_undl_data` / `bsm_price` / `bsm_iv` | 期权信息 + BS 定价/隐含波动率 | 期权策略专用 |

### 因子 / 扩展数据 / VBA 引用

| 函数 | 用途 |
|---|---|
| `ext_data(name, stock, deviation, C)` | 取扩展数据数值（`deviation`：0 当前 / N 右偏移 / -N 左偏移） |
| `ext_data_rank(name, stock, deviation, C)` | 该数值在所有品种中的排名 |
| `ext_data_range` / `ext_data_rank_range` | 指定时间区间的值 / 排名 |
| `get_factor_value(name, stock, deviation, C)` | 取因子数据数值 |
| `get_factor_rank(name, stock, deviation, C)` | 因子数值在所有品种中的排名 |
| `call_vba(factorname, stock, [period, dividend_type, barpos], C)` | 券商版调用 VBA 模型结果（需先建 VBA 公式 + 本地数据） |
| `get_vba_func_result(func, stock, period='1d', ...)` | 投研版：python 里直接写 VBA 调用模型 |

> 扩展数据（`set_extend_data_value(name, ts_ms, value)`）在**盘后批量计算、盘中 `ext_data` 查**的场景最常用 —— 避免在 `handlebar` 里逐 bar 重算重因子。

来源：`docs/QMT_INNERAPI.md` §七 财务/合约/期权/除复权/指数权重/成分股/交易日、§十 引用函数、§十三 完整示例。

---

## 11. 实盘 / 回测的状态机（防超单）

**下单立即返回，回报走本地缓存**：`passorder(quickTrade=2)` 发出委托立刻返回，**不等待回报，不阻塞线程**；`get_trade_detail_data` 查到的状态**不等于柜台实时状态**。

**标准做法**（参考官方「调整至目标持仓」Demo）：

```python
class A(): pass
A.waiting_dict = {}          # {投资备注: 委托状态}
A.all_order_ref_dict = {}    # {投资备注: 下单时间}

# 下单
msg = f"{now}_{stock}_sell_{vol}股"
passorder(24, 1101, A.acct, stock, 14, -1, vol, '策略名', 2, msg, C)
A.waiting_dict[stock] = msg          # 记下该品种待确认的委托备注
A.all_order_ref_dict[msg] = time.time()

# 查委托，已成交/已撤则从 waiting_dict 删除
order_list = get_trade_detail_data(A.acct, A.acct_type, 'order')
for order in order_list:
    if order.m_strRemark in A.waiting_dict.values():
        if order.m_nOrderStatus in [48,49,50,51,52,55,86,255]:  # 可撤状态
            cancel(order.m_strOrderSysID, A.acct, 'stock', C)    # 超时撤单
        elif order.m_nOrderStatus in [53,54,56,57]:              # 部撤/已撤/已成/废单
            A.waiting_dict.pop(...)

# 下单前：该品种存在待确认委托 → 跳过，防超单
if stock in A.waiting_dict:
    continue
```

> **投资备注（`m_strRemark`）**：`passorder` 第 10 参，**长度 < 24**，是唯一能匹配委托到意图的字段。标准做法：每笔独立 msg → 写 `waiting_dict` 作 key → 防止超单。
> **持仓遍历**（止盈止损 / 调仓通用骨架）：`holdings = get_trade_detail_data(account, accountType, 'position')` → 每项 `m_strInstrumentID + '.' + m_strExchangeID` 拼回 symbol、`m_dProfitRate` 盈亏比例、`m_nCanUseVolume` 可卖数量（`volume >= 100` 才卖）→ 盘口最新价/五档取 `C.get_full_tick(stock_list)`（注意 `bidPrice` 是 list，取五档价需行情源五档）。
> 完整实现见 `docs/QMT_INNERAPI.md` §十三「调整至目标持仓」（含撤单、资金检查、可用股数 min、差额<100 股停止委托等细节）。

---

## 11.5 回测专用调仓函数（`order_target_*`，仅回测可用）

官方「其他交易函数（仅回测可用）」明确标注：**以下函数仅回测生效，实盘和模拟盘均不可用**。多标的回测里逐标的调整目标持仓最简洁的写法：

| 函数 | 用途 | 备注 |
|---|---|---|
| `order_target_value(stockcode, tar_value[, style, price], C[, accId])` | 调整该证券仓位到**目标价值**（元） | 无仓位则全买目标价值，有仓位则买卖差值；**资金不足不下单** |
| `order_target_percent(stockcode, tar_percent[, style, price], C[, accId])` | 调整该证券仓位到组合**目标百分比**（0~1） | 买卖单下舍入一手股数（A 股 100 倍数）；资金不足不下单 |
| `order_shares / order_lots / order_value / order_percent` | 指定股数 / 手数 / 金额 / 组合价值比例 | 同节，仅回测可用 |

- `style` 选价类型：`'LATEST'`（最新，默认）/ `'FIX'`（指定）/ `'HANG'`（挂单）/ `'COMPETE'`（对手）/ `'MARKET'`（市价）/ `'SALE1-5'` / `'BUY1-5'`
- 回测中效果等同 `quickTrade=0` 的 `passorder`
- **实盘多标的调仓必须用 `passorder` + 状态机**（§11），不能用 `order_target_*`

```python
# 多标的回测逐标的调仓到目标价值（仅回测）
TARGET = {"000001.SZ": 10000, "600519.SH": 20000}
for stock, value in TARGET.items():
    order_target_value(stock, value, C, accountid)
```

> 来源：`docs/QMT_INNERAPI.md` §八「其他交易函数（仅回测可用）」7344-7499；`docs/QMT多标的.md` §9.5。

---

## 12. 编码纪律检查表（每个策略过一遍）

- [ ] 第一行 `#coding:gbk`
- [ ] `init(ContextInfo)` 和 `handlebar(ContextInfo)` 都定义（handlebar 必填，即使为空）
- [ ] 跨 bar 状态用 `class A(): pass` 全局变量，**不**塞 `ContextInfo` 属性
- [ ] 策略参数在文件顶部 config 块（账号 / 标的 / 周期 / 资金 / 起止时间）
- [ ] 回测：`get_market_data_ex(..., subscribe=False)` 读本地
- [ ] 回测主图周期和数据已下载（多标的需**逐品种下载**对应周期）
- [ ] `handlebar` 逐 K 线 → `quickTrade=0`；`after_init` / `run_time` / `subscribe` 回调 → `quickTrade=2`
- [ ] 实盘 / 模拟 / 分钟线 / tick：`handlebar` 顶部 `if not C.is_last_bar(): return`
- [ ] 每笔 `passorder` 传唯一 `m_strRemark`（< 24 字符），并有状态机防超单
- [ ] `opType` 与账号类型匹配（股票 23/24，两融 27/33/34，期货 0/3/6，期权 50/51，ETF 60/61，组合 35）
- [ ] `prType` 有意识选择（5 最新价 / 11 限价 / 14 对手价需五档 / 42 市价有保护限价）
- [ ] 期货主连/加权（`rb00.SF` / `rbJQ00.SF`）仅回测可用
- [ ] 回测以**副图**模式执行，不要主图 / 主图叠加
- [ ] 指标库用自带的 `talib` / `pandas` / `numpy`（第三方库有白名单，§13.1）
- [ ] 财务数据 `get_financial_data` 用 `announce_time`（公告期，防未来函数），`report_time` 只用在意愿接受未来数据的场景
- [ ] 财务 / 股本 / 复权数据使用前先「数据管理」补充本地数据
- [ ] 持仓遍历用 `m_nCanUseVolume`（可卖）而非 `m_nVolume`（总量）

---

## 13. 常踩的坑（按出现频率排序）

1. **第三方库被白名单挡**：`ImportError: Forbidden: Module xxx not in whitelist!` → 券商后台开启白名单控制，联系券商开通。
2. **pandas 报错**：`NameError: name 'pandas' is not defined` → 模型设置路径错误，正确路径为 `{安装目录}\bin.x64`；`AttributeError: module 'pandas' has no attribute 'core'` → 重启客户端。
3. **`handlebar` 逐 K 线不是逐 tick**：股票 tick 3s 一次；期货 0.5s 一次，但主图是股票时 `handlebar` 仍 3s 一次 → 跑期货 tick 策略把主图设期货，或改用 `run_time` / `subscribe_quote`。
4. **非交易时段 `handlebar` 也会触发**：行情服务重启重订阅导致 → 加 `if now < '093000' or now > '150000': return` 过滤。
5. **回测撮合规则**：指定价在 K 线高低点之间 → 按指定价撮合；超出 → 按收盘价撮合；委托超可用 → 按可用撮合。
6. **科创板 / 创业板 / 主板单笔上限**：科创板限价 10 万股 / 市价 5 万股 / 200 股起 1 股递增；创业板限价 30 万股 / 市价 15 万股 / 100 股起 100 递增；主板 100 万股 / 100 股起 100 递增。
7. **过期合约 ERROR**：`获取合约乘数和最小变动价位失败` → 右下角行情 → 智能下载 → 勾选过期合约列表 → 开始。
8. **下单失败排查**：① 是否模型交易界面实盘模式（模拟模式只显示信号）② 是否用了 `quickTrade`（默认 0 日线以上全天不委托）③ 客户端左下角消息提示。
9. **证券状态 `openInt`**（沪市）：12 盘前集合竞价 / 13 盘中连续竞价 / 18 盘后集合竞价 / 15 收盘 / 22 盘后定价 / 23 盘后定价结束（深市 9:25–9:30 与 11:30–13:00 休市编码 14）。
10. **日志位置**：`{安装目录}/userdata/log/`；`XtClient_Formula_<date>.log` 策略运行日志、`XtClient_FormulaOutput.log` 策略输出。

来源：`docs/QMT_INNERAPI.md` §十四 常见问题 全文。

---

## 13.5 与 CLI 回测 context 的接口对齐

Hamuna CLI 回测 (`strategy_cli`) 与 QMT 编辑器共用**同一套 body 签名**（`init/handlebar` 里的 `C.*` + 全局函数双跑，**body 用 QMT 原生签名**，QMT 端零翻译直通，CLI 端 Context + driver 适配）。CLI `Context` 的方法面**对齐 QMT 原生 ContextInfo**，数据源各从其责：

| 接口 | CLI 实现 | QMT 端 | 双跑 |
|---|---|---|---|
| `C.get_market_data_ex(fields, stock_code, period, start_time, end_time, ..., subscribe=False)` → `{code: DataFrame}` | Context 本地 mock / 容维 bar dict 转 DataFrame，**签名与 QMT 完全一致** | 原生 | ✅ |
| 全局 `passorder(..., userOrderId, C)`（11 参，第 10 参投资备注） / `order_target_*` / `set_basket` / `get_basket` / `download_history_data` / `timetag_to_datetime` | driver 注入 module globals → submit_order 撮合 | 原生全局函数 | ✅ |
| 全局 `get_trade_detail_data(acc, type, 'ACCOUNT'/'POSITION'/'ORDER'/'DEAL')` → m_* 对象 | driver 注入 → CLI 账户/持仓/委托的 m_ 形态（近似） | 原生 | ✅ |
| `C.get_full_tick` | tick 引擎模拟 | 原生有但**回测不可用**（无历史，§6） | ⚠️ |
| `C.get_instrument_detail` / `get_total_share` / `get_last_volume` / `get_open_date` | 容维 proxy | 原生 | ✅ |
| `C.get_financial_data` / `get_divid_factors` | 容维年报季报 / 除权除息 | 原生 | ✅ |
| `C.get_trading_dates` / `get_bar_timetag` / `get_stock_name` / `get_stock_list_in_sector` / `is_new_bar` / `run_time` | 本地日历 / 池加载 | 原生 C 方法 | ✅ |
| 属性 `barpos` / `capital` / `stockcode` / `market` / `dividend_type` / `time_tick_size` / `benchmark` / `do_back_test` / `period` | driver 每 bar 注入 / cfg | 原生 | ✅ |
| 属性 `cur_date` / `cur_time` | driver 内部状态（逐 bar 推进 / 测试用） | **无**（QMT 用 `timetag_to_datetime(C.get_bar_timetag(C.barpos), ...)` 表达式） | ❌ body 禁用 |
| `C.get_shareholder` / `get_convertible_detail` / `get_etf_share_total` / `get_etf_share_float` / `get_date_str` | 容维/本地 | **无** | ❌ CLI-only |

> **body 里只准用 ✅ 双跑接口**（含全局函数）。用 ❌ 接口 → QMT 编辑器 AttributeError（CLI 回测正常、掩盖问题）。用 ⚠️ 时注意行为差异（`get_full_tick` 回测为空）。日期定位一律用 `timetag_to_datetime(C.get_bar_timetag(C.barpos), '%Y%m%d')`（分钟级 `'%Y%m%d%H%M%S'`），**不要用 `C.cur_date` / `C.cur_time`**（QMT 无此属性，body 里会出现 AttributeError）。

---

## 14. 与平台（hamuna）衔接

- ~~Hamuna 平台的 QMT 导出见 `references/qmt-export.md`（本 skill 内）~~ — 2026-08-18 删除: v2 skill 不再负责 QMT 导出
- 平台侧策略编码规范（`init`/`handlebar` 内联工具）见 `agents/coder.md` §「编码规范（cm.* 内联）」（本 skill 内）
- CLI 回测引擎 vs QMT 编辑器回测：CLI 是本地 mock 引擎（`hamuna compute`），QMT 是真实撮合；信号逻辑可复用，但数据源（CLI 用 `get_market_data_ex` 模拟、QMT 用真实本地数据）不同，见 `references/engine-and-data.md`（本 skill 内）
- QMT 备注透传约定（`m_strRemark` 承载投资备注、下单前设置）：见本文件 §4

---

## 15. 参考来源

- `docs/QMT_INNERAPI.md` — dict.thinktrader.net `/innerApi/` 文档集转储（§一 概述 / §二 使用须知 / §三 界面操作 / §四 变量约定 / §五 数据结构 / §六 系统函数 / §七 行情函数 / §八 交易函数 / §九 成交回报主推 / §十二 枚举常量 / §十三 完整示例 / §十四 常见问题）
- `docs/QMT多标的.md` — 多标的回测专题（数据准备 / 行情获取 / 交易 / 回测专用调仓 / 官方网页核实）
- `docs/QMT_字段速查.md` — 字段速查
- `docs/QMT_innerApi_vs_RWAPI.md` — innerApi vs 容维接口映射
- 迅投官方文档 `dict.thinktrader.net/innerApi/` — 原始 API 参考（含未覆盖页提示）
