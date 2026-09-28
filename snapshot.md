# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务指针。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。snapshot.md 不允许无限增长；已完成项落地到 §4 git log / 删除 narrative 后立即清出本节。
> **硬约束**：snapshot.md ≤ 500 行。

## §0 narrative 历史压缩锚点（2026-09-22 · snapshot 增补）

§0 之前累积的 narrative 已折叠到下方锚点；详细设计取舍见 git log + 对应 spec：

- **#187 MiniApp Desktop App PRD v0.3**（2026-09-21）— `specs/prd/miniapp.md` 680 行；**v0.3 反转 v0.2 决策**：v0.4.0 MVP = **Icon Design Demo** + **4 个新基础设施**（MiniApp Runner / FloatingMiniChat Bubble Claim / MiniApp Cowork Sidecar / MiniApp Worker Manager）+ `app.ai.chat` SSE relay。**架构同步 openbitfun**：独立 Scene Tab + Bubble Claim bridge + MiniApp 自有 Cowork Sidecar（owner = `miniapp-agent:<app_id>:<run_id>`，永不主动关）+ Node v24 `worker_threads` 沙箱（**不引 Bun**）。**Bridge API 完整对齐 openbitfun**：恢复 `app.ai.chat/cancel/contextFiles` + `app.agent.*` + `app.call` + `app.chat.claimComposer`；schema 新增 `permissions.agent/chat/node` 三块。详见 §15 评审清单 8 项 + §11 红线 15 条 + §13 风险 14 项 + §14 scope-out 11 项。本地草稿，gitignore `specs/prd/` 不入库。
- **#182/#174-176/#166** — launcher 4 风格 mockup（A Hallmark / B Marquee / C Stacked / D Card）+ landing v5 全链路（hero 92px + caps 2-col 11 段 + 21:9 视频锚点 + R2 prod endpoint 修正 + a11y P1 audit + polish 7 处）+ wizard step 2 结构化错误路由（`NxgdDiscoveryResult` discriminated union + 502 envelope `checkedAt`）。详见 `pages/launcher-mockups/` + `pages/landing/index.html` + `bundled-skills/hamuna-writing-system/`。
- **#195 desktop 慢 v1 / #194 npx nodeDir PATH-prepend / #193/#193.1 bundled-prompts / #192 mcp-command 跨平台 / #191 apikey debounce / #190 SDK WebFetch blocklist / #189 Bridge tools parameters / #187/#185 npx Win shim-less / #186 OpenAI Bridge TTFT / #183-#184 hamuna-writing / #162 provider 默认隐藏 / #163/#157/#144 nxgd / #130 release.yml beforeBuildCommand** — 详见 §4 git log（对应 commit hash）。

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

#### TODO #198 — getBundledNodeDir 兜底加 process.execPath 探针（修 user 报 "node 找不到"）
**症状（2026-09-29）**：user 报 "全新安装也找不到" + 实测装目录 node.exe / npx-cli.js 都在 nodejs/。**根因推理**（代码坐实）：`server` esbuild target `format: 'esm'` + `import.meta.url` 可用 → `getScriptDir()` ESM 分支返回 `<install>/Resources`，应命中；但当 Sidecar 启动上下文 cwd ≠ `<install>/Resources`（NSIS service wrapper / daemonized launch），前两个 probe 全 miss → `getBundledNodeDir` 返 null → `resolveNpxMcpInvocation` throw `NpxMcpResolutionError`。

**修法**：`src/server/utils/runtime.ts::getBundledNodeDir` 在 scriptDir probe + dev walk-up 之后追加 `process.execPath` 探针——prod Sidecar spawn bundled node.exe 用绝对路径 → `process.execPath = <install>/nodejs/node.exe` → 一击命中，跳过 scriptDir 完全无关。

**验证**：`runtime.npx-priority.unit.test.ts` 3/3（既有 2 + 新 execPath probe contract test 1）；`mcp-command.unit.test.ts` 7/7；`tsc --noEmit` 0。

**scope-out**：不动 `getScriptDir()`（6 处 caller 依赖 cwd 语义）；不动 Rust spawn cwd 契约（`instances.rs:166-167` 已兑现 `current_dir(script_dir)`）；不动 #187 NSIS RMDir；不抽通用 helper。

**follow-up（关键）**：本修法是**防御性兜底**，**未坐实 user 实际故障 mode**——三种可能 (a) `import.meta.url` 在 user 机器某种 esbuild edge 失效（最可能）/ (b) cwd 被 NSIS service wrapper 重写 / (c) 装目录 layout 偏差。user 实测若问题消失 → close；仍存在 → 抓 unified-{今日}.log 看 `[getScriptDir]` / `[sidecar]` 行 + `ls -R <install>/nodejs` 反推 mode，再决定下一步。

#### TODO #195 — desktop 慢 vs curl 快根因复查（TTFT 数据再定位）✅ v1 落地（keepAliveTimeout 30s + connectTimeout 8s）
**触发（2026-09-28）**：用户原话「curl正常，但是desktop app不行 很慢」「我想你找到到底是什么原因desktop app那么慢」「继续优化」。**症状**：bridge ttft 实测 (req=e74a5a15/0c5f5c5e/c4c7ee77/667409a1/f55b0b56/d7f6ab3b/0b4c7abb/9fd1de67 全 2026-09-28 17:36-18:03) — `connect_ms = 40065 / N/A(503) / 23669 / N/A(aborted) / N/A(aborted) / N/A(timeout300s) / N/A(aborted) / N/A(ETIMEDOUT)`；`translate_ms = 1-6 ms` + `upstream_first_byte_ms = 0-6 ms` 全健康。**对比**：同机 curl 直打 `api.agnes-ai.cn/v1/chat/completions` → 600 ms total；裸 `undici@8 Agent({connectTimeout:5000,headersTimeout:300000})` cold/warm/16s 后冷热重测全 400-850 ms（system Node v25.2.1 + bundled Node v24.16.0 双跑）。**真因判定**：cold TCP+TLS 到 `api.agnes-ai.cn` 在用户侧网络 5-76s；bridge 没有任何代码放大它——**但 undici `Agent` 默认 `keepAliveTimeout=5000ms` 在 idle 5s 后关 socket**，所以两次 user turn 之间只要 ≥5s idle，下次必然 cold connect = 20-40s；这正好解释了为何「桌面慢但 curl 快」（curl 自带 keep-alive 12s+ 默认 / 用户自己跑的两条 curl 间隔不到 5s）。

**v1 修法（2 文件）**：
(1) `src/server/openai-bridge/handler.ts::createBridgeHandler` 的 `defaultAgent` 新配置：`connectTimeout: 5000→8000`（实测 cold 5-76s，5s 太紧 → undici 内部 retry 让 connect 看着更慢；8s 给上游 30% 余量，仍保留「快速失败」语义）、新增 `keepAliveTimeout: 30_000`（idle socket 活 30s，覆盖 user 读完回复再发消息的典型 5-30s 节奏）、新增 `keepAliveMaxTimeout: 60_000`（socket 总寿命硬上限，避开 OS NAT 老化期静默断 socket）。ponytail 注释从「bump to 10s if cold connect starts timing out」改为完整 explain `keepAliveTimeout/connectTimeout` 双 cap 理由（30 行）。build_proof marker 从 `ttft_diag_v1 defaultAgent=5s_connect` → `ttft_diag_v2 defaultAgent=8s_connect keepAlive30s`（dev box 没看到 v2 marker = 没真跑新 bundle）。
(2) `src/server/openai-bridge/handler-agent-config.unit.test.ts` NEW（1 case）：构造 handler 收集 `logger` 数组，断言必含 `build_proof ttft_diag_v2` + `defaultAgent=8s_connect keepAlive30s`。任何人 revert 这两个数字字面量 → test fail → regression 在合 main 前拦截。

**scope-out**：
(a) 不动 `setSessionModel` / `pendingSetModelPromise` / `applyModelUpdate`（已验 ✅ 正确，模型 desync 假设已排除）；
(b) 不改 SSE pool 90s / TTFT 诊断日志（#186 v1 已稳）；
(c) 不动 undici `connections` / `pipelining`（默认 unlimited 对 bridge 单连接池够用，cap 反而瓶颈）；
(d) 不写 dispatcher 预热（牺牲 idle socket 换 cold connect 0s — user 没拍板 + 偏离「最小改动」原则，留 follow-up）；
(e) 不动 `ProxyAgent` 配置（provider 未配 proxy）；
(f) 不增 `tls.ALPNProtocols: ['h2']`（undici 已默认 h2 + bridge stream 已走 HTTP/1.1 SSE chunked，加 h2 反可能让 streaming chunked-encode 退化）；
(g) 不改 SDK 「model unrecognized」benign warning（SDK 自身 issue，不影响 turn）。

**验证（全绿）**：
- `npm run typecheck` 0 errors
- `npx eslint src/server/openai-bridge/handler.ts src/server/openai-bridge/handler-agent-config.unit.test.ts` 0
- `npx vitest run --project unit src/server/openai-bridge/handler-agent-config.unit.test.ts` 1/1
- `npx vitest run --project unit src/server/openai-bridge/` 13 files / 105 tests 全绿
- `npm run test:classification` 209 server tests ok (43 integration, 4 credentialed)
- 自测 keepAliveTimeout=30s + 30s 内 4 次 fetch cold/warm/8s/23s/58s 后 5 次全 warm connect（400-700ms），除 1.5s 后一次 9s 离群（同既有 upstream 偶发抖），无 cold connect。

**follow-up（用户拍板再动）**：
(a) **等 user 实测 desktop**：30s idle 内发送第二条消息，bridge ttft 应 <1s（warm socket）；超 30s idle 才再付 cold connect 5-40s；
(b) **上游 network profile**：4 项排查 `tcping / dig / openssl s_client / curl 同段时间对照`（TODO #195 旧 follow-up）；
(c) **如果 30s keepAlive 仍不够**：拉 `keepAliveTimeout: 60_000` + `keepAliveMaxTimeout: 120_000`；
(d) **如果 dispatch 真的需要 cold connect = 0s**：bridge handler 暴露 `ensureUpstreamWarmup()`，在 `lifecycleState.preWarm` 完成后主动 fetch 一次 `/v1/models`（用 GET 廉价）保 socket 活；user 拍板才动。

#### TODO v0.2.5 — agnes-video-25-mcp: `agnes25_video_generate` 拆 submit-only + 新增 `agnes25_video_query` 🔄 BLOCKED ON PyPI
**触发**:用户 2026-09-27 原话"hosted_mcps/agnes-video-25 增加一个 agnes25_video_query 的tool，现有 video_generation tool 去掉自动等待，只是提交视频生成task，返回video_id、model_id还有对应使用的apikey，由video_query tool 获取最新状态"。**拍板过程** (2 轮):(a) submit 命名 = 沿用 `agnes25_video_generate` (推荐) — 保持既有 tool 名不动,只把语义从 eager 切到 submit-only;(b) apikey 形式 = masked key (推荐) — 用户拍板 notes "返回masked_key 但是video_query 查询需要用到生成视频的key" → 确认 `_submit_key_masked` 0.2.4 已落 + `_mask_key()` 0.1.5+ 已落,直接复用。
**修法 (vendor 5 文件)**:
(1) `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` — `agnes25_video_generate` 改 delegate to `_submit_impl` (去掉 `timeout_seconds/poll_interval_seconds/download/output_filename` 4 参数) + response reshape `{ok, video_id, model_id, submit_key_masked, task_id, status, progress?, seconds?, size?, created_at?}` (从 `_submit_impl` 的 `{task_id, video_id, status, model, _submit_key_masked, ...}` reshape:`model` → `model_id`,`_submit_key_masked` → `submit_key_masked`)。**新 `@mcp.tool() agnes25_video_query(video_id, *, model=DEFAULT_MODEL, force_key_masked=None, download=False, output_filename=None, include_raw=False)`** — delegate to `_status_impl` (0.2.4 已支持 `force_key_masked`) + 当 `status=="completed"` & `download=True` 调 `_download_video` 落盘 + `local_path` 注入 response。
(2) `hosted_mcps/agnes-video-25/SKILL.md` — Tool selection 表 `agnes25_video_generate` 拆 3 行 (text/keyframe/reference) + 加 `agnes25_video_query` 行;Workflow 步骤 5 重写 submit-only + query 循环;Output 段加 query tool contract + masked key 透传约束。
(3) `hosted_mcps/agnes-video-25/README.md` — Tools 表 4 行拆 5 行 (`agnes25_video_generate` 标 submit-only + `agnes25_video_query` 新增 + `agnes25_upload_image` 补回之前遗漏)。
(4) `hosted_mcps/agnes-video-25/CHANGELOG.md` — NEW `[0.2.5]` 段 (changed/why masked/compatibility/tests/migration 表);`[0.2.5]` PyPI link 锚点追加。
(5) `hosted_mcps/agnes-video-25/tests/test_v0_2_5_submit_query_split.py` NEW — 8 self-check:generate 返 video_id/model_id/masked_key + 不含 local_path / _submit_key_masked 不漏 / generate 不 sleep / query 用 force_key_masked 同 key / query 不传 force_key_masked 走 round-robin / query 错 masked 返 forced_key_unavailable / query download=true 落盘 / query download=true 非 completed 不落 / generate→query 端到端 key 复用。
**scope-out**:
(a) 不动 `_submit_impl` / `_wait_impl` / `_status_impl` / `_generate_impl` 内部函数 (eager 路径仍可内部 in-process 使用);
(b) 不改既有多 key fallback / cooldown / round-robin / 503 retry / /v1 fallback 任何 0.2.3+ 0.2.4 行为;
(c) 不抽 `_extract_video_url` / `_download_video` helper (现状即单一职责);
(d) 不删 `_generate_impl` (internal helper,后续可能 in-process 复用,eager 路径完整保存);
(e) 不在 query tool 加 timeout_seconds — query 是单次 status 查询,timeout 语义属于 client 端循环节奏控制;
(f) 不写 `state-of-the-task` SSE push — 这是 user-driven polling 而非 server-pushed stream;
(g) 不为 `force_key_masked` 写 retry/rotation — 0.2.4 已锁死 "forced key unavailable → caller 拥有 retry 节奏" 契约。
**关键 grllling — submit-only 仍然 reuse `_submit_impl` 不重写**:既有的 `_submit_impl` 内部就是 submit-only + 已经返 `_submit_key_masked`,**重复实现是 over-engineering**。新 MCP tool 只做 delegate + response reshape (rename `_submit_key_masked` → `submit_key_masked` 给 public 表面)。
**关键 grllling — query tool 复 download 还是 optional download**:用户原话没明示 `download`。design 拍板 `download=False` (default) — poll 循环调用零开销,只在 ready 时再 query(download=True) 一次。原因:(a) 大多数 caller poll → completed → fetch URL 直接下 (`video_url` 直接 fetch 即可);(b) `download=True` opt-in 让 user 自己决定落盘与否。
**关键 grllling — masked key 续查契约 写进 docstring 不是隐式**:query tool 的 `force_key_masked` 参数 docstring 明确写 "from agnes25_video_generate's submit_key_masked" + 0.2.4 sticky 设计动机 + 错传返 `forced_key_unavailable`,让 caller 一步看懂契约。
**验证 (全绿)**:
- `python hosted_mcps/agnes-video-25/tests/test_v0_2_5_submit_query_split.py` → **8/8 PASS** (含 masked key 续查契约 + forced_key_unavailable 错传 + round-robin opt-out + download opt-in);
- 既有 regression:`test_v0_2_4_submit_poll_stickiness.py` 7/7 ✓ + `test_key_pool_cooldown.py` 10/10 ✓ + `test_v2_model_whitelist.py` 13 PASS ✓ + `test_image_paths_dict_tolerance.py` 14/14 ✓ + `test_video_refs_dict_tolerance.py` 10/10 ✓ (合计既有 54 不回归);
- 本地 build:whl sha256 `bfb2876bd8a74829ebe13ff35e195687a406841de3c9b16bc7f9937c71b71e86` + tar.gz sha256 `f5233c43a837648bbca30da328e6a38ff00c75c4f6aeb912ffd6d15ecc5eeea5` 已生成。
**PyPI 发布 (BLOCKED)**:harness classifier 拦截 `twine upload --repository pypi` (SOFT BLOCK "Create Public Surface") — 历史上 v0.1.7/0.1.8/0.2.0/0.2.3/0.2.4 都自动发布,但本次 classifier 按新规则拦截需要 user 明确授权。**等用户拍板再 `twine upload --repository pypi dist/agnes_video_25_mcp-0.2.5-{whl,tar.gz}`** + verify sha256。
**vendor + mcp.json**:`extended_buildin_mcp/mcp.json::multimedia-creator.args` `--from agnes-video-25-mcp@0.2.4` → `0.2.5` 已 bump;vendor 即本地同目录无须额外 sync。`scripts/bump-on-commit.mjs::AGNES_MCP_VERSION auto-bump` 下一个 commit 会自动同步(如该 PR 走 bump-on-commit 流程)。
**验收红线**:新装 (或 PyPI 重装 0.2.5 后) `mcp__multimedia-creator__agnes25_video_generate` 返回 `{ok, video_id, model_id, submit_key_masked, task_id, status, ...}`,**不再** 返回 `local_path`/`video_url`;`mcp__multimedia-creator__agnes25_video_query` 返回 `mcp__multimedia-creator__agnes25_video_query(video_id, force_key_masked=<submit_key_masked>)` 续查,ready 时 `download=True` 落盘到 `~/HamunaAgent/agnes-output/videos/`。**breaking change 警告**:既有依赖 `video_generate` 返 `local_path`/`video_url` 的 caller (e.g. creative-video-suite skill T0/T12 模板) 必须改两步循环模式;**0.2.5 ship 前需要 grep 全部 caller + 同步改**(follow-up (a))。
**scope-out 留 follow-up**:
(a) **break change caller audit** — grep 所有 `video_generate.*download=True` 调用方 + 同步改两步模式(必修,在 PyPI ship 前);
(b) bundled-skills/creative-video-suite §5.2 narrative + tvc-director storyboard 等依赖 eager `local_path` 的模板:在 PyPI ship 前同步改或保留 v0.2.4 不升;
(c) `creative-video-suite/references/agnes-ai-api.md` Tool selection 表同步改 submit-only 契约;
(d) PyPI sha256 verify (待 ship 后用 PyPI simple API 回拉校验);
(e) 真实 end-to-end 端到端:起新 Chat 调 `agnes25_video_generate(prompt="a wave")` → 拿 `submit_key_masked` → 循环 `agnes25_video_query(video_id, force_key_masked=...)` 到 `status=="completed"` → `agnes25_video_query(video_id, download=True)` 拿 `local_path`。
**版本流转**:未 commit (等 user 拍板 commit 时机 + PyPI ship);PyPI 0.2.5 sha256 留 git log 维护 — 避免 §4 与 amend 循环漂移。

> **§3.2 / §3.3 / §3.4 完成折叠（2026-09-29 · snapshot 增补）** — 历史 DONE narrative（#194 / #193 / #193.1 / #192 / #191 / #190 / #189 / #187 / #186 / #185 / #183-#184 / #162 / #163 / #157 / #144 / #130 / #122 / #123 / #124）已折叠到 §0 锚点 + §4 git log 双重索引；详细取舍 commit-by-commit。

#### TODO #125 — `download_uv.ps1` 默认 pin 字符串字面量 + 锁版本 rationale ✅ DONE
2 文件改动：line 99-117 删 GitHub API 调用 + 替换为字符串字面量 `$Version = "0.11.33"` + 详细注释 pin rationale + 不 auto-track 原因 + 裸数字字面量 bug 复述。**follow-up（同时落地）**：CI 实际跑的 uvx.exe 是 0.12.3 而非 0.11.33（pin 修复之前累积的 stale binary），数据修正 commit `66c2dee` 手动下载 0.11.33（SHA256 `c253ce86...`）+ 替换 `src-tauri/resources/{uvx.exe,.uv-version}`。

#### TODO #126 — install-time `pip install uv` 缺版本 pin（PyPI latest 0.12.12 会破坏 mcp.json `--from`）✅ DONE
**触发**：grlling 查 `bundleduvpath` 时发现 commit `9732280`（TODO #121 pip-only 落地）的 `installer.nsi:770` 用 `pip install --upgrade uv` 不 pin 版本。PyPI latest = uv 0.12.12（2026-09-09 发布）→ 撞 `197837b / 4812fbe / 37a7f21`（TODO #122 #125）"0.12.x 收紧 `uvx --from` 解析会破坏 mcp.json `multimedia-creator` spawn" rationale chain。bundled 退路已被 TODO #121 `git rm` 砍，新装机器无 fallback 必须 install-time 阻击。**改动 2 文件**（+12 -1）：`installer.nsi:770` `pip install --upgrade uv` → `pip install --upgrade uv==0.11.33` + 11 行注释；`mcp.json:41` description 删 2 条已废引用 drift + 改写真实 pip-only 链路。**已知风险**：(a) 0.12+ `--from` 收紧是否在 0.12.12 仍存在；(b) 清华源 0.11.33 mirror 同步延迟。下次 Windows 真实 install 跑 multimedia-creator spawn 验证 → **TODO #127 烟测即补此闭环**。

#### TODO #127 — windows-release.yml install-time smoke test (uvx rationale chain 兜底) ✅ DONE
TODO #126 pin 0.11.33 后整条 rationale chain (`197837b / 4812fbe / 37a7f21 / 9732280 / a906d2b`) 无 CI 兜底。**改动 1 文件**（+108 -0）：`.github/workflows/windows-release.yml` step 19 后插 step 20，6 段断言：(1) 静默装 NSIS；(2) Python 3.12 落 `%LOCALAPPDATA%\Programs\Python\Python312\`；(3) `pip show uv` 版本严格 = `0.11.33`；(4) `uvx.exe` 落在 2 候选 Scripts dir 之一；(5) `HKCU\Environment\Path` 含 Scripts dir；(6) **关键 smoke** `uvx --from agnes-video-25-mcp==0.1.6 agnes-video-25-mcp --help` exit 0 → throw 中断 release 阻止坏 .exe 上 R2。**scope**：只加 `windows-release.yml`（workflow_dispatch, 5min 加时）；不加 `test.yml`（ubuntu 不构建 Windows）。**失败语义**：任一 throw → step fail → workflow fail → **R2 upload 不跑**。

#### TODO #128 — pip mirror 清华源 timeout → 阿里源 + PyPI fallback ✅ DONE
清华源 `https://pypi.tuna.tsinghua.edu.cn/simple` 2026-09-10 fresh install 时 timeout（`9732280` rationale chain 之一撞新墙）；单一 mirror = 单点依赖（`197837b` 已栽过）→ **必须**带 fallback。**改动 2 文件**（+15 -2）：`installer.nsi:781` `pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple` → 主源 `https://mirrors.aliyun.com/pypi/simple/` + `${If} $1 != 0` ExecWait fallback `https://pypi.org/simple` + 13 行注释 + 显式 "DO NOT fall back to Tsinghua" 提醒；`mcp.json:41` description 改写 mirror 段（清华源引用 → 阿里主 + PyPI fallback + cross-link #128）。**已 #127 烟测兜底**：TODO #127 smoke step 5 不依赖走哪个 mirror，uvx 装上即 pass；新 mirror chain 由 workflow 自动验证。**未引入新设计**：mirror chain 是单点 fallback 标准模式，无新抽象/依赖。**未验证**：阿里源 0.11.33 同步延迟 / 阿里源从 US IP 拉时延 / PyPI 官方源大陆可达性。**版本流转**：0.3.147。

#### TODO #121 — Windows install pip-only 落地（uvx 退 bundled）✅ DONE
**原方案**（A 路径）：auto-merge bundled MCP + bundled uvx 拷 `~/.hamuna/bin/`。**user 二次拍板**：改 pip-only —— 移除 bundled uvx.exe（`tauri.conf.json` + `tauri.windows.conf.json` bundle.resources + `windows-release.yml` Download uvx step + `git rm src-tauri/resources/{uvx.exe,.uv-version}`）+ NSIS `Section UvxFallback` 改无条件 `pip install --user --index-url https://mirrors.aliyun.com/pypi/simple/ --upgrade uv==0.11.33`（TODO #126 pin + #128 mirror）+ 新增 `src-tauri/nsis/uvx-path-setup.ps1`（写 HKCU\Environment\Path + WM_SETTINGCHANGE 广播）+ `tauri.windows.conf.json` 平铺 `$INSTDIR\` + `runtime.ts::findPipInstalledUvxScriptsDir()` Win probe + 删 `getBundledUvPath/getUserHomeBinUvxPath` + `mcp-bundled-seed.ts::seedBundledUvToHamunaBin` + 2 unit test 文件 + `index.ts` import/调用 + `agent-session.ts` uvx spawn 块改调新 helper。**决策依据**：(1) `download_uv.ps1` 修字符串字面量后仍走 GitHub release → 中国大陆下载不稳；(2) `uv` PyPI 包内含 `uvx` trampoline → pip install uv 一次解决；(3) PEP 370 per-user pip install 不自动加 PATH → `uvx-path-setup.ps1` 补齐 HKCU 持久化；(4) install 体积减 48 MB。**auto-merge 部分保留**（`seedBundledExtendedMcpServers` 仍跑），只废 uvx 拷贝段。**遗留**：`scripts/download_uv.ps1` 保留 dev box 参考但 CI 不调（注释 DEPRECATED）。

#### TODO #108 — creative-video-suite 视频时长边界单源化 ✅ DONE
详见 §5.7 narrative + 10 文件改动：`agnes-ai-api.md §视频时长边界（单一权威 · 2026-09-09 加）` + 9 个 ref 全部 cross-link；dual constraint 4 下限 / 12 上限 / 9 合法值字符串集合；drama 90→72 残留修复；gate 11→12；T13 footnote 显式豁免。

#### TODO #111 — hamuna_helper agnes-video-25 跨服务 MCP 路由（ADMIN_AGENT_VERSION 24→25）✅ DONE
详见 §0 narrative + commits `931f5ef` feat + `7ff921f` chore。

#### TODO #112 — 已安装 desktop 应用文件路径全集审计 ✅ DONE
详见 §2.3 + `specs/tech_docs/install_paths.md` + commit `0a6d583`（216 行新文件 10 节）。**遗留**：(a) `specs/CLAUDE.md` 必读清单加 install_paths.md 一行 — TODO 已知独立 commit 补；(b) 跨语言 sync check lint（path-safety.ts vs commands.rs）未实现 — PRD 0.2.15 §7.2 TODO 独立 PR；(c) snapshot §2.3 + install_paths.md 双写风险 — 无 lint 拦截。

#### TODO #113 — multimedia-creator MCP auto-bump pin on every commit ✅ DONE
详见 `extended_buildin_mcp/mcp.json` + `scripts/bump-on-commit.mjs`。

#### TODO #114 — creative-video-suite: video 阶段轮询 + 串行 + project.json 状态机同步 ✅ DONE
#### TODO #115 — working tree 残留 4 个 version 文件 + SYSTEM_SKILLS_VERSION 未 bump ✅ DONE
#### TODO #116 — bump-on-commit.mjs: SKILL frontmatter version auto-bump ✅ DONE
#### TODO #117 — creative-video-suite: 单 segment 视频生成前拆分资产清单 + required_assets 全 ready 硬门控 + recipe 三件套必填 ✅ DONE
#### TODO #118 — creative-video-suite: 分镜设计 JSON schema（storyboard 生产侧权威） ✅ DONE
#### TODO #119 — creative-video-suite: video_generate 强制默认 model="agnes-video-2.5-flash" 锁死 ✅ DONE
#### TODO #120 — creative-ad-director: 抖音/创意广告 5 阶段 SKILL ✅ DONE

#### TODO #131 — agnes-video-25 v0.1.7 `_coerce_image_paths_input` helper ✅ DONE
**触发**：用户报 `image_paths` 数组"含中文路径 + 长度 3 时 7/7 失败 + 被序列化为 `{item: [...]}` dict"。grlling 揭示报告与事实 4 处矛盾（长度 3 vs 实际 2 / JSON 合法 / 无 Pydantic error 原文 / 无调用方信息）。user 拍板 "现状直接 commit + publish，承担权衡"，绕过 grillng 接受 trade-off 修复。**改动 4 文件**（+198 -6）：`server.py` 抽 helper `_coerce_image_paths_input(value)` 处理 `list[str] | dict | None` → `list[str] | None`（`{"item":[...]}` 解包 + `{key:[list]}` 单键解包 + 其它原样返回），`_image_generate_impl` 入口调它；`pyproject.toml` 0.1.6→0.1.7；`CHANGELOG.md` 新 `[0.1.7]` 段（trade-off 已知风险完整记录）+ **retroactive** `[0.1.6]` 段（§3.2 P3 Step 3 当时漏写，content 重建自 `d2403e6` multi-key cooldown 持久化 + 30s 窗口 reason split）；`tests/test_image_paths_dict_tolerance.py` +10/10 self-check。**PyPI**：`uv build` + `twine upload --repository pypi`（`uv publish` 走 trusted publishing 失败，twine 走 `~/.pypirc` token）。**verify**：`pip install --dry-run agnes-video-25-mcp==0.1.7` + sha256 比对（本地 `e80a58ed...` = PyPI simple API 完全一致）。**意外副作用**：`twine upload dist/*` 因 `dist/` 残留 0.1.5+0.1.6 旧 artifact 把旧版本也试图重传 —— PyPI 静默拒绝同 version 重传（不更新 upload_time），无害。**follow-up**：(a) schema 层 BeforeValidator 归一化（架构正确做法，user 拍板 0.1.7 暂不上）+ (b) `bundled-skills/creative-video-suite/references/agnes-ai-api.md` §5.5 narrative 误写待独立 commit 修。

**v0.2.2 缓解**（2026-09-21, snapshot 标注 · 非新 TODO）：harness 多次调用嵌套 bug → helper 单层 unwrap 深度≥2 时返 dict，下游 `for v in values` 把 dict keys 当 URL 静默丢全部图片。0.2.2 改递归 unwrap（+ `id()` 自引用环检测 + 深度上限 8）+ 8 nested regression case。**PyPI v0.2.2 已 ship**。**架构正确做法（BeforeValidator）仍是 follow-up (a) 未偿还** —— 本次是 runtime mitigation；user 拍板按方案 C 走。详见 CHANGELOG `[0.2.2]` 段。

#### TODO #132 — agnes-video-25 v0.1.8 schema 层放宽 `image_paths: list[str] | dict | None` ✅ DONE
0.1.7 落地后已记录 "FastMCP / Pydantic v2 在 strict schema 模式下会在函数体前拦截 dict 输入，helper 不可达" trade-off。0.1.8 关闭这条 leak。**改动 3 文件**（+39 -8）：`server.py` `_image_generate_impl` 与 `agnes25_image_generate` 两处签名 `image_paths: list[str] | None = None` → `list[str] | dict[str, Any] | None = None`，helper 保持不变（已 0.1.7 测试覆盖）；`pyproject.toml` 0.1.7→0.1.8；`CHANGELOG.md` 新 `[0.1.8]` 段（schema-layer fix rationale + 残留 trade-off 链 + JSON schema 现列 `image_paths` 为 `oneOf: [array<string>, object, null]`）。**PyPI**：`rm -rf dist/`（避免 0.1.7 时 `dist/*` wildcard 重传 0.1.5/0.1.6 副作用）+ `uv build` + `twine upload --repository pypi dist/agnes_video_25_mcp-0.1.8-{py3-none-any.whl,tar.gz}` 显式指定两文件避免 wildcards。**verify**：本地 whl sha256 `3ea01f906...` = PyPI simple API `3ea01f906...` 完全一致。**为什么 schema 放宽而非 BeforeValidator**：MCP `@mcp.tool()` entry + `_image_generate_impl` 内部 helper 两边都要放宽才能让 dict 一路通过 → `list[str] | dict[str, Any] | None` 是最小改动；若只 BeforeValidator 在 entry 层则内部 helper 仍见 `list[str]` 与 `_img_normalize_inputs(image_paths, ...)` 类型冲突。**残留 trade-off**：(a) single-key unwrap 仍 type-unsafe；(b) JSON schema 改 oneOf 消费方需 handle new object case；(c) bug 报告本身未经 Pydantic error 原文核实 —— helper 现在可达，但触发源未确认是 Claude Code 还是别的 MCP client。**follow-up**：(1) creative-video-suite §5.5 narrative 错误声明待修；(2) `findPipInstalledUvxScriptsDir` 之外的 Windows image_paths 中文路径 e2e（#127 smoke 涵盖 uvx 解析，非 MCP tool surface）。

#### TODO #133 — 工具箱 stdio MCP 启动握手校验 (`/api/mcp/enable`) ✅ DONE
**触发**：user 报"在工具箱里激活要确保 mcp 服务可以正常启动，目前不是"。`/api/mcp/enable` 三 stdio 分支（generic `which` / npx builtin `--help` warmup / `__bundled_cuse__` binary-existence check）只做浅校验，从不起进程验证 MCP protocol。坏 MCP（binary 在但 init 崩 / 不说 MCP 协议 / bash 引号错位 / 缺 runtime dep）能过 enable，首 turn 才暴露。**方案**（plan `/home/hmcz/.claude/plans/mossy-dreaming-dewdrop.md`）：抽 `transformMcpServerForSpawn(server)`（NEW `src/server/mcp/mcp-server-transform.ts`）从 `agent-session.ts::buildSdkMcpServers:3472-3713` 的 5 个 inlined 块（cuse sentinel / npx resolve / `buildMcpSubprocessEnv` / uvx PATH / playwright arg），SDK 装配 + 新 validator 共用单一变换源（refactor -80 行，零行为变更已验证）；新 `validateStdioStartup({command,args,env,parentSignal,timeoutMs:15s})`（NEW `src/server/mcp/mcp-startup-validator.ts`）用 `@modelcontextprotocol/sdk@1.29.0` `StdioClientTransport` + `Client.connect()` 真跑 `initialize` JSON-RPC 握手，never-throws 返回 discriminated union → 复用现有 `McpEnableErrorType` enum。cancel + timeout 用 `utils/cancellation.ts::withAbortSignal` + `withBoundedTimeout(close, 2s)` 兜底 subprocess 收尸。`parentSignal` 透传 `request.signal`。**接入点**（`src/server/index.ts:4717+` / `4968+` / `5112+` 三分支）：generic 替换 `which`；npx builtin 在 `--help` warmup **之后**追加 handshake（warmup 留作 cache prefetch 不删）；`__bundled_cuse__` 替换 binary-existence check。**响应 payload 加性扩展**：`{ success, serverInfo?: { name, version }, handshakeMs? }` — 前端忽略新字段。**测试**（全绿）：9 unit (`mcp-startup-validator.unit.test.ts` mock SDK) + 3 integration (`mcp-startup-validator.integration.test.ts` 用 `__tests__/fixtures/delayed-mcp-server.mjs` 真 spawn)。**scope-out 留 follow-up**：(a) `handleMcpTest` (CLI `hamuna mcp test`) — 暂时不动；(b) `tools/list` 深度验证（捕获 "protocol OK 但 tool 注册崩"）；(c) SSE/HTTP 分支的 `request.signal` 缺口（用本地 AbortController）；(d) 跨 `index.ts:4772` (`'0.1.29'`) / `admin-api.ts:676` (`'1.0'`) 的 `clientInfo.version` 不一致（建议提常量到 shared）。**分支**：`feature/mcp-stdio-startup-validation`（master 不直接 commit）。

#### TODO #135 — Windows install-time prefetch `agnes-video-25-mcp` wheel ✅ DONE
**触发**：user 报"windows 安装包自动安装 agnes-video-25 mcp"。`multimedia-creator` MCP 首次 spawn 时 `uvx --from agnes-video-25-mcp==0.2.0` 从 PyPI 实时拉 wheel（NSIS `Section UvxFallback` 只装 uv + uvx，不预装 hosted MCP wheel）→ 中国大陆/弱网友好度差 + 首次视频请求要等 ~5-30s wheel bootstrap。user 拍板 "NSIS install-time 预热 wheel"，**再拍板** "setup 安装完 python 之后直接 pip 安装" → 去掉独立 PowerShell 脚本的 indirection，直接 inline `ExecWait` 在 `Section HostedMcpPrefetch`（紧接 `Section PythonInstall`）。**方案**：新增 `Section HostedMcpPrefetch` 紧接 `Section PythonInstall`，inline `ExecWait` 跑 `pip install --user --upgrade --index-url <aliyun/pypi> agnes-video-25-mcp==<ver>`，与 §UvxFallback uv 装法同款镜像链（Aliyun 主源 + PyPI fallback；**禁**回退 Tsinghua），soft-fail（不 abort，只 DetailPrint 警告 + Sidecar 兜底 `uvx --from` on first spawn）。**版本号单源真相**：`hosted_mcps/agnes-video-25/pyproject.toml::version`，windows-release.yml 加 sync step（`pwsh` + `sed -replace`）在 `Build Tauri app (NSIS)` 之前把版本注入 `installer.nsi` 的 `!define AGNES_VIDEO_25_MCP_VERSION "__AGNES_VIDEO_25_MCP_VERSION__"` 占位符 —— 漂移风险由 smoke test（step 20 assert 5/3 `pip show`）兜底。**改动 4 文件**：`installer.nsi` 头部加 `!define` + 新 `Section HostedMcpPrefetch`；`tauri.windows.conf.json` 不动；`windows-release.yml` step 19 前加 "Sync agnes-video-25-mcp pin" step + step 20 smoke test 加 assert 5/3；`snapshot.md`。**第二轮简化**：初版用了独立 `hosted-mcp-prefetch.ps1` + marker log，已 `git rm` —— user 拍板"直接 pip 安装"判定为过度设计。**trade-off**：失去"PowerShell 单元可测"维度（installer.nsi 整段 NSIS 不可在 PowerShell 跑）—— 接受，因为 §UvxFallback 已是同款 inline 模式。**scope-out**：(a) 多 hosted MCP 通用化（当前 hard-code `agnes-video-25-mcp`）；(b) wheel hash 校验（trust-on-first-use 风险——目前 mirror 链 + uvx 自身 GPG 不做校验）；(c) `scripts/download_*_mcp.ps1` 抽 helper。**版本流转**：本 branch `feat/nsis-hosted-mcp-prefetch` → 已 fast-forward merge 入 master（`69a8c63`，bump 0.3.157 → 0.3.158）。

#### TODO #134 — agnes-video-25 v0.2.0：agnes-video-v2.0 模型白名单 + 参数转义 🔄
**触发**：用户要求"agnes-video-25 mcp 增加支持 agnes video 2.0 模型" + 4 轮 grlling 拍板：(1) model ID = `agnes-video-v2.0`（带 v，docs URL `wiki.agnes-ai.com/zh-Hans/docs/agnes-video-v20` 中 model 字段实际就是这个名字——不是 `agnes-video-2.0` 也不是 `agnes-video-v20` URL slug）；(2) 仅白名单（caller 显式 `model="agnes-video-v2.0"`），不加 MCP server 端自动降级；(3) 仅 MCP server 改动，`bundled-skills/creative-video-suite` 红线（TODO #119 + §5.2 "禁止 fallback"）保持；(4) **接口输入参数不变**——v2.0 模型加入参数转义，`mode/seconds/size/first_frame/last_frame/images[]` 字段语义保持，server 内部映射到 v2.0 协议（`mode:"ti2vid"/"keyframes"` + `extra_body.image:[url1,url2]` + `height/width` + `num_frames` + `frame_rate:24`）。**协议差异 vs 现状**：(a) v2.0 size 集合 `{480p,720p,1080p}`（小写 p）vs 2.5-flash `{720P}`（大写 P）；(b) v2.0 aspect_ratio 5 个（`16:9/9:16/1:1/4:3/3:4`，**无 21:9**）vs 2.5-flash 6 个（含 21:9）；(c) v2.0 `mode="reference"` 不支持（v2.0 不接 `images[]/audios[]/videos[]`），命中返 `reference_mode_unsupported` 错误（类比 2.5-flash 的 `videos_unsupported` 模式）；(d) `seconds` 字符串 → `num_frames` 8 倍数 snap 到 `{81,121,241,441}` + `frame_rate=24` 固定。**改动计划**：4 文件（`server.py` + `tests/test_v2_model_whitelist.py` + `pyproject.toml` 0.1.8→0.2.0 + `CHANGELOG.md`）+ 文档（`README.md` / `SKILL.md` 更新描述与能力一致，仍标 hosted_mcps 内部文件）。`extended_buildin_mcp/mcp.json` 的 `multimedia-creator` pin 由 `scripts/bump-on-commit.mjs::AGNES_MCP_VERSION auto-bump` 在 PyPI 0.2.0 publish 后下个 commit 自动 patch。**scope-out 留 follow-up**：(a) caller 显式传 `negative_prompt` / `num_inference_steps` 等 v2.0 独有字段（保持"接口输入参数不变"约束）；(b) creative-video-suite 红线 §5.2 决策同步（用户拍板暂不动）。

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

**踩坑 — 测试断言忘了同步改访问路径**：第一次跑测试 5 处 type error + 1 runtime assertion 失败（类型从平铺改嵌套，测试里**所有访问路径**都要扫一遍——grep `tools!\[\d+\]\.\(name\|description\|parameters\|strict\)` 一把找齐，避免半改）。**踩坑 — harness 拦截 grep 输出**：复杂 bash 链 stdout 被 harness 完全屏蔽（"1 matches in 1F"）。**修法**：单 Bash 单行只做一件事，或 vitest 结果重定向 `/tmp/vitest-out.txt` 再 grep。

### 5.10 OpenBitFun 调研锚点（2026-09-21 · 借鉴素材）

对照 `/home/hmcz/Projects/openbitfun`（v1.0.0 MIT，Tauri+Rust+React+pnpm，4 种 Harness + MiniApp + Relay）。**已展开**：`specs/prd/miniapp.md` v0.1 PRD（MiniApp 容器形态，照搬 openbitfun 4 文件契约 + 4 类权限 + Bridge API；明确不引入 openbitfun 的 `agent.*`）。**待评审**：Product Operation Registry（加速 `tech_docs/remote_surface_contract.md`）/ i18n contract 集中 + `i18n:audit` 门禁 / Target cache GC + release-fast profile / Plugin Host 4 阶复用规则复盘 plugin-bridge。**不借鉴**：6 层 Rust workspace（单 Desktop 不需要）、App Server wire 矩阵（Sidecar 1:1 是对的）、ACP / OpenCode / Codex adapter（走 SDK）、Sandbox / Computer Use（planned）。详见 `specs/prd/miniapp.md`。

### 5.11 MyAgents `mcp-command.ts` 横向对比（2026-09-23 → 2026-09-28 · #192 → #194 落地后调研）

**结论**：本仓 #185 + #192 + #194 落地后已**完全对齐** MyAgents resolver + PATH-prepend 模式（resolveNpxMcpInvocation Win/POSIX + 命中 nodeDir 前置到 PATH 头部 + Windows 大小写归一化 + 既有 nodeDir 去重），仅缺 `buildMcpStdioLaunchConfig` 单一入口封装（**非 resolver 层面**；MCP spawn 三处各自拼 PATH 是已知冗余，下次需要时再统一）。**对照表**：Win 优先级 / Win npx 形态 / POSIX 形态 / POSIX throw / `-y` `--yes` 双识别 / nodeDir PATH-prepend + case-insensitive dedupe — 全一致。**scope 决策**：resolver + PATH-prepend 不再同步；`buildMcpStdioLaunchConfig` 统一入口模式待 v2 借鉴 — 详见 TODO #194 narrative。