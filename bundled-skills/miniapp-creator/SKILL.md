---
name: miniapp-creator
description: >-
  当用户想要"做个 MiniApp / 写个小工具 / 做个生成器 / 做个表单 / 做个可视化面板 / 做个 dashboard"时使用这个 skill。
  典型触发场景：用户说"帮我做个图标生成器 MiniApp"、"写个抽奖转盘"、"做个清单工具"、"我想让这个想法变成一个独立的 UI 空间"、
  "把这段工作流封装成一个 MiniApp"、"做个 Todo / 番茄钟 / 番茄工具"、"做个可视化看板"。
  即使用户没明说"MiniApp"，只要意图是"给我一个独立的、可重复使用的、带 UI 的小工具"，就该走这个 skill。
  反向边界：纯单文件代码生成（写 Python 脚本、SQL 查询、命令行工具）不归这里；需求必须能拆成 4 文件（meta.json + source/index.html + source/ui.js + source/style.css）才适合 MiniApp 形态。
author: HamunaAgent
---

# miniapp-creator — 把想法变成 MiniApp

你正在 HamunaAgent 产品内运行。MiniApp 是一种"独立 Tab 跑的小应用"：用户能在 Chat 里说出"做个图标生成器"，你按 4 文件契约把代码写出来，HamunaAgent 把它存到 `~/.hamuna/miniapps/<id>/`，MiniAppRunner 在新 Tab 里跑出来。

MiniApp 运行在 iframe 沙箱里，能用的一切宿主能力都挂在 **`window.app`** 这一个全局对象上。`app.*` 走 postMessage 到宿主执行，权限由 `meta.json::permissions` 决定。

## 你写什么 = 4 文件契约

每个 MiniApp 落地为一个 `appId` 目录，里面恰好 4 个文件 + 1 个 `storage.json`：

```
~/.hamuna/miniapps/<appId>/
├── meta.json              # 必填 — 见 §Schema
├── storage.json           # 可空 — MiniApp 状态持久化（KV）
└── source/
    ├── index.html         # 必填 — entry HTML
    ├── ui.js              # 必填 — 交互逻辑
    └── style.css          # 必填 — 样式（必须用 CSS Token，见 §snippet）
```

**为什么不直接写 1 个 `index.html`？** 因为 HamunaAgent 必须用 `meta.json` 知道这是个 MiniApp（id/版本/分类/权限声明）；`storage.json` 是 MiniApp 自己的 KV 状态；`source/` 是浏览器加载的沙箱（iframe `sandbox="allow-scripts allow-forms"`）。

> **沙箱没有同源，写代码时按这个假设来。** MiniApp 的文档走 iframe `srcdoc`，宿主**不给** `allow-same-origin`，所以你的页面运行在一个 opaque origin 上：`localStorage` / `sessionStorage` / `document.cookie` 一碰就抛 `SecurityError`，`window.parent.document` 也读不到。持久化一律走 `app.storage`（落到宿主侧的 `storage.json`），能力一律走 `app.*`，不要试图绕过桥直接摸宿主的对象。
>
> 同源一旦打开就等于沙箱不存在：宿主是 Tauri 应用，Tauri v2 总是往页面注入 `window.__TAURI_INTERNALS__`，同源页面可以直接 `window.parent.__TAURI_INTERNALS__.invoke('cmd_read_workspace_file', …)` 拿到任意 Tauri 命令，把 MiniApp 的整套权限声明一次性绕过。所以**不要**要求、也不要依赖同源。
>
> 同理，`source/index.html` 里引用的 `ui.js` / `style.css` **不需要**你能加载它们：宿主在加载前就把同目录的兄弟文件内联进 HTML 了。写相对路径引用即可，但如果某个引用在真实运行里加载不到，不要往 CSP 或 sandbox 上想解决办法 —— 那是宿主在 `inline_miniapp_siblings` 那里没内联成，`<script src>` 到宿主 origin 必然 404。

## `window.app` — 唯一的宿主接口

宿主在 `ui.js` 之前注入 `window.app`，**直接用，不需要握手、不需要 nonce、不要自己 `postMessage`**。

### 属性

| 属性 | 说明 |
|------|------|
| `app.appId` | 当前 MiniApp id |
| `app.locale` | `'zh-CN'` / `'en-US'`，随宿主切换更新 |
| `app.appearanceMode` | `'dark'` / `'light'` |
| `app.platform` | `'win32'` / `'darwin'` / `'linux'` |

### 能力（全部返回 Promise）

```javascript
// 状态持久化 —— 落在本 app 的 storage.json，无需任何权限声明
const last = await app.storage.get('lastPrompt');
await app.storage.set('lastPrompt', 'hello');

// 文件系统 —— 需 meta.json 声明 fs.read / fs.write 的路径模板
const text = await app.fs.readFile('{appdata}/notes.md');
await app.fs.writeFile('{appdata}/notes.md', text + '\nmore');
const entries = await app.fs.readdir('{workspace}/src');
const st = await app.fs.stat('{workspace}/README.md');   // {size,isFile,isDirectory,mtime,ctime}

// Shell —— 需 permissions.shell.allow 声明命令名白名单
const r = await app.shell.exec('git log --oneline -20', { cwd: '{workspace}' });
// → { stdout, stderr, exit_code }
// 可选 opts.timeout（毫秒）：默认 30s，宿主会夹到 1s~5min。
// 0 和负数**不等于**"不限时"，会被抬到 1s —— 要跑长任务就分片调用。
// 命令名按**第一个词**精确匹配白名单；`;` `&` `|` `<` `>` `^` `` ` `` `%` `!`
// `(` `)` `$` 引号 一律拒（含引号内），所以没有管道 / 重定向 / 命令串联。

// 网络 —— 需 permissions.net.allow 声明域名白名单，且只允许 https
const res = await app.net.fetch('https://api.example.com/data');
// → { status, body }

// 只读系统信息 —— 无需权限
const os = await app.os.info();   // { platform, homedir, tmpdir, hostname }
```

其它可写方法：`app.fs.appendFile` / `app.fs.mkdir` / `app.fs.rm` / `app.fs.rmdir` /
`app.fs.unlink` / `app.fs.lstat` / `app.fs.access` / `app.fs.copyFile` / `app.fs.rename`。
`app.storage.remove(key)` 删除一个键（返回是否真的删掉了）。

> **路径模板**：`{appdata}` / `{workspace}` 会被宿主展开成绝对路径。支持尾部
> `/**`，例如 `"{workspace}/**"` 表示整个工作区。但**中间段的 `*` 不生效** ——
> 权限声明必须写成可一眼看清的前缀。

### 宿主 AI（`app.ai`）—— 无状态纯文本

需 `meta.json` 声明 `permissions.ai.enabled = true`。**复用宿主已配置的
Provider，MiniApp 不需要（也不应该）持有 API Key。**

```javascript
const { text } = await app.ai.complete('把这句翻译成英文：你好');
const models = await app.ai.getModels();   // { models: [...], display: [...] }
```

**模型没有任何工具** —— 读不到文件、跑不了命令、不能联网。这是安全设计：
MiniApp 的 prompt 完全由第三方作者控制，若模型带着工具，一次间接注入就能在
用户机器上执行命令。所以 `app.ai` 只适合翻译 / 分类 / 摘要这类纯文本处理。

可选声明 `permissions.ai.allowed_models`（数组，支持 `"*"`）：传了未声明的 model
会被**直接拒绝**而不是静默降级。判定只看你**显式传入**的 `model` —— 不传 `model`
就不受这一层限制，实际走的是宿主当前配置的模型。想要一个封死的模型集合，请在
每次调用里显式写 `model`。

### 隐藏 Agent 会话（`app.agent`）—— 有状态、能读自己的沙箱

需 `meta.json` 声明 `permissions.agent.enabled = true`。**与 `ai.enabled`
相互独立** —— 想用 Agent 必须单独开，不会被 `ai` 顺带带出来。

```javascript
// 首轮
const { text } = await app.agent.run('总结这个目录的结构', { run_id: 'r1' });
// 接上一轮继续（会话有上下文）
const more = await app.agent.turnText('那前端入口在哪？', { run_id: 'r1' });
// 取消（只停这一个 turn，不影响同进程其它 turn）
await app.agent.cancel({ run_id: 'r1' });
```

**与 `app.ai` 的关键区别**：Agent 是**有状态**的会话（`run_id` 相同则上下文延续），
并且**能读** —— 它的 cwd 被强制钉在本 app 的 `{appdata}` 目录内，所以"总结这个
目录的结构""找出入口文件"这类活可以直接做，不用你自己先把文件读出来塞进 prompt。

**它是只读的**：写文件与跑命令一律被硬拒（`plan` 权限模式 + PreToolUse 闸门）。
这是有意的 —— MiniApp 的 prompt 由第三方作者控制，而拿到的是带工具的模型，
放开写/执行等于把用户机器交给市场里的任意 app。需要改文件请用 `app.fs.*`
（那套有显式权限声明与路径闸门）；需要 AI 动手改东西，请把任务通过
§Bubble Claim 交给对话里的 agent。

需要流式输出时用 `app.agent.onEvent(fn)` 订阅（`agent.*` 事件走独立通道）。
当前 `run` / `turnText` 返回终态文本。

### 原生对话框与剪贴板

`app.dialog.*` **无需权限声明**（都是用户显式操作）：

```javascript
const picked = await app.dialog.open({ title: '选择文件', multiple: true });
// → string | string[] | null（null = 用户取消，这是正常结果，不是错误）
const target = await app.dialog.save({ defaultPath: '~/out.txt' });
await app.dialog.message('导出完成', { kind: 'info' });
const yes = await app.dialog.message('确定删除？', { kind: 'confirm' });
// → { confirmed: true | false }
```

`app.clipboard.*` **必须显式 opt-in**，不声明直接被拒：

```json
{ "permissions": { "clipboard": { "enabled": true } } }
```

```javascript
await app.clipboard.writeText('复制的内容');
const clip = await app.clipboard.readText();
```

> **剪贴板不能和 dialog 算一档。** dialog 拿不到任何东西，剪贴板里是**宿主的**
> 用户状态——典型就是刚复制出来的密码。一个既能读剪贴板又能 `net.fetch` 外发的
> MiniApp 就是一条现成的凭据外泄链，所以它和 `ai` / `agent` 一样要显式声明。

### 自定义后端（可选）

需要复杂计算或 npm 依赖时，把 `meta.json` 设成 `kind: "worker"` + `worker_kind`，代码写在 `source/worker.js`，用 `app.call('method', params)` 调用。**默认不要用** —— 上面的 `app.fs` / `app.shell` / `app.net` / `app.os` / `app.storage` 已覆盖绝大多数工具型需求，不需要 worker 运行时。

> **`app.call` 必须配 `permissions.node.enabled = true`**，否则宿主直接拒：
> `app.call requires meta.permissions.node.enabled = true`。`kind: "worker"` 只决定代码
> 跑在哪，不会替你打开这个权限。

参考 `bundled-miniapps/git-graph/`（`worker_kind: "git-graph"`）与 `bundled-miniapps/file-explorer/` —— 这两个都是 worker，它们的 `meta.json` 里都带着 `"node": { "enabled": true }`。

### 主题与 i18n

```javascript
// 多语言字符串挑选：当前语言 → en-US → zh-CN → 首值 → fallback
const label = app.t({ 'zh-CN': '保存', 'en-US': 'Save' }, 'Save');

// 主题 / 语言变更时重新渲染
app.onAppearanceChange(() => repaint());
app.onLocaleChange((locale) => repaint());

// Tab 切走 / 切回 —— 用户看不到时应当停掉轮询、动画、长任务
app.onActivate(() => resume());
app.onDeactivate(() => clearInterval(timer));
```

> `onActivate` / `onDeactivate` 只在**状态迁移**时触发，首次挂载不发。

### 明确不存在的能力（不要写）

- `app.openbitfun.*` / `app.workspace.*` / `app.git.*` / `app.session.*` / `app.terminal.*` / `app.browser.*`
- `window.__miniappStorage` —— 不存在（早期文档写错过）。用 `app.storage`。
- 第三方 CDN 脚本 —— **不能直接写 `<script src>`**，iframe CSP `default-src 'none'` 会拦掉。
  改用 `meta.json` 的 `dependencies` 声明（见下方「CDN 依赖」），由宿主注入标签并按需放宽 CSP。
- `app.ai.cancel` —— 存在，但只对**在途的** `ai.complete` 生效（按 `run_id` 中止）。
  请求已返回后再调是正常时序，返回 `cancelled: false`，不是错误。
- `app.agent` 的流式返回 —— `run` / `turnText` 只返回终态文本；流式走 `agent.onEvent`。
- `agent.workspace_scope` —— 声明保留但当前不放开，`agent.run` 强制落在 appdata 下。
- `worker_kind` —— 白名单制，没有通用 npm 依赖加载。

**想让 AI 帮忙？** 二选一：
- 纯文本处理（翻译 / 分类 / 摘要）→ `app.ai.complete`，需 `ai.enabled`
- 需要**读**自己 appdata 里的文件来分析 → `app.agent.run`，需 `agent.enabled`
- 需要**写**文件 → `app.fs.writeFile`（需 `fs.write` 权限），不是 `app.agent`
- 只是想把一段草稿交给对话里的 agent → 用下面的 §Bubble Claim

## Schema

`meta.json` 必须严格符合：

```json
{
  "id": "kebab-case-id",           // 必填，只能 a-z / 0-9 / -
  "name": "显示名",                 // 必填
  "description": "一句话描述",      // 必填，≤ 200 字
  "icon": "wave",                   // 必填，非空字符串（图标名，如 wave / palette / git-branch）
  "category": "other",              // 必填，10 个允许值之一：developer / design / productivity / data / media / game / education / social / finance / other
  "version": 1,                     // 必填，正整数。**你只管写 1**——宿主写盘时用「覆盖前的 version + 1」覆盖掉这个值
  "min_host_version": "0.3.233",    // 必填，SemVer x.y.z。宿主会真的比较：声明高于宿主版本 → 该 app 不出现在列表里
  "tags": ["demo"],                 // 可选，≤ 8 个 tag
  "skills": [],                     // 可选，≤ 5 个，取自 bundled-skills/，挂进本 MiniApp 的 Sidecar 会话
  "kind": "iframe",                 // 可选，iframe（默认，纯前端）| worker（需要自定义 worker.js 时）
  "worker_kind": "git-graph",       // kind=worker 时必填，对应 src/server/miniapp-worker/worker-rpc.ts 注册的 kind
  "permissions": {                  // 必填，嵌套对象（不是扁平数组）
    "fs": {
      "read": ["{appdata}/**"],     // 每条路径必须以 {appdata} / {workspace} / {user-selected} 开头
      "write": []                   // 不需要就别写；权限最小化
    },
    "shell": { "allow": [] },       // 命令名白名单，空 = 全禁
    "net": { "allow": [] },         // 域名白名单，空 = 全禁
    "clipboard": { "enabled": true },// 要用 app.clipboard.* 才写；不写 = 拒绝
    "ai": { "enabled": true },       // 要用 app.ai.* 才写
    "agent": { "enabled": true },    // 要用 app.agent.* 才写
    "node": { "enabled": true }      // 要用 app.call（worker）才写
  },
  "entry": "source/index.html",     // 必填，相对 meta.json 的路径
  "dependencies": [                 // 可选，≤ 10 个 CDN 依赖
    {
      "url": "https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.js",
      "type": "script"             // script | style
    }
  ],
  "i18n": {                          // 可选，多语言；顶层的 name/description/tags 是默认语言
    "locales": {
      "en-US": { "name": "Gomoku", "description": "Classic board", "tags": ["game"] }
    }
  },
  "storage": {
    "defaults": {}                  // 可选。get(key) 未命中时回落的初值
  }
}
```

> **`permissions` 是嵌套对象**（`fs: {read, write}` / `shell: {allow}` / `net: {allow}`），不是扁平数组。写成 `"fs": []` 会被 schema 校验拒绝。
>
> **路径模板**：`{appdata}` = 本 app 数据目录（始终可读写）、`{workspace}` = 当前工作区。**不要写绝对路径**，schema 会拒。`app.fs.*` 收到的路径必须落在已声明前缀内，否则宿主返回 `PERMISSION_DENIED`。
>
> **持久化落点固定**：KV 恒定写在 `<appdata>/storage.json`，**不由 meta.json 指定**。`storage.file` 曾被标成"必填"，但宿主从来不读它 —— 声明什么名字都还是 `storage.json`。落哪个文件是安全边界：`app.storage` 是免权限 API，不该由作者决定它写哪。`app.fs.*` 才是要自己管文件的那条路。
>
> **`storage.defaults` 是真的会生效的**：`app.storage.get(key)` 在该 key 从未写入时返回这里的初值（照上面的例子写，`get('items')` 拿到 `[]` 而不是 `undefined`）。它只做回落：作者 `set(key, null)` 存下的 `null` 就是存下的值，不会被默认值顶掉；`remove` 之后回落重新生效。声明了但形状写错（不是对象）会被 schema 当场拒掉。

### CDN 依赖

iframe 的 CSP 是 `default-src 'none'`，**在 HTML 里直接写 `<script src="https://...">` 会被静默拦掉**。要加载第三方库必须走 `meta.json` 的 `dependencies`，宿主会注入标签并按声明的域名放宽 CSP。

三条硬约束（违反会被 schema 直接拒绝，app 装不上）：

1. **必须是 `https://`** —— `http://` 会被拒。
2. **域名必须同时写进 `permissions.net.allow`** —— 这是授权边界，不是重复声明。不写就等于让宿主替你开一个你没申请过的网络权限。
3. **`type` 只能是 `script` 或 `style`**。

```json
{
  "permissions": { "net": { "allow": ["cdn.jsdelivr.net"] } },
  "dependencies": [
    { "url": "https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.js", "type": "script" },
    { "url": "https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.css", "type": "style" }
  ]
}
```

宿主只对**声明过的 host** 放宽 `script-src` / `style-src`，`connect-src` 恒为 `'none'`（依赖是加载期资源，不是通道）。脚本标签带 `defer`，所以它在 `DOMContentLoaded` 之前执行，但排在其它 defer 脚本之后——依赖多个库时注意顺序。

> 优先选有 UMD 全局包的库。iframe 里没有 bundler，`require()` / `import` 不可用。
>
> **`min_host_version` 填当前版本或更低**。填一个高于宿主版本的值，MiniApp 会直接从列表里消失（用户看不到、也打不开）。

`id` 是目录名，**必须是 kebab-case ASCII**，全局唯一。如果用户没起名，根据 `name` 自动转（中文 → 拼音 / 拆词；如"图标生成器"→ `icon-generator`）。

## 生成流程（每次必走）

> 契约和流程在本文件；**长什么样**（设计系统、反 AI 味清单、排版、Token 清单、视觉 QA 清单）在 `references/design-playbook.md`，写样式前先读它。

1. **澄清需求**（最重要）：用户说"做个 X"，X 是什么？输入输出？一次性的还是循环用？数据存哪？——**如果需求模糊，先反问 1-3 个澄清问题再开始写**
2. **起 App ID**：用户给了就用，没给按上面规则派生
3. **定权限**：这个 app 真的需要读文件 / 跑命令 / 联网吗？不需要就全留空——权限最小化是硬要求
4. **写 meta.json**（用上面 schema）
5. **写 source/index.html**（5-50 行 HTML，body 只放骨架 DOM，不内联 CSS/JS）
6. **写 source/ui.js**（状态用 `app.storage`，文件/命令用 `app.fs` / `app.shell`，都要包 try/catch 显示错误）
7. **写 source/style.css**（**必须用 `--hamuna-*` CSS Token**，见 §snippet 与 `references/design-playbook.md` §四）
8. **写 storage.json**（`{}` 空即可）
9. **提交写盘**（见 §端到端协议）
10. **告诉用户结果**：appId + 4 文件路径 + SceneTab 怎么开

## 端到端协议

写完 4 文件后，**你必须通过 HTTP 调用写盘**（不是写文本到对话里就算了）：

```
POST /api/miniapp/create
Content-Type: application/json

{
  "appId": "icon-generator",
  "source": {
    "meta.json": "{...}",
    "source/index.html": "<!doctype html>...",
    "source/ui.js": "...",
    "source/style.css": "...",
    "storage.json": "{}"
  }
}
```

Sidecar 收到后会：① 转发到 Rust `cmd_miniapp_create_from_chat`；② Rust 校验 appId 格式 + 5 个必需文件存在且非空 + `meta.json.id` 等于 appId，然后写入 `~/.hamuna/miniapps/icon-generator/`，**先卸载旧版本再写新版本**（每次覆盖 = version++）；③ 返回 `{ok, appId, version, path}`。

> **已经打开的 SceneTab 不会自动刷新。** create 不发任何事件，SceneTab 只在
> `appId` 变化时重新加载，切走再切回**不会**重载。所以改完已有 MiniApp 后要告诉
> 用户「关掉旧 Tab、从 MiniApp Center 重新打开一次」——再打开会新开一个 Tab，
> 那次才是加载新版本。只切 Tab 是看不到改动的。

> **每次 `create` = 整体覆盖**，不是增量 patch。修改已有 MiniApp 时，把它的 4 个文件读出来、改完再整体 POST 回去。

## 安全 / 边界（你必须知道）

- **默认断网**：iframe CSP 是 `connect-src 'none'`，MiniApp 自己发不出任何请求。要联网必须用 `app.net.fetch` + 声明 `net.allow` 域名白名单
- **权限最小化**：`fs` / `shell` / `net` 留空 = 全禁。只申请真正用到的
- **AI 要显式 opt-in**：`app.ai.*` 需 `permissions.ai.enabled = true`（见 §宿主 AI）。它复用宿主已配好的 Provider，MiniApp 永远不持有 API Key；模型不带任何工具，只适合翻译 / 分类 / 摘要这类纯文本
- **要读写文件就别用 AI**：`app.ai` 读不到文件也跑不了命令，这是安全设计（prompt 由第三方作者控制）。要读写走 `app.fs` / `app.shell` + 对应权限声明
- **不大体积**：**每个**文件 ≤ 64KB（Rust 逐个校验，超了直接拒；没有"总数"上限）
- **错误要显示**：`app.*` 调用失败会 reject（带 `.code`）。UI 上要 catch 并提示，别静默吞掉——静默失败是 MiniApp 最常见的坏体验

## Bubble Claim：把活交给对话里的 agent

当 MiniApp 需要 AI 能力（宿主没提供 `app.ai`），唯一路径是把草稿交给用户的 Chat 输入框，用户自己按下回车。

```js
let nonce = null;
const pendingClaims = [];

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const d = event.data;
  if (d && d.kind === 'host.ready' && typeof d.nonce === 'string') {
    nonce = d.nonce;
    pendingClaims.splice(0).forEach(sendBubbleClaim);
  }
});

function postBubbleClaim({ draft, attachments }) {
  if (!nonce) { pendingClaims.push({ draft, attachments }); return; }
  sendBubbleClaim({ draft, attachments });
}

function sendBubbleClaim({ draft, attachments }) {
  window.parent.postMessage(
    {
      kind: 'chat.claimComposer',
      nonce,                                   // 必须用宿主给的，不能自己编
      payload: {
        appId: APP_ID,                          // 必须等于 meta.json 的 id
        draft,
        ...(attachments ? { attachments } : {}),
      },
    },
    '*',
  );
}
```

三条硬规则，违反哪条消息都会被**静默丢弃**（不报错、不提示）：

1. **nonce 不能自己编。** `verifyBubbleClaim` 逐字比对，自编的一定被拒。`host.ready` 之前发的 claim 要先排队。
2. **`payload.appId` 必须等于 `meta.json.id`。** 防冒名顶替别的 MiniApp。
3. **消息源必须是 `window.parent`**，宿主做 `event.source === iframe.contentWindow` 严格相等校验。

`draft` 里写清楚上下文——用户看到的就是他即将发送的原文，所以别塞"请帮我"，直接写可执行的诉求。

## 与 Chat Sidecar 的关系

你（AI）运行在 Chat Sidecar 里，MiniApp 运行在用户 iframe 里。你写完代码写盘后 MiniApp 即可独立运行——它不会再回 Chat 跟你聊。

Chat 可拖 `~/.hamuna/miniapps/<appId>/source/` 目录到 Chat context 补仓：拖进来后你读 4 文件，按用户续问重写，再 POST `/api/miniapp/create` 整体覆盖。

## 端到端示例（用户说"做个待办清单 MiniApp"）

```html
<!-- source/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <form id="add-form">
      <input id="new-item" type="text" />
      <button id="add-btn" type="submit">Add</button>
    </form>
    <ul id="list"></ul>
    <p id="status" role="status"></p>
  </main>
  <script src="ui.js"></script>
</body>
</html>
```

```js
// source/ui.js
const list = document.getElementById('list');
const status = document.getElementById('status');

// 状态走 app.storage —— 宿主已注入 window.app，无需握手
async function load() {
  // get 同样会 reject（appdata 不可写时）。只把 set 包起来是最常见的漏法：
  // 首屏那次 get 裸奔，失败时用户看到的是一个空清单，没有任何提示。
  try {
    const items = (await app.storage.get('items')) || [];
    render(items);
  } catch (err) {
    status.textContent = `Load failed: ${err.message}`;
  }
}

function render(items) {
  list.innerHTML = '';
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  }
}

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('new-item');
  const text = input.value.trim();
  if (!text) return;
  try {
    const items = (await app.storage.get('items')) || [];
    items.push(text);
    await app.storage.set('items', items);
    input.value = '';
    render(items);
    status.textContent = '';
  } catch (err) {
    // 持久化失败要让用户看见，不能静默
    status.textContent = `Save failed: ${err.message}`;
  }
});

load();
```

```css
/* source/style.css — 只用宿主注入的 --hamuna-* token，不写硬编码颜色/字号 */
:root {
  background: var(--hamuna-bg-primary, #fff);
  color: var(--hamuna-text-primary, #1c1612);
  font-family: var(--hamuna-font-sans, -apple-system, 'Segoe UI', sans-serif);
}
button {
  background: var(--hamuna-accent, #7b8f6b);
  color: var(--hamuna-text-on-primary, #fff);
  border: 0;
  padding: 8px 16px;
  border-radius: var(--hamuna-radius-sm, 4px);
  min-height: 32px;
}
```

> **token 名字必须是 `--hamuna-*`**，例如 `--hamuna-bg-primary` / `--hamuna-text-primary` / `--hamuna-accent` / `--hamuna-radius-md` / `--hamuna-font-sans`。宿主注入的就是这 26 个（见 `src/renderer/components/miniapp-host/theme-tokens.ts`），写成 `--bg-primary` / `--ink` 这类名字会**静默失效**——不报错，只是看起来"没生效"。完整清单见 `references/design-playbook.md` §四。

```json
// meta.json
{
  "id": "todo-list",
  "name": "Todo List",
  "description": "轻量待办清单，状态存在本地",
  "icon": "check-square",
  "category": "productivity",
  "version": 1,
  "min_host_version": "0.3.233",
  "tags": ["todo", "productivity"],
  "permissions": {
    "fs": { "read": [], "write": [] },
    "shell": { "allow": [] },
    "net": { "allow": [] }
  },
  "entry": "source/index.html",
  "storage": { "defaults": { "items": [] } }
}
```

## 何时不用这个 skill

- "帮我写个 Python 脚本" → 写文件 / Bash 工具，不走 MiniApp
- "帮我做个网页"（一次性、用户不想放进产品）→ 写文件工具
- "帮我写 SQL / 配置 nginx" → 对应工具，不走 MiniApp
- 用户要做的是 IM Bot / 定时任务 → 走 `hamuna-cli` 的 `agent channel` / `cron`

如果你判断需求**确实适合 MiniApp** 但又不确定怎么拆，先用一句话回用户："我准备拆成 X / Y / Z 三个交互，4 文件，预计 <appId> 这个名字，可以吗？"——比写完再退省成本。
