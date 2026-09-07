# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。snapshot.md 不允许无限增长；已完成项更新完项目状态后立即清出。

最后更新：**2026-09-07**（snapshot 重整 + 拖拽媒体默认复制到 `workspace/hamuna_files/` 落地，commit `2338a83`；**修复 `node:path` 在 renderer 跑导致整页崩** commit `c70fd60`；**删除图片附件时回收 workspace 文件** commit `51f3f98`；**P0 修复 workspace 拖拽图片发不出去** commit `ea9b524`；**rebase 前把 relativePath → 绝对路径（绕过 Rust validator 拒 workspace-relative）** commit `db2d91f`；**rebase 时同步改写 source 字段（dispatch 走 inline_base64）** commit `368ee90`；**tvc-director skill 视频模型切换为 agnes-video-2.5-flash** commit `079c96f`；**修正 SKILL.md / storyboard.md video prompt 双图引用约定** commit `7191b91`；**端到端验证 tvc-director video prompt 新约定**（image×2 + video×1 全通，video 720P 5.166s 落地）；**storyboard reference 默认 seconds 5→12** commit `66b6397`；**重规划 TVC 默认 grid 单元 15s→12s**（待 commit））

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
| ~~知识库引擎 KbEngine~~ | ~~`src-tauri/src/kb/mod.rs`~~ | ✅ 已删 | Rust 端 KB 模块已删除；KB 现在由 Node `src/server/kb/kb-store.ts`（TypeGraph+SQLite）独占提供；tantivy 保留 |
| Managed Codex Runtime | `src-tauri/src/managed_codex.rs` | 稳定 | 锁 `src/shared/managed-codex-runtime.json::version` |
| Grok Auth | `src-tauri/src/grok_auth/*.rs` | 稳定 | |
| 浮动球 / 全局快捷键 | `src-tauri/src/{floating_ball,global_shortcut}.rs` | 稳定 | |
| App Config (Rust) | `src-tauri/src/{config_io,app_dirs,device_identity}.rs` | 稳定 | `with_config_lock` 写盘 |
| Browser / Notification | `src-tauri/src/{browser,notification,notification_badge}.rs` | 稳定 | |
| Admin API | `src-tauri/src/management_api.rs` | 稳定 | |
| Memory Auto Update | `src-tauri/src/memory_auto_update.rs` | 稳定 | |
| CLI 安装 | `src-tauri/src/cli.rs` | 稳定 | |
| Workspace Files | `src-tauri/src/workspace_files/*.rs` | 稳定 | `cmd_workspace_*` 唯一权威；旧 `cmd_prepare_user_image_attachments` 已删（commit `2338a83`），新图片拖拽统一走 `cmd_workspace_copy_paths` 到 `<workspace>/hamuna_files/`；`attachment_protocol.rs::build_attachment_response` 保留以服务历史 session 中的 `~/.hamuna/attachments/<sessionId>/`（双轨） |

### 1.2 Sidecar / Node.js 后端 (`src/server/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Sidecar 入口 | `src/server/index.ts` | 稳定 | `SYSTEM_SKILLS` 清单 |
| Session Engine | `src/server/session-engine/` | 稳定 | `selector.ts` 统一 adapter 分流 |
| Builtin Session | `src/server/builtin-session/` | 稳定 | `lifecycle / turn-lifecycle / config / types` |
| External Runtime | `src/server/runtimes/external-session/` | 稳定 | Claude Code / Codex / Gemini |
| Agent Session | `src/server/agent-session.ts` | 稳定 | public facade；`reloadLiveSessionSkills` |
| Skill Reload | `src/server/utils/skill-reload.ts` | 稳定 | 纯函数 `evaluateSkillReload` |
| External Runtime Env | `src/server/runtimes/env-utils.ts` | 稳定 | 运行时 `fs.readFile + try/catch` 替代静态 import |
| Builtin MCP | `src/server/tools/{builtin-mcp-meta,builtin-mcp-registry}.ts` | 稳定 | `src/server/tools/*.ts` 禁顶层 import SDK/zod |
| Gemini Image Tool | `src/server/tools/gemini-image-tool.ts` | 稳定 | 懒加载 |
| Edge TTS Tool | `src/server/tools/edge-tts-tool.ts` | 稳定 | 懒加载 |
| IM Bridge Tools | `src/server/tools/im-bridge-tools.ts` | 稳定 | runtime-dynamic，context-injected |
| Title Generator | `src/server/title-generator.ts` | 稳定 | |
| Third-party Providers | `src/server/{provider-verify,subscription-auth}.ts` | 稳定 | |
| OpenAI Bridge | `src/server/openai-bridge/` | 稳定 | |
| Plugin Bridge | `src/server/plugin-bridge/` | 稳定 | shim 版本同步 bump |
| Inbox | `src/server/inbox/` | 稳定 | |
| MCP OAuth | `src/server/mcp-oauth/` | 稳定 | |
| 日志 / Runtime | `src/server/utils/` | 稳定 | `runtime.ts` bundled Node；`path-safety` chokepoint |
| KB 富文本入库 | `src/server/kb-ingest.ts` | 稳定 | |
| KB LLM 关系抽取 | `src/server/kb-relations.ts` | 稳定 | |
| KB TypeGraph store | `src/server/kb/kb-store.ts` | 稳定 | 单例 + jieba 预分词 + FTS5 命中（中文） |
| KB HTTP service | `src/server/kb/kb-service.ts` | 稳定 | `/api/admin/kb/*` 16 路由 + `{ok,...}` 契约；lazy 加载 |
| KB 关系抽取精度 | `src/server/kb-relations.ts` + `scripts/kb-verify-stats.mjs` | 稳定 | source_quote grounding + char_interval + verify pass + A/B 工具 |

### 1.3 前端 (`src/renderer/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Pages | `src/renderer/pages/` | 稳定 | |
| Components | `src/renderer/components/` | 稳定 | 受 `react_stability_rules.md` 5 条约束 |
| Context | `src/renderer/context/` | 稳定 | |
| Hooks | `src/renderer/hooks/` | 稳定 | `useWorkspaceFileService` 已删 `prepareUserImageAttachments`（commit `2338a83`） |
| API / TS↔Rust 桥 | `src/renderer/api/` | 稳定 | Tab 作用域 MUST 用 `useTabState().apiGet/apiPost` |
| Theme | `src/renderer/theme/` | 稳定 | 详见 `tech_docs/theme_system.md` |
| i18n | `src/renderer/i18n/` | 稳定 | 详见 `tech_docs/i18n_architecture.md` |
| Analytics | `src/renderer/analytics/` | 稳定 | 详见 `tech_docs/analytics_design.md` |
| Chat Input | `src/renderer/components/chat-input/` | 稳定 | `useAttachmentHandling` 图片分支改 `copyPaths(hamuna_files)` + `convertFileSrc`；`attachmentSessionId` 参数已删 |
| CompanionWindow | `src/renderer/floating-ball/CompanionWindow.tsx` | 稳定 | 图片拖拽分支同上改写（commit `2338a83`） |
| Workspace Icons | `src/renderer/assets/workspace-icons/` | 稳定 | |
| Widget Libraries (UMD inline) | `src/renderer/components/tools/widgetLibraries.ts` | 稳定 | `widgetUmdSourceResolver` plugin 修 Vite 7 dev `?raw` "optimized info should be defined" |
| KB 图可视化 | `src/renderer/components/KbGraphView.tsx` | 稳定 | d3 force-directed 画布 |
| KB 管理面板 | `src/renderer/components/GlobalKbPanel.tsx` | 稳定 | KB CRUD + 材料入库 + workspace↔KB mount |
| KB Client | `src/renderer/api/kbClient.ts` | 稳定 | 11 个 `invoke('cmd_kb_*')`→`apiGetJson/...` 打 `/api/admin/kb/*` |
| Vite Config | `vite.config.ts` | 稳定 | `widgetUmdSourceResolver` plugin（`enforce: 'pre'`） |
| tvc-director Widgets | `src/renderer/components/tools/tvcWidgets/` | 稳定 | 11 artifact_kind 模板 + SlateboardShell + 22 测试全绿 |

### 1.4 共用 / 工具 (`src/shared/`)

| 模块 | 状态 | 备注 |
|------|------|------|
| `src/shared/*.ts` | 稳定 | renderer + server 共享类型；禁止反向 import |
| `src/shared/workspacePath.ts` | 稳定 | `workspacePathsEqual` / `normalizeWorkspacePathIdentity` |
| `src/shared/managed-codex-runtime.json` | 稳定 | 客户端 runtime 版本唯一权威 |
| `src/shared/logTime.ts` | 稳定 | `localDate()` 替代 `toISOString().split('T')[0]` |
| `src/shared/terminalReason.ts` | 稳定 | |
| `src/shared/tvcEnvelope.ts` | 稳定 | TODO #29 落地；mirror `references/step-output-schema.md` §0 |

### 1.5 CLI / 内置能力 / 脚本

| 模块 | 入口 | 状态 |
|------|------|------|
| `hamuna` CLI | `src/cli/hamuna.ts` (+ `.cmd`) | 稳定；改 MUST bump `CLI_VERSION` + 同步 skill |
| 内置 MA 小助理 | `bundled-agents/hamuna_helper/` | 稳定；改 MUST bump `ADMIN_AGENT_VERSION` |
| 内置 Skills | `bundled-skills/` | 稳定；`SYSTEM_SKILLS` 清单内改 MUST bump `SYSTEM_SKILLS_VERSION` |
| tvc-director skill | `bundled-skills/tvc-director/` | 稳定；v0.9 + agnes-video-25-mcp v0.1.3 + 严格工具契约（参数锁定 + fail-fast） |
| 雪球时间线 Skill | `skills/crawl-xueqiu-my-timeline/` | 实验 skill，未入 `bundled-skills/`，未注册 `SYSTEM_SKILLS` |
| `scripts/ensure_claude_sdk_package.ps1` | — | 稳定；`Test-SdkVersionRange` semver 三态（`^`/`~`/`exact`）|
| `scripts/ensure_rust_toolchain.ps1` | — | 稳定 |
| `scripts/download_{cuse,python,uv}.ps1` | — | 稳定；软失败（dev 模式下缺失不阻断） |
| `scripts/esbuild-bundle.mjs` | — | 稳定 |
| `scripts/bump-on-commit.mjs` | — | 稳定；pre-commit hook；amend 用 `--no-verify` 防二次 bump（见 memory `bump-on-commit-amend-no-verify.md`） |
| `setup_windows.ps1` | — | 稳定；已删 `.dev-placeholder` 占位符方案（dev 不再需要，TODO #1 废弃） |
| hosted_mcps | `hosted_mcps/agnes-video-25/` | 新增；7 tools（4 video + 3 image）；待 `.mcp.json` 切换拍板 |
| `scripts/kb-recall-test.ts` | — | 稳定；LLM dry-run 4 fixtures；auto-discover provider via `~/.hamuna/config.json` |
| `scripts/kb-verify-stats.mjs` | — | 稳定；A/B ROI 工具（无 LLM 成本，复用 production logs） |

### 1.6 文档 / 规范 (`specs/`)

| 文档 | 加载方式 |
|------|---------|
| `specs/ARCHITECTURE.md` | L2，按触发条件主动 Read |
| `specs/DESIGN.md` | L4，前端开发 MUST 读 |
| `specs/tech_docs/*.md` | L3，按模块触发 |
| `specs/guides/*.build*` | L4，按命令触发 |

---

## 2. Tauri 资源目录（dev vs build 分工）

`tauri.conf.json::bundle.resources` 在 build-script 阶段（`cargo build` / `npx tauri dev` 首次启动的 cargo build）由 `tauri-build` 校验所有声明路径必须存在。**dev 与 prod 共用同一份 bundle.resources 声明**，但 dev 与 prod 填充方式已统一：

| 路径 | 何时被填充 | 由谁 |
|------|----------|------|
| `src-tauri/resources/server-dist.js` | **dev 启动前** 与 **prod 构建前** | `tauri.conf.json::beforeDevCommand` / `beforeBuildCommand` 都已包含 `npm run build:server` |
| `src-tauri/resources/plugin-bridge-dist.mjs` | 同上 | `npm run build:bridge`（both paths） |
| `node_modules/@anthropai-ai/claude-agent-sdk-win32-x64/claude.exe` | `npm install` → `setup_windows.ps1` Step 6 | `setup_windows.ps1` → `ensure_claude_sdk_package.ps1` |
| `src-tauri/resources/{sharp-runtime, tsx-runtime, nodejs, claude-agent-sdk}` | **生产构建** | `build_windows.ps1`（dev 模式下目录必须存在但**不**放占位符） |
| `src-tauri/resources/{server-dist.js, plugin-bridge-dist.mjs}` | esbuild 打包 | `npm run build:server` / `build:bridge` |
| `src-tauri/resources/hosted_mcps/agnes-video-25/` | **生产构建** | `tauri.conf.json::bundle.resources` 新条目（`hosted_mcps/agnes-video-25`）；`${bundled:REL_PATH}` 占位符让 MCP manifest 引用 Tauri bundle sibling package，跨机器零硬编码 |
| `src-tauri/resources/cli/`、assets/、infoplist/ 等其他目录 | 与具体构建路径相关 | 由 build 脚本 + 资源 git 提交 |

### ⚠️ 已废弃：`.dev-placeholder` 占位符方案（TODO #1）

原 TODO #1（snapshot 历史版本）曾在 `setup_windows.ps1` Step 6.5/8 写入 4 个 `.dev-placeholder` 文件骗过 `tauri-build` 资源校验。**该方案已被用户明确否决**，整段逻辑已删除。dev 模式下 4 个空目录由 `setup_windows.ps1` 原步骤隐式创建；`cargo build` 的资源校验只看路径**存在**——空目录足以满足。

如果未来 `tauri-build` 进一步收紧到校验"目录非空"，则 `beforeDevCommand` 需要追加真实内容填充，但当前 **不**需要。

---

## 3. 当前 TODO（待完成）

（无 — 见 §4 最近 commit 指针）



### TODO #29 — tvc-director chatui 渲染层对齐（v0.9 跨域）✅ DONE

11 widget 模板 + verify `213 PASS / 0 FAIL / 1 WARN`；22 新单测全绿（tvcEnvelopeTransform 7 + tvcWidgets registry 4 + cssVarContract 11）。后续 follow-up：T86 commit + E2E 验证（开发模式触发 tvc-director session 推进 11 步）。

### TODO #97 — hosted_mcps/agnes-video-25/ 新 MCP 服务 ✅ DONE（待 user 拍板切换 .mcp.json）

7 tools（4 video + 3 image）全部注册；verify `12/12 PASS`；30s TVC demo 已重做（`tvc_30s_v25_final.mp4` 11.1MB / 31.136s）。**未 commit** —— 等用户拍板 `.mcp.json` 是否切换 `multimedia-creator` → `agnes-video-25` 后一起提交。

### TODO #14 — TypeGraph 重构 KB ✅ DONE（待 commit）

5 phase 全完成（schema+store+admin dispatcher+进程内化+前端 HTTP 切换+迁移+Rust 删除+测试覆盖+2 个 store bug 修复）。39 测试全绿。可独立 commit。

### TODO #16 — fresh install kb-relations poller `directory does not exist` ✅ DONE（待 commit）

`kb-store.ts::getKbStore()` 加 `mkdirSync(parent, { recursive: true })`；新增 `auto-creates parent directory when missing` 回归测试。kb-store 9/9 通过。

### TODO #12 — skill 安装后 `/skillname` "unknown command" ✅ DONE（待 commit）

新增 `src/server/utils/skill-reload.ts::evaluateSkillReload` 纯函数；`agent-session.ts::reloadLiveSessionSkills` export；install-from-url 无论 scope 都 reload。skill-reload 4/4 测试通过。

### TODO #13 — git hook 每次提交自动 bump 版本号 🔄 进行中

`scripts/bump-on-commit.mjs` + `.githooks/prepare-commit-msg` 已实现；测试分支实测：直接跑脚本 0.3.21→0.3.22、三处版本同步；真实 commit(index 已含新版本)不二次 bump。**矛盾点**：每次 commit bump patch = 版本号成 commit 计数器。**待用户拍板提交**。

### TODO #11 — GitHub Actions Windows 构建 + 传 R2 + 自动 bump 版本号 🔄 进行中

`.github/workflows/windows-release.yml` 22 步已写完。**首跑失败** "resource path ..\mino doesn't exist"——方案 B（提交 mino 进本仓库 git）落地，284 文件 / 4.6MB。`.tokensave/` 已 gitignore 排除（机器特定绝对路径）。**待办**：`commands.rs:368` `~/.hamuna/projects/mino link returns false` 与 bundle 复制逻辑的交互需验证（首启后用户可能已建过）。

### TODO #9 — xueqiu skill 重设计（九轮迭代）+ skill-creator 评测 🔄 进行中

`skills/crawl-xueqiu-my-timeline/`：Python 2 语法修复、目录重命名、CDP 自动探测、双源综合分析（关注 + 热帖）、自检脚本。**端到端实测通过**（2026-08-24）：34 条真实动态 / 24 位发言人 → `/tmp/xueqiu_20260823_20260824.md` + AI 投资分析 PDF（1.4MB，中文渲染验证通过）。**未 commit**：整个 `skills/` 目录是 untracked 新目录，跟随用户决策（是否入 bundled-skills / 单独 PR）。

### TODO #25 — tvc-director storyboard 视觉契约升级（v0.5：去黏土白模 + 6 类 layout + 三项硬约束）🚧 进行中

v0.5 物理约束落地（commit `220abea`）：storyboard objects 锚定 physics + layout hard constraints。后续扩展布局枚举 + 渲染精度。

### TODO #24 — 创建 agent 时 seed 空 `.claude/settings.json` 占位 🔄 进行中

**用户拍板**：仅空白占位（`{ }\n`），验证写入管线可用，不填 permissions/env/hooks（归产品 config pipeline）。落点：`src-tauri/src/workspace_files/memory_rules.rs::ensure_claude_settings` + `cmd_ensure_claude_settings` 命令；`ConfigProvider.addProject` agent 创建分支 fire-and-forget 调它。Rust 2 单测。**未 commit**。

### TODO #5 — desktop Bash 工具在 detached console 下 spawn headed chromium 永远 hang 🚧 进行中

未根因定位。**建议路线**：在 `cmd_bash` 入口加 stdio gate（headless：默认；headed：仅 dev 且 TTY 检测通过）+ spawn detached 子进程时 `CREATE_NEW_PROCESS_GROUP` (Windows) / `setsid` (POSIX) 防 session 残留。

### TODO #7 — 本次 Linux cuse stub 改动未 commit 🚧 进行中

`build_linux.sh::[5/6]` 自动生成 stub（`/usr/bin/true` → `cuse-${TARGET}`），trap EXIT 清理。`cargo check/clippy/build --release` ✅。**待 user 拍板提交**。

### TODO #3 — 预先存在的 unit test 失败（与 dev 启动修复**无关**）

`widgetSandboxHtml.test.ts` 等 6 个 unit test 在 master `5c92cd8` 同样失败，与本批次所有修复**无关**。**待独立排期**。

### TODO #51 — tvc-director 跨段过渡方法 + keyframe 比例约束 + grid 单场景多机位铁律（待提交）

**来源**：30s TVC 端到端实测踩坑 + 用户拍板纳入 mooko.cn/article/52 段间过渡方法 + keyframe 兜底画幅突变 + grid video 跳 panel。

**改动**（3 文件）：
- `bundled-skills/tvc-director/SKILL.md` — 第 546 行后新增 `### Keyframe 模式铁律（first_frame 兜底必读，2026-09 端到端踩坑）` 小节：`first_frame` 自身画幅覆盖 `aspect_ratio` 的根因（用户原图 1404×1046 4:3 → video 960×704 4:3，与同片 1280×720 16:9 拼接画幅突变）；agent 流程要求调 `keyframe` 模式前 MUST 先用 `image_edit` 把 first_frame 转 16:9（首选）或用 grid 第 9 格当 first_frame（次选，grid 内已 16:9）；判断捷径 `ffprobe` first_frame 实际纵横比
- `bundled-skills/tvc-director/references/storyboard.md` — Part 二「视频脉络先行」末尾加 `### 视频脉络的衔接：bridge 段` 小节：单段 12s 脉络分块 `[主叙事 10.5-11s] → [bridge 0.8-1.5s]`；bridge 在 grid 最后一格 P9；三种 bridge 子类型（同构图推进/时间流逝/尾帧延续）；无 bridge 代价（30s TVC = 12s+12s 直拼观众感到"跳"）
- `bundled-skills/tvc-director/references/storyboard.md` — Part 三「网格规格选择策略」3x3 行附注扩展 + 末尾加 `### 铁律：12s 9 panel = 同一场景不同机位（2026-09 端到端踩坑）` 小节：9 panel 不是 9 个分镜故事板而是 9 个关键帧（同一场景不同机位）；9 panel 机位分配表（P1 全景→P9 bridge）；反模式（4-5 个跳切场景 → video 跳过次要 panel）；端到端踩坑（G1 grid 4-5 场景，video 全居家消毒，跳过街景/门口/沙发）；横跨场景拆段建议（按场景拆 grid 而不是塞进 1 张）
- `bundled-skills/tvc-director/references/storyboard.md` — Part 六「多段视频的跨段连续性」末尾加 4 小节：(1) 桥接镜头法 0.8-1.5s + 三种子类型 + grid P9 位置 + 视频提示词写法；(2) 风格锁定三句（光色/材质/运动，字面复制粘贴，禁软词）；(3) 负面提示词清单（8 条最小集，含 `no BGM/no background music`，后期铺 BGM 不能让 video 自带）；(4) 节奏比例 30/45/25（建立/推进/收束）+ 与 bridge 关系（bridge 不计入节奏）

**验证**：3 文件改动无新增依赖、无新工具调用契约（仅文档扩展）。

**待办**：用户拍板后 commit（`feat(tvc-director): add segment transition methods + keyframe aspect ratio guard + grid single-scene rule`）。

### ✅ 最近完成（commit `2338a83`）— 拖拽媒体默认复制到 `workspace/hamuna_files/`

- **Rust**：删 `src-tauri/src/workspace_files/user_attachments.rs` + `mod.rs` 模块声明 + `lib.rs::run` 命令注册（`cmd_prepare_user_image_attachments` 退场）
- **Renderer**：`WorkspaceFileService.prepareUserImageAttachments` 接口 + 4 个 type + 实现 + useMemo 导出全删；`useAttachmentHandling.processDroppedFilePaths` + `CompanionWindow.processDroppedFilePaths` 图片分支从 `prepareUserImageAttachments` 切到 `copyPaths({sourcePaths, targetDir: 'hamuna_files', autoRename: true})`，preview 用 `convertFileSrc(joinWorkspacePath(workspacePath, targetPath))`；`attachmentSessionId` 参数、`PreparedImageAttachment` 类型、`resolveAttachmentUrl` 引用清理；`SimpleChatInput.send.test.tsx` mock + 断言同步更新
- **双轨**：`src-tauri/src/attachment_protocol.rs::build_attachment_response` 保留（**intentional**），服务历史 session 中 `~/.hamuna/attachments/<sessionId>/` 老引用——老对话渲染不丢，新拖拽始终进 workspace/hamuna_files/
- **Trade-off**：per-file size 校验丢失（copyPaths 信任 extension filter + 整体 batch）；后续如要恢复可在 `cmd_workspace_copy_paths` 内加 size cap
- **验证**：`tsc --noEmit` 改动的文件 0 错；`eslint <改动的 5 个文件>` 0 错；`vitest --project dom SimpleChatInput.send` **15/15 ✓**

### ✅ 最近完成（commit `51f3f98`）— 删除图片附件时同步清理 `hamuna_files/`

- **行为**：用户点击图片附件的 × → UI 立即移除（fire-and-forget，不阻塞关闭手势）→ 后台 `fileService.deleteFile({ path: relativePath })` 把 workspace 文件移到 OS 回收站（`cmd_workspace_delete` 默认走 `trash` crate，`permanent: false`）
- **范围**：仅 `source === 'attachment_ref'` + `relativePath` 存在的图片触发。`inline_base64`（截图/粘贴 dataURL）没有 workspace 文件，**不**触发 delete；2 个调用点都一致（`useAttachmentHandling.removeImage` + `CompanionWindow.removeImageDraft`）
- **失败兜底**：3 条失败路径分别 toast `workspaceFileDeleteSkipped`（桌面应用未就绪）/`workspaceFileDeleteFailed`（Rust 返回 `deleted: false` 或抛错）。UI 状态无论如何都先清空——draft 与磁盘文件 1:1 失同步时 toast 提示用户
- **Trade-off**：不弹确认模态（drag-drop 文件本来就是用户临时上传的副本；OS 回收站保底）。不接 undo stack（回退需要重新 base64-encode 图片、复杂度溢出）
- **i18n**：`input.attachments.workspaceFileDelete{Skipped,Failed}` zh-CN + en-US 各加 1 条
- **测试**：`SimpleChatInput.send.test.tsx` 新增 1 用例 `trashes the workspace file when an attachment_ref image is removed`（drop `/tmp/photo.png` → 点 × → 断言 `deleteFile({ path: 'hamuna_files/photo.png' })`）。mock 修正：`copyPaths` 返回真实 `{ sourcePath, targetPath, renamed }` shape（之前 mock 漏 `sourcePath` 触发 `Cannot read properties of undefined (reading 'split')`）。新增 `vi.mock('@tauri-apps/api/core')` stub `convertFileSrc` → `asset://localhost/...`（jsdom 没有 Tauri runtime，原 import 会抛错）
- **验证**：typecheck 0 错（仅 6 个 pre-existing tvcEnvelope 错无关）；eslint 0 错；`vitest --project dom SimpleChatInput.send` **16/16 ✓**

---

## 4. 最近已完成（指针）

详情见 git log / `git show <commit>`；此处只列 commit + 一行摘要。

| Commit | 摘要 |
|--------|------|
| `2338a83` | **feat(attachments): drag-drop media → workspace/hamuna_files**（双轨：保留历史 `~/.hamuna/attachments/` handler） |
| `db2d91f` | **fix(attachments): resolve workspace-relative paths to absolute before read_files_b64** — `ea9b524` 漏了：renderer 把 `relativePath='hamuna_files/<file>'` 直传给 `cmd_workspace_read_files_b64`，Rust `validate_external_read_path` 拒 workspace-relative → 用户实战 `工作区图片 X 读取失败：Access denied: Path must be absolute`。修复放 renderer helper（`readWorkspaceFilesAsBase64` 接 `workspacePath`，用 `joinWorkspacePath` 拼绝对路径后再下传 fileService），不动 Rust validator（其它 4 个调用点 `widgetLocalImg/AvatarPicker/Space/SpaceSettingsWorkspace` 都传绝对路径，放开 = 弱化 path-safety）。两个调用点 + `rebaseAttachmentRefPreviewsToDataUrl` 三处都加 `workspacePath` 参数；`useCallback` 同步补 deps；新加 1 用例 `throws when workspacePath is missing`。**projection 7/7 + send 16/16 ✓** |
| `368ee90` | **fix(attachments): override `source` to inline_base64 when rebasing attachment_ref** — `ea9b524` 第二轮漏的：`imagePayloadForSend` 按 `source` 分发而不是 `preview`，光把 `preview` 改成 `data:...` 不够 → 后端 validator 仍把 `attachment_ref + workspace-relative` 拒为 "Image attachment does not belong to this session"（用户实战）。同步在 rebased 对象里设 `source: 'inline_base64'`，dispatch 走 inline 分支绕开 validator，`data` 字段从 `preview.split(',')[1]` 取 base64 段。CompanionWindow 不受影响（它直接构造 payload 不过 `imagePayloadForSend`）。`projection` 7/7 + `send` 16/16 ✓ |
| `079c96f` | **docs(tvc-director): switch video model from agnes-video-2.5 to agnes-video-2.5-flash** — 用户拍板切换 + 实测 reference 模式通：4 次真实 submit（单图 190s/185s、多图 113s、img2img 5s）全部成功；中途命中 429 但窗口内自动恢复（账号日配额非秒级节流）。Flash 强约束应用到 4 文件 19 处文本 + 3 行 Phase 5 表：size 锁 720P（原可选 720P/1080P/1K/2K）、images cap ≤5（原 ≤8）、audios cap ≤3（原 ≤8）、videos 0（flash 不接受 video ref）。保留 `SKILL.md:541` 旧 model 对比行（解释"为什么选 flash"）。Trade-off：1080P → 720P 视觉密度下降；3x3 = 9 panel grid 溢出 5-image 上限，agent 后续需降采样到 ≤5 或拆 grid |
| `7191b91` | **fix(tvc-director): video prompt must reference both `<Picture 1>` (grid) and `<Picture 2>` (product)** — 用户实测发现传入 grid 但 prompt 不引用 → 锁定文档自相矛盾：README.md / README_en.md（正确：grid 锁构图/色彩、product 锁外观，prompt 同时引用两张图，reference 模式不锁首帧）vs SKILL.md / references/storyboard.md（错误：假设「reference 模式 = 首帧 + 后续自由生成」→ 推导出 prompt 只引用 product 不引用 grid）。以 README 为准修 6 处：`SKILL.md:363` bullet 强调多图必须显式引用每张图；`SKILL.md:377` Multi-Phase template 改为 `沿<Picture 1>多宫格分镜设定构图与色彩，按<Picture 2>产品多视图还原主体外观`；`SKILL.md:393` reference 模式 blockquote 加「prompt 必须同时引用 + reference 不锁首帧」明确陈述；`storyboard.md:552` 必须覆盖 + `storyboard.md:554` blockquote（删除错误声明 "`<Picture N>` 参考图映射...不用于视频提示词"，替换为「视频提示词同样适用」+「reference 不锁首帧」）；`storyboard.md:561` 输出示例 + `storyboard.md:1221` 紧凑示例同步。`grep "产品由<Picture"` 0 hit / `grep "Picture 1>多宫格.*Picture 2>产品"` 6 hit 验证无残留 |
| `66b6397` | **fix(tvc-director): set storyboard reference default seconds to 12** — SKILL.md 之前把 reference 模式定死 `seconds="5"`，但 grid 是从 ~12s 视频脉络冻结的 9 帧，`5` 等于把一张 grid 拆成 2 段断续视频，跨格连贯性被切碎。参考 agnes 文档（`hosted_mcps/agnes-video-25/SKILL.md:35` `seconds ∈ "4"–"12"` 默认 `"5"`），把 storyboard reference 默认改 `"12"`（agnes 上限，贴合 grid 9 帧语义）；保留 `∈ "4"–"12"` 范围给 brief 短时长场景（片头片尾快剪）。改 `SKILL.md:533` Phase 5 表 + `:544` range 说明附 rationale + `:594` Agent 调用示例。**端到端验证后 commit**：`mcp__multimedia-creator/agnes25_video_generate` reference 模式 + `images=[grid, product]`（1.49MB+0.86MB） + prompt 同时引用 `<Picture 1>`/`<Picture 2>` → 720P 5.166s h264 输出（`outputs/videos/e2e_video_morning_coffee.mp4` 1.95MB，116s submit）。Trade-off：单段 submit 时长 +30-60s，但减少 grid 跨格切割失真，提升 video↔分镜语义对齐。后续 agent 按 brief 总时长在 `4`–`"12"` 内调整 |
| `276d8e8` | **fix(tvc-director): set grid default unit from 15s to 12s (agnes max)** — SKILL.md / storyboard.md / treatment.md 默认把 1 张 grid 当作 15s 视频脉络冻结，但 agnes 单段 video 最大 12s（旧"一条脉络冻结"假设在 15s 下不成立，必须拆 2 段跨段连贯性断）。按 agnes 上限重规划 3 文件 13 处：新时长拆分表 12s 基线（1 grid）+ 30s（2 grid + 6s keyframe 收尾）+ 60s（5 grid 正好填满）；新规划表示例 30s 拆 G1 0-12s / G2 12-24s / G3 24-30s；新节奏表时段全部按 12s 段重写；storyboard.md 视频脉络/L103 grid 密度表/L238 切割策略/L448 运动相机示例/L620 节奏编排/L1089 切换频率/L1107+L1123 30s 模板 Phase；treatment.md Part 5 切分（0-15s/15-30s/30-45s/45-60s → 0-12s/12-24s/24-36s/36-48s/48-60s，新增 48-60s 收 - End Frame 给 60s 5 段拆法）+ 分幕剧本格式。验证 `grep "15 秒\|15秒"` 跨 3 文件 0 hit（仅保留 1 处注释"取代 15 秒旧表"）。下次 agent 写 TVC brief 自动按 12s 段拆分，不再尝试塞 15s 进 grid |
| `ea9b524` | **fix(attachments): rebase workspace attachment_ref previews to data URLs at send time** — regression 来自 `2338a83`：workspace 拖拽的 `relativePath='hamuna_files/<file>'` 触发 `validateAttachmentRelativePath` 拒为 "does not belong to this session"。Hotfix 选 renderer 侧 rebase（`readWorkspaceFilesAsBase64` + `rebaseAttachmentRefPreviewsToDataUrl` 写回 `preview=data:...`）而非协议层新增 `workspace_ref` kind：后者需 validator + attachment_protocol + SDK tool 三层协同、scope 远大于 P0 热修。`SimpleChatInput.handleSend` + `CompanionWindow.doSend` 双调用点对称改写 + try/catch toast。3 新 unit 用例（happy / read error / unavailable）；`SimpleChatInput.send` 16/16 + `userImageAttachmentProjection` 6/6 ✓。架构 follow-up 列入 TODO #98 |
| `51f3f98` | **feat(attachments): trash workspace file when an image attachment is removed** — 用户点 × → UI 立即移除 → 后台 `deleteFile` 走 OS 回收站（`cmd_workspace_delete` 默认 `permanent: false` → `trash` crate）。Gated on `source === 'attachment_ref' + relativePath`（inline_base64 不触发）；3 失败路径分别 toast `workspaceFileDelete{Skipped,Failed}`。Fire-and-forget + reducer 捕获 rationale 详见 commit message；mock 修正（`copyPaths` 返回真实 `{ sourcePath, targetPath, renamed }` shape）+ `vi.mock('@tauri-apps/api/core')` stub `convertFileSrc` 给 jsdom；1 新增 dom 用例 **16/16 ✓** |
| `c70fd60` | **fix(attachments): replace `node:path.join` with renderer-safe `joinWorkspacePath`** — 根因：`2338a83` 在 renderer 引入 `import { join } from 'node:path'`，Vite externalize `node:*` for WebView bundle → 加载 Chat 输入框即触发全局 ErrorBoundary 整页崩。修复：新增 `src/shared/workspacePath.ts::joinWorkspacePath`（renderer-safe），2 文件替换；3 新单测覆盖 POSIX / Windows / 空 relative。CLAUDE.md pit-of-success MUST 补 "renderer 禁止 import `node:*`" 红线 |
| `0f1073e` | **feat(tvc-director): enforce strict tool contract**（locked params + fail-fast + retry once） |
| `db191e2` | **fix(tvc-director): align SKILL.md to agnes-video-25-mcp v0.1.3 tool surface**（5 stale references） |
| `220abea` | **fix(tvc-director): anchor storyboard objects via physics + layout hard constraints** |
| `1d6743a` | **test(tvc-director): validate spec portability with afternoon_tea archetype + 2 PNG renders** |
| `014453d` | **feat(tvc-director): add canonical morning-rush fixture as future-spec baseline** |
| `4b5c90c` | **feat(mcp): introduce agnes-video-25 + unify media MCP under id="multimedia-creator"** |
| `7f8c60d` | **feat(extended-builtin-mcp): add `${bundled:REL_PATH}` placeholder for portable MCP args** |

更早完成的 follow-up（TODO #11—#28，TODO #29，TODO #97，TODO #14，TODO #16，TODO #12，TODO #17—#21 等）历史细节归档：见 `git log --oneline --grep="..."` 或 git show 对应 commit；CWD 当前会话主要工作是 commit `2338a83`，无需在本 snapshot 复述历史 narrative。

---

## 5. Q&A 与历史 narrative（指针）

历史 snapshot 含大量 Q&A narrative 段落（OpenAI bridge diagnostics、Linux cuse stub、Playwright-via-Bash gate、Bun → Node 迁移、bash `-i -l` 噪音、Sidecar Err 路径误杀、kb-relations stderr → stdout、kb-relations 精度升级、kb-recall-test.ts 等）。本会话 snapshot 重整已清理 narrative 段落，只保留 commit 指针。**历史 narrative 完整文本**可在 `git log -p -- snapshot.md` 回溯到重整前的版本。

---

## 6. 关键架构守门（snippet）

**CLAUDE.md 红线摘要**（详细见 `CLAUDE.md`）：

- **workspace 文件 IO 必须走 Rust invoke**：`cmd_workspace_*` 是唯一权威；Sidecar HTTP 端点（`/api/files/*`、`/agent/*`）已全部下线（PRD 0.2.7 Phase E）
- **Tab-Scoped 隔离**：每个 Chat Tab 独立 Sidecar；Tab 内 MUST 用 `useTabState().apiGet/apiPost`，**禁止**全局 `apiPostJson/apiGetJson`
- **持久 Session**：`abortPersistentSession()` 才是正确中止路径；**禁止**直接设 `shouldAbortSession = true`（generator 永久阻塞）
- **Multi-Agent Runtime**：所有 sidecar 端点 MUST 走 `src/server/session-engine/` facade（`selector.ts` 统一 adapter 分流），**禁止**手写 `shouldUseExternalRuntime()` 分支
- **Config 持久化**：写盘 MUST `await loadAppConfig()` 读最新再合并，**禁止**直接用 React `config` 状态写盘
- **Builtin MCP 懒加载**：`src/server/tools/*.ts` **禁止**顶层 import SDK/zod；MUST 在 factory / surface init 内部 `await import(...)`
- **路径安全**：Node `path-safety` 黑名单与 Rust `commands::validate_file_path` 必须同步
- **裸 `reqwest::Client::new()` / 裸 `Command::new()` / 裸 `tokio::spawn`**：clippy 强制
- **同步 `#[tauri::command]`** 不做 >1 帧工作：会冻结 macOS WKWebView UI 线程；改 `pub async fn` + `spawn_blocking`
- **WorkspacePath 比较**：用 `workspacePathsEqual` / `normalizeWorkspacePathIdentity`；Win 反斜杠 vs 正斜杠永不相等且静默（#320）

**预 commit 硬闸**（`.claude/rules`）：

1. `npm run typecheck` + `npm run test:unit`（改 `.test.tsx` 加 `test:dom`，改 session/runtime/IO/security 加 `test:classification` + `test:integration`）
2. `git status` 确认无并发 writer 混入；**禁止** `git add -A` / `git add .`
3. amend 任何 commit 一律 `git commit --amend --no-verify`（防 pre-commit bump-on-commit 二次 patch bump）
4. **禁止** `git add -f` / `git add --force` 把 ignored 文件塞进提交（PRD / research 草稿只在本地落盘）
