# trading-rules — strategy_cli CONFIG 交易规则权威定义 (v2)

> **谁消费**: `strategy_cli.runtime.backtest.run` 把 cfg 透传给
> `akquant_runner.run_akquant_backtest`, runner 把字段映射给 `akquant.run_backtest`
> 的 kwargs (commission_rate / stamp_tax_rate / min_commission / slippage /
> volume_limit_pct / t_plus_one). **v2 不重新实现交易规则** — 全部走 akquant 0.3.x.
>
> **本文档定位**: 给前端用户 / auditor / coder 查每个字段的真实语义 + 默认值 + 边界,
> 不是实现说明. 实现见 `akquant_runner.run_akquant_backtest:114-138`.

## 1. T+1 规则 (`t_plus_one`)

A 股核心规则: **当日买入次日才能卖出**. 默认 `True`, 关掉等于允许日内的 T+0,
拿不到真实收益.

```json
{"t_plus_one": true}
```

- 默认: `True` (A 股规则)
- 适用: A 股策略 (60x / 00x / 30x / 688x) 必 `True`
- 关掉场景: 港股 / 美股 / 商品期货 / 数字货币 (这些市场 T+0)
- 实战坑: 关掉后高频策略会拿到 10x 收益 (假), 别被回测骗

### 1.1 在 akquant 内部如何落地

`akquant.run_backtest(t_plus_one=True)` 内部:
- `buy` 当日只增 `position_total`, 不增 `position_available`
- 卖出时只卖 `position_available` (= `position_total - 当日买量`)
- `on_bar` 内若 `bar.timestamp.date() == buy_date` → 卖单被拒

### 1.2 与 v1 差异

v1 也默认 `t_plus_one=True`, 同语义. **无差异**.

## 2. 涨跌停 (`price_limit_clamp`)

A 股每交易日个股价格波动有边界 (主板 ±10%, 创业板 / 科创板 ±20%). v2 默认
**clamp 兜底** — 把 `high / low` 收紧到上一交易日 close × (1 ± limit).

```json
{"price_limit_clamp": true}
```

### 2.1 板别规则 (权威)

| 股票前缀 | 市场 | 涨跌停上限 | 来源 |
|---|---|---|---|
| `600xxx`, `601xxx`, `603xxx`, `605xxx` | 沪市主板 | 10% | 上交所交易规则 |
| `000xxx`, `001xxx`, `002xxx`, `003xxx` | 深市主板 | 10% | 深交所交易规则 |
| `300xxx`, `301xxx` | 创业板 | 20% | 深交所创业板规则 |
| `688xxx`, `689xxx` | 科创板 | 20% | 上交所科创板规则 |
| ST / *ST 股 | — | 5% | **不在 v2 默认覆盖** (需手工 cfg 覆盖) |
| 停牌 / 次新股 | — | — | 数据缺失, runner 报错 |

完整规则见 `akquant_data_adapter._PRICE_LIMIT_RULES`.

### 2.2 clamp 实现

`akquant_data_adapter.load_prebuilt_to_akquant_with_limits`:

```python
limits = {sym: detect_price_limit(sym) for sym in df['symbol'].unique()}
# 按 symbol groupby, 取上一交易日 close × (1 ± limit)
prev_close = df.groupby('symbol', sort=False)['close'].shift(1)
upper = prev_close * (1 + limits_s)
lower = prev_close * (1 - limits_s)
df['high'] = df['high'].clip(upper=upper)
df['low'] = df['low'].clip(lower=lower)
```

**clamp 只动 high / low**, open / close 不动 (成交价走 OHLCV 自然).
实测 5004 syms × 1.8M rows: 原 56s → 0.4s.

### 2.3 何时关 (`price_limit_clamp: false`)

```json
{"price_limit_clamp": false}
```

- **不推荐** — 关掉会拿到超出涨跌停的虚假成交价
- akquant 0.3.x 实测不原生拒单 (Q1 探针: orders=1, rejected=0)
- 学术研究 / 量化对比场景: 想严格对齐 akquant 原生撮合 (无 clamp)
- 单元测试: 想验 akquant 自身是否拒单 → 短暂关掉看 orders 状态

### 2.4 ST / *ST 5% 不在默认覆盖

`_PRICE_LIMIT_RULES` 不含 ST 规则. ST 股需用户在策略**内**手工判断:

```python
def on_bar(self, bar):
    # 自识别 ST: 通常 stockName 含 'ST' / '*ST' (需 stockName 列)
    # 数据层不带 ST flag, 业务层做
    ...
```

不推荐把 ST 规则写进全局 cfg (不是所有策略都要 ST 5%). 默认按板别 +10% / +20%.

## 3. 印花税 (`stamp_tax_rate`)

A 股印花税**仅卖出**征收 (单向). 默认 `0.001` (千分之一).

```json
{"stamp_tax_rate": 0.001}
```

- 默认: `0.001` (1‰, 卖出单边)
- 实际: 2023-08 后降到 `0.0005` (0.5‰) — 想精确回测改 0.0005
- 历史: 2008-09 从 3‰ → 1‰, 2023-08 → 0.5‰
- 影响: 高换手策略 (T+1 也救不了) 印花税占比大 (年化 5-10%)

### 3.1 与 v1 差异

**v1 默认 0** (印花税没收), v2 默认 `0.001`. v2 用户从 v1 迁过来时若不改 cfg,
结果会比 v1 略低 (扣税了). 这是**正确**的 (v1 是 bug).

| 字段 | v1 默认 | v2 默认 | 修复 v1 误 |
|---|---|---|---|
| `stamp_tax_rate` | `0` (bug) | `0.001` | 显式设 `0.001` (或 `0.0005` 对齐 2023-08 后) |

## 4. 佣金 (`commission_rate` + `min_commission`)

A 股佣金**双边**征收 (买 + 卖), 默认 `0.0003` (万分之三).

```json
{
  "commission_rate": 0.0003,
  "min_commission":  5.0
}
```

- `commission_rate` 默认: `0.0003` (万三, 双边)
- `min_commission` 默认: `5.0` 元/笔 (最低收费)
- 实际散户: 万 1.5 ~ 万 3 (大部分券商可谈)
- 机构户: 万 0.5 ~ 万 1
- 公式: `每笔佣金 = max(成交额 × rate, min_commission)`

### 4.1 与 v1 差异

v1 默认 `commission_rate=0.0003`, `min_commission=5.0` — **同**. 无差异.

## 5. 滑点 (`slippage`)

撮合价偏离市价的损耗. v2 默认 `0.001` (0.1% 单边).

```json
{"slippage": 0.001}
```

或 dict 形态 (akquant 0.3.x+ 强制):

```json
{"slippage": {"type": "percent", "value": 0.001}}
```

- 默认: `0.001` (即 0.1% 单边; 买贵 0.1%, 卖便宜 0.1%, 一来回 0.2%)
- runner 自动转: `float → {"type": "percent", "value": float(slippage)}`
- akquant 0.3.x+ **deprecate bare float**, 强制 dict 形态 (v2 runner 兼容)

### 5.1 实战建议

| 策略类型 | 建议滑点 |
|---|---|
| 中长线 (周频 / 月频) | 0.001 (默认) |
| 日内 (T+1 关掉场景) | 0.002 ~ 0.005 |
| 高频 (分钟 / tick) | 0.005 ~ 0.01 (实际不可达, 通常需穿透撮合层) |
| 大资金 (单笔 > 1% volume) | 0.005+ (市场冲击) |

### 5.2 关滑点 (`slippage: 0`)

```json
{"slippage": 0}
```

- 理想撮合 (市价单 = 中间价成交)
- 实盘不可达 — 实测单边 0.05% 起 (大单更甚)
- 学术研究 / 性能上限估算可短暂设 0

### 5.3 与 v1 差异

v1 `slippage` 默认 0 (bug). v2 默认 `0.001`. 同 §3.1 — v2 修了 v1 bug.

## 6. 单笔成交量上限 (`volume_limit_pct`)

防止单笔吃掉当日所有流动性. 默认 `0.25` (单笔 ≤ 25% 日成交量).

```json
{"volume_limit_pct": 0.25}
```

- 默认: `0.25` (akquant 防吃流动性)
- 含义: 单笔下单 ≤ 当日该股成交量 × 25%
- 大资金场景: 调到 0.05 ~ 0.1 (更保守)
- 高频 + 小资金: 0.25 够用

### 6.1 与 v1 差异

v1 **没有此字段** (v1 自建撮合层不强制). v2 用 akquant `volume_limit_pct` 防
"瞬时吃掉流动性" — 这是 v2 防虚高的额外保障.

## 7. 执行模式 (`execution_mode`)

akquant 0.3.x 默认 `NextOpen` (下一 Bar 开盘成交). v2 不暴露 cfg 字段 — runner
**固定**用默认.

```python
akquant.run_backtest(...)  # 默认 execution_mode='NextOpen'
```

- `NextOpen`: 当 bar close 触发下单, 下一 bar open 成交 — **最常见**, 推荐
- `CurrentClose`: 当 bar close 触发下单, 当前 bar close 成交 — **理想撮合**
  (实盘不可达, 仅学术研究)
- v2 锁 `NextOpen` (与实盘一致)

## 8. 总结: cfg 字段 ↔ 交易规则映射

| cfg 字段 | 默认 | 交易规则 | 关掉影响 |
|---|---|---|---|
| `t_plus_one` | True | A 股 T+1 | 高频策略假收益 ×10 |
| `price_limit_clamp` | True | 涨跌停 clamp | 拿到超出涨跌停的虚价 |
| `stamp_tax_rate` | 0.001 | 印花税 (卖出) | 高换手策略偏乐观 |
| `commission_rate` | 0.0003 | 佣金 (双边) | 高换手策略偏乐观 |
| `min_commission` | 5.0 | 最低佣金 | 小资金偏乐观 |
| `slippage` | 0.001 | 滑点 (单边) | 偏乐观 |
| `volume_limit_pct` | 0.25 | 单笔吃流动性上限 | 大资金偏乐观 |
| `execution_mode` | NextOpen (固定) | 撮合时点 | — |

## 9. 实战配置推荐

### 9.1 低频中长线 (周频 / 月频)

```json
{
  "init_capital": 1000000.0,
  "commission_rate": 0.0003,
  "stamp_tax_rate":  0.0005,
  "slippage":        0.001,
  "volume_limit_pct": 0.10,
  "t_plus_one":      true,
  "price_limit_clamp": true
}
```

调 `volume_limit_pct=0.10` (更保守, 中长线策略常建大仓).

### 9.2 日内策略 (T+1 关)

```json
{
  "init_capital": 500000.0,
  "commission_rate": 0.0003,
  "stamp_tax_rate":  0.0005,
  "slippage":        0.002,
  "volume_limit_pct": 0.25,
  "t_plus_one":      false,
  "price_limit_clamp": true
}
```

注意 `t_plus_one: false` 仅适用港 / 美 / 数字货币 — A 股必 True (违规).

### 9.3 学术对比 (无摩擦)

```json
{
  "commission_rate": 0,
  "stamp_tax_rate":  0,
  "slippage":        0,
  "volume_limit_pct": 1.0,
  "t_plus_one":      true,
  "price_limit_clamp": false
}
```

**仅学术 / 算法对比**, 不是真实回测 — 实盘必含摩擦.

## 10. 与 v1 交易规则总差异

| 维度 | v1 | v2 | 差异根因 |
|---|---|---|---|
| T+1 | 默认 True | 默认 True | 无 |
| 涨跌停 | 默认拒单 (QMT 撮合层) | 默认 clamp + 不拒 | v1 走 QMT 撮合层 (硬拒), v2 走 akquant (软 clamp) |
| 印花税 | **默认 0 (bug)** | 默认 0.001 | v2 修了 v1 bug |
| 佣金率 | 默认 0.0003 | 默认 0.0003 | 无 |
| 最低佣金 | 默认 5.0 | 默认 5.0 | 无 |
| 滑点 | **默认 0 (bug)** | 默认 0.001 | v2 修了 v1 bug |
| 单笔吃流动性 | **无限制 (bug)** | 默认 0.25 上限 | v2 修了 v1 bug |
| 执行模式 | close 成交 (无 NextOpen) | NextOpen (固定) | v2 更贴合实盘 |

**v1 迁移提示**: v1 cfg → v2 cfg 时, 显式补:

```json
{
  "stamp_tax_rate":  0.0005,    // v1 默认 0, v2 默认 0.001, 2023-08 后 0.0005
  "slippage":        0.001,     // v1 默认 0, v2 默认 0.001
  "volume_limit_pct": 0.25,    // v1 无, v2 默认 0.25
  "price_limit_clamp": true    // v1 走 QMT 撮合, v2 默认开
}
```

否则 v2 默认会更悲观 (扣税 + 滑点 + 限流动性).

## 11. 自检 (auditor 怎么验交易规则)

```bash
# 1) 关键字段都在
python3 -c "
import json, sys
c = json.load(open('config.json'))
required_keys = {
    't_plus_one': bool,
    'price_limit_clamp': bool,
    'commission_rate': (int, float),
    'stamp_tax_rate':  (int, float),
    'slippage':        (int, float, dict),
}
miss = [k for k, t in required_keys.items()
        if k not in c or not isinstance(c[k], t)]
if miss:
    sys.exit(f'缺或类型错: {miss}')
print('  ✓ 交易规则字段齐')
"

# 2) A 股场景必 t_plus_one=True
python3 -c "
import json, sys
c = json.load(open('config.json'))
if c.get('t_plus_one') is False:
    codes = c.get('universe') or c.get('pool', {}).get('a_share', {}).get('codes', [])
    a_codes = [c for c in codes if c.startswith(('60','00','30','688'))]
    if a_codes:
        sys.exit(f'⚠ A 股标 {a_codes} 设 t_plus_one=False (违规)')
print('  ✓ t_plus_one 合理')
"

# 3) 印花税对齐 2023-08 后
python3 -c "
import json, sys
c = json.load(open('config.json'))
tax = c.get('stamp_tax_rate', 0.001)
if tax == 0:
    sys.exit('⚠ stamp_tax_rate=0 (v1 bug, v2 默认 0.001, 2023-08 后 0.0005)')
elif tax == 0.001:
    print('  ⚠ stamp_tax_rate=0.001 (历史值, 2023-08 后改 0.0005)')
elif tax == 0.0005:
    print('  ✓ stamp_tax_rate=0.0005 (2023-08 后)')
else:
    print(f'  ⚠ stamp_tax_rate={tax} (非标准值)')
"

# 4) 纪律 self-check (走 cmd_check)
hamuna_quant_cli check strategy.py --config config.json
# 期望: "纪律 self-check 通过 (0 条)"
```