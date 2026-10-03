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
| `fs` `shell` `net` `os` `storage` `ai` | 全局 sidecar | Node 的 fs / child_process / SDK |
| `agent` | **该 MiniApp 自己的 sidecar** | 回合必须跑在 `ensureSession` 建的会话里，否则事件与 abort 都对不上（见 §3） |
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

**这个前提曾经只是文档里的前提，代码没兑现**：`agent.run` / `turnText` /
`cancel` 与其它能力族一起走了 `apiPostJson`（= 全局 sidecar），于是回合跑进
**用户的全局会话**，而 SSE 订阅挂在专用 sidecar 上。一个缺陷同时表现成三件事：
`agent.onEvent` 收不到任何事件、MiniApp 的提示词落进用户聊天历史、
`agent.cancel` 静默停不下来（abort registry 是进程内状态）。现在
`appHostDispatch.ts::dispatchAgentTurn` 先 `bridge.ensureSession()` 拿
`{sessionId, port}`，再用 `proxyFetch` 直发 `127.0.0.1:<port>`；由
`appHostDispatch.unit.test.ts` 直接断言 URL 守着这条。

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
- **`app.ai.chat` 的流式回调不做，且与本项目 Phase 3 规划冲突**：参考文档给
  `chat(messages, {onChunk/onDone/onError}) → {streamId, cancel}`，但 ① 回调
  函数过不了 postMessage 的结构化克隆；② sidecar 的 SSE 是**进程级广播**
  （`sse.ts::broadcast`），要让某个 MiniApp 只收到自己的 AI 分片，就得把
  `app.ai` 也挪到它的专用 sidecar —— 那会连带搬走速率限制表与中止注册表。
  更关键的是**仓库自己的规划已经把同一块 API 指向另一个用途**：
  `bundled-miniapps/icon-generator/source/ui.js` 明写 "Phase 3 replaces these
  with calls through `app.ai.chat` (the host bridges to `cmd_miniapp_ai_complete`
  → gemini-image-tool SSE)" —— 它要的是**出图**桥接，不是文本流。
  唯一会用到它的消费者要的不是这个契约，先按参考实现一遍文本流等于造一套没有
  作者契约的机制（同 `contextFiles` 的判断）。作者若照参考传回调，现在拿到的是
  `APP_UNSUPPORTED_CALLBACK` 与一句可照做的说明，而不是笼统的"参数不可克隆"。
- **`permissions.ai.max_tokens_per_request` 只校验、不下发**：
  `@anthropic-ai/claude-agent-sdk` 的 `query()` Options **没有**按请求限制输出
  token 的选项（只有 `maxBudgetUsd` 美元预算与 alpha 的 `taskBudget` 软提示；
  `maxOutputTokens` 是 provider 级配置，作用于该 provider 的全部请求）。所以
  作者写的 `maxTokens` 会被校验（超上限则 `PERMISSION_DENIED`）然后丢弃。
  保留校验是因为它确实拒绝越权请求，是一条真实的策略断言；要真正按 token
  封顶得先给 provider env 加按次覆盖的口子，而真实模型调用属 `credentialed`
  池、本机无法验证，不在能盲改的范围里。**不要把这个字段当成已强制的上限。**
- **`app.agent.run` 的 `displayText` 不做**：
  - `displayText`（“用户气泡显示的文本 ≠ 发给模型的 prompt”）在本项目**没有落点**：
    `InjectedTurnRequest` 里没有这个字段，注入的 user 消息就是 prompt 本身，全仓库
    `displayText` 的命中项全是会话标题与工具输出，无一属于回合。要做就得给
    `session-engine` facade → adapter → 气泡渲染一路加字段，而真实 turn 属
    `credential` 池、本机无法验证。
  - ~~`appDataWorkspace`~~ **已实现**（见下方「`appDataWorkspace`」小节）。之前
    记成"和 `workspace_scope` 是同一类口子"是判错了：约束是"必须在 appdata 内"，
    不是"必须等于 appdata 根"，作者能挑 appdata 里的一个直接子目录，出不了
    appdata。`workspace_scope` 仍然是锁死的（那才是真正的越权口子）。

### `appDataWorkspace`（已实现）

参考文档让作者在 `agent.ensureSession` / `agent.run` 上传一个 workspace 名，让
MiniApp 在**自己 appdata 底下**挑个子目录当 Agent workspace。

**它和「Agent workspace 强制落在 appdata 下」不冲突。** 之前把这两件事当成
同一个口子是判错了：约束是"必须在 appdata 内"，不是"必须等于 appdata 根"。
作者能挑的是 appdata 里的一个**直接子目录**。真正锁死不放的是
`workspace_scope`（让 Agent 写到用户显式授权的任意目录），那个仍然锁着。

| 位置 | 职责 |
|---|---|
| `shared/miniapp/app-data-workspace.ts::normalizeAppDataWorkspace` | 纯字符串判定，renderer 与 sidecar 共读，无 `node:path` 依赖 |
| `miniapp-app-dispatch.ts::resolveAgentWorkspace` | 拼路径 + 兜底断言 + 按需 `mkdir` |

**拒绝表里真正容易漏的是两条只在 Windows 上犯的**：尾随点 / 尾随空格会被
Win32 静默剥掉，于是 `work.` 与 `work` 是同一个目录，作者会拿到一个指向别处的
名字；保留设备名按"第一个点之前那段"判定，所以 `CON.txt` 同样打开 CON 设备。
这两类在 Linux / macOS 上无害，跨平台 CI 抓不到回归。反过来 `console`
**必须放行**——判定是整段相等而非前缀匹配，早期的前缀写法会误杀它。

派发层在拼完之后再断言一次 `dirname(目标) === appdata`。当前判定表下这一层
够不到，属**兜底**而非 chokepoint：它防的是"将来给判定表放宽了某个字符"变成
路径逃逸。端到端测试**无法**区分是哪一层拦的（两层返回同样的 code 与形状），
所以那里只断言"被拒 + 无副作用"，不演假的分层断言。

`ensureSession` 只**校验并回显**归一后的值，不落状态：本项目的 workspace 是
每回合参数（session 已按 `miniapp_<appId>_<runId>` 隔离）。回显好过直接拒绝
参考文档明写的那个调用——作者传了非法名字时，该在参考叫他用的那个调用上就
看到报错，而不是被静默忽略、以为自己挑了子目录。

**两条路径都要接线，缺一条作者就拿不到一致行为**：`agent.run` / `turnText` 由
renderer `proxyFetch` 派到 MiniApp 自己的 sidecar，参数原样带过去，所以
`appDataWorkspace` 由 sidecar 落地；但 `agent.ensureSession` / `onEvent` 被
`appHostDispatch.ts` 在 **renderer 里就地截走**，请求根本到不了 sidecar。
只改 sidecar 的话，作者照参考在 `ensureSession` 上传 workspace 会被静默吞掉，
下一个 `run` 照样跑在 appdata 根上 —— 这正是"传了但被忽略"。因此 renderer 那条
分支用**同一份** shared 判定函数校验并回显，`onEvent` 不长出这个字段。
sidecar 那份仍然保留（纵深 + 直接打 sidecar 的工具链）。

### 验证状态（截至本轮）

**已实际执行验证**：

- Rust 管理层（`create` / `install` / `list` / `source` / `uninstall`）——
  21/21，见 §7。
- 端到端 wire 契约——`src/server/__tests__/miniapp-app-wire.integration.test.ts`
  起真实 Sidecar 子进程，用真实 loopback HTTP 驱动整个 `app.*` 面：请求信封、
  状态码、错误载荷形状、跨进程 storage/fs 往返、权限 fail-closed、越界路径拒绝、
  非 kebab appId 在路由层被拒，以及 `listAppMethods()` 里每个方法都有决定且不 500。
  16/16。两次变异验证确认它不是空跑：把权限闸改成 `if (false)` 只有两条安全用例
  转红；把路由的 400 改成 200 只有路由那条转红。
- `appDataWorkspace` 的判定与接线——18 条单测钉住每种拒绝理由（关掉
  `FORBIDDEN_CHARS` 有 2 条转红），E2E 用第二个声明了 `agent.enabled` 的 fixture
  app 实跑归一、回显、按需建目录、越界拒绝与无副作用。
  **未实跑**：`agent.run` 真正把它交给 Agent 的那一段（要花真实 token）。

**未验证（不是"没写"，是"跑了要花用户的钱"）**：

- `app.ai.complete` / `app.agent.run` 的**真实模型回合**。这两条会调用
  `~/.hamuna/config.json` 里的真实 Provider 凭据产生付费请求，属 `credentialed`
  池。当前只验证到"参数校验 + 权限判定 + 分发路由"这一层，**从 SDK 真正返回
  completion / turn 成功这一段没有实跑证据**。要补就在 `credentialed` 池加一条
  无凭据时 self-skip 的冒烟测试，不要塞进默认 CI。

本节其余条目（`contextFiles` 快照、流式回调、`displayText`、
`max_tokens_per_request`）都是**有意不对齐**，理由见上；
不要在没有新证据的情况下把它们当 bug 修掉。

### 与 `miniapp-dev` 参考的已确认分歧（对齐审计，2025）

逐条比对 `miniapp-dev/api-reference.md` 与本实现，**未对齐**的项如下。方法名
清单（`APP_METHODS`，**34** 个）已全量对齐，`app.t` / `app.on` / 四个生命周期钩子
/ `app.call` / `app.storage` / `dialog` / `clipboard` / `fs` 全部一致，以下是
清单对不出来的**签名与语义**差异：

| 项 | 参考 | 本项目 | 后果 |
|---|---|---|---|
| `ai.chat` 入参 | `messages: Array<{role, content}>` | 两种都收：字符串与 `messages` 数组（拍平成对话文本） | 已对齐。旧实现两条路都走 `requireString`，照文档写 `chat` 的作者拿到 `INVALID_PARAMS` |
| `ai.chat` 返回 | `handle {streamId, cancel()}` | 普通 Promise（一次性 resolve） | 唯一消费者 icon-generator 要的是 Phase 3 出图桥接，见 §6 已知边界 |
| `ai.chat` 流式 | `opts.onChunk / onDone / onError` | 无（显式 `APP_UNSUPPORTED_CALLBACK`） | 同上；不是不做，是没有对应契约 —— 见 §6 |
| `ai.cancel` / `agent.cancel` | 位置参数 `cancel(streamId)` | `cancel({run_id})` | 已对齐：两种入参都收（`runIdOf`），只收字符串否则静默打空 |
| `agent.ensureSession` | `({sessionName, appDataWorkspace})` → 返回带 `sessionId` 的会话 | `{appDataWorkspace?}`；返回 `{session_id, sessionId, app_data_workspace}` | `sessionName` 无对应（会话 id 由 `miniapp_<appId>_<runId>` 决定）；`appDataWorkspace` **已实现**（校验 + 归一 + 回显，不落状态，见 §6）。camelCase 别名已加 |
| `agent.run` opts | `{sessionId, appDataWorkspace, displayText, contextFiles}` | `{run_id, model, timeout_ms, sessionId, appDataWorkspace}` | `sessionId` **传了就校验**（对不上即 `INVALID_PARAMS`，不再静默忽略）；`appDataWorkspace` **已实现**；`displayText` / `contextFiles` 不做，理由见 §6 |

**已修的传输层缺陷**：`dispatch` 的 flush 队列在 `host.ready` 的 message
listener 里执行 postMessage，不在 Promise executor 内。参数不可结构化克隆时
（例如作者按参考给 `ai.chat` 传 `onChunk`）抛出的 `DataCloneError` 会变成
listener 里的未捕获异常，作者侧的 Promise **永不 settle** —— 表现为"点了没反
应、也不报错"。现在 `send()` 捕获并以 `APP_CALL_NOT_SERIALIZABLE` reject。
护栏见 `appRuntimeTransport.unit.test.ts`（回退该守卫即复现 `pending`）。

**待决**：上表前四行（`ai.chat` 契约）要不要整体对齐到参考的流式句柄形态，
还是保留本项目的一次性形态并在本文档标注差异。`agent` 行现在只剩
`displayText`（无落点）与 `contextFiles`（整套子系统）两项；`appDataWorkspace`
已实现，见 §6「`appDataWorkspace`」。

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

## 7. Windows 上跑 Rust 测试（已解决，用 `scripts/test_rust_windows.ps1`）

**症状**：`cargo test` 编译链接都过，但测试二进制一启动就死，退出码
`0xC0000139`（`STATUS_ENTRYPOINT_NOT_FOUND`），没有任何测试输出。看起来像
"这台机器坏了"，而 `cargo build` / `cargo check` 全绿。**Windows CI 上同样
会红。**

**根因**（逐层实测，不是推测）：

1. 解析测试二进制的 PE import table，它静态 import 了
   `comctl32.dll!TaskDialogIndirect`。
2. 逐个 import 校验 28 个 DLL 的导出表，只有这一个对不上。
3. 本机 `C:\Windows\System32\comctl32.dll` 只有 119 个导出，是 **v5** 版本，
   没有 `TaskDialog*`；v6 在 `WinSxS\amd64_microsoft.windows.common-controls_...`
   下，**只有当可执行文件内嵌了声明 `Microsoft.Windows.Common-Controls` 6.0.0.0
   依赖的 manifest 时**装载器才会激活它。
4. `tauri_build::build()` 把这份 manifest 编进 `OUT_DIR/resource.lib`，并用
   `cargo:rustc-link-arg-bins` 链接——**只给 bin target**。lib 的 test harness
   不是 bin target，拿不到它。

来源是 `tauri-plugin-dialog` → `rfd`：它用 `TaskDialogIndirect`，而 Tauri 只给
**app 二进制**内嵌 manifest，不给测试二进制。

**解法：给已链接好的测试二进制补一个旁挂 manifest，不动构建系统。**

`scripts/test_rust_windows.ps1` 跑 `cargo test --no-run`，找到最新的
`app_lib-*.exe`，在它旁边写 `<binary>.exe.manifest`（Windows 官方的 external
manifest 机制），再直接执行 harness。支持 `-Filter` / `-TestThreads` /
`-SkipBuild`。

**不要再试的修法**（都试过并回滚了）：

- `cargo:rustc-link-arg-tests`：Cargo 没有这个指令；且本包没有 `[[test]]`
  target，Cargo 直接拒绝（`does not have a test target`）。
- `cargo:rustc-link-arg`（无后缀）：与 tauri-build 的 `-bins` 冲突，同一个
  `.lib` 在链接行出现两次 → `CVT1100` + `LNK1123`，**连 `cargo build` 都挂**。
- 往 `build.rs` 里塞 `/MANIFESTINPUT`：同样是与 tauri 那份在 CVTRES 阶段冲突。

**影响面**：无。MiniApp 的 Rust 管理层（`create` / `install` / `list` /
`source` / `uninstall`）现已**实际执行验证**，MiniApp Rust 测试 21/21 通过。
全量 758 passed / 17 failed，剩下的 17 条都是既有问题且都在 MiniApp 之外
（`process_cleanup` 的 Windows 盘符大小写、`workspace_files::path_safety` 的
os error 87、`managed_codex` 的 pubkey 漂移、`space_cloud` / `system_skills` /
`skill_sync`）。

---

## 相关文件

| 文件 | 职责 |
|---|---|
| `src/shared/miniapp/app-protocol.ts` | 方法名单 + 4 条信任规则（纯协议） |
| `src/shared/miniapp/app-permissions.ts` | 纯权限判定（两端共用） |
| `src/shared/miniapp/app-data-workspace.ts` | `appDataWorkspace` 纯字符串判定（两端共用） |
| `src/renderer/components/miniapp-host/appRuntimeScript.ts` | 注入 iframe 的 `window.app` |
| `src/renderer/components/miniapp-host/appHostDispatch.ts` | 派发路由 + native 截走 |
| `src/server/miniapp-app-dispatch.ts` | sidecar 执行层（判定 #2） |
| `src/server/miniapp-ai.ts` | `app.ai.*`（一次性 query） |
| `src/server/miniapp-agent.ts` | `app.agent.*`（session-engine facade） |
| `src-tauri/src/clipboard.rs` | OS 剪贴板（arboard） |
| `src/server/__tests__/miniapp-app-wire.integration.test.ts` | 端到端 wire 契约（真 Sidecar 子进程 + 真 HTTP） |
| `scripts/test_rust_windows.ps1` | Windows 上跑 Rust 测试（旁挂 manifest，见 §7） |
