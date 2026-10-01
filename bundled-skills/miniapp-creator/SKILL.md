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

你正在 HamunaAgent 产品内运行。MiniApp 是一种"独立 Tab 跑的小应用"：用户能在 Chat 里说出"做个图标生成器"，你按 4 文件契约把代码写出来，HamunaAgent 把它存到 `~/.hamuna/miniapps/<id>/`，MiniAppRunner 在新 Tab 里跑出来。**Phase 1 范围内零 Sidecar / 零权限 / 零 skill 挂载**——你只是写代码 + 静态 UI。

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
  "name": "显示名",                 // 必填，≤ 50 字
  "description": "一句话描述",      // 必填，≤ 200 字
  "icon": "wave",                   // 必填，6 个允许值之一：wave / palette / bolt / clock / list / chart
  "category": "utility",              // 必填，6 个允许值之一：utility / productivity / creative / education / entertainment / data
  "version": 1,                     // 必填，正整数
  "min_host_version": "0.3.0",      // 必填，SemVer x.y.z
  "tags": ["demo"],                 // 可选，≤ 8 个 tag
  "permissions": {                  // Phase 1 全空数组，Phase 2 起才能填
    "fs": [],
    "shell": [],
    "net": [],
    "ai": []
  },
  "entry": "source/index.html",     // 必填，相对 meta.json 的路径
  "storage": {
    "file": "storage.json",         // 必填
    "defaults": {}                  // 可选，默认 KV
  }
}
```

`id` 是目录名，**必须是 kebab-case ASCII**，全局唯一。如果用户没起名，根据 `name` 自动转（中文 → 拼音 / 拆词；如"图标生成器"→ `icon-generator`）。

## 生成流程（每次必走）

1. **澄清需求**（最重要）：用户说"做个 X"，X 是什么？输入输出？一次性的还是循环用？数据存哪？——**如果需求模糊，先反问 1-3 个澄清问题再开始写**，避免生成后大改
2. **起 App ID**：用户给了就用，没给按上面规则派生
3. **写 meta.json**（用上面 schema）
4. **写 source/index.html**（5-50 行 HTML，body 只放骨架 DOM，不内联 CSS/JS）
5. **写 source/ui.js**（DOMContentLoaded 后再绑事件；状态读写走 `window.__miniappStorage.get/set`）
6. **写 source/style.css**（**必须用 CSS Token**，见 §snippet，禁止硬编码颜色/字号）
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

Sidecar 收到后会：① 解析 `meta.json` schema 校验；② 转发到 Rust `cmd_miniapp_create_from_chat`；③ Rust 写入 `~/.hamuna/miniapps/icon-generator/`，**先卸载旧版本再写新版本**（每次覆盖 = version++）；④ 返回 `{ok, appId, version}`，触发 MiniAppRunner reload。

**Phase 1 范围**：每次 `create` = **整体覆盖**，不做增量 patch。下一轮 Phase 2 才会上 `app.call('miniapp.patch')` 增量修改。

## 安全 / 边界（你必须知道）

- **不引入第三方 CDN**：iframe 沙箱 `sandbox="allow-scripts allow-same-origin allow-forms"`，`connect-src` CSP 禁外网；只能用内联 JS / CSS，或相对路径引本地资源
- **不发 fetch 到外网**：`net: []`（Phase 1 必空）。要拉远端数据走 Chat Sidecar 不是 MiniApp
- **不写文件到 MiniApp 目录之外**：浏览器侧只能读 `source/` 静态文件 + `storage.json`；要跨进程写盘走 Sidecar HTTP
- **不调 AI**：Phase 1 没有 MiniApp 自有 Sidecar，`ai: []`（Phase 2 Cowork Sidecar 起来后才能调）
- **不大体积**：4 文件总计 ≤ 50KB；超了用户得在 Phase 2 用 Worker Manager

## 与 Chat Sidecar 的关系

你（AI）运行在 Chat Sidecar 里，MiniApp 运行在用户浏览器 iframe 里。两者**完全独立**——你写完代码写盘了 MiniApp 即可，MiniApp 跑起来后不会再回 Chat 跟你聊（Phase 1 边界）。Phase 2 起 MiniApp 才能调 AI（走 Cowork Sidecar）。

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
/* source/style.css — Phase 1: 仅用 CSS Token，不写硬编码 */
:root {
  background: var(--bg-primary);
  color: var(--ink);
  border-radius: var(--theme-radius-md);
  font-family: var(--font-body);
}
button {
  background: var(--accent-primary);
  color: var(--bg-primary);
  border: 0;
  padding: 8px 16px;
  border-radius: var(--theme-radius-sm);
}
```

```json
// meta.json
{
  "id": "icon-generator",
  "name": "Icon Generator",
  "description": "按一下换一个 emoji 图标",
  "icon": "palette",
  "category": "creative",
  "version": 1,
  "min_host_version": "0.3.0",
  "tags": ["demo", "icons"],
  "permissions": { "fs": [], "shell": [], "net": [], "ai": [] },
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