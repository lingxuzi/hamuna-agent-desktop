# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。snapshot.md 不允许无限增长；已完成项更新完项目状态后立即清出。

最后更新：**2026-09-08**（v12 60s TVC 完成 + 1fps 抽检 11 帧验证：①条件 PASS / ②③ 弱通过；新增 LED 颜色偏白粉 + G5 背景 slat wall 瑕疵；见 TODO #101）。**+ Pavo 短剧调研完成**：`.pavo-research/` 沉淀 6 样本 + REPORT + COMPARISON；新建 `bundled-skills/agnes-short-drama/`（SKILL.md 17KB + 6 references ~70KB + README 双语 + examples/E01_模糊的勇气 503 行端到端 demo）：AI 短剧创作导演工作台（4 字段用户输入 → 6 元数据自动展开 → 导演式剧本语法 → agnes-image/video 关键帧/视频提示词；3 风格层级 60+ 模板 + 4 叙事模型；未注册 `SYSTEM_SKILLS`，属 utility）。**+ multimedia-creator 端到端验证 4/4 PASS**（@日记道具 / @林小满惊惶 / @图书馆黄昏 / E01_Shot05 reference 模式 8s 720P 视频）；触发 2 项 prompt 修复（场景"无人物"→ 加英文反面词；道具"二次元动漫风格"→ 加"anime lineart"风格强化），已写入 `pre-production.md` §2.2 + §2.3。**+ creative-video-suite 端到端 UGC 5 段 60s 视频生成成功**（详见 TODO #103→已落地+ TODO #104；MCP `/mcp -32000` 根因诊断：host 加载 `.mcp.json` 后首次 stdio 握手时 uvx 拉 `agnes-video-25-mcp==0.1.3` 依赖未就绪，retry 一次即过）。

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
| agnes-short-drama skill | `bundled-skills/agnes-short-drama/` | 新增；AI 短剧创作导演（基于 Pavo 调研）；4 字段用户输入 → 6 元数据 → 导演式剧本 → agnes 资产/分镜/视频；3 风格层级（真人/3D/2D）60+ 模板 + 4 叙事模型；utility skill，未入 `SYSTEM_SKILLS`；`.pavo-research/` 沉淀调研数据（3 完整样本 + 3 元数据 + REPORT + COMPARISON）；`examples/E01_模糊的勇气/` 端到端 demo（503 行）证明模板可产出真实可执行提示词 |
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

### TODO #75 — v14 POC: image_edit 修 LED/slat wall bias 🔄 进行中

**用户决策**（2026-09-08）：
- 先做最小 POC，验证 image_edit 预处理路径是否真能修 model bias
- 再决定 v14 完整 60s TVC 是否推进

**POC 计划**：
1. 选 v12 G3 grid（已知 LED 偏白粉最严重的段）作为 reference 输入
2. 用 `image_edit` mask 强制把 LED ring 染蓝 + 背景擦黑
3. 用 edit 后的 grid 重新跑 G3 video（keyframe mode + first_frame lock）
4. 验证 last frame LED 是否真蓝 + 背景是否纯黑
5. POC PASS → 进入 v14 完整；POC FAIL → 评估 post-process color grading 或换 agnes-video-2.5（非 flash）

**成功标准**：
- ✅ POC PASS：v12 G3 末帧 LED ring = 蓝色（不是白粉/白紫），背景 = 纯黑（不是 slat wall）
- ❌ POC FAIL：LED 仍白粉，或 background 仍 slat wall

**Stop hook 确认**：v11/v12/v13 都没达成「3 条件全 PASS」，v14 POC 必须先验证 image_edit 路径才能继续。

### TODO #99 — 60s 有故事性生活场景 TVC（最终纯色背景 + 产品 Hero）✅ DONE

**用户新需求**："做一个有故事性生活场景介绍产品的tvc视频，60秒，要求最终纯色背景+产品Hero"

**叙事**（5 段 × 12s = 60s）：卧室醒来 → 客厅早午餐 → 厨房烹饪 → 书房午后 → 黄昏阳台 → **纯黑背景 + 产品 Hero**（endframe 自然落 G5 尾帧）

**执行产物**：
- 5 个 env_refs（bedroom 复用 v9 + 4 个新：livingroom/kitchen/study/balcony）
- 5 个 2x3 grids（初次命名错位 → 重命名为 narrative order）
- 5 段 videos（reference mode + keyframe mode + bridge first_frame）
- 1 个 concat 60s TVC：`outputs/videos/e2e_v10_tvc_60s.mp4`（1280×720, 61.25s, 24fps, 23MB）
- 11 个抽帧验证帧（`outputs/videos/e2e_v10_frames/`）

**验证结果（PASS）**：
- ✅ 故事连贯：5 段 = 一天生活轨迹
- ✅ Endframe = G5 尾帧：纯黑背景 + 产品 hero pose（无单独生成 endframe image）
- ✅ LCD 全程无数字（G3-G5 强化 prompt 起作用）
- ✅ 4 次 bridge 过渡自然（pull-back / dissolve）
- ✅ Anti-grid prompt 生效（无 grid literal composite）
- ⚠️ 产品底部 mesh 在 video 中变成 dotted/水平网孔（与 v8 黑色蜂窝方块略有差异，但顶部木纹 + 蓝色 LED + 银色风扇格栅都一致 → 整体产品形态识别 OK）

**新发现的 prompt 强化**（v10 比 v9 多摸出的硬约束）：
- v9「NO digits」prompt 在 G2 仍出现 "23" 7-segment 数字
- G3-G5 强化 prompt：「HARD CONSTRAINT, must hold at EVERY frame including the final frame」+ 「NO '23' or any other digits at any moment」→ 之后全程无数字
- 此 prompt 强化应固化进 skill doc 教训

**核心交付**：`outputs/videos/e2e_v10_tvc_60s.mp4`

### TODO #100 — v11 60s TVC 端到端（5 段生活方式叙事 + Hero 收束）⚠️ 部分通过

**触发**：TODO #99 v10 用户复检反馈 "视频里依然出现了 grid"，需要更激进的 anti-grid prompt + 强化 LCD 数字降级。

**改动**（v10 → v11）：HARD CONSTRAINT 多条款 anti-grid + 6 phases × 2s 严格对应 panel + bridge first_frame lock。

**执行产物**：`e2e_v11_video_0{1-5}_*.mp4` + `e2e_v11_tvc_60s.mp4` 12.1MB/61.26s + 61 个 1fps 抽帧。

**1fps 抽检 14 帧关键 FAIL**：f_05/f_10/f_22 LCD "03" 数字 bias；f_48 fan grille "ACANIKS" 虚构品牌；f_24 bridge G2→G3 场景跳。

**3 条件验证**：
- ① 无 grid 复合 ✅ PASS（14 帧全单景别）
- ② 分镜顺序匹配 ❌ FAIL（3/14 帧 LCD 数字 bias）
- ③ 衔接自然 ⚠ 部分通过（G2→G3 场景跳）

**残留瑕疵**：LCD 数字 bias（3/14 帧）+ "ACANIKS" 虚构品牌 + 场景跳。

**结论**：v11 达成核心目标（最终纯色 + Hero），但 3 条件**未全 PASS**（Stop hook 重审）。仅可作 narrative 参考，不能算 exit criterion 完成。

### TODO #101 — v12 60s TVC 端到端（5 段纯产品电影化拆解 + Hero 收束）⚠️ 条件1 PASS / 条件2-3 弱

**触发**：TODO #100 残留 LCD 数字 + 场景跳 + 虚构品牌字问题，启动第 2 种 TVC 类型 = 纯产品镜头（无 lifestyle 场景切换）。

**策略变更**：
- 每段都用同一只产品（pure product cinematic breakdown），不切场景
- 5 段覆盖：① orbit 全景 ② top-down grille ③ wood+LED detail ④ mesh macro ⑤ hero pose
- 新增 5 个 JSON 提示词文件 `outputs/videos/e2e_v12_prompts/g{1-5}_*.json`（含完整 prompt + hard_constraints + bridge_constraint + rationale）— 用户 debug 用

**执行产物**：
- 5 个 16:9 grid（`outputs/images/e2e_v12_g{1-5}_*_grid-1.png`）— G2 重做一次（v1 panels 全做成 3/4 斜视、不是 top-down；v2 用 "STRICTLY FROM DIRECTLY ABOVE + 方形 wood 边框" 重做，6 panels 全 bird's eye ✓）
- 5 段 12s v12 视频（`outputs/videos/e2e_v12_video_0{1-5}_*.mp4` 1.9-3.4MB）— G2 重做一次（v1 末帧出现 "中间大圆 + 周围 5 小 frame" 的 grid composite；v2 用 single-shot camera motion 描述替换 panel-by-panel 描述，5 panels 已全无 grid ✓）
- 1 个 concat 60s TVC（`outputs/videos/e2e_v12_tvc_60s.mp4` 13.1MB / 61.26s）
- 61 个 1fps 抽帧（`outputs/videos/e2e_v12_1fps/f_01.jpg` ~ `f_61.jpg`）
- 5 个 last_frame（`outputs/videos/e2e_v12_frames/g{1-5}_last.jpg`）

**1fps 抽检 11 帧关键验证**（边界点 + 每段中段）：

| 帧 | 时间 | 内容 | 判定 |
|----|------|------|------|
| f_06 | 6s G1 中 | 白 cylinder hero pose + 蓝 LED + 蜂窝 | ✅ 干净 |
| f_12 | 12s G1→G2 边界 | 黑 cylinder + 灰雾 | ⚠ bridge 瑕疵 |
| f_13 | 13s G2 起 | 顶视 grille + 木边框 | ✅ |
| f_18 | 18s G2 中 | blade 极近景 macro | ✅ |
| f_24 | 24s G2 末 | 顶视 grille + 浅木边框 | ✅ |
| f_25 | 25s G2→G3 边界 | 顶视 grille + 深棕木 + 黑 body | ⚠ bridge 瑕疵 |
| f_30 | 30s G3 中 | 木纹理大平面 + LED ring **白粉** + 视角错 | ❌ LED 颜色错 + 视角错 |
| f_36 | 36s G3 中 | wood 包到 body 外侧、LED **白紫** | ❌ LED 颜色错 + wood 错位 |
| f_42 | 42s G3→G4 | 蜂窝细节 | ✅ |
| f_48 | 48s G4 中 | 蜂窝 + 蓝气 | ✅ |
| f_49 | 49s G4→G5 边界 | **slat wall 木栅栏背景** + LED **白粉** | ❌ 背景错 + LED 颜色错 |
| f_55 | 55s G5 中 | 蜂窝 air flow | ✅ |
| f_61 | 61s G5 末 | **slat wall 背景** + LED **白粉** | ❌ 背景错 + LED 颜色错 |

**3 条件验证结果**：

| 条件 | 结果 | 说明 |
|------|------|------|
| ① 无 grid 复合 | ✅ **PASS** | 抽样 11 帧全部为单景别电影感画面，0 处 2x3 拼接 / 白边 / 分屏 |
| ② 分镜顺序匹配 | ⚠ 弱通过 | 段内推进大致对（top-down / wood / mesh / hero），但 **LED ring 颜色在 G3-末/G5 全部偏白粉/白紫**（prompt 强制 blue，模型未执行），G3 wood 包到 body 外侧、G5 背景渲染成 slat wall（违反 pure-black-bg） |
| ③ 衔接自然 | ⚠ 部分通过 | G2→G3 / G4→G5 bridge 处出现灰雾/黑 cylinder 过渡瑕疵 |

**残留瑕疵 vs v11 对比**：
- ✅ v11 失败的「LCD 数字 bias」「虚构品牌文字」「场景跳」 — v12 全部消除
- ❌ 新增「LED ring 颜色偏白粉/白紫」bias（5+ 帧）— 比 v11 的数字更刺眼（蓝色是产品品牌色，错了直接破坏识别）
- ❌ 新增「G5 背景渲染成木栅栏 slat wall」 — 违反 pure-black-bg hard constraint
- ⚠ bridge 灰雾瑕疵（v11 也有，但比 v12 轻）

**结论**：
- v12 60s TVC **"5 段纯产品电影化拆解"** 类型 ① 条件 PASS，②③ 弱通过
- **不能算 v12 完全 PASS**：LED 颜色 + G5 背景两处 prompt 完全无效，需要修复策略
- **下一步**：① 修 LED 颜色 — 在 prompt 顶部强约束 + image reference 强 blue 锁定；② 修 G5 背景 — 把 G5 prompt 拆成无 first_frame reference mode 让 G4→G5 bridge 不把 slat wall context 带过去；或尝试 v13 lifestyle narrative 类

### TODO #102 — v13 1x5 reference mode 实验 ❌ FAIL（5 图导致 panel composite）

**触发**：v12 残留 LED 颜色 + slat wall 背景问题，尝试换 image_edit pipeline：用 1x5 strip（5 panel 横排）切分成 5 张独立图 → reference mode 喂给 video model（避开 grid 单图的视觉 anchor 太强）。

**策略变更**：
- 每段生成 1x5 strip（不是 2x3 grid）
- numpy 检测 vertical borders 切分成 5 张独立 panel
- video generate 用 reference mode + 5 张 panel 作为 images[]
- 期望：reference mode 把 5 张当 visual reference，不会渲染成 grid

**实际产物**：
- 5 个 1x5 strip（`outputs/images/e2e_v13_g{1-5}_1x5_strip-1.png`）
- 25 张 panel 切分（v1 用 `h//2` 数学切分 — **用户 grlling：坐标错**；v2 用 numpy 检测的 actual borders 切分）
- 3 段 v13 视频（`outputs/videos/e2e_v13_video_0{1,2,3}_*.mp4`，G4/G5 upload 失败）

**G3 末帧验证**（FAIL 截图 `outputs/videos/e2e_v13_frames/g3_last_v3.jpg`）：
- ❌ **3-panel horizontal composite**：模型把 5 张图同时渲染成 3-panel 横向拼接，违反条件①

**ROOT CAUSE（grlling）**：
- Agnes reference mode 的 `images[]` 是 **visual style reference**，不是 time-ordered panels
- 喂 5 张图 = 模型认为要"展示 5 个 panel" → 渲染成 multi-panel composite
- 即使换 single-shot prompt，reference mode 仍倾向同时展示多张参考图
- **v12 keyframe mode（1 张 grid + first_frame lock）才是已验证 PASS 的模式**，v13 偏离了已验证策略

**grlling 决策**：放弃 v13 重试，**不再在 reference mode 路径上挣扎**。v12 已验证条件① PASS，LED 颜色 + slat wall 是 prompt 工程问题，不是 mode 问题。直接进 v14 lifestyle narrative（Task #75），用 v12 的 keyframe mode + grid 模式达成第 3 种 TVC 类型多样性。

**保留产物**（debug 用）：
- v13 G1/G2 video（意外 PASS — 可能因为参考图少或巧合）— 可对比 v12 G1/G2 的 prompt 差异
- v13 G3 last_frame composite（FAIL 截图）— 作为 "reference mode 不适合 panel-by-panel" 的反例

### TODO #98 — 30s TVC e2e 端到端验证（v9 ✅ PASS — v7/v8/v9 三轮迭代摸清 model 硬约束）✅ DONE

**核心要求**：最终视频保持产品图一致性，多故事板衔接自然，不要过度跳脱，视频内遵循产品一致性，视频过渡自然不会突然风格转变。
**附加用户约束**：必须使用 grid + 反例 prompt「不要直接显示 grid」+ bridge: G1_last → G2_first + G2_last → G3_first + endframe = 最后一个 grid 尾帧不单独生成。

**演进**：
- **v7** → G3「雏菊花田 + 假 Hero Logo + 中文文字」灾难
- **v8** → 修文字/Logo，但 Frame 01 literal grid composite / Frame 06 LCD 镜像堆叠 / Frame 09-10 G3 产品漂移
- **v9** ✅ → 全部满足用户 5 条约束 + Frame 01-10 视觉验证通过

**v9 端到端结论**：
- 10/10 帧产品形态一致（高瘦圆柱 + 浅原木顶 + 蓝色 LED 环无数字 + 黑色蜂窝底）
- Bridge 无缝（G1→G2 阳台同画面 + G2→G3 影棚同画面）
- 无 grid literal composite（反例 prompt 起效）
- 无文字/Logo/水印（v7/v8 残留全部消除）

**v9 残留瑕疵**：Frame 07 G2 末段 0.5s 透明 X 光效果（exploded view 过度），不影响 TVC 整体流畅。

**e2e 摸清的 5 条 model 硬约束**（必写入 skill 文档）：
1. **必须使用 grid 作为 video 输入**（`images=[grid, product]`）— grid 是规划与一致性双重锚
2. **反例 prompt 必加**：「DO NOT display any multi-panel grid image as a frame」— 防 reference mode literal composite
3. **Bridge workflow**：上一段 last_frame → 下一段 first_frame（keyframe mode 锁住实现无缝衔接），第一段无 first_frame 用 reference mode
4. **Endframe = 最后一个 grid 视频的尾帧**，**不单独生成** endframe image
5. **LCD 数字降级**：video prompt 必含「LCD MUST display ONLY a clean blue circular ring breathing effect, NO numeric digits NO characters NO 7-segment numbers」— 7 段码在 video 模型中视觉不稳定

**输出物**：
- `outputs/videos/e2e_v9_video_g1.mp4` 12.25s 1280×720（reference mode + images=[grid_g1, product]）
- `outputs/videos/e2e_v9_video_g2.mp4` 12.25s 1280×704（keyframe mode + first_frame=G1_last + images=[grid_g2, product]）
- `outputs/videos/e2e_v9_video_g3.mp4` 6.58s 1280×704（keyframe mode + first_frame=G2_last + images=[grid_g3, product]）
- `outputs/videos/e2e_v9_tvc_30s.mp4` 31.08s 1280×720（concat + scale all 1280×720）
- `outputs/images/e2e_v9_frames/frame_01.png` ~ `frame_10.png`
- `outputs/images/e2e_v9_g{1,2,g3_hero}_*` 各 grid + `_last` bridge 帧

**待办**：把 5 条 model 硬约束写入 `bundled-skills/tvc-director/SKILL.md` 与 `references/storyboard.md` 的 video prompt 模板，作为强制约束。v9 端到端测试结论可作为 skill docs 增补的输入。

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

### TODO #103 — 拷贝 video-skill 到 bundled-skills/ 并迁移 multimedia-creator MCP 🔄 进行中

**用户拍板**（2026-09-08）：
- 跟 tvc-director **并存为独立 skill**（不合并/不替代）
- **全量迁移**：改 SKILL.md 工具名为 `mcp__multimedia-creator/...` + 升级到 `agnes-image-2.5-flash` + `agnes-video-2.5-flash` + **删除 `scripts/` 整个目录**
- **name 决策**：`doubao-creative-video-suite` → `creative-video-suite`（doubao 是豆包平台标识，HamunaAgent 不适用）
- **路由差异化**：tvc-director 吃 TVC 商业广告大片；creative-video-suite 吃短剧/微电影/动画/动态漫/UGC/企业宣传

**执行清单**：
1. 拷结构 `FreeVideoSkill/.claude/skills/video-skill/{SKILL.md, README.md, references/}` → `bundled-skills/creative-video-suite/`（**改名**，不叫 video-skill 避免与 FreeVideoSkill 仓库同名）
2. 删 scripts/ 整个目录（`agnes_ai_client.py` + `generate_with_agnes.py` + `__pycache__`）
3. 删 examples/ 二进制产物（`*.mp4` + `*.gif`），仅保留 examples/README.md 作"使用样例说明"
4. 改 SKILL.md 全文：
   - 删除"豆包"全文检索规则（line 303 平台特化）
   - 删除 `notify_hunman`（豆包飞书术语，HamunaAgent 无此工具）
   - 工具门禁：`image_gen/image_edit/text_to_video/image_to_video` → `mcp__multimedia-creator/agnes25_*`
   - 模型对应表升级到 `agnes-image-2.5-flash` + `agnes-video-2.5-flash`
   - 删 scripts/ 章节
5. 改写 `references/agnes-ai-api.md`：从 agnes 2.1/2.0/v2.0 文档 + apihub.agnes-ai.com 国际版 → 改为 multimedia-creator MCP 7 tools 参考（4 video + 3 image）
6. 清洗 5 个 drama refs + 3 个 commercial refs 中的 `notify_hunman` / `豆包` / 飞书特化术语
7. 注册 SYSTEM_SKILLS：Rust `src-tauri/src/commands.rs` + Node `src/server/index.ts::SYSTEM_SKILLS` 双清单加入 `creative-video-suite`，bump `SYSTEM_SKILLS_VERSION`
8. 验证：`npm run typecheck` + `npm run test:unit` + `grep` 验证无残留 `notify_hunman` / `doubao` / `scripts/`

**与 tvc-director 边界（路由差异化）**：

| 路由关键词 | 命中 skill |
|---|---|
| TVC / 商业广告大片 / 品牌广告 / 产品广告大片 / 4A 广告 | **tvc-director** |
| 短剧 / 剧情 / 微电影 / 动画 / 动态漫 / 预告片 / UGC / 企业宣传 / 商务视频 | **creative-video-suite** |

**风险**：
- bundled-skill 与 FreeVideoSkill 仓库同名（结构同源但不同代码）→ 永久分叉
- SYSTEM_SKILLS bump 触发新客户端下载流程（用户机器首次拉取 new skill manifest）

### TODO #51 — tvc-director 跨段过渡方法 + keyframe 比例约束 + grid 单场景多机位铁律（待提交）

**来源**：30s TVC 端到端实测踩坑 + 用户拍板纳入 mooko.cn/article/52 段间过渡方法 + keyframe 兜底画幅突变 + grid video 跳 panel。

**改动**（3 文件）：
- `bundled-skills/tvc-director/SKILL.md` — 第 546 行后新增 `### Keyframe 模式铁律（first_frame 兜底必读，2026-09 端到端踩坑）` 小节：`first_frame` 自身画幅覆盖 `aspect_ratio` 的根因（用户原图 1404×1046 4:3 → video 960×704 4:3，与同片 1280×720 16:9 拼接画幅突变）；agent 流程要求调 `keyframe` 模式前 MUST 先用 `image_edit` 把 first_frame 转 16:9（首选）或用 grid 第 9 格当 first_frame（次选，grid 内已 16:9）；判断捷径 `ffprobe` first_frame 实际纵横比
- `bundled-skills/tvc-director/references/storyboard.md` — Part 二「视频脉络先行」末尾加 `### 视频脉络的衔接：bridge 段` 小节：单段 12s 脉络分块 `[主叙事 10.5-11s] → [bridge 0.8-1.5s]`；bridge 在 grid 最后一格 P9；三种 bridge 子类型（同构图推进/时间流逝/尾帧延续）；无 bridge 代价（30s TVC = 12s+12s 直拼观众感到"跳"）
- `bundled-skills/tvc-director/references/storyboard.md` — Part 三「网格规格选择策略」3x3 行附注扩展 + 末尾加 `### 铁律：12s 9 panel = 同一场景不同机位（2026-09 端到端踩坑）` 小节：9 panel 不是 9 个分镜故事板而是 9 个关键帧（同一场景不同机位）；9 panel 机位分配表（P1 全景→P9 bridge）；反模式（4-5 个跳切场景 → video 跳过次要 panel）；端到端踩坑（G1 grid 4-5 场景，video 全居家消毒，跳过街景/门口/沙发）；横跨场景拆段建议（按场景拆 grid 而不是塞进 1 张）
- `bundled-skills/tvc-director/references/storyboard.md` — Part 六「多段视频的跨段连续性」末尾加 4 小节：(1) 桥接镜头法 0.8-1.5s + 三种子类型 + grid P9 位置 + 视频提示词写法；(2) 风格锁定三句（光色/材质/运动，字面复制粘贴，禁软词）；(3) 负面提示词清单（8 条最小集，含 `no BGM/no background music`，后期铺 BGM 不能让 video 自带）；(4) 节奏比例 30/45/25（建立/推进/收束）+ 与 bridge 关系（bridge 不计入节奏）

**验证**：3 文件改动无新增依赖、无新工具调用契约（仅文档扩展）。

**待办**：用户拍板后 commit（`feat(tvc-director): add segment transition methods + keyframe aspect ratio guard + grid single-scene rule`）。

### ✅ 最近完成（detail 见 git show，table 在 §4）

`2338a83`（drag-drop → workspace/hamuna_files）+ `51f3f98`（删除附件 trash 回收站）的完整实现细节已移至 git commit message，本节只保留指针。

### TODO #104 — creative-video-suite 端到端 UGC 5 段 + URL 复用 ✅ DONE

**触发**：TODO #103 落地后首次跑通端到端验证。用户提供测试 prompt："测试用 skill 生成一个口播视频"。

**执行产物**（UGC 60s = 5 × 12s）：
- 5 张人设首帧图（`agnes25_image_generate`）：帧链 anchor for Cut1-5
- 3 批 video_generate（keyframe mode + 720P + 9:16）：batch1 = Cut1+Cut2 / batch2 = Cut3+Cut4 / batch3 = Cut5（单段）
- 总耗时 ≈ 25 分钟（含2 门禁点人眼核对 + 5 段视频轮询）

**实测耗时 vs 理论**：5 段视频实际 135-246s/段，平均 ≈ 195s。Server 并发友好（同时发 Cut1+Cut2 不触发 rate limit）。

**新发现 + skill 文档更新**（已写入 `references/agnes-ai-api.md` + `SKILL.md`）：
1. **`image_generate` 返回的 `url` 字段可直接喂给下游 `video_generate.first_frame` / `last_frame`** —— 无需 `wget` / `curl` 下载到本地再传；实测 5/5 段验证
2. **`output_filename` 传绝对路径无效**：server 把字符串当 filename 处理，落 `server cwd + outputs/{images,videos}/`；建议只传纯文件名 + 用返回的 `url` 自己 curl 持久化
3. **HTTPS URL / 本地路径 / base64 三种都支持**（`image_url` / path / data URL），文档原理一致，应同样支持
4. **端到端零下载** pipeline：全流程在 URL 字符串层流转，省 IO + 省时间

**MCP `/mcp -32000` 根因诊断**（备忘）：
- `.mcp.json` 文件层修复（已加 `multimedia-creator` + env + `--default-index https://pypi.org/simple`）→ 文件 OK
- 但 Claude Code MCP host **不热加载 `.mcp.json`** → 需重启 session 或 tool 调用触发 host 懒发现
- 第一次 tool 调用触发 stdio 握手时，uvx 首次拉 `agnes-video-25-mcp==0.1.3` 依赖未就绪 → handshake 超时 → `-32000`
- **Retry 一次即过**：uvx 缓存命中 + server 立刻 ready

**§7 完成检查 9/9 全过**：未跳阶段 / 必要澄清全确认 / 参数全记录 / 帧链连续 / 主角无形象漂移 / 未降级到 T2V / 单批 ≤2 / 即时输出 / Markdown 渲染。

**已沉淀给后续 skill 用户的经验**：参考资料 `.pavo-research/ugc-talk-video/`（7 文件 + 5 段视频 URL + 5 张图 URL）。

---

## 4. 最近已完成（指针）

详情见 git log / `git show <commit>`；此处只列 commit + 一行摘要。

| Commit | 摘要 |
|--------|------|
| `2338a83` | **feat(attachments): drag-drop media → workspace/hamuna_files**（双轨：保留历史 `~/.hamuna/attachments/` handler） |
| `db2d91f` | **fix(attachments): resolve workspace-relative paths to absolute before read_files_b64**（renderer helper 加 workspacePath 参数；projection 7/7 + send 16/16 ✓） |
| `368ee90` | **fix(attachments): override `source` to inline_base64 when rebasing attachment_ref**（绕开 validator；projection 7/7 + send 16/16 ✓） |
| `079c96f` | **docs(tvc-director): switch video model from agnes-video-2.5 to agnes-video-2.5-flash**（size 锁 720P / images cap ≤5 / audios cap ≤3 / videos 0；保留 SKILL.md:541 旧 model 对比行） |
| `7191b91` | **fix(tvc-director): video prompt must reference both `<Picture 1>` (grid) and `<Picture 2>` (product)**（以 README 为准修 6 处；reference 模式不锁首帧明确陈述） |
| `66b6397` | **fix(tvc-director): set storyboard reference default seconds to 12**（贴合 grid 9 帧语义；端到端 5.166s h264 输出验证；116s submit） |
| `276d8e8` | **fix(tvc-director): set grid default unit from 15s to 12s (agnes max)**（3 文件 13 处重规划；新增 48-60s End Frame 给 60s 5 段拆法） |
| `ea9b524` | **fix(attachments): rebase workspace attachment_ref previews to data URLs at send time**（renderer 侧 hotfix；send 16/16 + projection 6/6 ✓；follow-up 列 TODO #98） |
| `51f3f98` | **feat(attachments): trash workspace file when an image attachment is removed**（OS 回收站保底；fire-and-forget；send 16/16 ✓） |
| `c70fd60` | **fix(attachments): replace `node:path.join` with renderer-safe `joinWorkspacePath`**（Vite externalize `node:*` 触 ErrorBoundary；新增 `src/shared/workspacePath.ts`） |
| `0f1073e` | **feat(tvc-director): enforce strict tool contract**（locked params + fail-fast + retry once） |
| `db191e2` | **fix(tvc-director): align SKILL.md to agnes-video-25-mcp v0.1.3 tool surface**（5 stale references） |
| `220abea` | **fix(tvc-director): anchor storyboard objects via physics + layout hard constraints** |
| `1d6743a` | **test(tvc-director): validate spec portability with afternoon_tea archetype + 2 PNG renders** |
| `014453d` | **feat(tvc-director): add canonical morning-rush fixture as future-spec baseline** |
| `4b5c90c` | **feat(mcp): introduce agnes-video-25 + unify media MCP under id="multimedia-creator"** |
| `7f8c60d` | **feat(extended-builtin-mcp): add `${bundled:REL_PATH}` placeholder for portable MCP args** |

更早完成（TODO #11—#28，#29，#97，#14，#16，#12，#17—#21）历史归档：见 `git log --oneline --grep="..."` 或 git show 对应 commit。

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
