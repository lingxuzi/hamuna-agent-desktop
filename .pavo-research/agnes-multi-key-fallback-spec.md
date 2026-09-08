# agnes-video-25-mcp · 多 Key Fallback 设计 Spec

> **目标**：让 `agnes-video-25-mcp` server 在 `AGNES_API_KEY` daily quota 撞顶（429）时，自动切换到备用 key。
> **作者**：HamunaAgent maintainer（同步 PyPI `agnes-video-25-mcp`）
> **适用版本**：0.1.3 → 0.1.4
> **日期**：2026-09-08
> **状态**：🔄 Step 1 spec 阶段，待用户审过后进 Step 2 改代码

---

## 1. 问题陈述

### 1.1 现状（server.py 0.1.3）

| 行 | 代码 | 行为 |
|---|---|---|
| 247 | `key = _env("AGNES_API_KEY")` | 单值读取 |
| 251 | `headers = {"Authorization": f"Bearer {key}", ...}` | 单 key 直接 header |
| 257-260 | `except httpx.HTTPStatusError as exc: ... details={"status_code": exc.response.status_code, "body": exc.response.text}` | 错误原样回传，**不区分 401 vs 429** |
| 536-538 | `_wait_impl` 轮询里 `if sc in {429, 503} and attempt < attempts - 1: time.sleep(...); continue` | 客户端轮询层 retry，**也不切 key** |

**真实故障**（2026-09-08 UGC 测试）：`POST /v1/videos` 返回 429 `"Daily API usage limit reached. Please try again after 2026-09-09 00:00."` → server 把 429 错误原样抛给 MCP host → 用户看到 `http_error` 失败 →**整个 pipeline 阻塞到次日 00:00 UTC**。

### 1.2 期望行为（0.1.4 目标）

| 场景 | 期望行为 |
|---|---|
| 单 key 配置 + 成功 | 行为不变（向后兼容） |
| 单 key 配置 + 429 | 行为不变（向上抛错；用户需自己加 key） |
| 多 key 配置（逗号分隔） + key[0] 撞 429 | **自动 fallback key[1]**；key[1] 也撞 → fallback key[2] ...直到所有 key 都撞 → 抛错 |
| 多 key 配置 + key[1] 撞 401 | 立即抛错（401 = key 死了，不是 quota） |
| 多 key 配置 + 所有 key 都撞 429 | 抛错，错误信息列出"X 个 key 全部撞 daily quota" |

---

## 2. Env Schema 设计（向后兼容）

### 2.1 读取优先级

| Env 变量 | 解析逻辑 | 适用场景 |
|---|---|---|
| `AGNES_API_KEYS`（新） | 逗号 `,` 分割 → strip 空白 → 过滤空串 | **多 key 配置（新）** |
| `AGNES_API_KEY`（旧） | 单值字符串 | **单 key 配置（向后兼容）** |

**优先级规则**：如果 `AGNES_API_KEYS` 非空，用它；否则 fallback `AGNES_API_KEY`。**两者都不存在 → 抛 `missing_api_key` 错误**（与现状一致）。

### 2.2 分隔符选择：`,`（逗号）

| 候选 | 优劣 |
|---|---|
| `,` | 易见、JSON / CSV / .env 通用；缺点：key 内含逗号会断 |
| `;` | env 文件里少见；缺点：bash history 截断会把它当命令分隔 |
| 空格 / 换行 | 不靠谱 |

**选择 `,`**。API key 通常是 base64-like 字符（`cpk-xxx`，无逗号），**风险低**。如果有用户 key 含逗号（极少见），他们可以用 `AGNES_API_KEY` 单值绕开。

### 2.3 mcp.json 配置示例（**回滚**之前临时改的多 key env）

之前临时改的 `.mcp.json`：
```json
"env": {
  "AGNES_API_KEY": "key1,key2,key3"
}
```

**0.1.4 后应当改成**（语义清晰）：
```json
"env": {
  "AGNES_API_KEYS": "key1,key2,key3"
}
```

`AGNES_API_KEY` 仍保留单值兼容路径，**已有单 key 用户零迁移**。

---

## 3. Key 池策略

### 3.1 调度算法

**方案 A（推荐）：简单 round-robin + 429-triggered-fallback**

```
每次 _request_json 调用：
  1. 拿当前 key 池列表（in-memory cache + on-demand reload env）
  2. 从"上次成功 / 当前可用"key 开始尝试
  3. POST/GET 请求：
     - 200/2xx → 成功，返回
     - 401 → **该 key 死了**，标记 disabled（永久），切换下一个 key；如果列表空 → 抛错
     - 429 → 该 key daily quota 撞了，标记 disabled（until 明天 00:00 UTC），切换下一个 key
     - 503 → 类似 429，标记 disabled（short cooldown 60s），切换下一个 key
     - 5xx 其他 → 不切换 key，原样抛错（服务端错误，非 key 问题）
     - timeout / network → 不切换 key，原样抛错（让 MCP host 重试）
  4. 切换 key 后 retry 同一请求（最多 N=池大小 次）
  5. 全部 key 失败 → 抛错 `all_keys_exhausted`
```

### 3.2 Key 状态机（in-memory）

```python
@dataclass
class KeyState:
    raw: str                        # 原始 key 字符串
    masked: str                     # 日志用 'cpk-xxxx...1234'
    disabled_until: float | None    # 时间戳；None = 可用
    disabled_reason: str | None     # "quota_429" | "auth_401" | "service_503"
    consecutive_failures: int       # 累计失败次数（debug 用）
```

**quota_429 disabled_until 计算**：
- agnes 返回 `"Please try again after **2026-09-09 00:00**"` → 解析出 timestamp → 设为 disabled_until
- 如果没解析到 → 默认禁用到下一个 UTC 00:00（保守策略）

**auth_401 disabled_until = 永久**（直到 server 重启）。**这种 key 应当从 pool 移除 + 警告日志**（用户应当 rotate key）。

### 3.3 为什么不直接做 in-memory 持久化

CLAUDE.md §第一原则 · 架构延续性：禁止为单点需求发明新的技术方案。**in-memory 状态足够**：

- MCP server 是 stdio 短生命周期进程（host 启动一次 session 就起一次）
- session 重启 = host 决定的事 = 配额早 reset 了 = in-memory state 没必要 persist
- 用户用 key 撞 401 是**配置错误**，应当**显式 log 出来让人修**，不是"自我恢复"**

---

## 4. 401 vs 429 vs 503 vs 5xx 区分

| 状态码 | 语义 | 多 key 策略 | 错误透传 |
|---|---|---|---|
| **200** / 2xx | 成功 | — | 返回 response |
| **400** | 请求参数错 | **不切换**（所有 key 都会同样 400） | 透传 `http_error` |
| **401** | Unauthorized（key 死了） | **永久禁用该 key**，下一个 | 全部耗尽时透传 + log |
| **403** | Forbidden | **不切换** | 透传 |
| **5xx** | 服务端错误 | **不切换**（同 key 也可能修） | 透传 |
| **429** | Too Many Requests / quota | **暂时禁用**到指定时刻，下一个 | 全部耗尽时透传 + log |
| **503** | Service Unavailable | **暂时禁用** 60s，下一个 | 全部耗尽时透传 + log |
| **timeout** / **network** | 网络问题 | **不切换** | 透传 |

---

## 5. 改动行号 + 改动摘要

### 5.1 server.py 改动

| 行 | 现状 | 0.1.4 改动 |
|---|---|---|
| 60-67 | `_env()` helper | **不动**（env 读逻辑保持） |
| 65 附近 | (新增) `def _parse_api_keys() -> list[KeyState]` | **新增 ~30 行**：解析 `AGNES_API_KEYS` / `AGNES_API_KEY`，构造 KeyState 列表，**单 key 也走 KeyState 路径**（统一调度） |
| 65 附近 | (新增) `_KEY_POOL: list[KeyState]` 模块级全局 | **新增 ~5 行**：进程级 key 池（in-memory） |
| 65 附近 | (新增) `def _pick_key() -> KeyState \| None` | **新增 ~15 行**：从池里挑"第一个未禁用"的；都禁用返回 None |
| 65 附近 | (新增) `def _mark_disabled(key: KeyState, reason, until)` | **新增 ~10 行**：标记 key 状态 + log warning |
| 247-251 | 单 key header 构造 | **改动 ~10 行**：`_pick_key()` → 构造 header；如果选不到 → 抛 `all_keys_exhausted` |
| 257-260 | 错误原样回传 | **改动 ~20 行**：分类 status_code，按 §4 表决定切换/抛错 |
| 536-538 | `_wait_impl` 轮询里 429 retry | **不动**：这是客户端轮询，不是 key 调用，retry OK |
| 其他 ~ 880 行 | 不涉及 key | **不动** |

**总改动：~90 行新增 + ~30 行改动 = ~120 行 diff**。

### 5.2 不改动的部分（明确不碰）

- `pyproject.toml`（Step 3 才动版本号）
- `.mcp.json` / `extended_buildin_mcp/mcp.json`（Step 4 才动）
- `_wait_impl` 客户端轮询 retry（与 key 无关）
- `image_edit` / `image_generate` 的具体实现（都用同一个 helper，自动受益）

### 5.3 新增单测（`tests/test_multi_key_fallback.py`）

| 测试 | 验证 |
|---|---|
| `test_single_key_unchanged` | 单 `AGNES_API_KEY` 配置行为完全与 0.1.3 一致 |
| `test_multi_keys_all_2xx` | 多 key 全成功，**只用了 key[0]**（不预消耗 quota） |
| `test_429_triggers_fallback` | key[0] 撞 429 → 切 key[1] → 成功 |
| `test_401_disables_permanently` | key[0] 撞 401 → 永久禁用 → 切 key[1] |
| `test_all_keys_429_raises` | 3 个 key 都 429 → 抛 `all_keys_exhausted` 错误 |
| `test_503_short_cooldown` | key[0] 503 → 60s 禁用 → 切 key[1] |
| `test_400_does_not_switch` | 400 不切换 key（所有 key 同样 400） |
| `test_env_priority_keys_over_key` | `AGNES_API_KEYS` 优先 `AGNES_API_KEY` |
| `test_parse_strips_whitespace` | `"key1, key2 , key3"` 正确分割 |
| `test_disabled_until_quota_reset` | 解析 `"Please try again after 2026-09-09 00:00"` 正确设置 disabled_until |

**Mock 方案**：用 `pytest-mock` 或 `unittest.mock` 把 `httpx.Client` mock 掉，按测试 case 注入序列 status_code。

---

## 6. Step 2-4 后续计划

### Step 2：改 server.py + 写单测 + 本地验证
- `uvx --from .` 起本地副本
- `pytest tests/test_multi_key_fallback.py` 全过
- 手动用 `curl` 测：配 1 个真 key + 1 个假 key，触发真 key 的 daily limit（不现实）→ 用 mock server 代替

### Step 3：bump 0.1.4 + 上传 PyPI
- `pyproject.toml` version 0.1.3 → 0.1.4
- `python -m build` → `twine check dist/*` → `twine upload dist/*`（需要 PyPI token）
- ⚠️ 上传前再让用户拍板一次（不可逆）

### Step 4：vendor + mcp.json + 端到端
- `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` 同步 0.1.4
- `.mcp.json` + `extended_buildin_mcp/mcp.json`：把 `AGNES_API_KEY` 拆成 `AGNES_API_KEYS`（多值）+ 锁 `==0.1.4`
- 跑 2nd UGC 剩余 5 段视频，验证 fallback 真实生效（用 2 个 key，1 个 daily quota 撞顶，看是否自动切到第 2 个）

---

## 7. 风险 / 已知妥协

| 风险 | 缓解 |
|---|---|
| in-memory key 池，server 重启就清空 | MCP server 是 stdio 短进程，可接受；且 session 重启时 agnes 后端配额往往已 reset |
| 401 永久禁用 key 直到进程重启 | **应当这样**：key 死了就该换，不是 fallback 能修复的；log warning 让用户知道 |
| 429 retry 切换 key 时，提交任务已部分消耗第一个 key 的 quota | agnes 后端行为，**不可控**；fallback 只保证"提交阶段"切 key，状态查询用提交成功的那个 key |
| 多个 MCP 调用并发，key 池 thread-safety | server.py 全程同步（line 253 `with httpx.Client`），单线程；MCP host 端可能并发调，但 server 是 stdio 串行 process → 单进程 → 单 GIL → 实际线程安全 |
| 429 quota reset 时间解析失败 → 默认到下一个 UTC 00:00 | 保守策略，正确（如果 parse 失败，宁可多等不能少等） |

---

## 8. Step 1 完成标志

- [x] 读完 server.py 全部 889 行
- [x] 定位所有 `_env("AGNES_API_KEY")` / `Bearer ` / 429 / 401 路径
- [x] 设计 env schema（向后兼容）
- [x] 设计 key 池策略（in-memory + 状态机）
- [x] 区分 status_code 处理路径
- [x] 列出 server.py 改动行号
- [x] 列单测 case

**等你拍板**：

| 选项 | 含义 |
|---|---|
| **「spec OK 进 Step 2」** | 我开始改 server.py + 写单测 |
| **「spec 有问题改 X」** | 你指出改动方向，我重写 spec |
| **「改 env 名字 / 分隔符」** | 比如 `AGNES_API_KEYS` → `AGNES_KEY_POOL` 或用 `;` 分隔 |
| **「key 池策略换 X」** | 比如改成 LRU / random 而不是 round-robin |