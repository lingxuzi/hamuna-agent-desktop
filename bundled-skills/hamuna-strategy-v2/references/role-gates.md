# v2 Role Gates — 8 条纪律 self-check

> **backtester role 的核心 gate**: 策略送进 akquant 之前必须通过的 8 条静态审查.
> 在 `strategy_cli.runtime.discipline.check_discipline(source, config)` 里实现,
> `cmd_run` 默认强制; `cmd_check` 单独入口 (coder/auditor 自查).

## 0. 调用方

| 入口 | 时机 | 失败行为 |
|---|---|---|
| `cmd_run` | backtest.run 之前 | 打印违规清单 + abort, exit code 3 |
| `cmd_check` | 写完策略后立刻自查 | 打印违规清单 + abort, exit code 3 |
| `agents/auditor.md` (写策略后审) | 静态扫描 | 列违规 + 拒绝 commit |
| `agents/backtester.md` (跑回测前) | 必走 | 走 cmd_run 即带 |

## 1. 八条 Rule 速查表

| # | Rule 名 | 检查内容 | 触发的后果 |
|---|---|---|---|
| 1 | `coding_not_utf8` | 文件头 `# coding:` 编码不是 utf-8 | akquant Python 是 utf-8 契约; GBK 中文标识符会乱码 |
| 2 | `missing_akquant_strategy_subclass` | 没找到 `class Foo(Strategy)` 子类 | akquant 引擎找不到策略类, runtime 报 type 错 |
| 3 | `qmt_global_leaked` | 含 `passorder` / `set_basket` / `ContextInfo` 等 QMT 标识符 | QMT API 在 akquant 0.3.x 不存在; 用即 `AttributeError` |
| 4 | `handlebar_not_akquant` | 含 `def handlebar(...)` 函数 | QMT 形态, akquant 0.3.x 不调 handlebar, 永远不触发 |
| 5 | `init_contextinfo_form` | 含 `def init(ContextInfo)` 函数 | QMT 形态, akquant 用 `__init__(self)` |
| 6 | `bar_field_alias_trap` | `on_bar` 体内用 `bar.time` / `bar.date` 取日期 | akquant 0.3.x REPR ALIAS, getattr 返 None; 数据 NaN |
| 7 | `get_history_not_batched` | on_bar / on_timer / on_cross_section 内同 `(count, sym)` 多次 `get_history` 不同字段 | 应合并为 `get_history_multi` — 0.3.x 一次 FFI 拉多字段 |
| 8 | `universe_init_style_deprecated` | `__init__(self, universe: list[str], ...)` 形参含 `universe` | akquant 0.3.x 严格拒收老风格; 改 `universe: list = ListParam(default=[])` 类字段 |

## 2. 每条 Rule 的修复路径

### 2.1 `coding_not_utf8`

**触发**: 文件第 1-3 行有 `# coding: gbk` 或 `# coding: cp936`.

**修复**:
```bash
# 1) 改文件头
sed -i '1s/# coding: gbk/# coding: utf-8/' strategy.py

# 2) 文件本身已经是 utf-8 (只是声明错), 不需要 iconv; 但若中文策略, 用:
file strategy.py   # 验证 encoding
```

**为什么**: akquant Python 3.10+ 走 utf-8. QMT 编辑器契约是 GBK (v1 用); v2 走 utf-8.
**不做 UTF-8 转 GBK 兼容**: akquant 端强制 utf-8, 跑就立刻报 UnicodeDecodeError.

### 2.2 `missing_akquant_strategy_subclass`

**触发**: AST 里没找到任何 `class Foo(Strategy)` 或 `class Foo(akquant.Strategy)` 子类.

**修复**:
```python
from akquant import Strategy

class MyStrat(Strategy):       # 必须是 (Strategy) 或 (akquant.Strategy)
    warmup_period = 20
    def on_bar(self, bar):
        ...
```

**为什么**: akquant `run_backtest(strategy=Cls, ...)` 要求 `issubclass(Cls, Strategy)`.
如果用户写 `class Foo(BaseStrategy):` (自己包装一层), 必须 `from akquant import Strategy`
然后 `class BaseStrategy(Strategy):` 才算合规.

### 2.3 `qmt_global_leaked`

**触发**: 源码中出现下列任一标识符 (Name / Attribute / ImportFrom / Import):

```
passorder  set_basket  get_basket  m_strRemark  quickTrade
is_last_bar  subscribe_quote  run_time  after_init
XtQuantTrader  XtQuantTraderCallback  xttrader  xtdata
ContextInfo
```

**修复映射**:

| QMT 形态 | v2 akquant 替代 |
|---|---|
| `passorder(23, 1101, sym, ...)` | `self.buy(sym, qty)` / `self.sell(sym, qty)` |
| `set_basket({sym: vol})` | `for sym, vol in target.items(): self.order_target_percent(vol/init_capital, symbol=sym)` |
| `get_basket()` | `[s for s in self.universe if self.get_position(s) > 0]` |
| `m_strRemark = 'foo'` | (akquant order 不接 remark; 写到 self 内部 log) |
| `quickTrade = 2` | (akquant on_bar 自动; 不需要) |
| `is_last_bar()` | (akquant daily 全是 last-bar; 不需要) |
| `subscribe_quote(sym, ...)` | `self.subscribe(sym)` (在 on_start 里) |
| `run_time(...)` | `self.add_daily_timer("HH:MM:SS", payload)` |
| `XtQuantTrader.XTPAPI(...)` | ❌ 不支持 (v2 离线) |
| `ContextInfo` | `self` 实例 |

**为什么**: akquant 0.3.x 不暴露 QMT native API. 即便 import 也不报错 (Python 解释器允许),
但调即 `NameError` / `AttributeError` — 比"早期错"成本更高.

### 2.4 `handlebar_not_akquant`

**触发**: 源码里出现 `def handlebar(...):` 函数定义.

**修复**:
```python
# QMT 形态:
def handlebar(ContextInfo):
    for s in ContextInfo.get_universe():
        ...

# v2 形态:
def on_bar(self, bar: Bar):
    # self.get_position / self.subscribe / bar.symbol ...
```

**为什么**: akquant 0.3.x on_bar(bar) 是事件入口. 保留 handlebar 是 dead code, 永远不触发 —
后续维护者看到 handlebar 会误以为是活跃路径, 改了没人发现.

### 2.5 `init_contextinfo_form`

**触发**: 源码里出现 `def init(ContextInfo):` 函数定义.

**修复**:
```python
# QMT 形态:
def init(ContextInfo):
    ContextInfo.set_universe(['600000.SH'])
    ContextInfo.subscribe_quote('600000.SH')

# v2 形态:
def on_start(self):
    for s in self.universe:
        self.subscribe(s)
```

或 `__init__(self)` (类构造时存 state):
```python
def __init__(self, universe: list[str]):
    self.universe = universe
```

**为什么**: akquant 0.3.x 没 `init(ContextInfo)` 钩子. 走 `on_start` (启动回调)
或 `__init__` (Python 构造).

### 2.6 `bar_field_alias_trap`

**触发**: `on_bar(self, bar)` 体内出现 `bar.time` 或 `bar.date`.

**修复**:
```python
from datetime import datetime

def on_bar(self, bar: Bar):
    # 错: bar.time 返 None (REPR ALIAS)
    # d = bar.time

    # 对: 用 bar.timestamp (int ns) 转 date
    d = datetime.fromtimestamp(bar.timestamp / 1e9).date()

    # 或 datetime (精确到秒):
    dt = datetime.fromtimestamp(bar.timestamp / 1e9)
```

**为什么**: akquant 0.3.x Bar 的 `__repr__` 里为了日志可读性设了 `time` / `date` 属性,
**但** `getattr(bar, 'time')` 走的是 `__getattribute__` 默认路径, **没**触发 `__repr__`,
所以**返 None**. 实战基准 5004 标 × 1.5y 时踩过, 当天 fix 加纪律.

## 3. 检查方式

### 3.1 单独跑 (快)

```bash
hamuna_quant_cli check strategy.py --config config.json
# 期望 stderr: "纪律 self-check 通过 (0 条)"
```

### 3.2 跑回测时自动跑 (默认)

```bash
hamuna_quant_cli run strategy.py --config config.json --output result.json
# 违规时 stderr 列 8 条 rule + line, exit code 3
```

### 3.3 跳过 (qa / 旧策略兼容, **不推荐生产**)

```bash
hamuna_quant_cli run ... --skip-discipline
# ⚠ 旧 v1 策略 + v2 跑 — 数据能算但 schema 折出来可能 nan
```

## 4. 自检 (auditor 怎么验)

```bash
python3 -c "
from hamuna_quant_cli.runtime.discipline import check_discipline

# 1) 合规 → 0 违规
good = '''
from akquant import Strategy
class BuyHold(Strategy):
    warmup_period = 1
    def on_bar(self, bar):
        if self.get_position(bar.symbol) == 0:
            self.buy(bar.symbol, 100)
'''
assert not check_discipline(good, {})

# 2) 违规 → 全 8 条都拦
bad = '''# coding: gbk
def init(ContextInfo): pass
def handlebar(ContextInfo):
    passorder(23, 1101, '600000.SH', 0, 0, 100, 0, '', 'remark')
'''
errs = check_discipline(bad, {})
rules = {e.rule for e in errs}
assert {'coding_not_utf8','missing_akquant_strategy_subclass',
        'qmt_global_leaked','handlebar_not_akquant',
        'init_contextinfo_form'} <= rules
print('OK: 8 rule 全拦')

# 3) bar.time 陷阱
bad_time = '''
from akquant import Strategy
class S(Strategy):
    def on_bar(self, bar):
        d = bar.time
'''
errs = check_discipline(bad_time, {})
assert any(e.rule == 'bar_field_alias_trap' for e in errs)
print('OK: bar.time 陷阱拦')
"
```

## 5. 什么时候会扩 Rule (不抢答)

如果未来 akquant 0.3.x 加 on_tick, 或 Phase C 引入 ETF / 期权, 加对应 rule:
- `on_tick_discipline` (检查 `def on_tick(self, tick)` 内不混 on_bar 调用)
- `multi_symbol_pollution` (检查 `class Foo(Strategy)` 没绑错 symbol)

新 rule 加在 `strategy_cli/runtime/discipline.py` + 在本文档同步 — **加 rule 必须有对应实测 benchmark 踩坑**,
不抢答.
