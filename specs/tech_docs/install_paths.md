# Desktop App 安装后文件路径全集（2026-09-09 审计）

> **TL;DR**：`app_dirs::hamuna_data_dir()` (`$HOME/.hamuna/`) 是**单一权威**路径解析器（`src-tauri/src/app_dirs.rs:112-114`）。所有 Rust / Node 代码 SHOULD 调它，禁硬编码路径。snapshot.md §2.3 是紧凑速查表。
>
> **何时读**：改路径解析、新增存储位置、跨进程/跨平台文件传输、debug「文件去哪了」、Tauri fs scope 设计。

---

## 0. 三平台基础对照

| 概念 | macOS | Windows | Linux |
|---|---|---|---|
| **$HOME** | `$HOME` (Users/<user>) | `%USERPROFILE%` (`C:\Users\<user>`) | `$HOME` (`/home/<user>`) |
| **App bundle** | `HamunaAgent.app/` | `HamunaAgent\` (NSIS 安装) | `hamuna-agent/` (deb/AppImage) |
| **Bundle 内** | `HamunaAgent.app/Contents/{MacOS,Resources,Info.plist}` | `<install-dir>\{binaries,resources,cli,...}` | `/opt/hamuna-agent/{binaries,resources,...}` |
| **Tauri resource_dir** | `<bundle>/Contents/Resources/` | `<install-dir>/` (resources 在根) | `<install-dir>/` |
| **Tauri app_data_dir** | `~/Library/Application Support/com.hamuna.app/` | `%APPDATA%\com.hamuna.app\` | `~/.local/share/com.hamuna.app/` |
| **Tauri app_log_dir** | `~/Library/Logs/com.hamuna.app/` | `%LOCALAPPDATA%\com.hamuna.app\logs\` | `~/.local/share/com.hamuna.app/logs/` |
| **macOS 系统日志** | `~/Library/Logs/com.hamuna.app/HamunaAgent.log` | n/a | n/a |

**关键差异**：Tauri `app_data_dir` 默认走 macOS `~/Library/Application Support/`、Windows `%APPDATA%`、Linux `~/.local/share/`，**但** HamunaAgent 用 `app_dirs::hamuna_data_dir()` 把 `app_data_dir` 重定向到 `$HOME/.hamuna/`（`dirs::home_dir().join(".hamuna")`），三平台统一为 `$HOME/.hamuna/`。Tauri `resource_dir` 三平台都解析到「bundle 内 Resources/」。

---

## 1. App Bundle（安装包内）

由 `tauri.conf.json::bundle.{targets,resources,externalBin}` 控制打包；`tauri-build` 在编译期嵌入。

| 资源 | 来源（dev 相对路径） | 三平台安装后路径 | 备注 |
|---|---|---|---|
| 主可执行 | `src-tauri/target/<triple>/release/hamuna` | `HamunaAgent.app/Contents/MacOS/HamunaAgent` / `HamunaAgent.exe` / `hamuna-agent` | Tauri 编译产物 |
| Node.js v24 runtime | `src-tauri/resources/nodejs/` | `<bundle>/Resources/nodejs/{bin/node,node.exe}` (macOS/Win) + `bin/node` (macOS) / `<install>/nodejs/node.exe` (Win) / `<install>/nodejs/bin/node` (Linux) | 内置，不依赖系统 |
| Claude Agent SDK binary | `src-tauri/resources/claude-agent-sdk/` | `<bundle>/Resources/claude-agent-sdk/` | SDK 自带二进制 |
| Sharp / tsx runtime | `src-tauri/resources/{sharp-runtime,tsx-runtime}/` | `<bundle>/Resources/{sharp,tsx}-runtime/` | 镜像 npm install 产物 |
| KB runtime | `src-tauri/resources/kb-runtime/` | `<bundle>/Resources/kb-runtime/node_modules/` | KB jieba FTS5 依赖 |
| Shared types | `../src/shared` | `<bundle>/Resources/shared/` | 前后端共享 TS 类型 |
| Bundled skills | `../bundled-skills/` | `<bundle>/Resources/bundled-skills/` | system + utility skill 打包源（sync 时机见 §3） |
| Bundled agents | `../bundled-agents/` | `<bundle>/Resources/bundled-agents/` | helper 等内置 agent |
| Extended MCP | `../extended_buildin_mcp/` | `<bundle>/Resources/extended_buildin_mcp/` | META/INSTANCE 两层懒加载 |
| Hosted MCP (agnes) | `../hosted_mcps/agnes-video-25/` | `<bundle>/Resources/hosted_mcps/agnes-video-25/` | multimodal-creator server |
| CLI | `src-tauri/resources/cli/` | `<bundle>/Resources/cli/` | `hamuna` CLI 入口 |
| `cuse` binary | `binaries/cuse` (externalBin) | `<bundle>/Resources/binaries/cuse` (macOS/Linux) / 同 install-dir (Win) | Linux cgroup namespace escape |
| `cuse-latest.json` | `src-tauri/resources/cuse-latest.json` | `<bundle>/Resources/cuse-latest.json` | cuse 版本元数据 |
| `uvx.exe` | `src-tauri/resources/uvx.exe` | `<bundle>/Resources/uvx.exe` (Win) / `uvx` (macOS/Linux) | Python MCP 包运行器 |
| `mino` | `../mino` | `<bundle>/Resources/mino/` | 内置项目模板（link 到 `~/.hamuna/projects/mino/`） |
| `feedback_qr_code.png` | `src-tauri/resources/assets/feedback_qr_code.png` | `<bundle>/Resources/assets/feedback_qr_code.png` | UI 反馈二维码 |
| InfoPlist.strings (i18n) | `infoplist/{en.lproj,zh-Hans.lproj}/InfoPlist.strings` | `<bundle>/Contents/{en.lproj,zh-Hans.lproj}/InfoPlist.strings` | macOS 系统级 i18n |
| Sidecar bundle | `src-tauri/resources/server-dist.js` | `<bundle>/Resources/server-dist.js` | esbuild 打包的 Node 主进程 |
| Plugin bridge bundle | `src-tauri/resources/plugin-bridge-dist.mjs` | `<bundle>/Resources/plugin-bridge-dist.mjs` | OpenClaw 插件桥 |
| SDK shim | `src/server/plugin-bridge/sdk-shim/` | `<bundle>/Resources/plugin-bridge-sdk-shim/` | Claude Agent SDK 兼容垫片 |

---

## 2. Tauri resource_dir（运行时只读）

由 `app_handle.path().resource_dir()` 解析，三平台分别落到上节「Bundle 内」路径。**只读**，Sidecar 启动 + skill sync + MCP 自启都从这里加载。

| 类别 | 子路径 | 用法 | 来源 |
|---|---|---|---|
| Node.js binary | `nodejs/{bin/node,node.exe}` | Sidecar spawn | `src-tauri/src/sidecar/spawn.rs:254-329` |
| Claude binary | `claude-agent-sdk/claude.exe` (Win) / `claude` (macOS/Linux) | Claude Agent SDK spawn | `src-tauri/src/sidecar/shutdown.rs:368` |
| tsx runtime | `tsx-runtime/node_modules/tsx/dist/esm/index.mjs` | ts-runtime 加载 | `src-tauri/src/sidecar/shutdown.rs:380-385` |
| Skill 源 | `bundled-skills/<name>/SKILL.md` | system skill 强制 sync 源 | `src-tauri/src/commands.rs:1480-1536` |
| Sidecar 主进程 | `server-dist.js` | Node sidecar 入口 | `src-tauri/src/sidecar/shutdown.rs:371` |
| Plugin bridge | `plugin-bridge-dist.mjs` + `plugin-bridge-sdk-shim/` | OpenClaw 桥 | `src-tauri/src/sidecar/cleanup.rs` |

---

## 3. 用户运行时数据（`~/.hamuna/`，三平台同路径）

**根路径**：`$HOME/.hamuna/`（`dirs::home_dir().join(".hamuna")`，详见 `app_dirs.rs:112-114`）

| 子项 | 路径 | 写时机 | 锁定 / 锁文件 | 来源 |
|---|---|---|---|---|
| **PID Lock** | `~/.hamuna/app.lock` | startup `acquire_lock()` | 仅 PID，无 lockf | `app_dirs.rs:7-19,131-182` |
| **Clean-exit marker** | `~/.hamuna/last-exit.json` | `record_clean_exit()` on graceful quit | 无 | `app_dirs.rs:26,47-81` |
| **Device ID** | `~/.hamuna/device_id` | 首次启动持久化 | 无 | `src-tauri/src/commands.rs:327` |
| **App Config** | `~/.hamuna/config.json` | 任何 `withConfigLock` 写 | `config.json.lock` (dir-based) + `.tmp.rust` + `.bak` | `src-tauri/src/config_io.rs:1-214` |
| **Sessions 元数据** | `~/.hamuna/sessions.json` | session 增删改 | 无（in-memory lock） | `sidecar/runtime_identity.rs:161,215` |
| **Sessions 数据** | `~/.hamuna/sessions/<session-id>/` | session transcript + 资源 | 无 | `commands.rs` (assistant sessions) |
| **System skills 落盘** | `~/.hamuna/skills/<name>/` | 启动 `SYSTEM_SKILLS_VERSION` mismatch 时 force-overwrite | version gate `~/.hamuna/.system-skills-version` | `commands.rs:1284-1536` |
| **Utility skills 落盘** | `~/.hamuna/skills/<name>/` | 首次启动 `seedBundledSkills()` seed-once（之后用户可改） | 无（一次 seed 永不动） | `src/server/index.ts:1347-1364` |
| **Bundled agents 落盘** | `~/.hamuna/agents/<name>/<name>.md` + `_meta.json` (folder) 或 `<name>.md` (flat) | 启动 `seedBundledAgents()` seed-once | 无 | `src/server/index.ts:7639-7641` |
| **Provider 自定义** | `~/.hamuna/providers/{id}.json` | 用户添加自定义 provider | 无（atomic write） | `src/server/admin-api.ts:1054,5112` + `src/server/utils/admin-config.ts:703,723` |
| **Credentials** | `~/.hamuna/credentials/` | 各 provider 登录态 | 文件 mode 0600 | `path-safety.ts:48` (helper 黑名单) |
| **MCP server install** | `~/.hamuna/mcp/<server-name>/` | 用户安装 hosted MCP | 无 | `sidecar/cleanup.rs:49,65` |
| **MCP OAuth state** | `~/.hamuna/mcp_oauth_state.json` | MCP OAuth flow 短期 state | 文件 mode 0600 | `src/server/mcp-oauth/state-store.ts:7` |
| **CLI symlink** | `~/.hamuna/bin/hamuna` (macOS/Linux) + `~/.hamuna/bin/hamuna.cmd` (Win) | 安装后手 link / `install` 命令 | 无 | `src-tauri/src/cli.rs:10-184` |
| **Sidecar port** | `~/.hamuna/sidecar.port` | Global Sidecar 启动时写 | 无（CLI 读） | `src-tauri/src/cli.rs:196` + `sidecar/cleanup.rs:5` |
| **Projects 元数据** | `~/.hamuna/projects.json` | workspace 增删改 | 无 | `src-tauri/src/im/config_store.rs:48` |
| **Projects 模板** | `~/.hamuna/projects/<id>/` | workspace 文件 IO | `validate_workspace_root` chokepoint | `commands.rs:494-526` |
| **Templates** | `~/.hamuna/templates/<id>/` | 用户安装模板 | `validate_workspace_root` | `commands.rs:525-681` |
| **minolink** | `~/.hamuna/projects/mino` (symlink) → `<bundle>/mino/` | 首次启动 | 无 | `commands.rs:349-368` |
| **Task Store** | `~/.hamuna/tasks.jsonl` + `~/.hamuna/tasks/<task-id>/{task.md,metadata.json}` | task 增删改 | atomic rename | `src-tauri/src/task.rs:4-5,332-3029` |
| **Cron legacy (迁移源)** | `~/.hamuna/cron_tasks.json` + `~/.hamuna/cron_runs/<run-id>/` | 仅 startup 迁移到 TaskStore | 无（迁移后只读） | `src-tauri/src/cron_task/manager.rs:698` + `cron_task/run_records.rs:39` |
| **Managed Codex Runtime** | `~/.hamuna/runtimes/codex/<version>/<platform>/` + `installed.json` | 升级时 fetch + extract | 锁 per-version | `src-tauri/src/managed_codex.rs:227-246` |
| **KB legacy 迁移源** | `~/.hamuna/kb/<id>.json` | 仅 startup 迁移到 SQLite | 归档 `~/.hamuna/kb-legacy-<ts>/` | `src/server/kb/kb-migrate.ts` |
| **KB store (SQLite)** | `~/.hamuna/kb-store.sqlite` (TypeGraph + jieba FTS5) | KB 读写 | SQLite WAL | `src/server/kb/kb-store.ts` |
| **Floating Ball** | `~/.hamuna/floating_ball.json` | 拖动落盘 | 无 | `src-tauri/src/floating_ball.rs:54` |
| **Tool Attachment 双轨** | `~/.hamuna/attachments/<sessionId>/` | tool 产物回流 | 无（attachment_protocol.rs chokepoint） | `src-tauri/src/attachment_protocol.rs:26` |
| **统一日志** | `~/.hamuna/logs/unified-{YYYY-MM-DD}.log` | 所有三层（React/Sidecar/Rust）汇入 | 无（按日期分割） | `tech_docs/unified_logging.md` |
| **Rust panic log** | `~/.hamuna/logs/panic-{pid}-{timestamp}.3f.log` | startup panic catch | 无 | `src-tauri/src/lib.rs:193-209` |
| **i18n locale cache** | `~/.hamuna/.locale` | 用户切换语言 | 无 | `src-tauri/src/i18n.rs:119-132` |
| **Tmp scratch** | `~/.hamuna/tmp/{cc-hooks,skill-url-export,...}/` | AI 临时文件 / claude-code hooks | 无 | `src/server/utils/safe-file-path.ts:20-99` + `plugin-bridge/sdk-shim/plugin-sdk/infra-runtime.js:17` |
| **Memory auto update** | `~/.hamuna/memory/...` | 后台 memory 增量 | 无 | `src-tauri/src/memory_auto_update.rs:780` |
| **Inbox** | `~/.hamuna/inbox/...` | session 提醒 / 待办 | 无 | `src-tauri/src/inbox.rs` (TaskGoal 共享) |
| **Space Cloud** | `~/.hamuna/spaces/<space-id>/...` | 协作云端同步状态 | 无 | `src-tauri/src/space_cloud.rs:2468,5883,6691,7692` |
| **douyin cookies** | `~/.hamuna/douyin-cookies.txt` | ad-hoc 抖音爬虫临时（**不入仓**） | 无 | `~/douyin-login/login.mjs` (本地脚本) |

---

## 4. Workspace（用户 UI 选定）

**根路径**：用户在 HamunaAgent UI 选定，**不**是 `~/.hamuna/` 的一部分。Tauri fs scope 默认 `$HOME/.hamuna/**`，workspace 路径经 `validate_workspace_root` chokepoint 二次校验（`src-tauri/src/workspace_files/path_safety.rs`）。

| 子项 | 路径 | 写时机 | 来源 |
|---|---|---|---|
| **图片拖拽暂存** | `<workspace>/hamuna_files/generated_images/<hash>.png` | `cmd_write_workspace_file` | `src-tauri/src/workspace_files/transfer.rs:483` + `im/agent_channel.rs:1112-1124` |
| **音频产物** | `<workspace>/hamuna_files/generated_audio/<hash>.mp3` | `cmd_write_workspace_file` | `server-dist.js:92563-93186` |
| **Tool 产物回流** | `<workspace>/hamuna_files/<tool-name>/<hash>.bin` | `cmd_workspace_copy_paths` | `server-dist.js:173766` |
| **Creative-video-suite 产物** | `<workspace>/creative-video-suite/<project-name>/{01_planner.md,02_script.md,...,04_assets/,05_keyframes/,06_videos/}` | 每阶段用户确认后落盘 | `bundled-skills/creative-video-suite/references/output-conventions.md §1` |
| **Gitignore 模式** | `<workspace>/.gitignore` 自动加 `hamuna_files/` | 第一次 hamuna_files 写入时 | `workspace_files/gitignore.rs:114-150` |
| **Memory rule substrate** | `<workspace>/.claude/{settings.json,agents/,skills/,commands/}` | agent 创建时 `ensure_claude_settings` | `workspace_files/memory_rules.rs:48-159` |
| **T13 多视角产品图 (单张宫格)** | `<workspace>/creative-video-suite/<project>/04_assets/product-refs/<产品名>.png` | T13 template | `bundled-skills/creative-video-suite/SKILL.md` |

**Workspace 路径标准化**：跨平台比较 MUST 走 `workspacePathsEqual()` / `normalizeWorkspacePathIdentity()`（`src/shared/workspacePath.ts` + `src-tauri/src/workspace_path.rs`），禁裸 `===`（Win 反斜杠 vs 正斜杠静默不相等）。

---

## 5. MCP 自控输出路径（**不在** `~/.hamuna/`）

| 路径 | 写入方 | 来源 |
|---|---|---|
| `$HOME/HamunaAgent/agnes-output/videos/<id>.mp4` | agnes-video-25 MCP video_generate | `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py:93-97` |
| `$HOME/HamunaAgent/agnes-output/images/<id>.png` | agnes-video-25 MCP image_generate / image_edit | 同上 `_img_output_dir()` (line 740) |
| **环境变量** | `AGNES_OUTPUT_DIR=~/HamunaAgent/agnes-output` | `extended_buildin_mcp/mcp.json:37` |

**关键**：MCP 用 `Path.expanduser()` 解析 `~`，依赖 sidecar `buildMcpSubprocessEnv` 注入 `HOME` (macOS/Linux) / `USERPROFILE` (Windows)。**AI 通过 `cmd_workspace_copy_paths` 复制到 `<workspace>/`** 才算交付（CLAUDE.md 红线）。

---

## 6. 外部凭据 home（**不在** `~/.hamuna/`，helper 黑名单）

| 路径 | 内容 | 来源 |
|---|---|---|
| `~/.claude/` | Claude Code CLI 配置 + 凭据 | 供应商默认 |
| `~/.codex/` | Codex CLI 配置 + 凭据 | 供应商默认 |
| `~/.gemini/` | Gemini CLI 配置 + 凭据 | 供应商默认 |
| 系统 Keychain | OAuth / API key | OS 级 |

**helper 约束**（`bundled-agents/hamuna_helper/CLAUDE.md` + `src-tauri/src/commands.rs:1743`）：**禁读** credential-owned 文件做"检查 token"，用脱敏 CLI/API 判断登录态。

---

## 7. Platform-specific 日志

| 路径 | 由谁 | 内容 |
|---|---|---|
| `~/Library/Logs/com.hamuna.app/HamunaAgent.log` (macOS) | `tauri-plugin-log` | Rust 层日志（**不**走 `~/.hamuna/logs/`） |
| `%LOCALAPPDATA%\com.hamuna.app\logs\` (Win) | 同上 | 同上 |
| `~/.local/share/com.hamuna.app/logs/` (Linux) | 同上 | 同上 |
| `~/.hamuna/logs/unified-{YYYY-MM-DD}.log` | 三层（React/Sidecar/Rust）汇入 | 主日志，CLAUDE.md 红线「统一日志」 |
| `~/.hamuna/logs/panic-{pid}-{timestamp}.log` | Rust startup panic catch | crash 排障 |

---

## 8. 关键架构决策（必读）

1. **单一权威 = `app_dirs::hamuna_data_dir()`**（`src-tauri/src/app_dirs.rs:112-114`）—— 所有需要 `~/.hamuna/` 的代码 MUST 调它。Debug build 未来可重定向到 `~/.hamuna-dev/` 做 dev/prod 隔离（同 helper doc line 110 注释）。

2. **Tauri `app_data_dir` 已被重写** —— Tauri 默认走 macOS `~/Library/Application Support/com.hamuna.app/`，但 HamunaAgent 重定向到 `~/.hamuna/`。`Tauri::path::app_data_dir()` 在代码中**不**直接用，统一过 `app_dirs::hamuna_data_dir()`。

3. **Tauri `resource_dir` 三平台不同** —— macOS 走 `<bundle>/Contents/Resources/`，Win/Linux 走 `<install-dir>/`。**任何把 `resource_dir()` 路径"出 Rust 边界"前** MUST 走 `crate::sidecar::normalize_external_path(p)` 剥 Windows `\\?\` 长路径前缀（CLAUDE.md 红线）。

4. **AGNES_OUTPUT_DIR 在 `$HOME/HamunaAgent/`**（**不**在 `~/.hamuna/`）—— MCP 自控路径，依赖 sidecar `buildMcpSubprocessEnv` 注入 HOME/USERPROFILE 让 `Path.expanduser` 解析。

5. **外部凭据 `~/.claude/` `~/.codex/` `~/.gemini/` 是供应商默认 home** —— HamunaAgent **不**复制 / **不**写入，helper 黑名单。

6. **macOS 系统日志独立于 `~/.hamuna/logs/`** —— `tauri-plugin-log` 自动管 `~/Library/Logs/com.hamuna.app/HamunaAgent.log`，与「统一日志」是两套。

7. **Workspace 不在 `~/.hamuna/`** —— 用户 UI 选定 + Tauri fs scope `$HOME/.hamuna/**` 之外，路径经 `validate_workspace_root` chokepoint 二次校验。

8. **System skill 强制 sync** —— `commands.rs:1284-1536` 启动时若 `~/.hamuna/.system-skills-version` ≠ `SYSTEM_SKILLS_VERSION` 常量，从 `<bundle>/Resources/bundled-skills/` force-overwrite 到 `~/.hamuna/skills/`；**utility skill seed-once**（`src/server/index.ts:1347-1364`）首次启动 seed 一次后永不动。

9. **路径写入三红线**：
   - 禁 `withConfigLock` 之外的裸 `tmp + rename` 写 config
   - 禁 `existsSync` 紧接 `cpSync`（断链 symlink → C++ 异常）
   - 禁 `which::which()` 查系统工具

10. **Workspace path 比较禁裸 `===`** —— Win 反斜杠 vs 正斜杠静默不相等，**必须**走 `workspacePathsEqual()` / `normalizeWorkspacePathIdentity()`。

---

## 9. 改动路径时 MUST 同步

任何路径解析 / 新增存储位置的改动 MUST 同步更新：

| 文件 | 更新内容 |
|---|---|
| `src-tauri/src/app_dirs.rs` | 根路径（如加 `~/.hamuna-dev/`） |
| `src/server/utils/path-safety.ts` | Node 端 chokepoint allow-list |
| `src-tauri/src/commands.rs::validate_file_path` | Rust 端 chokepoint allow-list（**必须与 path-safety.ts 同步**） |
| `specs/tech_docs/install_paths.md` | 本文件 |
| `snapshot.md §2.3` | 速查骨架 |
| `specs/CLAUDE.md` 必读清单 | 「改路径 → 必读 install_paths.md」 |

**新增 lint 建议**：跨语言 sync check（path-safety.ts vs commands.rs），防止单边加 credential dir 后另一边静默放行 → 攻击面（PRD 0.2.15 §7.2 TODO 已有此规划）。

---

## 10. 已知遗留

(a) `KB` 文件位置在源码里硬编码 `~/.hamuna/kb/` 与 `~/.hamuna/kb-legacy-<ts>/`，**未来**如果要让 KB 数据可移植到非 `$HOME`，需要扩展 `app_dirs::kb_dir()` helper。
(b) **douyin-cookies.txt** 是 ad-hoc 临时文件，不在 app_dirs helper 范围内，**不入仓**。
(c) **System `Keychain`** 凭据 HamunaAgent 不直接读，由 OS / WebView 层管理。
(d) **AppImage 挂载点** Linux 上是临时路径（`/tmp/.mount_xxx/`），但 `app_handle.path().resource_dir()` 返回的是安装目录，**不**是挂载点本身——这点在 `src-tauri/src/sidecar/spawn.rs` 内有 special case 处理。
