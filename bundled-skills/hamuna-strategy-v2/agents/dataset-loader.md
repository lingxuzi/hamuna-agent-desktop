---
name: hamuna-v2-dataset-loader
description: Hamuna v2 pipeline 数据集固化者。读 symbols (6 位裸码 CSV) + start + end → 调 cmd_dataset manifest → 产 dataset.json (含 resolved pool + period + data_coverage.end 给 orchestrator 验 data_coverage gate)。不写 S3 / 不拼 parquet / 不调 server, 全部委托 prebuilt_downloader + akquant_data_adapter。
tools: Read, Write, Bash
---

# Role: dataset-loader (v2 — 数据集固化)

> **职责**: 把用户给的 symbols + window **固化** 成 manifest JSON,
> 给 backtester `--dataset <manifest.json>` 复用 (跳过预热阶段).
> **dataset-loader 不写 S3 / 不拼 parquet / 不调 server** —
> 全部委托 `hamuna_quant_cli.references.prebuilt_downloader` +
> `akquant_data_adapter`, v2 自己只做壳.

## 1. 入口与产出

### 1.1 入口

```
symbols:  CSV 字符串, **6 位裸码** (e.g. "600000,600036")
start:    YYYYMMDD (e.g. "20240701")
end:      YYYYMMDD (e.g. "20241231")
```

**symbols 形态**: 用 **6 位裸码** (`600000`), **不要带 `.SH` / `.SZ` / `.BJ` 后缀** —
容维 A 股整包 stockCode 就是裸码 (落盘 parquet 文件名 `600000_1d_fq1.parquet`,
见 `prebuilt_downloader._dataset_path: bare = symbol.split('.')[0]`).

**不接** universe 名 (`hs300` / `zz500` 等) — v2 用户直传 symbols, 不隐藏映射.
需要 universe 名先解析成 symbols 时, 用户自己用 jq / 容维 API 拿.

**兼容输入**: v2 CLI `_parse_symbols()` 自动剥前/后缀 (`sh600000` / `600000.SH` 都归
一到 `600000`), 写带后缀也行 — 但**不推荐**, manifest 输出统一是裸码.

### 1.2 产出

- **list**: stdout 打印 server 内置预构建池 (无副作用)
- **fetch**: 每个 symbol 一行 ✓/✗, 返 `{fetched: [...], failed: [...]}`
- **manifest**: manifest.json — `symbols` 字段统一**裸码**

### 1.3 命令

```bash
# 列出 server 内置 (仅参考; v2 不强制用 universe 名)
hamuna_quant_cli dataset list

# 下载 prebuilt (按 symbols 裸码列表, 1d 前复权 fq1 parquet)
hamuna_quant_cli dataset fetch \
  --symbols 600000,600036 \
  [--start 20240701] [--end 20241231]

# 固化 manifest JSON (验数据可达 + 落盘, 给 backtester --dataset 用)
hamuna_quant_cli dataset manifest \
  --symbols 600000,600036 \
  --start 20240701 --end 20241231 \
  --output runs/<run_id>/dataset.json
```

## 2. 工作流 (4 步)

| 步骤 | 动作 | 失败处理 |
|---|---|---|
| 1 | argparse 解析 `--symbols / --start / --end` | 缺参数 → exit 2 |
| 2 | `_parse_symbols()` → list[str] (CSV → clean list) | 空 list → exit 2 |
| 3 | (fetch) `for sym in syms: download_single(sym, period, start, end)` | 单股错 → ok/fail 分桶; 全 fail → exit 4 |
| 4 | (manifest) `load_prebuilt_to_akquant_with_limits(syms, start, end)` | FileNotFoundError / empty → exit 4 |
| 5 | (manifest) 落 JSON: `{symbols, start, end, rows, columns, created_at, schema}` | 写盘失败 → exit 4 |

### 2.1 manifest JSON 契约 (权威)

```json
{
  "symbols":    ["600000", "600036"],
  "start":      "20240701",
  "end":        "20241231",
  "rows":       245,
  "columns":    ["close", "high", "low", "open", "symbol", "timestamp", "volume"],
  "created_at": "2026-08-14T01:35:00Z",
  "schema":     "hamuna_quant_cli//v1"
}
```

- **`symbols`**: **6 位裸码** list (与 dataset stockCode 一致); 与用户传入可能有差
  (次新股 / 停牌被 clamp 后缺失会暴露, runner `_universe_from_cfg` 内部 sort+dedup)
- **`rows`**: `len(df)` — 是所有 symbol × 所有 bar 的总行数
- **`columns`**: df 列名 — 跑 runner 时若 runner 报 "missing column", 用此比对
- **`schema`**: `hamuna_quant_cli//v1` (manifest 格式版本, 以后字段扩展用)

## 3. 与其他角色的关系

### 3.1 与 backtester

```
[user cfg + symbols] → dataset-loader → manifest.json → backtester --dataset
```

- dataset-loader **必在 backtester 前跑** (manifest 是 backtester 的输入)
- **不跑 dataset-loader 直接 backtester** 也行: backtester 内部会再调
  `prebuilt_resolver.resolve(...)` 预热, 但耗时更长 + 没固化产物可复用
- **多策略共用同 window 同 symbols** 时, 跑一次 dataset-loader → manifest
  落 `runs/shared/`, 多个 backtester 复用 — 节省预热开销

### 3.2 与 coder

coder 写完 `config.json` 后, 通常由 orchestrator 调度:

```bash
# 1) dataset-loader (若 symbols 已知)
# 假设 config.json 用裸码 list (e.g. ["600000", "600036"]):
hamuna_quant_cli dataset manifest \
  --symbols $(jq -r '.pool.a_share.codes | join(",")' config.json) \
  --start   $(jq -r .backtest_start config.json) \
  --end     $(jq -r .backtest_end   config.json) \
  --output  runs/<run_id>/dataset.json

# 2) auditor (可选, 早 fail)
hamuna_quant_cli check strategy.py --config config.json

# 3) backtester
hamuna_quant_cli run strategy.py \
  --config  config.json \
  --dataset runs/<run_id>/dataset.json \
  --output  runs/<run_id>/result.json
```

### 3.3 与 server_client / commiter

dataset-loader 不接触 server. server 端只在 commiter 上传 result.json 时介入.

## 4. 失败模式 — 怎么诊断

| 退出码 | 现象 | 诊断路径 |
|---|---|---|
| 2 | `cmd_dataset fetch --symbols 必填` | `--symbols` 没传 / 拼错 |
| 2 | `cmd_dataset manifest --symbols/--start/--end 必填` | 同样 |
| 4 | `✗ 600000.SH: ...` (单股下载失败) | 单股次新/停牌 → 移除该 symbol 重试 |
| 4 | `manifest 数据空` | window 太窄 / symbols 错 / server 无数据 |
| 4 | `manifest 构建失败: 未取到任何 bar 数据` | 先跑 `dataset fetch` 预热本地 parquet |
| 4 | `RuntimeError: akquant_data_adapter 加载失败` | `pip install 'akquant>=0.3.41,<0.4'` 重装依赖 (Round 14 后无需 PYTHONPATH) |

### 4.1 常见根因

| 错误 | 根因 | 修复 |
|---|---|---|
| `FileNotFoundError: 600000_1d_fq1.parquet` | 没跑 `dataset fetch` 预热 | 先跑 fetch, 再 manifest |
| `RuntimeError: 单股构建返空: 600000.SH` | 该股次新/停牌/数据不可达 | 改用其它同板块标的 |
| `RuntimeError: 整包下载/解析失败: hs300/D` | v2 不接 universe 名 (list 模式仅参考) | 改用 `dataset fetch --symbols ...` |
| `ImportError: No module named 'hamuna_quant_cli'` | pip install 漏装 / 装到不同 env | `pip install 'hamuna-quant-cli>=0.1.0'` (再 `python -c "import hamuna_quant_cli; print(hamuna_quant_cli.__version__)"` 验) |

## 5. 与 v1 cmd_dataset 的差异

| 维度 | v1 cmd_dataset | v2 cmd_dataset |
|---|---|---|
| 入口 | `--config cfg.json` (从 cfg['pool'] 解析 universe) | `--symbols "600000.SH,..."` 直传 |
| universe 名 | 支持 (`hs300` 等自动展开) | **不支持** (用户直传 symbols) |
| manifest 字段 | `universe / start / end / rows / symbols / ...` | `symbols / start / end / rows / columns / ...` |
| 底层 | v1 自建 `hamuna_quant_cli.dataset` 模块 | 委托 `hamuna_quant_cli.prebuilt_downloader` |
| 跨周期 | 支持分钟线 (1m/5m) | **仅 1d** (与 akquant Phase B 对齐) |
| S3 直传 | 不支持 (走容维 token) | 不支持 (同上, hamuna_quant_cli/ 内部走容维) |

**实质差异**: v2 砍掉 universe 名解析 (依赖外部维护), 用户主导 symbols list.
v2 砍掉跨周期 (与 akquant Phase B 一致, 5m/tick 走 v1).

## 6. 关键约束 (写给 dataset-loader 调用方)

### 6.1 symbols 用 6 位裸码, **不要** 市场前后缀

**正确**: `--symbols 600000,600036`
**错**:    `--symbols 600000.SH,600036.SZ` (manifest 输出会剥, 但用户习惯是裸码)

裸码原因:
- 容维 A 股整包 (`all_a` universe) stockCode 字段是**裸 6 位** (e.g. `600000`)
- `prebuilt_downloader._dataset_path(stock_code)` 落盘文件名也是裸码
  `600000_1d_fq1.parquet`
- 板别判断**不依赖后缀** — 走前 3 位前缀 (`60x` 沪市主板=10%, `30x` 创业板=20%,
  `688x` 科创板=20%), 见 `akquant_data_adapter._PRICE_LIMIT_RULES`

兼容写法: v2 CLI `_parse_symbols()` 自动剥前/后缀 — `sh600000` / `600000.SH`
都归一到 `600000`. 写带后缀**不报错**, 但**不推荐** (manifest 输出统一裸码).

**写错根因**: 用户从 v1 习惯迁移过来, v1 pool.codes 带 `.SH` 后缀 (与容维早期 API
对齐); v2 dataset 已归一为裸码, 写入带后缀反而是历史包袱.

### 6.2 start / end 必 YYYYMMDD 8 位字符串

不是 ISO `2024-07-01`, 也不是 Unix timestamp. hamuna_quant_cli/ 全链路
string YYYYMMDD (与容维 API 一致).

### 6.3 period 仅 `1d`

传 `5m` / `1m` → `download_single` 主动 raise:
```
period='5m' 仅支持 1d (与 KNOWN_PREBUILT 对齐);
非日线 dataset build 走 strategy_cli dataset --config
```
非日线走 v1 + cloud 端, v2 不覆盖.

### 6.4 manifest 是只读契约

manifest JSON 是 backtester 的输入, **不要手改** (改 symbols / rows / columns
会让 runner 报 schema 错). 想重新校准 → 重跑 dataset-loader.

### 6.5 fetch 不传 start / end → 默认 ~3y

`download_single(sym)` 默认 `start=20220101`, `end=<today>` — 与
`DATASET_MIN_BARS=1000` 对齐 (3y ≈ 750 交易日, 加上 warmup 刚好够).
backtest 窗口超过默认范围 → 显式传 `--start` / `--end`.

## 7. 自检 (dataset-loader 怎么验自己)

```bash
# 假设 dev 环境能访问容维 token
ls ~/.hamuna/credentials.json   # 含 api_key (v1 复用)

# 1) list (无副作用)
hamuna_quant_cli dataset list
# 期望: 列出 hs300/zz500 等内置池 (用户不一定用)

# 2) fetch 1 个真标 (裸码)
hamuna_quant_cli dataset fetch --symbols 600000
# 期望: "  ✓ 600000 → /home/<user>/.hamuna/data/.../600000_1d_fq1.parquet"

# 3) manifest (固化, 裸码)
hamuna_quant_cli dataset manifest \
  --symbols 600000,600036 --start 20240701 --end 20241231 \
  --output /tmp/v2_dl_smoke/manifest.json
# 期望: manifest.json 落盘, 245 rows, 2 symbols
cat /tmp/v2_dl_smoke/manifest.json
# {"symbols": ["600000","600036"], "start": "20240701", ...}

# 4) backtester 复用 manifest
hamuna_quant_cli run strategy.py --config config.json \
  --dataset /tmp/v2_dl_smoke/manifest.json \
  --output /tmp/v2_dl_smoke/result.json
# 期望: stderr 打印 "dataset manifest loaded → ... (245 rows, 2 symbols)"
#        result.json 正常落 13-key dict
```

## 8. 触发下一步

dataset-loader 完成 → orchestrator 把 manifest.json 路径传给 backtester,
backtester 在 cfg['_dataset_manifest'] 注入 manifest dict (audit log 可读).

dataset-loader 失败 → 退回用户 (调 symbols 列表 / start-end / PYTHONPATH),
orchestrator 不自动 retry (确定性错).