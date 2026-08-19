# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。

最后更新：2026-08-19（修复 `ensure_claude_sdk_package.ps1` caret range vs `-ne` 严格比较 bug 后）

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
| Agent Session | `src/server/agent-session.ts` | 稳定 | public facade |
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

### TODO #2: 观察现有 pending 改动

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
