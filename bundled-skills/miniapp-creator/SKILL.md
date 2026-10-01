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

你正在 HamunaAgent 产品内运行。MiniApp 是一种"独立 Tab 跑的小应用"：用户能在 Chat 里说出"做个图标生成器"，你按 4 文件契约把代码写出来，HamunaAgent 把它存到 `~/.hamuna/miniapps/<id>/`，MiniAppRunner 在新 Tab 里跑出来。默认是纯前端 iframe；需要 shell / 文件系统 / git 时走 `kind: "worker"`，需要调宿主 AI 时开 `ai.enabled`。

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

**为什么不直接写 1 个 `index.html`？** 因为 HamunaAgent 必须用 `meta.json` 知道这是个 MiniApp（id/版本/分类/权限声明）；`storage.json` 是 MiniApp 自己的 KV 状态；`source/` 是浏览器加载的沙箱（iframe `sandbox="allow-scripts allow-same-origin allow-forms"`，**不引入第三方 CDN、不发 fetch 到外网**）。

## Schema

`meta.json` 必须严格符合：

```json
{
  "id": "kebab-case-id",           // 必填，只能 a-z / 0-9 / -
  "name": "显示名",                 // 必填
  "description": "一句话描述",      // 必填，≤ 200 字
  "icon": "wave",                   // 必填，非空字符串（图标名，如 wave / palette / git-branch）
  "category": "other",              // 必填，10 个允许值之一：developer / design / productivity / data / media / game / education / social / finance / other
  "version": 1,                     // 必填，正整数。**你只管写 1**——宿主在写盘时用「覆盖前的 version + 1」覆盖掉这个值并落盘
  "min_host_version": "0.4.0",      // 必填，SemVer x.y.z
  "tags": ["demo"],                 // 可选，≤ 8 个 tag
  "skills": [],                     // 可选，≤ 5 个，取自 bundled-skills/，挂进本 MiniApp 的 Sidecar 会话
  "kind": "iframe",                 // 可选，iframe（默认，纯前端）| worker（需要 shell/fs/git 时）
  "worker_kind": "git-graph",       // kind=worker 时必填，对应 src/server/miniapp-worker/worker-rpc.ts 注册的 kind
  "permissions": {                  // 必填，嵌套对象（不是扁平数组）
    "fs": {
      "read": ["{appdata}/**"],     // 每条路径必须以 {appdata} / {workspace} / {user-selected} 开头
      "write": []                   // 不需要就别写；权限最小化
    },
    "shell": { "allow": [] },       // 命令名白名单，空 = 全禁
    "net": { "allow": [] },         // 域名白名单，空 = 全禁
    "ai": { "enabled": false }      // 需要调宿主 AI 才开，声明 allowed_models / rate_limit_per_minute
  },
  "entry": "source/index.html",     // 必填，相对 meta.json 的路径
  "i18n": {                          // 可选，多语言；顶层的 name/description/tags 是默认语言
    "locales": {
      "en-US": { "name": "Gomoku", "description": "Classic board", "tags": ["game"] }
    }
  },
  "storage": {
    "file": "storage.json",         // 必填
    "defaults": {}                  // 可选，默认 KV
  }
}
```

> **`i18n` 怎么工作**：MiniApp 市场卡片用宿主语言渲染 `i18n.locales[<locale>]` 里对应的 `name` / `description` / `tags`；该 locale 没有的字段**回落到顶层**。查找顺序是 `当前语言 → 简体的 zh → en-US → 顶层`。**只在你真的会写第二种语言时才加 `i18n`**——写了没被用的翻译是纯负债。

> **`permissions` 是嵌套对象**（`fs: {read, write}` / `shell: {allow}` / `net: {allow}`），不是扁平数组。写成 `"fs": []` 会被 schema 校验拒绝。

`id` 是目录名，**必须是 kebab-case ASCII**，全局唯一。如果用户没起名，根据 `name` 自动转（中文 → 拼音 / 拆词；如"图标生成器"→ `icon-generator`）。

需要 shell / 文件系统 / git 能力时，把 `kind` 设成 `"worker"` 并指定 `worker_kind`（当前已注册 `git-graph` 和 `file-explorer`），代码写在宿主侧的 worker 里而不是 iframe 里。参考 `bundled-miniapps/git-graph/`。

## 生成流程（每次必走）

> 契约和流程在本文件；**长什么样**（设计系统、反 AI 味清单、排版、Token 清单、视觉 QA 清单）在 `references/design-playbook.md`，写样式前先读它。

1. **澄清需求**（最重要）：用户说"做个 X"，X 是什么？输入输出？一次性的还是循环用？数据存哪？——**如果需求模糊，先反问 1-3 个澄清问题再开始写**，避免生成后大改
2. **起 App ID**：用户给了就用，没给按上面规则派生
3. **写 meta.json**（用上面 schema）
4. **写 source/index.html**（5-50 行 HTML，body 只放骨架 DOM，不内联 CSS/JS）
5. **写 source/ui.js**（DOMContentLoaded 后再绑事件；状态读写走 `window.__miniappStorage.get/set`）
6. **写 source/style.css**（**必须用 `--hamuna-*` CSS Token**，见 §snippet 与 `references/design-playbook.md` §四，禁止硬编码颜色/字号）
7. **写 storage.json**（`{}` 空即可，或 `defaults` 初值）
8. **提交写盘**（见 §端到端协议）
9. **告诉用户结果**：appId + 4 文件路径 + SceneTab 怎么开

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

Sidecar 收到后会：① 转发到 Rust `cmd_miniapp_create_from_chat`；② Rust 校验 appId 格式 + 5 个必需文件存在且非空 + 相对路径不穿越，然后写入 `~/.hamuna/miniapps/icon-generator/`，**先卸载旧版本再写新版本**（每次覆盖 = version++）；③ 返回 `{ok, appId, version}`，触发 MiniAppRunner reload。

> **写盘不做完整 schema 校验**：`meta.json` 里写错 `category` / `permissions` 不会在安装时报错，但会让 `permissions` 在运行时**静默回落到默认值**（见 `src/server/miniapp-worker/node-limits.ts`）。所以上面的 schema 必须自己写对——本 skill 的模板已通过 `src/shared/miniapp/meta-schema.test.ts` 的守卫，改模板后跑一次该测试。

**Phase 1 范围**：每次 `create` = **整体覆盖**，不做增量 patch。下一轮 Phase 2 才会上 `app.call('miniapp.patch')` 增量修改。

## 安全 / 边界（你必须知道）

- **不引入第三方 CDN**：iframe 沙箱 `sandbox="allow-scripts allow-same-origin allow-forms"`，`connect-src` CSP 禁外网；只能用内联 JS / CSS，或相对路径引本地资源
- **默认断网**：`net.allow` 留空。要拉远端数据得显式声明域名白名单，且默认就该走 Chat Sidecar 而不是 MiniApp 自己发请求
- **不写文件到 MiniApp 目录之外**：`fs` 路径必须以 `{appdata}` / `{workspace}` / `{user-selected}` 开头，硬编码绝对路径会被 schema 拒绝
- **AI 权限按需开**：`ai.enabled` 默认关；开了要同时声明 `allowed_models` 和 `rate_limit_per_minute`，参考 `bundled-miniapps/icon-generator/meta.json`
- **不大体积**：4 文件总计 ≤ 50KB

## 与 Chat Sidecar 的关系

你（AI）运行在 Chat Sidecar 里，MiniApp 运行在用户 iframe 里。你写完代码写盘后 MiniApp 即可独立运行——它不会再回 Chat 跟你聊。MiniApp 自己要用 AI 时，走它自己的 `ai` 权限通道，不复用你这个会话。

Chat 可拖 `~/.hamuna/miniapps/<appId>/source/` 目录到 Chat context 补仓：拖进来后你读 4 文件，按用户续问重写，再 POST `/api/miniapp/create` 整体覆盖。

## 端到端示例（用户说"做个图标生成器 MiniApp"）

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
    <button id="gen-btn" type="button">Generate Icon</button>
    <div id="icon-output">🎨</div>
  </main>
  <script src="ui.js"></script>
</body>
</html>
```

```js
// source/ui.js
document.getElementById('gen-btn').addEventListener('click', () => {
  const icons = ['🎨', '🖌️', '✏️', '🎭', '🎪', '🎬'];
  document.getElementById('icon-output').textContent =
    icons[Math.floor(Math.random() * icons.length)];
});
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

> **token 名字必须是 `--hamuna-*`**，例如 `--hamuna-bg-primary` / `--hamuna-text-primary` / `--hamuna-accent` / `--hamuna-radius-md` / `--hamuna-font-sans`。宿主注入的就是这 24 个（见 `src/renderer/components/miniapp-host/theme-tokens.ts`），写成 `--bg-primary` / `--ink` / `--accent-primary` 这类宿主里**不存在**的名字会**静默失效**——不报错，只是看起来"没生效"。完整清单见 `references/design-playbook.md` §四。

```json
// meta.json
{
  "id": "icon-generator",
  "name": "Icon Generator",
  "description": "按一下换一个 emoji 图标",
  "icon": "palette",
  "category": "design",
  "version": 1,
  "min_host_version": "0.4.0",
  "tags": ["demo", "icons"],
  "permissions": {
    "fs": { "read": ["{appdata}/**"], "write": [] },
    "shell": { "allow": [] },
    "net": { "allow": [] },
    "ai": { "enabled": false }
  },
  "entry": "source/index.html",
  "storage": { "file": "storage.json", "defaults": {} }
}
```

## 何时不用这个 skill

- "帮我写个 Python 脚本" → 写文件 / Bash 工具，不走 MiniApp
- "帮我做个网页"（一次性、用户不想放进产品）→ 写文件工具
- "帮我写 SQL / 配置 nginx" → 对应工具，不走 MiniApp
- 用户要做的是 IM Bot / 定时任务 → 走 `hamuna-cli` 的 `agent channel` / `cron`

如果你判断需求**确实适合 MiniApp** 但又不确定怎么拆，先用一句话回用户："我准备拆成 X / Y / Z 三个交互，4 文件，预计 <appId> 这个名字，可以吗？"——比写完再退省成本。