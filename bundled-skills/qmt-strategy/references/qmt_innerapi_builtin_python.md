# 迅投 QMT 内置 Python API（innerApi）综合参考

> 本文档覆盖 [dict.thinktrader.net/innerApi/](https://dict.thinktrader.net/innerApi/) 整个文档集（5 个页面），是 QMT 客户端**编辑器内置 Py3.6** 那套策略 API 的综合参考。它和 [XtQuantTrader（nativeApi）](https://dict.thinktrader.net/nativeApi/xttrader.html) 是同一个厂商、同一条产品线上的**两套完全不同**的调用链路，函数名与回调机制都不可混用。本文档主表 QMT 内置 Python API。
>
> **主源页面**（截至 2025-12）：
> - [start_now.html — QMT 内置 Python 快速开始](https://dict.thinktrader.net/innerApi/start_now.html)
> - [question_answer.html — 常见问题](https://dict.thinktrader.net/innerApi/question_answer.html)
> - [interface_operation.html — 界面操作](https://dict.thinktrader.net/innerApi/interface_operation.html)
> - [variable_convention.html — 变量约定](https://dict.thinktrader.net/innerApi/variable_convention.html)
> - [code_examples.html — 完整示例](https://dict.thinktrader.net/innerApi/code_examples.html)
>
> **未读的相关页**（这些链接出现在 question_answer / code_examples 里但未直接挂在 start_now.html）：
> - `data_function.html`（get_market_data_ex 等详细签名）
> - `data_structure.html`（行情回调字段）
> - `system_function.html`（schedule_run 等）

## 一、术语澄清：innerApi vs nativeApi

迅投官方站 `/innerApi/` 这套 API **不是** `XtQuantTrader`。它是 QMT 客户端编辑器内置的 **Python 3.6 运行时**，在策略编辑器里写代码，系统托管 init / handlebar 回调，通过 `passorder` / `ContextInfo` 等全局函数交互。两套 API 不可混用：

| 维度 | innerApi（本文） | nativeApi（`xtquant`） |
|---|---|---|
| 运行位置 | QMT 编辑器内 Py3.6 | 外部 Python 进程 |
| 主入口 | `passorder(...)` | `XtQuantTrader.connect()` |
| 下单回执 | 本地缓存异步（50ms / 1–6s 刷新） | 回调类 `XtQuantTraderCallback` |
| K 线驱动 | `handlebar(C)` 必填 | 自己写 `run_forever()` |
| 查询 | `get_trade_detail_data` | `query_*/asset/position/order/trade` |
| 数据 | `C.get_market_data_ex / get_full_tick` | `xtdata.get_market_data*` |
| 行情订阅 | `C.subscribe_quote` 返回订阅号 | `xtdata.subscribe_quote` |
| 状态对象 | `ContextInfo`（逐 K 线深拷贝） | 自行维护 |
| ContextInfo 上设属性 | 支持 | 无此概念 |
| Python 版本 | 3.6（固定） | 3.6 / 3.11 / 3.12 / 3.13（见 [nativeApi/start_now.html](https://dict.thinktrader.net/nativeApi/start_now.html)） |

**判断标准**：策略在 QMT 客户端里点击"运行 / 回测" → innerApi；策略在自己 `python.exe` 里 `from xtquant.xttrader import XtQuantTrader` → nativeApi。

来源：[start_now.html §一 概述](https://dict.thinktrader.net/innerApi/start_now.html) + 现有 [specs/tech_docs/qmt_innerapi_guide.md §附](specs/tech_docs/qmt_innerapi_guide.md)。

---

## 二、运行机制 / 运行模式 / quickTrade

### 三种运行机制（决定策略怎么被触发）

| 机制 | 函数 | 触发节奏 | 匹配需求 |
|---|---|---|---|
| 逐 K 线驱动 | `handlebar(C)` | 历史 K 线从左到右每根一次 + 盘中主图 tick 驱动 | 在实盘中模拟逐 K 线效果 |
| 事件驱动 | `C.subscribe_quote(stock, period, callback=...)` | 订阅品种 tick 到达 | 盘中随分笔行情判断交易 |
| 定时任务 | `C.run_time("f", "1nSecond", "2019-10-14 13:20:00")` | 固定间隔 | 盘中固定时间间隔判断交易 |

来源：[start_now.html §三 运行机制对比](https://dict.thinktrader.net/innerApi/start_now.html)。

### 四种运行模式（运行时手动选）

| 模式 | 入口 | `passorder` 行为 |
|---|---|---|
| 调试运行模式 | 策略编辑器点"运行" | 不记录交易信号 |
| 回测模式 | 策略编辑器点"回测" | 按回测周期撮合，记录交易 |
| 模拟信号模式 | 模型交易界面选"模拟" + 三角形运行 | `passorder` **不真下单**，仅记录信号到"策略信号"栏 |
| 实盘交易模式 | 模型交易界面选"实盘" + 三角形运行 | `passorder` **真下单** + 记录信号 |

> "模拟 / 实盘"运行模式与"账号是实盘 / 模拟"无关。模拟柜台账号需走 [xuntou.net/#/productvip](https://xuntou.net/#/productvip) 申请。
>
> 来源：[start_now.html §二 场景需求](https://dict.thinktrader.net/innerApi/start_now.html) + [variable_convention.html §mode 模式选择](https://dict.thinktrader.net/innerApi/variable_convention.html)。

### `quickTrade` 参数（`passorder` 第 9 参）

| 值 | 行为 | 何时用 |
|---|---|---|
| `0`（默认） | 仅 K 线最后一个 tick 生效，其他分笔信号丢弃 | `handlebar` 逐 K 线生效 |
| `1` | 最新 K 线时立即生效，历史 K 线无效 | `handlebar` 盘中立即下单 |
| `2` | 任何调用立即生效，丢弃等待机制 | `run_time` / `subscribe` 回调 / `after_init` 内下单 |

> **关键**：定时器、`subscribe` 回调、`after_init` 函数中调用 `passorder` 必须传 `2`，否则信号会被系统丢。
>
> 来源：[question_answer.html §快速交易参数 quickTrade](https://dict.thinktrader.net/innerApi/question_answer.html)。

---

## 三、`ContextInfo` 逐 K 线保存机制（必读）

**机制**：[`ContextInfo`](https://dict.thinktrader.net/innerApi/variable_convention.html) 是底层维护、传给 `init` / `handlebar` 的参数对象。**同一 bar 内是同一个变量**，但每次 `handlebar` 调用前会深拷贝一次，**bar 结束时才把修改保存下来**。盘中主图每个 Level-1 分笔到达会触发 `handlebar`，但**只有 K 线结束时最后一个分笔的修改才生效**；其余分笔触发时，修改被回滚为之前的深拷贝。

**影响**：
1. `ContextInfo` 中存数据**每次分笔都深拷贝**，拖慢策略 → 高频数据不要塞 `ContextInfo`
2. `ContextInfo` 适合记录**逐 K 线生效**的交易信号（`quickTrade=0`），不适合立刻下单

**结论**：`quickTrade=2` 立即下单时，委托状态必须用**普通全局变量**（典型做法 `class A(): pass` 实例）保存，不能放 `ContextInfo` 属性。

来源：[question_answer.html §系统对象 ContextInfo 逐 k 线保存的机制](https://dict.thinktrader.net/innerApi/question_answer.html)。

---

## 四、`passorder` 完整签名与常量

```python
passorder(opType, orderType, account, symbol, prType, price,
          volume, [userOrderId], [quickTrade], [strRemark], ContextInfo)
```

`algo_passorder(..., userparam)` 形态见 §九。

### `opType` 委托类型（精选）

| 值 | 含义 | 示例 |
|---|---|---|
| 0 | 期货开多 | `passorder(0, 1101, 'test', 'rb2401.SF', 5, -1, 10, 1, C)` |
| 3 | 期货开空 | `passorder(3, 1101, 'test', 'MA401.ZF', 11, 3000, 10, 1, C)` |
| 6 | 期货四键平多（优先平今） | `passorder(6, 1101, 'test', 'IF2311.IF', 5, -1, 2, 1, C)` |
| 23 / 24 | 股票买 / 卖 | `passorder(23, 1101, 'test', '600000.SH', 5, 0, 100, '', 1, '', C)` |
| 27 | 融资买入（两融） | `passorder(27, 1101, 'test', target, 11, 7, 100, C)` |
| 32 | 直接还款（两融） | `passorder(32, 1101, account, s, 5, 0, money, 2, C)` |
| 33 / 34 | 担保品买 / 卖（两融） | `passorder(33, 1101, 'test', target, 11, 7, 100, C)` |
| 35 | 一键买卖（组合 / 篮子） | `passorder(35, 2101, account, 'basket1', 5, 1, pice, '', 2, 'remark', C)` |
| 50 / 51 | 期权开仓买 / 平仓卖 | `passorder(50, 1101, 'test', target, 5, -1, 2, 1, C)` |
| 60 / 61 | ETF 申购 / 赎回 | `passorder(60, 1101, 'test', '510030.SH', 5, 0, 1, 2, C)` |
| 75 | 专项直接还款（两融） | `passorder(75, 1101, account, s, 5, 0, money, 2, C)` |

### `orderType` 下单方式

| 值 | 含义 |
|---|---|
| 1101 | 按数量（股 / 张 / 手） |
| 1102 | 按金额（元） |
| 2101 | 组合 - 按股票数量 |
| 2102 | 组合 - 按股票权重 |

### `prType` 报价类型

| 值 | 含义 | 备注 |
|---|---|---|
| 5 | 最新价 | 最常用 |
| 11 | 限价 | 必填具体价格 |
| 14 | 对手价 | **需行情源为五档**（见 §十-4） |
| 42 | 市价 | 沪市有保护限价，`price=0` 自动填涨跌停价 |

### `accountType`（字符串）

`'STOCK' / 'CREDIT' / 'FUTURE' / 'FUTURE_OPTION' / 'STOCK_OPTION' / 'HUGANGTONG' / 'SHENGANGTONG'`

来源：[variable_convention.html §账号类型说明](https://dict.thinktrader.net/innerApi/variable_convention.html) + [code_examples.html §交易下单示例](https://dict.thinktrader.net/innerApi/code_examples.html)。

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

来源：[code_examples.html §调整至目标持仓](https://dict.thinktrader.net/innerApi/code_examples.html) Demo 中 `if order.m_nOrderStatus in [48,49,50,51,52,55,86,255]:` 的判断。

### 投资备注（`m_strRemark`）

- `passorder` 第 10 参，**长度 < 24**
- **唯一**匹配字段（`passorder / algo_passorder / smart_algo_passorder` 支持）
- 标准做法：每笔独立 msg → 写到 `waiting_dict` 作 key，`m_nOrderStatus` 作 value → 防止超单

来源：[code_examples.html §如何使用投资备注](https://dict.thinktrader.net/innerApi/code_examples.html) + [code_examples.html §调整至目标持仓](https://dict.thinktrader.net/innerApi/code_examples.html)。

---

## 五、行情三态 + 行情中心 / 交易中心

### 行情数据三种来源

| 类型 | 接口 | 特点 |
|---|---|---|
| 本地数据 | `get_market_data_ex(subscribe=False)` | 回测用，需先用 `down_history_data` 或界面"数据管理"补历史 |
| 全推数据 | `get_full_tick / subscribe_whole_quote` | 客户端启动后自动增量推送，50ms 更新；**无订阅上限，无历史**，**无 5 档盘口**（除非行情源改五档） |
| 订阅 | `subscribe_quote` + `get_market_data_ex(subscribe=True)` | 4 种基础周期（分笔 / 1m / 5m / 1d），有最大订阅数（默认 ~300）；**超出返回前值填充** |

### 行情中心 vs 交易中心

- **行情中心**控制单支订阅（`subscribe_quote`）
- **交易中心**影响全推数据（`get_full_tick / subscribe_whole_quote`）

### 取数据函数对比

| 函数 | 用途 | 备注 |
|---|---|---|
| `down_history_data` | 下载指定区间到本地 | 增量下载时 `start_time` 留空 |
| `get_local_data` | 取本地数据 | 盘中不更新，速度快，回测用 |
| `get_full_tick` | 取全推最新值 | 50ms 一次，**无 5 档**（除非行情源改五档） |
| `subscribe_quote` | 订阅行情 | 4 种基础周期；超限订阅不更新；Lv1 / Lv2 互不影响计数 |
| `unsubscribe_quote` | 按订阅号反订阅 | 释放槽位 |
| `get_market_data_ex(subscribe=True)` | 取订阅 / 本地 | 自动订阅但**无订阅号** → 停策略释放 |
| `get_market_data_ex(subscribe=False)` | 取本地 | 不订阅 |

> ⚠️ **不再推荐**：`set_universe / get_history_data / get_market_data`（早期订阅股票池，无法反订阅）。
>
> ⚠️ `gmd` 系列在 `init` 中只能读本地数据，**不建议 init 中调用**。
>
> ⚠️ 订阅数超限返回的数据会**用前值填充**。

来源：[question_answer.html §QMT 行情数据基础概念](https://dict.thinktrader.net/innerApi/question_answer.html) + [question_answer.html §QMT 行情调用函数对比说明](https://dict.thinktrader.net/innerApi/question_answer.html)。

---

## 六、变量与约定

### 函数命名

- `get_*`：来自**客户端内存**（本地缓存，快）
- `query_*`：向**服务查询**（异步回调式）

### 交易所代码（symbol 后缀）

| 交易所 | 简称 | 显示后缀 |
|---|---|---|
| 上海证券交易所 | SH | SH |
| 深圳证券交易所 | SZ | SZ |
| 北京证券交易所 | BJ | BJ |
| 香港证券交易所 | HK | HK |
| 沪港通 / 深港通 | HGT / SGT | HGT / SGT |
| 中金所 | IF | CFFEX |
| 上期所 | SF | SHFE |
| 大商所 | DF | DCE |
| 郑商所 | ZF | CZCE |
| 上海国际能源交易中心 | INE | INE |
| 广期所 | GF | GFEX |
| 上证期权 / 深证期权 | SHO / SZO | SH / SZ |
| 板块指数 | BKZS | BKZS |

> **期货 symbol 严格区分大小写**：`AP401.ZF` 不能写成 `ap401.ZF`，`rb2401.SF` 不能写成 `RB2401.SF`。
>
> **期货主连 / 加权合约仅回测模式可用**：`rb00.SF`（主连，未平滑）、`rbJQ00.SF`（加权，更平滑）。

来源：[variable_convention.html §symbol_code 代码表示](https://dict.thinktrader.net/innerApi/variable_convention.html)。

### 周期（`period`）

`'1d' / '1m' / '3m' / '5m' / '15m' / '30m' / '1h' / '2h' / '1w' / '1mon' / '1q' / '1hy' / '1y' / 'tick'`

合成规则（取 N 分钟 / N 小时数据）：

| 目标周期 | 基础周期 |
|---|---|
| 1m < x < 5m | 1m 合成 |
| 5m ≤ x < 1d | 5m 合成 |
| ≥ 1d | 1d 合成 |

> 取 2h 数据 → 先下 5m 数据。

### 复权（`dividend_type`）

`'none' / 'front' / 'back' / 'front_ratio' / 'back_ratio'`

> **回测推荐 `front_ratio`（等比前复权）**——配股 / 增发不会造成价格异常。

来源：[question_answer.html §QMT 在回测时如何选择复权方式](https://dict.thinktrader.net/innerApi/question_answer.html)。

### `ContextInfo` 属性（只读除特别标注）

| 属性 | 含义 | 读 / 写 |
|---|---|---|
| `start` / `end` | 回测起止时间（`'%Y-%m-%d %H:%M:%S'`） | **写**（仅 init 设置，回测模式生效） |
| `capital` | 回测初始资金（默认 1000000） | **写** |
| `period` | 当前周期（`'1d' / '1m' / ...`） | 只读 |
| `barpos` | 当前 K 线索引（从 0 起） | 只读 |
| `time_tick_size` | 当前图 K 线数量 | 只读 |
| `stockcode` | 主图代码（如 `'000300'`） | 只读 |
| `market` | 主图市场（如 `'SH'`） | 只读 |
| `dividend_type` | 主图复权方式 | 只读 |
| `benchmark` | 回测基准（如 `'000300.SH'`） | 只读（仅回测） |
| `do_back_test` | 是否回测模式（默认 False） | 只读 |
| `is_last_bar()` | 当前 bar 是否最新一根 | 方法 |

> ⚠️ `ContextInfo.start / end` 若与"回测参数面板"同时设置，**以代码值为准**；结束 ≤ 开始 → 计算范围为空。
>
> ⚠️ `start / capital` 等**仅在 init 中设置生效**。

来源：[variable_convention.html §ContextInfo](https://dict.thinktrader.net/innerApi/variable_convention.html)。

---

## 七、`get_trade_detail_data` 返回字段

`get_trade_detail_data(account, accountType, 'order'|'deal'|'position'|'account')`，返回的对象字段前缀 `m_`。

### 委托（`order`）

`m_strInstrumentID / m_strExchangeID / m_strInstrumentName / m_nOffsetFlag(买卖) / m_nVolumeTotalOriginal / m_dTradedPrice / m_nVolumeTraded / m_dTradeAmount / m_strOrderSysID / m_strRemark / m_nOrderStatus`

### 成交（`deal`）

`m_strInstrumentID / m_strExchangeID / m_strInstrumentName / m_nOffsetFlag / m_dPrice / m_nVolume / m_dTradeAmount / m_strRemark / m_strOrderSysID`

### 持仓（`position`）

`m_strInstrumentID / m_strExchangeID / m_strInstrumentName / m_nVolume(持仓量) / m_nCanUseVolume(可用) / m_dOpenPrice(成本价) / m_dInstrumentValue(市值) / m_dPositionCost(持仓成本) / m_dPositionProfit / m_dProfitRate`

### 资金（`account`）

`m_dBalance(总资产) / m_dAssureAsset(净资产) / m_dInstrumentValue(总市值) / m_dTotalDebit(总负债) / m_dAvailable(可用) / m_dPositionProfit`

### 两融特殊

`m_dAssureEnbuyBalance(可买担保品资金)`、`m_dAvailable`（融资可用）

来源：[code_examples.html §如何获取委托持仓及资金数据](https://dict.thinktrader.net/innerApi/code_examples.html) + [code_examples.html §获取两融账号信息示例](https://dict.thinktrader.net/innerApi/code_examples.html)。

### 用 `to_dict` 把 `m_*` 转字典（推荐）

```python
def to_dict(obj):
    attr_dict = {}
    for attr in dir(obj):
        try:
            if attr[:2] == 'm_':
                attr_dict[attr] = getattr(obj, attr)
        except:
            pass
    return attr_dict
```

---

## 八、回调与扩展机制

### 交易回调（全局函数）

```python
def order_callback(C, O):  # 委托变化
    print(O.m_strRemark, O.m_strOrderSysID)

def deal_callback(C, D):   # 成交回报
    print(D.m_strRemark, D.m_strOrderSysID)
```

来源：[code_examples.html §如何使用投资备注](https://dict.thinktrader.net/innerApi/code_examples.html)。

### 行情回调（`subscribe_quote` 的 callback）

`def on_quote(data): ...` — `data` 是 `{symbol: {field: value, ...}, ...}`，**只允许一个位置参数**。

```python
C.subscribe_quote(stock, period='1d', dividend_type='none',
                  result_type='dict', callback=on_quote)
num = C.subscribe_quote(...)  # 记录订阅号
C.unsubscribe_quote(num)      # 反订阅（放 stop / 策略结束）
```

### 调度器

```python
tid = ContextInfo.schedule_run(
    on_timer,            # 回调
    '20231231235959',    # 起始时间（历史时间 → 一次间隔后开始）
    3,                   # 触发次数
    dt.timedelta(seconds=60),  # 间隔
    'my_timer'           # 任务组名（用于取消）
)
# ContextInfo.cancel_schedule_run('my_timer')
```

来源：[code_examples.html §每 1 分钟统计一次市场涨跌情况](https://dict.thinktrader.net/innerApi/code_examples.html)。

### 扩展数据（投研接口，写入后可在客户端展示）

```python
def init(C):
    C.extencd_name = create_extend_data('扩展数据', 'test', True)  # 父节点, 名称, 是否覆盖

def handlebar(C):
    if C.is_last_bar():
        timetag = C.get_bar_timetag(C.barpos)
        data = {'SH600177': 0.43, ...}
        reset_extend_data_stock_list(C.extencd_name, list(data.keys()))
        set_extend_data_value(C.extencd_name, timetag, data)
```

### 组合 / 篮子（`set_basket` + `passorder(35, ...)`）

```python
basket = {
    'name': 'basket1',
    'stocks': [
        {'stock': '600000.SH', 'weight': 0.11, 'quantity': 100, 'optType': 23},
        {'stock': '600028.SH', 'weight': 0.11, 'quantity': 200, 'optType': 24},
    ]
}
set_basket(basket)
# 按数量下单：orderType=2101, volume=篮子份数
passorder(35, 2101, account, 'basket1', 5, 1, 2, '', 2, 'remark', C)
# 按权重下单：orderType=2102, volume=总额（元）
passorder(35, 2102, account, 'basket2', 5, 1, 10000, '', 2, 'remark', C)
```

来源：[code_examples.html §组合交易](https://dict.thinktrader.net/innerApi/code_examples.html)。

### 算法单（`algo_passorder`）

```python
userparam = {
    'OrderType': 1,             # 表示要下算法
    'PriceType': 0,             # 卖 5 价下单
    'MaxOrderCount': 12,
    'SuperPriceType': 0,
    'SuperPriceRate': 0.02,     # 超价 2%
    'VolumeRate': 0.1,
    'VolumeType': 10,
    'SingleNumMax': 1000000,
    'PriceRangeType': 0,
    'PriceRangeRate': 1,
    'ValidTimeType': 1,
    'ValidTimeStart': int(time.time()),
    'ValidTimeEnd': int(time.time() + 60*60),
    'PlaceOrderInterval': 10,
    'UndealtEntrustRule': 0,
}
algo_passorder(23, 1101, account, '600000.SH', -1, -1, 2000000,
               '', 2, '普通算法', userparam, C)
```

来源：[code_examples.html §passorder 下算法单函数](https://dict.thinktrader.net/innerApi/code_examples.html)。

### 信用交易查询

| 函数 | 用途 |
|---|---|
| `get_assure_contract(account)` | 担保明细 → `o.m_eFinStatus==48` 即可融资买入 |
| `query_credit_account(account, password, C)` + 回调 `credit_account_callback(C, seq, result)` | 两融账号信息 |
| `query_credit_detail / query_stk_compacts / query_credit_subjects / query_credit_slo_code / query_credit_assure` | 其他信用字段 |

来源：[code_examples.html §获取融资融券账户可融资买入标的](https://dict.thinktrader.net/innerApi/code_examples.html) + [code_examples.html §获取两融账号信息示例](https://dict.thinktrader.net/innerApi/code_examples.html)。

---

## 九、其他常用函数

| 类别 | 函数 |
|---|---|
| 行情 | `get_market_data_ex / get_full_tick / get_local_data / down_history_data / subscribe_quote / unsubscribe_quote / subscribe_whole_quote` |
| 品种 | `get_stock_list_in_sector(板块名)`（如 `'沪深A股' / '京市A股' / '沪深京A股' / '不卖品种'`） |
| 静态 | `get_instrumentdetail / get_ipo_data / get_last_volume / get_stock_name` |
| 交易 | `get_trade_detail_data(acct, type, 'order'\|'deal'\|'position'\|'account')` |
| 信用 | `get_assure_contract / query_credit_account / query_credit_detail / query_stk_compacts / query_credit_subjects / query_credit_slo_code / query_credit_assure` |
| 撤单 | `cancel(orderSysID, account, accountType, ContextInfo)` |
| 算法 | `algo_passorder(..., userparam)` / `smart_algo_passorder` |
| 篮子 | `set_basket({'name':..., 'stocks':[...]})` |
| 调度 | `C.schedule_run(fn, start, n, delta, group)` / `C.cancel_schedule_run(group)` |
| 时间 | `timetag_to_datetime(timetag, fmt)` / `C.get_bar_timetag(barpos)` |
| 扩展 | `create_extend_data / reset_extend_data_stock_list / set_extend_data_value` |
| 账户 | `C.set_account(account)` |

### `run_time` 时间格式

`"1nSecond"` / `"3nSecond"` / `"5nSecond"` — nSecond 表示秒级间隔。

来源：[start_now.html §六 定时任务](https://dict.thinktrader.net/innerApi/start_now.html)。

---

## 十、常踩的坑（按出现频率排序）

### 1. 第三方库被白名单挡

```
ImportError: Forbidden: Module openpyxl not in whitelist!
```

→ 券商后台开启白名单控制；**联系所属券商**开通。

### 2. `pandas` 找不到 / 报错

- `NameError: name 'pandas' is not defined` → `设置-模型设置` 的路径错误，正确路径应为 `{安装目录}\bin.x64`
- `AttributeError: module 'pandas' has no attribute 'core'` → 导入被中断，**重启客户端**

### 3. 策略自动启动运行

- 没勾"终端启动后自动运行"，策略仍自动启动 → 右上角"恢复默认布局" + 重启客户端
- 交易日切换 / 行情断线重连时所有挂着的模型会**重新运行**（正常）

### 4. 对手价 / 全推 5 档盘口

- `passorder(prType=14)` 报"对手价无效"
- `get_full_tick / subscribe_whole_quote` 拿不到 5 档

→ 改行情源对应**全推行情级别**为五档。

### 5. handlebar 是逐 K 线生效，**不是逐 tick**

- 股票 tick 是 3s 一次 → `handlebar` 调用间隔 3s
- 期货 tick 是 0.5s 一次，但**主图是股票**时 `handlebar` 仍 3s 一次

**解决**：跑期货 tick 策略时
- 把主图设为期货品种
- 或改用 `run_time("f", "1nSecond", ...)`
- 或改用 `subscribe_quote` 回调

### 6. 非交易时段 `handlebar` 也会触发

行情服务重启时客户端会重新订阅并推送一次到上层策略。可以加 `if now < '093000' or now > '150000': return` 过滤。

### 7. 下单立即返回，回报走本地缓存

- `passorder(quickTrade=2)` 立刻发出委托，立刻返回，**不等待回报，不阻塞线程**
- 客户端本地缓存定期接收柜台推送刷新：**有交易主推 50ms 一次，无主推 1–6s 一次**
- `get_trade_detail_data` 查到的状态**不等于柜台实时状态**——卖出后立刻查可能查不到委托

**结论**：实盘策略必须有"盘中保存 / 更新委托状态"机制（如 `waiting_dict` 防止超单）。

### 8. 同一线程

**所有策略在同一个线程**跑，任意策略 `sleep / 死循环 / 加锁` 会卡全局。要并行 → 走**极简模式** + `xtquant` 库。

### 9. 下单失败排查

1. 是否在"模型交易"界面、实盘模式运行（模拟模式只显示信号）
2. 是否用了 `quickTrade`：默认 `0` 在日线以上周期**全天不会委托**；`1` 在历史 bar 上不委托；`2` 任何时候都委托
3. 客户端左下角消息提示是否有报错

### 10. 回测撮合规则

- 指定价格在当前 K 线高低点之间 → 按指定价格撮合
- 超过高低点 → 按当前 K 线收盘价撮合
- 委托数量 > 可用数量 → 按可用数量撮合

回测必须以**副图模式**执行，不要主图 / 主图叠加。

### 11. 科创板 / 创业板 / 主板单笔上限

| 板块 | 限价 | 市价 | 递增 |
|---|---|---|---|
| 科创板 | 10 万股 | 5 万股 | 200 股起，1 股递增（盘后定价 100 万股） |
| 创业板 | 30 万股 | 15 万股 | 100 股起，100 递增 |
| 主板（6 / 0 开头） | 100 万股 | — | 100 股起，100 递增 |

实盘撮合以交易所为准：**股票价格不能超过 2% 价格笼子否则废单**，数量超可用也废单。

### 12. 证券状态 `openint` 编码

| 时段（沪市） | 状态 | 编码 |
|---|---|---|
| 9:15–9:25 | 盘前集合竞价 | 12 |
| 9:25–14:57 | 盘中连续竞价 | 13 |
| 14:57–15:00 | 盘后集合竞价 | 18 |
| 15:00 | 收盘 | 15 |
| 15:05–15:30 | 盘后定价 | 22 |
| 15:30 | 盘后定价结束 | 23 |

深市在 9:25–9:30 与 11:30–13:00 是休市（编码 14），其余与沪市相同。

### 13. 过期合约 ERROR

```
[系统]ERROR：******.** 获取合约乘数和最小变动价位失败，跳过
```

→ 右下角"行情 → 智能下载 → 勾选过期合约列表 → 开始"。

### 14. 日志位置

| 形态 | 路径 |
|---|---|
| 投研 | `{安装目录}/userdata/log` |
| QMT | `{安装目录}/userdata/log` |
| 极简模式 | `{安装目录}/userdata_mini/log` |

| 文件 | 内容 |
|---|---|
| `XtClient_<date>.log` | 客户端常规日志 |
| `XtClient_datasource_<date>.log` | 行情数据日志 |
| `XtClient_Formula_<date>.log` | 策略运行日志 |
| `XtClient_FormulaOutput.log` | 策略输出日志 |
| `XtClient_PerformanceFile_<date>.log` | 客户端流程节点日志 |
| `XtMiniQuote_<date>.log` | 行情策略模块日志 |
| `XtMiniQmt_<date>.log` | 客户端常规日志 |
| `XtMiniQmt_perform_<date>.log` | 客户端流程节点日志 |

来源：[question_answer.html](https://dict.thinktrader.net/innerApi/question_answer.html) 全文 + [interface_operation.html §软件运行日志相关](https://dict.thinktrader.net/innerApi/interface_operation.html)。

---

## 十一、UI / 界面要点

### 新建策略三种入口

1. 【模型研究】→ 点击预置示例后方"编辑"按钮
2. 【模型研究】→ 新建模型 → Python 模型
3. 【模型管理】面板右键 → 新建模型 → Python 模型

### 策略编辑器必填项

- 第一行必须有 `#coding:gbk`
- 缩进必须统一（`····` 或 `->`）
- `init` 与 `handlebar` 必填
- `init` 中初始化、`ContextInfo` 对象中传递
- `handlebar` 随历史 K 线 + 盘中 tick 触发

### 基本信息字段

名称 / 快捷码 / 说明 / 分类 / 位置（副图 / 主图叠加 / 主图）/ 默认周期 / 默认品种 / 复权方式 / 快速计算 / 刷新间隔 / 加密公式 / 凭密码导出公式 / 用法注释

### 回测参数字段

开始时间 / 结束时间 / 基准 / 初始资金 / 保证金比例 / 滑点 / 手续费类型 / 买入印花税 / 卖出印花税 / 最低佣金 / 买入佣金 / 平昨佣金 / 平今佣金 / 最大成交比例

### 运行 vs 回测

| 模式 | 数据源 | 是否下单 |
|---|---|---|
| 回测 | 历史行情 | 否（撮合） |
| 运行 | 实时行情 | 否（仅信号） |
| 模型交易 - 模拟信号 | 实时行情 | 否（仅信号） |
| 模型交易 - 实盘交易 | 实时行情 | **是** |

### 关闭运行中策略

- 副图：主图下方副图区域关闭
- 主图叠加：主图右键取消叠加
- 主图：键盘精灵输入 `KLINE`
- 任意：策略编辑器上方停止按钮

### 编译按钮

**Python 策略中"编译"只起保存功能**，不检查语法 / 引用正误。运行报错会显示在日志输出面板。

### 独立 Python 进程

勾选"独立 Python 进程"后，**代码作为 main 脚本执行，不会触发 `init / handlebar`**。未勾选则系统 `import` 策略按规则触发。

> ⚠️ 充分理解前**不建议开启**。

### 策略编辑器快捷键

`Ctrl+C / X / V / Z / Y / A / F / D / L / T / S / Q(多行注释)`

### 操作界面快捷键

`SHIFT+Q(分时K线附图变量查看器) / SHIFT+G / SHIFT+L / SHIFT+S / CTRL+Windows(多屏) / CTRL+O / CTRL+Z / CTRL+M / CTRL+X / CTRL+←/→ / CTRL+R / CTRL+V/B(切复权) / CTRL+A / CTRL+E / ALT+1–9 / ALT+←/→ / F3 / F4 / F5 / F6 / F8 / F10`

来源：[interface_operation.html](https://dict.thinktrader.net/innerApi/interface_operation.html) 全文。

---

## 十二、跨页主题速查表（"我想做…")

| 我想做… | 用… |
|---|---|
| 双均线回测 | `handlebar` + `get_market_data_ex(subscribe=False)` + `passorder(23/24, 1101, ..., quickTrade=0)` + `ContextInfo` 存状态 |
| 双均线实盘 | `handlebar` + `C.is_last_bar()` 跳过历史 + 全局 class 存委托状态（`waiting_list`）+ `passorder(..., quickTrade=2)` |
| 全市场 tick 计算 | `run_time("f", "3nSecond", ...)` + `get_full_tick(get_stock_list_in_sector("沪深A股"))` |
| 盘后回测 | `download_history_data` 先下载，`get_local_data` 取数据 |
| 委托状态机 | `m_strRemark` 作 key，`m_nOrderStatus` 作 value，`waiting_dict` 阻塞超单 |
| 期货 tick 策略 | 把主图切期货，否则改用 `run_time` 或 `subscribe` |
| Level-2 十档 / 逐笔 | `subscribe_quote(stock, period='l2quote'\|'l2transaction'\|'l2order'\|'l2transactioncount'\|'l2quoteaux'\|'l2orderqueue', callback=fn)` |
| 调仓到目标 | 见 `调整至目标持仓` Demo：超时撤单 + 资金检查 + 可用股数 min |
| 立刻下单 | `after_init / run_time / subscribe` 回调中，`quickTrade=2` |
| 错单排查 | 查 `{安装目录}/userdata/log/XtClient_Formula*.log` 或 `userdata_mini/log/XtMiniQuote*.log` |
| 涨停开板卖 | `if high_price == stop_price and current_price < stop_price: ...` |
| 立刻止盈止损 | `if rate < -0.1: passorder(sell_code, ..., prType=14, ...)` |
| 集合竞价下单 | `run_time("f", "5nSecond", ...)` + `if '092500' >= now >= '091500': passorder(..., quickTrade=2)` |
| 期货主连回测 | `rb00.SF` / `rbJQ00.SF`（**仅回测模式**） |
| 写扩展数据 | `create_extend_data / reset_extend_data_stock_list / set_extend_data_value` |
| 拉新股 | `get_ipo_data("STOCK")` + `passorder(23, 1101, account, stock, 11, ipo_price, maxPurchaseNum, ..., 2, stock, C)` |
| 用 Lv1 全推统计市场涨跌 | `run_time` 1 分钟一次 + `get_full_tick` + `openInt != 1` 过滤停牌 |

---

## 十三、券商接入 / 账号

### 模拟账号格式（迅投模拟柜台）

| 市场 | 格式 |
|---|---|
| 股票 | `200xxxx` |
| 期货 | `100xxxx` |
| 期权 | `600xxxx` |

### 获取模拟账号

1. [xuntou.net 注册](https://xuntou.net/#/signup) → [用户中心](https://xuntou.net/#/home) → "模拟撮合" → 拿到投研模拟账号
2. 新用户注册投研账号可获 **14 天模拟仿真交易体验**
3. **VIP 权限用户**可通过"用户中心 - 下载中心"的客户端进行**股票 / 期货 / 股票期权**模拟交易

### 券商 QMT

券商提供的 QMT 终端**模拟账号通常联系所属券商**。

来源：[interface_operation.html §配置/获取模拟账号](https://dict.thinktrader.net/innerApi/interface_operation.html) + [interface_operation.html §配置账号](https://dict.thinktrader.net/innerApi/interface_operation.html)。

---

## 十四、已知未覆盖 / 待读

下列链接出现在本次 5 页正文里，但**未直接挂在 start_now.html 的链接清单中**，因此未读：

- [`data_function.html`](https://dict.thinktrader.net/innerApi/data_function.html) — get_market_data_ex / subscribe_quote 等详细签名页（被 question_answer.html / code_examples.html 多处锚点引用）
- [`data_structure.html`](https://dict.thinktrader.net/innerApi/data_structure.html) — 行情回调字段说明
- [`system_function.html`](https://dict.thinktrader.net/innerApi/system_function.html) — schedule_run 等系统函数详细页
- [`dictionary/future.html`](https://dict.thinktrader.net/dictionary/future.html) — 期货数据（含主连 / 加权合约代码表）

如需补全这部分文档或要把本文档迁移到 `specs/tech_docs/`，告诉我。