# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务指针。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。snapshot.md 不允许无限增长；已完成项落地到 §4 git log / 删除 narrative 后立即清出本节。
> **硬约束**：snapshot.md ≤ 500 行。

最后更新：**2026-09-08**（P3 multi-key fallback spec 完成 → `.pavo-research/agnes-multi-key-fallback-spec.md`，待用户拍板进 Step 2；snapshot.md 重整从 526 → ≤500 行）。**+ agnes-short-drama skill 端到端测试 5/5 PASS + 2 项 bug 触发修复**：(1) 道具/角色/场景 3 image gen；(2) Shot 5 reference 视频 8s 720P 生成（视觉一致性验证 PASS）；(3) 4 视频并行提交触发日配额 429（端到端确认 agnes 单账户 5-10 视频/天硬约束）→ `delivery.md §8.4` 新增配额限制应对策略。修复：(a) 场景"无人物"→ 加英文反面词；(b) 道具"二次元动漫风格"→ 加 "anime lineart" 锁定线稿；(c) images 本地路径不稳 → `storyboard.md §4.3` 切换 HTTPS URL 最佳实践（已写入）。

**+ uvx.exe prod 打包漏声明修复**：用户报"Windows 安装后 multimedia-creator 提示找不到 uvx"。根因 = `tauri.conf.json::bundle.resources` **缺 `"uvx.exe": "uvx.exe"` 一行**（download_uv.ps1 + build_windows.ps1 + agent-session.ts fallback 三段都正确，唯独 tauri-build 不打包这个文件进安装包 → 安装包没 uvx.exe → runtime.ts::getBundledUvPath() prod layout 永远 null → SDK spawn `command: 'uvx'` 走 PATH → 用户没装 → command_not_found）。修复 3 处：(1) `tauri.conf.json` 第 60 行加 uvx.exe 声明；(2) `agent-session.ts:3611-3614` fallback 找不到时 `console.warn` 给清晰提示（macOS/Linux 设计如此，但原本静默）；(3) `.github/workflows/test.yml` Linux CI 占位符列表加 `uvx.exe`（tauri-build 校验所有 bundle.resources 路径存在 → 不加占位符 Linux `cargo test` 会挂）。`windows-release.yml` 已下载 uvx（line 103-107）→ 自动受益；`release.yml` 已禁用。dev 不受影响。

**+ uvx.exe prod layout 假设错误修复（继上述）**：用户实测确认"新安装的 uvx.exe 在安装目录根"——Tauri 2 NSIS 把单文件 `.exe` bundle.resources 放在 `<install-dir>/` 而非 `<install-dir>/resources/`（与 `server-dist.js`/`nodejs/` 等不同），但 `runtime.ts::getBundledUvPath()` 此前假设 `resolve(scriptDir, 'uvx.exe')`（nested）。修复 `runtime.ts::getBundledUvPath()` 优先查 `<install-dir>/uvx.exe`（root, `resolve(scriptDir, '..', 'uvx.exe')`）+ 保留 nested fallback 兼容 layout 变化 + dev walk-up 不变。**端到端验证建议**：用户下次升级安装后看 `[agent] MCP multimedia-creator: resolved uvx via bundled fallback → C:\...\HamunaAgent\uvx.exe` 这条日志。

**+ uvx 0.5.11 pin + MCP spawn PATH 注入（`197837b`）**：用户报"uvx 0.12.3 不支持 `--from`"——一手源码（uv main `crates/uv/src/commands/tool/run.rs`）确认 `--from` 仍支持，但 0.12.x 把 arg 解析变严格 + 拒绝未知 flag（如我们 args 里的 `--default-index` uv tool run 根本不存在）。3 改动：(1) `scripts/download_uv.ps1` param default 锁 `"0.5.11"`（0.5.x 最后 patch，最后兼容 `--from <pkg> <cmd>` 老语法的版本线），注释标"升级前要先改 mcp.json 到现代 `uvx <tool>@<ver>` 语法 + CI smoke test"；(2) `src/server/agent-session.ts` uvx fallback 从"覆写 `command` 为绝对路径"改成"把 bundled uvx 目录 prepend 进 `mcpEnv.PATH`"——`.mcp.json` 仍写 `command: "uvx"`（声明式、不暴露机器路径），SDK PATH 解析命中 bundled 副本；副作用：macOS/Linux 仍走 null warning（未 bundle，按设计）；(3) `.mcp.json` + `extended_buildin_mcp/mcp.json` 删 `--default-index` 改 `env.UV_INDEX_URL`（`uv tool run` 没 `--default-index` flag；PyPI 是默认源，写 `--default-index https://pypi.org/simple` 等于重复 + 0.12.x reject；绕开清华镜像的正确做法是 `UV_INDEX_URL` env）。**已知遗留风险**：两个 mcp.json 仍是 tracked 且含真实 `AGNES_API_KEYS`（用户拍板"先改不改 key"，tracked-key rotation 单独 TODO）。**layout 矛盾**（`runtime.ts:42-48` 注释 vs 实际 prod layout）未解——pin 0.5.11 让 prod probe 链继续工作，没动力现在改；下次再 break 加 probe log。

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

### 1.2 Sidecar / Node.js 后端 (`src/server/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Sidecar 入口 | `src/server/index.ts` | 稳定 | `SYSTEM_SKILLS` 清单 |
| Session Engine | `src/server/session-engine/` | 稳定 | `selector.ts` 统一 adapter 分流 |
| Builtin Session | `src/server/builtin-session/` | 稳定 | `lifecycle / turn-lifecycle / config / types` |
| External Runtime | `src/server/runtimes/external-session/` | 稳定 | Claude Code / Codex / Gemini |
| Agent Session | `src/server/agent-session.ts` | 稳定 | facade；`reloadLiveSessionSkills` |
| Skill Reload | `src/server/utils/skill-reload.ts` | 稳定 | 纯函数 `evaluateSkillReload` |
| Builtin MCP | `src/server/tools/{builtin-mcp-meta,builtin-mcp-registry}.ts` | 稳定 | `src/server/tools/*.ts` 禁顶层 import SDK/zod |
| Gemini Image Tool | `src/server/tools/gemini-image-tool.ts` | 稳定 | 懒加载 |
| Edge TTS Tool | `src/server/tools/edge-tts-tool.ts` | 稳定 | 懒加载 |
| IM Bridge Tools | `src/server/tools/im-bridge-tools.ts` | 稳定 | runtime-dynamic，context-injected |
| Third-party Providers | `src/server/{provider-verify,subscription-auth,openai-bridge}.ts` | 稳定 | |
| Plugin Bridge | `src/server/plugin-bridge/` | 稳定 | shim 版本同步 bump |
| MCP OAuth | `src/server/mcp-oauth/` | 稳定 | |
| 日志 / Runtime | `src/server/utils/` | 稳定 | `runtime.ts` bundled Node；`path-safety` chokepoint |
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
| creative-video-suite skill | `bundled-skills/creative-video-suite/` | 稳定；TODO #103 落地；短剧/UGC/企业宣传；5 段口播端到端验证通过 |
| agnes-short-drama skill | `bundled-skills/agnes-short-drama/` | utility；Pavo 调研产物；4 字段用户输入 → 6 元数据 → 导演式剧本；未入 `SYSTEM_SKILLS` |
| xueqiu skill | `skills/crawl-xueqiu-my-timeline/` | 实验 skill，untracked；TODO #9 |
| hosted_mcps | `hosted_mcps/agnes-video-25/` | 7 tools（4 video + 3 image）；本仓库代码 = PyPI 0.1.3 vendor 源；P3 多 key fallback 进行中 |
| `scripts/ensure_{claude_sdk_package,rust_toolchain,download_*}.ps1` | 稳定 | `Test-SdkVersionRange` semver 三态 |
| `scripts/{esbuild-bundle,bump-on-commit}.mjs` | 稳定 | amend 必须 `--no-verify`（memory `bump-on-commit-amend-no-verify.md`） |
| `setup_windows.ps1` | 稳定 | 已删 `.dev-placeholder` 占位符方案（TODO #1 废弃） |
| `scripts/{kb-recall-test.ts,kb-verify-stats.mjs}` | 稳定 | LLM dry-run + A/B ROI |

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

**已废弃**：`.dev-placeholder` 占位符方案（TODO #1）—— `setup_windows.ps1` 原步骤隐式创建空目录，`cargo build` 资源校验只看存在不校验非空；如未来收紧校验非空，`beforeDevCommand` 才需补内容填充。

---

## 3. 当前 TODO（按优先级 + 状态）

### 3.1 进行中

#### TODO #75 — v14 POC: image_edit 修 LED/slat wall bias 🔄
- **策略**：v12 G3 grid（LED 偏白粉最严重）→ `image_edit` mask 染蓝 + 擦黑 → 重跑 G3 keyframe video
- **POC PASS 条件**：G3 末帧 LED ring = 蓝 + 背景 = 纯黑
- **POC FAIL 备选**：post-process color grading / 换 agnes-video-2.5（非 flash）/ 走 v13 lifestyle narrative
- **Stop hook**：v11/v12/v13 都没 3 条件全 PASS；v14 必须先验证 image_edit 路径

#### TODO #103 — 拷 video-skill → bundled-skills/creative-video-suite 🔄
**全量迁移完成**（见 §4 指针）：5 段口播端到端验证 + URL 复用铁律 + prompt 修复（场景「无人物」→ 英文反面词 / 道具「二次元动漫」→ 「anime lineart」）。**待 user 拍板 commit**（含 `.mcp.json` / `extended_buildin_mcp/mcp.json` 切换拍板）。

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
| **#19 P3 Step 2 — 改代码** | 🔄 待启动 | 改 `server.py` `_request_json` + 3 个 helper（`_parse_api_keys` / `_pick_key` / `_mark_disabled`）+ 10 单测 case；`pytest tests/test_multi_key_fallback.py` 全过 |
| **#20 P3 Step 3 — bump 0.1.4 + PyPI** | 🔄 pending | `pyproject.toml` 0.1.3 → 0.1.4 + `python -m build` + `twine check` + `twine upload`（**上传前再让用户拍板一次**） |
| **#21 P3 Step 4 — vendor + mcp.json + e2e** | 🔄 pending | `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` 同步 0.1.4；`.mcp.json` + `extended_buildin_mcp/mcp.json`：把 `AGNES_API_KEY` 拆成 `AGNES_API_KEYS` + 锁 `==0.1.4`；跑 2nd UGC 剩余 5 段验证 fallback 真生效（2 个 key，1 个 daily quota 撞顶看是否自动切到第 2 个） |

**P3 设计 4 关键点**（详见 spec）：
1. **向后兼容**：`AGNES_API_KEYS`（新，逗号分隔）优先 `AGNES_API_KEY`（旧，单值）
2. **Key 池状态机**：可用 / quota_429 暂时禁 / auth_401 永久禁 / service_503 60s 短禁；in-memory 进程级
3. **入口收敛**：只改 `_request_json` 一个 helper，3 个调用方（submit / status / image）自动受益；~120 行 diff
4. **单测 10 case**：单 key 兼容 / 429 fallback / 401 永久禁 / 全耗尽抛错 / 503 短冷却 / 400 不切换 / env 优先级 / 空白 strip / quota reset 解析

**4 个已记录但暂不实现的妥协**（spec §7）：in-memory 不持久化 / 401 不自我恢复（log warning 让用户修）/ 状态查询用提交成功那个 key（不切）/ 429 reset 解析失败保守到下个 UTC 00:00。

### 3.3 待办池

#### TODO #17 — 2nd UGC 后半 5 段视频 🔄 quota-pending
**触发**：TODO #104 1st UGC 成功后用户要求再跑一次端到端验证 URL 复用。**撞 429 daily quota**（request IDs: `20260908063506204136165EwLlEv8i` / `20260908064500904279309wqCF2qMO`），17h 24min 直至 2026-09-09 00:00 UTC 刷新。
- **P3 落地后**用 2 个 key 重新跑（一个撞 1st quota，另一个备用）
- **中间路径**：P3 spec 落地后，`.mcp.json` 配置 `AGNES_API_KEYS=key1,key2` 后**立刻**就能跑（不阻塞 P3 vendor 步骤）

#### TODO #1 — `.dev-placeholder` 方案 ❌ 废弃
已删；如未来 `tauri-build` 收紧校验目录非空，`beforeDevCommand` 才需补内容填充。

### 3.4 已落地（仅指针，detail 见 §4 + git log）

- #29 tvc-director chatui 渲染层对齐 v0.9 / #97 hosted_mcps/agnes-video-25/ 7 tools / #14 TypeGraph 重构 KB / #16 fresh install kb-relations poller / #12 skill 安装 `/skillname` unknown command 修复 / #98 30s TVC e2e v9 PASS / #99 v10 60s lifestyle TVC PASS / #100 v11 60s TVC ⚠ 部分通过 / #101 v12 60s TVC ⚠ 条件1 PASS / #102 v13 1x5 reference mode ❌ FAIL / #104 1st UGC 5 段 60s ✅ DONE + URL 复用铁律

---

## 4. 最近已完成（git log 指针）

| Commit | 摘要 |
|--------|------|
| `874ad4f` | **feat(creative-video-suite): expose 6 visual style presets + commercial style_ref gate** |
| `197837b` | **fix(mcp): pin bundled uv 0.5.11 and inject uvx dir into MCP spawn PATH** |
| `ffe8edb` | **feat(bundled-skills): add creative-video-suite for short-drama / UGC / corporate** |
| `853da79` | v2 |
| `77fdd97` | docs(snapshot) log 276d8e8 tvc-director grid default 15s→12s |
| `276d8e8` | fix(tvc-director) set grid default unit from 15s to 12s (agnes max) |
| `5c96b15` | docs(snapshot) log 66b6397 tvc-director storyboard reference seconds=12 |
| `66b6397` | fix(tvc-director) set storyboard reference default seconds to 12 |
| `2338a83` | **feat(attachments) drag-drop media → workspace/hamuna_files**（双轨） |
| `db2d91f` | **fix(attachments) resolve workspace-relative paths to absolute before read_files_b64** |
| `368ee90` | **fix(attachments) override `source` to inline_base64 when rebasing attachment_ref** |
| `079c96f` | **docs(tvc-director) switch video model agnes-video-2.5 → agnes-video-2.5-flash**（720P 锁 / images ≤5 / audios ≤3 / videos 0） |
| `7191b91` | **fix(tvc-director) video prompt must reference both `<Picture 1>` (grid) and `<Picture 2>` (product)** |
| `ea9b524` | **fix(attachments) rebase workspace attachment_ref previews to data URLs at send time** |
| `51f3f98` | **feat(attachments) trash workspace file when an image attachment is removed** |
| `c70fd60` | **fix(attachments) replace `node:path.join` with renderer-safe `joinWorkspacePath`** |
| `0f1073e` | **feat(tvc-director) enforce strict tool contract**（locked params + fail-fast + retry once） |
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

### 5.1 预 commit 硬闸

1. `npm run typecheck` + `npm run test:unit`（改 `.test.tsx` 加 `test:dom`；改 session/runtime/IO/security 加 `test:classification` + `test:integration`）
2. `git status` 确认无并发 writer 混入；**禁** `git add -A` / `git add .`
3. amend 任何 commit 一律 `git commit --amend --no-verify`（防 pre-commit bump-on-commit 二次 patch bump）
4. **禁** `git add -f` 把 ignored 文件塞进提交（PRD / research 草稿只落盘不提交）
5. **发布前验"已提交态"**：并发 writer 可能提交组件改动却把配套测试 fix 留在工作区 → `git stash` 无关工作区再跑易红测试
