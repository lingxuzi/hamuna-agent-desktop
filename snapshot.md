# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务指针。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。snapshot.md 不允许无限增长；已完成项落地到 §4 git log / 删除 narrative 后立即清出本节。
> **硬约束**：snapshot.md ≤ 500 行。

## §0 narrative 历史压缩锚点（2026-09-22 · snapshot 增补）

§0 之前累积的 narrative 已折叠到下方锚点；详细设计取舍见 git log + 对应 spec：

- **#187 MiniApp Desktop App PRD v0.3**（2026-09-21）— `specs/prd/miniapp.md` 680 行；v0.3 反转 v0.2 决策。详见 git log；本地草稿，gitignore `specs/prd/` 不入库。
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

#### TODO #199 — MiniApp Launcher Tab + SceneTab 入口打通（v0.4 §B.5 衔接 Phase 3）✅ DONE（折叠到 §5.12.12）

#### TODO Phase 3 (v0.4 §B.4) — Worker sandbox + Marketplace List/Detail/Install (2026-09-29 · ✅ DONE)
**折叠**：详见 §5.12.11。✅ DONE（51 tests pass + 0 typecheck/lint errors + Rust commands::* 30 pass + v37 stale assertion 最小修复）。

#### TODO #198 — getBundledNodeDir 兜底加 process.execPath 探针（修 user 报 "node 找不到"）🔄 BLOCKED
**折叠**:user 实测需先回 unified-log 看 `[getScriptDir]` 行 + `ls -R <install>/nodejs` 反推 mode 后再判定根因。Plan: 修法= `src/server/utils/runtime.ts::getBundledNodeDir` 加 `process.execPath` 探针;验证=`runtime.npx-priority.unit.test.ts` 3/3;scope-out=不动 `getScriptDir()` / Rust spawn cwd 契约 / NSIS RMDir。
 TODO #195 — desktop 慢 vs curl 快根因复查（TTFT 数据再定位）✅ v1 落地（keepAliveTimeout 30s + connectTimeout 8s）
#### TODO #195 — desktop 慢 vs curl 快根因复查 ✅ DONE
**折叠**:keepAliveTimeout 30s + connectTimeout 8s + keepAliveMaxTimeout 60s 三 cap。根因= undici 默认 `keepAliveTimeout=5000ms` 撞 user turn 间隔 >5s → cold connect 20-40s。

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
#### TODO #121 — Windows install pip-only 落地（uvx 退 bundled）✅ DONE
**折叠（2026-09-29 · snapshot 增补）**：详见 §4 git log（含 `69a8c63` feat + 各 follow-up commit）。原方案 A = auto-merge bundled uvx；user 拍板改 pip-only；48 MB bundle 减重；HKCU\Environment\Path 由 `uvx-path-setup.ps1` 持久化。
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
#### TODO #131 — agnes-video-25 v0.1.7 `_coerce_image_paths_input` helper ✅ DONE
**折叠（2026-09-29 · snapshot 增补）**：详见 §4 git log `c008edc` + `hosted_mcps/agnes-video-25/CHANGELOG.md [0.1.7]/[0.2.2]` 段。**v0.2.2 缓解**：递归 unwrap + `id()` 环检测 + 深度 8 上限；架构正确做法（BeforeValidator）未偿还。
#### TODO #132 — agnes-video-25 v0.1.8 schema 层放宽 `image_paths: list[str] | dict | None` ✅ DONE
#### TODO #132 — agnes-video-25 v0.1.8 schema 层放宽 `image_paths: list[str] | dict | None` ✅ DONE
**折叠（2026-09-29 · snapshot 增补）**：详见 §4 git log `f65a609` + `hosted_mcps/agnes-video-25/CHANGELOG.md [0.1.8]` 段。
#### TODO #133 — 工具箱 stdio MCP 启动握手校验 (`/api/mcp/enable`) ✅ DONE
#### TODO #133 — 工具箱 stdio MCP 启动握手校验 (`/api/mcp/enable`) ✅ DONE
**折叠（2026-09-29 · snapshot 增补）**：详见 §4 git log + `/home/hmcz/.claude/plans/mossy-dreaming-dewdrop.md`。9 unit + 3 integration 全绿；分支 `feature/mcp-stdio-startup-validation`（master 不直接 commit）。
#### TODO #135 — Windows install-time prefetch `agnes-video-25-mcp` wheel ✅ DONE
#### TODO #135 — Windows install-time prefetch `agnes-video-25-mcp` wheel ✅ DONE
**折叠（2026-09-29 · snapshot 增补）**：详见 §4 git log `69a8c63` + TODO #127 smoke test 兜底。版本流转 0.3.157 → 0.3.158。
#### TODO #134 — agnes-video-25 v0.2.0：agnes-video-v2.0 模型白名单 + 参数转义 🔄
#### TODO #134 — agnes-video-25 v0.2.0：agnes-video-v2.0 模型白名单 + 参数转义 🔄
**折叠（2026-09-29 · snapshot 增补）**：详见 §4 git log。model ID = `agnes-video-v2.0`（带 v，非 `2.0` 也非 `v20` URL slug）；白名单仅 MCP server 改，skill 红线保持。0.2.0 PyPI sha256 verified @ 2026-09-11T15:35:04Z。
**P3 多 key fallback 历史折叠**（2026-09-29 · snapshot 增补）：详见 §4 git log `d2403e6` + `hosted_mcps/agnes-video-25/CHANGELOG.md [0.1.6]/[0.2.3]`。in-memory KeyState 状态机 + 30s 窗口 reason split + round-robin 叠加 fallback（user 拍板方案 B）。
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
### 5.9 OpenAI Bridge Responses API tool 形状回归到嵌套结构（2026-09-20 · #186 落地）
**折叠（2026-09-29 · snapshot 增补）**：详见 §4 git log + `src/server/openai-bridge/types/openai-responses.ts` + `src/server/openai-bridge/translate/request-responses.ts` + 3 处 unit test。根因 = `request-responses.ts:113-124` 补 `strict: false` 但保留平铺 `{type, name, description, parameters, strict}`；Rust serde untagged enum 严格匹配嵌套 `{type:'function', function:{...}}`，agnes strict provider 拒收平铺。修法 = 改嵌套输出。40/40 unit test + nested invariant 锁死。
### 5.10 OpenBitFun 调研锚点（2026-09-21 · 借鉴素材）
### 5.10 OpenBitFun 调研锚点（2026-09-21 · 借鉴素材）
**折叠（2026-09-29 · snapshot 增补）**：对照 `/home/hmcz/Projects/openbitfun`（v1.0.0 MIT）。已展开=`specs/prd/miniapp.md` v0.1 + `specs/prd/miniapp-v0.4.md` v0.4（4-Phase 切片）。不借鉴=6 层 Rust workspace / App Server wire 矩阵 / ACP / OpenCode / Codex adapter / Sandbox / Computer Use。详见 PRD。
### 5.11 MyAgents `mcp-command.ts` 横向对比（2026-09-23 → 2026-09-28 · #192 → #194 落地后调研）
### 5.11 MyAgents `mcp-command.ts` 横向对比（2026-09-23 → 2026-09-28 · #192 → #194 落地后调研）
**折叠（2026-09-29 · snapshot 增补）**：本仓 #185+#192+#194 落地后已完全对齐 MyAgents resolver + PATH-prepend 模式（Win/POSIX + nodeDir 前置 + 大小写归一化 + 去重）。仅缺 `buildMcpStdioLaunchConfig` 单一入口封装（**非 resolver 层面**；MCP spawn 三处各自拼 PATH 是已知冗余，下次需要再统一）。
### 5.12 MiniApp 系统 —— 创意插件需求拍板（2026-09-29 · 用户 6 维 grill 落地）

**触发**：用户原话"想做一个创意插件系统，可以将用户的想法，工作流生成一个专业的UI空间，可以与Agent交互，可以加载特定的skill，加入sqlite数据库支持。不用所有任务只能在对话中完成"。**grill 6 维**：(a) 形态=微信小程序 MiniApp；(b) UI 位置=独立 SceneTab；(c) Agent 交互=PRD v0.3 Cowork Sidecar；(d) SQLite=**砍掉**，**保留 storage.json**；(e) skill 加载=MiniApp 单独算 workspace，可挂载需要 skill，避免上下文混乱；(f) 生成方式=AI 对话生成 + 文件聊天补仓。

#### 与 PRD v0.3 既有决策的 4 项拍板（2026-09-29）

| 维度 | PRD v0.3 | 本次拍板 | 决策依据 |
|------|---------|---------|---------|
| **Sidecar 模型** | Cowork Sidecar 独立进程 owner=`miniapp-agent:<app_id>:<run_id>` | **采纳** | CLAUDE.md §Sidecar Owner 1:1 例外；v0.3 接受第二类 agent_kind 区分 Chat/Cowork/MiniApp |
| **持久化** | `storage.json` KV | **不增 SQLite** | PRD v0.1 已规划 `withConfigLock` KV；CLAUDE.md "代码块 > 3 引用 MUST 抽象复用" + KB Engine 不适合 MiniApp schema；SQLite 是 over-engineering |
| **skill 挂载** | PRD v0.3 未规划 `meta.json.skills` 字段 | **MiniApp 单独算 workspace** | Skill Reload（`evaluateSkillReload`）接 appId 维度；MiniApp 启动时只 load 声明的 skill 子集；不污染 Chat Sidecar 上下文 |
| **生成方式** | PRD v0.1 §1.1 `git clone` 本地目录加载；PRD v0.3 Phase 1 Icon Design demo | **AI 对话生成 + 文件聊天补仓** | 用户对话中说"做个图标生成器 MiniApp" → AI 在 Chat Sidecar 内生成 `meta.json + source/index.html + ui.js + style.css + storage.json` → 写到 `~/.hamuna/miniapps/<id>/` → 用户开 MiniApp Tab 看效果；可拖 MiniApp 目录到 Chat 上下文补仓迭代 |

#### 5.12.1 实施切片（避开 PRD v0.3 的 4 周 MVP，一次一 PR）

| Phase | 内容 | 工期 | PR 编号 | 关键交付 |
|-------|------|------|---------|---------|
| **Phase 0** | MiniApp Runner + SceneTab + 加载本地目录 + storage.json + 静态 ui.js | 2-3 天 | PR1 | 跑通"独立 Tab 显示静态 UI"，无 Sidecar/Worker/权限/skill |
| **Phase 1** | 对话生成 MiniApp + 文件聊天补仓 | 3-4 天 | PR2 | AI 在 Chat Sidecar 内生成 `meta.json + source/`，写本地目录；Chat 可拖 MiniApp 目录到 context 补仓 |
| **Phase 2** | Cowork Sidecar + 4 类权限 + Bubble Claim + workspace skill 挂载 | 2 周 | PR3 | MiniApp 自有 Sidecar（owner=miniapp-agent）+ 4 类权限（fs/shell/net/ai）+ FloatingMiniChat Bubble Claim + Skill Reload 接 appId 维度 |
| **Phase 3** | Worker Manager + Marketplace 雏形 | 2 周 | PR4 | MiniApp Worker Manager（Node v24 `worker_threads`）+ require shim + 黑名单 + Marketplace web UI（本地 `bundled-miniapps/` 只读） |

#### 5.12.2 待 grill 的 6 个 Phase 2 决策点（实施前 MUST 拍板）

详见 PRD §13 风险与未决问题 1-6（行号 624-630）。本次新增决策点：

- **(新) workspace skill 挂载机制**：MiniApp 启动时只 load 声明的 skill 子集 → 需评估 Skill Reload（`evaluateSkillReload`）如何接 appId 维度；现有机制是全局的（CLAUDE.md §Pit-of-Success Skill Reload helper），新增 appId 维度 = 抽 `evaluateSkillReloadForMiniApp(appId, skillNames)` facade
- **(新) 对话生成的 MiniApp 代码如何 diff/review**：AI 在 Chat Sidecar 内生成 meta.json + source/ 后用户看到效果，但代码不可见 → 是否暴露 `cmd_miniapp_diff_source(appId, fromVersion)` 让用户在 Chat 内 diff 改动？

#### 5.12.3 复用与红线对齐（精要，详见 PRD §11）

- **MiniApp Runner**：`src/renderer/components/miniapp-host/`（NEW）—— 复用 `src/renderer/styles/tokens.css` 的 CSS Token 子集（CLAUDE.md §Pit-of-Success "前端硬编码颜色破坏设计系统一致性"）
- **SceneTab 入口**：`openScene('miniapp:{appId}')` —— 复用现有 SceneTab registry（CLAUDE.md §核心架构骨架）
- **storage.json 锁**：复用 `withConfigLock`（`src/server/utils/withConfigLock.ts`，CLAUDE.md §Config 持久化红线）
- **路径沙箱**：`cmd_miniapp_invoke` 走 `src/server/utils/path-safety.ts::validateFilePath`（不跟随 symlink，与 `tech_docs/tool_attachment_pipeline.md` §4 同款）
- **审计日志**：tag 强制 `[miniapp:<id>]`，走 `ulog_info!`（与 CLAUDE.md "Rust 日志用 ulog_*" 红线对齐）
- **iframe sandbox**：`allow-scripts allow-same-origin allow-forms`（**不** allow-popups / allow-top-navigation）
- **CSP `connect-src`**：只放 MiniApp 自身 + Rust 代理层白名单端口；**禁**放 Cowork Sidecar port（iframe 直连旁路防护）
- **Rust 命令命名**：`snake_case`（`cmd_miniapp_load_from_local` / `cmd_miniapp_invoke` / `cmd_miniapp_ai_complete` 等），全部 `pub async fn`
- **不使用裸 `reqwest::Client::new` / 裸 `Command::new` / 裸 `tokio::spawn`**（clippy `disallowed-methods/macros` 自动拦截）
- **不走 sidecar HTTP 路径**：MiniApp workspace IO 走 `cmd_workspace_*`（与 CLAUDE.md "工作区文件 IO" 红线对齐）
- **Cowork Sidecar 单一入口**：所有 MiniApp → Cowork Sidecar 必须经 Rust `MiniAppCoworkManager` 中间件（owner 校验 + rate limit + 审计），iframe 不能直连 Sidecar

#### 5.12.4 不复刻 PRD v0.3 的 4 周 MVP 理由

PRD §7 Phase 1 估 4 周跑 4 个新基础设施（MiniApp Runner / Bubble Claim / Cowork Sidecar / Worker Manager）+ 1 个 Icon Design demo，每个 ~1 周。本次需求是"对话生成 + MiniApp 单独 workspace + skill 挂载"，复杂度 ≥ 重启整个 PRD。**改为分 4 个 Phase 独立 PR**，每个 Phase 独立可 ship + 可回滚 + 不阻塞 Chat/Cowork 主线。PRD v0.3 的 4 周 MVP 估算作废，但保留 PRD §2/§4/§6/§11 设计文档（meta.json schema + Bridge API + Cowork Sidecar + 红线）作为参考锚点。

#### 5.12.5 scope-out + 5.12.6 验收 + 5.12.7 follow-up 拍板（合并 2026-09-29）

PRD §14 12 项 scope-out（v0.4 +1 项不引 SQLite）。验收清单详见 PRD v0.4 §D（v0.3 §15 8 项 + v0.4 新增 4 项）。follow-up：(a) PRD v0.3 ✅ 保留 + v0.4 cross-link；(b) `miniapp-creator` ✅ system skill；(c) `app.workspaceDir` 默认值 ✅ `~/.hamuna/miniapps/<id>/`。

#### 5.12.8 MiniApp Phase 0 + 1 实施记录（合并 2026-09-29）

**Phase 0 ✅ DONE**（PRD v0.4 §B.1 · 历史详情已归档于 git log）：shared 4 文件 (meta-schema/path-templates/errors/types) + 20/20 unit tests；renderer MiniAppRunner.tsx (sandbox=allow-scripts/same-origin/forms) + theme-tokens.ts + 3/3 dom tests；Rust 3 invoke (list/uninstall/get_bundled_root) + `with_file_lock_blocking` + symlink_metadata；bundled-miniapps/hello-miniapp/ demo。

**Phase 1 ✅ DONE**（PRD v0.4 §B.2 · 2026-09-29）：

- **bundled-skills/miniapp-creator/**（系统 skill，`SYSTEM_SKILLS_VERSION` 56→57）：`SKILL.md` ~190 行 4 文件契约 + 端到端协议；3 文件模板；`verify-system-skills-sync.mjs` ✅ 25 entries
- **Rust**：`commands.rs` +250 行（`cmd_miniapp_create_from_chat` 写盘权威 + `cmd_miniapp_diff_source` 结构化 diff + `miniapp_tests` 4 unit tests）+ `management_api.rs` +60 行 2 axum handlers + `lib.rs` 注册
- **Sidecar**：`src/server/index.ts` +100 行 POST/GET forward-port（**双层防呆**：Node schema + Rust `serde_json` + meta.id==appId）
- **renderer**：`useMiniAppFileService.ts` (~70) 纯函数 hook（drag-to-Chat attachment 留 Phase 2 Bubble Claim）
- **e2e fixture**：`bundled-miniapps/_e2e-fixtures/icon-generator/` 5 文件 demo

**Phase 1 验收**：typecheck ✅ 0 / `cargo build` ✅ 0 / `cargo test --lib miniapp_tests` ✅ 4/4 / shared 20/20 / dom 3/3 / system-skills-sync ✅ / 不引新依赖（Node diff stdlib + Rust `read_to_string` set diff）。

**架构决策**：写盘权威在 Rust（CLAUDE.md L234 双同步红线）/ `with_file_lock_blocking(<appId>.lock)` 与 uninstall 复用 / meta.id==appId 双层防呆。**Phase 1 scope-out**：❌ `meta.json.skills` / ❌ unified text diff / ❌ drag-to-Chat attachment / ❌ file tree UI。

**Phase 1 grill 4 项**（用户全部"推荐"）：(a) Sidecar HTTP → Rust invoke ✅ / (b) path-safety 准入（实现路径：Node 不写盘，path-safety allowlist 仅读侧 Phase 2 落地）✅ / (c) diff_source Phase 1 ✅ / (d) SYSTEM_SKILLS 双清单 + 三版本 bump ✅。

**Phase 1 就绪度**：实施 ✓ / 验收 ✓ / grill ✓ / PRD §B.2 9/9 交付清单勾完。

#### 5.12.10 MiniApp Phase 2 v0.4 落地（2026-09-29 · 13 文件 · 33 tests · snapshot 497 行）✅ DONE
**折叠（snapshot 增补）**：详见 §4 git log（13 文件详见 §5.12.10 旧展开） + 33 tests pass + 0 typecheck/lint warnings。Phase 2 v0.4 = A Owner 扩展 + C 2 invokes + D 权限 + F Bubble Claim + G icon-design skill；Cowork Sidecar facade / 11 invokes / 独立审计日志 / FloatingMiniChat UI 推到 Phase 3。

#### 5.12.11 MiniApp Phase 3 v0.4 落地（2026-09-29 · 24 文件 · 51 tests · snapshot 440/500 行）✅ DONE
**折叠（snapshot 增补）**：详见 §4 git log（24 文件详见 §3.1 Phase 3 TODO）+ 51 tests pass + 0 typecheck/lint errors（2 cosmetic React useEffect deps warning 不阻 CI）+ Rust commands::* 测试 30 pass（`v37_updates_goal_cli_skill_and_preserves_v36_contracts` 最小修复：bump `SYSTEM_SKILLS_VERSION` 期望值 37→58，保留 v37 测试名 + v37 CLI/memory/docs contracts 不变，不重命名为 v58 也跳过中间 v40-57 契约历史——按用户「最小修复」拍板）。Phase 3 v0.4 = A Node Worker 池 (worker_threads in-process) + require shim (string blacklist + acorn AST fallback 兜底 PRD §13.8 `require('fs'+'/promises')`) + 1 git-graph demo (simple-git) + Marketplace List/Detail/Install UI (复用 ConfirmDialog 0 新组件) + meta.json `kind: 'iframe' | 'worker'` 扩展 + `workerCallBridge` 4-rule trust boundary (mirror bubbleClaimBridge pattern)。**核心契约**: worker 沙箱 ceiling=Node-only worker_threads (共享 V8 isolate → 4 件硬护 resourceLimits/shim-first/process.exit patch/method allow-list); upgrade path=Phase 4 untrusted authors 时切 child_process.fork; 无 Tauri `cmd_miniapp_worker_*` invoke (worker 在 Sidecar 内 spawn, 绕 Tauri = 无 owner 多空 indirection 违背第零原则); Install 写盘单一 Rust core = `install_blocking` 抽 `cmd_miniapp_create_from_chat` + `cmd_miniapp_install_from_marketplace` funnel through 一处 (withFileLock + tmp+rename + symlink guard + version 自增)。**scope-out (Phase 4+)**: package.json npm install per-MiniApp / Marketplace 搜索·评分·评论·远端 / worker child_process.fork / 多 worker kind / worker 跨 Sidecar 持久化 / Tauri cmd_miniapp_worker_* invoke / iframe 自动装 shim / 工作区 git 写权限 (git-graph 只读 log/show/diff/status + checkout)。

#### 5.12.12 MiniApp Phase 4 entry 落地（2026-09-29 · 7 文件 · 3 tests · snapshot 443/500 行）✅ DONE
**折叠（snapshot 增补）**：详见 §3.1 TODO #199 + §4 git log。Phase 4 entry (PRD v0.4 §B.5) = Launcher MiniApp Tab + SceneTab 入口打通。**关键架构决策**: (a) 新增独立 `view:'miniapp-scene'`(不复用 chat view —— chat 强制 sessionId, MiniApp 无 session 概念冲突;不复用 marketplace view —— view 语义与「运行态」不符);(b) `Tab.miniapp:{appId,kind?,workerKind?,icon?}` 字段承载 MiniApp 状态,`MiniAppRunner` 直接 mount 进 tab content;(c) 中心页 grid 用 `listMarketplace().filter(source==='installed')`(marketplaceClient 已有 endpoint,无需 Rust 改);(d) 新增 Rust `cmd_miniapp_source` 端点读 MiniApp `source/<entry>` HTML(installed→bundled fallback,is_safe_app_id 守门) → `/api/miniapp/source` Sidecar forward-port → `loadMiniAppSource()` client → `MiniAppSceneTab` fetch 后传 `srcDoc` 给 Runner(填 Phase 3 漏的 srcDoc 架构洞)。**文件清单**(NEW 5 + 改 5):NEW `src/renderer/pages/MiniAppCenter.tsx`(~190 行 lazy grid + empty state + kind badge + 「Browse Marketplace」空态 CTA)+ `MiniAppSceneTab.tsx`(~80 行 thin wrapper:fetch source → <MiniAppRunner/>)+ `MiniAppCenter.test.tsx`(dom 3 cases:grid filter bundled-out / empty state / card click dispatches OPEN_MINIAPP_SCENE with kind+workerKind+icon)+ `MiniAppSourceResponse` type + `loadMiniAppSource()` in `marketplaceClient.ts`;改 `src/shared/constants.ts::CUSTOM_EVENTS` 加 `OPEN_MINIAPP_CENTER` + `OPEN_MINIAPP_SCENE`;`src/renderer/types/tab.ts` view union + `Tab.miniapp` 字段;`src/renderer/utils/tabContentKind.ts` 加 miniapp-center/miniapp-scene 分支;`src/renderer/App.tsx` dispatch 分支 + 2 listener + `handleOpenMiniAppCenter`(singleton)+ `handleOpenMiniAppScene`(新开 tab 每次);`src-tauri/src/commands.rs` `cmd_miniapp_source` invoke + `read_miniapp_source_blocking` + `read_meta_entry` + `candidate_source_dirs` + `MiniAppSummary` 扩 `icon?/kind?/worker_kind?` 3 字段 + `read_miniapp_meta_for_listing` 重构消除 Phase 3 重复声明;`src-tauri/src/management_api.rs` `miniapp_source_handler` + 路由注册;`src-tauri/src/lib.rs` 注册 `cmd_miniapp_source` invoke;`src/server/index.ts` `/api/miniapp/source` forward-port(POST,appId 校验同 install/uninstall 模式)。**红线命中**:依赖-cruiser `src/renderer/**` 不 import server(继续走 marketplaceClient)+ reuse 0 新组件(Marketplace card 视觉风格镜像)+ `withConfigLock` 不适用(读场景无写)+ bare `__dirname` 不适用(Rust 端)+ i18n key 缺失用 hardcode 'MiniApps' fallback(后续 PR 补 `tabs.miniappCenter` translation bundle)。**Verification**:`npm run typecheck && npx eslint src/renderer/{pages,lib,types,utils,App.tsx}` 全绿;`npx vitest run --project dom src/renderer/pages/MiniAppCenter.test.tsx` 3/3 pass;`npm run test:integration` 348/348 pass;`cargo check` 0 error。**scope-out (Phase 4.1+)**:SceneTab 持久化 / 同 MiniApp 多实例 / i18n bundle 同步 / SceneTab close confirmation / 「最近用过」/ 自动启动 / 多 worker kind registry。

#### 5.12.13 MiniApp Phase 4.1 落地（2026-10-01 · 8 文件 · 26 tests · snapshot 453/500 行）✅ DONE
**Phase 4.1 = 多 worker kind registry + SceneTab close confirmation**。**架构决策**: (a) 把 Phase 3 hardcoded `if (kind==='git-graph')` 拆成 `Map<string,WorkerKindDef>` registry,每种 kind 自己 `kinds/<name>.ts` 文件 `registerKind(KIND_DEF)` self-register,`index.ts` barrel `import './kinds/git-graph'` 触发副作用。`WorkerKindDef` 新增 `entryPath: string` 自描述 entry 脚本路径,pool `new Worker(kindDef.entryPath)` 不再 hardcode 任何 kind;`worker-entry.template.ts` YAGNI 删(无第二个 kind 用 template,留当按需点);(b) SceneTab 关 worker-kind tab 时弹 `<ConfirmDialog>`(复用 0 新组件),`MiniAppRunner` unmount 已自动 terminate worker(`/api/miniapp/worker/terminate`),dialog 只给 user 退出口;(c) `WORKER_METHOD_ALLOWLIST` 注释更新明示"kind registry 静态镜像,Phase 4.2 才走 runtime `/api/miniapp/kinds` lookup"(dependency-cruiser 禁止 renderer→server import,runtime lookup 必须经 HTTP)。**文件清单**:改 `src/server/miniapp-worker/worker-rpc.ts`(registerKind/getKindDef/listKinds/__resetRegistryForTest API + WorkerKindDef.entryPath 字段,删 installKindHandlers/__resetKindHandlersForTest/GIT_GRAPH_KIND exports)+ NEW `src/server/miniapp-worker/kinds/git-graph.ts`(~210 行:5 schemas + 5 handlers + GIT_GRAPH_KIND 导出 + self-register,`here` 用 fileURLToPath(import.meta.url) 算 entryPath)+ rewrite `src/server/miniapp-worker/worker-entry-git-graph.ts`(70 行 bootstrap:install shim + import GIT_GRAPH_KIND from kinds/ + start parentPort router,不再 binding handlers)+ 改 `src/server/miniapp-worker/worker-pool.ts`(`new Worker(kindDef.entryPath)` 替换 `resolveEntryPath` 硬编,删未用 fileURLToPath/path imports)+ 改 `src/server/miniapp-worker/index.ts`(`import './kinds/git-graph'` 触发注册,删 installKindHandlers 旧 exports)+ 删 `src/server/miniapp-worker/worker-entry.template.ts`(YAGNI)+ 修 `src/server/miniapp-worker/require-shim.ts` 注释(改引 worker-entry-git-graph.ts)+ 改 `src/renderer/App.tsx`(`miniappCloseConfirm` state + `handleCloseTab` 加 `view==='miniapp-scene' && kind==='worker' && workerKind` 分支弹 dialog + ConfirmDialog 渲染)+ 改 `src/renderer/components/miniapp-host/workerCallBridge.ts`(注释明示 registry 镜像契约 + Phase 4.2 runtime lookup 路径)+ i18n `app.json` (en-US/zh-CN) 加 `miniappCloseTitle`/`miniappCloseMessage`/`close` 三键(复用现有 `cancel`/`close` 文案风格)。**Verification**: `npx tsc --noEmit` 干净;`npx vitest run --project unit src/server/miniapp-worker/` 26/26 pass (1 skipped pre-existing);`npx vitest run --project dom src/renderer/pages/MiniAppCenter.test.tsx` 3/3 pass。**scope-out (Phase 4.2+)**: runtime `/api/miniapp/kinds` lookup endpoint / 第二个 worker kind demo (e.g. file-explorer / code-search) / SceneTab 持久化 / 同 MiniApp 多实例 / 「最近用过」 / 自动启动 / iframe-only MiniApp 关闭直接无声不弹 dialog。

#### 5.12.14 MiniApp Phase 4.2 落地（2026-10-01 · 8 文件 · 87 tests · snapshot 461/500 行）✅ DONE
**Phase 4.2 = runtime kinds lookup + file-explorer 第二个 worker kind**。**架构决策**: (a) `GET /api/miniapp/kinds` Sidecar forward-port 直接读 `listKinds()`,返回 `[{kind, methods[]}, ...]`(schema 不透出,YAGNI);(b) Renderer 删 Phase 4.1 静态 `WORKER_METHOD_ALLOWLIST`,`workerCallBridge.ts` 新增 `loadWorkerKinds()`(single-flight `apiGetJson` + frozen result),`verifyWorkerCall` 改接受 `readonly string[] | undefined` → undefined = fail-closed（cache 命中前不 post ready）;(c) `MiniAppRunner` useEffect 在 mount 时 fetch kinds,`useState<kindAllowlist>` 派生;spawn effect gate 在 `kindAllowlist !== undefined`,保证 `worker.ready` 一定在 iframe 拿到合法 allow-list 之后 post（race 防御）;(d) 第二个 worker kind `file-explorer` = 3 methods(`file.tree`/`file.read`/`file.search`),用 host `node:fs` 跑,黑名单不挡 host bundle code。**安全护栏**: symlink 拒绝(`lstatSync` + `isSymbolicLink()` 早于 isDirectory),depth cap ≤ 8,maxEntries ≤ 5000,binary detection (4KB sample NUL byte check → 空 content),search 跳 .git/.node_modules,skip >256KB 文件(避免误把 binary 当 text 扫)。**文件清单**(NEW 4 + 改 4):NEW `src/server/miniapp-worker/kinds/file-explorer.ts`(~230 行:5 schema + 3 handler + FILE_EXPLORER_KIND 导出 + self-register)+ NEW `src/server/miniapp-worker/kinds/file-explorer.unit.test.ts`(14 tests:registry 注册 + entryPath 形态 + 5 schema 失败用例 + 7 handler 真 tmp 目录测试含 symlink 拒绝 / .git+node_modules 跳过 / case-insensitive search)+ NEW `src/server/miniapp-worker/worker-entry-file-explorer.ts`(60 行 bootstrap 镜像 git-graph 模式)+ i18n 不需要新增文案(close confirm 复用 Phase 4.1 `miniappCloseTitle`);改 `src/server/miniapp-worker/index.ts`(`import './kinds/file-explorer'` 触发注册);改 `src/server/index.ts` `/api/miniapp/kinds` 路由(GET,server-local 不走 managementApi,直接读 listKinds());改 `src/renderer/components/miniapp-host/workerCallBridge.ts`(`WORKER_METHOD_ALLOWLIST`/`methodsForKind` 全删,新增 `loadWorkerKinds()` + `__resetWorkerKindsForTest()` + `verifyWorkerCall` 签名 allow-list 接受 `undefined` fail-closed);改 `src/renderer/components/miniapp-host/MiniAppRunner.tsx`(useState<kindAllowlist> + useEffect 拉 kinds + spawn effect gate `kindAllowlist !== undefined` + effect deps 加 kindAllowlist)。**测试调整**: workerCallBridge.unit.test.ts 改写:移除 `WORKER_METHOD_ALLOWLIST`/`methodsForKind` 用例,加 3 个 `loadWorkerKinds` cases(flatten / 单飞 retry on fail / concurrent single-flight) + 1 个 verifyWorkerCall `undefined allowlist fail-closed` 用例;MiniAppRunner.workerCall.test.tsx 加 apiGetJson mock + beforeEach 默认 resolve git-graph kinds + 新增 case "loadWorkerKinds fail → spawn 永不发起"(gate 守门)。**Verification**: `npx tsc --noEmit` 干净;`npx vitest run --project unit src/server/miniapp-worker/` 40/40 pass (含 file-explorer 14);`npx vitest run --project unit src/renderer/components/miniapp-host/workerCallBridge.unit.test.ts` 19/19 pass;`npx vitest run --project dom src/renderer/components/miniapp-host/ + MiniAppCenter.test.tsx` 14/14 pass;全 miniapp-worker + bridge + runner + center 池子 73 pass (1 pre-existing skipped)。**scope-out (Phase 4.3+)**: `bundled-miniapps/file-explorer` UI demo(目录树渲染 + 文件打开 + 搜索结果列表)/ 第三个 worker kind demo / kinds endpoint 鉴权(当前 server-local,公开同 Sidecar 同 host)/ allow-list 远程签名 / SceneTab 持久化 / 「最近用过」 / 自动启动。

#### 5.12.15 MiniApp Phase 4.3 + MCP 修复合并 + Launcher 入口（2026-10-01 · 12 文件 · 26 tests · snapshot 456/500 行）✅ DONE
**本轮 4 commit**：`ae2fce62` Phase 2+3 UI+4 entry 一并落地（Center/SceneTab/Cowork 权限 gate/bundled demos；工作树跨越三阶段无法拆分，诚实命名）/ `1a6c2118`+`d406d548` gitee MCP 修复 cherry-pick（Windows uv/uvx PEP 370 枚举 + sidecar 扩展 PATH）/ `7ae08844` Launcher MiniApp 入口 / `52fe3118` file-explorer demo + bundled meta.json 修正。
**Launcher 入口决策**：ModeSegment 加第三档**被否**——segment 是双向 toggle（`setModeAndFocus` 写死 `task<->thought`，绑定 Tab / Cmd+Shift+T），第三档把该 chord 变成三档循环无停点；且 Center 是导航目标非输入模式，放进 segment 会像"可输入的东西"。最终**并排置于 segment 右侧**作链接，独立 Tab 承载网格。**不 gate 在 `modeSegmentEnabled`**（Tauri-only task center）——按钮只 dispatch window event，gate 会让入口在浏览器 dev 模式消失，恰是 smoke 新 surface 最需要处。2 test pin 住该 split。
**meta.json schema drift（4 个真 bug，Marketplace 静默丢卡片）**：新加 `bundled-miniapps/*/meta.json` 扫真盘 test 后暴露——(a) `hello-miniapp` 用 Phase 0 扁平数组 `permissions:{fs:[],shell:[]}`，schema 要嵌套 `{fs:{read:[]}}`；(b) `icon-generator` 用旧 token `$APPDIR`，白名单是 `{appdata}/{workspace}/{user-selected}`；(c) `git-graph`/`file-explorer` category 写 `devtools`/`utility`，白名单 `developer|design|productivity|data|media|other`；(d) `git-graph` description 超 200 字符。全部修正。**该 test 必须留**——否则 4 个 bundled app 在 Marketplace 全部不显示且零报错。
**Verification**：`npx tsc --noEmit` 0 error；`npx eslint` 0 问题；meta-schema 19/19；miniapp 全池 69 pass + 1 pre-existing skipped；BrandSection dom 7/7（含新增 2）。
**pre-existing 失败（非本轮引入，已在 clean tree 复现）**：`src/server/index.unit.test.ts` seedBundledSkills 7 cases（`resolveBundledSkillsDir` mock 失效，sanity check 自身 fail）/ `themeArchitecture` 2 / `playwright-bash-redirect` 1 / `widgetSandboxHtml` 1 / `eventRegistry` 1；dom 池 12 文件（CustomTitleBar / ForceUpdateModal / LauncherRightRail / SessionHistoryDropdown / agentConfigService / appConfigService / useTabSwipeGesture / IssueAssigneePicker / IssuesWorkspace / FloatingThemeRuntime / indexThemeBootstrap / ThemeRuntime）。均为他人未提交工作区或历史遗留，未修（超本轮 scope，需单独排期）。
**scope-out（后续）**：MiniApp i18n bundle 补全（当前 `app.json` hardcode fallback）/ SceneTab 持久化 / 「最近用过」/ 自动启动 / 第三个 worker kind / marketplace 搜索·评分·远端 registry。

#### 5.12.16 openbitfun 对齐 1+2+3（2026-10-01 · 11 文件 · 54+6 tests）✅ DONE
**① theme token 根因修复**：原 `theme-tokens.ts` 9 个 token 全映射到**不存在的**宿主变量（`--bg-primary`/`--bg-elevated`/`--border-color`），`getPropertyValue` 静默返回空串 → 每个 MiniApp 一直走 `FALLBACK_TOKENS` 硬编码配色。宿主实际叫 `--paper*` / `--line*`。改为 24 token 直连真名（`--paper`/`--ink`/`--accent-primary`/`--line-subtle`/`--theme-radius-*`/`--font-body` 等），`file-explorer/style.css` 同步去掉全部硬编码色（`#4f46e5`/`#fafafa`/`#c00`/`#666`）。**无报错、无告警、只是主题永远不生效**——这类静默失败只有对着 `theme/themes/*.css` 逐名核对才抓得到。
**② `data-i18n` house style 落地**：先查证 openbitfun 的 applier 在哪——**不在宿主桥，是每个 asset 自带的 ~10 行 `applyStaticI18n()`**（`ui.js` 内联），`data-i18n-attr` 是**裸属性名**（`aria-label`）不是 `name:key`，且 UI 文案字典在 `ui.js` 的 `I18N` 对象里、不在 `meta.json`（后者只放 listing 元数据）。所以**不改宿主**：`file-explorer` 自带 `I18N{en-US,zh-CN}` + `detectLocale()`（读 `navigator.language`，宿主暂无 locale 通道）+ `t(key, {占位符})` + `applyStaticI18n()`，HTML 加 `data-i18n` / `data-i18n-attr`，运行时状态文案也全部过 `t()`。
**③ `permissions.node` + category 枚举**：schema 侧 `types.ts` 加 `node{enabled,max_memory_mb,timeout_ms}`、`category` 扩到 10 值（对齐 openbitfun）；消费侧新增 `src/server/miniapp-worker/node-limits.ts`——**pool 不碰文件系统**（已装 MiniApp 的路径权威在 Rust），解析发生在 Sidecar spawn 路由（有 appId 且有正当理由读盘），优先级 installed-bundled 与 `read_miniapp_source_blocking` 一致；`max_memory_mb` → `resourceLimits.maxOldGenerationSizeMb`（默认 64），`timeout_ms` → per-worker 调用超时（默认 5000），`enabled:false` 在 spawn 前 403 拒绝。**边界钳制**：schema 限 [16,512]MB / [1000,60000]ms——低于 16MB worker 连自己的 runtime 都起不来，高于 512MB「沙箱」名存实亡。meta.json 缺失或 schema 不过 → 落默认信封（Marketplace 本来也不展示它），不硬失败。
**文件清单**：NEW `node-limits.ts`(~75 行)+ NEW `node-limits.unit.test.ts`(6 tests：默认回落 / installed / bundled / installed 优先 / 越界回落 / enabled 探针)；改 `worker-pool.ts`(`SpawnWorkerRequest.limits` + `WorkerHandle.limits`，pool 不读盘)、`index.ts`(barrel 导出)、`server/index.ts`(spawn 路由解析 + 403)、`shared/miniapp/{types,meta-schema}.ts`、`meta-schema.test.ts`(+10 category + 6 node cases = 38)、`miniapp-host/theme-tokens.ts`、`file-explorer/{index.html,ui.js,style.css}`。
**Verification**：`npx tsc --noEmit` 0；`npx eslint`(9 文件) 0；`npx vitest run --project unit src/shared/miniapp/ src/server/miniapp-worker/node-limits.unit.test.ts` **54/54 pass**。
**scope-out**：宿主 locale 通道（`app.locale` getter + `onLocaleChange`）——本轮 `data-i18n` 只做单语言检测，宿主切语言不会重刷已开 MiniApp；第三个 worker kind / SceneTab 持久化见 5.12.15。
