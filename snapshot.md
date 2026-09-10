# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务指针。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。snapshot.md 不允许无限增长；已完成项落地到 §4 git log / 删除 narrative 后立即清出本节。
> **硬约束**：snapshot.md ≤ 500 行。

最后更新：**2026-09-10**（任务 #129 落地 — `windows-release.yml` step 4 (`Setup Node.js 24`) `actions/setup-node@v4` 加 `cache: 'npm'` 参数。key 自动派生自 `package-lock.json` hash;首次 release cache miss (cold),后续 release cache hit → `npm ci` cold 2m51s → warm 几秒级。独立于已有 Swatinem/rust-cache@v2 步（不同 store）。1 文件 / +5 -0。**触发**:v0.3.146 release run 2026-09-10 实际时间线显示 `npm ci` cold 占 ~8.4% (2m51s/34m),位居第三大瓶颈 (前两是 cargo release 17m5s + NSIS bundling 6m11s 物理下限不可压)。**beforeBuildCommand 冗余已查清(WebFetch Tauri CLI docs + 实读 `src-tauri/tauri.conf.json:10` + `tauri.windows.conf.json` 18 行):Tauri `--config` 走 merge 语义,`tauri.windows.conf.json` 没声明 `build.beforeBuildCommand` → 默认 `tauri.conf.json` 那行仍生效 = `node scripts/ensure_cuse_stub.mjs && npm run build:web && npm run build:server && npm run build:bridge && npm run build:cli`,跟 step 12/16 (server/bridge/cli + frontend) 完全重复 → 估算 ~2m 冗余。**用户拍板**:只动 A(npm cache),B(去重 beforeBuildCommand)暂不动 → **TODO #130 留作 follow-up,等下次发版时观察 cache 命中后的实际瓶颈再决定**。**版本流转**:0.3.149 (bump-on-commit 自动 patch)。

最后更新：**2026-09-10**（任务 #124 落地 — extended builtin MCP `hidesDefaultArgs?: boolean` 字段：扩 `McpServerDefinition` / `extended-builtin-mcp.ts::coerceServer()` 严格 `=== true` 解析 / `extended_buildin_mcp/mcp.json` 3 entry 显式 `true` / ToolboxSection 隐藏 mono 命令行 + SettingsPage builtin dialog 显示 placeholder / 中英文 i18n 各 1 key / parser 单测 4 新 case = 27/27；**任务 #125 落地** — `scripts/download_uv.ps1` 裸数字字面量 bug 修（`$Version = 0.11.33` → `$Version = "0.11.33"`），原 PowerShell 把 `0.11` 当 decimal + `.33` 当属性访问静默 `$null`；**数据修正** commit `66c2dee` — 历史 0.12.3 uvx.exe + `.uv-version` 替换为 0.11.33（SHA256 `c253ce868ad48d29327b661452ce184c9e333e6d6f5bc8d6fcfbf4dd52b83442`）；**任务 #121-pip-only 落地** — Windows install 完全去掉 bundled uvx.exe：移除 `tauri.conf.json::bundle.resources` uvx.exe + `tauri.windows.conf.json` uvx.exe + `.github/workflows/windows-release.yml` Download uvx step + `git rm src-tauri/resources/{uvx.exe,.uv-version}`；NSIS `Section UvxFallback` 改为无条件 `pip install --user --index-url https://pypi.tuna.tsinghua.edu.cn/simple --upgrade uv`（清华源，避免 GitHub release 中国大陆被墙）；新增 `src-tauri/nsis/uvx-path-setup.ps1`（写 HKCU\Environment\Path 持久化 PEP 370 Scripts dir + 广播 WM_SETTINGCHANGE + idempotent）+ `tauri.windows.conf.json::bundle.resources` 平铺到 `$INSTDIR\`；新增 `src/server/utils/runtime.ts::findPipInstalledUvxScriptsDir()`（probe `%APPDATA%\Roaming\Python\Python312\Scripts` + `%LOCALAPPDATA%\Programs\Python\Python312\Scripts` 两条候选 dir）；删除 `src/server/utils/runtime.ts::getBundledUvPath/getUserHomeBinUvxPath` + `mcp-bundled-seed.ts::seedBundledUvToHamunaBin` + 对应 unit test 文件 + `index.ts` import/调用 + `agent-session.ts` uvx spawn 块改调新 helper；LangString `uvxFallbackInstalling/Success/Error` 在 SimpChinese + English 各加）。**TODO #121-pip-only 落地**：原 #121 设计的 "bundled 拷到 ~/.hamuna/bin/" 被 pip-only 取代，因为 bundled 路径仍然撞 GitHub release 拉 0.11.x 被墙 + 0.12.x `--from` 不兼容，`scripts/download_uv.ps1` 同步废（保留 dev box 参考但 CI 不调）。**版本流转**：0.3.144 → 0.3.145（bump-on-commit 自动 patch）。

---

§0 narrative 之前的 creative-video-suite 11 个 commit 历史（874ad4f / baebe3c / cd6a091 / a79ce1e / dc0bacb / 9207fbd / 4f944b2 / 9207fbd × 2 / darwin-skill v2.1 round 1-6 / agnes-25-mcp v0.1.6）已全部折叠到 §4 git log。**§5.5 输入源铁律按工具拆分** + **§5.6 creative-video-suite promote + SYSTEM_SKILLS_VERSION 39→40** + **§5.7 视频时长边界单源化（双约束 4-12 字符串）** narrative 保留为未来 grep 锚点。

---

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
| NSIS installer | `src-tauri/nsis/installer.nsi` | 稳定 | `Section UvxFallback` 调 uvx-path-setup.ps1（pip-only 0.11.33 持久化 PATH） |

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
| 日志 / Runtime | `src/server/utils/` | 稳定 | `src/server/utils/runtime.ts` bundled Node；`path-safety` chokepoint；`findPipInstalledUvxScriptsDir` Windows probe 两条候选 Scripts dir |
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
| Settings UI | `src/renderer/pages/settings/{ToolboxSection,SettingsPage}.tsx` | 稳定 | `hidesDefaultArgs: true` builtin MCP 不显示 vendor 默认命令/参数（`toolbox.tools.defaultArgsHidden` placeholder） |

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
| hosted_mcps | `hosted_mcps/agnes-video-25/` | 7 tools（4 video + 3 image）；本仓库代码 = PyPI 0.1.6 vendor 源；P3 多 key fallback 已落地；Step 4 vendor sync 0.1.6 + e2e pending |
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

**Windows bundle 不再带 uvx.exe**（`src-tauri/resources/uvx.exe` 已 `git rm`，tauri config 资源条目已删）—— Windows install 改为 pip-only 路径：NSIS `Section UvxFallback` `pip install --user --index-url https://pypi.tuna.tsinghua.edu.cn/simple --upgrade uv` + `uvx-path-setup.ps1` 写 HKCU\Environment\Path。**已废弃**：`scripts/download_uv.ps1`（保留 dev box 参考但 CI 不调）；bundled `~/.hamuna/bin/uvx.exe`（TODO #121 原方案被 pip-only 取代）；`.dev-placeholder` 占位符方案（TODO #1）。

### 2.3 已安装后真实路径（prod，全集）

`app_dirs::hamuna_data_dir()` (`$HOME/.hamuna/`) 是**单一权威**路径解析器（`src-tauri/src/app_dirs.rs:112-114`）。完整 28 类文件 + 三平台真实路径 + 来源文件 → 见 **`specs/tech_docs/install_paths.md`**（TODO #112）。速查骨架：App bundle → `HamunaAgent.app/Contents/` (macOS) / `<install-dir>` (Win/Linux) / Tauri resource_dir → `<bundle>/Resources/{bundled-*,claude-agent-sdk,nodejs,uvx-path-setup.ps1,...}` / 用户数据 → `~/.hamuna/{config.json,sessions.json,skills,agents,providers,tasks.jsonl,...}` / Workspace → 用户在 UI 选定 + `<workspace>/{hamuna_files,creative-video-suite,...}` / MCP output → `$HOME/HamunaAgent/agnes-output/{videos,images}/`（**不在** `~/.hamuna/`）/ **uvx Scripts** → `%APPDATA%\Roaming\Python\Python312\Scripts\`（Windows per-user pip install 落点，installer 注册到 HKCU\Environment\Path）/ 外部凭据 → `~/.claude/` `~/.codex/` `~/.gemini/`（helper 黑名单）。

---

## 3. 当前 TODO（按优先级 + 状态）

### 3.1 进行中

#### TODO #129 — windows-release.yml `npm ci` 缓存 (`actions/setup-node@v4` `cache: 'npm'`) ✅ DONE
**触发**:v0.3.146 release run 2026-09-10 实测时间线显示 `npm ci` cold 占 ~8.4% (2m51s/34m),位居第三大瓶颈。前两瓶颈 cargo release (17m5s) + NSIS bundling (6m11s) 是物理下限不可压 → npm ci 是非物理瓶颈中最大可优化项。**改动 1 文件**（+5 -0）：`.github/workflows/windows-release.yml` step 4 `Setup Node.js 24` 加 `cache: 'npm'` 参数。`actions/setup-node@v4` 默认 cache key 派生自 `package-lock.json` hash → 首次 release cache miss (cold),后续 release cache hit → `npm ci` 2m51s → 几秒级。**独立于已有 Swatinem/rust-cache@v2**（不同 store,互不影响）。**scope 决策**：只改 `windows-release.yml`（workflow_dispatch,手动 release 烧,优化收益只在此处见效）;不动 `test.yml`（ubuntu-latest + npm install 走 Linux 路径,cache 行为独立,且 PR 周期引入新 cache miss cost 风险）。**用户拍板**：只动 A（npm cache），不动 B（beforeBuildCommand 去重）— **B 留 #130 follow-up**。**版本流转**：0.3.149（bump-on-commit 自动 patch）。**未验证**：(a) cache hit 实际节省时间（GitHub Actions cache 跨 release 持久性 + `actions/setup-node@v4` cache 协议在 windows-latest runner 上的实际命中率，需下次 release 验证）；(b) cache miss 时 cache setup 自身耗时是否抵消 cold `npm ci`（一般 setup-node cache 配置 <1s,远低于 npm ci cold 2m51s）;(c) 与现有 `Swatinem/rust-cache@v2` 是否有路径冲突（key 命名空间独立,理论无冲突,实际需观察）。

#### TODO #130 — `windows-release.yml` beforeBuildCommand 冗余去重 🔄
**触发**(TODO #129 副产物):复查 `npx tauri build --config src-tauri\tauri.windows.conf.json` (step 19) 触发 Tauri CLI 的 `beforeBuildCommand` 行为 → WebFetch Tauri 2 docs 确认 `--config` 走 **merge 语义**(未指定字段沿用默认 `tauri.conf.json`)→ 实读 `tauri.conf.json:10` `beforeBuildCommand = "node scripts/ensure_cuse_stub.mjs && npm run build:web && npm run build:server && npm run build:bridge && npm run build:cli"` + `tauri.windows.conf.json` 18 行无 `beforeBuildCommand` 字段 → **确认冗余**:step 19 Tauri build 内部又跑一次 build:web/server/bridge/cli,与 step 12 (`Build server / bridge / cli` = build:server + build:bridge + build:cli) + step 16 (`Build frontend` = build:web) 重复 → 实测估约 ~2m 浪费/run。**用户拍板**:暂不动 (#129 cache 落地后下次发版观察新瓶颈分布,再做去重决策 — 单独去重可能撞 cache miss 反而变慢,且需先验证 #129 cache hit 命准率)。**后续**:若 #129 cache 命中稳定且仍有冗余 → 选项 (a) 在 `tauri.windows.conf.json` 显式声明 `build: { beforeBuildCommand: "" }` 屏蔽 merge 继承;选项 (b) 改 `tauri.conf.json` 拆 `beforeDevCommand` 与 `beforeBuildCommand` 给 CI override 留钩子。**风险**:Tauri merge 语义对 `null`/`""` 值是否真覆盖(空字符串可能在某些 schema 校验失败,需先 dry-run 验证)。

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
**原方案**（A 路径）：auto-merge bundled MCP + bundled uvx 拷 `~/.hamuna/bin/`。**用户二次拍板**：改 pip-only —— 移除 bundled uvx.exe（`tauri.conf.json` + `tauri.windows.conf.json` bundle.resources + `.github/workflows/windows-release.yml` Download uvx step + `git rm src-tauri/resources/{uvx.exe,.uv-version}`）+ NSIS `Section UvxFallback` 改为无条件 `pip install --user --index-url https://pypi.tuna.tsinghua.edu.cn/simple --upgrade uv`（清华源，避开 GitHub release 大陆被墙）+ 新增 `src-tauri/nsis/uvx-path-setup.ps1`（写 HKCU\Environment\Path + WM_SETTINGCHANGE 广播）+ `tauri.windows.conf.json` 平铺到 `$INSTDIR\` + `src/server/utils/runtime.ts::findPipInstalledUvxScriptsDir()` Windows probe + 删除 `src/server/utils/runtime.ts::getBundledUvPath/getUserHomeBinUvxPath` + `mcp-bundled-seed.ts::seedBundledUvToHamunaBin` + 2 个 unit test 文件 + `index.ts` import/调用 + `agent-session.ts` uvx spawn 块改调新 helper。**pip-only vs bundled 决策依据**：(1) `download_uv.ps1` 修字符串字面量后仍走 GitHub release → 中国大陆下载不稳；(2) `uv` PyPI 包内含 `uvx` trampoline → pip install uv 一次解决；(3) PEP 370 per-user pip install 不自动加 PATH → `uvx-path-setup.ps1` 补齐 HKCU 持久化；(4) install 体积减 48 MB。**auto-merge 部分保留**（TODO #121 原方案的 mcp-bundled-seed.ts::seedBundledExtendedMcpServers 仍跑），只废 uvx 拷贝段。**遗留**：scripts/download_uv.ps1 保留 dev box 参考但 CI 不调（注释标 DEPRECATED 提醒）。

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
#### TODO #75 — v14 POC: image_edit 修 LED/slat wall bias 🔄
**策略**：v12 G3 grid（LED 偏白粉最严重）→ `image_edit` mask 染蓝 + 擦黑 → 重跑 G3 keyframe video
- **POC PASS 条件**：G3 末帧 LED ring = 蓝 + 背景 = 纯黑
- **POC FAIL 备选**：post-process color grading / 换 agnes-video-2.5（非 flash）/ 走 v13 lifestyle narrative
- **Stop hook**：v11/v12/v13 都没 3 条件全 PASS；v14 必须先验证 image_edit 路径

#### TODO #51 — tvc-director 跨段过渡 + keyframe 比例 + grid 单场景多机位铁律 🔄
**3 文件改动**（待 commit）：
- `tvc-director/SKILL.md` — first_frame 比例坑段后新增「Keyframe 模式铁律」
- `tvc-director/references/storyboard.md` — Part 二末尾「bridge 段」+ Part 三「9 panel = 同场景不同机位」+ Part 六「跨段连续性 4 小节」
- **commit msg 模板**：`feat(tvc-director): add segment transition methods + keyframe aspect ratio guard + grid single-scene rule`

#### TODO #13 — git hook 每次提交自动 bump 版本号 🔄
- `scripts/bump-on-commit.mjs` + `.githooks/prepare-commit-msg` 已实现；amend 用 `--no-verify` 防二次 bump
- **矛盾点**：每次 commit bump patch = 版本号成 commit 计数器；**待用户拍板提交**

#### TODO #11 — GitHub Actions Windows 构建 + 传 R2 + 自动 bump 🔄
- `.github/workflows/windows-release.yml` 22 步写完；首跑失败 "resource path ..\mino doesn't exist" → 方案 B 落地（提交 mino 进本仓库 git，284 文件 / 4.6MB）
- `~/.hamuna/projects/mino link` 与 bundle 复制逻辑交互需验证

#### TODO #9 — xueqiu skill 重设计 + skill-creator 评测 🔄
- `skills/crawl-xueqiu-my-timeline/` Python 2 修复 + CDP 探测 + 双源分析 + 自检
- **未 commit**（`skills/` 目录 untracked）；端到端 2026-08-24 实测通过（34 真实动态 + 24 发言人 → AI 投资分析 PDF 1.4MB）

#### TODO #25 — tvc-director storyboard 视觉契约升级 v0.5 🚧
物理约束落地（`220abea`）；后续扩展布局枚举 + 渲染精度。

#### TODO #24 — 创建 agent 时 seed 空 `.claude/settings.json` 占位 🔄
- 落点：`src-tauri/src/workspace_files/memory_rules.rs::ensure_claude_settings` + `cmd_ensure_claude_settings`；`ConfigProvider.addProject` agent 创建分支 fire-and-forget 调它
- Rust 2 单测；**未 commit**

#### TODO #5 — desktop Bash 工具 detached console spawn headed chromium 永远 hang 🚧
- 未根因定位；建议路线：`cmd_bash` 入口 stdio gate（headless 默认 / headed 仅 dev + TTY）+ spawn detached 时 `CREATE_NEW_PROCESS_GROUP` (Win) / `setsid` (POSIX)

#### TODO #7 — 本次 Linux cuse stub 改动未 commit 🚧
`build_linux.sh::[5/6]` 自动生成 stub + trap EXIT 清理；`cargo check/clippy/build --release` ✅；**待 user 拍板提交**。

#### TODO #3 — 预先存在的 unit test 失败（与 dev 启动修复无关）
`widgetSandboxHtml.test.ts` 等 6 个 unit test 在 master `5c92cd8` 同样失败；**待独立排期**。

### 3.2 P3 多 Key Fallback Pipeline（新）🔄
**目标**：让 `agnes-video-25-mcp` server 在 `AGNES_API_KEY` daily quota 撞顶（429）时自动切换备用 key。解决 2026-09-08 UGC 2nd 跑 5 个 key 撞 daily quota → 17h 阻塞问题。

**Spec 已落地**：`.pavo-research/agnes-multi-key-fallback-spec.md`（~230 行，4 点核心：向后兼容 / in-memory KeyState 状态机 / 入口收敛到 `_request_json` 改 1 处 / 10 个单测 case）。

| Task | 状态 | 内容 |
|------|------|------|
| **#18 P3 Step 1 — spec** | ✅ DONE | spec 写完 + 行号标注 + 风险/妥协列表 + 4 选 1 拍板选项 |
| **#19 P3 Step 2 — 改代码** | ✅ DONE（0.1.4 in-memory）+ ✅ DONE（0.1.6 持久化 + 30s 窗口） | 改 `server.py` + `tests/test_key_pool_cooldown.py` 6 assert self-check；in-memory pool + persisted state + atomic tmp+replace + `AGNES_KEY_POOL_STATE_DIR` 覆盖 + 30s 窗口 reason split + cooldown 完 refresh `last_429_at=0` |
| **#20 P3 Step 3 — bump + PyPI** | ✅ DONE（v0.1.6） | `pyproject.toml` 0.1.5 → 0.1.6 + PyPI v0.1.6 whl 15122B + tar.gz 81054B, upload_time 2026-09-09T16:24:15/18 |
| **#21 P3 Step 4 — vendor + mcp.json + e2e** | 🔄 pending | `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` 同步 0.1.6；`extended_buildin_mcp/mcp.json` pin 0.1.5 → 0.1.6（或靠 TODO #113 bump-on-commit.mjs AGNES_MCP auto-bump 段下次 commit 自动 patch）；跑 2nd UGC 剩余 5 段验证 fallback 真生效 |

**P3 设计 4 关键点**：向后兼容 / KeyState 4 态状态机 / 入口收敛到 `_request_json` / 10 个单测 case。**4 个已记录但暂不实现的妥协**：in-memory 不持久化 / 401 不自我恢复 / 状态查询用提交成功那个 key / 429 reset 解析失败保守到下个 UTC 00:00。

### 3.3 待办池

#### TODO #17 — 2nd UGC 后半 5 段视频 🔄 quota-pending
**触发**：TODO #104 1st UGC 成功后用户要求再跑一次端到端验证 URL 复用。**撞 429 daily quota**（request IDs: `20260908063506204136165EwLlEv8i` / `20260908064500904279309wqCF2qMO`），17h 24min 直至 2026-09-09 00:00 UTC 刷新。
- **P3 落地后**用 2 个 key 重新跑（一个撞 1st quota，另一个备用）
- **中间路径**：P3 spec 落地后，`.mcp.json` 配置 `AGNES_API_KEYS=key1,key2` 后**立刻**就能跑

#### TODO #1 — `.dev-placeholder` 方案 ❌ 废弃
已删；如未来 `tauri-build` 收紧校验目录非空，`beforeDevCommand` 才需补内容填充。

### 3.4 已落地（仅指针，detail 见 §4 + git log）

- #29 tvc-director chatui 渲染层对齐 v0.9 / #97 hosted_mcps/agnes-video-25/ 7 tools / #14 TypeGraph 重构 KB / #16 fresh install kb-relations poller / #12 skill 安装 `/skillname` unknown command 修复 / #98 30s TVC e2e v9 PASS / #99 v10 60s lifestyle TVC PASS / #100 v11 60s TVC ⚠ 部分通过 / #101 v12 60s TVC ⚠ 条件1 PASS / #102 v13 1x5 reference mode ❌ FAIL / #103 creative-video-suite 全量迁移 ✅ DONE / #104 1st UGC 5 段 60s ✅ DONE + URL 复用铁律 / #107 多视角产品图 / #108 视频时长边界 / #111 helper agnes-video-25 路由 / #112 install_paths.md / #113 auto-bump pin / #114 video 轮询 + 串行 / #115 version 文件残留 / #116 SKILL frontmatter auto-bump / #117 required_assets 硬门控 / #118 storyboard JSON schema / #119 model agnes-video-2.5-flash 锁死 / #120 creative-ad-director skill / #121 Windows install MCP auto-merge + uvx PATH（pip-only 落地）/ #122 bundled uv 0.5.11 → 0.11.33 重 pin / #123 getBundledUvPath slot 3 / #124 hidesDefaultArgs / #125 download_uv.ps1 字符串字面量 / #126 install-time `pip install uv` pin 0.11.33 / #127 windows-release.yml install-time smoke test / #128 pip mirror 清华 → 阿里 + PyPI fallback

---

## 4. 最近已完成（git log 指针）

| Commit | 摘要 |
|--------|------|
| `<pending>` | **ci(windows): cache npm in windows-release.yml to skip ~2m51s cold npm ci on subsequent releases (snapshot TODO #129, 1 文件 / +5 -0)** |
| `<pending>` | **fix(install): switch pip mirror to Aliyun with PyPI fallback (清华源 2026-09-10 timeout, snapshot TODO #128, 2 文件 / +15 -2)** |
| `<pending>` | **ci(windows): gate R2 upload on install-time smoke (verifies NSIS UvxFallback lands uv==0.11.33 + uvx --from works, snapshot TODO #127, 1 文件 / +108 -0)** |
| `<pending>` | **fix(install): pin install-time uv to ==0.11.33 to avoid 0.12.x `uvx --from` tightening (rationale chain 197837b/4812fbe/37a7f21, snapshot TODO #126, 2 文件 / +12 -1)** |
| `<pending>` | **feat(install): pip-only uvx on Windows (remove bundled uvx.exe, NSIS Section UvxFallback → pip install --user uv from Tsinghua mirror + uvx-path-setup.ps1 HKCU\Environment\Path 持久化, 6 文件 / -48MB bundle)** |
| `<pending>` | **fix(uvx): pin 0.11.33 as string literal + drop broken GitHub API auto-track (download_uv.ps1 bare-numeric bug 修复)** |
| `<pending>` | **fix(uv): replace stale bundled uvx.exe 0.12.3 → 0.11.33 (SHA256 c253ce86...; 数据修正，与脚本修复同时提交)** |
| `<pending>` | **feat(settings): add hidesDefaultArgs boolean for extended builtin MCP (vendor default command/args 在 Settings UI 不暴露)** |
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
| `ea9b524` | **fix(attachments) rebase workspace attachment_ref previews to data URLs at send time** |
| `51f3f98` | **feat(attachments) trash workspace file when an image attachment is removed** |
| `c70fd60` | **fix(attachments) replace `node:path.join` with renderer-safe `joinWorkspacePath`** |
| `0f1073e` | **feat(tvc-director) enforce strict tool contract** |
| `db191e2` | **fix(tvc-director) align SKILL.md to agnes-video-25-mcp v0.1.3 tool surface** |
| `220abea` | **fix(tvc-director) anchor storyboard objects via physics + layout hard constraints** |
| `1d6743a` | **test(tvc-director) validate spec portability with afternoon_tea archetype + 2 PNG renders** |
| `014453d` | **feat(tvc-director) add canonical morning-rush fixture as future-spec baseline** |
| `4b5c90c` | **feat(mcp) introduce agnes-video-25 + unify media MCP under id="multimedia-creator"** |
| `7f8c60d` | **feat(extended-builtin-mcp) add `${bundled:REL_PATH}` placeholder for portable MCP args** |

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

### 5.1 预 commit 硬闸

1. `npm run typecheck` + `npm run test:unit`（改 `.test.tsx` 加 `test:dom`；改 session/runtime/IO/security 加 `test:classification` + `test:integration`）
2. `git status` 确认无并发 writer 混入；**禁** `git add -A` / `git add .`
3. amend 任何 commit 一律 `git commit --amend --no-verify`（防 pre-commit bump-on-commit 二次 patch bump）
4. **禁** `git add -f` 把 ignored 文件塞进提交（PRD / research 草稿只落盘不提交）
5. **发布前验"已提交态"**：并发 writer 可能提交组件改动却把配套测试 fix 留在工作区 → `git stash` 无关工作区再跑易红测试

### 5.2 决策待定（2026-09-08）

- **creative-video-suite 模型 fallback 策略**（**用户拍板：暂不动**）：
  - 用户原话："agnes-video-25 默认视频模型 agnes-video-2.5-flash fallback agnes-video-2.0；默认图像模型 agnes-image-2.5-flash fallback agnes-image-2.1-flash"
  - **矛盾点 1（已上线红线冲突）**：`bundled-skills/creative-video-suite/references/agnes-ai-api.md:261` 写明"旧版本（v2.0）模型 `agnes-video-v2.0` / `agnes-image-2.0-flash` / `agnes-image-2.1-flash` 已全部下线，禁止再使用"——用户给的 fallback 模型名正落在"已下线"清单
  - **矛盾点 2（重试铁律冲突）**：commit `ac7da54` 的 mcp-call-templates.md §4.1 重试铁律明确"禁止简化 prompt / 禁止删 ref / 禁止降级 mode"——与"fallback 时 prompt + images[] 可调"语义重叠但边界不同（重试 vs fallback）
  - **现状铁律保持**：model 锁定 2.5-flash 系列 + 2 次重试（**retry 期间 0 微调**，按 attempt 1 原样）+ 不得 fallback（mode / prompt / images[] / size / seconds / aspect_ratio 全部冻结）+ attempt 4 停下交用户
  - **未来 fallback 边界预案**（仅备忘，等下次会话明确再启动）：
    - 触发：2.5-flash 失败 2 次后切换到 fallback 模型
    - fallback 时允许：prompt 微调 / images[] 微调
    - fallback 时禁止：mode / size / seconds / aspect_ratio / 工具切换
  - **潜在下一动作**（用户未确认，不动）：
    - 选项 a：MCP server 端重新支持 v2.0 / v2.1-flash → 删 agnes-ai-api.md:261 "已下线"段 + 9 个文件补 model= 字段和 fallback 策略
    - 选项 b：fallback 升级到 2.5-pro 系列（更稳定但更慢/更贵）→ 同上但 fallback 模型名不同
    - 选项 c：保持现状不动

### 5.5 输入源铁律按工具拆分（2026-09-08 落地，commit `3eba012` on `dev/skill-input-source-split`）✅

**触发**：用户报"`mcp__multimedia-creator__agnes25_image_generate` 传入的 `image_paths` 预处理三种类型" → grlling 指出工具名错（`image_generate` schema 不含 `image_paths`），用户原意指 `image_edit.image_paths`。验证官方 agnes API + hosted_mcps wrapper client-side 归一化行为后，确认现有铁律（HTTPS URL only / 禁本地 / 禁 base64）**一刀切过度推广**——根因动机只对 video_generate 字段成立（避开 `img.remit.ee` QPS 限流）。用户拍板"参考 agnes api 支持格式判断" → 走**选项 C**（按工具拆两段铁律）。

**实测与文档证据**：
- agnes 官方 docs（`wiki.agnes-ai.cn/docs/agnes-image-25-flash`）：`extra_body.image` 接 HTTPS URL + Data URI Base64（"如果 URL 无法公开访问，请使用 Data URI Base64"）；官方未列本地路径
- agnes 官方 docs（`wiki.agnes-ai.cn/docs/agnes-video-25`）：`images[]` / `first_frame` / `last_frame` 仅 HTTPS URL（"所有媒体 URL 都应当可由 Agnes AI 服务公开访问"）
- `hosted_mcps/agnes-video-25/SKILL.md:40-79` Reference media resolution 表 + Image tool contract 段（client-side 归一化）

**最终铁律（按工具拆两段）**：

| 工具 / 字段 | HTTPS URL | Data URI base64 | 本地路径 | 根因 |
|---|---|---|---|---|
| `image_edit.image_paths` / `mask_path` | ✅ 优先 | ✅ pass through（256KB SSE 约束） | ✅ server 编码 data URL 后传入（**不走** img.remit.ee） | agnes 官方 API 支持 URL + Data URI；hosted_mcps 客户端归一化 |
| `video_generate.images[]` / `first_frame` / `last_frame` / `audios[]` | ✅ **唯一合规** | ❌ decode→temp→上传 img.remit.ee（撞 QPS 限流） | ❌ 上传 img.remit.ee（撞 QPS 限流） | agnes 视频 API 只接受公开可访问 HTTPS URL；hosted_mcps 上传 img.remit.ee 是不可避免的归一化路径 |

**改动 5 文件**（净 +54 行 / -10 行）：
1. `bundled-skills/creative-video-suite/SKILL.md` — 5 步硬门控第 1 条按工具拆两段；诊断澄清表 (line 134) 拆成 video_generate / image_edit 两行
2. `bundled-skills/creative-video-suite/references/agnes-ai-api.md` — 「输入源支持」段重写为路径 A (image_edit 3 种) / 路径 B (video_generate HTTPS-only) 两段；`image_paths` / `mask_path` 参数描述更新；schema 表 `image_paths[]` 行更新；集成清单 (1)(6) 项按工具拆分
3. `bundled-skills/creative-video-suite/references/mcp-usage-guide.md` — schema 表 `image_paths[]` 行更新；集成清单 (1)(6) 项按工具拆分
4. `bundled-skills/creative-video-suite/references/mcp-call-templates.md` — T01-T03 `image_edit` 模板 placeholder 注释标明 image_edit 字段允许 3 种格式
5. `bundled-skills/creative-video-suite/references/output-conventions.md` — line 128 给 model 的 URL vs 给 AI 的 file path 段按工具拆分表述

**未改动**：
- `references/commercial/{ugc-talking-video-ref,product-marketing-ad-video-no-storyboard-ref,corporate-business-video-ref}.md`（line 389, 471, 809, 823 等）—— 都是 `video_generate` 字段 HTTPS URL only，**与新铁律 video_generate 段一致**
- `references/drama/{assets,frame,prompt}.md` —— frame / prompt 阶段产物都是 `video_generate` 喂入（`first_frame` / `images[]`），HTTPS URL only 不变；assets 阶段产物说明「model 端用 HTTPS URL」也是 video_generate 喂入路径
- `references/widget-templates.md` —— widget URL 是 sandboxed iframe CSP 路径（output 端），与 MCP input 端铁律独立，**不**改
- `bundled-skills/tvc-director/` —— grep 0 命中 input-source iron rule，无同步需求

**已知遗留**：
- (a) Sidecar SSE 256KB clamp 行为是否对 `image_edit` 输出生效——`tool-result-attachments.ts` 是否 spill 大 attachment 没看源码，本铁律默认假设 image_edit 输出经 Sidecar SSE 路径受 256KB 约束
- (b) `image_edit` 放行本地路径后，`project.json.notes.image_paths_source` 是否加新字段追踪「本地 vs URL vs Data URI」未拍板
- (c) ~~utility skill 不自动同步老用户 → §5.6 落地 promote + bump `SYSTEM_SKILLS_VERSION` 39→40 已解决~~

### 5.6 creative-video-suite: promote utility → system skill + `SYSTEM_SKILLS_VERSION` 39→40（2026-09-09）

**用户拍板**：grlling 指出 utility skill 不自动同步老用户的根因（与 baebe3c / cd6a091 / a79ce1e / dc0bacb / 9207fbd / 4f944b2 / `<pending>` 同源 7 个 commit 已积累 1 周未生效）→ AskUserQuestion 3 选项让用户拍板 → 选 **「Promote + bump（强制更新老用户）」**。

**改动 3 文件**（最小 diff）：
1. `src-tauri/src/commands.rs` — `SYSTEM_SKILLS_VERSION` `"39"` → `"40"` + `SYSTEM_SKILLS` 数组追加 `"creative-video-suite"`
2. `src/server/index.ts` — `SYSTEM_SKILLS` 数组同步追加 `'creative-video-suite'`
3. `snapshot.md` — TODO #107 ✅ DONE / TODO #103 follow-up 改 DONE / §4 git log 加 `aa19103` commit / §5.5(c) 已知遗留划掉 ✅ / 本 §5.6 新增

**关键架构决策**：版本号为何选 40 而非跳号 / 两个清单必须同步 / mirror 注释而非只 mirror 字符串 / 不重构既有 v35 `hamuna-docs` / v33 memory-* / v29 prompt-writer 注释风格

**promote 后续影响（自动）**：
- `cmd_sync_system_skills` 检测 `VERSION` mismatch → 触发 force-overwrite → 老用户 `~/.hamuna/skills/creative-video-suite/` 整个目录被覆盖
- 本 skill 内容变更后续不需再 bump（system skill 模式自动 overwrite）

**已知遗留**：
- (a) 老用户本地如有 `~/.hamuna/skills/creative-video-suite/` 下自定义文件（非 skill 内容），force-overwrite 会删除——按现有 system skill 设计就该这样
- (b) bump 版本号 vs 内容版本号脱钩——后续 creative-video-suite 内容改动**不**再 bump 版本号
- (c) 本 skill `~/.hamuna/skills/creative-video-suite/` 老版本用户本地 `project.json.notes.product_metadata` 不存在——promote 后新约定 T13 + product_metadata schema，AI 在 assets 阶段首次需要时会**主动创建**

### 5.7 视频时长边界单源化（2026-09-09 落地，§3.1 TODO #108 ✅ DONE）

**触发**：用户 mid-turn 报 "creative-video-suite skill 生成分镜的最低/追高秒数要符合 mcp 对应工具的定义"——`video_generate.seconds` 字符串合法值集合与 4-12 双重约束散落 9 个 ref，**没有**单一权威源 → 易在新增 commit 漂移。

**单一权威段**：`bundled-skills/creative-video-suite/references/agnes-ai-api.md §视频时长边界（单一权威 · 2026-09-09 加）`——含双重约束（4 下限 / 12 上限）+ 9 合法值字符串集合 `"4"`-`"12"` + 各分支锁定策略表 + 边界外异常处理表 + 跨 ref cross-link 锚点。

**红线条目**：

| 红线 | 后果 | 正确做法 |
|---|---|---|
| 把 `video_generate.seconds` 当 int 喂（如 `12` 而非 `"12"`） | MCP schema 校验失败 → 400 | 严格用字符串字面量 |
| 用 9 合法值集合外的字符串（`"3"` / `"13"` / `"4.5"` / `"11.5"`） | MCP schema 校验失败 → 400 | 用 `"4"`-`"12"` 整数秒字符串 |
| 改 4 下限（写 `< 4 秒` 可生成） | 撞 schema 校验失败 | 必须 ≥ `"4"`，< 4 改 image_generate + frame 拼接 |
| 改 12 上限（写 `≤ 13 秒`） | 撞 schema 校验失败 | 必须 ≤ `"12"`，> 12 走 `long_video_stitch_mode` |
| 在多个 ref 重复完整约束（drift 风险） | 9 处 copy 易漂移 | 全部 cross-link 到 §视频时长边界（单一权威） |

**全栈落地 10 文件**：`agnes-ai-api.md` (canonical) / `SKILL.md` (Step 4 cross-link) / `drama/{frame,storyboard,prompt}.md` (drama 2 路 cross-link + 90→72 fix) / `mcp-usage-guide.md` (gate 11→12) / `commercial/{ugc,marketing,corporate}-*-ref.md` (16 处 "上限 12"→"边界 4-12（上限 12）" in-place) / `mcp-call-templates.md` (T04/T07 注释 + gate 11→12) / `widget-templates.md` (§6.6 T13 footnote 显式豁免) / `README.md` (新 `## 视频时长边界` 段) / `snapshot.md` (本段 + TODO #108)。
**image_generate / image_edit / T13 不受约束**：3 类工具无 `seconds` 参数 → widget-templates.md §6.6 footnote 显式说明。