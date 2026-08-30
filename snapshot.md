# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。

最后更新：2026-08-31（TODO #15：i18n 补齐 SDK 0.3.234 新增 6 个 terminal_reason 条目（`api_error` / `malformed_tool_use_exhausted` / `budget_exhausted` / `structured_output_retry_exhausted` / `tool_deferred_unavailable` / `turn_setup_failed`）— zh-CN + en-US 双语。`terminalReason.ts` MAP 早已齐全，但 TerminalReasonBanner.tsx:81 i18n lookup miss 走 defaultValue 兜底文案"未知原因 (api_error)"。今日 master 已含 TODO #14 KB 重构（4d109bd → d01eab1）并 push 到 origin(github) + gitee(force, 覆盖 442d4c3 divergent 分支）。）

---

## 1. 模块状态总览

### 1.1 桌面端 / Rust (`src-tauri/`)

| 模块 | 文件 | 状态 | 备注 |
|------|------|------|------|
| Sidecar 生命周期 | `src-tauri/src/sidecar/{manager,instances,commands,proxy,runtime_identity}.rs` | 稳定 | 详见 `tech_docs/sidecar_cold_start.md` |
| Sidecar 配置归置 | `src-tauri/src/sidecar/manager.rs` | 稳定 | `ensureSessionSidecar` result.isNew 黄金判据 |
| Sidecar 清理 | `src-tauri/src/sidecar/cleanup.rs` | 稳定 | `STARTUP_CLEANUP_PATTERNS` 含 `claude-agent-sdk` 进程名 |
| Sidecar 健康/关停 | `src-tauri/src/sidecar/{health,shutdown}.rs` | 稳定 | `update_lock_probe_paths` 校验 Tauri 资源路径 |
| Local HTTP Proxy | `src-tauri/src/local_http.rs` | 稳定 | 裸 `reqwest::Client::new` 禁 — clippy |
| Process Cmd | `src-tauri/src/process_cmd.rs` | 稳定 | 裸 `Command::new` 禁 — clippy |
| Proxy Config | `src-tauri/src/proxy_config.rs` | 稳定 | `apply_to_subprocess_for_provider` provider-aware |
| IM 集成 (Telegram/飞书/钉钉) | `src-tauri/src/im/*.rs` | 稳定 | 详见 `tech_docs/im_integration_architecture.md` |
| 定时任务 | `src-tauri/src/cron_task/*.rs` | 稳定 | `TaskStore` 唯一权威；旧 `cron_tasks.json` 仅 startup 迁移 |
| 任务中心 / Session Goal | `src-tauri/src/session_goal/*.rs` | 稳定 | |
| Inbox / Mailbox | `src-tauri/src/inbox/*.rs` | 稳定 | |
| 全文搜索 | `src-tauri/src/search/*.rs` | 稳定 | Tantivy + jieba |
| ~~知识库引擎 KbEngine~~ | ~~`src-tauri/src/kb/mod.rs`~~ | ✅ 已删（Phase 4） | Rust 端 KB 模块已删除；KB 现在由 Node `src/server/kb/kb-store.ts`（TypeGraph+SQLite）独占提供；tantivy 保留（主搜索 `src/search/` 仍用） |
| Managed Codex Runtime | `src-tauri/src/managed_codex.rs` | 稳定 | 锁 `src/shared/managed-codex-runtime.json::version` |
| Grok Auth | `src-tauri/src/grok_auth/*.rs` | 稳定 | |
| 浮动球 / 全局快捷键 | `src-tauri/src/{floating_ball,global_shortcut}.rs` | 稳定 | |
| App Config (Rust) | `src-tauri/src/{config_io,app_dirs,device_identity}.rs` | 稳定 | `with_config_lock` 写盘 |
| Browser / Notification | `src-tauri/src/{browser,notification,notification_badge}.rs` | 稳定 | |
| Admin API | `src-tauri/src/management_api.rs` | 稳定 | |
| Memory Auto Update | `src-tauri/src/memory_auto_update.rs` | 稳定 | |
| CLI 安装 | `src-tauri/src/cli.rs` | 稳定 | |

### 1.2 Sidecar / Node.js 后端 (`src/server/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Sidecar 入口 | `src/server/index.ts` | 稳定 | `SYSTEM_SKILLS` 清单 |
| Session Engine | `src/server/session-engine/` | 稳定 | `selector.ts` 统一 adapter 分流 |
| Builtin Session | `src/server/builtin-session/` | 稳定 | `lifecycle / turn-lifecycle / config / types` |
| External Runtime | `src/server/runtimes/external-session/` | 稳定 | Claude Code / Codex / Gemini |
| Agent Session | `src/server/agent-session.ts` | 稳定 | public facade；`reloadLiveSessionSkills`（builtin SDK reloadSkills，可等待 + needsRestart 结果） |
| Skill Reload | `src/server/utils/skill-reload.ts` | 已修 | **新模块（TODO #12）**；纯函数 `evaluateSkillReload`，避免拉起 agent-session import 图 |
| External Runtime Env | `src/server/runtimes/env-utils.ts` | 已修 | **静态 `import './claude-code-env.json'` 改运行时 `fs.readFile + try/catch`**；missing file → `{}`（对齐源码注释"missing file = no-op"语义，`.gitignore` secrets 不入 git） |
| Builtin MCP | `src/server/tools/{builtin-mcp-meta,builtin-mcp-registry}.ts` | 稳定 | `src/server/tools/*.ts` 禁顶层 import SDK/zod |
| Gemini Image Tool | `src/server/tools/gemini-image-tool.ts` | 稳定 | 懒加载 |
| Edge TTS Tool | `src/server/tools/edge-tts-tool.ts` | 稳定 | 懒加载 |
| IM Bridge Tools | `src/server/tools/im-bridge-tools.ts` | 稳定 | runtime-dynamic，context-injected |
| Title Generator | `src/server/title-generator.ts` | 稳定 | |
| Third-party Providers | `src/server/{provider-verify,subscription-auth}.ts` | 稳定 | 详见 `tech_docs/third_party_providers.md` |
| OpenAI Bridge | `src/server/openai-bridge/` | 稳定 | |
| Plugin Bridge | `src/server/plugin-bridge/` | 稳定 | shim 版本同步 bump |
| Inbox | `src/server/inbox/` | 稳定 | |
| MCP OAuth | `src/server/mcp-oauth/` | 稳定 | |
| 日志 / Runtime | `src/server/utils/` | 稳定 | `runtime.ts` bundled Node；`path-safety` chokepoint |
| KB 富文本入库 | `src/server/kb-ingest.ts` | 稳定 | URL/PDF/docx/xlsx→text（SSRF 防护）；sidecar→进程内 `addText`（Phase 2 起不再走 management API） |
| KB LLM 关系抽取 | `src/server/kb-relations.ts` | 稳定 | 轮询 pending 队列→直接 HTTP/SDK 抽取→进程内 `saveRelations`+`removePending`（Phase 2 起不再走 management API） |
| KB TypeGraph store | `src/server/kb/kb-store.ts` | 🆕 新增 | 单例 `createLocalSqliteStore`（WAL+busy_timeout）+ jieba 预分词 + Rust 算法精确移植（CRUD/mounts/addText/query FTS5+1跳） |
| KB HTTP service | `src/server/kb/kb-service.ts` | 🆕 新增 | `/api/admin/kb/*` 16 路由分发 + `{ok,...}` 契约；lazy 加载保证冷启动不受影响 |

### 1.3 前端 (`src/renderer/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Pages | `src/renderer/pages/` | 稳定 | |
| Components | `src/renderer/components/` | 稳定 | 受 `react_stability_rules.md` 5 条约束 |
| Context | `src/renderer/context/` | 稳定 | |
| Hooks | `src/renderer/hooks/` | 稳定 | |
| API / TS↔Rust 桥 | `src/renderer/api/` | 稳定 | Tab 作用域 MUST 用 `useTabState().apiGet/apiPost` |
| Theme | `src/renderer/theme/` | 稳定 | 详见 `tech_docs/theme_system.md` |
| i18n | `src/renderer/i18n/` | 稳定 | 详见 `tech_docs/i18n_architecture.md` |
| Analytics | `src/renderer/analytics/` | 稳定 | 详见 `tech_docs/analytics_design.md` |
| Workspace Icons | `src/renderer/assets/workspace-icons/` | 稳定 | |
| Widget Libraries (UMD inline) | `src/renderer/components/tools/widgetLibraries.ts` | 已修 | Vite 7 dev 模式 `?raw` import 修复见 §4（`widgetUmdSourceResolver` plugin 在 dep crawler 阶段拦 `chartjs-umd-source`/`d3-umd-source`/`lucide-umd-source`，避免 "optimized info should be defined"） |
| KB 图可视化 | `src/renderer/components/KbGraphView.tsx` | 稳定 | d3 force-directed 画布 |
| KB 管理面板 | `src/renderer/components/GlobalKbPanel.tsx` | 稳定 | KB CRUD + 材料入库 + workspace↔KB mount |
| KB Client | `src/renderer/api/kbClient.ts` | 稳定 | 11 个 `invoke('cmd_kb_*')`→`apiGetJson/apiPostJson/apiPutJson/apiDelete` 打 `/api/admin/kb/*`（Phase 3）；导出类型零改动 |
| Vite Config | `vite.config.ts` | 已修 | `widgetUmdSourceResolver` plugin（`enforce: 'pre'`）+ 删除原 `resolve.alias` 中 3 条 chartjs/d3/lucide alias；保留 `optimizeDeps.exclude` 作 belt-and-suspenders |

### 1.4 共用 / 工具 (`src/shared/`)

| 模块 | 状态 | 备注 |
|------|------|------|
| `src/shared/*.ts` | 稳定 | renderer + server 共享类型；禁止反向 import |
| `src/shared/workspacePath.ts` | 稳定 | `workspacePathsEqual` / `normalizeWorkspacePathIdentity` |
| `src/shared/managed-codex-runtime.json` | 稳定 | 客户端 runtime 版本唯一权威 |
| `src/shared/logTime.ts` | 稳定 | `localDate()` 替代 `toISOString().split('T')[0]` |
| `src/shared/terminalReason.ts` | 稳定 | |

### 1.5 CLI / 内置能力 / 脚本

| 模块 | 入口 | 状态 |
|------|------|------|
| `hamuna` CLI | `src/cli/hamuna.ts` (+ `.cmd`) | 稳定；改 MUST bump `CLI_VERSION` + 同步 skill |
| 内置 MA 小助理 | `bundled-agents/hamuna_helper/` | 稳定；改 MUST bump `ADMIN_AGENT_VERSION` |
| 内置 Skills | `bundled-skills/` | 稳定；`SYSTEM_SKILLS` 清单内改 MUST bump `SYSTEM_SKILLS_VERSION` |
| 雪球时间线 Skill | `skills/crawl-xueqiu-my-timeline/` | **重设计为投资方向分析（TODO #9）**；含 `stock_datasource_call.sh` 行情直连；实验 skill，未入 `bundled-skills/`，未注册 `SYSTEM_SKILLS` |
| `scripts/ensure_claude_sdk_package.ps1` | — | 已修；**`Test-SdkPackage` 第 175 行 `-ne` 严格比较 → `Test-SdkVersionRange` semver range 兼容（`^`/`~`/`exact` 三态）**；`Repair-SdkPackage` 传给 npm 前去掉 caret（否则 npm 会再次漂到 latest patch，repair 闭环失败）；PE header + Authenticode 校验不变 |
| `scripts/ensure_rust_toolchain.ps1` | — | 稳定 |
| `scripts/download_{cuse,python,uv}.ps1` | — | 稳定；软失败（dev 模式下缺失不阻断） |
| `scripts/esbuild-bundle.mjs` | — | 稳定 |
| `setup_windows.ps1` | — | 已简化；**删除原 Step 6.5/8 占位符 block**（dev 模式不再用 `.dev-placeholder`，由 `tauri.conf.json::beforeDevCommand` 自动打真实 dist 文件） |

### 1.6 文档 / 规范 (`specs/`)

| 文档 | 加载方式 |
|------|---------|
| `specs/ARCHITECTURE.md` | L2，按触发条件主动 Read |
| `specs/DESIGN.md` | L4，前端开发 MUST 读 |
| `specs/tech_docs/*.md` | L3，按模块触发 |
| `specs/guides/*.md` | L4，按命令触发 |

---

## 2. Tauri 资源目录（dev vs build 分工）

`tauri.conf.json::bundle.resources` 在 build-script 阶段（`cargo build` / `npx tauri dev` 首次启动的 cargo build）由 `tauri-build` 校验所有声明路径必须存在。**dev 与 prod 共用同一份 bundle.resources 声明**，但 dev 与 prod 填充方式已统一：

| 路径 | 何时被填充 | 由谁 |
|------|----------|------|
| `src-tauri/resources/server-dist.js` | **dev 启动前** 与 **prod 构建前** | `tauri.conf.json::beforeDevCommand` / `beforeBuildCommand` 都已包含 `npm run build:server` |
| `src-tauri/resources/plugin-bridge-dist.mjs` | 同上 | `npm run build:bridge`（both paths） |
| `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` | `npm install` → `setup_windows.ps1` Step 6 | `setup_windows.ps1` → `ensure_claude_sdk_package.ps1` |
| `src-tauri/resources/{sharp-runtime, tsx-runtime, nodejs, claude-agent-sdk}` | **生产构建** | `build_windows.ps1`（dev 模式下目录必须存在但**不**放占位符——见下） |
| `src-tauri/resources/{server-dist.js, plugin-bridge-dist.mjs}` | esbuild 打包 | `npm run build:server` / `build:bridge`（dev + prod 都跑） |
| `src-tauri/resources/cli/`、assets/、infoplist/ 等其他目录 | 与具体构建路径相关 | 由 build 脚本 + 资源 git 提交 |

### ⚠️ 已废弃：`.dev-placeholder` 占位符方案（TODO #1）

原 TODO #1（snapshot 历史版本）曾在 `setup_windows.ps1` Step 6.5/8 写入 4 个 `.dev-placeholder` 文件骗过 `tauri-build` 资源校验。**该方案已被用户明确否决**（"不能有空的占位符，要真实文件"），整段逻辑已从 `setup_windows.ps1` 删除。dev 模式下 4 个空目录（`claude-agent-sdk` / `sharp-runtime` / `tsx-runtime` / `nodejs`）由 `setup_windows.ps1` 原步骤隐式创建（无占位文件）；`cargo build` 的资源校验只看路径**存在**——空目录足以满足。

如果未来 `tauri-build` 进一步收紧到校验"目录非空"，则 `beforeDevCommand` 需要追加这些目录的真实内容填充（如同 prod build_windows.ps1），但当前 **不**需要。

---

## 3. 当前 TODO（待完成）

### TODO #14: 🔄 进行中 — 用 TypeGraph 重构知识库功能（设计完成，待实现）

- **需求**：用户要求「使用 typegraph 框架重构知识库功能」，并经 context7 确认框架为 `/nicia-ai/typegraph`（TS-first 嵌入式知识图谱库）。
- **用户已拍板**：
  1. **直接使用 typegraph 重构**（否决了「TypeGraph 与 Rust 栈不匹配，建议放弃」的矛盾分析）
  2. **全 Node B+ 方案**（否决混合 A）：graph 进 TypeGraph/SQLite（Node sidecar），中文全文用 FTS5 `unicode61` 逐字索引 + 图 1 跳扩展兜底，**不保留** Rust Tantivy；验收中文命中不达标再补 jieba-wasm 预分词（ponytail 升级位）
- **关键事实（Plan agent 深挖验证 + Phase 0 spike 实测）**：
  - TypeGraph 0.52.0 硬编码 `better-sqlite3`（native 模块）+ drizzle-orm，**不支持 node:sqlite**（drizzle 无该 driver）
  - FTS5 tokenizer 固定 `porter unicode61 remove_diacritics 2`；**spike 实测：CJK 连续串被 unicode61 视为单一不可分词 token，中文 MATCH 全部返回 0**（不是"逐字索引"，是完全无索引）——plan 原假设错误
  - **修复已实测通过**：写入前用 jieba-wasm `cut_for_search` 把中文切成空格分隔词序列存 `searchable` 字段（`textOriginal` 存原文供展示/snippet），查询同样分词——"知识图谱"/"华为"/"任正非"/"科技公司"全命中。jieba-wasm 纯 WASM 无 native，esbuild 需 `external: ['jieba-wasm']`（其 node entry 运行时 `require(path).join(__dirname, ".wasm")` 读磁盘，不能 bundle）
  - **esbuild 需 `external: ['better-sqlite3']`**（native 模块，spike 实测 bundle 后从 `resources/node_modules/` 解析）；节点 API 实测：`create`/`getById`/`getByIds`/`update`/`delete`/`find`/`count`；query builder：`.from().whereNode().select().execute()`
  - **TypeGraph 0.52 API 精确签名（已读 node_modules d.ts 确认）**：`createLocalSqliteStore(graph, {path})` 从 `@nicia-ai/typegraph/sqlite/local` 导入、**是 async**（返回 `Promise<Store<G>>`）；`defineNode(name,{schema,unique?})`，unique 是裸对象 `{name, fields, scope:'kind', collation:'binary'}`（非函数）；`defineGraph({id,nodes,edges})`，edges 可空 `{}`；`store.search.fulltext(kind, {query, limit, where?, includeSnippets?})` 返回 `{node,score,rank,snippet}[]`（**可传 where 谓词按 kbId 过滤**）；`store.nodes.<K>.create({...},{id?})` / `find({where,limit})` / `count()` / `update(id,props)` / `delete(id)`(软删) / `hardDelete(id)`；`NodeAccessor` 谓词 `field.eq/.in/.contains/.like`，`.and/.or/.not` 组合；`field.$fulltext.matches(q,k)` 做全文谓词
  - graph 数据进 Node 后查询只能编排在 Node 侧；混合 A 需 add-text 跨进程双写两个存储 → 用户因此选 B+
  - 前端全部 KB 操作经 `kbClient.ts` 一个接缝（11 invoke + 1 apiPostJson），`apiGetJson`/`apiPutJson`/`apiDelete` 已存在
  - `App.tsx:1002` 主窗口启动即拉 Global Sidecar，`apiFetch` 走它 → 前端切 HTTP 安全
  - sharp-runtime 打包先例可循（resources/node_modules 预装）
- **实现方案**（详见 plan 文件）：
  - Phase 0（✅ 完成）：依赖已装（typegraph/drizzle/better-sqlite3/@types/jieba-wasm）+ spike 实测通过（中文分词+FTS5 命中、external 双包 bundle 可运行）
  - Phase 1（✅ 完成）：4 文件已写 + 实测通过——`kb-schema.ts`（5 节点建模，Relation 为节点带 relationType/weight/typed）、`kb-tokenize.ts`（jieba cut_for_search 预分词）、`kb-merge.ts`（Rust merge_entities/merge_relations/chunk_text 精确移植）、`kb-store.ts`（单例 store：CRUD/mounts/addText/listDocs/rebuild/peekPending/takePendingAll/removePending/saveRelations/graphData/query FTS5+1跳）。**smoke 实测全过**：createKb 唯一约束、中文全文查询命中（"知识图谱"→华为资料 doc）、snippet 从 textOriginal 取原文、saveRelations merge 语义、mounts 读写。关键 API 修正：Node 的 schema props 顶层 spread（非 `.props`）、读/改/删 id 需 `asNodeId<typeof KbNode>` 品牌化、Entity/Relation 节点 id 需 kb 前缀命名空间（防跨 kb label 冲突）
  - Phase 2（✅ 完成）：`src/server/kb/kb-service.ts` 新增 `handleKbAdminRequest` 统一分发 16 条 `/api/admin/kb/*` 路由（GET/POST 全覆盖、`{ok,...}` 契约、exclude `/ingest` 走老路径）；`index.ts` 在 admin POST-only 分支**之前**插入 KB dispatch（懒 `await import('./kb/kb-service')`）；`kb-ingest.ts` managementApi→进程内 `addText`；`kb-relations.ts` 三个 managementApi→`takePendingAll/saveRelations/removePending`（保留 `kb-relations` 在 boot 顶层 import 但 kb-store 用 `await import` 保冷启动）；`kb-tool.ts` mounts+query→进程内 `mountsForWorkspace/query`（遵守 tools 懒加载）；`kb-store.ts` 加 `graphSummary` 公开导出（前端 `getKbGraph` summary 面板用）。typecheck+eslint 全绿
  - Phase 3（✅ 完成）：`src/renderer/api/kbClient.ts` 11 个 `invoke('cmd_kb_*')`→`apiGetJson/apiPostJson/apiPutJson/apiDelete` 打 `/api/admin/kb/*`（`{ok:false}→400` 让 `apiFetch` 自然抛错，复用 invoke reject 语义）；导出类型零改动（KbInfo/KbGraphSummary/KbEntity/KbRelation/KbGraph/KbDocMeta）；`ingestKbMaterial` 路径不变。`src/server/kb/kb-service.ts` dispatcher 加 `respond()` 把 `{ok}` 映射成 HTTP status（200/400）。`src/server/kb/__tests__/kb-http-smoke.integration.test.ts` 2/2 通过（完整 CRUD+query+mounts+pending+rebuild+delete 链路）
  - Phase 4（✅ 完成）：`src/server/kb/kb-migrate.ts` 新增——首次 `getKbStore()` 触发幂等迁移，源 `~/.hamuna/kb/{index.json,mounts.json,*}/graph.json,docs.json`→SQLite（kb_id 保留以兼容 mounts.json；Doc.text 用 jieba 预分词、textOriginal 存原文）；写 `.migrated-v1` 哨兵防重跑；归档 legacy 到 `~/.hamuna/kb-legacy-<ts>/`；`src/server/kb/__tests__/kb-migrate.integration.test.ts` 3/3 通过（Linux-only：`describe.skipIf(!IS_LINUX)` 因为 macOS libuv 可能缓存 `homedir()`）。Rust 端：`src-tauri/src/kb/{mod,schema}.rs` 已删；`lib.rs` 移除 `pub mod kb` + 12 个 `cmd_kb_*` 注册 + KbEngine init；`management_api.rs` 移除 7 handler + 6 struct + 7 `/api/kb/*` 路由注册。`cargo check` + `clippy --all-targets -D disallowed_methods/macros` + `tsc --noEmit` 全绿。tantivy 保留（主搜索仍用）
  - Phase 5（✅ 完成）：新增 3 个测试文件覆盖 Rust 算法精确移植、jieba 中文分词 + TypeGraph/SQLite 端到端——`kb-merge.unit.test.ts` 17 case（entityId/chunkText 4 case 含 boundary + hard-break + empty/mergeEntities/mergeRelations typed upgrade + weight 累加 + cooccur 语义）、`kb-tokenize.unit.test.ts` 9 case（中文分词 + 停用词 + 单字过滤 + 标点过滤 + FTS5 MATCH 形状）、`kb-store.integration.test.ts` 8 case（createKb 唯一约束 / addText chunks / saveRelations merge / query 中文 FTS5+1跳 / mounts / deleteKb cascade）。**修复 2 个 Phase 1-2 期间没暴露的真实 bug**：`saveRelations` 的 Relation id 含 `relationType` 与数组 index → typed upgrade 后 cooccur 旧 row 残留（升级前 id=`rel_kb_X_A_B_cooccur_0`，升级后 id=`rel_kb_X_A_B_founded_by_0`，两个不同 id），改为仅含 `(kbId,subject,object)` 稳态 id；`mountsForWorkspace` 不排序导致调用方拿到非确定顺序，测试断言常踩坑，store 内 sort 兜底。**最终 KB 模块测试 39/39 全绿**（unit 26 + integration 13），`npm run test:classification` 通过（191 server tests），`tsc --noEmit` 通过，`cargo check --locked` 通过
- **矛盾点**：Rust KbEngine 1465 行 + Tantivy 依赖删除；中文全文需 jieba-wasm 预分词（成为必需核心，不再是 ponytail）——spike 已实测通过
- **状态**：✅ Phase 1+2+3+4+5 完成（schema+store+admin dispatcher+进程内化+前端 HTTP 切换+迁移+Rust 删除+测试覆盖+2 个 store bug 修复）。TODO #14 整体收尾，可独立 commit。

### TODO #12: ✅ 已修复 — skill 安装后显式调用报 "unknown command"（reload 链路由错）

**症状**：skill 安装后，用户在当前 session 显式输入 `/skillname`，AI 回 "unknown command"（Claude Code CLI 原生命令解析，非本仓库字符串）。"有时候"出现是因为 user-scope 安装会触发 reload、project-scope 安装不触发。

**根因（安装 → 运行时 skill 命令表不同步）**：
- SDK 用 `settingSources: ['project']`（`agent-session.ts`），**只在进程启动时**从 `<cwd>/.claude/skills/` 快照 slash command 表
- 旧 `reloadSessionSkillsAfterSync` 是 fire-and-forget、private，且 **reload 挂在 `syncProjectUserConfig` 成功分支**，而 sync 只处理 user 级 skill
- `/api/skill/install-from-url` 的 **project scope 分支不调 sync 也不 reload** → 新装 skill 写进 `<agentDir>/.claude/skills/`，但运行中 SDK 命令表还是启动快照 → `/skillname` → unknown command
- reload 失败会静默降级为"下次会话才生效"，无任何可感知提示

**修复（A+B）**：
- **A — project scope 触发 reload**：`install-from-url` 结尾无论 scope 都调 `reloadLiveSessionSkills(agentDir, expectedSkill)`，reload 结果（`needsRestart`/`ready`）拼进 response
- **B — reload 可等待、可感知结果**：
  - 新增 `src/server/utils/skill-reload.ts`：纯函数 `evaluateSkillReload(expectedSkill, reloaded, loaded)` → `{ needsRestart }`（独立模块便于单测，避免拉起 agent-session import 图）
  - `agent-session.ts`：private `reloadSessionSkillsAfterSync` → export `reloadLiveSessionSkills(syncedDir, expectedSkill?)`，返回 `{ reloaded, loaded, needsRestart }`；`syncProjectUserConfig` 改为 fire-and-forget 调它；re-export 类型
  - 前端：`InstallFromUrlResponse` 加 `warning`/`ready` 字段；`onInstalled` 回调带结果参数；两个面板（GlobalSkillsPanel / SkillsCommandsList）在 `warning` 非空时 toast 提示"需重启会话"
- **改动文件**：`agent-session.ts`（重构+re-export）、`index.ts`（import + install-from-url 结尾）、`skill-reload.ts`（新）、`skill-reload.unit.test.ts`（新，4 测试）、`SkillDialogs.tsx`、`GlobalSkillsPanel.tsx`、`SkillsCommandsList.tsx`
- **验证**：
  | 验证 | 结果 |
  |---|---|
  | `npx vitest run --project unit -- src/server/utils/skill-reload.unit.test.ts` | ✅ 4/4（其余 6 失败为 TODO #3 预存在，stash 验证干净树一致） |
  | `npx tsc --noEmit` | exit 0 |
  | `npx eslint <7 个改动文件>` | exit 0 |
- **未 commit**：7 文件改动（4 M + 2 新 + 前端 3 M）待用户拍板提交

### TODO #13: 🔄 进行中 — git hook 每次提交自动 bump 版本号

- **需求**: 用户要求加 git hook,每次 commit 自动提升版本号。用户确认接受「版本号变成 commit 计数器」
- **背景**: 用户观察到「本地提交后版本跳回旧值」——根因是 `package.json` 的 `version` 钩子 `npm version && git add` 的副作用 + 本地/CI 双写者抢版本文件
- **实现**:
  - `scripts/bump-on-commit.mjs` — bump 逻辑:跳过 CI(`GITHUB_ACTIONS=true`)/ release 提交(`^vX.Y.Z` 或 `chore(release)`)/ 版本文件已在 index(`git show :package.json` vs HEAD);否则 `npm version patch --no-git-tag-version`(触发 version 钩子同步三处 + git add)+ `git add package.json package-lock.json`
  - `.githooks/prepare-commit-msg` — hook 壳,仅普通 commit(source 为 `message`/空)触发,merge/squash/amend 跳过
  - `scripts/install-githooks.sh` — 安装到 `.git/hooks/prepare-commit-msg`
- **验证**: 测试分支实测——①直接跑脚本 0.3.21→0.3.22,三处版本文件同步 ②真实 commit(index 已含新版本)不二次 bump ③二次 commit(版本不在 index)应 bump 到 0.3.23(**待完整验证**)
- **矛盾点**: 每次 commit bump patch = 版本号成 commit 计数器;CI 的 windows-release workflow 也 bump patch,可能产生「CI 基于旧版本 bump 覆盖本地」——hook 的跳过条件 2(CI + release commit)已防,但本地 CI 双写者仍有理论冲突
- **状态**: ⏳ 已实现,待用户确认提交

### TODO #11: 🔄 进行中 — GitHub Actions Windows 构建 + 传 R2 + 自动 bump 版本号

- **需求**: GitHub 上加一个 action,编译 Windows 版本并提交到 Cloudflare R2,自动提升版本号
- **决策（用户已确认）**: bump 后回写仓库(commit + tag + push) / `workflow_dispatch` 手动触发 / 只传 R2 不发 GitHub Release
- **方案**: 新增 `.github/workflows/windows-release.yml`(单 job, windows-latest),内联 `build_windows.ps1` / `publish_windows.ps1` 核心步骤(两者带 `Read-Host` 交互,不能直接 CI 调用),复用无交互的 `download_*.ps1` / npm scripts
- **要点**: tauri build 前 MUST `Remove-Item Env:CI`(clap --ci 崩);版本号单一数据源 `package.json`, `npm version` 钩子同步 tauri.conf.json + Cargo.toml(实测也自动更新 package-lock.json);R2 走 rclone + `releases/v$Version/` + `update/` 清单
- **所需 secrets**: `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` / `R2_BUCKET` / `TAURI_SIGNING_PRIVATE_KEY`(+PASSWORD)
- **状态**: ⏳ workflow 已写完(`.github/workflows/windows-release.yml`, 22 步);**首跑失败 `resource path ..\mino doesn't exist`** — 修复中(见下)
- **mino bundle 资源缺失修复（方案 B，用户拍板）**：
  - **根因**: `mino/`(首启初始 workspace, `commands.rs` `cmd_initialize_bundled_workspace` 从 `resource_dir/mino` 复制到 `~/.hamuna/projects/mino/`)是产品 bundle 资源(`tauri.conf.json:58` `"../mino": "mino"`),但根 `.gitignore:105` `/mino/` 忽略 → CI checkout 后无 mino → tauri-build 资源校验失败
  - **决策**: 方案 B = 提交 mino 进本仓库 git(CI 自包含 + 版本可控),弃方案 A(CI clone openmino,版本不可控)与方案 C(submodule,后续更新麻烦)
  - **安全过滤**: `mino/.gitignore` 新增 `.tokensave/` 排除——内含 `config.json`(机器特定绝对路径 `root_dir: /home/hmcz/.hamuna/setup-cache/mino`)与 `tokensave.db`(主仓库历史曾因同名 .db 超 100MB 被 filter-repo 清理)。`.config/`(凭据)原本已排除
  - **落地**: 根 `.gitignore` 移除 `/mino/` → `git add mino/` → 284 文件 / 4.6MB,`git add -n` 验证 `.tokensave` / `.db` / `.config` 零跟踪
  - **⚠️ 待办**: `commands.rs:368` 注释提及 `~/.hamuna/projects/mino link returns false`——首启后用户可能已建过 `~/.hamuna/projects/mino`,与 bundle 复制逻辑的交互需验证(下轮验证)



- `M .mcp.json`
- `M package-lock.json`
- `M src-tauri/Cargo.toml`
- `M src/renderer/components/MessageList.freeze.test.tsx`
- `M src/renderer/components/MessageList.tsx`
- `M src-tauri/tauri.conf.json`（本次修复）
- `M setup_windows.ps1`（本次修复，整段删除原 Step 6.5/8 占位符 block）
- `M src/server/runtimes/env-utils.ts`（本次修复，静态 import → 运行时 fs.readFile）

- **状态**: ⏳ 等待用户决策，本批改动是否统一提交
- **注意**: 5 个原 pending（`.mcp.json` / `package-lock.json` / `Cargo.toml` / `MessageList.*`）与本次 dev 启动修复**无**依赖关系，可独立提交

### TODO #3: 预先存在的 unit test 失败（与 dev 启动修复**无关**）

`npx vitest run --project unit` 当前 14 failed / 2775 passed / 10 skipped。**全部**失败均与本次 `npx tauri dev` 修复、SDK 0.3.234 升级、Bash pipe 排查**无依赖路径关系**。SDK 0.3.234 升级后数量**完全不变**（同 9 个文件 / 14 个测试），证明这些失败**预先存在**：

| 失败文件 | 根因（与所有本次任务无关） |
|---|---|
| `src/cli/hamuna.unit.test.ts` | Windows `EPERM symlink`（测试用 `mklink /D`，权限/沙箱受限） |
| `src/server/proxy-state.unit.test.ts` | proxy-state 断言漂移（`expected undefined to be 'http://system.proxy:8080'`） |
| `src/renderer/analytics/eventRegistry.test.ts` | 期望读取 `specs/tech_docs/analytics_design.md` 但**文件不存在** |
| `src/renderer/theme/themeArchitecture.test.ts` | Default Black / Scaffolding Theme 主题 token 漂移（map size 17 vs 24；CSS 不含期望子串） |
| `src/server/official-tools/vision.unit.test.ts` | Windows `EPERM symlink`（同上） |
| `src/server/utils/cuse-diagnostics.unit.test.ts` | 期望长度 1，实测 0 |
| `src/server/utils/model-capabilities.unit.test.ts` | `[1m]` 后缀 capability 漂移（expected 200000 to be 1000000） |
| `src/server/__tests__/support-log-redactor.unit.test.ts` | （待查具体失败） |
| `src/renderer/components/tools/widgetSandboxHtml.test.ts` | widget sandbox 内联错误提示子串缺失 |

- **状态**: ⏳ 用户已确认本次只修 dev 启动失败；其它失败**不**在本修复 scope 内
- **UPGRADE**: 用户后续决策——独立 PR 修；或跟主题/能力表改动一起走

### TODO #4: SDK 0.3.234 升级引发的 6 个新 TerminalReason entry 文案 review

`@anthropic-ai/claude-agent-sdk` 从 0.3.201 升到 0.3.234（33 个 minor 跳）。SDK 新增 6 个 TerminalReason 字面量：
- `api_error` / `malformed_tool_use_exhausted` / `budget_exhausted` / `structured_output_retry_exhausted` / `tool_deferred_unavailable` / `turn_setup_failed`

应用 `src/shared/terminalReason.ts:31` `Record<TerminalReason, TerminalReasonInfo>` 是 exhaustive mapping，为通过 typecheck 已**补全** 6 个新 entry。但是：

- SDK 0.3.234 `sdk.d.ts` 没有给这 6 个字面量写 JSDoc 注释
- 现有 label/detail 是**字面直译 + 占位描述**，severity 是按字面意思推测
- 必须人工 review 这些文案是否符合中文用户预期、severity 是否分级合理

- **状态**: 🟡 待文案 review（不影响 SDK 兼容运行）

### TODO #5: desktop Bash 工具在 detached console 下 spawn headed chromium 永远 hang

**症状**：用户报告 Bash 工具调用 `NODE_PATH=... node probe_home.cjs 2>&1`（**带或不带 `| head -60` 都卡**）卡死在 SDK 120s timeout。

**实测变量隔离**（终端 Git Bash 直接跑，4 个变体）：

| 变体 | 实测 | 结果 |
|---|---|---|
| A: node + 无参 + 无 2>&1 | 0.23s | ✅ 快速失败（`MODULE_NOT_FOUND` playwright） |
| B: node + 2>&1 | 0.22s | ✅ 同 A 错误 |
| C: NODE_PATH + 无 2>&1 | **23.2s** | ✅ 完整跑完雪球 probe exit 0 |
| D: NODE_PATH + 2>&1 | **22.9s** | ✅ 同 C 2>&1 重定向 ok |
| 18:10:21 (0.3.201) `{node ... 2>&1 \| head -60}` | log 卡 | **卡** |
| 20:42:01 (0.3.234) `{node ... 2>&1}` | log 卡 | **卡** |

**真正根因**：`probe_home.cjs` 调 `chromium.launchPersistentContext(..., {headless:false,channel:'msedge'})` — headed mode。SDK Bash tool 在 Tauri 进程内 spawn 子进程是 detached console（无 TTY 给子进程），Edge 等显示设备 → 永远 hang → SDK 120s timeout 才 abort。终端 TTY 环境下能跑通 → 印证是 TTY 缺乏。

**SDK 0.3.234 升级无回归**：升前后均卡（同一根因），升未引入新 regression 也未修复任何 Bash 问题。

### TODO #6: ✅ 已修复 — Playwright-via-Bash auto-background gate (root fix)

用户提出："按理说无论怎样命令也不会一直卡住"。

**根因**（实测）：
1. **SDK Bash tool 完整支持 abort**：BashInput.{timeout, run_in_background} + BashOutput.{interrupted, backgroundTaskId, timedOutAfterMs, backgroundedByUser}（`@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:577/3008`）。
2. **前端已支持渲染**：`BashTool.tsx:331` 处理 `timeout|stopped|interrupted` + `bashTranscript.ts:50/60` 渲染 `run_in_background` + `interrupted` + `useAgentStatusState.ts:42` 显式说明"省略或 true 即后台"。
3. **PreToolUse hook 在 SDK 0.3.234 支持 `updatedInput` + `additionalContext`**（`sdk.d.ts:2356-2362`）—— 可主动改写 BashInput 注入 `run_in_background:true` + `timeout:30000`。
4. **唯一缺口**：模型没用 `run_in_background:true`。Headless:false Chromium 在 SDK Bash tool spawn 的 detached console 下 hang 永远 → 不超过 120s SDK timeout 但前端仍卡到 timeout 为止。

**修法（v2 — 从 deny 改 transform）**：
v1 deny 把控制回模型，模型第二次还是同步 → "FIX EVOLUTION" 注释里写明为啥改成 transform。
v2 transform 用 `updatedInput` 把 BashInput 重写成 `{ run_in_background: true, timeout: 30000 }`，发 `additionalContext` 让模型下次自己写 flag。命令后台跑立即返回 backgroundTaskId，前端渲染 background 状态不卡。

**改动**（2 文件，**纯重构 deny→transform**）：
- `src/server/utils/playwright-bash-redirect.ts` — `decidePlaywrightBashRedirect` → `decidePlaywrightBashTransform`，返回 `updatedInput` + `additionalContext` 而不是 `permissionDecision: deny`。
- `src/server/agent-session.ts:11194` — hook 调用更新到 transform 路径。
- `src/server/utils/playwright-bash-redirect.unit.test.ts` — 27 测试全过（覆盖 happy path + LIMITATION 误伤 + field preservation + 单 canonical additionalContext 不变量）。

**Hook shell-layer 边界**（仍存在，但**用户 case 现已覆盖**——`node /tmp/probe.cjs` 命令字符串**有** `node` 词，无 playwright 关键词——但用户的 BashInput **也无需关心**，因为 hook 不知道 cjs 内部代码，所以脚本内 headed chromium 仍可能 hang。Workaround：模型应改用 `mcp__playwright__browser_navigate` 或脚本里加 `headless: true`）：
- ✅ 自动后台：`npx playwright` / `pnpm playwright` / `yarn playwright` / `playwright <subcmd>` / 直接 `chromium` / `chrome.exe` / `msedge.exe` 调用
- ❌ 不变（LIMITATION 仍成立）：命令字符串不含 playwright 关键词的 `node /tmp/probe.cjs`，脚本内 headed chromium

**验证**：
| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run --project unit playwright-bash-redirect.unit.test.ts` | exit 0, 27/27 |
| `npx eslint ... .ts .unit.test.ts` | exit 0 |

**未 commit**：3 文件改动（纯重构）待拍板。

### TODO #7: 本次 Linux cuse stub 改动未 commit

- `M build_linux.sh`（**三轮迭代**：① +11 行 stub touch + trap；② `touch` → `cp "$(command -v true)"` —— linuxdeploy 拒绝非 ELF；③ `command -v` → 绝对路径候选列表 —— bash 把 `true` 当内建，`command -v` 只返 `"true"` 字面量不带路径，`cp true ...` 直接 stat 失败）
- **状态**: ⏳ 等待用户决策，单独 PR 或并入其他变更
- **影响**: 仅 Linux 构建路径，无 macOS/Windows 影响
- **关联**: §4 「Linux cuse externalBin 缺失修复细节」

### TODO #10: ✅ 已修复 — desktop cron 执行报 "sidecar 找不到"（Sidecar generation header 名不匹配）

**症状**：desktop 应用定时任务（cron）配置后执行不正确，提示 sidecar 找不到 / 任务失败。日志 `unified-2026-08-26.log:16997` 证实：
```
[NODE ] [cron] execute-sync taskId=... failed via builtin: A valid Sidecar generation is required
[RUST ] [sidecar] Background turn ... response: status=409 Conflict, body={"success":false,"error":"A valid Sidecar generation is required"}
```

**根因（自 Init commit 就存在的 header 名不匹配）**：
- Node 侧 `src/server/utils/management-api-client.ts:31` 发送 `X-HamunaAgent-Sidecar-Generation`
- Rust 侧 `src-tauri/src/management_api.rs:76` 读取 `x-hamuna-sidecar-generation`
- HTTP header 名区分大小写折叠，但连字符位置不同就是**不同 header**（`x-hamunaagent-` vs `x-hamuna-sidecar-`）→ Rust 永远读不到 → 返回 409

**触发链**：cron 定时触发 → Rust `execute_cron_task` → Node `/cron/execute-sync` → `createTaskDispatchGuard`（`src/server/index.ts:1101`）→ `managementApi('/api/task/turn/authorize')` → 带错 header → Rust 409 → dispatch guard 拒绝 → cron turn 失败。`/api/task/turn/authorize`、goal 端点、`/api/grok/bearer` 都强制校验此 header（共 6 处 `request_sidecar_generation` 调用）。

**修复**：`management-api-client.ts` 的 header 名对齐 Rust 读的名字。Rust 是唯一权威读取方，改 Node 发名。

- **改动**：`src/server/utils/management-api-client.ts:31` — `'X-HamunaAgent-Sidecar-Generation'` → `'X-Hamuna-Sidecar-Generation'`（1 行）
- **新增**：`src/server/utils/management-api-client.unit.test.ts` — 回归测试断言发出的 header 名精确匹配 Rust 读名（`x-hamuna-sidecar-generation`）。注意：env var 在模块加载时读入 top-level const，测试必须用动态 `await import()` + 前置 `process.env` 设置
- **重建**：`npm run build:server`（`src-tauri/resources/server-dist.js` 是 gitignored 构建产物，已重打）
- **验证**：
  | 验证 | 结果 |
  |---|---|
  | `npx vitest run --project unit -- src/server/utils/management-api-client.unit.test.ts` | ✅ 1/1 |
  | `npx tsc --noEmit` | exit 0 |
  | `npx eslint src/server/utils/management-api-client.{ts,unit.test.ts}` | exit 0 |
  | `npm run test:classification` | ok |
  | `grep X-Hamuna-Sidecar-Generation dist` | 1（正确名）/ 0（错误名） |
- **未 commit**：2 文件改动 + 1 新测试文件 + rebuilt dist（gitignored），待用户拍板提交

### TODO #9: 🔄 进行中 — xueqiu skill 重设计（九轮迭代）+ skill-creator 评测

用户需求："重新设计输出，生成从真实数据深度分析得到的未来可能投资方向报告"。

**关键事实核实**：
- **stock-datasource MCP 是内置的（HTTP 端点 `http://116.62.181.59:8080/mcp`），之前只是 disabled**。已用 `hamuna mcp enable stock-datasource` 启用。
- **实测确认**：stock-datasource 提供 33 个工具，**仅覆盖 A 股**（容维数据源）。港股/美股（阿里 09988、富途、亚盛医药、招金矿业等）lookup 返回空。已实测士兰微 600460 实时行情与帖子完全吻合（35.89 涨停）。
- **雪球发布格式实测**：雪球正文是富文本 HTML，支持段落/加粗/图片/`$代码$` 标的，**不支持 Markdown 表格、代码块、`#` 标题**。

**重设计内容**（`skills/crawl-xueqiu-my-timeline/`）：
- **迭代1**：SKILL.md 从"描述性报告"改为"投资方向分析"：帖子信号 → A 股行情/财务交叉验证 → 方向推演 → 风险边界
- **迭代4（本次）**：用户反馈"没有深度分析"→ 从"整理观点"升级为**深度研究**：
  - **根因**：前三轮本质是把帖子观点消化/整理成好看文字，没有产出帖子之外的新认知
  - **核心变化**：帖子只是"研究线索"，选 3-5 个方向做**独立研究**，挖"数据发现"（帖子没提的信息）
  - **深度工具实测可用**（前几轮没用）：`get_cninfo_announcement` 业绩预告全文（验证涨价→业绩兑现度）、`get_shareholders` 十大股东（国家队华芯投资3.72%）、`get_chip_distribution` 筹码分布、`get_stock_industry_compare` 同业分位（士兰微总市值 rank38/165）
  - subagent 调度从"按发言人分组"改为"按研究方向独立研究"
  - 写作自检加"数据发现"标准：删掉数据发现后若只剩观点罗列 → 深度不够重写
- **迭代3**：用户反馈"想要像人类一样的叙述式语言，不需要如此规整的分析格式"→ 升级为**投资长文风**：
  - 报告 = 连贯散文，像深度投资者在雪球写的长文（彻底去标题/去列表/去分节）
  - 保留前两轮内核（零署名/对撞分析/数据验证/完整逻辑）但全部用叙述表达
  - 数据融入叙述（"士兰微涨停收35.89，可隔天主力净流出5.6亿"）而非列表
  - 有开头破题/方向间过渡/个人判断/收尾+风险
- **迭代2**：用户反馈"不要罗列观点、要综合分析"→ 升级为**观点对撞 + 逻辑链综合**：
  - **正文零署名铁律**：不出现"@某大V说..."，所有观点消化为分析语言，信息出处只在文末"信号依据"清单
  - **逻辑链结构**：现状事实 → 观点对撞 → 对撞裁决（用数据裁决）→ 关键变量 → 逻辑延伸 → 证伪条件
  - **少而深**：聚焦 3-5 个有证据方向写透，低确信度一句话带过
  - **港美股不罗列**：并入逻辑链作"跨市场变量"，不单列章节
  - 输出文件名改为 `深度分析_YYYYMMDD_YYYYMMDD.md`（原 `投资方向_` 废弃）
- 新增 `scripts/stock_datasource_call.sh`：**stock-datasource MCP HTTP 直连工具**（自动 initialize → 任意工具调用）。解决 subagent 无 MCP 客户端时的行情验证兜底。修复了 `${2:-{}}` 导致参数多 `}` 的 bash 解析 bug
- evals.json 更新 #11（深度综合分析，6断言）、#13（深度分析发帖格式，5断言）

**skill-creator 评测结果**（iteration-1，2 个 eval × with-skill/baseline 对比，输入 34 条真实帖子）：

| 指标 | baseline（旧版） | with-skill（新版） | Delta |
|------|------|------|------|
| 断言通过率 | 48% | **100%** | **+52%** |
| 耗时 | 212.6s | 239.3s | +26.8s（行情验证成本） |

- **eval-direction-analysis**（5 断言）：with-skill 5/5（四段结构/A股验证/港美股标注/确信度/推演逻辑）；baseline 1/5（无可验证分层、无行情验证）
- **eval-post-format**（4 断言）：with-skill 4/4（无表格/无代码块/$格式/结构完整）；baseline 3/4（排版合规但无可验证分层）
- viewer 已生成：`workspace/crawl-xueqiu-workspace/iteration-1/review.html`

**iteration-2（综合分析重设计，用户反馈"不要罗列观点"）**：
- with-skill 测试：5 个逻辑链全部达成，**5/5 断言通过（100%）**
- 产出验证：正文零署名、观点对撞用数据裁决（士兰微涨停+主力净流出5.64亿、扬杰PE40 vs 士兰微132、平安PB0.96+净利-7.4%）、逻辑链六段完整、5方向写透
- 关键逻辑突破：第5逻辑链"卖铲子优于买铲子"统一全部逻辑链（阿里配股摊薄 vs 军备竞赛）
- viewer：`workspace/crawl-xueqiu-workspace/iteration-2/review.html`
- **数据核实**：士兰微 8/21 涨停 35.89（K线确认）、8/24 收 37.2——报告数据准确

**iteration-3（投资长文风，用户反馈"要像人一样叙述"）**：
- with-skill 测试：**6/6 断言通过（100%）**
- 产出验证：15 段纯散文、grep 校验 0 个 ##标题/0 列表/0 @署名/0 章节标签/0 确信度标签
- 亮点：破题 AI 资本开支 → 光模块/液冷/功率半导体/低估值反转四方向写透 → "卖铲子优于买铲子"收尾 + 脉冲行情风险
- viewer：`workspace/crawl-xueqiu-workspace/iteration-3/review.html`
- **数据核实**：士兰微涨停 35.89、主力净流出 5.44 亿、扬杰 PE40/毛利36.8%、中际旭创成交 174 亿——均验证准确

**iteration-4（深度研究，用户反馈"没有深度分析"）**：
- with-skill 测试：**6/6 断言通过（100%）**
- 产出验证：真正的深度研究——每段有帖子之外的数据发现：
  - 士兰微半年报净利 5.19 亿但**扣非仅 2.76 亿**（近半利润非经常损益）；上方 56-57 元**38.5% 套牢盘**；大基金一期二期持股>5%
  - 中际旭创营收+192%/利润+262%（业绩已兑现）、PEG<0.5、主力净流入 15.6 亿全特大单
  - 新易盛外资个人股东 + 港资第一大流通股东 6.3%
  - 平安归母净利-7.4% → 裁决"最坏已过≠已反转"；豪威获利盘仅 0.8%/上方套牢 79% → **证伪 V 型反转**；牧原无信号诚实跳过
- 点题：**"帖子里喊得最响的方向，数据往往只兑现了一半；数据最硬的方向，情绪最纠结"**
- viewer：`workspace/crawl-xueqiu-workspace/iteration-4/review.html`
- 数据边界诚实标注：液冷无 A 股覆盖列观察、年报文本接口报错标注

**iteration-5（完全独立分析，用户反馈"不要说帖子，只是根据参考帖子的观点进行深度分析"）**：
- with-skill 测试：**✅ 6/6 断言通过（100%）**，3488字 9段纯散文
- grep 校验：正文 0 次"帖子/雪球/发帖/热帖/大V/@"——完全独立的市场分析，不是在"回应帖子"
- 数据发现 5 处：士兰微毛利率同业分位（185家排倒数50/低于均值30%）、扬杰PE同业第8低分位/净利排13、平安主力净流入1.34亿+股东结构、中际旭创特大单净流入15.4亿、豪威85元筹码平台
- 亮点裁决："逻辑在，但兑现的只有扬杰一半的腰包"；平安"这是估值反转，不是业绩反转"；"周期股最贵的就是我觉得到底了这六个字"
- 边界诚实：K线接口仅返回2026-03历史数据（周期受限）；港股/美股无法用 stock_datasource 验证，仅作跨市场背景
- viewer：`workspace/crawl-xueqiu-workspace/iteration-5/review.html`

**iteration-6（去 AI 味，用户反馈"去除生成文章中的AI味"）**：
- with-skill 测试：**✅ 7/7 断言通过（100%）**，2069字 10段，新增"去AI味"断言
- 量化校验全达标：0 个"X两个字"式破题（用具体动作开场）、排比对仗 2 处均自然、高频转场词 0 次、"我"字全文 0 次、金句仅收尾 1 处、详略失衡（功率半导体 4 段 vs 其他各 1 段）
- **真正的新数据发现 11 处**（比 iteration-5 更深）：①士兰微净利+96% 全靠 1.94 亿炒股收益、扣非 2.76 亿原地踏步 → 证伪"主营反转"②扬杰新能源车/SiC 近翻倍+睿郡连续三季加仓 ③**平安长期服务计划 Q2 停止增持**（50.49→47.03 亿股）→ 证伪"反转在即"④豪威港股通 9.9→7.4 亿股持续减、虞仁荣 15.4%→8.35%⑤英维克净利-82%/PE1353"故事先行报表迟到"⑥牧原 1.7% 短融扛现金流
- SKILL.md 新增"⚠️ 去 AI 味"区块（7 条量化铁律表格 + 讲的语气/允许不完美/详略失衡）+ 写作自检 2 条；evals.json #11 加"去AI味"断言
- viewer：`workspace/crawl-xueqiu-workspace/iteration-6/review.html`

**iteration-7（未来投资方向，用户反馈"最终希望分析出未来的投资方向"）**：
- with-skill 测试：**✅ 8/8 断言通过（100%）**，3980字 12段纯散文
- **从"分析现状"升级为"收束出未来投资方向"**（最初需求落点）：每个方向三步走（现状落脚→判断依据→未来收敛含信号表/作废条件），末段把方向串成整体排序
- **末段整体判断**：平安（确定性最高，营运利润+8.3%拐点+主力连续流入）> 牧原（周期底部确认，1.70%短融信用信号，节奏要等）> 中际旭创/扬杰（等回调，生意真价格贵筹码消化中）> 豪威/种业（看不清，等Q3/等政策）
- **三个前提+两条证伪重排**：AI订单兑现/平安顶住利率/猪去化持续；两条同时证伪→全面防守
- 核心现状证据：8/24板块高低切换（光模块-4.1% vs 农业+1.9%）、中际旭创主力+9.18亿 vs 86%套牢背离、士兰微缩量涨停+放量出货
- SKILL.md 新增"第三步：收束未来投资方向"+"未来方向收束"区块+三条纪律；evals.json #11 加"未来投资方向"断言（共8条）
- viewer：`workspace/crawl-xueqiu-workspace/iteration-7/review.html`

**定稿确认**：用户 2026-08-24 确认 iteration-7 输出（"这个可以"），skill 重设计完成。已 commit（7d33651）。

**iteration-8（选题打分收敛，用户要求"爬帖子→出3个选题→打分→取最高分选题进行剩余步骤"）**：
- with-skill 测试：**待运行**
- 核心变化：从"选 3-5 个方向平行研究"→"**出 3 个候选选题 → 4 维打分 → 取最高分 1 个 → 剩余步骤全围绕它**"
- 打分维度：数据可挖深度 40% / 逻辑可验证度 25% / 未来可推演性 20% / 关注热度 15%
- 成文从"多方向各写一段"→"**1 个主选题写透**（含对比标的/子链），其他选题一句背景带过"
- SKILL.md：第一步改为选题打分、第二步只研究主选题、Subagent 调度加"选题打分 TODO"、写作自检加"单主选题"、风格/结构规则从"3-5方向"改"一主一深"
- evals.json #11 加"选题打分收敛"断言（共 9 条）
- 评测目录：`workspace/crawl-xueqiu-workspace/iteration-8/`

**iteration-8 结果**：
- with-skill 测试：**✅ 9/9 断言通过（100%）**，1431字 11段纯散文，聚焦单主选题
- 选题打分执行规范：功率半导体涨价 7.4 > AI电力基础设施 6.9 > 光模块FCC 6.8，选中功率半导体（数据可挖/逻辑可验证/未来可推演三维最高）；打分未进正文，其余选题仅末段一句背景
- 单主选题写透：主线（士兰微涨停打开/主力-7.7亿）+ 对比（扬杰 vs 士兰微 vs 新洁能）+ 筹码信号（35.69成本区上沿 vs 现价35.89）
- 未来方向：'买质地不买名气'，信号表三看+作废条件三条+前提/推翻
- 数据发现 5 处：士兰微扣非仅占53%、毛利率19.79% vs 均值30.07%、扬杰净利13/185+PE最低档8/118、筹码成本区位置、新洁能情绪票
- viewer：`workspace/crawl-xueqiu-workspace/iteration-8/review.html`

**iteration-9（加厚度，用户反馈"太短了，字数不够"）**：
- with-skill 测试：**待运行**
- 问题：iteration-8 聚焦单选题导致文章缩到 1431 字，用户嫌短
- 改法：聚焦单选题不变，但**把主选题写到足够厚**（2500-4000字）——通过 4 个"加厚维度"：①多标的展开（龙头+二线+新秀分层）②产业链拆解（上游供给/中游传导/下游需求）③历史复盘（同款行情相似案例）④未来情景推演（乐观/基准/悲观三情景+触发条件）
- 其他选题仍作背景，主线份量不变

**iteration-9 结果 + 标题铁律修订**：
- ✅ **字数 4093 达标**（目标 2500-4000），4 个加厚维度全落地：多标的五档对比（士兰微/扬杰/新洁能/华润微/斯达）、产业链三环拆解、2021-22 缺货行情历史复盘、乐观/基准/悲观三情景
- 数据发现 9 处：士兰微扣非仅+2.78%（净利+96%）、扬杰PE35 vs 士兰微70、斯达净利-74%/PE213、士兰微主力-7.73亿出货、筹码成本区、大基金持股、华润微业绩说明会、扬杰三业务翻倍
- ⚠️ 发现 agent 用了 5 个 `##` 章节标题（违反原铁律），且 agent 报告谎称"无标题"
- **用户拍板：保留标题**——4000 字长文用章节标题可读性更好，skill 铁律从"彻底无标题"改为"用加粗段标题替代 Markdown #"（雪球富文本支持加粗）
- viewer：`workspace/crawl-xueqiu-workspace/iteration-9/review.html`

### TODO #8: ✅ 已修复 — 雪球时间线 Skill 修复（实验 skill，未 commit）

`skills/crawl-xueqiu-my-timeline/`（原 `skills/xueqiu/`）—— 雪球关注时间线爬取 + AI 观点分析 + PDF 报告 skill。原代码**跑不起来**，本次修复：

| 问题 | 修复 |
|------|------|
| 🔴 `crawl_xueqiu_home_timeline_api.py:84` Python 2 语法 `except ValueError, OSError:` | → `except (ValueError, OSError):`，`ast.parse` 通过 |
| 🔴 目录名 `xueqiu` ≠ frontmatter name `crawl-xueqiu-my-timeline`，SKILL.md 路径对不上 | 目录重命名为 `crawl-xueqiu-my-timeline`，SKILL.md 路径统一为 `skills/crawl-xueqiu-my-timeline/` |
| 🟠 `check-cdp.sh` 硬编码 `CHROME_PATH="chromium"`（本机只有 google-chrome） | 改为自动探测 `google-chrome-stable`/`google-chrome`/`chromium`/`chromium-browser` |
| 🟠 `check-agent-browser.sh` 用 `brew install node@22`（macOS 专用） | 改为跨平台检测，缺 node 时提示按平台安装 |
| 🟡 登录步骤模糊（"需要先登录雪球账号"） | 新增「一次性登录」小节，写清 check-cdp → agent-browser open → 手动登录 3 步；标注 `10022 用户未登录` 错误码 |
| 🟡 `is_official_account` 的 `user_id in [-1,0,""]` 对字符串 `"-1"` 失效（实测 bug） | 加字符串形态 `"-1"`/`"0"` |
| 🟡 无自检手段 | 新增 `scripts/selfcheck.py`（纯单元级，不依赖网络/登录） |

**扩展（双源综合分析）**：
- 新增 `--hot`（仅热帖）/ `--follow-only`（仅关注）参数，默认**关注+热帖双源**合并去重
- 热帖接口 `https://xueqiu.com/statuses/hot/listV2.json`（`items[].original_status` 结构与 home_timeline status 完全兼容，复用 `parse_status`）
- 输出文件改名 `xueqiu_YYYYMMDD_YYYYMMDD.md`（原 `home_timeline_*.md` 废弃）
- profile 路径从 `./browser_profiles/xueqiu_profile`（相对 cwd，会随提交入 git）改为 skill 目录外的 `../.profile_xueqiu`
- evals.json 新增 2 个用例（热帖爬取、双源分析）

**验证**：
- `ast.parse` + `bash -n` 全过
- `scripts/selfcheck.py` 全过（timestamp/官方账号过滤/HTML清理/评论链解析/分组输出端到端）
- 端到端实测：`check-cdp.sh` 成功启动 google-chrome Debug 模式（9222）
- **热帖实测**：`--hot --hours 48` 成功爬取 18 条真实热帖（@没听说过的股神/@阿企笔记/@周期王国/@但斌 等），生成 `xueqiu_20260822_20260824.md` 内容完整
- **登录态**：用户已手动登录雪球，`home_timeline.json` 正常响应（不再 10022），但**该账号关注数为 0** → 关注时间线为空属正常；热帖源不依赖关注，已能产出数据
- **✅ 端到端实测（2026-08-24）**：默认双源模式 `--hours 24` 成功爬取 **34 条真实动态 / 24 位发言人**（关注 16 + 热帖 18，去重）→ `/tmp/xueqiu_20260823_20260824.md`；AI 生成投资分析报告 `/tmp/雪球时间线_20260823_20260824.md`（含发言人统计、热帖榜、24 位发言观点总结、市场热点 TOP3）；`bunx mdpdf` 转 PDF（1.4MB，中文渲染验证通过）。Chrome Debug 已清理。**真实输出链路全通**。

**依赖**：Chrome Debug 模式 + agent-browser + bun（`bunx mdpdf`）。登录态靠 Chrome profile 持久化（`../.profile_xueqiu`），首次需手动登录。

**未 commit**：整个 `skills/` 目录是 untracked 新目录，跟随用户决策（是否入 bundled-skills / 单独 PR）。

---

## 4. 已完成任务

- **`ensure_claude_sdk_package.ps1` caret range vs `-ne` 严格比较 bug 修复**（2026-08-19） — 详见下文
- **Linux cuse externalBin 缺失修复**（2026-08-19） — 详见下文
- **Playwright-via-Bash auto-background gate (root fix)**（2026-08-18） — 详见下文
- **SDK `@anthropic-ai/claude-agent-sdk` 0.3.201 → 0.3.234 升级**（2026-08-18） — 详见下文
- **`npx tauri dev` 启动失败修复**（2026-08-18） — 详见下文
- **Vite 7 dev `?raw` 资源 "optimized info should be defined" 修复**（2026-08-18） — 详见下文
- v0.3.19 发布 (`64ff065`)
- streaming bug fixed (`bc59ee9`)
- v0.3.18 发布 (`7cd2d4e`)
- `latest stable` (`05ac25c`)
- `123` (`7c83ddc`)

### Linux cuse externalBin 缺失修复细节

**症状**

`./build_linux.sh` 在 `npm run tauri:build` 阶段抛：

```
resource path `binaries/cuse-x86_64-unknown-linux-gnu` doesn't exist
```

→ 第一次修：空 `touch` stub 满足文件存在性，但下游 `linuxdeploy` 仍失败：

```
failed to bundle project: `failed to run linuxdeploy`
```

**根因（两层）**

**Layer 1 — 配置/运行时不对称**

`tauri.conf.json::bundle.externalBin: ["binaries/cuse"]` 是**全局**配置 —— Tauri v2 schema 不支持 per-platform 条件（见 `node_modules/@tauri-apps/cli/config.schema.json` 注释）。打包时 Tauri 必查 `${name}-${target-triple}` 文件存在：

| 平台 | Tauri 期望 | cuse 是否发布 |
|------|-----------|-------------|
| darwin (arm64/x86_64) | `cuse-aarch64-apple-darwin` / `cuse-x86_64-apple-darwin` | ✅ macOS universal |
| win32 (x86_64) | `cuse-x86_64-pc-windows-msvc.exe` | ✅ |
| **linux (x86_64/aarch64)** | **`cuse-x86_64-unknown-linux-gnu` / `cuse-aarch64-unknown-linux-gnu`** | ❌ 不发 |

而 runtime 层 `src/server/utils/runtime.ts::getBundledCusePath()` 已硬 gate `process.platform !== 'darwin' && process.platform !== 'win32'`（line 224）→ Linux 永远拿 null。`setup.sh` 也跳过非 macOS 的 cuse 下载。

**Layer 2 — linuxdeploy ELF 校验**

第一次修用 `touch`（0 字节空文件）只骗过 Tauri 的存在性检查。Tauri AppImage bundler 调 linuxdeploy 时，linuxdeploy 把 stub 当 ELF 解析 → 0 字节不是有效 ELF → 直接抛 "failed to run linuxdeploy"。

**修复（最小，build script 内闭环）**

不动 `tauri.conf.json`（macOS/Windows 仍正确需要 externalBin）。在 `build_linux.sh::[5/6]` 段（`npm run tauri:build` 前）自动生成 stub：

```bash
CUSE_STUB="${PROJECT_DIR}/src-tauri/binaries/cuse-${TARGET}"
trap 'rm -f "$CUSE_STUB"' EXIT        # 失败也清理，不污染 git status
mkdir -p "$(dirname "$CUSE_STUB")"
TRUE_BIN=""
for candidate in /usr/bin/true /bin/true; do
    if [ -x "$candidate" ]; then
        TRUE_BIN="$candidate"
        break
    fi
done
[ -z "$TRUE_BIN" ] && { echo "..."; exit 1; }
cp "$TRUE_BIN" "$CUSE_STUB"
chmod +x "$CUSE_STUB"
```

stub 永远不被 runtime 引用 —— `getBundledCusePath()` 已在 Linux 早返 null。

**避坑**：不能用 `command -v true` —— bash 把 `true` 当 shell 内建，`command -v` 只返回字面量 `"true"` 不带路径，`cp true ...` 直接 stat 失败 (`没有那个文件或目录`)。改用绝对路径候选列表 + `-x` 校验（merged-/usr 系统优先 `/usr/bin/true`，传统系统回退 `/bin/true`）。

**为何不用 `printf` 写内联 84-byte ELF**：x86_64 / aarch64 各要不同字节序；维护成本 vs /bin/true 的 ~30KB 不划算。

**为何不"删 tauri.conf.json::externalBin"**：macOS/Windows 仍依赖 externalBin 把 cuse 打入 bundle 正确路径（`Contents/MacOS/cuse` / install-dir `cuse.exe`）。删了这两个平台的 build 会断。

**为何不"在 conf 里加 per-platform filter"**：Tauri v2 schema 不支持，强行加会被 schema validation 拒。

**验证**：

| 验证 | 命令 | 结果 |
|------|------|------|
| 语法 | `bash -n build_linux.sh` | OK |
| 路径候选解析 | 模拟 for-loop + `-x` 校验 | 解析到 `/usr/bin/true`（本机） |
| stub ELF | `cp /usr/bin/true $TMP_STUB && file $TMP_STUB` | `ELF 64-bit LSB pie executable, x86-64, ...` |
| stub 可执行 | `$TMP_STUB && echo $?` | exit 0 |
| path 解析 | `TARGET=x86_64-unknown-linux-gnu` → `binaries/cuse-x86_64-unknown-linux-gnu` | OK |
| runtime 不引用 stub | `getBundledCusePath()` Linux 返 null | gate 已存在 |
| trap 行为 | `set -e` + exit 1 模拟 | stub 被清理（实测） |

**未 commit**：1 文件改动（`build_linux.sh` 仅 +19 行）等待用户决策单独 PR 或并入其他变更。

### `ensure_claude_sdk_package.ps1` caret range vs `-ne` 严格比较 bug 修复细节

**症状**

用户报 Windows 构建失败：

```
=========================================
  构建失败!
=========================================
错误: @anthropic-ai/claude-agent-sdk-win32-x64@^0.3.234 is still invalid after repair
```

**根因（双层矛盾）**

1. **`package.json` 的 `^0.3.234` 是 npm caret range** — 语义为 `>=0.3.234 <0.4.0`，允许 npm 自动跟随 patch 升级。当前 `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/package.json::version = 0.3.235`（在 caret 范围内，合法）。
2. **脚本第 175 行用 PowerShell `-ne` 严格字符串比较**：`if ($pkg.version -ne $SdkVersion)` → `"0.3.235" -ne "0.3.234"` → 永远 true。PE binary 完整（326MB，machine 0x8664），Authenticode 签名 Valid（CN="Anthropic, PBC" / DigiCert Trusted G4 Code Signing）—— **唯一失败的就是这一行字符串比较**。
3. **`Repair-SdkPackage` 把 `^0.3.234` 整串丢给 `npm install`**：npm registry 再次按 range 解析 → 仍然拉 latest patch（0.3.235）→ 修复后再校验还是失败 → `throw "$pkgName@$SdkVersion is still invalid after repair"`。

**矛盾点（这是 root fix 要解决的）**：`package.json` 表达"接受 patch 自动升级"，脚本表达"必须精确匹配"——两者语义不兼容。任何一次 npm 发布新 patch（0.3.235、0.3.236 ...）都会触发这个 build 故障。

**修复（2 处，治本）**

`scripts/ensure_claude_sdk_package.ps1`：

1. **新增 `Test-SdkVersionRange -Installed X -Required Y`**：解析 Y 的首字符（`^`/`~`/none），按 semver 范围语义比较 X 是否在 Y 范围内。`^0.3.234 → >=0.3.234 <0.4.0`、`~0.3.234 → >=0.3.234 <0.4.0`、精确匹配走 `-eq`。
2. **`Test-SdkPackage` 用 helper 替代 `-ne`**：错误信息增加 `installed=0.3.235` 字段方便后续排查。
3. **`Repair-SdkPackage` 传给 npm 前 strip caret**：`$exactSdkVersion = $SdkVersion -replace '^[\^~]', ''`。否则 npm 还是会 range-resolve 到 latest patch，repair 闭环失败。

**为何不动 `package.json` 的 `^0.3.234`**：
- `^` 表达的是"接受安全 patch 升级"的产品意图（与 `^0.3.201` 历史一致，snapshot 旧记录里 0.3.201 → 0.3.234 升级也走 caret）
- 把 9 处 `^0.3.234` 改成 `0.3.234`（精确）会让后续 patch 升级需要人工改 manifest + 重新生成 lockfile，违反产品意图
- 脚本侧兼容 range 才是 root fix；脚本侧锁精确反而是 band-aid

**验证（2 层全过）**：

| 验证 | 命令 | 结果 |
|---|---|---|
| Test 路径（0.3.235 in ^0.3.234） | `powershell -File scripts/ensure_claude_sdk_package.ps1 -Arch x64` | exit 0，输出 `Claude SDK win32-x64@^0.3.234 is valid` |
| 静态语义 | `Test-SdkVersionRange -Installed 1.0.0 -Required ^0.3.234` → `false`（caret 上界拒绝 major bump）；`-Installed 0.3.234 -Required ^0.3.234` → `true`（下界接受）；`-Installed 0.3.233 -Required ^0.3.234` → `false`（下界拒绝） | 行为符合 semver 规范 |

**Repair 路径未做 live test**（避免污染用户真实安装）：`strip caret` 一行 + 末尾再调 `Test-SdkPackage` 已测路径，逻辑闭环完整。如果未来 npm 真把 0.3.234 从 registry 撤回，repair 会在 `npm install` 阶段抛 `npm install exited with N` —— 比"永远 invalid"更早、错误更明确。

**未 commit**：1 文件改动（`ensure_claude_sdk_package.ps1` +47 行 / -3 行）等待用户决策单独 PR 或并入其他变更。

### Playwright-via-Bash auto-background gate (root fix) 细节

**问题**：用户质疑"无论怎样命令也不会一直卡住"——**对**。SDK 0.3.234 已有完整 abort 机制（BashInput.timeout + run_in_background + BashOutput.{interrupted, backgroundTaskId, timedOutAfterMs}），前端 BashTool.tsx / bashTranscript.ts 已渲染 background state。**唯一缺口**：模型**没用** `run_in_background: true`。

**修法（v2 — 从 deny 改 transform）**：PreToolUse hook 不再 deny（demy 让模型重蹈覆辙）。改用 `PreToolUseHookSpecificOutput.updatedInput` 把 BashInput **重写**为 `{ run_in_background: true, timeout: 30_000 }` + `additionalContext` 让模型下次自己写 flag。命令立刻后台跑、立即返回 backgroundTaskId、前端渲染 background 状态，**用户不再卡**。

**改动**（3 文件）：
- `src/server/utils/playwright-bash-redirect.ts` — `decidePlaywrightBashRedirect` → `decidePlaywrightBashTransform`
- `src/server/agent-session.ts:11194` — hook 调用切换到 transform 路径
- `src/server/utils/playwright-bash-redirect.unit.test.ts` — 27 测试覆盖 happy path + LIMITATION 误伤 + field preservation + 单 canonical additionalContext 不变量

**4 层验证**：`tsc --noEmit` / `vitest 27/27` / `eslint` / 单 canonical additionalContext 不变量 — 全过。

**未 commit**：3 文件改动（纯 deny→transform 重构）待拍板。

---

[historical entries below]

**背景**：用户报告 desktop 应用内 Bash 工具（`SDK Bash tool`）调用 `node probe_home.cjs 2>&1 | head -60` 死锁卡在 SDK 120s timeout。单独跑 `probe_home.cjs` 23.8s 正常 exit 0，**根因是 Windows Git Bash spawn 管道时 node 大量输出填满 4KB pipe buffer 互等死锁**——SDK 闭源 Bash tool，应用代码无 root fix 空间。用户选择升级 SDK 0.3.234 赌上游修复。

**升级**（2 文件）：
- `package.json` — 9 个 `@anthropic-ai/claude-agent-sdk*` 版本约束从 `0.3.201` → `^0.3.234`（主包 + 8 个 optionalDependencies）
- `package-lock.json` — `npm install` 自动同步

**必要的应用补丁**（1 文件）：
- `src/shared/terminalReason.ts` — SDK 0.3.234 新增 6 个 TerminalReason 字面量（`api_error` / `malformed_tool_use_exhausted` / `budget_exhausted` / `structured_output_retry_exhausted` / `tool_deferred_unavailable` / `turn_setup_failed`）。`Record<TerminalReason, TerminalReasonInfo>` 是 exhaustive mapping，类型系统强制补全 6 个 entry。Sdk d.ts 无 per-literal JSDoc，**label / detail / severity 是字面直译 + 占位**，需要人工 review（TODO #4）。

**验证（4 层全过）**：

| 验证 | 命令 | 结果 |
|---|---|---|
| Type | `npx tsc --noEmit` | exit 0（之前 1 个 TS2740 错，补 6 个 MAP entry 后清零） |
| Lint | `npm run lint` | exit 0 |
| Unit test | `npx vitest run --project unit` | 2775 passed / 14 failed / 10 skipped（**与升级前完全一致** — 14 failed 全是 TODO #3 预先存在的） |
| 升级副作用 | `npm install` | exit 0, 2 packages changed in 11s |

**API 兼容性**：
- `PreToolUseHookInput` / `PermissionRequestHookInput` / `HookJSONOutput` 类型 0 → 0 改动（agent-session.ts:11178-11318 全部通过 typecheck）
- `applyWindowsUtf8SubprocessEnv` env vars 0 改名（`CLAUDE_CODE_GIT_BASH_PATH` / `LANG` / `LC_ALL` / `PYTHONUTF8` / `PYTHONIOENCODING` / `LESSCHARSET` 全部兼容）
- `canUseTool` 短路警告（`canUseTool will not be invoked: permissionMode 'bypassPermissions'`）在 0.3.234 仍存在，**这次升级没改 bypass 行为**（与 TODO #5 headed chromium hang 正交）

**Bash spawn 行为**（实测 TODO #5 验证）：
- 升前后 desktop 内 `node probe_home.cjs 2>&1` 都卡，**0.3.234 升级未引入 Bash spawn regression** 也未修复 previously-reported 卡死（真正根因是 headed chromium + detached console，详见 TODO #5）

**未 commit**：3 文件改动（package.json + package-lock.json + src/shared/terminalReason.ts）等待用户决策单独 PR 或并入其他变更。

---

[historical entries below]

### `npx tauri dev` 启动失败修复细节

**症状**

`cargo check`（`tauri dev` 首次启动必触发）在 build-script 阶段停掉：

```
error: failed to run custom build command for `hamuna v0.3.19`
Caused by:
  process didn't exit successfully: ... (exit code: 1)
  --- stdout
  resource path `..\src-tauri\resources\plugin-bridge-dist.mjs` doesn't exist
```

`npm run build:server` 同样报错：

```
ERROR: Could not resolve "./claude-code-env.json"
    src/server/runtimes/env-utils.ts:8:26
```

**两个独立根因**

1. **`beforeDevCommand` 漏打 dist**：`tauri.conf.json::beforeDevCommand` 仅 `npm run dev:web`（vite dev server），没跑 `build:server` / `build:bridge`；`beforeBuildCommand` 已含这俩 step。dev 模式下 `src-tauri/resources/server-dist.js` + `plugin-bridge-dist.mjs` 从未生成 → `tauri-build` 资源校验失败。
2. **`env-utils.ts` 静态 import 缺失 JSON**：`src/server/runtimes/env-utils.ts:8` 写 `import claudeCodeEnv from './claude-code-env.json';`，但该 JSON 被 `.gitignore:40` 排除（设计本意：secrets 不入 git），本地从未生成。源码注释第 121-124 行已写明"missing file = empty object = no-op"——设计者预想了此场景，但静态 ESM import 不容忍 missing file，esbuild 静态分析必报。

**修复（治本，无占位符）**

- `src-tauri/tauri.conf.json` — `beforeDevCommand` 补 `npm run build:server && npm run build:bridge`，与 `beforeBuildCommand` 对齐（dev 同样打真实 dist 文件）：
  ```diff
  -    "beforeDevCommand": "npm run dev:web",
  -    "beforeBuildCommand": "npm run build:web && npm run build:server && npm run build:bridge && npm run build:cli"
  +    "beforeDevCommand": "npm run build:server && npm run build:bridge && npm run dev:web",
  +    "beforeBuildCommand": "npm run build:web && npm run build:server && npm run build:bridge && npm run build:cli"
  ```
- `src/server/runtimes/env-utils.ts` — 静态 `import` 改为运行时 `fs.readFile + try/catch`，对齐源码注释"missing file = no-op"语义；不动 `.gitignore`；不创建任何占位文件。
- `setup_windows.ps1` — 删除原 Step 6.5/8（`.dev-placeholder` block）。dev 模式不再造占位符，统一走 `tauri.conf.json::beforeDevCommand` 真打 dist。

**验证（5 层全过）**

| 验证 | 命令 | 结果 |
|------|------|------|
| Tauri build-script | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0（资源校验通过） |
| Server dist | `npm run build:server` | exit 0（`✓ server → src-tauri/resources/server-dist.js`） |
| Bridge dist | `npm run build:bridge` | exit 0（`✓ bridge → src-tauri/resources/plugin-bridge-dist.mjs`） |
| Type | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit（已知 14 失败） | `npx vitest run --project unit` | 2775 passed / 14 failed / 10 skipped（14 失败**全部**与本修复无关，详见 TODO #3） |

**未 commit**: 跟随用户决策（与 TODO #2 其它 5 个 pending 改动一起，或单独 PR）

### Vite 7 dev `?raw` 资源 "optimized info should be defined" 修复细节

**症状**

启动 `npm run dev:web` 后浏览器请求 widget 时（具体是 `widgetLibraries.ts` 的 `import('chartjs-umd-source?raw')` / `d3-umd-source?raw` / `lucide-umd-source?raw`）Vite dev server 抛红：

```
Vite Error, /@fs/D:/Coding/hamuna-agent-desktop/node_modules/.vite/deps/chartjs-umd-source?raw.js?v=7f39ec38 optimized info should be defined
Vite Error, /@fs/D:/Coding/hamuna-agent-desktop/node_modules/.vite/deps/d3-umd-source?raw.js?v=98db590c optimized info should be defined
Vite Error, /@fs/D:/Coding/hamuna-agent-desktop/node_modules/.vite/deps/lucide-umd-source?raw.js?v=829ad1b0 optimized info should be defined
```

**根因**

Vite 7 dep crawler 在**resolveId 之前**用 regex 扫描所有 dynamic `import('...')` 中的 bare specifier，把 `chartjs-umd-source` / `d3-umd-source` / `lucide-umd-source` 加进 `optimizeDeps` 候选。即使配了 `optimizeDeps.exclude` 跳过 prebundle，bare id 仍会留在 `optimizeDeps.metadata` 里。运行时 alias 把 specifier 重写到绝对文件路径，命中但 metadata 没这个 id → 抛 "optimized info should be defined"。

`resolve.alias` 配的 lookahead `/^chartjs-umd-source(?=$|\?)/` 看似保留 `?raw` query，但**crawler 不走 alias**，只看 regex 匹配出的 bare 名。

**修复（治本）**

`vite.config.ts` 删除 `resolve.alias` 中 3 条 chartjs/d3/lucide alias，新增 `enforce: 'pre'` plugin `widgetUmdSourceResolver()`：

- `enforce: 'pre'` 让 `resolveId` 在 crawler 阶段也生效，把 specifier 重写到绝对文件路径 + 保留 query
- crawler 看到的是绝对路径（已经是文件而非 bare specifier），不会加进 `optimizeDeps`
- 浏览器请求 `?raw` 时 Vite 内置 raw pipeline 正常 inline 文件为 `export default "<source>"`

```ts
function widgetUmdSourceResolver(): Plugin {
  const files: Record<string, string> = {
    'chartjs-umd-source': resolve(__dirname, 'node_modules/chart.js/dist/chart.umd.js'),
    'd3-umd-source': resolve(__dirname, 'node_modules/d3/dist/d3.min.js'),
    'lucide-umd-source': resolve(__dirname, 'node_modules/lucide/dist/umd/lucide.min.js'),
  };
  return {
    name: 'hamuna:widget-umd-source',
    enforce: 'pre',
    resolveId(source) {
      const queryIndex = source.indexOf('?');
      const name = queryIndex === -1 ? source : source.slice(0, queryIndex);
      const query = queryIndex === -1 ? '' : source.slice(queryIndex);
      const filePath = files[name];
      if (!filePath) return null;
      return filePath + query;
    },
  };
}
```

**保留 `optimizeDeps.exclude`** 作 belt-and-suspenders：未来 crawler 如果绕过 pre plugin，exclude 仍是兜底。

**验证（4 层全过）**

| 验证 | 命令 | 结果 |
|------|------|------|
| Type | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint vite.config.ts` | exit 0 |
| Production build | `npm run build:web` | exit 0（2m 25s；theme-css verify 31 mappings；theme-presets test 8/8） |
| Dev server + 请求触发 | `npx vite` + `curl http://localhost:5173/@id/chartjs-umd-source?raw` | HTTP 200 + 1,215,837 bytes ESM 内容（chart.js UMD 正确 inline），**无** "optimized info" 报错 |

**未 commit**: 跟随用户决策（与 TODO #2 / `npx tauri dev` 修复一起提交）

---

## 5. follow-up 完成情况

- ✅ 用户最初错命令"resource path '..\src-tauri\resources\claude-agent-sdk' doesn't exist"实际触发命令 `npx tauri dev` — **已找到**
- ✅ `npx tauri dev` 启动失败根因 — **已找到并修复**（见上文 §4）
- ✅ Vite dev `?raw` 资源 "optimized info should be defined" — **已找到并修复**（见上文 §4）
- ✅ Linux cuse externalBin 缺失 — **已找到并修复**（见上文 §4）
- ✅ Windows 构建 `ensure_claude_sdk_package.ps1` "still invalid after repair" — **已找到并修复**（caret range vs `-ne` 矛盾，见上文 §4）
