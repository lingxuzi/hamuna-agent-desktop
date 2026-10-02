+# MiniApp 架构

MiniApp 是宿主内嵌的第三方小应用：一个 `kind: 'iframe'` 的沙箱 iframe +
一份 `meta.json` 能力声明 + 一套 `window.app.*` 宿主能力协议。本文记录它
**实际是怎么跑的**，以及改动时不能碰的边界。

> 设计对齐 OpenBitFun `miniapp-dev` skill 的 API 面（`window.app` 单一全局、
> 声明式权限、`node.enabled=false` 时框架原语直连宿主）。差异见文末「与
> OpenBitFun 的差异」。

---

## 1. 三个进程，一条链路

```
MiniApp iframe                renderer (WebView)              sidecar (Node)
─────────────────────         ─────────────────────           ─────────────────
window.app.*                  MiniAppRunner                    dispatchMiniAppApp
  │  postMessage                │ verifyAppCall（4 条信任规则）    │ 重新读 meta.json
  │  {kind:'app.call'}          │ runAppCall 判定 #1              │ 判定 #2（纵深防御）
  │──────────►│─────────────────►│                                 │
  │           │  fs/shell/net/os │──── HTTP /api/miniapp/app/:m ───►│
  │           │  storage/ai/agent                                 │
  │           │  dialog/clipboard ──► Tauri 原生（不发 HTTP）      │
  │◄──────────┤ {kind:'app.result'}                                │
```

**关键：能力按 owner 分流，不是"一律发 sidecar"。**

| 能力族 | owner | 理由 |
|---|---|---|
| `fs` `shell` `net` `os` `storage` `ai` `agent` | sidecar | Node 的 fs / child_process / SDK |
| `dialog` `clipboard` | renderer (Tauri) | OS 原生对话框与剪贴板，sidecar **永远够不到** |
| `call` | worker 池 | 自定义代码必须跑在 `worker_threads` 沙箱里 |

把 `dialog`/`clipboard` 也发去 sidecar 只会得到"够不到"。它们在
`appHostDispatch.ts::dispatchNative` 里**发请求之前**就被截走。

---

## 2. 权限：白名单 + 纵深防御

`meta.json::permissions` 是**白名单**：没声明 = 全禁。

| 组 | 字段 | 语义 |
|---|---|---|
| `fs` | `read[]` / `write[]` | 路径前缀。`{appdata}` `{workspace}` 模板 + **可选尾部 `/**`** |
| `shell` | `allow[]` | 命令名白名单（只取首个 token） |
| `net` | `allow[]` | https-only + 域名白名单 + 禁私网 |
| `node` | `enabled` `max_memory_mb` `timeout_ms` | worker 资源上限 |
| `ai` | `enabled` `allowed_models` `max_tokens_per_request` `rate_limit_per_minute` | 宿主 AI 补全 |
| `agent` | `enabled` `workspace_scope` | 自有隐藏 Agent 会话 |

### 判定发生在两次，不是一次

1. **renderer** `appBridge.runAppCall` —— 快速失败，给作者即时反馈
2. **sidecar** `dispatchMiniAppApp` —— 独立复算

两侧共用 `src/shared/miniapp/app-permissions.ts` 的**同一份纯判定**。共用
一份是**安全要求**而非 DRY：renderer 是 WebView，它的判定可被 XSS 或消息
伪造绕过；sidecar 独立复算才构成纵深防御。若两份逻辑各自演进，必然出现
"renderer 放行 / sidecar 判定不同"的偏差。

### 路径前缀与尾部 glob

`{appdata}` / `{workspace}` 模板由 sidecar 的 `expandTemplates` 展开成绝对
前缀（shared 层不认模板）。前缀**支持尾部 `/**`**，语义是"该前缀下的一切，
含子目录"。

> **只支持尾部是有意的。** 中间段通配（`/a/*/b`）需要真正的 glob 匹配器，
> 那会让 `meta.json` 变成一个难以审计的能力声明 —— 前缀声明的价值恰恰在于
> "看一眼就知道能碰哪些目录"。`{appdata}/src/**` 也**不会**放行
> `{appdata}/src-secrets`（prefix confusion 防护依然生效）。

---

## 3. `ai` 与 `agent` 的分工

这是 MiniApp 最容易写错的一处，两个开关**互相独立**。

| | `app.ai.complete` | `app.agent.run` |
|---|---|---|
| 状态 | 无状态一问一答 | 有状态多轮 |
| 工具 | `tools: []` —— **无任何可调用对象** | 完整工具，能读写工作区、跑命令 |
| 权限模式 | `bypassPermissions`（空谈，没有工具可调） | `acceptEdits` |
| 开关 | `ai.enabled` | `agent.enabled` |
| 适合 | 翻译 / 分类 / 摘要 | "把这个目录整理好" |

`ai` 侧的 `tools: []` 是**安全要求**：MiniApp 的 prompt 完全由第三方作者
控制，若带着内置工具跑在 bypass 下，一次间接注入就能让模型在用户机器上执行
Bash。`tools: []` 之后模型只能产出文本，bypassPermissions 自然失效。

`agent` 侧**绝不**给 `bypassPermissions` —— 这是第三方代码能拿到的上限。

`ai.allowed_models` 声明后即硬上限：传了未声明的 model **直接拒**，不做
"降级到默认模型"这种静默替换（作者会以为在用 A，实际拿到 B 的输出）。

### agent 为什么走 session-engine facade

CLAUDE.md 规定：任何"注入 user 消息 / 等 turn 完成 / session 读操作"的新端点
MUST 走 `src/server/session-engine/` facade。手写 `shouldUseExternalRuntime()`
分支会让 builtin 去 resume 外部会话 —— 静默空转 + 假成功。

**前提**：`miniapp-agent.ts` 只在 MiniApp 自己的 sidecar 进程里被加载
（Rust `cmd_miniapp_ensure_session` 为每个 `miniapp_<appId>_<runId>` 起 1:1
Sidecar），而 facade adapter 是进程级单例、绑定本进程宿主的那一个 Session。
所以从 MiniApp 端口打过来的 `agent.run`，`getSessionEngine()` 拿到的正是它
自己的会话。

`turnOwner: {kind:'agent', id}` 让 `stopOwnedTurn` 能精确命中这一个 turn，
而不是把整个 session 停掉。

---

## 4. 生命周期

- `app.onActivate` / `app.onDeactivate` —— 由 `MiniAppSceneTab` 的 `isActive`
  prop 驱动（`MiniAppRunner` 内 effect，只在**状态迁移**时推，首帧不发）
- `app.onAppearanceChange` / `app.onLocaleChange` —— 主题 / 语言变更
- `app.onEvent` —— 通用通道；`agent.*` 走独立的 `agent` 通道（流式 delta
  频率高，混进通用通道会淹没只关心主题的作者）

> **API 存在但没有生产者是最难排查的缺陷。** 这两个回调早期就被暴露给作者，
> 但宿主从不发送 —— 作者按文档写 `onDeactivate(() => clearInterval(t))`，
> 回调永远不触发，轮询在用户切走后继续烧 CPU。

---

## 5. 错误语义

`{ok:false, error:{code, message}}` 信封，永不抛异常（否则 iframe 侧 Promise
永远 pending）。

| code | 含义 |
|---|---|
| `PERMISSION_DENIED` | meta.json 没授权 / 路径越界 / 速率超限 |
| `UNKNOWN_METHOD` | 方法名不在宿主名单 |
| `INVALID_PARAMS` | 参数缺失或类型不对 |
| `HOST_ERROR` | 宿主自身故障（超时、原生能力不可用） |
| `NETWORK_ERROR` | 派发通道本身失败 |

**不要用异常表达"用户取消了"**：`dialog.open` 取消返回 `null` 是正常结果，
抛错会逼作者写 try/catch 吞掉本属正常的状态。

---

## 6. 已知边界

- **`app.agent.workspace_scope` 当前不放开**：`agent.run` 的 workspace 强制
  落在 appdata 下。Agent 有工具、能写文件，放开就等于任意文件写。
- **`worker_kind` 是白名单**：`app.call` 需要 `meta.kind='worker'` + 已注册的
  `worker_kind`。没有通用 npm 依赖加载，worker 只能 import 仓库内已存在的
  entry（`kinds/*.ts`）。
- **无市场投稿路径**：本项目 Marketplace 只做「浏览 + 安装 bundled MiniApp」，
  没有作者投稿入口，所以「上架时拒绝 `node.enabled=true` / 宽泛 fs scope」这类
  发布期门槛没有落点。等真出现投稿流程时再在 install 漏斗（`install_blocking`）
  加，不要提前造一个没有生产者的校验。
- **`app.agent` 不支持 `contextFiles` 快照**：OpenBitFun 允许 MiniApp 提交若干
  文件名，宿主在 Agent Runtime 内发布一份独立、不可变的
  `.miniapp-context/<opaque-scope>` 虚拟只读快照，并据此在
  `market_strict` 下额外授予限定到该快照的 `Read` / `Grep`。
  **不做**，理由是它是一整套子系统而不是一个 API：虚拟文件系统、每 app 活跃
  快照上限、全局内存预算、终止释放、跨进程不恢复——每一条都要有产品决策，
  而当前没有决策依据：schema 里的 `ai_context` 从未被任何代码读取，本项目
  4 个 bundled MiniApp 无一使用，本项目的 `miniapp-creator` skill 也从未
  向作者提及。先造一个没有作者契约也没有消费者的机制，比不做更糟。
  真要做时，先在 `app.agent.run` 上加 `contextFiles` 入参并写清快照生命周期，
  再谈 `market_strict` 工具集。

### 与 `miniapp-dev` 参考的已确认分歧（对齐审计，2025）

逐条比对 `miniapp-dev/api-reference.md` 与本实现，**未对齐**的项如下。方法名
清单（`APP_METHODS`，30 个）已全量对齐，`app.t` / `app.on` / 四个生命周期钩子
/ `app.call` / `app.storage` / `dialog` / `clipboard` / `fs` 全部一致，以下是
清单对不出来的**签名与语义**差异：

| 项 | 参考 | 本项目 | 后果 |
|---|---|---|---|
| `ai.chat` 入参 | `messages: Array<{role, content}>` | `prompt: string` | 作者照文档传数组 → `p.prompt.trim()` 对数组取不到方法 → `HOST_ERROR` |
| `ai.chat` 返回 | `handle {streamId, cancel()}` | 普通 Promise（一次性 resolve） | 参考的"流式 + 句柄取消"惯用法整个不可用 |
| `ai.chat` 流式 | `opts.onChunk / onDone / onError` | 无 | 同上；且**函数参数过不了 postMessage 结构化克隆**（见下） |
| `ai.cancel` | 位置参数 `cancel(streamId)` | `cancel({run_id})` | 传字符串 → `{run_id: undefined}` → 静默取消不到任何东西 |
| `agent.ensureSession` | `({sessionName, appDataWorkspace})` → 返回带 `sessionId` 的会话 | 无参，返回 stream 描述 | 没有会话概念 |
| `agent.run` opts | `{sessionId, appDataWorkspace, displayText, contextFiles}` | `{run_id, model, timeout_ms}` | `sessionId` / `displayText` 被静默丢弃 |

**已修的传输层缺陷**：`dispatch` 的 flush 队列在 `host.ready` 的 message
listener 里执行 postMessage，不在 Promise executor 内。参数不可结构化克隆时
（例如作者按参考给 `ai.chat` 传 `onChunk`）抛出的 `DataCloneError` 会变成
listener 里的未捕获异常，作者侧的 Promise **永不 settle** —— 表现为"点了没反
应、也不报错"。现在 `send()` 捕获并以 `APP_CALL_NOT_SERIALIZABLE` reject。
护栏见 `appRuntimeTransport.unit.test.ts`（回退该守卫即复现 `pending`）。

**待决**：上表前四行（`ai.chat` 契约）要不要整体对齐到参考的流式句柄形态，
还是保留本项目的一次性形态并在本文档标注差异。`agent` 两行可与 `contextFiles`
一并处理：`appDataWorkspace` 作为 appdata 下的单层子目录名实现**不与**"Agent
workspace 强制落在 appdata 下"的安全立场冲突，两者可以共存。

---

## 6.1 `meta.json::dependencies`（CDN 依赖）

iframe CSP 是 `default-src 'none'`，作者**没有任何办法**加载第三方库。
`dependencies` 是唯一的放宽入口，也是唯一的放宽来源：

```json
{
  "permissions": { "net": { "allow": ["cdn.jsdelivr.net"] } },
  "dependencies": [
    { "url": "https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.js", "type": "script" }
  ]
}
```

**两道闸，缺一不可**：

| 闸 | 位置 | 职责 |
|---|---|---|
| schema | `shared/miniapp/meta-schema.ts::parseDependencies` | https-only、≤10 条、`type` 枚举、**域名必须在 `net.allow` 里** |
| 宿主 | `MiniAppRunner.tsx::usableDeps` | meta.json 是磁盘文件可被手改，宿主不假设上游校验过 |

放宽粒度是**按 host 而非 `https:`**：`script-src https:` 等于允许从任意域加载
二级脚本，一次 CDN 投毒就能升级成任意代码执行。`connect-src` / `font-src`
恒不放开——依赖是加载期资源，不是通道。

`script` 标签带 `defer`（srcDoc 按 document 解析，非 defer 的外链脚本会在
冷网络时阻塞解析器，拖慢 MiniApp 自己的内联 bootstrap）；样式表保持阻塞，
首屏 FOUC 比一次阻塞更糟。

---

## 与 OpenBitFun 的差异

| 项 | OpenBitFun | 本项目 |
|---|---|---|
| CSS Token | `--openbitfun-*` | `--hamuna-*`（保持本项目设计系统） |
| agent workspace | 可配 scope | 强制 appdata |
| worker 依赖 | worker 侧 npm 依赖 | `worker_kind` 白名单（无通用加载） |
| CDN 依赖 | `source.dependencies` | 已支持 `meta.dependencies`（等价语义） |
| `contextFiles` 快照 | `.miniapp-context/<scope>` 虚拟只读快照 | **不做**（见下） |

---

## 相关文件

| 文件 | 职责 |
|---|---|
| `src/shared/miniapp/app-protocol.ts` | 方法名单 + 4 条信任规则（纯协议） |
| `src/shared/miniapp/app-permissions.ts` | 纯权限判定（两端共用） |
| `src/renderer/components/miniapp-host/appRuntimeScript.ts` | 注入 iframe 的 `window.app` |
| `src/renderer/components/miniapp-host/appHostDispatch.ts` | 派发路由 + native 截走 |
| `src/server/miniapp-app-dispatch.ts` | sidecar 执行层（判定 #2） |
| `src/server/miniapp-ai.ts` | `app.ai.*`（一次性 query） |
| `src/server/miniapp-agent.ts` | `app.agent.*`（session-engine facade） |
| `src-tauri/src/clipboard.rs` | OS 剪贴板（arboard） |
