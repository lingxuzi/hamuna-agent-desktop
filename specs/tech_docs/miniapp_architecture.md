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
| `net` | `allow[]` | https-only + 域名白名单 + 禁私网，**且不跟随重定向**（逐跳判定不做，理由见 §6「修掉的网络层缺陷」） |
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

### `appDataWorkspace`（已实现，端到端钉住）

参考文档让作者在 `agent.ensureSession` / `agent.run` 上传一个 workspace 名，让
MiniApp 在**自己 appdata 底下**挑个子目录当 Agent workspace。

**它和「Agent workspace 强制落在 appdata 下」不冲突。** 之前把这两件事当成
同一个口子是判错了：约束是"必须在 appdata 内"，不是"必须等于 appdata 根"。
作者能挑的是 appdata 里的一个**直接子目录**。真正锁死不放的是
`workspace_scope`（让 Agent 写到用户显式授权的任意目录），那个仍然锁着。

| 位置 | 职责 |
|---|---|
| `shared/miniapp/app-data-workspace.ts::normalizeAppDataWorkspace` | 纯字符串判定，renderer 与 sidecar 共读，无 `node:path` 依赖 |
| Rust `commands.rs::resolve_miniapp_agent_workspace` | **chokepoint**：判 segment、拼路径、断言直接子目录，并据此定 `--agent-dir` |
| `miniapp-app-dispatch.ts::resolveAgentWorkspace` | sidecar 侧 per-turn 兜底（external runtime 会读它） |

**为什么落在 `--agent-dir` 而不是 per-turn 参数。** builtin adapter 的 cwd 是
**进程级** `agentDir`，SDK 子进程 spawn 时读一次，per-turn 表达不了——这条没变。
但它并不需要 per-turn：`cmd_miniapp_ensure_session` 本来就是**建 session 时**定
agent dir 的，而 `appDataWorkspace` 是 session 级的选择（参考文档也把它放在
`ensureSession` 上）。由 ensure 把它写进 `--agent-dir` 即可。

> **更正一条曾经的错误结论。** 这里曾记着"要让 builtin 生效就得让 sidecar 从
> per-appId 变成 per-(appId, workspace)，属于必须先讨论的架构变更"。**前提是错的**：
> `cmd_miniapp_ensure_session` 建的 session id 是 `miniapp_<appId>_<runId>`，
> sidecar 本来就是 per-(appId, runId) 起的，比 per-workspace 更细；只有
> `--agent-dir` 一直是 per-appId，而那正是可以改的那一处。没有任何进程/会话生命周期
> 变更。**一个看起来需要架构变更的阻塞点，先去读那个"架构"到底由什么键控。**

**拒绝表在两处各有一份，MUST 同步。** TS 的 `normalizeAppDataWorkspace` 与 Rust 的
`normalize_app_data_workspace` 是两个独立信任边界：renderer 校验是为了当场给作者
一条能照着改的错误，Rust 再校验是因为 renderer 的入参不可信，而这里拼出来的路径
**就是** Agent 的 cwd（它带工具、`acceptEdits` 允许文件编辑自动落盘）。

拒绝表里真正容易漏的**两条只在 Windows 上犯**：尾随点会被 Win32 静默剥掉，于是
`work.` 与 `work` 是同一个目录；保留设备名按"第一个点之前那段"判定，所以
`CON.txt` 同样打开 CON 设备。**尾随空格反而是归一不是拒绝**——它在 `trim()` 之后
已经不存在了。TS 侧曾有一条 `endsWith(' ')` 的拒绝分支，它跑在 `trim()` 之后恒为
false，是纯粹误导人的死代码，已删并补了测试把它钉成显式契约。反过来 `console`
**必须放行**——判定是整段相等而非前缀匹配。

**已经建好的 session 不许换 workspace。** bridge 记下建 session 时用的 segment，
后来请求一个不同的就报错。不拦会退化成最阴的形态：Rust 的 `ensure_session_sidecar`
看到 session 还活着就**直接复用、完全不看新路径**，于是 `ensureSession` 照样回显
作者这次请求的名字——作者以为收窄生效了而实际没有。宁可当场报错。没表达偏好
（不传 `appDataWorkspace`）不算冲突，那是作者最常见的用法。`agent.cancel` 完全
不参与：它只瞄准已有 turn，带校验进来会让"挑过子目录"之后所有 cancel 都失败。

**直接子目录断言是兜底，不是 chokepoint。** 判定表与它会互相掩护（拿掉任一个，
另一个照样兜住，返回同样的 Err），端到端层面分不出是谁拦的。所以
`commands.rs::the_validator_itself_enforces_every_rule` 直接断判定表自身的每一条
规则；路径级断言防的是"将来给判定表放宽了某个字符"变成逃逸。实测把直接子目录断言
删掉，28 条 miniapp 测试全绿——这正说明它不承担拦截职责，别把它当闸门。

**真正锁住 Agent 范围的不只是这个字段，还有 Rust 那一侧**：
`cmd_miniapp_ensure_session` 把 `--agent-dir` 设成
`~/.hamuna/miniapps/<appId>[/<segment>]`，sidecar 与 appdata 1:1，builtin 的进程级
agent dir 于是天然落在沙箱里。链子每一环各有测试：判定与拼路径在 `commands.rs`
（Rust）、"renderer 真的把它发给 Rust"在 `agentEventBridge.dom.test.tsx`、最后一环
"agent dir → SDK cwd"在 `miniapp-agent-wire.integration.test.ts`——它另起一个
`--agent-dir` 指着子目录的 sidecar，断言 SDK 请求体里的 `Primary working directory`
正是该子目录。端到端测试**不**自己复刻一遍 Rust 的路径拼接，那只会造出第二份会
漂移的实现。

`ensureSession` 仍然**校验并回显**归一后的值：回显好过直接拒绝参考文档明写的那个
调用——作者传了非法名字时，该在参考叫他用的那个调用上就看到报错，而不是被静默
忽略、以为自己挑了子目录。

**三条路径都要接线，缺一条作者就拿不到一致行为**：`app.agent.ensureSession` /
`run` / `turnText` 的**作者门面**在 `appRuntimeScript.ts`（iframe 里的
`window.app`）。`run` / `turnText` 由 renderer `proxyFetch` 派到 MiniApp 自己的
sidecar，参数原样带过去，所以 `appDataWorkspace` 由 sidecar 落地；但
`agent.ensureSession` / `onEvent` 被 `appHostDispatch.ts` 在 **renderer 里就地
截走**，请求根本到不了 sidecar。

只改一层的话作者都拿不到：iframe 门面曾经无参硬传 `null`（作者传了就在最外层
被吞），只改 sidecar 的话 renderer 又会把它读成 `run_id` 之外的空气丢掉 ——
表现为"我明明挑了子目录，run 却跑在 appdata 根上"，且**没有任何一层会报错**。
因此三层各司其职：门面**转发**、renderer 用同一份 shared 判定函数**校验并回显**
（`onEvent` 不长出这个字段，它没这个入参）、sidecar **落地并建目录**。
sidecar 那份同时是纵深与直连工具链的落点（renderer 是 WebView，不是唯一信任源）。

### `app.ai` 曾经把认证失败当成补全返回（已修）

**症状**：没有可用凭据时，`app.ai.complete('…')` 返回
`{ ok: true, result: { text: "Not logged in · Please run /login" } }`。
作者侧看到的是"AI 回答：请先登录"——一个**假成功**。

**根因**：SDK 在认证失败 / API 报错时，发的是一条 `type: 'assistant'` 消息，
`content` 里装着一句人话，同时带 `is_api_error_message: true` 与
`error: 'authentication_failed'`，`message.model` 是 `<synthetic>`。旧实现只读
`content`，于是把那句错误文案当成补全。

`result` 消息同样被忽略：SDK 文档说它是 turn-complete 信号，`subtype: 'success'`
才带最终文本，`is_error: true` 时带的是错误文本。

**修法**：`classifySdkMessage`（`miniapp-ai.ts`）把每条消息判成
`text` / `error` / `empty` 三态，**先判错误再判文本**；`result` 消息按
`is_error` / `subtype` 判。现在返回 `HOST_ERROR` 且 message 里带真实的错误码
（`Not logged in · Please run /login (authentication_failed)`）。

对齐 `miniapp-agent.ts` 那条"facade 的 success 不等于真的有输出"。判定表见
`src/server/__tests__/miniapp-ai-outcome.unit.test.ts`，fixture 是本机实跑
Sidecar 打出来的原文裁剪，不是照文档编的。

**顺带查明**（此处曾写错过，已订正）：`app.ai` 固定 `providerEnv: undefined` +
`providerId: SUBSCRIPTION_PROVIDER_ID`。**只**设进程环境变量里的
`ANTHROPIC_BASE_URL` 是无效的——`buildClaudeSessionEnv` 在订阅分支会**主动清掉**
继承来的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`
（日志：`[env] ANTHROPIC_BASE_URL cleared (using Anthropic default)`）。

但**用 loopback mock 替身验证补全链路是行得通的**：先
`POST /api/provider/set` 把宿主 provider 推进去（`baseUrl` 指向本地 mock），
之后 `buildClaudeSessionEnv` 会打出 `[env] ANTHROPIC_BASE_URL set to: …`，
SDK 子进程真的被 spawn、真的打 `POST /v1/messages?beta=true`、真的解析 SSE。
所以下面的「真实模型回合」验证是**零成本**的，不必留在 credentialed 池。

### 验证状态（截至本轮）

**已实际执行验证**：
- Rust 管理层（`create` / `install` / `list` / `source` / `uninstall`）——
  24/24，见 §7（含 3 条沙箱第一跳的路径推导断言，见下）。
  （Windows 上必须走 `scripts\test_rust_windows.ps1`，裸 `cargo test` 会假绿，见 §7。）
- 端到端 wire 契约——`src/server/__tests__/miniapp-app-wire.integration.test.ts`
  起真实 Sidecar 子进程，用真实 loopback HTTP 驱动整个 `app.*` 面：请求信封、
  状态码、错误载荷形状、跨进程 storage/fs 往返、权限 fail-closed、越界路径拒绝、
  非 kebab appId 在路由层被拒，以及 `listAppMethods()` 里每个方法都有决定且不 500。
  19/19。两次变异验证确认它不是空跑：把权限闸改成 `if (false)` 只有两条安全用例
  转红；把路由的 400 改成 200 只有路由那条转红。
- `appDataWorkspace` 的判定与接线——18 条单测钉住每种拒绝理由（关掉
  `FORBIDDEN_CHARS` 有 2 条转红），E2E 用第二个声明了 `agent.enabled` 的 fixture
  app 实跑归一、回显、按需建目录、越界拒绝与无副作用；renderer 与 iframe 门面
  各有单测锁住"参数确实被转发 / 回显"（把门面改回无参硬传 `null` 会转红）。
  **实跑结论**：接上之后发现它在 builtin runtime 上不生效，一度记成"待决的架构
  改动"。后来回读 `cmd_miniapp_ensure_session` 才发现那条阻塞理由的前提是错的
  （sidecar 本来就 per-(appId, runId) 起的），于是直接改成由 `--agent-dir` 落地。
  判定层与接线层当时就是对的，缺的是 builtin 侧那一跳。

- `app.ai` 的**入参归一**（零成本那一半）——`ai.complete` / `ai.chat` 在
  `normalizeAiPrompt` 处就拒掉空 prompt，压根走不到 `query()`，所以这部分可以
  留在 integration 池实跑而不花任何 token：空串 / 缺参 / 空 messages 数组 /
  全无有效轮的数组都返回 `INVALID_PARAMS`。这一层值得覆盖是因为参考文档给
  `ai.chat` 的标准写法就是 `messages` 数组，而早期实现两条路都走
  `requireString`，照文档写的作者直接拿 `INVALID_PARAMS`。
- **认证失败不再是假成功**——无凭据的临时 HOME 下实跑 `ai.complete`，修复前返回
  `ok:true` + "Not logged in…"，修复后返回 `HOST_ERROR` +
  `(authentication_failed)`。这条**零成本**：复现条件就是"没有凭据"。
  14 条单测钉住判定表，关掉错误判定有 3 条转红。
- **`app.ai` 全链路**——`src/server/__tests__/miniapp-ai-wire.integration.test.ts`
  把宿主 provider 指向一个 loopback mock（`POST /api/provider/set`），然后
  `ai.complete` 真的 spawn SDK 子进程、真的打 `POST /v1/messages?beta=true`、
  真的解析 SSE 回来，并断言**拿到的就是 mock 回的那段文本**且 mock 确实收到过
  requests。`ai.chat` 的参考 messages 数组形态也实跑通了。**零成本**。
- **`app.agent` 全链路**——`src/server/__tests__/miniapp-agent-wire.integration.test.ts`
  起一个 `role=session` 的 sidecar（照 Rust 的样子把 `--agent-dir` 设成 appdata），
  `agent.run` 真的跑完一个 turn：`had_message: true`、prompt 原文进了 SDK 请求体、
  cwd 落在 appdata 内。`sessionId` 往返也打通了（`onEvent` 拿到的真 id 能跑，
  外来的 id 被 `INVALID_PARAMS` 拒掉），`agent.enabled: false` 的 app 在真实
  HTTP 链路上**叫不起模型**（断言 mock 没收到新请求，不只是断言报错）。**零成本**。
  这条同时查出了上面记的 `appDataWorkspace` 在 builtin 上的 no-op——那才是整条
  审计里唯一一个**看起来需要架构变更、实际只需要改一个路径参数**的阻塞点。
- **沙箱第一跳（Rust）**——`commands.rs::miniapp_tests` 现 28 条（21 → 24 → 28）。
  MiniApp 的范围约束不来自任何 per-turn 参数，而来自
  `cmd_miniapp_ensure_session` 把 `--agent-dir` 设成 `miniapps/<appId>[/<segment>]`。那一跳
  此前只有 `is_safe_app_id` 的字符表测试（隐含地挡住了 `/` 与 `..`），现在直接
  断言**推导出来的性质**：接受的 id 一定落在 `miniapps/` 根之下、且必须是根的
  **直接**子目录（多一层就说明分隔符混进来了）；被拒的 id **不产生任何路径**。
  `is_safe_run_id` 此前完全没有测试。变异验证：放开 `is_safe_app_id` 的字符表
  → 2 条转红。

  顺带一条读代码得到的结论，供后人省事：`is_safe_run_id` 里那条
  `!run_id.contains(':')` 是**不可达的**——`:` 已经被前面的
  `chars().all(小写|数字|-)` 拒掉了，所以这个合取项从不改变返回值（实测把它删掉，
  24 条测试一条都不转红）。它只是把"冒号是 owner token 分隔符"这件事写在了代码
  里。**故意保留**：删掉它看着是去冗余，实际是拆掉一个绊线 —— 万一将来有人放宽
  字符表，这条就是拦住 `miniapp-agent:<appId>:<runId>` 撞车的那道。
- **传输层 / 信任边界**——`src/shared/miniapp/app-protocol.unit.test.ts` 19 条
（新建，此前**没有这个测试文件**）：
  `verifyAppCall` 的四条信任规则逐条钉住（source 必须是本 iframe 的
  contentWindow、nonce 由宿主铸造无法自造、appId 与本 iframe 绑定、method 在
  名单内），外加 8 种畸形信封「不抛、只拒」。这层此前**完全没有测试文件**，而
  它是第三方代码进不了别的 MiniApp 语境的唯一屏障。四条规则逐个去掉，各自
  恰好打红 1 条。
  门面侧 `appRuntimeTransport.unit.test.ts` 26 条补上回信方向：回信对上就
  resolve/reject、对不上（nonce 错、id 未知）必须**不 settle**（宁可挂着也不能
  串台）、并发调用倒序回信各归各位、事件按 appearance/locale/agent 三条通道
  分流。

**修掉的传输层缺陷（第二个）**：宿主侧回信**没有守卫**。`postMessage` 走结构化
克隆，`runAppCall` 的结果里一旦有不可克隆的值（函数 / Proxy），回信就抛
DataCloneError 发不出去，作者的 Promise 永久 pending —— 表现是"点了没反应、
控制台也干净"，和网络卡住无法区分。这与门面侧早就修掉的缺陷是**同一种**，
等于同一个坑只修了一半。现在降级成纯对象错误信封（可克隆），逻辑收在
`app-protocol.ts::postAppResult` 里以便单测直接喂它一个不可克隆的值；把降级
去掉会有 3 条转红。


**修掉的网络层缺陷（第三个）**：`app.net.fetch` 只对**第一跳**判定，然后交给 undici
默认的 `redirect: 'follow'` 去跑。作者声明的 host 确实满足 https-only、在
`net.allow` 里、且 `isPrivateHostname` 为 false——但它完全可以回
`302 Location: https://169.254.169.254/latest/meta-data/`，而那一跳从头到尾没被
检查过。于是 §2 表里那行「https-only + 域名白名单 + 禁私网」等于形同虚设，
MiniApp 作者能把 sidecar 当跳板去读云 metadata / 探内网。

这不是新风险形状，是本仓已有约定漏了一处：`tool-attachments.ts` / `kb-ingest.ts` /
`provider-probe.ts` 早就为同一理由关掉了跟随重定向（provider-probe 的注释原话：
「host says https, hops internal」），`app.net.fetch` 是唯一还在跟的一处。

选 `redirect: 'manual'` 而不是那三处的 `'error'`：安全语义等价，但这一处**面向
作者**，`'error'` 抛出来的是 undici 包过的 "fetch failed"，作者只看到一句没头没尾的
`HOST_ERROR`。manual 把 3xx 原样交回来，下游才能给一句指名道姓的拒绝：
`net.fetch refuses redirects (got HTTP 302) — request the final URL directly`。

**故意不做**「逐跳重新判定 + 允许跟」：那会把 `net.allow` 的语义从"可以去这里"变成
"最终可以落到这里"，比 `meta.json` 承诺的契约更弱。失败关闭更简单，也正是权限文件
承诺的那条。真有 app 需要多跳登录（OAuth 跳转）时再加，届时必须**同时**改
`app-permissions.ts` 的语义，别只改一半。

护栏 `src/server/__tests__/miniapp-net-redirect.integration.test.ts`（4 条）注入
transport 而非起一个真的重定向服务器，这是**限制而非偷懒**，值得写清楚：要让第一跳
通过三道判定，它必须既 https 又非私网，而本机没有 openssl 也没有 selfsigned /
node-forge 可签证书；拿 `127.0.0.1` 当第一跳则在 `isPrivateHostname` 就被拒，压根
走不到重定向那步——所以端到端版本目前**写不出来**，不只是没写。测试因此断言**机制**
（`init.redirect === 'manual'`）**与作者可见面**（3xx 变成指名 redirect 的
`PERMISSION_DENIED`，且 `Location` 不回传给作者）两条，另加 200 / 403 透传，确保这
道闸不是一刀切拒绝。三处变异（删掉 `redirect`、改回 `'follow'`、删掉 3xx 判定）
各自转红。


**本节此前列的两处"已确认但未落修"，现在都已修掉**。留在这里是因为它们各自的
阻塞点与结论比结论本身更值得记 —— 两处的阻塞都不是"难"，而是"缺一个判据"。

### ✅ 一、iframe 与宿主 renderer 同源 —— 已修（去掉 `allow-same-origin`）

**当时的缺口**：`SANDBOX_FLAGS` 里带着 `allow-same-origin`，而 `about:srcdoc`
文档默认继承父文档 origin —— 于是不可信的 MiniApp 脚本与渲染进程同源，
`window.parent.document` / `localStorage` / `document.cookie` 直接可读可写，
`IFRAME_CSP` 的 `img-src https:` 又能把刮到的东西带出去。整个 `window.app.*`
权限模型（fs 沙箱、net 白名单、clipboard 闸）于是只对守规矩的作者有效。

**比"能读 localStorage + 能发 img"更致命的一条，是当初没写进这节的**：
Tauri v2 **总是**往页面注入 `window.__TAURI_INTERNALS__`（`withGlobalTauri: false`
只关掉 `__TAURI__` 那个便捷命名空间；`@tauri-apps/api/core` 的 invoke 走的正是
`window.__TAURI_INTERNALS__.invoke`，本仓 renderer 自己也用
`"__TAURI_INTERNALS__" in window` 做特性探测）。所以同源 MiniApp 一行
`window.parent.__TAURI_INTERNALS__.invoke('cmd_read_workspace_file', …)` 就能拿到
**任意 Tauri 命令** —— `app-permissions.ts` / `resolvePolicyForSidecar` /
`checkAppPermission` / `path-safety` 一次性全部作废。同源不是"沙箱松一点"，
是沙箱不存在。

**当时的阻塞点**："要先在真实构建里确认 source 端点的内联不漏，否则会把内置 app
打白"。这个判据后来是查代码得到的，不需要实跑 —— 读
`commands.rs::inline_miniapp_siblings` + `read_inline_target` 之后可以逐类枚举
凡是**没有**被内联掉的 sibling 引用，并且证明它们**今天本来就是坏的**：

| 幸存情形 | 今天的行为 |
|---|---|
| 目标文件不存在 | 请求打到宿主 origin，那里不提供 MiniApp 资源 → 必然 404 |
| 带 `..` / `.` 段 | `read_inline_target` 明确拒绝（`starts_with` 逐段比较不规范化） |
| 远程 URL | 不在 `dependencies` 里已被 `script-src` 挡；声明了的走 `injectDependencyTags` + `buildIframeCsp` 的显式 host 白名单，不靠 `'self'` |
| `data:` / `#` | `script-src` 无 `data:`，本来就挡 |

所以删掉 `'self'` 不会让任何原本能跑的 MiniApp 变成不能跑。

**结论**：`SANDBOX_FLAGS = 'allow-scripts allow-forms'`，`IFRAME_CSP` 与
`buildIframeCsp` 同时去掉 `'self'`（opaque origin 下 `'self'` 匹配不到任何来源，
留着只会让人误以为还有同源关系）。宿主侧不依赖同源：nonce 校验全在宿主侧
（`source` + nonce + appId），全仓没有任何一处读 `event.origin`；`contentWindow`
只用于身份比较与 `postMessage`，两者跨域都成立；持久化走 `app.storage` 的宿主侧
`storage.json`，内建 app 无一碰 `localStorage`。护栏是
`MiniAppRunner.test.tsx` 里"两个 flag" + "没有 `allow-same-origin`" + "CSP 里没有
`'self`'" 三条，把 flag 加回去会转红。

**原文档里"少一个它 nonce 校验与 storage 分片会失效"的说法是错的**，两头都不成立：
nonce 校验从不看 origin；storage 分片走的是 `app.storage` 而不是 `localStorage`。
那句错的理由曾被 `miniappPipeline.dom.test.tsx` 写成断言（`toContain('allow-same-origin')`），
现已改成 `not.toContain`，并把错误理由一并记在断言旁。

### ✅ 二、`kind:'worker'` 的 MiniApp 绕过 fs 权限 —— 已修

**当时的缺口**（两条独立缺口叠加）：

1. `worker.call` 走 `MiniAppRunner.tsx` 自己的 message listener，直接
   `apiPostJson('/api/miniapp/worker/call')`，**不经过 `runAppCall`**，所以权限判定
   一次都没跑；sidecar 的 `/api/miniapp/worker/call` 也不看 `meta.json`。它验了
   `source` / nonce / method 白名单 —— 那是**信任**判定，不是**授权**判定，两者不能
   互相顶替。
2. 两个 kind 的 `assertReadableRoot` / `assertReadableCwd` 只做 `lstat` 反 symlink，
   而两处注释都声称"path-template expansion at install time defines the scope" ——
   **那段展开在代码里根本不存在**。

**当时的阻塞点**：`git-graph` 声明 `fs.write: []`，接上闸之后它的 `git.checkout`
就会开始报权限错；而 `bundled-miniapps/*` 正被另一个会话并行编辑，并发 writer 纪律
禁止碰，所以"闸"与"meta"必须一起定。两者已一起落地：闸接上
（`resolveMiniAppFsScope` 复用 `loadMeta` + `expandTemplates` 同一 chokepoint，
经 `workerData.fsScope` 带进 worker，`worker-rpc.ts::assertWithinFsScope` 判定），
`git-graph` 同步改成 `fs.write: ["{workspace}/**"]`（与它早已声明的读侧同界），
`file-explorer` 保持只读。`git.checkout` 的写闸特意查在 `assertReadableCwd` **之前**
—— 否则"这里是不是 git 仓库"会先抛出去，未声明的 `cwd` 还能借此探测本机目录结构。

**顺带暴露并修掉的第三个洞**：`git-graph` / `file-explorer` 自己就缺
`"node": { "enabled": true }`，`app.call` 在 renderer 闸就被拒 —— **内置的 worker
MiniApp 本身也是全死的**，且失效完全静默（拒绝是正确行为，不报错不记日志）。护栏
`src/shared/miniapp/bundled-apps-permissions.test.ts` 把每个 `app.*` 调用拿回
`checkAppPermission` 复算一遍。写这个护栏本身又踩了两个坑，都记在文件里：扫描器
必须认 `app.call(method, params)` 这种两段式形态，且必须**逐文件**剥注释
（`worker-blacklist.ts` 模板串里的 `/**` 会被当成块注释开头，吞掉 7187 个字符）。

**一个测试环境的坑，值得记下来省得重踩（2026-10 实测订正）**：组件级的
`event.source instanceof Window` 在 jsdom 下**恒为 false**（跨 realm），负向断言会
全绿、正向断言永远失败。**但这不是根因，别顺着它往下修。**

曾据此推断"把 `instanceof` 收窄去掉就能在组件层跑通往返"，实测推翻了：jsdom 的
`postMessage` 把 `event.source` 置为 **`null`**（实测 `sourceIsParent: false,
sourceIsNull: true, origin: ""`），而协议的**两端都依赖 `event.source`**：

- iframe 侧 `appRuntimeScript.ts` 收消息时 `if (event.source !== window.parent) return;`
- 宿主侧 `app-protocol.ts` 的 `envelope.source !== iframeContentWindow` 严格相等才是闸门

于是无论收窄怎么写，jsdom 下这条通道**都**不可能跑通端到端往返 —— 与本项目代码
无关，是环境能力缺失。

其他两条一并实测的 jsdom 限制（都别当成产品缺陷去"修"）：

- **不解析 `srcdoc`**：设了属性也不加载，`contentDocument.body` 是空的。绕法是先读出
  组件组装出的 `srcdoc` 字符串再 `document.write` 灌进去。
- **`document.write` 之后不触发 iframe 的 `load` 事件**：而宿主正是在 `load` 里发
  `host.ready`（`handleFrameLoad`），不补就会永远排着队。

结论：`window.app.*` 的形状一致性目前**只**由三段各自的单测保证
（`app-protocol` 纯函数 / `appRuntimeTransport` 脚本 / `appHostDispatch` 派发层）。
它们之间**没有**任何东西保证三段形状对得上 —— 这是已知的结构性缺口，`appDataWorkspace`
当初正是被 `appRuntimeScript.ts` 无参硬传 `null` 吞掉、且三段单测全绿而暴露不出来的。
想补这段，载体只能是一个真实浏览器（Playwright / WebDriver），不是 vitest jsdom。

**仍未验证（需要真实 Provider，属于 credentialed）**：

- **真实模型回合**打到真实 Anthropic 或用户配置的第三方 Provider。上面两条验证
  覆盖到 HTTP 边界为止：请求怎么组装、SDK 怎么 spawn、SSE / turn 怎么解析、
  信封怎么回全都验过了，**没有**覆盖的是"真实上游是否接受这个请求形状、真实
  模型是否真的返回内容"——那是上游的契约，不是我们的代码。

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
| `agent.ensureSession` | `({sessionName, appDataWorkspace})` → 返回带 `sessionId` 的会话 | `{appDataWorkspace?}`；返回 `{session_id, sessionId, app_data_workspace}` | `sessionName` 无对应（会话 id 由 `miniapp_<appId>_<runId>` 决定）；`appDataWorkspace` 校验 / 归一 / 回显都做，且**真生效**（由它决定该 session 的 `--agent-dir`，builtin 与 external 一致）。camelCase 别名已加 |
| `agent.run` opts | `{sessionId, appDataWorkspace, displayText, contextFiles}` | `{run_id, model, timeout_ms, sessionId, appDataWorkspace}` | `sessionId` **传了就校验**（对不上即 `INVALID_PARAMS`，不再静默忽略）；`appDataWorkspace` 也生效，但 cwd 由 **session** 决定，所以与已建 session 不一致时明确报错；`displayText` / `contextFiles` 不做，理由见 §6 |

**已修的传输层缺陷**：`dispatch` 的 flush 队列在 `host.ready` 的 message
listener 里执行 postMessage，不在 Promise executor 内。参数不可结构化克隆时
（例如作者按参考给 `ai.chat` 传 `onChunk`）抛出的 `DataCloneError` 会变成
listener 里的未捕获异常，作者侧的 Promise **永不 settle** —— 表现为"点了没反
应、也不报错"。现在 `send()` 捕获并以 `APP_CALL_NOT_SERIALIZABLE` reject。
护栏见 `appRuntimeTransport.unit.test.ts`（回退该守卫即复现 `pending`）。

**本节的"待决"只剩一项（`ai.chat` 流式句柄形态，是设计选择而不是缺陷）；其余条目
已定并已修，保留在此是为了记下"当时为什么卡住、后来为什么通了"：**

1. **`ai.chat` 要不要整体对齐到参考的流式句柄形态**（`handle {streamId, cancel()}`
   + `onChunk/onDone/onError`）。本项目是一次性 Promise，并显式
   `APP_UNSUPPORTED_CALLBACK` 拒掉回调。唯一消费者 icon-generator 要的是
   Phase 3 出图桥接，流式对它没有价值；而流式要求 sidecar 常驻一条 SSE，还要解决
   "iframe 已经卸载时怎么收尾"。定这个之前，上表 `ai.chat` 的两行保持现状。
2. **✅ 已定并已修：`appDataWorkspace` 在 builtin runtime 上真生效**。曾长期记为
   "待决的架构改动"，阻塞理由是"要让 builtin 也生效，得让 sidecar 的 agentDir 变成
   per-(appId, workspace)"。**那个前提是错的**：先记着"sidecar 由
   `cmd_miniapp_ensure_session` 1:1 建在 appId 上"，但那个命令建的 session id 是
   `miniapp_<appId>_<runId>`，sidecar 本来就是 per-(appId, runId) 起的 —— 比
   per-workspace 更细。只有 `--agent-dir` 一直是 per-appId，而那正是唯一要改的地方。

   于是取的是上面的 (A)：由 `ensureSession` 决定该 session 的 `agentDir`，
   `cmd_miniapp_ensure_session` 收一个可选 `app_data_workspace`，判完拼成
   `miniapps/<appId>/<segment>` 并写进 `--agent-dir`。`agent.run` 也带这个参数
   （它可能是第一个用到 Agent 的调用），并由 bridge 保证与已建 session 一致。

   **教训比结论更值得留**：一个看起来需要"先与用户讨论架构变更"的阻塞点，先去读
   那个架构到底由什么键控。当时是照着"sidecar 1:1 建在 appId"这句话推理的，而那句
   话是上一个人（和当时的我）顺手写下的、没有回读代码的转述。**阻塞点先查实，
   再判断它是不是真的需要别人拍板。**

3. **✅ 已定并已修：去掉 iframe 的 `allow-same-origin`**。这是本清单里唯一一个
   "修完之后整个 `window.app.*` 权限模型才真正成立"的条目，现在已落地
   （`SANDBOX_FLAGS = 'allow-scripts allow-forms'`，CSP 同步去掉 `'self'`）。
   当时卡在"要先确认 source 端点的内联不漏"—— 查 `inline_miniapp_siblings` /
   `read_inline_target` 就能逐类枚举，且凡是没被内联掉的引用**今天本来就是坏的**，
   不需要活的 Tauri 构建来验。真正的杀手不是 `localStorage` / `img-src` 外发，而是
   同源可达 `window.parent.__TAURI_INTERNALS__.invoke`（Tauri v2 总是注入它），
   那会让上面所有 fs / net / clipboard 的闸一次性作废。完整分析见上文「✅ 一」。
4. **✅ 已定并已修：接上 `kind:'worker'` 的 fs 权限闸**。展开后的 `fs.read` /
   `fs.write` 经 `workerData.fsScope` 带进 worker，由 `assertWithinFsScope` 复用
   `isPathAllowed` 判定。内置 meta 同步改了：`git-graph` 补
   `fs.write: ["{workspace}/**"]`（与它早已声明的读侧同界）与 `node.enabled`，
   `file-explorer` 只补 `node.enabled`、保持只读。完整分析见上文「✅ 二」。
   **附带结论**：`node.enabled` 缺失让这两个内置 app 自己的 `app.call` 全被拒，
   即内置 worker MiniApp 本来就是全死的，而且完全静默 —— 这条是护栏
   `src/shared/miniapp/bundled-apps-permissions.test.ts` 挖出来的。

`agent` 行剩下的 `displayText`（`InjectedTurnRequest` 没有这个字段）与
`contextFiles`（整套子系统，`ai_context` 从未被任何代码读取）已定性为**有意不
对齐**，不是待决。

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
`source` / `uninstall`）现已**实际执行验证**，MiniApp Rust 测试 24/24 通过。
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
| `src/renderer/components/miniapp-host/appRuntimeScript.ts` | 注入 iframe 的 `window.app`（作者门面，参数在这里被转发或丢弃） |
| `src/renderer/components/miniapp-host/appHostDispatch.ts` | 派发路由 + native 截走 |
| `src/server/miniapp-app-dispatch.ts` | sidecar 执行层（判定 #2） |
| `src/server/miniapp-ai.ts` | `app.ai.*`（一次性 query + SDK 消息三态判定） |
| `src/server/miniapp-agent.ts` | `app.agent.*`（session-engine facade） |
| `src-tauri/src/clipboard.rs` | OS 剪贴板（arboard） |
| `src/server/__tests__/miniapp-app-wire.integration.test.ts` | 端到端 wire 契约（真 Sidecar 子进程 + 真 HTTP） |
| `scripts/test_rust_windows.ps1` | Windows 上跑 Rust 测试（旁挂 manifest，见 §7） |
