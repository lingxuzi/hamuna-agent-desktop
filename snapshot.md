# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务指针。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。snapshot.md 不允许无限增长；已完成项落地到 §4 git log / 删除 narrative 后立即清出本节。
> **硬约束**：snapshot.md ≤ 500 行。

## §0 narrative 历史压缩锚点（2026-09-22 · snapshot 增补）

§0 之前累积的 4 段超长 narrative（#182 launcher / #174-176 landing v5 / #166 wizard step 2 / #191/#192 MCP）已折叠到下方一行锚点；详细设计取舍见 git log + 对应 spec：

- **#187 MiniApp Desktop App PRD v0.3**（2026-09-21）— `specs/prd/miniapp.md` 680 行；**v0.3 反转 v0.2 决策**：v0.4.0 MVP = **Icon Design Demo** + **4 个新基础设施**（MiniApp Runner / FloatingMiniChat Bubble Claim / MiniApp Cowork Sidecar / MiniApp Worker Manager）+ `app.ai.chat` SSE relay。**架构同步 openbitfun**：独立 Scene Tab + Bubble Claim bridge + MiniApp 自有 Cowork Sidecar（owner = `miniapp-agent:<app_id>:<run_id>`，永不主动关）+ Node v24 `worker_threads` 沙箱（**不引 Bun**）。**Bridge API 完整对齐 openbitfun**：恢复 `app.ai.chat/cancel/contextFiles` + `app.agent.*` + `app.call` + `app.chat.claimComposer`；schema 新增 `permissions.agent/chat/node` 三块。详见 §15 评审清单 8 项 + §11 红线 15 条 + §13 风险 14 项 + §14 scope-out 11 项。本地草稿，gitignore `specs/prd/` 不入库。
- **#182/#174-176/#166** — launcher 4 风格 mockup（A Hallmark / B Marquee / C Stacked / D Card）+ landing v5 全链路（hero 92px + caps 2-col 11 段 + 21:9 视频锚点 + R2 prod endpoint 修正 + a11y P1 audit + polish 7 处）+ wizard step 2 结构化错误路由（`NxgdDiscoveryResult` discriminated union + 502 envelope `checkedAt`）。详见 `pages/launcher-mockups/` + `pages/landing/index.html` + `bundled-skills/hamuna-writing-system/`。

## 1. 模块状态总览

### 1.1 桌面端 / Rust (`src-tauri/`)

| 模块 | 文件 | 状态 | 备注 |
|------|------|------|------|
| Sidecar 生命周期 | `src-tauri/src/sidecar/{manager,instances,commands,proxy,runtime_identity}.rs` | 稳定 | `tech_docs/sidecar_cold_start.md` |
| Sidecar 配置归置 | `src-tauri/src/sidecar/manager.rs` | 稳定 | `ensureSessionSidecar` result.isNew 黄金判据 |
| Sidecar 清理 | `src-tauri/src/sidecar/cleanup.rs` | 稳定 | `STARTUP_CLEANUP_PATTERNS` 含 `claude-agent-sdk` |
| Sidecar 健康/关停 | `src-tauri/src/sidecar/{health,shutdown}.rs` | 稳定 | `update_lock_probe_paths` 校验 Tauri 资源 |
| Local HTTP Proxy | `src-tauri/src/local_http.rs` | 稳定 | 裸 `reqwest::Client::new` 禁 — clippy |
| Process Cmd | `src-tauri/src/process_cmd.rs` | 稳定 | 裸 `Command::new` 禁 — clippy |
| Proxy Config | `src-tauri/src/proxy_config.rs` | 稳定 | `apply_to_subprocess_for_provider` provider-aware |
| IM (Telegram/飞书/钉钉) | `src-tauri/src/im/*.rs` | 稳定 | `tech_docs/im_integration_architecture.md` |
| 定时任务 | `src-tauri/src/cron_task/*.rs` | 稳定 | `TaskStore` 唯一权威；旧 `cron_tasks.json` 仅 startup 迁移 |
| Session Goal / Inbox | `src-tauri/src/{session_goal,inbox}/*.rs` | 稳定 | |
| 全文搜索 | `src-tauri/src/search/*.rs` | 稳定 | Tantivy + jieba |
| ~~KB Engine~~ | ~~`src-tauri/src/kb/mod.rs`~~ | ✅ 已删 | Node `src/server/kb/kb-store.ts`（TypeGraph+SQLite）独占；tantivy 保留 |
| Managed Codex Runtime | `src-tauri/src/managed_codex.rs` | 稳定 | 锁 `src/shared/managed-codex-runtime.json::version` |
| Grok Auth / Floating Ball | `src-tauri/src/{grok_auth,floating_ball,global_shortcut}/*.rs` | 稳定 | |
| App Config (Rust) | `src-tauri/src/{config_io,app_dirs,device_identity}.rs` | 稳定 | `with_config_lock` 写盘 |
| Browser / Notification | `src-tauri/src/{browser,notification,notification_badge}.rs` | 稳定 | |
| Admin API / Memory | `src-tauri/src/{management_api,memory_auto_update}.rs` | 稳定 | |
| CLI / Workspace Files | `src-tauri/src/{cli,workspace_files}/*.rs` | 稳定 | `cmd_workspace_*` 唯一权威；旧 `cmd_prepare_user_image_attachments` 已删（`2338a83`）；新图片拖拽走 `cmd_workspace_copy_paths` → `<workspace>/hamuna_files/`；`attachment_protocol.rs::build_attachment_response` 保服务历史 session `~/.hamuna/attachments/<sessionId>/`（双轨） |
| NSIS installer | `src-tauri/nsis/installer.nsi` | 稳定 | `Section UvxFallback` 调 uvx-path-setup.ps1（pip-only 0.11.33 持久化 PATH）；**PREINSTALL macro 新增 `RMDir /REBOOTOK "$INSTDIR\nodejs"` 升级路径清旧 tree（TODO #187）** |

### 1.2 Sidecar / Node.js 后端 (`src/server/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Sidecar 入口 | `src/server/index.ts` | 稳定 | `SYSTEM_SKILLS` 清单 |
| Session Engine | `src/server/session-engine/` | 稳定 | `selector.ts` 统一 adapter 分流 |
| Builtin Session | `src/server/builtin-session/` | 稳定 | `lifecycle / turn-lifecycle / config / types` |
| External Runtime | `src/server/runtimes/external-session/` | 稳定 | Claude Code / Codex / Gemini |
| Agent Session | `src/server/agent-session.ts` | 稳定 | facade；`reloadLiveSessionSkills`；uvx spawn → `findPipInstalledUvxScriptsDir()` |
| Skill Reload | `src/server/utils/skill-reload.ts` | 稳定 | 纯函数 `evaluateSkillReload` |
| Builtin MCP | `src/server/tools/{builtin-mcp-meta,builtin-mcp-registry}.ts` | 稳定 | `src/server/tools/*.ts` 禁顶层 import SDK/zod |
| Gemini Image Tool | `src/server/tools/gemini-image-tool.ts` | 稳定 | 懒加载 |
| Edge TTS Tool | `src/server/tools/edge-tts-tool.ts` | 稳定 | 懒加载 |
| IM Bridge Tools | `src/server/tools/im-bridge-tools.ts` | 稳定 | runtime-dynamic，context-injected |
| Third-party Providers | `src/server/{provider-verify,subscription-auth,openai-bridge}.ts` | 稳定 | |
| Plugin Bridge | `src/server/plugin-bridge/` | 稳定 | shim 版本同步 bump |
| MCP OAuth | `src/server/mcp-oauth/` | 稳定 | |
| MCP startup validator | `src/server/mcp/mcp-startup-validator.ts` | 稳定 | stdio 握手 15s timeout + parentSignal 透传 |
| MCP server transform | `src/server/mcp/mcp-server-transform.ts` | 稳定 | `transformMcpServerForSpawn` 单一变换源 |
| 日志 / Runtime | `src/server/utils/` | 稳定 | `src/server/utils/runtime.ts` bundled Node；`path-safety` chokepoint；`findPipInstalledUvxScriptsDir` Windows probe 两条候选 Scripts dir；**`mcp-command.ts::resolveNpxMcpInvocation` Win 走 `node.exe + node_modules/npm/bin/npx-cli.js` 直调（#185），POSIX 末尾 fallback throw `NpxMcpResolutionError`（#192），`hasYes` 双形式识别（#192）** |
| KB TypeGraph store | `src/server/kb/kb-store.ts` | 稳定 | 单例 + jieba 预分词 + FTS5 命中 |
| KB HTTP service | `src/server/kb/kb-service.ts` | 稳定 | `/api/admin/kb/*` 16 路由 + `{ok,...}` 契约；lazy |
| KB 关系抽取 | `src/server/{kb-relations,kb-ingest}.ts` | 稳定 | `scripts/kb-verify-stats.mjs` A/B ROI |

### 1.3 前端 (`src/renderer/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Pages / Components | `src/renderer/{pages,components}/` | 稳定 | 受 `react_stability_rules.md` 5 条约束 |
| Context / Hooks | `src/renderer/{context,hooks}/` | 稳定 | `useWorkspaceFileService` 已删 `prepareUserImageAttachments`（`2338a83`） |
| API / TS↔Rust 桥 | `src/renderer/api/` | 稳定 | Tab 作用域 MUST 用 `useTabState().apiGet/apiPost` |
| Theme | `src/renderer/theme/` | 稳定 | `tech_docs/theme_system.md` |
| i18n / Analytics | `src/renderer/{i18n,analytics}/` | 稳定 | `tech_docs/{i18n,analytics}_*.md` |
| Chat Input | `src/renderer/components/chat-input/` | 稳定 | 图片分支改 `copyPaths(hamuna_files)` + `convertFileSrc`；`attachmentSessionId` 已删 |
| CompanionWindow | `src/renderer/floating-ball/CompanionWindow.tsx` | 稳定 | 图片拖拽同上（`2338a83`） |
| Widget Libraries (UMD) | `src/renderer/components/tools/widgetLibraries.ts` | 稳定 | `widgetUmdSourceResolver` plugin 修 Vite 7 `?raw` "optimized info should be defined" |
| KB 图可视化 | `src/renderer/components/KbGraphView.tsx` | 稳定 | d3 force-directed |
| KB 管理面板 | `src/renderer/components/GlobalKbPanel.tsx` | 稳定 | CRUD + 材料入库 + workspace↔KB mount |
| KB Client | `src/renderer/api/kbClient.ts` | 稳定 | 11 个 `invoke('cmd_kb_*')` → `/api/admin/kb/*` |
| Vite Config | `vite.config.ts` | 稳定 | `widgetUmdSourceResolver` plugin（`enforce: 'pre'`） |
| tvc-director Widgets | `src/renderer/components/tools/tvcWidgets/` | 稳定 | 11 artifact_kind 模板 + SlateboardShell + 22 测试全绿 |
| Settings UI | `src/renderer/pages/settings/{ToolboxSection,SettingsPage}.tsx` | 稳定 | `hidesDefaultArgs: true` builtin MCP 不显示 vendor 默认命令/参数（`toolbox.tools.defaultArgsHidden` placeholder）；**apikey input debounce 1200ms + `MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY=8` + `pendingKeyRef` + `onBlur` 立即 flush（#191）** |
| ApiKey Debounce Helper | `src/renderer/utils/apiKeyAutoVerify.ts` | 稳定 | `shouldDebounceAutoVerify` + `MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY=8`（#191） |

### 1.4 共用 (`src/shared/`) / CLI / 脚本

| 模块 | 状态 | 备注 |
|------|------|------|
| `src/shared/*.ts` | 稳定 | 共享类型；禁止反向 import |
| `src/shared/workspacePath.ts` | 稳定 | `workspacePathsEqual` / `normalizeWorkspacePathIdentity` |
| `src/shared/managed-codex-runtime.json` | 稳定 | 客户端 runtime 版本唯一权威 |
| `src/shared/logTime.ts` | 稳定 | `localDate()` 替代 `toISOString().split('T')[0]` |
| `src/shared/tvcEnvelope.ts` | 稳定 | TODO #29 落地 |
| `hamuna` CLI | 稳定 | 改 MUST bump `CLI_VERSION` + 同步 skill |
| 内置 MA 小助理 | `bundled-agents/hamuna_helper/` | 稳定；改 MUST bump `ADMIN_AGENT_VERSION` |
| 内置 Skills | `bundled-skills/` | 稳定；`SYSTEM_SKILLS` 清单内改 MUST bump `SYSTEM_SKILLS_VERSION` |
| tvc-director skill | `bundled-skills/tvc-director/` | 稳定；v0.9 + agnes-video-25-mcp v0.1.3 + 严格工具契约 |
| creative-video-suite skill | `bundled-skills/creative-video-suite/` | 稳定；system skill；短剧/UGC/企业宣传；6 风格预设 + 中文 prompt 铁律 + 输出目录持久化契约 + MCP 使用正确性 + per-stage 可视化 widget + 12s 默认时长对齐 MCP 上限 + 多视角产品图 + 视频时长边界单源化（4-12 字符串） + commercial 3 路人物一致性独立章节 |
| agnes-short-drama skill | `bundled-skills/agnes-short-drama/` | utility；Pavo 调研产物；4 字段用户输入 → 6 元数据 → 导演式剧本；未入 `SYSTEM_SKILLS` |
| creative-ad-director skill | `bundled-skills/creative-ad-director/` | utility；9 抖音模板；trigger 9/9 + workflow +21.6pp；未入 `SYSTEM_SKILLS` |
| zenstory-ai/drama-skills | `~/.claude/skills/short-drama*` (symlink → `~/Projects/drama-skills/skills/*`) | vendor user-level；**不**污染 bundled-skills；10 个 skill |
| xueqiu skill | `skills/crawl-xueqiu-my-timeline/` | 实验 skill，untracked；TODO #9 |
| hosted_mcps | `hosted_mcps/agnes-video-25/` | 7 tools（4 video + 3 image）；本仓库代码 = PyPI 0.2.3 vendor 源；P3 多 key fallback + round-robin 已落；v0.2.2 嵌套 dict 容忍 + v0.1.8 schema 放宽；Step 4 vendor sync 0.2.3 + e2e pending |
| `scripts/ensure_{claude_sdk_package,rust_toolchain,download_*}.ps1` | 稳定 | `Test-SdkVersionRange` semver 三态；`download_uv.ps1` 已废（pip-only 取代） |
| `scripts/{esbuild-bundle,bump-on-commit}.mjs` | 稳定 | amend 必须 `--no-verify`（memory `bump-on-commit-amend-no-verify.md`） |
| `setup_windows.ps1` | 稳定 | 已删 `.dev-placeholder` 占位符方案（TODO #1 废弃） |
| `scripts/{kb-recall-test.ts,kb-verify-stats.mjs}` | 稳定 | LLM dry-run + A/B ROI |
| `src-tauri/nsis/uvx-path-setup.ps1` | 稳定 | Windows install-time HKCU\Environment\Path 持久化 PEP 370 Scripts dir + WM_SETTINGCHANGE 广播 |

### 1.5 文档 (`specs/`)

| 文档 | 加载方式 |
|------|---------|
| `specs/ARCHITECTURE.md` (L2) | 触发条件主动 Read（参见 CLAUDE.md「MUST 主动 Read ARCHITECTURE.md 的触发条件」） |
| `specs/DESIGN.md` (L4) | 前端开发 MUST 读 |
| `specs/tech_docs/*.md` (L3) | 按 CLAUDE.md「主动 Read tech_docs/ 触发条件」 |
| `specs/guides/*.md` (L4) | 按命令触发 |

---

## 2. Tauri 资源目录（dev vs build）

`tauri.conf.json::bundle.resources` 在 `cargo build` / `npx tauri dev` 首次启动的 cargo build 阶段由 `tauri-build` 校验所有声明路径存在。dev 与 prod 共用一份声明：

| 路径 | 填充时机 | 由谁 |
|------|---------|------|
| `src-tauri/resources/server-dist.js` | dev 启动前 + prod 构建前 | `beforeDevCommand` / `beforeBuildCommand` 含 `npm run build:server` |
| `src-tauri/resources/plugin-bridge-dist.mjs` | 同上 | `npm run build:bridge` |
| `node_modules/.../claude-agent-sdk-win32-x64/claude.exe` | `npm install` 后 | `setup_windows.ps1` Step 6 → `ensure_claude_sdk_package.ps1` |
| `src-tauri/resources/{sharp,tsx,nodejs,claude-agent-sdk}-runtime` | 生产构建 | `build_windows.ps1`（dev 模式目录存在但空） |
| `src-tauri/resources/hosted_mcps/agnes-video-25/` | 生产构建 | `bundle.resources` 新条目（`${bundled:REL_PATH}` 让 MCP manifest 引用 sibling package） |
| `src-tauri/nsis/uvx-path-setup.ps1` (NEW) | 生产构建 | `tauri.windows.conf.json::bundle.resources` 平铺到 `$INSTDIR\` |

**Windows bundle 不再带 uvx.exe**（`src-tauri/resources/uvx.exe` 已 `git rm`，tauri config 资源条目已删）—— Windows install 改为 pip-only 路径：NSIS `Section UvxFallback` `pip install --user --index-url https://mirrors.aliyun.com/pypi/simple/ --upgrade uv==0.11.33`（TODO #126+#128）+ `uvx-path-setup.ps1` 写 HKCU\Environment\Path。**已废弃**：`scripts/download_uv.ps1`（保留 dev box 参考但 CI 不调）；bundled `~/.hamuna/bin/uvx.exe`（TODO #121 原方案被 pip-only 取代）；`.dev-placeholder` 占位符方案（TODO #1）。

### 2.3 已安装后真实路径（prod，全集）

`app_dirs::hamuna_data_dir()` (`$HOME/.hamuna/`) 是**单一权威**路径解析器（`src-tauri/src/app_dirs.rs:112-114`）。完整 28 类文件 + 三平台真实路径 + 来源文件 → 见 **`specs/tech_docs/install_paths.md`**（TODO #112）。速查骨架：App bundle → `HamunaAgent.app/Contents/` (macOS) / `<install-dir>` (Win/Linux) / Tauri resource_dir → `<bundle>/Resources/{bundled-*,claude-agent-sdk,nodejs,uvx-path-setup.ps1,...}` / 用户数据 → `~/.hamuna/{config.json,sessions.json,skills,agents,providers,tasks.jsonl,...}` / Workspace → 用户在 UI 选定 + `<workspace>/{hamuna_files,creative-video-suite,...}` / MCP output → `$HOME/HamunaAgent/agnes-output/{videos,images}/`（**不在** `~/.hamuna/`）/ **uvx Scripts** → `%APPDATA%\Roaming\Python\Python312\Scripts\`（Windows per-user pip install 落点，installer 注册到 HKCU\Environment\Path`）/ 外部凭据 → `~/.claude/` `~/.codex/` `~/.gemini/`（helper 黑名单）。

---

## 3. 当前 TODO（按优先级 + 状态）

### 3.1 进行中

#### TODO #193 — HamunaAgent 全局系统提示词开发者可控（bundled-prompts/global.md）✅ DONE
**触发**：用户 2026-09-23 原话「希望在 desktop 加入一个全局系统提示词，升级后覆盖升级，用于控制 Agent 行为」，后续澄清为「开发需要可以配置」（bundled-prompts/global.md 路径，开发者编辑）。**用户拍板拍板过程**：(a) 范围从「~/.hamuna/system-prompt.md 用户可编辑」flip 到「bundled-prompts/global.md 开发者配」；(b) 语义 = 整体系统提示词，规定用户某类需求走哪个 Agent 执行规划（替代原 L1-L4 inline 模板）；(c) 读取时机 = 每次 query 读（开发改文件即下一 turn 生效，不重启 Sidecar）；(d) 用户侧无 override 入口（产品意志优先）。
**修法（5 文件 + 2 新文件）**：(1) NEW `bundled-prompts/global.md` — 12 行占位铁律 + 模板变量 `{{runtimeName}}` `{{platformLabel}}` `{{sourceTypeLabel}}` `{{botName}}` `{{taskId}}` `{{intervalText}}` `{{heartbeatHint}}` `{{floatingBallHint}}` `{{spaceId}}` `{{registeredAgentId}}` `{{aiCanExit}}` + `{{#if}}` 块（IM/cron/floatingBall/registeredAgent 分支 gating）；注释头说明编辑方式（PR 即生效）+ SDK 16K-32K token 上限。(2) `src-tauri/tauri.conf.json` resources 加 `"../bundled-prompts": "bundled-prompts"`（与 `bundled-skills` / `bundled-agents` 同 pattern，整个目录进 bundle）。(3) `src/server/system-prompt.ts` 重写：`buildSystemPromptAppend` 改 async（每次 query 读 `getBundledResourcePath('bundled-prompts/global.md')` → `readFile`），bundled missing/empty 走 `warn-once` + inline fallback（L1-L4 保留为窄字符串保 prod 不崩）；widget / sessionInbox / CLI tools hint 仍然 inline（不搬到外部 md）。(4) `src/server/agent-session.ts:10748` + `src/server/runtimes/external-session.ts:2281` 两个 caller 加 `await`（上下文都是 async，无 sync caller 风险）。(5) NEW `src/server/system-prompt-bundled.unit.test.ts` 7 case（bundled 渲染 / missing 走 fallback / empty 走 fallback / IM 分支 / registeredAgent 分支 / floating-ball 分支 / **每次读新鲜 — 改文件下一 query 即生效**），既有 `system-prompt.unit.test.ts` 2 case 改 async + 加 fallback mock。
**scope-out**：(a) 不加 user override 层（`~/.hamuna/system-prompt.md` 取消）；(b) 不在 Settings 加 UI 编辑器（v1 文件即可）；(c) 不为 bundled 改 bundled 提供 reload 按钮（每次 query 自动读 = 0 额外 UI）；(d) 不动 widget / sessionInbox / CLI tools hint（能力指针必须 inline）；(e) 不动 SDK ingress（`settingSources: ['project']` 仍只读 `<cwd>/.claude/`，bundled-prompts/global.md 不进 SDK discover）；(f) 不动 bundled-agents/hamuna_helper/CLAUDE.md（确认**不是全局 system prompt**，是 Agent Template，只在 `subagent_type='hamuna_helper'` 时 load）。
**关键 grllling — 不要默默降级「每次 query 读」到「Sidecar 启动时读」**：原计划想保持 sync 签名偷懒，但用户拍板「每次 query 读」= 改文件立刻生效；默默降级 = 改文件需重启 sidecar 才生效 = 语义降级。**强制 async 化**，两个 caller 上下文都是 async，加 `await` 即可。
**关键 grllling — bundled missing 时不要 throw**：throw 会让 dev box 没 bundle 资源 → 全 session 崩；prod CI 没 bundle 资源 → 测试全红。**warn-once + fallback** 保 prod 不死 + 观测得到。
**验证（全绿）**：`npm run typecheck` 0 errors（async 签名变更全 caller 已 await）；`npx vitest run --project unit src/server/system-prompt.unit.test.ts src/server/system-prompt-bundled.unit.test.ts` 9/9（既有 2 + 新 7）；`npx eslint src/server/system-prompt.ts src/server/system-prompt-bundled.unit.test.ts src/server/system-prompt.unit.test.ts src/server/agent-session.ts src/server/runtimes/external-session.ts` 0 errors。pre-existing 5 failed 不增不减。

#### TODO #193.1 — bundled-prompts/ dev layout path 发现修正（commit `0fff87b` · v0.3.217→v0.3.218）✅ DONE
**触发**：用户实操验证 #193 加第 11-12 条铁律时，dev 模式 Sidecar 应能读到 `bundled-prompts/global.md`，但实际报错「bundled resource missing」走 fallback — Sidecar 拿不到开发者写的铁律。**根因**：dev layout `bundled-prompts/` 在仓库根（与 `bundled-skills/` / `bundled-agents/` 同 layout），但 `getBundledResourcePath` 的 dev fallback 只走 `src-tauri/resources/<relPath>`（仅 binary resources 路径如 `nodejs/` / `sharp-runtime/`）。**生产 layout** 才在 `<Resources>/bundled-prompts/global.md`。两者 layout 不一致导致 dev 永远 fallback。
**修法（5 文件）**：(1) NEW `getBundledTopLevelResourcePath(relativePath)` helper：`prodPath = scriptDir/<relPath>`(Resources layout) → `walk up 6 层找 <relPath>`（dev layout = repo root）；production 与原 helper 一致，dev 直接从 scriptDir 向上 walk 不再走 `src-tauri/resources/`。(2) `system-prompt.ts` 切到新 helper。(3) `src/server/index.ts` 既有 `resolveBundledSkillsDir` 内联 walk-up 改调新 helper（一处真相源）；删 unused `getScriptDir` import。(4) `system-prompt-bundled.unit.test.ts` mock target 更新 + 第 8 case `vi.doUnmock('./utils/runtime')` 跑真实 helper 验 dev layout 能解析 `bundled-prompts/global.md`（文件存在 → 锁定 layout 契约，未来 layout 变动须更新此测试）。(5) `bundled-prompts/global.md` 用户补 #11「股票查询 → stock-datasource mcp」+ #12「营销/TVC/UGC 视频 → marketing-ad-skill」。
**scope-out**：(a) 不动 `getBundledResourcePath`（binary resources 路径仍正确）；(b) 不动 `bundled-skills` / `bundled-agents` Tauri resources mapping（与 #193 同 pattern，无需改）；(c) 不抽更通用的 `getResourceTier(path)` —— 二者区别仅是 dev fallback 起点，单点重复可接受。
**端到端验证**：node 直接 walk `/home/hmcz/Projects/hamuna-agent-desktop/src/server` 向上 2 层 → `<project>/bundled-prompts/global.md` 命中；读到用户最新 12 条铁律含 #11/#12。`npm run typecheck` 0；`vitest 16/16`（既有 system-prompt 2 + bundled 7 + 新加真实 dev layout case 1 + 其他 system-prompt 相关 6）；`eslint` 0。
**版本流转**：patch bump-on-commit (v0.3.217 → v0.3.218, commit `0fff87b`)。
**follow-up**：user 桌面 app 实测 #11/#12 铁律生效（起新 Chat Tab 问「查询 NVDA 股价」应被 SDK 路由到 stock-datasource mcp）。
**follow-up**：(a) user 实测：改 `bundled-prompts/global.md` 加一行「用户说 X 就走 Y Agent」→ 下一 turn 不重启 sidecar 验证生效；(b) 待 user 决定是否给 helper（`bundled-agents/hamuna_helper/CLAUDE.md`）拉一根 symlink 或 inline 到 global.md（helper 是 Agent Template 不是 system prompt，路径不同不冲突）；(c) 若 prompt 体量逼近 SDK 上限，需要切 chunking / 拆分到多文件。

#### TODO #186 — OpenAI Bridge 自建 provider 首字慢 12-35s ✅ 已定位上游（不在 bridge）
**症状**：SSE 首字 12-35s；stream 仍走完。**真因**（TTFT 5 次 2026-09-23 req=7fa7dbf6/f2f193cf/3004a67d/165c3717/340f12c9）：`connect_ms=27944/54636/21378/47242/6725 ms`；`translate_ms=12-20ms`、`upstream_first_byte_ms=1-3ms`、`anthropic_first_event_ms=0-1ms` 全健康 → **owner = upstream `https://api.agnes-ai.cn/v1` cold TLS/TCP**。**用户拍板**：不动 bridge，走网络层自查（DNS/VPN/CDN/反代）。**v1 已落 3 项**（per-hop TTFT 诊断 handler.ts + Rust SSE pool 5s→90s + `Agent({connectTimeout:5000})`）`typecheck 0 + eslint 0 + cargo check Finished` 验证 OK，留作日后诊断工具。**follow-up**：网络层优化后 connect_ms < 2s 即可。

#### TODO #189 — Bridge 上传 tool 缺 `parameters` 字段被 upstream 400 拒绝 ✅ DONE
**症状（2026-09-23）**：req=4ca8e7bc `format=chat_completions` 报 `tools[0].function: missing field 'parameters'`。
**真因 + 修法**：Anthropic SDK 0.3.201 把 server-side tool (`web_search`/`web_fetch`/`code_execution`) 注入 `req.tools[]` 时只带 `name+type`，**没 `input_schema`**；两 translator 直接喂 `tool.input_schema` → undefined → JSON.stringify omit → Rust serde untagged enum (agnes) 400。DIAG `tools=1/tool=web_search/wire=595b` 确认 `function` 子对象只剩 `name`。修法（单一真相源）：(1) `types/anthropic.ts::AnthropicToolDefinition.input_schema` 改可选 + 注释 req-id/4 server tool 名；(2) `translate/tools.ts` 抽 `EMPTY_OBJECT_SCHEMA={type:'object',properties:{}} as const` + `ensureObjectParameters(schema)` helper + `translateToolDefinitions` 用 helper；(3) `translate/request-responses.ts` import helper + `stripSchemaDescriptions(t.input_schema)` 外层套 helper（保留 strip 既有功能，fallback 收口在共用出口）。
**测试**：NEW `tools.unit.test.ts` 9 case（helper 4 + translator 5 含 web_search 真实形态 + JSON round-trip 不变量）+ `request-responses.unit.test.ts` +1 #189 case + 修标题 typo。**验证**：typecheck 0 + eslint openai-bridge 0 + openai-bridge unit 23 files/73 tests 全绿（9+1 新 + 63 不回归）+ pre-existing 5 failed 不增不减。**scope-out**：(a) 不动 §5.9 #186 嵌套 shape；(b) 不改 `stripSchemaDescriptions`（generic walker）；(c) 不抽 `request.ts`（chat_completions 唯一调用方 = tools.ts）。**版本流转**：未 commit → patch bump-on-commit。**follow-up**：(a) user 实测 web_search；(b) §5.9「嵌套 shape」vs #189「parameters 永远存在」= 两独立不变量。

#### TODO #187 — Windows 升级后内置 MCP 报「node 找不到」 ✅ 修法落地（升级路径彻底清旧 nodejs/）
**症状（v0.3.208）**：用户从 pre-v0.3.205 升级后，工具箱内置 MCP 启用时仍报 `node is not recognized` / throw `NpxMcpResolutionError`。
**根因**：pre-v0.3.205 老 installer 只 stage 部分 nodejs/（`node.exe` + 残缺 shim），**没拷 `npm.cmd` / `npx.cmd` / `node_modules/`**。NSIS Install Section 用 `File /a` 覆盖同名文件——**会覆盖** `node.exe` 但**不会补齐**新版本需要的缺失文件。升级后 tree 状态：`node.exe` = 新、`npm.cmd` / `npx.cmd` / `npx-cli.js` = **缺失**（File /a 对不存在文件 no-op）。启用 MCP → v0.3.207 shim-less resolver 找 npx-cli.js（缺失）→ fallback → 最终 throw `NpxMcpResolutionError`；前置路径命中 `npx.cmd` shim → cmd.exe 找不到 node.exe → "node is not recognized"。
**用户拍板**：「修复升级路径 + NSIS installer」。
**修法（3 文件）**：(1) `src-tauri/nsis/hooks.nsh` PREINSTALL macro 加 `RMDir /REBOOTOK "$INSTDIR\nodejs"` + 14 行注释（根因 / 为什么 File /a 补不齐 / /REBOOTOK 含义）；(2) `mcp-command.ts::NpxMcpResolutionError` message 加 actionable fallback 提示（"完全卸载再装"，给未装新 NSIS 的 user）；(3) `windows-release.yml` smoke test 新增 Assert 8/3：校验 `node_modules/npm/bin/npx-cli.js` 存在（v0.3.207 resolver 依赖项）—— 把"install-time nodejs/ 不完整"regression 在 CI 拦下。
**scope-out**：不重写 NSIS Install Section（RMDir + File /a 是最稳的清空重建）/ 不改 Tauri bundle.resources / 不改 resolveWindowsNodeNpxInvocation / 不改 download_nodejs.sh / 不为 error 加 UI 引导 / 不动 Assert 6/3 + 7/3（只新增 8/3）。
**验证**：typecheck 0；`mcp-command.unit.test.ts` 7/7（toThrow substring 匹配 — message 增后缀仍 pass）；全 unit 池 3095 passed + 5 pre-existing failed 不增不减；NSIS RMDir 语法是 Tauri 模板标准用法（template L1044 已用）；PowerShell Test-Path + throw 是既有 pattern。**实机验证需 Windows 真机**：装新 NSIS build 后升级应走通（RMDir 清 + File /a 重铺 → 全文件齐）。
**follow-up**：user 实测 (a) 全新装 / (b) 从 pre-v0.3.205 升级 / (c) Assert 8/3 在 CI 绿；RMDir 升级场景有 file lock 失败备选 = SetOutPath /REBOOTOK + 显式 Delete node_modules/*；fallback message 是给未装新 NSIS 的 user，新 NSIS 上线后频率降至近 0。

#### TODO #192 — mcp-command.ts 跨平台行为对齐 + `--yes` 长形式识别 ✅ DONE
**症状**：(a) POSIX fallback 末尾静默返 `<cwd>/npx`（`dirname('node')` = `'.'`）spawn ENOENT 无诊断；(b) `-y` 只认短形式 → argv 变 `npx -y --yes <pkg>` 噪声。**修法**（`mcp-command.ts` + 测试）：POSIX fallback 改 throw + error message 跨平台版 + `hasYes` 双形式识别 + 删未用 import。**测试** +2 case（`--yes` 长形式 / darwin throw）；改 1 case Windows throw substring。7/7 pass。**scope-out**：不改 Windows 路径（v0.3.207 正确）/ 不改 transform / codex 调用方（自动受益）/ 不动 agent-session.ts PATH 顺序（与 mcp-command 独立）。**验证**：typecheck 0；unit 池 3095 passed + baseline 不变。**follow-up**：user 实测 macOS Linux 无 Node 时抛 actionable error；`--yes` argv 仍出现查 `pinPresetMcpPackageVersions`。

#### TODO #190 — 主 Chat Claude Agent SDK WebFetch blocklist 跳过（in-process override）✅ DONE
**症状 + 真因**：desktop app 内 Claude Agent SDK 跑 WebFetch 工具"一直用不了" — SDK 0.3.201+ 默认启用 Anthropic WebFetch **blocklist** 检查（SSRF-defense / private IP / 疑似 TLD 规则），用户网络出不去 → HTTP 调用前 blocklist 报错退出。**用户拍板**：加 `skipWebFetchPreflight: true`（字段命名虽含"preflight"实际为 blocklist check，per SDK d.ts:7022-7025）。**修法**（per-query override，不写盘）：`src/server/agent-session.ts:10685` 主 Claude `query()` 的 `settings: {}` 加 `skipWebFetchPreflight: true` + 10 行注释（d.ts 行号 / 仅 in-process agent / 不动磁盘 / 辅助 query 故意保留默认）。**scope-out + 验证**：typecheck 0 + eslint 0 + (a) 不写 `.claude/settings.json`（SDK settings 已生效）；(b) 不改用户 `~/.claude/settings.json`（CLAUDE.md「不为非本仓库代码引入抽象」）；(c) 不动 4 辅助 query；(d) 不抽 reusable helper。**版本流转**：未 commit → user 拍板 commit 时机。**follow-up**：user 实测 + 跳过 blocklist 对安全边界影响（user 自己拍板承担）。

#### TODO #191 — 模型供应商 apikey 「每输入一个字触发检查」 ✅ 修法落地
**症状**：清空换新 key 时每 keystroke / 密码管理器逐字 fill 都触发 `cmd_probe_provider_network` + spinner + toast。**真因**：(a) `shouldDebounceAutoVerify` 只 catch 末尾 backspace，逐字 fill 中间态是「growing against 非空 prevKey」每字都 verify；(b) 500ms debounce 太短，键入 100-300ms/字时每次 setTimeout 覆盖前一次前 fire。
**用户拍板**：「min-length 阈值 + 拉长 debounce」。**修法（2 文件）**：(1) `apiKeyAutoVerify.ts` 加常量 `MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY = 8` + helper 分支 `prevKey !== '' && newKey.length < 8 → false`；(2) `SettingsPage.tsx` debounce 500→1200ms + `pendingKeyRef` + `flushPendingVerify(provider)` + input `onBlur` 立即 flush（不等静默期）；(3) 测试 +6 case（中间态 skip / 8 边界 verify / prevKey 空 + 短 newKey 仍 verify 兼容 custom relay）。**floor=8 而非 20** 原因：20 会破原 `'sk-1234'→'sk-12345'` / `'abXYef'` fixture；真"完整 key"门禁在 Rust network probe 不在 helper。**scope-out**：不抽通用 helper / 不改 `verifyProvider` / 不改 `verifyGenRef` / 不动 saveApiKey 写盘路径 / 不为密码管理器加专门 paste 探测（React state 层无法区分单 paste vs 逐字 paste）。**验证**：typecheck 0；`apiKeyAutoVerify.test.ts` 13/13；全 unit 池 3093 passed + 5 pre-existing failed 不增不减。**follow-up**：user 实测 (a) select-all 清空 + 单 paste 长 key blur 立即 verify；(b) pwmgr 逐字 fill 中间态不 verify；(c) 键入 8 字符后停顿 1200ms verify。floor 偏严再升 20 + 改 fixture。**版本流转**：未 commit → patch bump-on-commit。

#### TODO #185 — 工具箱默认 npx 工具在 Windows 打不开（bundled `nodejs/` 缺 `npx.cmd`）✅ DONE（根因 2 + MyAgents Win 策略复刻）
**触发**：用户报"工具箱里默认的工具在 windows 下使用 npx 安装的都打不开" + "windows 更新完还是那个问题 node is not recognized"。v1 落地（`275d80b`）修 `scripts/download_nodejs.sh::check_existing()`；实测仍 `node is not recognized`。**两个根因**：(a) Windows `npx.cmd` 是 one-line Node launcher，cmd.exe 解析要 `node` 在 PATH 上；Tauri 启动 Sidecar 不继承 login shell PATH 时直接失败。(b) `transformMcpServerForSpawn` 用 `buildMcpSubprocessEnv` 透传 raw `parentEnv.PATH`，而 prewarm 路径走 `getShellEnv()` 重建（bundled Node + `~/.hamuna/bin` + Git + NVM/fnm/volta + homebrew）—— SDK assembly / startup validator / runtime spawn 全走 raw parentEnv = 同一 npx 在不同路径能 / 不能启动。

**对照 MyAgents 调研**（2026-09-22 拍板）：MyAgents Win 策略**完全不用 .cmd shim**，`resolveNpxMcpInvocation` Win 分支返回 `{ command: node.exe, args: [node_modules/npm/bin/npx-cli.js, -y, ...] }`，npx-cli.js 是 npm 内置直接走 `node.exe`；我们原 Win 返回 `npx.cmd` 依赖 PATH 找 node = 脆弱链。

**修法**（4 文件 + 1 新测试）：(1) `src/server/utils/mcp-command.ts::resolveNpxMcpInvocation` Win 改走 `resolveWindowsNodeNpxInvocation`（找 node.exe + `node_modules/npm/bin/npx-cli.js`），POSX 保持直调；找不到完整 Node + npxCli 对时 throw `NpxMcpResolutionError`；**根本消除 .cmd shim 层**。(2) `src/server/mcp/mcp-server-transform.ts::env[pathKey] = getShellPath()` —— transform 与 prewarm 共享同一 PATH 重建（bundled Node 在 PATH 头部）；删 `1008c11` 的 npx-dir prepend；`env.PATH =` (uvx / macOS prepended) 改 `env[pathKey] =` 统一大小写防 Win `Path`/`PATH` 双键。(3) `src/server/index.ts:5183-5194` 删 prewarm 的 npx-dir prepend（`getShellEnv()` 已含 bundled Node）。(4) `src/server/utils/mcp-command.unit.test.ts` NEW 5 case：Win system/bundled/win-throw/POSX/`-y` 去重。

**测试**（全绿）：mcp-command 5/5 + mcp-server-transform 7/7 + mcp-startup-validator 11/11 + mcp-env-policy 5/5 不回归 + integration 43/43 (348 tests) + classification 206 server tests + typecheck 0 + eslint 0。**pre-existing 5 failed 不增不减**（analytics/theme×2/widgetSandbox/playwright-bash）。

**scope-out**：不删 `1008c11` 提交（同方向早期 attempt 留 git 历史）；不改 MyAgents `buildSessionExecutablePath` 整体搬迁（带 `~/.myagents/bin` 产品路径与我们 `~/.hamuna/bin` 不一致，只复刻模式 + 节点）；`buildMcpSubprocessEnv` 的 `if (parentEnv.PATH && env.PATH === undefined)` fallback 保留；`findPipInstalledUvxScriptsDir` / `agent-session.ts` uvx spawn 0 改动；不加 Win node shim 镜像（bundled node v24.19.0 npm CLI 已含 npx-cli.js，零新增资源）。

**版本流转**：patch bump-on-commit。**follow-up**：(a) 真实 Windows GUI 端到端验证（user 重装 v0.3.205）；(b) `agent-session.ts::buildSdkMcpServers` 是否也走 transform（已走 ✓）。

#### MyAgents `mcp-command.ts` 横向对比（2026-09-23 · #192 落地后调研）
**目的**：核对 MyAgents 的 `resolveNpxMcpInvocation` 是否比本仓更先进，是否需要反向同步。
**结论**：本仓 **#185 + #192 落地后** 已**领先** MyAgents resolver 函数实现；MyAgents 仅在打包层有可借鉴的统一入口。
**对照表**：

| 维度 | MyAgents (2026-09-23 read) | 本仓 (#185+#192 后) | 谁更对 |
|------|----------------------------|---------------------|--------|
| Win 优先级 | system → bundled → runtime-sibling | bundled → system → throw | **本仓**（bundled 优先：installer 保证完整 Node + npm 树） |
| Win npx 调用形态 | `node.exe + npx-cli.js` shim-less | `node.exe + npx-cli.js` shim-less | 一致 |
| POSIX npx 调用形态 | 直调 system npx | 直调 system npx | 一致 |
| POSIX 末尾兜底 | 静默返 `<cwd>/npx` (`dirname('node')`=`.`) → spawn ENOENT 无诊断 | throw `NpxMcpResolutionError` 带 actionable message | **本仓** |
| `-y` vs `--yes` 双形式识别 | 只 `-y` | `-y` + `--yes` 双识别 | **本仓** |
| `runtime-sibling` source 兜底 | 保留（MyAgents L160-166 Win + L185-190 POSIX） | 已删 | **本仓** |
| 配套统一入口 `buildMcpStdioLaunchConfig` | ✅ 含 PATH prepend + Windows 大小写归一化 + `buildMcpSubprocessEnv` | ❌ 散在 `index.ts:5170` + `mcp-server-transform.ts` + `codex.ts` | **MyAgents**（架构 pattern 值得借鉴，非 resolver 层面） |

**scope 决策**：
- **resolver 函数本体不反向同步 MyAgents**（已领先）
- **`buildMcpStdioLaunchConfig` 统一入口模式待 v2 借鉴**：本仓当前 MCP stdio spawn 三处（probe / warmup / runtime projection）各自拼 PATH + env，未来如出现 path-policy 漂移或 Windows 大小写问题，单一入口可消重复。**不在本任务范围**

#### TODO #183 / #184 / #158-161 / #162 — hamuna-writing / nxgd wizard 5 段 / provider 默认隐藏 ✅ DONE
（落地详见 §4 git log + 各 commit hash。**关键 pit-of-success**（#159）：wizard 语义 = "用户**看过**"，verifyStatus = "upstream **验证过**"，把 cache 当用户配置 = 经典错位；删 gate verifyStatus 短路，唯一权威 = dismissedAt。）

#### TODO #162 — 模型供应商默认隐藏除广电外预设（默认 disabled，Settings 可启用）🔄
**触发**：user 原话「模型供应商默认隐藏除了广电之外的预设供应商」，clarification「启用和排序默认禁用非广电之外的供应商就行，已经有这个功能了都」= 复用既有 `AppConfig.disabledProviderIds` 字段（Settings → ProviderEnableOrderDialog 已能 toggle），不在 PRESET_PROVIDERS 字面量标 `enabled:false`、不引入 config-version、不为老用户反向 migration。**改动 2 文件**（+5 -0）：(1) `src/shared/config-types.ts` `DEFAULT_CONFIG` 末尾加 `disabledProviderIds: PRESET_PROVIDERS.map(p => p.id).filter(id => id !== NXGD_PROVIDER_ID)` —— **派生而非硬编码 18 个 id**，加新预设时自动包含，避免 drift。`applyProviderEnablementAndOrder` 已用 `disabledProviderIds` 派生 `provider.enabled`，逻辑零改动；`loadAppConfig` 浅 merge `{...DEFAULT_CONFIG, ...migrated}` 自动处理磁盘字段存在 vs 缺失。(2) `src/shared/config-types.test.ts` +1 describe 段 5 case：DEFAULT_CONFIG 长度=18 不含 nxgd；默认派生下 18 个非 nxgd disabled + nxgd enabled；磁盘 `disabledProviderIds:[]` 覆盖默认（全 enabled）；磁盘 `disabledProviderIds:[someId]` 仅该 id disabled。**设计取舍 — 不在 PRESET_PROVIDERS 字面量加 enabled:false**：单一真相源；line 270 "nextEnabled && provider.enabled===undefined 不写回" 优化会被字面量 false 干扰。**scope-out**：(a) ProviderEnableOrderDialog UI 不动；(b) `applyProviderEnablementAndOrder` 不动；(c) SettingsPage 写盘逻辑不动；(d) providerService / admin-config 派生不动；(e) Rust 端 `serde_json::Value` 透传新字段；(f) 老用户 `disabledProviderIds:[]` 磁盘显式保留(尊重用户决定)；(g) 不为「provider 全默认 enabled」和「provider 字面量 disabled」两条规则并存——by-construction 仅一条。**验证**（全绿）：`npm run typecheck` 0 errors；`npx vitest run --project unit src/shared/config-types.test.ts` 49/49（含新 5 case）；`providerEnablement.test.ts` 3/3 + `providerService.test.ts` 6/6 + `nxgd-auth.unit.test.ts` 20/20 全绿；`npm run test:unit` 3057 passed + 5 pre-existing failed(themeArchitecture 2 + widgetSandboxHtml 1 + playwright-bash-redirect 1 + eventRegistry 1，baseline stash 验证同样 5 failed，与本次改动无关)。**验收红线**：新装 Chat 模型下拉只剩「广电 (云广智能)」；Settings → 启用和排序对话框 显示 19 行 nxgd enabled + 18 disabled；toggle 保存 → Chat 即时反映；重启 → 保留 toggle。**版本流转**：patch bump-on-commit（与 wizard 同期）。

#### TODO #163 — nxgd: 删除 ConfigProvider auto-discovery + wizard step 2 改 pin 1 model ✅ DONE
**触发**：user 拍板「可用模型默认为 [], 向导启动时选择一个加入到可用模型」—— `PRESET_PROVIDERS[nxgd].models = []` 是终态，wizard 关闭时通过 `presetCustomModels[nxgd]` pin user 选的 1 个 model 进 Chat 下拉；后续 user 走 Settings → Model Management 加更多走既有 `savePresetCustomModels` 路径。**改动 5 文件**（+69 -15）：(1) `src/renderer/config/ConfigProvider.tsx` 删 `nxgdDiscoveredModels` state + `withNxgdDiscoveredModels` 调用 + 老 useEffect（auto-fetch `/api/nxgd/models` 灌 discoveredModels）；**替换** useEffect 改成 mount 时调 `/api/nxgd/auth/state` → `registered===true` 时 stamp `verifyStatus[nxgd]='valid'` —— verifyStatus 信号源从「auto-discovery 200」迁到「registration 完成」（server 端 `preloadNxgdAuth` 已 module-level 缓存，cheap）。(2) `src/renderer/config/services/nxgdSubscriptionService.ts` 新增 `getNxgdAuthState()` 薄壳，调 `/api/nxgd/auth/state`（server endpoint 已存在，复用 `getNxgdAuthState()` 函数）— `discoverNxgdModels` 保留，wizard 内部用。(3) `src/renderer/components/NxgdOnboardingWizard.tsx` 新 prop `onPinModel?: (id, displayName?) => Promise<void>`；step 2 重构——`useEffect` 在展开时自 fetch `discoverNxgdModels()` 拿候选列表，候选列表 radio 渲染（多 card），discovery 失败 fallback 到 `[primaryModel]` 单选仍可推进；`closeAndMarkSetup` 在写 setup 前 fire-and-forget `onPinModel(pickedModelId)`（失败不阻塞 wizard 关闭）。(4) `src/renderer/App.tsx` 解构加 `savePresetCustomModels`，新增 `pinNxgdModel` useCallback 写 `presetCustomModels[nxgd]` 1 项；传 `onPinModel={pinNxgdModel}` 给 wizard。(5) `src/renderer/i18n/locales/{zh-CN,en-US}/app.json` step2 加 `loading` key（中/英各 1 行）。**关键设计取舍 — 不动 `isProviderAvailable` 的 verifyStatus gate**：nxgd 是 subscription provider (line 284 `providerService.ts`)，`isProviderAvailable` 对 subscription 强制 gate 在 `verifyStatus[id].status==='valid'`。如果删 useEffect 后**完全**不 stamp verifyStatus → nxgd 永远 unavailable → 选 model 也无用。**新 mount-time useEffect 改读 `/api/nxgd/auth/state`**（server 端已经 preload 完），`registered===true` 即 stamp——保留 verifyStatus gate 语义不变，stamp 触发点从「user 看不到的 mount-time」迁移到「与 registration 真实完成挂钩」更准。**关键 grlling — `source: 'manual'` 而非 `preset-pinned`**：`ModelEntity.source` 联合类型只有 `'preset' | 'discovered' | 'manual'`（`shared/config-types.ts:81`），`mergePresetCustomModels` 语义 `manual` entries = user-authored 显式 override（curated preset 字段不覆盖 user 填的）—— 与 wizard pin 语义完全匹配。**`onPinModel` fire-and-forget 而非 await**：避免 wizard 关闭阻塞在磁盘 IO；presetCustomModels 写盘失败时 Chat 仍能显示 primaryModel（`provider.primaryModel` 不依赖 `models[]`），下次 refresh / Settings 修改自然恢复。**scope-out**：(a) 不删 `withNxgdDiscoveredModels` 函数定义与单测（CLAUDE.md 「不删除改动前已经存在的死代码，除非用户明确要求」）；(b) 不改 `isProviderAvailable` / `providerVerifyStatus` 字段语义；(c) 不改 `mergePresetCustomModels` 逻辑；(d) 不动 `/api/nxgd/auth/state` server endpoint；(e) 不动 server 端 `nxgd-auth.ts` 的 verifyStatus 持久化（`providerVerifyStatus` 是 renderer-only state，不写 server disk）；(f) Model Management 里 nxgd add custom model 走既有路径（`savePresetCustomModels` 已存在），无需新增 UI；(g) 「用户选 model 后必须重 mount ConfigProvider 才生效」问题 — `savePresetCustomModels` 写盘后 `setConfig(newConfig)`（ConfigProvider line 1039）触发 re-render，`useMemo` providers 重算，`provider.models` 立即含 selected——零延迟。**测试**（全绿）：`npx vitest run --project dom src/renderer/components/NxgdOnboardingWizard.test.tsx` 20/20（旧 15 步 2 click 改成 `wizard.step2.cta` + 5 新 case：discovery N 卡渲染 / discovery 失败 fallback primaryModel 单选 / 选非默认触发 onPinModel with displayName / 默认选触发 onPinModel with primaryModel / onPinModel 缺失不抛）；`npx vitest run --project dom src/renderer/config/ConfigProvider.managedCodex.test.tsx` 1/1；`npm run typecheck` 0 errors（pre-existing `platform is deprecated` / `imBotConfigs is deprecated` 不相关）。**验收红线**：新装 Chat 默认 models:[] → wizard 选 `deepseek-v4-flash-0731` → close → presetCustomModels[nxgd] 写 1 项 → Chat 下拉显示该 model 可选；Settings → Model Management 可手动加更多 model；discovery 失败 wizard step 2 仍显示 primaryModel 单选不卡死；onPinModel 缺失不抛；wizard 关闭任意路径（Esc / X / 稍后 / step 5）都触发 pin。**版本流转**：patch bump-on-commit（与 wizard 同期）。

#### Sub-fix — wizard step 2 列表 max-h + scrollbar：TODO #163 上线后用户报「上游 N 模型时 step 2 候选列表撑爆 wizard 卡片」。**改动 1 文件 + 1 测试 case**：(1) `NxgdOnboardingWizard.tsx` 列表容器 `<div className="flex flex-col gap-2">` → `<div ref={candidatesScrollRef} className="flex max-h-72 flex-col gap-2 overflow-y-auto">`；每个 card button 加 `ref={(el) => { candidateCardRefs.current.set(candidate.id, el); }}`；新增 `useEffect`：`step===2 && pickedModelId 变化时 scrollIntoView({ block: 'nearest', behavior: 'smooth' })` 保持选中视觉边框可见。(2) `NxgdOnboardingWizard.test.tsx` 顶部加 `Element.prototype.scrollIntoView = function noop(){}`（jsdom 不实现该方法；测试只验证 effect 不抛、不验证滚动结果）；新增 case「discovery 返 3 model → 列表容器 className 含 `max-h-72` + `overflow-y-auto`」。**grlling — 没在 production code 加 `typeof card.scrollIntoView === 'function'` guard**：测试驱动会让 prod code 写防御代码遮蔽真实 bug；正确做法是测试环境 polyfill jsdom 缺失 API，prod code 假设 DOM 完整即可。**scope-out**：(a) 不改 max-h 数值（`max-h-72` = 18rem ≈ 288px ≈ 4-5 个 card，匹配 step 2 wizard 卡片总高 ≤ 480px 的约束）；(b) 不动 `closeAndMarkSetup`；(c) 不动 `scrollIntoView` 的 `{ block, behavior }` 参数（`block: 'nearest'` 已视口内不动、`behavior: 'smooth'` 与 step 间 200ms opacity 节奏对齐）。**验证**（全绿）：`npm run typecheck` 0 errors；`npx vitest run --project dom src/renderer/components/NxgdOnboardingWizard.test.tsx` 21/21（其中新 case `discovery 返多 model → 列表容器 max-h + overflow-y-auto，避免 N 多时撑爆 wizard`）。

#### TODO #157 — nxgd `/api/nxgd/models` 路由从未注册（hidden 404 bug）✅ DONE

#### TODO #147 — nxgd `parseModelsResponse` 不识别顶层数组（永远返 `[]`）✅ DONE
**触发**：用户报"事实上目前广电卡片获取可用模型一直为空"。server 端 live 验证 (`scripts/test-nxgd-fetch-models-live.mjs`) 显示 `/v1/models` 200 + 1 model 正常，**根因在 renderer 端 parser 契约 gap**：`src/renderer/config/services/nxgdSubscriptionService.ts:24` `discoverNxgdModels()` server envelope `{ models: [...], checkedAt }` 解构后把 **`resp.models` 数组** 直接喂给 `parseModelsResponse`；但 `modelDiscoveryService.ts::parseModelsResponse` 只识别 wrapper 对象（Format A OpenAI `{ object:"list", data:[...] }` / Format B Anthropic `{ data:[...] }`），**不识别顶层数组** → 永远返 `[]` → Model Management 面板"Discover Models"区渲染空。**修复**（NEW `src/renderer/config/services/modelDiscoveryService.test.ts` 5 case + parser 加 Format C 分支 `Array.isArray(body) ? rawModels = body`）：覆盖顶层数组（nxgd unwrap 后）/ OpenAI wrapper（grok）/ Anthropic wrapper（fetchProviderModels）/ `null`+`undefined`+`{}`+未知 shape（不抛）/ `status:'Shutdown'` 过滤。**nxgd-auth.unit.test 16/16 不回归**（server 侧 0 改动）。2 文件 / +50 -1，`npm run typecheck` 0 errors + `test:unit` 5/5 新 + 16/16 nxgd-auth + `eslint` 0 errors。**scope-out**：Model Management Panel 顶部"Active Models"显示的是 `provider.models`（preset `ANTHROPIC_MODELS` 7 个 Claude model）— 这块永远非空与本 bug 无关不动；真实 dev 模式 UI 验证（Settings → 广电 → 管理模型 → 看 Discover 列表）留 user 实操。**版本流转**：未 commit → patch bump-on-commit。

#### TODO #144 — 中国广电 Token 平台（`nxgd` provider）内置首选模型供应商 ✅ DONE
（落地详见 §0 narrative + commits：6 NEW + 7 EDIT，~1280 行覆盖 12 文件 + 1 plan。**关键架构**：复用 Anthropic provider 链路（`apiProtocol='anthropic'` + `ANTHROPIC_BASE_URL=https://ai-models.cloudwasu.cn` + server 端 `getNxgdApiKey()` 注入 `ANTHROPIC_API_KEY`，Claude Agent SDK 调 `/v1/messages` 原生协议，**零新增 SDK shim**）；新 `SubscriptionAuthPolicy` kind `host-managed-auto-register`（机器码驱动，无 UI 登录）；`NXGD_PROVIDER_ID='nxgd'` 插 `PRESET_PROVIDERS[0]`，enabled 默认 true，不动 anthropic-sub/codex-sub；server-preload pattern（`preloadNxgdAuth()` 启动 sync 读 `~/.hamuna/nxgd-auth.json` 填 cache + 后台 fire-and-forget `ensureRegistered()`）+ in-flight promise 复用 + balance 1h TTL 缓存防 5/60s IP 限流；`SubscriptionAuthPolicy` 联合 + `isBuiltinSubscriptionProviderId()` 守卫扩 1 kind；设备身份改造（`compute_hardware_fingerprint()` = MAC + host_name + platform → SHA256 → 前 16 hex，3 内联 test 全绿）。**4 server endpoint**：`/api/nxgd/{auth/state,auth/refresh,balance,recharge}` + `ensureRegistered` 未完成返 503。**renderer 端**：`NxgdSubscriptionProvider` Settings 卡片（5 状态徽章 + **只保留「刷新余额」按钮** — API key 机器码自动注册写盘，user 不输入，无重注册入口；详见 `aa281f3` refactor 把「刷新连接」+「充值」按钮从卡片移除，net -76 行）+ `NxgdRechargeModal` Chat 余额不足弹窗（dismissable + Esc + 不挡 Cmd+W/F5）+ `useNxgdBalanceGuard` hook + `NxgdRechargeForm` 共用表单子组件（金额预设 10/30/50/100/200 + 自定义 + iframe after submit，sandbox="allow-forms allow-scripts allow-same-origin"）；Chat.tsx `handleSendMessage` 前置 balance check（low balance → 阻断 send + 弹 modal）；4 i18n locale 加 `providers.nxgd.{description,status.*,balance.*,recharge.*}` + `nxgd.modal.{title,subtitle}`。**测试全绿**：11 unit（`nxgd-auth.unit.test.ts` 用 `process.env.HOME` override + real fs，无 mock 漂移）+ 4 dom（`NxgdSubscriptionProvider.test.tsx` — 卡片测试改 4 case：绿章余额显示 / 红章低余额标记 / registering 状态 / 刷新按钮契约——验按钮重 fetch `/api/nxgd/balance` 并渲染新金额，不再验 iframe DOM 渲染——jsdom iframe srcDoc 不可靠）+ 3 Rust inline test（hardware_fingerprint_is_16_hex_chars / hardware_fingerprint_is_stable_across_calls / hex_encode_round_trip）。**意外副作用**：`src/shared/config-types.test.ts > "inserts the provider after Anthropic subscription in the default catalogue"` 期望与新位置冲突 → 改测试期望 `['nxgd', SUBSCRIPTION_PROVIDER_ID, CODEX_SUBSCRIPTION_PROVIDER_ID, XAI_SUBSCRIPTION_PROVIDER_ID]`（实质调整 catalog 顺序契约）。**typecheck 0 errors**。**scope-out**：退款/订单取消/多账户/跨设备迁移（code 换就新账号）；Chat 内嵌 iframe 直接做支付（独立 modal）；充值订单状态轮询（依赖用户主动「我已支付」+ 余额刷新）。**后续 follow-up**：(a) 真实 dev 模式端到端验证（自动注册 + 充值 iframe 渲染 + 余额 < 5 modal 触发）；(b) `handleSendMessage` 前置 balance check 的 UX 加 loading 反馈；(c) 硬件 fingerprint 三平台真机验证（macOS/Windows/Linux cfg 分支 + sysfs/IOKit 路径）。

#### TODO #130 — `windows-release.yml` beforeBuildCommand 冗余去重 🔄
**触发**(TODO #129 副产物):复查 `npx tauri build --config src-tauri\tauri.windows.conf.json` (step 19) 触发 Tauri CLI 的 `beforeBuildCommand` 行为 → WebFetch Tauri 2 docs 确认 `--config` 走 **merge 语义**(未指定字段沿用默认 `tauri.conf.json`)→ 实读 `tauri.conf.json:10` `beforeBuildCommand = "node scripts/ensure_cuse_stub.mjs && npm run build:web && npm run build:server && npm run build:bridge && npm run build:cli"` + `tauri.windows.conf.json` 18 行无 `beforeBuildCommand` 字段 → **确认冗余**:step 19 Tauri build 内部又跑一次 build:web/server/bridge/cli,与 step 12 (`Build server / bridge / cli` = build:server + build:bridge + build:cli) + step 16 (`Build frontend` = build:web) 重复 → 实测估约 ~2m 浪费/run。**用户拍板**:暂不动 (#129 cache 落地后下次发版观察新瓶颈分布,再做去重决策 — 单独去重可能撞 cache miss 反而变慢,且需先验证 #129 cache hit 命准率)。**后续**:若 #129 cache 命中稳定且仍有冗余 → 选项 (a) 在 `tauri.windows.conf.json` 显式声明 `build: { beforeBuildCommand: "" }` 屏蔽 merge 继承;选项 (b) 改 `tauri.conf.json` 拆 `beforeDevCommand` 与 `beforeBuildCommand` 给 CI override 留钩子。**风险**:Tauri merge 语义对 `null`/`""` 值是否真覆盖(空字符串可能在某些 schema 校验失败,需先 dry-run 验证)。

#### TODO #129 — windows-release.yml `npm ci` 缓存 (`actions/setup-node@v4` `cache: 'npm'`) ✅ DONE
**触发**:v0.3.146 release run 2026-09-10 实测时间线显示 `npm ci` cold 占 ~8.4% (2m51s/34m),位居第三大瓶颈。前两瓶颈 cargo release (17m5s) + NSIS bundling (6m11s) 是物理下限不可压 → npm ci 是非物理瓶颈中最大可优化项。**改动 1 文件**（+5 -0）：`.github/workflows/windows-release.yml` step 4 `Setup Node.js 24` 加 `cache: 'npm'` 参数。`actions/setup-node@v4` 默认 cache key 派生自 `package-lock.json` hash → 首次 release cache miss (cold),后续 release cache hit → `npm ci` 2m51s → 几秒级。**独立于已有 Swatinem/rust-cache@v2**（不同 store,互不影响）。**scope 决策**：只改 `windows-release.yml`（workflow_dispatch,手动 release 烧,优化收益只在此处见效）;不动 `test.yml`（ubuntu-latest + npm install 走 Linux 路径,cache 行为独立,且 PR 周期引入新 cache miss cost 风险）。**用户拍板**：只动 A（npm cache），不动 B（beforeBuildCommand 去重）— **B 留 #130 follow-up**。**版本流转**：0.3.149（bump-on-commit 自动 patch）。

#### TODO #122 — bundled uv 0.5.11 → 0.11.33 重 pin ✅ DONE
（落地详见 §4 `4812fbe` commit，跨 minor 拿稳定性 fix，mcp.json `--from` 语法未踩 0.12+ 收紧线）。**后续 follow-up**：`download_uv.ps1` 默认 pin `0.11.33` 字符串字面量（`$Version = "0.11.33"`，原 `$Version = 0.11.33` 是裸数字字面量 → PowerShell 把 `0.11` 当 decimal + `.33` 当属性访问静默 `$null`，CI 跑 `-Force` 撞「GitHub response missing tag_name」）→ **TODO #125 落地 + 数据修正 commit `66c2dee`** 替换 0.12.3 uvx.exe + `.uv-version`。

#### TODO #123 — getBundledUvPath 探测链补 ~/.hamuna/bin/ uvx.exe ✅ DONE
（落地详见 §4 `c58e0f3` commit，B 方案扩 slot 3 = `~/.hamuna/bin/uvx.exe`，runtime unit 7/7 通过；`72ca789 uvx` 是 bump-on-commit 自动 patch 的衍生 commit）。**后续**：TODO #121 pip-only 落地后整个 `getBundledUvPath` 链删除（4 探针全废），slot 3 `~/.hamuna/bin/` 拷贝路径 `seedBundledUvToHamunaBin` 也删；uvx spawn 走 `findPipInstalledUvxScriptsDir()` probe + 系统 PATH。

#### TODO #124 — extended builtin MCP 默认 vendor 命令/参数在 Settings UI 不暴露（hidesDefaultArgs 字段）✅ DONE
（落地详见 §4 commit，27/27 单测通过；9 文件改动：`McpServerDefinition.hidesDefaultArgs?: boolean` + `coerceServer()` 严格 `=== true` 解析 + `extended_buildin_mcp/mcp.json` 3 entry 显式 `true` + ToolboxSection 条件显示 + SettingsPage builtin dialog placeholder + 中英文 i18n 各 1 key + parser 单测 4 新 case）。**关键决策**：统一 metadata 字段而非 id 白名单 / 严格 `=== true` 防 poisoned bundle / 仅影响 UI 显示不影响 spawn / http/sse 也支持 / 不新增独立 page 复用 builtin dialog。

#### TODO #125 — `download_uv.ps1` 默认 pin 字符串字面量 + 锁版本 rationale ✅ DONE
（落地详见 §4 commit，2 文件改动：line 99-117 删 GitHub API 调用 + 替换为字符串字面量 `$Version = "0.11.33"` + 详细注释 pin rationale + 不 auto-track 原因 + 裸数字字面量 bug 复述）。**后续 follow-up（同时落地）**：CI 实际跑的 uvx.exe 是 0.12.3 而非 0.11.33（pin 修复之前累积的 stale binary），数据修正 commit `66c2dee` 手动下载 0.11.33（SHA256 `c253ce86...`）+ 替换 `src-tauri/resources/{uvx.exe,.uv-version}`。

#### TODO #126 — install-time `pip install uv` 缺版本 pin（PyPI latest 0.12.12 会破坏 mcp.json `--from`）✅ DONE
**触发**：grlling 查 `bundleduvpath` 时发现 commit `9732280`（TODO #121 pip-only 落地）的 `installer.nsi:770` 用 `pip install --upgrade uv` 不 pin 版本。PyPI 当前 latest = uv 0.12.12（2026-09-09 发布），新装机器会装 0.12.12 → 撞 `197837b / 4812fbe / 37a7f21`（TODO #122 #125）"0.12.x 收紧 `uvx --from` 解析会破坏 mcp.json `multimedia-creator` spawn" rationale chain。bundled 退路（`src-tauri/resources/uvx.exe` + `~/.hamuna/bin/uvx.exe` slot 3）已被 TODO #121 `git rm` 砍，新装机器无 fallback 必须靠 install-time 阻击。**改动 2 文件**（+12 -1）：(1) `src-tauri/nsis/installer.nsi:770` `pip install --upgrade uv` → `pip install --upgrade uv==0.11.33` + 11 行注释记录 pin rationale + cross-link 3 个 commit；(2) `extended_buildin_mcp/mcp.json:41` description 删 `scripts/download_uv.ps1` + `src-tauri/resources/.uv-version` 两条已废引用 drift + 改写为真实 pip-only 链路（NSIS Section UvxFallback + `uvx-path-setup.ps1` + `findPipInstalledUvxScriptsDir`）。**rationale chain 完整性**：pin 0.11.33 与 TODO #122 / #125 一致；rationale 文字从 commit message 落到 NSIS 注释 + mcp.json description 两处可见位置。**已知风险（未验证）**：(a) 0.12+ `--from` 收紧是否在 0.12.12 仍存在（WebFetch 0.12.3-0.12.12 release notes 无条目，0.12.0-0.12.2 截掉未取，rationale 可能基于早期版本已修或误传）；(b) 清华源 0.11.33 mirror 同步延迟。下次 Windows 真实 install 跑 multimedia-creator spawn 验证 → **TODO #127 烟测即补此闭环**。

#### TODO #127 — windows-release.yml 加 install-time smoke test ✅ DONE
**触发**：TODO #126 pin 0.11.33 后整条 rationale chain (`197837b / 4812fbe / 37a7f21 / 9732280 / a906d2b`) 完全没有 CI 烟测兜底 — `windows-release.yml` build 只产 `.exe`,install-time 任何 regression（Tsinghua mirror 拦 runner IP / 拼写错误 / PEP 370 路径漂移 / 0.12+ `--from` 收紧首次真发生）只会**真实用户双击 installer 时才发现**。**改动 1 文件**（+108 -0）：`.github/workflows/windows-release.yml` 在 "Create portable ZIP" (step 19) 之后、"Install rclone" (step 21) 之前插新 step 20,共 5 段断言：(1) `Start-Process .exe /S /D=C:\HamunaAgent-Test` 静默装 NSIS installer;(2) Python 3.12 落到 `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`;(3) `pip show uv` 版本严格 = `0.11.33`;(4) `uvx.exe` 落在 `%APPDATA%\Roaming\Python\Python312\Scripts\` 或 `%LOCALAPPDATA%\Programs\Python\Python312\Scripts\` 两条候选 dir 之一(`findPipInstalledUvxScriptsDir` 探针同源);(5) `HKCU\Environment\Path` 含 Scripts dir(`uvx-path-setup.ps1` 注册);(6) **关键 smoke** `uvx --from agnes-video-25-mcp==0.1.6 agnes-video-25-mcp --help` exit 0(用 dummy `AGNES_API_KEY` 避免 hit 真实 API,只验证 uvx 能解析 + bootstrap wheel)→ 这条若挂 = rationale chain 首次硬证据,`throw` 中断 release 阻止坏 .exe 上 R2;最后 `Uninstall.exe /S` 清理。**scope 决策**: 只加 `windows-release.yml` (`workflow_dispatch`, 5min 加时, 仅 release 烧, 不进 PR 周期);不加 `test.yml` (ubuntu-latest 不构建 Windows, 重复无价值, 5min 进 PR 周期是浪费)。**失败语义**: 任一断言 throw → step fail → workflow fail → **R2 upload 不跑**(step 21 后续全断),用户拿不到坏 .exe。**Egress**: runner internet 拉 `pypi.tuna.tsinghua.edu.cn`(清华源, 美国 IP 偶 throttle)+ `pypi.org`(smoke 阶段, dummy key);runner 是 ephemeral VM,装完即销毁。

#### TODO #128 — pip mirror 清华源 2026-09-10 timeout, 切阿里源 + PyPI fallback ✅ DONE
**触发**：用户报清华源 `https://pypi.tuna.tsinghua.edu.cn/simple` 2026-09-10 在 fresh install 时 timeout(commit `9732280` rationale chain 之一 = "避开 GitHub release 大陆被墙" 撞新墙)。单一 mirror = 单点依赖(197837b 已栽过),**必须**带 fallback。**改动 2 文件**（+15 -2）：(1) `src-tauri/nsis/installer.nsi:781` `pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple` → 主源 `https://mirrors.aliyun.com/pypi/simple/`(南方/电信用户体验好) + `${If} $1 != 0` 失败分支 ExecWait fallback `https://pypi.org/simple`(PyPI 官方) + 13 行注释说明切换 rationale + 显式 "DO NOT fall back to Tsinghua" 提醒(避免后人无脑加回);(2) `extended_buildin_mcp/mcp.json:41` description 改写 mirror 段(清华源引用 → 阿里主 + PyPI fallback + cross-link TODO #128)。**已 #127 烟测兜底**：TODO #127 smoke test step 5 `uvx --from` 验证不依赖 install-time 走哪个 mirror,只要 uvx 装上即 pass;下次发版 workflow 自动验证新 mirror chain;若阿里源也挂 → step 5 跑前 throw → R2 upload 不跑,坏 .exe 不出仓。**未引入新设计**：mirror chain 已经是单点 fallback 的标准模式,无新抽象;无新依赖。**未验证**：(a) 阿里源 0.11.33 同步延迟(2026-09-10 时距发布已 1 天,应已同步, 但首次发版要观察 #127 step 5 通过);(b) 阿里源从 GitHub Actions 美国 IP 拉的时延(应该 < 100ms, 比清华源强);(c) PyPI 官方源对大陆用户的可达性(理论上不被墙, 但 #127 烟测在美国 IP 跑, 真实大陆用户体验要等用户反馈)。**版本流转**: 0.3.147 (bump-on-commit 自动 patch)。

#### TODO #121 — Windows install: bundled MCP auto-merge + uvx PATH 闭环 ✅ DONE（pip-only 落地）
**原方案**（A 路径）：auto-merge bundled MCP + bundled uvx 拷 `~/.hamuna/bin/`。**用户二次拍板**：改 pip-only —— 移除 bundled uvx.exe（`tauri.conf.json` + `tauri.windows.conf.json` bundle.resources + `.github/workflows/windows-release.yml` Download uvx step + `git rm src-tauri/resources/{uvx.exe,.uv-version}`）+ NSIS `Section UvxFallback` 改为无条件 `pip install --user --index-url https://mirrors.aliyun.com/pypi/simple/ --upgrade uv==0.11.33`（阿里源，避开 GitHub release 大陆被墙；TODO #126 pin + TODO #128 mirror）+ 新增 `src-tauri/nsis/uvx-path-setup.ps1`（写 HKCU\Environment\Path + WM_SETTINGCHANGE 广播）+ `tauri.windows.conf.json` 平铺到 `$INSTDIR\` + `src/server/utils/runtime.ts::findPipInstalledUvxScriptsDir()` Windows probe + 删除 `src/server/utils/runtime.ts::getBundledUvPath/getUserHomeBinUvxPath` + `mcp-bundled-seed.ts::seedBundledUvToHamunaBin` + 2 个 unit test 文件 + `index.ts` import/调用 + `agent-session.ts` uvx spawn 块改调新 helper。**pip-only vs bundled 决策依据**：(1) `download_uv.ps1` 修字符串字面量后仍走 GitHub release → 中国大陆下载不稳；(2) `uv` PyPI 包内含 `uvx` trampoline → pip install uv 一次解决；(3) PEP 370 per-user pip install 不自动加 PATH → `uvx-path-setup.ps1` 补齐 HKCU 持久化；(4) install 体积减 48 MB。**auto-merge 部分保留**（TODO #121 原方案的 mcp-bundled-seed.ts::seedBundledExtendedMcpServers 仍跑），只废 uvx 拷贝段。**遗留**：scripts/download_uv.ps1 保留 dev box 参考但 CI 不调（注释标 DEPRECATED 提醒）。

#### TODO #108 — creative-video-suite: 视频时长边界单源化（`seconds` 4-12 字符串，硬约束）✅ DONE
（落地详见 §5.7 narrative + 10 文件改动：`agnes-ai-api.md §视频时长边界（单一权威 · 2026-09-09 加）` + 9 个 ref 全部 cross-link；dual constraint 4 下限 / 12 上限 / 9 合法值字符串集合；drama 90→72 残留修复；gate 11→12；T13 footnote 显式豁免）。

#### TODO #111 — hamuna_helper: 跨服务 MCP 工具路由 · agnes-video-25（ADMIN_AGENT_VERSION 24→25）✅ DONE
（落地详见 §0 narrative + commits `931f5ef` feat + `7ff921f` chore）

#### TODO #112 — 已安装 desktop 应用文件路径全集审计 ✅ DONE
（落地详见 §2.3 + `specs/tech_docs/install_paths.md` + commit `0a6d583`；216 行新文件 10 节）。**遗留**：(a) `specs/CLAUDE.md` 必读清单加 install_paths.md 一行 — TODO 已知，独立 commit 补；(b) 跨语言 sync check lint（path-safety.ts vs commands.rs）暂未实现 — PRD 0.2.15 §7.2 已有 TODO，独立 PR；(c) snapshot §2.3 + install_paths.md 双写风险 — 无 lint 拦截

#### TODO #113 — multimedia-creator MCP: auto-bump pin on every commit ✅ DONE
（落地详见 `extended_buildin_mcp/mcp.json` + `scripts/bump-on-commit.mjs`）

#### TODO #114 — creative-video-suite: video 阶段轮询 + 串行 + project.json 状态机同步 ✅ DONE
#### TODO #115 — working tree 残留 4 个 version 文件 + SYSTEM_SKILLS_VERSION 未 bump ✅ DONE
#### TODO #116 — bump-on-commit.mjs: SKILL frontmatter version auto-bump ✅ DONE
#### TODO #117 — creative-video-suite: 单 segment 视频生成前拆分资产清单 + required_assets 全 ready 硬门控 + recipe 三件套必填 ✅ DONE
#### TODO #118 — creative-video-suite: 分镜设计 JSON schema（storyboard 生产侧权威） ✅ DONE
#### TODO #119 — creative-video-suite: video_generate 强制默认 model="agnes-video-2.5-flash" 锁死 ✅ DONE
#### TODO #120 — creative-ad-director: 抖音/创意广告 5 阶段 SKILL ✅ DONE

#### TODO #131 — agnes-video-25 v0.1.7：`_coerce_image_paths_input` helper（user 拍板 trade-off）✅ DONE
**触发**：用户报 `mcp__multimedia-creator__agnes25_image_generate` 的 `image_paths` 数组"含中文路径 + 长度 3 时 7/7 失败 + 被序列化为 `{item: [...]}` dict 触发 Pydantic validation error"。grlling 揭示报告与事实 4 处矛盾（报告长度 3 vs 实际数据长度 2 / JSON 本身合法 / 无 Pydantic error 原文 / 无调用方信息）。用户拍板 "现状直接 commit + publish，承担权衡"，绕过 grillng 接受 trade-off 修复。**改动 4 文件**（+198 -6）：(1) `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` 抽 helper `_coerce_image_paths_input(value)` 处理 `list[str] | dict | None` → `list[str] | None`（`{"item":[...]}` 解包 + `{key:[list]}` 单键解包 + 其它原样返回），`_image_generate_impl` 入口调它；(2) `hosted_mcps/agnes-video-25/pyproject.toml` 0.1.6 → 0.1.7；(3) `hosted_mcps/agnes-video-25/CHANGELOG.md` 新增 `[0.1.7]` 段（trade-off 已知风险完整记录）+ **retroactive** `[0.1.6]` 段（§3.2 P3 Step 3 当时漏写，content 重建自 commit `d2403e6` multi-key cooldown state 持久化 + 30s 窗口 reason split）；(4) `hosted_mcps/agnes-video-25/tests/test_image_paths_dict_tolerance.py` 新增 10/10 self-check 覆盖 helper。**PyPI 发布**：`uv build` + `twine upload --repository pypi`（`uv publish` 走 trusted publishing 失败，twine 走 `~/.pypirc` token）。**verify**：`pip install --dry-run agnes-video-25-mcp==0.1.7` + sha256 比对（本地 `e80a58ed...` = PyPI simple API `e80a58ed...` 完全一致）。**意外副作用**：`twine upload dist/*` 因 `dist/` 残留 0.1.5 + 0.1.6 旧 artifact 把旧版本也试图重传 —— PyPI 静默拒绝同 version 重传（不更新 upload_time），无害。**后续 follow-up**：(a) schema 层 BeforeValidator 归一化（架构正确做法，user 拍板 0.1.7 暂不上）+ (b) `bundled-skills/creative-video-suite/references/agnes-ai-api.md` §5.5 narrative 此前误写 "image_generate schema 不含 image_paths" 待独立 commit 修。

**0.2.2 缓解（2026-09-21, snapshot 标注 · 非新 TODO）**：用户报"harness 多次调用 agnes-video-25-mcp 传入多于一个 image url 出现嵌套 bug，愈发严重" → 根因 = helper 单层 unwrap，深度≥2 时返 dict，下游 `for v in values` 把 dict keys 当 URL 静默丢全部图片。0.2.2 把 `_coerce_image_paths_input` / `_coerce_str_list_input` / `_coerce_videos_input` 改成递归 unwrap（+ `id()` 自引用环检测 + 深度上限 8 防死循环），新增 8 个嵌套 regression case。**PyPI v0.2.2 已 ship**（whl sha256 `3faf46b3...`, tar.gz `06ef16ca...`，双源一致 @ 2026-09-21）。**架构正确做法（BeforeValidator）仍是 follow-up (a) 未偿还** —— 本次是 runtime mitigation，非 architecture reset；user 拍板按方案 C 走（保留 helper 作 defense-in-depth，不上 schema BeforeValidator）。详细见 hosted_mcps/agnes-video-25/CHANGELOG `[0.2.2]` 段。

#### TODO #132 — agnes-video-25 v0.1.8：schema 层放宽 `image_paths: list[str] | dict | None`（让 0.1.7 helper 真正可达）✅ DONE
**触发**：0.1.7 落地后已记录 "FastMCP / Pydantic v2 在 strict schema 模式下会在函数体前拦截 dict 输入，helper 不可达" trade-off（CHANGELOG 0.1.7 §Known limitations + TODO #131 narrative）。0.1.8 关闭这条 leak。**改动 3 文件**（+39 -8）：(1) `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` `_image_generate_impl` 与 `agnes25_image_generate` 两处签名 `image_paths: list[str] | None = None` → `list[str] | dict[str, Any] | None = None`，helper 保持不变（已 0.1.7 测试覆盖）；(2) `hosted_mcps/agnes-video-25/pyproject.toml` 0.1.7 → 0.1.8；(3) `hosted_mcps/agnes-video-25/CHANGELOG.md` 新增 `[0.1.8]` 段（schema-layer fix rationale + 残留 trade-off 链 + JSON schema 现列 `image_paths` 为 `oneOf: [array<string>, object, null]`）。**PyPI 发布**：`rm -rf dist/`（避免 0.1.7 时 `dist/*` wildcard 重传 0.1.5/0.1.6 的副作用）+ `uv build` + `twine upload --repository pypi dist/agnes_video_25_mcp-0.1.8-{py3-none-any.whl,tar.gz}` 显式指定两个文件避免 wildcards。**verify**：本地 whl sha256 `3ea01f906eb5ba75c295b4281826fc5cd5017b36fff422d2c31b397443b0c0f9` = PyPI simple API `3ea01f906eb5ba75c295b4281826fc5cd5017b36fff422d2c31b397443b0c0f9` 完全一致。**为什么 schema 放宽而不是 BeforeValidator**：MCP `@mcp.tool()` entry + `_image_generate_impl` 内部 helper 两边都要放宽才能让 dict 一路通过 → `list[str] | dict[str, Any] | None` 是最小改动；若只加 BeforeValidator 在 entry 层则内部 helper 仍见 `list[str]` 与 `_img_normalize_inputs(image_paths, ...)` 类型冲突。**残留 trade-off**：(a) single-key unwrap 仍 type-unsafe；(b) JSON schema 改 oneOf 消费方需 handle new object case；(c) bug 报告本身未经 Pydantic error 原文核实 —— helper 现在可达，但触发源未确认是 Claude Code 还是别的 MCP client。**后续 follow-up**：(1) bundled-skills/creative-video-suite §5.5 narrative 错误声明待修；(2) `findPipInstalledUvxScriptsDir` 之外的 Windows image_paths 中文路径 e2e（TODO #127 smoke test 涵盖的是 uvx 解析，不是 MCP tool surface）。

#### TODO #133 — 工具箱 stdio MCP 启动握手校验 (`/api/mcp/enable`) ✅ DONE
**触发**：用户报"在工具箱里激活要确保 mcp 服务可以正常启动，目前不是"。`/api/mcp/enable` 三 stdio 分支（generic `which` / npx builtin `--help` warmup / `__bundled_cuse__` binary-existence check）只做浅校验，从不起进程验证 MCP protocol。坏 MCP（binary 在但 init 崩 / 不说 MCP 协议 / bash 引号错位 / 缺 runtime dep）能过 enable，首 turn 才暴露，误导用户"已启用"。**方案**（plan `/home/hmcz/.claude/plans/mossy-dreaming-dewdrop.md`）：抽 `transformMcpServerForSpawn(server)`（NEW `src/server/mcp/mcp-server-transform.ts`）从 `agent-session.ts::buildSdkMcpServers:3472-3713` 的 5 个 inlined 块（cuse sentinel / npx resolve / `buildMcpSubprocessEnv` / uvx PATH / playwright arg），SDK 装配 + 新 validator 共用单一变换源（refactor -80 行，零行为变更已验证）；新 `validateStdioStartup({command,args,env,parentSignal,timeoutMs:15s})`（NEW `src/server/mcp/mcp-startup-validator.ts`）用 `@modelcontextprotocol/sdk@1.29.0` `StdioClientTransport` + `Client.connect()` 真跑 `initialize` JSON-RPC 握手，never-throws 返回 discriminated union → 复用现有 `McpEnableErrorType` enum（`command_not_found` 给 ENOENT，`runtime_error` 给 timeout/JSON-RPC 错误）。cancel + timeout 用 `utils/cancellation.ts::withAbortSignal` + `withBoundedTimeout(close, 2s)` 兜底 subprocess 收尸（防止 SDK subprocess 拒 SIGTERM 时 hang）。`parentSignal` 透传 `request.signal` 让关闭 Settings 面板中途取消 killing child。**接入点**（`src/server/index.ts:4717+` / `4968+` / `5112+` 三分支）：generic 替换 `which`；npx builtin 在 `--help` warmup **之后**追加 handshake（warmup 留作 cache prefetch 不删，避免首次 turn 5-30s 退化）；`__bundled_cuse__` 替换 binary-existence check（fast-fail 仍走 `transformMcpServerForSpawn` 返回 null 的早退路径）。**响应 payload 加性扩展**：`{ success, serverInfo?: { name, version }, handshakeMs? }` — 前端忽略新字段。**测试**（全绿）：9 unit (`mcp-startup-validator.unit.test.ts` mock SDK) + 3 integration (`mcp-startup-validator.integration.test.ts` 用 `__tests__/fixtures/delayed-mcp-server.mjs` 真 spawn)。**scope-out 留 follow-up**：(a) `handleMcpTest` (CLI `hamuna mcp test`) — 暂时不动；(b) `tools/list` 深度验证（捕获 "protocol OK 但 tool 注册崩"）；(c) SSE/HTTP 分支的 `request.signal` 缺口（用本地 AbortController）；(d) 跨 `index.ts:4772` (`'0.1.29'`) / `admin-api.ts:676` (`'1.0'`) 的 `clientInfo.version` 不一致（建议提常量到 shared）。**版本流转**：跟分支末尾 commit。**分支**：`feature/mcp-stdio-startup-validation`（master 不直接 commit）。

#### TODO #135 — Windows install-time prefetch `agnes-video-25-mcp` wheel ✅ DONE
**触发**：用户报"windows安装包自动安装 agnes-video-25 mcp"。当前路径是 `multimedia-creator` MCP 首次 spawn 时 `uvx --from agnes-video-25-mcp==0.2.0` 从 PyPI 实时拉 wheel（NSIS `Section UvxFallback` 只装 uv + uvx，不预装 hosted MCP wheel）→ 中国大陆/弱网友好度差（PyPI 偶发 timeout）+ 首次用户视频请求要等 ~5-30s wheel bootstrap。用户拍板 "NSIS install-time 预热 wheel"，**再拍板** "setup 安装完python之后直接pip 安装" → 去掉了独立 PowerShell 脚本的 indirection，直接 inline `ExecWait` 在 `Section HostedMcpPrefetch`（紧接 `Section PythonInstall`）。

**方案**（最小改动，最终版）：新增 `Section HostedMcpPrefetch` 紧接 `Section PythonInstall` 之后（**不**藏进 `Section UvxFallback`，按用户"直接"指示），inline `ExecWait` 跑 `pip install --user --upgrade --index-url <aliyun/pypi> agnes-video-25-mcp==<ver>`，与 §UvxFallback uv 装法同款镜像链（Aliyun 主源 + PyPI fallback，TODO #128；**禁**回退 Tsinghua），soft-fail（不 abort，只 DetailPrint 警告 + Sidecar 兜底 `uvx --from` on first spawn）。**版本号单源真相**：`hosted_mcps/agnes-video-25/pyproject.toml::version`，windows-release.yml 加 sync step（`pwsh` + `sed -replace`）在 `Build Tauri app (NSIS)` 之前把版本注入 `installer.nsi` 的 `!define AGNES_VIDEO_25_MCP_VERSION "__AGNES_VIDEO_25_MCP_VERSION__"` 占位符 —— 漂移风险由 smoke test（step 4b assert 5/3 `pip show` + assert 4/3 `uvx --from`）兜底。**改动 4 文件**：
1. `src-tauri/nsis/installer.nsi` — 头部加 `!define AGNES_VIDEO_25_MCP_VERSION "__AGNES_VIDEO_25_MCP_VERSION__"` + 新 `Section HostedMcpPrefetch`（紧接 PythonInstall，inline ExecWait + 镜像链 + soft-fail）
2. `src-tauri/tauri.windows.conf.json` — **不动**（不需要 bundle ps1 脚本——ExecWait 直接调 python.exe）
3. `.github/workflows/windows-release.yml` — step 19 之前加 "Sync agnes-video-25-mcp pin" step（pyproject.toml → sed installer.nsi 占位符）；step 20 smoke test pin `0.1.6` → `0.2.0` + 新 assert 5/3 `pip show agnes-video-25-mcp`（动态读 pyproject.toml 比版本，drift 兜底）
4. `snapshot.md`（本节）

**第二轮简化（原计划版废）**：初版用了独立 `hosted-mcp-prefetch.ps1`（mirror chain + soft-fail + marker log `%LOCALAPPDATA%\hamuna\hosted-mcp-prefetch.log` 给 smoke test assert 6/3 验证），已 `git rm` —— 用户拍板"直接pip 安装"判定为过度设计：script → bundle.resources → marker log 三件套多余，inline ExecWait 与 §UvxFallback uv 装法一致即够；smoke test 只需 `pip show`（assert 5/3 已覆盖）不需要 marker log（assert 6/3 已删）。**trade-off 记录**：失去"PowerShell 单元可测"维度（installer.nsi 整段是 NSIS 不可在 PowerShell 跑）—— 接受，因为 §UvxFallback 已是同款 inline 模式，标准化就够。

**scope-out 留 follow-up**：(a) 多 hosted MCP 通用化（当前 hard-code `agnes-video-25-mcp`，未来 hosted_mcps/agnes-image-* / *-video-2.5 等共用模式）；(b) wheel hash 校验（trust-on-first-use 风险——目前 mirror 链 + uvx 自身 GPG 不做校验）；(c) `scripts/download_*_mcp.ps1` 抽 helper（当前 5 个 download_*.ps1 各管各的，未统一）。

**版本流转**：本 branch `feat/nsis-hosted-mcp-prefetch` → 已 fast-forward merge 入 master（69a8c63，bump 0.3.157 → 0.3.158）。

#### TODO #134 — agnes-video-25 v0.2.0：agnes-video-v2.0 模型白名单 + 参数转义 🔄
**触发**：用户要求"agnes-video-25 mcp 增加支持 agnes video 2.0 模型" + 4 轮 grlling 拍板：(1) model ID = `agnes-video-v2.0`（带 v，docs URL `wiki.agnes-ai.com/zh-Hans/docs/agnes-video-v20` 中 model 字段实际就是这个名字——不是 `agnes-video-2.0` 也不是 `agnes-video-v20` URL slug）；(2) 仅白名单（caller 显式 `model="agnes-video-v2.0"`），不加 MCP server 端自动降级；(3) 仅 MCP server 改动，`bundled-skills/creative-video-suite` 红线（TODO #119 + §5.2 "禁止 fallback"）保持；(4) **接口输入参数不变**——v2.0 模型加入参数转义，`mode/seconds/size/first_frame/last_frame/images[]` 字段语义保持，server 内部映射到 v2.0 协议（`mode:"ti2vid"/"keyframes"` + `extra_body.image:[url1,url2]` + `height/width` + `num_frames` + `frame_rate:24`）。**协议差异 vs 现状**：(a) v2.0 size 集合 `{480p,720p,1080p}`（小写 p）vs 2.5-flash `{720P}`（大写 P）；(b) v2.0 aspect_ratio 5 个（`16:9/9:16/1:1/4:3/3:4`，**无 21:9**）vs 2.5-flash 6 个（含 21:9）；(c) v2.0 `mode="reference"` 不支持（v2.0 不接 `images[]/audios[]/videos[]`），命中返 `reference_mode_unsupported` 错误（类比 2.5-flash 的 `videos_unsupported` 模式）；(d) `seconds` 字符串 → `num_frames` 8 倍数 snap 到 `{81,121,241,441}` + `frame_rate=24` 固定。**改动计划**：4 文件（`server.py` + `tests/test_v2_model_whitelist.py` + `pyproject.toml` 0.1.8→0.2.0 + `CHANGELOG.md`）+ 文档（`README.md` / `SKILL.md` 更新描述与能力一致，仍标 hosted_mcps 内部文件）。`extended_buildin_mcp/mcp.json` 的 `multimedia-creator` pin 由 `scripts/bump-on-commit.mjs::AGNES_MCP_VERSION auto-bump` 在 PyPI 0.2.0 publish 后下个 commit 自动 patch。**scope-out 留 follow-up**：(a) caller 显式传 `negative_prompt` / `num_inference_steps` 等 v2.0 独有字段（v2.0 docs 支持，server 未暴露——保持"接口输入参数不变"约束）；(b) creative-video-suite 红线 §5.2 决策同步（用户拍板暂不动）；(c) vendor 0.1.6/0.1.7/0.1.8 → 0.2.0 同步（vendor 即本地，同一文件改动 = 已自动同步；TODO #21 follow-up 仍待清理）。

**目标**：让 `agnes-video-25-mcp` server 在 `AGNES_API_KEY` daily quota 撞顶（429）时自动切换备用 key。解决 2026-09-08 UGC 2nd 跑 5 个 key 撞 daily quota → 17h 阻塞问题。

**Spec 已落地**：`.pavo-research/agnes-multi-key-fallback-spec.md`（~230 行，4 点核心：向后兼容 / in-memory KeyState 状态机 / 入口收敛到 `_request_json` 改 1 处 / 10 个单测 case）。

| Task | 状态 | 内容 |
|------|------|------|
| **#18 P3 Step 1 — spec** | ✅ DONE | spec 写完 + 行号标注 + 风险/妥协列表 + 4 选 1 拍板选项 |
| **#19 P3 Step 2 — 改代码** | ✅ DONE（0.1.4 in-memory）+ ✅ DONE（0.1.6 持久化 + 30s 窗口） | 改 `server.py` + `tests/test_key_pool_cooldown.py` 6 assert self-check；in-memory pool + persisted state + atomic tmp+replace + `AGNES_KEY_POOL_STATE_DIR` 覆盖 + 30s 窗口 reason split + cooldown 完 refresh `last_429_at=0` |
| **#20 P3 Step 3 — bump + PyPI** | ✅ DONE（v0.1.6） | `hosted_mcps/agnes-video-25/pyproject.toml` 0.1.5 → 0.1.6 + PyPI v0.1.6 whl 15122B + tar.gz 81054B, upload_time 2026-09-09T16:24:15/18 |
| **#21 P3 Step 4 — vendor + mcp.json + e2e** | 🔄 pending | `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` 同步 0.1.6；`extended_buildin_mcp/mcp.json` pin 0.1.5 → 0.1.6（或靠 TODO #113 bump-on-commit.mjs AGNES_MCP auto-bump 段下次 commit 自动 patch）；跑 2nd UGC 剩余 5 段验证 fallback 真生效 |

**P3 设计 4 关键点**：向后兼容 / KeyState 4 态状态机 / 入口收敛到 `_request_json` / 10 个单测 case。**4 个已记录但暂不实现的妥协**：in-memory 不持久化 / 401 不自我恢复 / 状态查询用提交成功那个 key / 429 reset 解析失败保守到下个 UTC 00:00。

**0.2.3 round-robin 子条目（2026-09-21, snapshot 标注 · 非新 TODO）**：用户在 0.2.2 ship 后要求"mcp 加入在 fallback 基础上加入多 key 轮询"——grilling 揭示三义（round-robin / 叠加 fallback / 健康轮询），user 拍板**方案 B = round-robin 叠加 fallback**（首选轮询、撞墙 fallback 兜底）。改动：(a) 模块级 `_KEY_ROUND_ROBIN_COUNTER`（绝对值，非 modulo wrap）+ `idx = counter % len(healthy)`；(b) `_pick_key` 第一关：healthy 列表里轮询选下一个，跳过 cooldown；(c) `_load_key_pool` / `_persist_state` 把 counter 写到同一个 JSON 顶层 `_round_robin_counter` key，向后兼容旧文件（缺字段 → 0）；(d) fallback / cooldown / 30s 窗口 / `_mark_disabled` 全部 0 改动。**新增 4 个单测**（cycles / skips_cooldown / persists / mixed_health）+ 6 个旧单测全绿 = 10/10。**为什么不彻底替代 fallback**：现有 fallback 是"撞 429 才换"，适合"主+备"key 等级差异；round-robin 是"平等均摊"，两者语义不冲突——B 方案叠加而非替换，是 user 拍板选择。详细见 hosted_mcps/agnes-video-25/CHANGELOG `[0.2.3]` 段。

### 3.3 待办池

#### TODO #17 — 2nd UGC 后半 5 段视频 🔄 quota-pending
**触发**：TODO #104 1st UGC 成功后用户要求再跑一次端到端验证 URL 复用。**撞 429 daily quota**（request IDs: `20260908063506204136165EwLlEv8i` / `20260908064500904279309wqCF2qMO`），17h 24min 直至 2026-09-09 00:00 UTC 刷新。
- **P3 落地后**用 2 个 key 重新跑（一个撞 1st quota，另一个备用）
- **中间路径**：P3 spec 落地后，`.mcp.json` 配置 `AGNES_API_KEYS=key1,key2` 后**立刻**就能跑

#### TODO #1 — `.dev-placeholder` 方案 ❌ 废弃
已删；如未来 `tauri-build` 收紧校验目录非空，`beforeDevCommand` 才需补内容填充。

---

## 4\. 最近已完成（git log 指针）

| Commit | 摘要 |
|--------|------|
| `e72123c` | **fix(nxgd): auto-refresh apiKey on 401 via idempotent register (snapshot TODO #145, 2 文件 / +132 -24; 新增 `refreshNxgdApiKey()` + `fetchModels` 401 → refresh → retry 一次；register 是幂等的，同 code 返既有/轮换 apiKey；5 新单测全绿 16/16)** |
| `ebfd314` | **fix(nxgd): register `GET /api/nxgd/models` HTTP endpoint that was never wired (snapshot TODO #157, 1 文件 / +24 -1; `src/server/index.ts:693` import + recharge 路由块后插新 handler；503 未注册 / 429 限流透 retryAfterSeconds / 502 透 cached snapshot envelope 与 renderer regex 双向契约锁；`fetchModels()` 0 改动复用 24h 缓存 + 401 轮换 + 429 冷却；typecheck 0 errors + nxgd-auth.unit 16/16 0 回归)** |
| `aa281f3` | **refactor(nxgd): drop recharge affordance from Settings card — keep balance read-only (snapshot TODO #144 续, 4 文件 / +39 -115; 卡片只读 + 「刷新余额」按钮，充值流程移到 Chat 弹窗独占)** |
| `d367d8d` | **feat(provider): integrate China Radio/TV Token Platform as built-in first-choice model provider (snapshot TODO #144, 20 文件 / +1392 -9)** |
| `<pending>` | **fix(install): Windows upgrade path wipe nodejs/ before File /a re-extract (snapshot TODO #187, 3 文件 / +N -0; `src-tauri/nsis/hooks.nsh::PREINSTALL` 加 `RMDir /REBOOTOK "$INSTDIR\nodejs"` + 14 行注释；`mcp-command.ts::NpxMcpResolutionError` message 加 actionable fallback 提示；`windows-release.yml` Assert 8/3 校验 `node_modules/npm/bin/npx-cli.js` 存在)** |
| `<pending>` | **fix(mcp): align mcp-command POSIX behavior + recognize `--yes` long form (snapshot TODO #192, 2 文件 / +X -X; `resolveNpxMcpInvocation` POSIX 末尾 throw `NpxMcpResolutionError` 替代静默 ENOENT；`hasYes` 双形式识别；7/7 test 全绿)** |
| `<pending>` | **fix(settings): debounce apikey auto-verify (1200ms + min-length 8 + onBlur flush) (snapshot TODO #191, 2 文件 / +X -X; `apiKeyAutoVerify.ts` 加 `MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY=8` + helper 分支；`SettingsPage.tsx` debounce 500→1200 + `pendingKeyRef` + `onBlur` flush；13/13 test 全绿)** |
| `<pending>` | **fix(agent-session): in-process WebFetch blocklist override (snapshot TODO #190, 1 文件 / +12 -0; 主 Claude `query()` 的 `settings: {}` 加 `skipWebFetchPreflight: true` + 10 行注释)** |
| `<pending>` | **fix(openai-bridge): tool parameters 不变量修复 web_search 400 (snapshot TODO #189, 4 文件 / +X -X; `EMPTY_OBJECT_SCHEMA` + `ensureObjectParameters` helper 单一真相源 + 两 translator 统一 fallback)** |
| `<pending>` | **ci(windows): cache npm in windows-release.yml to skip ~2m51s cold npm ci on subsequent releases (snapshot TODO #129, 1 文件 / +5 -0)** |
| `<see git log --grep="nsis-hosted-mcp-prefetch">` | **feat(install): NSIS install-time prefetch `agnes-video-25-mcp` wheel — inline `ExecWait` 紧接 §PythonInstall (Section HostedMcpPrefetch, 镜像链 Aliyun→PyPI fallback + soft-fail + version sed-injected from pyproject.toml); 4 人工 + 4 auto-bumped (package.json / package-lock.json / tauri.conf.json / Cargo.toml); smoke test assert 5/3 `pip show` 验证 install-time prefetch 真生效; hash 留 git log 维护 — 避免 §4 与 amend 循环漂移; snapshot TODO #135)** |
| `<see git log --grep="agnes-video-v2.0">` | **feat(agnes-video-25): add agnes-video-v2.0 model whitelist with parameter translation (v0.2.0, snapshot TODO #134, 8 文件 / +1 新 test_v2_model_whitelist.py 42/42 + 0 回归; PyPI 0.2.0 sha256 verified @ 2026-09-11T15:35:04Z; hash 留 git log 维护 — 避免 §4 与 amend 循环漂移)** |
| `c008edc` | **fix(agnes-video-25): tolerate dict-shaped image_paths (user trade-off) + vendor 0.1.7 PyPI publish + bump mcp.json pin (snapshot TODO #131, vendor 4 文件 + extended_buildin_mcp/mcp.json 1 文件)** |
| `f65a609` | **fix(agnes-video-25): widen image_paths schema to make 0.1.7 helper reachable (v0.1.8) + vendor publish + bump mcp.json pin (snapshot TODO #132, vendor 3 文件 + extended_buildin_mcp/mcp.json 1 文件)** |
| `<pending>` | **feat(bundled-skills): hamuna-writing-system 接 human-writing 硬门禁（阶段三 CHECKPOINT + 阶段四门禁 1 双源并集 + anti-ai-lexicon 顶部 ABSOLUTE 段 + scripts/check_prose.py 副本，TODO #183，4 文件 / +76 -4）** |
| `<pending>` | **feat(bundled-skills): hamuna-writing-system 完全继承 human-writing 方法论 + 删除 human-writing 独立 skill（5 references 全量搬迁 + prose-methods.md 散文主干合订 + SKILL.md 文体分流 CHECKPOINT + §反例 #7 翻转 + anti-ai-lexicon 改本词典 + check_prose.py 回归用例，TODO #184，9 文件 / 1 删除）** |
| `b63c915` | **fix(mcp): win32 npx bypasses .cmd shim; transform PATH rebuilt via getShellPath (snapshot TODO #185, 6 文件 / +252 -82; MyAgents Win 策略复刻 — node.exe + node_modules/npm/bin/npx-cli.js 直调，根除 npx.cmd shim 在无 login shell PATH 的 Tauri Sidecar 下"node is not recognized"；`getShellPath()` 替换 raw parentEnv.PATH，transform 与 prewarm 共享同一 PATH 重建；5/5+7/7+11/11+5/5+integration 43/43+classification 206+typecheck 0+eslint 0)** |
| `<pending>` | **fix(install): switch pip mirror to Aliyun with PyPI fallback (清华源 2026-09-10 timeout, snapshot TODO #128, 2 文件 / +15 -2)** |
| `<pending>` | **ci(windows): gate R2 upload on install-time smoke (verifies NSIS UvxFallback lands uv==0.11.33 + uvx --from works, snapshot TODO #127, 1 文件 / +108 -0)** |
| `<pending>` | **fix(install): pin install-time uv to ==0.11.33 to avoid 0.12.x `uvx --from` tightening (rationale chain 197837b/4812fbe/37a7f21, snapshot TODO #126, 2 文件 / +12 -1)** |
| `<pending>` | **feat(install): pip-only uvx on Windows (remove bundled uvx.exe, NSIS Section UvxFallback → pip install --user uv from Aliyun mirror + uvx-path-setup.ps1 HKCU\Environment\Path 持久化, 6 文件 / -48MB bundle)** |
| `e01778f` | v0.3.144 |
| `f4b6bcd` | docs(snapshot): closeout #125 (download_uv.ps1 string literal pin) |
| `37a7f21` | fix(uv): pin 0.11.33 as string literal + drop broken GitHub API auto-track |
| `aa19103` | **feat(creative-video-suite): add opt-in multiview grid image + product_metadata JSON schema + promote to system skill** |
| `f47c650` | **chore(deps): sync Cargo.lock hamuna 0.3.96 → 0.3.100** |
| `3eba012` | **fix(creative-video-suite): split input-source iron rule by tool (image_edit 3 forms vs video_generate HTTPS-only)** |
| `d9a5f70` | **chore(deps): sync Cargo.lock + package.json after 4f944b2** |
| `197837b` | **fix(mcp): pin bundled uv 0.5.11 and inject uvx dir into MCP spawn PATH** |
| `c58e0f3` | **fix(uvx-spawn): extend getBundledUvPath probe chain with ~/.hamuna/bin/ uvx.exe (slot 3 of 4)** |
| `4812fbe` | **fix(mcp): repin bundled uv 0.5.11 → 0.11.33 (跨 minor 拿稳定性 fix，mcp.json `--from` 未踩 0.12+ 收紧线)** |
| `ffe8edb` | **feat(bundled-skills): add creative-video-suite for short-drama / UGC / corporate** |
| `853da79` | v2 |
| `77fdd97` | docs(snapshot) log 276d8e8 tvc-director grid default 15s→12s |
| `276d8e8` | fix(tvc-director) set grid default unit from 15s to 12s (agnes max) |
| `5c96b15` | docs(snapshot) log 66b6397 tvc-director storyboard reference seconds=12 |
| `66b6397` | fix(tvc-director) set storyboard reference default seconds to 12 |
| `2338a83` | **feat(attachments) drag-drop media → workspace/hamuna_files** |
| `db2d91f` | **fix(attachments) resolve workspace-relative paths to absolute before read_files_b64** |
| `368ee90` | **fix(attachments) override `source` to inline_base64 when rebasing attachment_ref** |
| `079c96f` | **docs(tvc-director) switch video model agnes-video-2.5 → agnes-video-2.5-flash** |
| `7191b91` | **fix(tvc-director) video prompt must reference both `<Picture 1>` (grid) and `<Picture 2>` (product)** |
更早完成（#11—#28 / #29 / #97 / #14 / #16 / #12 / #17—#21 / 60s TVC 迭代 v9—v12 / `220abea` `0f1073e` `c70fd60` `51f3f98` `ea9b524` `db191e2` `1d6743a` `014453d` `4b5c90c` `7f8c60d`）：`git log --oneline --grep="..."` 或 `git show <commit>`。

更早完成（#11—#28 / #29 / #97 / #14 / #16 / #12 / #17—#21 / 60s TVC 迭代 v9—v12）：`git log --oneline --grep="..."` 或 `git show <commit>`。

---

## 5. 关键架构守门（CLAUDE.md 红线摘要）

- **workspace 文件 IO 必须走 Rust invoke**：`cmd_workspace_*` 唯一权威；Sidecar HTTP `/api/files/*` `/agent/*` 已全部下线（PRD 0.2.7 Phase E）
- **Tab-Scoped 隔离**：Tab 内 MUST 用 `useTabState().apiGet/apiPost`；禁全局 `apiPostJson/apiGetJson`（会发 Global Sidecar）
- **持久 Session**：`abortPersistentSession()` 正确中止；禁直接设 `shouldAbortSession = true`（generator 永久阻塞）
- **Multi-Agent Runtime**：所有 sidecar 端点 MUST 走 `src/server/session-engine/` facade（`selector.ts`）；禁手写 `shouldUseExternalRuntime()` 分支
- **Config 持久化**：写盘 MUST `await loadAppConfig()` 再合并；禁直接用 React `config` 状态写盘
- **Builtin MCP 懒加载**：`src/server/tools/*.ts` 禁顶层 import SDK/zod；MUST factory / surface init 内 `await import(...)`
- **路径安全**：Node `path-safety` 与 Rust `commands::validate_file_path` 必须同步
- **裸 API clippy 禁**：`reqwest::Client::new()` / `Command::new()` / `tokio::spawn` 全部 clippy 红线
- **同步 `#[tauri::command]`** 不做 >1 帧工作（冻结 macOS WKWebView）；改 `pub async fn` + `spawn_blocking`
- **WorkspacePath 比较**：`workspacePathsEqual` / `normalizeWorkspacePathIdentity`；Win 反斜杠 vs 正斜杠永不相等且静默（#320）
- **Model id 进 SDK ingress 必须过 context-window suffix helper**（`applyProviderContextWindowSuffix` / `applyContextWindowSuffix`，见 `pit_of_success.md`）
- **Tool attachment 走 `tool_result.attachments: ToolAttachment[]` 协议**（不走 `tool_result.content` 字符串 / 不写单点 React 组件，详见 `tool_attachment_pipeline.md`）
- **会话历史恢复**唯一权威 = REST `/sessions/:id`；SSE `chat:message-replay` 只 skip `replayKind:'cold-history'`（`sessionRestoreGuards.ts`）
- **比较工作区路径禁止 raw `===`** / inline `.replace(/\\/g,'/')`，用 `workspacePathsEqual` helper
- **Windows uvx 解析**：spawn 前调 `findPipInstalledUvxScriptsDir()` probe `%APPDATA%\Roaming\Python\Python312\Scripts` + `%LOCALAPPDATA%\Programs\Python\Python312\Scripts` 两条候选 dir；NSIS install 时 `pip install --user uv==0.11.33` 从**阿里源** `mirrors.aliyun.com/pypi/simple/`（清华源 2026-09-10 观察到 timeout 已弃用，TODO #128），失败 fallback PyPI 官方源 `pypi.org/simple`（**禁**回退清华）+ pin 0.11.33（pin 与 rationale chain 一致：0.12+ 收紧 `uvx --from`）+ 写 HKCU\Environment\Path 持久化（`uvx-path-setup.ps1`）；**禁** install-time `pip install --upgrade uv` 不带版本（TODO #126）
- **商业小说写作（hamuna-writing-system）正文写作硬门禁**：阶段一加文体分流 CHECKPOINT（商业小说走影视化宪法，散文/知乎/纪实走 `references/forum-prose.md` 散文主干，混合文体两套并行），阶段三 CHECKPOINT 标注「必须遵守 `references/prose-methods.md` 第六节硬禁令」（hamuna 原 14 词 + 27 绝对禁词 + 9 语境检查词 + 9 抒情词 + 翻案腔整组外衣 + 冒号/破折号/同构排比/抽象名词抒情/名词化/"说白了"/模型路标/商业黑话全部触发）。每章交付前必跑 `python3 scripts/check_prose.py <章节.md>`，零失败项才能进 walkthrough（TODO #183/#184 完成，human-writing 已内化进本仓 5 个 references）

### 5.1 预 commit 硬闸

1. `npm run typecheck` + `npm run test:unit`（改 `.test.tsx` 加 `test:dom`；改 session/runtime/IO/security 加 `test:classification` + `test:integration`）
2. `git status` 确认无并发 writer 混入；**禁** `git add -A` / `git add .`
3. amend 任何 commit 一律 `git commit --amend --no-verify`（防 pre-commit bump-on-commit 二次 patch bump）
4. **禁** `git add -f` 把 ignored 文件塞进提交（PRD / research 草稿只落盘不提交）
5. **发布前验"已提交态"**：并发 writer 可能提交组件改动却把配套测试 fix 留在工作区 → `git stash` 无关工作区再跑易红测试

### 5.2 决策待定（2026-09-08）

- **creative-video-suite 模型 fallback 策略**（**2026-09-11 用户拍板：仅 MCP server 加 agnes-video-v2.0 白名单**）：
  - 用户原话："agnes-video-25 mcp 增加支持 agnes video 2.0 模型" + 4 轮 grlling 拍板
  - **已落地范围**（TODO #134）：MCP server 加 `agnes-video-v2.0` 白名单 + 参数转义层；接口输入参数不变；caller 显式 `model="agnes-video-v2.0"` 才走 v2.0 路径；不引入 MCP server 端自动降级（不违反"禁止 fallback"铁律）
  - **skill 端红线保持**：`bundled-skills/creative-video-suite/references/agnes-ai-api.md:261` "v2.0 已下线"段不删 + 9 个模板硬编码 `model="agnes-video-2.5-flash"` 不动 + §5.2 "禁止 fallback"铁律不删 + TODO #119 锁死不松。**矛盾妥协**：MCP 端"available" vs skill 端"never call"——caller 必须显式且非 skill 自动调用才走 v2.0；creative-video-suite skill 永不自调 v2.0
  - **未来 fallback 边界预案**（仅备忘，等下次会话明确再启动）：
    - 触发：2.5-flash 失败 2 次后切换到 fallback 模型
    - fallback 时允许：prompt 微调 / images[] 微调
    - fallback 时禁止：mode / size / seconds / aspect_ratio / 工具切换
  - **潜在下一动作**（用户未确认，不动）：
    - 选项 a：skill 端放宽"v2.0 已下线"红线（creative-video-suite / tvc-director 接受 v2.0 fallback 路径）
    - 选项 b：MCP server 端自动降级（v2.0 作为 2.5-flash 失败的自动 fallback）
    - 选项 c：保持现状（仅 MCP 白名单，skill 端永不调用）

### §5.5-5.7 creative-video-suite 经验压缩锚点（2026-09-08/09 落地）

§5.5-5.7 三段 narrative 已折叠为下方锚点；详细设计取舍见 git log + 对应 skill 文件：
- **§5.5 输入源铁律按工具拆分**（commit `3eba012` on `dev/skill-input-source-split`）—— 旧一刀切 HTTPS-only 铁律过度推广，根因只对 `video_generate.images[]/first_frame/last_frame/audios[]` 成立（避开 `img.remit.ee` QPS 限流）；改按工具拆两段：`image_edit.image_paths/mask_path` 允许 HTTPS + Data URI + 本地（server 编码 data URL 传入），`video_generate.*` 仍 HTTPS-only。改动 5 文件。已知遗留：SSE 256KB 对 image_edit 输出 spill 行为未验；`project.json.notes.image_paths_source` 字段未拍板。
- **§5.6 creative-video-suite: promote utility → system skill + `SYSTEM_SKILLS_VERSION` 39→40**（commit `aa19103`）—— 7 个 commit 累积老用户未生效，grlling 提示根因（utility skill 不自动同步）→ 拍板 Promote + bump（强制更新）。改动 3 文件（`commands.rs::SYSTEM_SKILLS_VERSION 39→40` + 两份 SYSTEM_SKILLS 数组同步）。后续 skill 内容变更不需再 bump（system skill 模式自动 overwrite）。
- **§5.7 视频时长边界单源化**（§3.1 TODO #108 ✅ DONE）—— `video_generate.seconds` 字符串合法值 `"4"-"12"` + 双重约束散落 9 个 ref，drift 风险 → 单一权威段 `bundled-skills/creative-video-suite/references/agnes-ai-api.md §视频时长边界（单一权威 · 2026-09-09 加）`，10 文件全栈 cross-link。image_generate / image_edit / T13 不受约束（3 类工具无 `seconds` 参数）。

### 5.8 WebKit 内存诊断结论（2026-09-20 · #185 ✅ DONE）
**核心结论**：涨到 3.24 GB 的不是产品代码泄漏，是 WebKitGTK DevTools Inspector WebProcess 在 `#[cfg(debug_assertions)]` 下长 cache 主 webview DOM/source map；release build 无此进程 = 用户线上不受影响。详细采样表 / 误判订正 / `pgrep -f` 抓 bash wrapper 踩坑 → 见 git log。**scope-out**：(a) 不 gate `open_devtools()`；(b) 不写 memory regression 测试；(c) 不 commit（诊断而非 fix）。

### 5.9 OpenAI Bridge Responses API tool 形状回归到嵌套结构（2026-09-20 · #186 落地）

**触发**：用户跑 `agnes-3.0-flash`（OpenAI Bridge Responses API path）碰到 `OpenAIException` 上游 400。unified log 定位：`[bridge][DIAG] requestBody.length=213011 column=63453 tool @col: before=EnterPlanMode@62162(+1291) after=EnterWorktree@66490(-3037)` + 上游错误原文 `Failed to deserialize the JSON body into the target type: input: data did not match any variant of untagged enum ResponseInput at line 1 column 63453`，10 秒前还有一次 `tools: Function tool must have a function definition`。

**根因**：`src/server/openai-bridge/translate/request-responses.ts:113-124` 在 #325 fix 时给每个 tool 补 `strict: false`，但**保留了平铺形状**（`{type:'function', name, description, parameters, strict}`）——这与 OpenAI 官方 FunctionToolParam **嵌套** schema（`{type:'function', function:{name, description, parameters, strict}}`）不一致。chat_completions path (`tools.ts:8-17`) 一直是嵌套。OpenAI 官方 / xAI 等 lenient provider 容忍平铺，但 Rust serde untagged enum 实现的 strict provider（agnes）严格匹配字段 key，遇到平铺后**先报 `Function tool must have a function definition`**，walk 完整个 tools 数组没找到 `function` 嵌套 key，于是在某段长字符串中间放弃，报 `untagged enum ResponseInput at line 1 column N`（column 是放弃点不是出错点——代码注释自注）。

**修复**：把 `request-responses.ts:113-124` 改为跟 `tools.ts::translateToolDefinitions` 同形的嵌套输出，`strict: false` 一起移进 `function` 子对象；同步改 `src/server/openai-bridge/types/openai-responses.ts::ResponsesTool` 类型为嵌套（`function: {name, description, parameters, strict?}`）；改 `request-responses.unit.test.ts` 三个 describe 块共 5 处访问路径（`t.parameters` → `t.function.parameters` 等），加 Bug F 嵌套不变量测试（断言 `name/description/parameters/strict` 全部不存在于 tool 顶层、只存在于 `function` 子对象）。

**为什么这是"通用方式"**：(a) 跟 chat_completions path 输出形状一致（两个 bridge path 长期漂移收敛到 OpenAI 官方 spec 的嵌套形态）；(b) 不引入 per-provider flag（每个 strict 实施 provider 都同款问题，逐家加 hook = 配置爆炸）；(c) 保留 #325/#328 的 `strict: false` + `stripSchemaDescriptions` + `instructions` 用 input prepend 三条既有 fix —— 这是同一族 strict serde untagged enum 兼容性经验，不是为 agnes 单独 ad-hoc；(d) 加 unit test 锁住嵌套不变量 = 防止未来再有人改回平铺。

**改动 3 文件**：`src/server/openai-bridge/types/openai-responses.ts::ResponsesTool`（平铺 → 嵌套）+ `src/server/openai-bridge/translate/request-responses.ts`（输出形状同步改嵌套，注释引用 `tools.ts` 对齐证据 + 2026-09-20 63453 回归案例）+ `src/server/openai-bridge/translate/request-responses.unit.test.ts`（Bug D describe 标题加 "+ nested shape (Bug F)"、3 处访问路径改 `.function.X`、加 1 个新 Bug F 嵌套不变量断言、另 1 个 describe 中 3 处路径同步）。

**scope-out**：(a) 不动 `tools.ts::translateToolDefinitions`（chat_completions 已经是嵌套）；(b) 不动 `handler.ts` 的 `[bridge][DIAG]` 诊断逻辑（下次复现同样能精确定位）；(c) 不引入 per-provider `toolShape` flag；(d) 不写运行时 toggle；(e) 不动 #325/#328 的 `instructions` / `stripSchemaDescriptions` / `strict: false` 既有 fix；(f) 不写 PRD / 不动 snapshot.md §4 commit 占位（这次改动先发 snapshot，等 user 拍板 commit 节奏）。

**验证**：`npx vitest run --project unit -- src/server/openai-bridge/translate/request-responses.unit.test.ts` → **40/40 全过**（含 3 处路径修复 + 1 新嵌套不变量测试）；`npm run typecheck` → 0 errors；`npx eslint` 3 改动文件 → 0 errors。pre-existing 失败 4 文件（widgetSandboxHtml / themeArchitecture / playwright-bash-redirect / eventRegistry）跟本改动无关，不增不减。

**踩坑 — 测试断言忘了同步改访问路径**：第一次跑测试 5 处 type error（`Property 'parameters' does not exist on type 'ResponsesTool'`）+ 1 runtime assertion 失败，因为只改了 translator + 类型 + Bug D describe 块，遗漏了"tool schemas strip descriptions (Bug F)" describe 块里的 3 处 `t.parameters` / `t.description` 访问。**教训**：类型从平铺改嵌套，测试里**所有访问路径**都要扫一遍——grep `tools!\[\d+\]\.\(name\|description\|parameters\|strict\)` 一把找齐，避免半改。

**踩坑 — harness 拦截 grep 输出再次复发**：跑 vitest 时 harness 把含 ANSI 颜色码的输出截掉了 summary 部分（`harness 截 grep 输出再次复发`）。**修法**：vitest 结果重定向 `/tmp/vitest-out.txt` 再 grep，绕开 harness 输出截断。

**踩坑 — harness 拦截 grep 输出**：复杂 bash 链 `echo X | grep Y | head -1` stdout 被 harness 完全屏蔽（"1 matches in 1F"）。**修法**：单 Bash 单行只做一件事，或直接 Read `/proc/<pid>/status` 用工具原生读文件路径。

### 5.10 OpenBitFun 调研锚点（2026-09-21 · 借鉴素材）

对照 `/home/hmcz/Projects/openbitfun`（v1.0.0 MIT，Tauri+Rust+React+pnpm，4 种 Harness + MiniApp + Relay）。**已展开**：`specs/prd/miniapp.md` v0.1 PRD（MiniApp 容器形态，照搬 openbitfun 4 文件契约 + 4 类权限 + Bridge API；明确不引入 openbitfun 的 `agent.*`）。**待评审**：Product Operation Registry（加速 `tech_docs/remote_surface_contract.md`）/ i18n contract 集中 + `i18n:audit` 门禁 / Target cache GC + release-fast profile / Plugin Host 4 阶复用规则复盘 plugin-bridge。**不借鉴**：6 层 Rust workspace（单 Desktop 不需要）、App Server wire 矩阵（Sidecar 1:1 是对的）、ACP / OpenCode / Codex adapter（走 SDK）、Sandbox / Computer Use（planned）。

### 5.11 MyAgents `mcp-command.ts` 横向对比（2026-09-23 · #192 落地后调研）

**目的**：核对 MyAgents 的 `resolveNpxMcpInvocation` 是否比本仓更先进，是否需要反向同步。
**结论**：本仓 **#185 + #192 落地后** 已**领先** MyAgents resolver 函数实现；MyAgents 仅在打包层有可借鉴的统一入口。
**对照表**：

| 维度 | MyAgents (2026-09-23 read) | 本仓 (#185+#192 后) | 谁更对 |
|------|----------------------------|---------------------|--------|
| Win 优先级 | system → bundled → runtime-sibling | bundled → system → throw | **本仓**（bundled 优先：installer 保证完整 Node + npm 树） |
| Win npx 调用形态 | `node.exe + npx-cli.js` shim-less | `node.exe + npx-cli.js` shim-less | 一致 |
| POSIX npx 调用形态 | 直调 system npx | 直调 system npx | 一致 |
| POSIX 末尾兜底 | 静默返 `<cwd>/npx` (`dirname('node')`=`.`) → spawn ENOENT 无诊断 | throw `NpxMcpResolutionError` 带 actionable message | **本仓** |
| `-y` vs `--yes` 双形式识别 | 只 `-y` | `-y` + `--yes` 双识别 | **本仓** |
| `runtime-sibling` source 兜底 | 保留（MyAgents L160-166 Win + L185-190 POSIX） | 已删 | **本仓** |
| 配套统一入口 `buildMcpStdioLaunchConfig` | ✅ 含 PATH prepend + Windows 大小写归一化 + `buildMcpSubprocessEnv` | ❌ 散在 `index.ts:5170` + `mcp-server-transform.ts` + `codex.ts` | **MyAgents**（架构 pattern 值得借鉴，非 resolver 层面） |

**scope 决策**：
- **resolver 函数本体不反向同步 MyAgents**（已领先）
- **`buildMcpStdioLaunchConfig` 统一入口模式待 v2 借鉴**：本仓当前 MCP stdio spawn 三处（probe / warmup / runtime projection）各自拼 PATH + env，未来如出现 path-policy 漂移或 Windows 大小写问题，单一入口可消重复。**不在本任务范围**