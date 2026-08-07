# Repo conventions

HamunaAgent 桌面端项目的架构模式、通信规范和开发约定。

## Data flow — API to component

### Parser philosophy
- **无独立 parser 层**：数据直接从 SDK 消息流（`SDKMessage`）消费，SSE 事件经 `SseConnection` 分发到各 Tab 的 `TabProvider`
- **流式优先**：AI 回复是流式的（`while(true)` generator yield），组件直接消费增量数据
- **结构化输出**：工具调用结果通过 `tool_result.attachments` 归一化，前端统一 `ToolAttachmentGallery` 渲染

### State management
- **React Context + Hooks**：无 Redux/Zustand，状态通过 Context 分层
  - `ConfigProvider` — 全局配置（只读，写盘走 Rust）
  - `TabProvider` — 每 Tab 独立会话状态（SSE、Sidecar 生命周期、消息列表）
  - `ToastProvider` — 全局通知
- **磁盘优先**：配置写盘 MUST 以磁盘为准（`await loadAppConfig()` 读最新再合并），禁止用 React 状态写盘
- **Sidecar Owner 模型**：Session : Sidecar = 1 : 1，Tab/Task/Goal 共享 Sidecar

## Routing

### Navigation model
- **无 React Router**：自定义多 Tab 系统，每个 Tab 的 `view` 字段决定渲染哪个页面
- **Tab 类型**：`'launcher' | 'chat' | 'settings' | 'taskcenter' | 'space'`
- **窗口检测**：`main.tsx` 根据 Tauri 窗口 label（`fb-ball`/`fb-companion`/`fb-shield`）渲染完全独立的 React tree

### Route registration
- `MemoizedTabContent` 根据 `tab.view` 分发到对应的 Page 组件
- 新增页面：在 `types/tab.ts` 的 ViewType 联合类型中添加 + 在 `MemoizedTabContent` 中添加 case

## Code splitting & SSR

- **纯客户端**：Tauri WebView，无 SSR
- **懒加载**：`Chat`、`Settings`、`TaskCenter`、`Space` 使用 `React.lazy()`，`Launcher` 热加载（默认首屏）
- **Fallback**：`ChatBootOverlay`（Chat 页面初始化加载态）

## Analytics

- 自研埋点系统（`src/renderer/analytics/`）
- 事件通过 Rust invoke 发送，带 runtime 维度口径
- 设备标识 + surface 归因
- 详见 `tech_docs/analytics_design.md`

## Asset handling

- **图标**：内联 SVG 组件，无图标库依赖
- **图片**：通过 Rust invoke 的工作区文件 IO 读取，前端不直接访问文件系统
- **主题资源**：CSS Token 通过 Theme System runtime 注入

## Styling architecture

- **TailwindCSS**：主样式方案，utility-first
- **CSS Token**：语义变量（`var(--xxx)`），禁止硬编码颜色/字号
- **字阶七档**：`text-xs/sm/base/lg/xl/2xl/3xl`（12/14/16/18/20/22/28px），**2xl=22、3xl=28 与 Tailwind 官方不同**
- **禁止裸 px**：`text-[13px]` 类任意 px 字号会触发 eslint 错误
- **主题桥接**：视觉值放 concrete Theme runtime Token；编译映射只放 `src/renderer/index.css` 的无值 `@theme inline` bridge
- **组件库**：`src/renderer/components/ui/`（Popover、DropdownMenu、MenuItem、Tip、Toast 等）

## Framework notes

### Tauri v2 同步命令阻塞
**Symptom:** 同步 `#[tauri::command] pub fn` 里做阻塞工作 → 整个 WebView 冻结
**Recovery:** 改 `pub async fn` + 阻塞段进 `tauri::async_runtime::spawn_blocking`

### Windows 路径前缀
**Symptom:** `\\?\` 长路径前缀让 `fileURLToPath` / spawn 报错
**Recovery:** 路径"出 Rust 边界"前用 `normalize_external_path(p)` 剥前缀

### React 稳定性 5 条规则
详见 `tech_docs/react_stability_rules.md`

## Environment

- **Node.js**：内置 v24（`runtime.ts::getBundledNodePath()`），不依赖系统安装
- **配置**：`~/.hamuna/config.json`，写盘走 `withConfigLock`
- **日志**：统一日志 `~/.hamuna/logs/unified-{date}.log`
- **开发模式**：`./start_dev.sh`（浏览器快速迭代）/ `npm run tauri:dev`（完整桌面）

## Mock-driven development

本项目不使用 API mock。数据来源是实时 SDK 消息流（SSE）和 Rust invoke。测试通过 Vitest 四池（unit/dom/integration/credentialed）覆盖。

## Naming & file layout

- **页面**：`src/renderer/pages/[Name].tsx`
- **组件**：`src/renderer/components/[feature]/ComponentName.tsx`
- **Hooks**：`src/renderer/hooks/use[Name].ts`
- **Context**：`src/renderer/context/[Name]Provider.tsx`
- **Server**：`src/server/` 按功能模块分目录
- **共享类型**：`src/shared/`
- **后缀约定**：测试文件 `*.unit.test.ts` / `*.dom.test.tsx` / `*.integration.test.ts`
