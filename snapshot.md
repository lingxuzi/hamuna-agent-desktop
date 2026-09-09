# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务指针。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。snapshot.md 不允许无限增长；已完成项落地到 §4 git log / 删除 narrative 后立即清出本节。
> **硬约束**：snapshot.md ≤ 500 行。

最后更新：**2026-09-09**（Task A 完成 — drama-skills 10 个 vendor skill symlink 到 `~/.claude/skills/`；Task B 完成 — agnes-video-25-mcp v0.1.5 发布到 PyPI（https://pypi.org/project/agnes-video-25-mcp/0.1.5/）；Task C 完成 — reference_videos 9 抖音视频小逻规范拉片 + 9 创意模板提炼到 `creative-templates-from-9-references.md` 待用户拍板 bump）。

**+ agnes-video-25-mcp v0.1.5 发布 PyPI（3 commits → PyPI）**：用户报"提交 agnes-video-25 mcp 到 pypi"——grlling 4 矛盾（snapshot §3.2 P3 spec 协议"上传前再拍板一次" / 0.1.4 占位 vs 实际内容 / working tree 不干净含 DEFAULT_MODEL uncommitted / P3 代码已在 574f636 但 spec 单测 + mcp.json 锁版本未做）→ 用户 4 选 1 拍板"发 0.1.5 含 P3 代码，不走单测与锁版本"。**3 commits**（都用 `--no-verify` 避免 HamunaAgent app 版本与 PyPI 包版本耦合）：(1) `940d022 docs(snapshot)` Task A closeout；(2) `ed9d070 fix(agnes-mcp)` DEFAULT_MODEL `agnes-video-2.5` → `agnes-video-2.5-flash`（与 bundled skill tvc-director / creative-video-suite MCP 模板对齐）；(3) `caf4a3a chore(release)` pyproject 0.1.4 → 0.1.5 + 新建 `CHANGELOG.md`（Keep a Changelog 格式 + "Known limitations" 段明示 P3 单测未跑 + .mcp.json 锁版本未做）。**build/check/upload**：`python -m build` 出 `dist/agnes_video_25_mcp-0.1.5-py3-none-any.whl` (16K) + `dist/agnes_video_25_mcp-0.1.5.tar.gz` (76K) → `twine check` 双包 PASSED → 上传前再拍板一次（user 确认）→ `twine upload` 成功 → https://pypi.org/project/agnes-video-25-mcp/0.1.5/。**关键 P3 stale 修正**：commit `574f636` (subject "123", 2026-09-08) **已实现 P3 multi-key fallback 代码**（`_load_key_pool` / `_pick_key` / `_mark_disabled` / `_parse_quota_reset` / `_next_utc_midnight` / `_mask_key` + `_KeyState` dataclass + 模块级 `_KEY_POOL` + `_KEY_POOL_LOCK`），与 §3.2 #19 "🔄 待启动" 描述矛盾——snapshot 需独立 PR 订正（**不是本任务范围**）。**v0.1.5 含的 P3 代码 = 574f636 全部 + DEFAULT_MODEL flash**。**已知遗留**：(a) `tests/test_multi_key_fallback.py` 10 个 pytest case 不存在（spec §4 要求）→ 任何 pool 状态机 bug 只能用户线上复现；(b) `.mcp.json` + `extended_buildin_mcp/mcp.json` 仍是 `AGNES_API_KEY` 单值，未改 `AGNES_API_KEYS` + 未锁 `==0.1.5`（spec §0 / §3 要求）→ HamunaAgent app 跑 v0.1.5 时仍是单 key fallback 路径；(c) commit `574f636` subject "123" 占位（CLAUDE.md 红线"别写 `wip` / `123` / `update`"）→ 修要 interactive rebase / shared amend，按 CLAUDE.md "禁 amend 共享 commit" 暂不动；(d) snapshot.md §3.2 #18 / #19 / #20 / #21 状态字段全部 stale（#18 spec 已落地但 #19 代码已落地而非待启动 / #20 已通过本次 0.1.5 完成 / #21 vendor + mcp.json + e2e 仅完成"vendor"部分）→ 待独立 PR 订正。**维护命令**：`pip install --upgrade agnes-video-25-mcp` 拿到 0.1.5；旧 `AGNES_API_KEY` 单值配置行为不变（向后兼容）；新 `AGNES_API_KEYS=key1,key2` 启用多 key fallback。

**+ drama-skills vendor install（zenstory-ai 10 skill → `~/.claude/skills/`，不污染 `bundled-skills/`）**：用户报"安装 https://github.com/zenstory-ai/drama-skills"——grlling 指出与本仓 `creative-video-suite`（**system skill v40**）+ `bundled-skills/agnes-short-drama`（utility）三套 drama skill 重叠 + 路由抢答风险，用户 3 选 1 拍板"装到 `~/.claude/skills/` 但不污染 bundled-skills/"。**实际安装**：`git clone --depth 1 https://github.com/zenstory-ai/drama-skills.git ~/Projects/drama-skills/` → 10 个 symlink（绝对路径，避免 source 改名失效）→ `short-drama`（routing 入口） + `short-drama-{novel-analyze,develop,write,assets,image-prompts,storyboard,video-prompts,produce,review}`（9 个垂直阶段）。**未装**：`maintainers/skills/short-drama-knowhow`（per README 安装命令只链 `skills/*`，maintainer skill 是给仓库维护者用，不入用户侧）。**bundled-skills/ 不污染**：vendor 改动只落在 `~/Projects/drama-skills/` + `~/.claude/skills/` 两个 user-level 路径，本仓 git 0 改动。**已知风险（用户接受）**：(a) 路由抢答 — zenstory `short-drama` 路由词"创建/继续短剧/做 Look Development/打开 dashboard"与本仓 `creative-video-suite`（"短剧/剧情/微电影/动画/动态漫/预告片"）+ `agnes-short-drama`（"短剧/微短剧/竖屏短剧/web series"）三套并存，user-level skills 在 Claude Code skill 解析顺序中的优先级待观察；(b) 架构路线冲突 — zenstory 9 个垂直 skill 明确"不生成媒体"（必须 sibling `short-drama-produce` 走 MCP 确认付费），与 creative-video-suite（5 阶段每阶段直接调 MCP）两套架构并存，user prompt 触发时 AI 选路取决于 skill 解析顺序 + skill description 命中度；(c) 同步 — zenstory 出新版需手动 `cd ~/Projects/drama-skills && git pull`（不是 bundled skill，没有 SYSTEM_SKILLS_VERSION 同步通道）；(d) **强删风险** — `rm -rf ~/Projects/drama-skills/` 会让 10 个 symlink 全断，symlink 不会自动恢复。**维护命令**：`ln -sfn <src> <link>` 可重新指向（如想切到 fork / 本地修改版）。

最后更新：**2026-09-08**（P3 multi-key fallback spec 完成 → `.pavo-research/agnes-multi-key-fallback-spec.md`，待用户拍板进 Step 2；snapshot.md 重整从 526 → ≤500 行）。**+ agnes-short-drama skill 端到端测试 5/5 PASS + 2 项 bug 触发修复**：(1) 道具/角色/场景 3 image gen；(2) Shot 5 reference 视频 8s 720P 生成（视觉一致性验证 PASS）；(3) 4 视频并行提交触发日配额 429（端到端确认 agnes 单账户 5-10 视频/天硬约束）→ `delivery.md §8.4` 新增配额限制应对策略。修复：(a) 场景"无人物"→ 加英文反面词；(b) 道具"二次元动漫风格"→ 加 "anime lineart" 锁定线稿；(c) images 本地路径不稳 → `storyboard.md §4.3` 切换 HTTPS URL 最佳实践（已写入）。

**+ uvx.exe prod 打包漏声明修复**：用户报"Windows 安装后 multimedia-creator 提示找不到 uvx"。根因 = `tauri.conf.json::bundle.resources` **缺 `"uvx.exe": "uvx.exe"` 一行**（download_uv.ps1 + build_windows.ps1 + agent-session.ts fallback 三段都正确，唯独 tauri-build 不打包这个文件进安装包 → 安装包没 uvx.exe → runtime.ts::getBundledUvPath() prod layout 永远 null → SDK spawn `command: 'uvx'` 走 PATH → 用户没装 → command_not_found）。修复 3 处：(1) `tauri.conf.json` 第 60 行加 uvx.exe 声明；(2) `agent-session.ts:3611-3614` fallback 找不到时 `console.warn` 给清晰提示（macOS/Linux 设计如此，但原本静默）；(3) `.github/workflows/test.yml` Linux CI 占位符列表加 `uvx.exe`（tauri-build 校验所有 bundle.resources 路径存在 → 不加占位符 Linux `cargo test` 会挂）。`windows-release.yml` 已下载 uvx（line 103-107）→ 自动受益；`release.yml` 已禁用。dev 不受影响。

**+ uvx.exe prod layout 假设错误修复（继上述）**：用户实测确认"新安装的 uvx.exe 在安装目录根"——Tauri 2 NSIS 把单文件 `.exe` bundle.resources 放在 `<install-dir>/` 而非 `<install-dir>/resources/`（与 `server-dist.js`/`nodejs/` 等不同），但 `runtime.ts::getBundledUvPath()` 此前假设 `resolve(scriptDir, 'uvx.exe')`（nested）。修复 `runtime.ts::getBundledUvPath()` 优先查 `<install-dir>/uvx.exe`（root, `resolve(scriptDir, '..', 'uvx.exe')`）+ 保留 nested fallback 兼容 layout 变化 + dev walk-up 不变。**端到端验证建议**：用户下次升级安装后看 `[agent] MCP multimedia-creator: resolved uvx via bundled fallback → C:\...\HamunaAgent\uvx.exe` 这条日志。

**+ uvx 0.5.11 pin + MCP spawn PATH 注入（`197837b`）**：用户报"uvx 0.12.3 不支持 `--from`"——一手源码（uv main `crates/uv/src/commands/tool/run.rs`）确认 `--from` 仍支持，但 0.12.x 把 arg 解析变严格 + 拒绝未知 flag（如我们 args 里的 `--default-index` uv tool run 根本不存在）。3 改动：(1) `scripts/download_uv.ps1` param default 锁 `"0.5.11"`（0.5.x 最后 patch，最后兼容 `--from <pkg> <cmd>` 老语法的版本线），注释标"升级前要先改 mcp.json 到现代 `uvx <tool>@<ver>` 语法 + CI smoke test"；(2) `src/server/agent-session.ts` uvx fallback 从"覆写 `command` 为绝对路径"改成"把 bundled uvx 目录 prepend 进 `mcpEnv.PATH`"——`.mcp.json` 仍写 `command: "uvx"`（声明式、不暴露机器路径），SDK PATH 解析命中 bundled 副本；副作用：macOS/Linux 仍走 null warning（未 bundle，按设计）；(3) `.mcp.json` + `extended_buildin_mcp/mcp.json` 删 `--default-index` 改 `env.UV_INDEX_URL`（`uv tool run` 没 `--default-index` flag；PyPI 是默认源，写 `--default-index https://pypi.org/simple` 等于重复 + 0.12.x reject；绕开清华镜像的正确做法是 `UV_INDEX_URL` env）。**已知遗留风险**：两个 mcp.json 仍是 tracked 且含真实 `AGNES_API_KEYS`（用户拍板"先改不改 key"，tracked-key rotation 单独 TODO）。**layout 矛盾**（`runtime.ts:42-48` 注释 vs 实际 prod layout）未解——pin 0.5.11 让 prod probe 链继续工作，没动力现在改；下次再 break 加 probe log。

**+ creative-video-suite: prompt 中文铁律（`baebe3c`）**：874ad4f 引入 6 个中文风格锚点（写实电影 / 3D 国漫 / 日漫赛璐璐 / 赛博朋克 / 古风 / 广告质感），但 `references/agnes-ai-api.md` 6 个范例 `prompt:` 还是英文 → 实际喂 agnes API 时每阶段要英语→中文翻译，风格锚点保真度会漂移（如 "anime lineart" → "anime 线稿" 丢失 Lineart 结构 cue，cel-shading 锁定失败）。2 改动：(1) `SKILL.md` 在工具调用契约段后新增 `🔒 Prompt 语言铁律（必读）` 平行于现有 `🔒 输入源铁律`，**显式列举语法例外**（`<Picture N>` 多图引用标记 / `mode="text"` enum / `size` / `ratio` / `aspect_ratio` / `seconds` 参数键名 / `audios` / `videos` 数组 / `16:9` / `720P` 数值字面量保持英文）——LLM 见"全中文"容易过度翻译固定 token，明列例外避免破坏 model 端 schema；(2) `references/agnes-ai-api.md` 6 个 `prompt:` 全部翻中文，严格保留 `<Picture 1>` / `<Picture 2>` 标记（model 端多图引用语法）。**已知遗留**（不是 bug，是 utility skill 设计）：`creative-video-suite` 不在 `SYSTEM_SKILLS` 清单（仅 `task-alignment` / `task-implement` / `download-anything` / `agent-browser` / `hamuna-cli` / `hamuna-docs` / `tool-creator` / `hamuna-memory-{update,gardener,molt}` / `prompt-writer`），按 utility skill 走 seed-once-then-hands-off，**已 seed 老用户拿到的是旧英文版**。如需强制 update：(a) 提升为 system skill + bump `SYSTEM_SKILLS_VERSION` 39→40；或 (b) 告知用户 `rm -rf ~/.hamuna/skills/creative-video-suite/`。未在这里 promote，因为 promote 改全局 skill-sync lock 主人、收益与风险不匹配，标记为待 user 拍板的 follow-up。

**+ creative-video-suite: 输出目录 + 持久化契约（`cd6a091`）**：用户报"跑完 5 阶段短剧后 chat 滚几屏就找不到第 1 阶段剧本了" + "商业分支产物散落 `AGNES_OUTPUT_DIR` 没项目归属"——3 个具体失败：(1) session 中断 AI 找不到前阶段产物（无 file handle 只能重新生成）；(2) 5 阶段跑完 chat 滚走，用户想"改第 3 段台词"找不到 `02_script.md` / `03_storyboard.md`；(3) UGC / Marketing / Corporate 共享 `AGNES_OUTPUT_DIR` 无命名空间，跨项目互踩。架构决策：**一个项目一棵树** `<workspace>/creative-video-suite/<project-name>/`，**`project.json` 是 stage tracking 唯一权威**。drama 5 阶段 + 商业 3 路**共用**顶层（**不分子目录，靠 `project.json.type` 区分形态**）——避免 marketing 长成 series 后用户被迫迁移目录。11 文件改动：1 新 canonical ref `references/output-conventions.md`（~280 行，目录树 + project.json schema + 8 项集成清单 + 6 不要 + 完整 drama 示例）；`SKILL.md` 加 `## 输出约定` 段（6 条硬约束 + 项目名命名规范）；`README.md` 加新 ref + 一段摘要；9 个 ref 各加 `## 持久化` 段锚定到 output-conventions.md 并补 stage-specific 强门控（UGC style_ref 来源强门控 / Marketing product-refs 必传 + voiceover_scene_map 必落 / Corporate 4 类必填信息 + narration.md 独立完整旁白稿 / drama 各阶段子目录约定）。**重申** CLAUDE.md pit-of-success 红线（不是新增）：工作区 IO MUST 走 `cmd_workspace_*` Rust invoke（Sidecar HTTP `/api/files/*` 早下线，PRD 0.2.7 Phase E）；`<workspace>` 走 `useWorkspaceFileService(workspacePath)` 拿，**禁**硬编码 `~/Documents/...`。**已知遗留**（与 baebe3c 同源）：utility skill 不自动同步老用户；如需强制 update promote + bump `SYSTEM_SKILLS_VERSION` 39→40 或 `rm -rf ~/.hamuna/skills/creative-video-suite/`，未在这里 promote。

**+ creative-video-suite: MCP 使用正确性 + 产品图强制门控（commit `a79ce1e`）**：用户连续提 2 个跨分支硬约束 → (a) "如果用户提到产品，则必须让用户提交产品图"；(b) "drama 也必须要传产品图"（不是软门控，与 commercial 同级）。5 个具体 gap：(1) `image_generate` / `image_edit` / `video_generate` 三工具混用，**mode ↔ params 互斥不显式**（video text/keyframe/reference 互斥没写在 ref 里，AI 自由组合易触发 400）；(2) 跨工具链 URL 传递契约散落（frame HTTPS URL → video first_frame 路径，命名空间 `<Picture N>` ↔ `@image1` ↔ `@product_ref` ↔ `ref_images` 不统一）；(3) failure handling 没有显式分层（MCP 4xx / 5xx / 业务超时 / 状态层中断）；(4) 降级路径禁不写明（CLAUDE.md 红线是"不降级"但 ref 里没复述，AI 容易 keyframe 失败 → 改 text 模式）；(5) per-branch MCP tool map 缺（drama 默认 keyframe / UGC 默认 text / Marketing 默认 keyframe / Corporate 默认 reference 没写明）。11 文件改动：1 新 canonical ref `references/mcp-usage-guide.md`（~250 行，§1 产品图强制门控 / §2 工具 + mode 决策树 / §3 跨工具链 URL / §4 失败处理分层 / §5 命名空间 / §6 per-branch MCP map / §7 集成清单 10 项）；`SKILL.md` 工具调用契约段升级到 5 步硬门控（产品图门控置顶 → HTTPS URL → 中文 prompt → mode 互斥 → schema）；`references/agnes-ai-api.md` 加 `## 参数互斥`（mode × params 全矩阵）+ `## 错误处理`（MCP 层 / 业务层 / 状态层）+ `## 调用前自检清单` 11 项；8 个 ref 各加 `## 产品图强制门控` 和/或 `## MCP 工具调用`（drama 5 ref + commercial 3 ref），drama 与 commercial 同级硬门控；`README.md` 目录树加新 ref。**关键架构决策**：(1) **降级铁律重述**：keyframe/reference 失败 → 必保持 mode 不变，可重试 1 次，连续 2 次失败停下问用户，**不**降级 text（与 CLAUDE.md 红线对齐）；(2) **partial success 处理**：多 segment 视频成功的立刻落盘 + 写 segment-XX.md，失败的记 `project.json.notes.video_segments[<id>]`，单段重试 1 次，多段失败 ≥50% 立即停下；(3) **Corporate 4 类必填信息升级**：原 "logo / IP 等品牌资产" 扩展为含**产品图必传**，3 类必填信息 4 类化（企业 / 宣传 / 品牌资产+产品图 / 旁白），降级模式仅用户书面 ack 后放行。**已知遗留**（与 baebe3c / cd6a091 同源）：utility skill 不自动同步老用户；强制 update 路径相同（promote + bump `SYSTEM_SKILLS_VERSION` 39→40 或 `rm -rf ~/.hamuna/skills/creative-video-suite/`），未在这里 promote。

**+ creative-video-suite: per-stage 可视化 widget + 诊断澄清（commit `dc0bacb`）**：用户报"creative-video-suite 是否直接使用 web url 传给 mcp 服务，导致 chatui 无法直观看到，每个步骤生成完毕出一个可视化 widget 让用户可以直观看到生成内容"——把 **input URL** 和 **output 不可视**混为一谈。**诊断澄清**：input HTTPS URL 是 MCP 契约（5 步硬门控第 1 条强制；本地路径触发 `img.remit.ee` 图床上传撞 QPS 限流），**不能改**；问题在 output 端——`src/server/utils/tool-result-attachments.ts::classifyToolAttachmentPresentation` 当前**未**把 `mcp__multimedia-creator__agnes25_*` 纳入包装，URL 仅以纯文本落到 chat，没被 `ToolImageAttachment` 渲染成本地图卡。**chatui 两条渲染路径已存在**：(A) `<generative-ui-widget>` HTML 块 → `widgetTagParser` 抽取 → `WidgetRenderer` 渲染 sandboxed iframe（per-stage 摘要）；(B) `tool_result.attachments[]` → `ToolAttachmentGallery` 渲染（每张图 / 每段视频 inline 卡）。creative-video-suite 当前**两条都没用上**——本 skill 侧补偿走路径 A。**11 文件改动**（1 新 + 10 改）：新 canonical ref `references/widget-templates.md`（~480 行，6 套模板：planner-meta-card / scriptwriter-summary-card / storyboard-shot-table / assets-image-gallery / frame-keyframe-grid / video-segment-list + 通用规则 7 条 + 每套含渲染目标 / 数据来源 / HTML 骨架 / CSS（theme token）/ 占位符替换 / Markdown fallback + 集成清单 8 项）；`SKILL.md`「交付规范」升级为 widget emit + Markdown fallback，**新增"诊断澄清"小节**讲清 input URL 是契约 + output 不可视是 2 个根因（Sidecar 包装缺位 + skill 不 emit widget）；`references/output-conventions.md` §3 落盘时机表每行加 `widget emit` 列，门控从 AND（确认 + 落盘）升级为 AND（确认 + 落盘 + widget emit）；`references/mcp-usage-guide.md` §3.3 partial success 加 widget 失败展示（红色边框 + ⚠️ + 错误摘要 + retry 提示，**不**消失）；8 个 ref 各加 `## Widget emit` 段（drama 5 + commercial 3），含 emit 时机 / 数据来源 / 占位符 / 商业 3 路差异（UGC Monologue / Marketing voiceover_scene_map / Corporate narration.md）/ Markdown fallback 约束；`README.md` 加「可视化 widget」段 + 诊断澄清摘要。**关键架构决策**：(1) **6 套固定模板约束 AI 自由发挥**——24 种可能（6 阶段 × 4 分支）→ 6 种固定形态；(2) **追加模式 emit**——每生成一张图 / 一段视频立即 emit 最新 widget（streaming-style），失败占位不消失；(3) **Markdown fallback 必须保留**——widget 解析失败时仍可看；(4) **diagnostic clarification**——SKILL.md「诊断澄清」段明确 HTTPS URL 不可改，output 不可视是 Sidecar 包装缺位（本 PR 不修）。**已知遗留**（同 baebe3c / a79ce1e）：(a) utility skill 不自动同步老用户；(b) Sidecar follow-up——`classifyToolAttachmentPresentation` 加 `multimedia-creator` / `agnes25_*` 规则 + 把 agnes response URLs 转 ToolAttachment，落地后用户无需 skill 改动即可看到 agnes 生成图作为 inline 卡（不在本 PR 范围）。

**+ creative-video-suite: 吸收小逻-剧本分镜导演视角（commit `4f944b2`）**：用户报"从 `/home/hmcz/Projects/XiaoLuo-AI-Drama-Skill/小逻-剧本分镜脚本.md` 学习分镜设计 优化 creative-video-suite skill"——之前 5 段口播端到端验证通过但 AI 写分镜"容易抄格式不内化哲学"，需要把参考材料的世界级导演视角硬门控下移到现有 skill。**用户拍板**：(a) 时长模型**并存**——保留 drama 现有 12s 节奏档（短剧风格）+ 新增"灵活档 4-12s 三段式"（电影质感，钩子 0-25% / 展开 25-75% / 悬念 75-100%，参考材料 30s 哲学按 MCP 12s 上限按比例压缩）；(b) 吸收深度**全 5 块**——资产统一铁律 + 五维物理表演 + 运镜按景别分级 + 6 种表演范式 + 硬校验清单。**4 文件改动**（净增 177 行）：(1) `drama/storyboard.md` **+138 行**（245→383，**主战场**）：新增 6 段——「资产统一铁律」（`[图N]` / `@场景N` / 道具明确名称跨 segment 跨集固定编号 + 禁代词 + 禁场景标记同行 + 禁跨段重置）、「时长模型并存」（默认 12s 节奏档 + 灵活档 4-12s 三段式 + 何时切档决策表）、「五维物理表演」（替换现有"情绪具象外化"5 条简单列表为 5 维度强制约束：微表情视线 / 肢体体态 / 动作中间态 / 生理应激 / 光影呼吸，禁抽象情绪词，特写尽量 5 维全覆盖，**动作中间态是 AI 视频稳定性的核心约束**）、「6 种表演范式」（轻俏嗔笑 / 强忍情绪 / 沉绪落空 / 冷厉紧绷 / 破碎失控 / 空心死寂 + 跨镜头情绪一致性 + **禁直接写范式名称，必须写范式对应具象动作**）、「运镜按景别分级」（特写 `tripod static shoot` / 中近 `subtle cinematic handheld` / 中远 `full-scale cinematic handheld`，**禁**特写剧烈运镜 + **禁**中远景 tripod，高频合法标签 + 反机械堆砌）、「交付前硬校验清单」（5 类 23 项：结构与格式 / 时间轴与节奏 / 资产与命名 / 表演与运镜 / 视觉安全，**静默自检不输出过程**）；(2) `drama/assets.md` **+18 行**：「跨段稳定编号」（与 storyboard 硬对齐 + `project.json.assets_index` 锚点 + 角色变体新建 N+1 不替换基线）；(3) `drama/frame.md` **+8 行**：`## 提取要求` 加五维物理表演 + 运镜强度匹配景别两条 bullet，跨阶段硬门控下移；(4) `drama/prompt.md` **+6 行**：`## 从分镜到视频 Prompt 的转换方法` 原 7 步加 8-10 三步：表演维度迁移 + 运镜强度迁移 + 表演范式迁移。**关键架构决策**：(1) **5 维物理表演是 AI 视频稳定性的核心约束**——动作中间态（欲言又止 / 转身一滞 / 抬手悬空等"未完成状态"）替代"已完成动作 + 跳下一个已完成动作"，避免视频模型跳帧；(2) **运镜强度按景别硬分级**——参考材料的核心洞见：特写剧烈运镜 → 面部融化 / 残影；中远景 tripod → 失去空气感；(3) **6 范式是"范式名称 → 具象动作"映射**——写"眼尾泛红含水光 + 双唇反复轻抿微颤"才有效，写"表演强忍情绪"无效；(4) **静默硬校验**——AI 输出分镜前 MUST 静默自检，不向用户暴露检查过程；(5) **硬门控下移**——五维表演 / 运镜分级在 assets / frame / prompt 各阶段都重新强调，避免 stage 间漂移。**已知遗留**：(a) **暂未波及 commercial 3 路 ref**——drama 是参考材料核心受众，commercial 走自己节奏，若后续 UGC / Marketing / Corporate 也出现"导演视角不内化"再波及；(b) **storyboard.md 245 → 383 行膨胀 +138 行**——CLAUDE.md 限 SKILL.md < 500 行，ref 不限，**未来若超过 500 行再考虑拆为 `drama/storyboard/{director-view,shot-table.md}`**；(c) **utility skill 不自动同步老用户**（同 baebe3c / cd6a091 / a79ce1e / c9456ed 同源），强制 update 路径相同（promote + bump `SYSTEM_SKILLS_VERSION` 39→40 或 `rm -rf ~/.hamuna/skills/creative-video-suite/`），未在这里 promote。

---

**+ creative-video-suite: 对齐 MCP 12s 上限（默认 15s → 12s，commit `9207fbd` / `0228e3f`）**：用户 mid-turn 反馈"MCP 服务最大视频长度为 12 秒，skill 中默认 15 秒也需要与 MCP 能力对齐"——全 skill 硬约束 **MCP 视频 `seconds` 取值范围 `"4"` - `"12"`**（已在 `SKILL.md::seconds="4"-"12"` + `references/agnes-ai-api.md::seconds` 表 / `mcp-usage-guide.md::seconds` 表 三处明确）。但 5 个 ref 文件仍硬编码 `15 秒 / 15s / 15s单条 / duration=15` 为默认产出时长，与 MCP 上限冲突 → 用户报"和 MCP 能力对齐"。**7 文件改动**（drama 4 + commercial 3，全部硬门控下移）：(1) `drama/storyboard.md`：单集 90s → **72s**（6 段 × 12s），片段长度 **15s → 12s**，片段时间戳 00:00-00:15 → 00:00-00:12；节奏速查表按比例压缩（7-8个/15秒 → 6-7个/12秒 等）；分镜样例 5 个镜头的时间戳按 12s 重排；(2) `drama/prompt.md`：4-15 秒 → **4-12 秒**；示例完整 Prompt 时长 15秒 + 0-5/5-10/10-15 三段 → 12秒 + 0-4/4-8/8-12 三段；输出格式样例片段时间戳 00:15/00:30 → 00:12/00:24；(3) `drama/frame.md`：关键帧生成确认项 `6 个 15 秒片段` → `6 个 12 秒片段`；(4) `drama/assets.md`：角色高光台词视频判断依据 `> 15 秒 / ≤ 15 秒` → `> 12 秒 / ≤ 12 秒`；(5) `commercial/ugc-talking-video-ref.md`：**11 处** `15 秒 → 12 秒`，含 platform_ref 默认值、口播时长 12s、speech_pace 12s 60-72 字 / 高密度 72-84 字、Cut1 0-3s/Cut2 3-7s/Cut3 7-12s/Cut4 12-15s → Cut1 0-2s/Cut2 2-5s/Cut3 5-9s/Cut4 9-12s、分镜时段 0-2s/2-5s/5-8s/8-11s/11-15s → 0-2s/2-4s/4-7s/7-9s/9-12s、`duration=15` 默认、`excellent_target` 自检 12s 四段式、参数 schema；(6) `commercial/product-marketing-ad-video-no-storyboard-ref.md`：**20+ 处** `15 秒 → 12 秒`，含 description 摘要、确认后分镜、duration 默认、镜头数 8-10/10-12/7 → 6-8/8-10/6、12 秒五段式结构 `0-2s hook / 2-4s 产品揭示 / 4-8s 卖点证明 / 8-10s 结果 / 10-12s packshot hold`、4 种结构模板（高端揭示/模块快剪/证明转化/感官沉浸/爆点机制）全部 12s 化、镜头密度表 13 调性全部 12s 化、高信息密度分镜矩阵 6-8/8-10/6、信息密度差异检查、Narrative Summary 12 秒、广告大字 12s、运镜 12s、速度节奏 12s、卖点编排 12s、功能型 6-8/8-10 镜头、Dynamic Description 6/8-10/6 镜、Cut 8-10、文字遮挡 / 持久化路径 / 15s 结构铁律 / MCP 工具调用参数 schema；(7) `commercial/corporate-business-video-ref.md`：**15+ 处** `15 秒 → 12 秒`，含 description 摘要、`long_video_stitch_mode` 12 秒段、`10-12 分镜 → 8-10 分镜`（按 80% 比例）、确认摘要固定 12 秒、`platform_ref` 12s、`12 秒结构和节奏` 8 镜结构表（0.0-1.2/1.2-2.6/2.6-4.0/4.0-5.4/5.4-6.8/6.8-8.2/8.2-10.0/10.0-12.0）+ 9-10 镜节奏规则、镜头和剪辑 8-10/8 个默认、12 秒默认旁白密度 3-6/4-7/3-4/3-5 句、视频 Prompt 模板 12s、Shot 08/09/10、`long_video_stitch_mode` 12 秒分镜、`工具调用与展示` 12 秒单条、`质量检查` 8-10 分镜、持久化路径 8-10 镜头、Corporate 强门控 8-10 行 storyboard-shot-table widget。**关键架构决策**：(1) **全 skill 12s 默认是硬约束**——不是软门控，AI 不能自由选 15s/20s，必须 ≤ 12；(2) **比例下移**——所有依赖 15s 的镜头数（10-12/8-10/7）、节奏表（7-8/5-6/3-4）、字数（75-90/90-105）、时段切分（0-5/5-10/10-15）按 12/15 = 80% 比例下移到 8-10/6-8/6 等；(3) **结构五段式 12s 化**——Marketing 12s 五段式 `0-2/2-4/4-8/8-10/10-12` 是核心节奏硬约束，所有调性路线 / 护肤证据链 / 功能型卖点排布都按这个分段；(4) **widget-templates.md 不改**——`{{secondsPerEpisode}}` 占位符由 runtime 填，无硬编码 15s。**已知遗留**：(a) utility skill 不自动同步老用户（与 baebe3c / cd6a091 同源）；(b) `references/output-conventions.md` 中如有 `15s` 字眼需独立 grep 复核（本次未扫，但 `references/output-conventions.md::segment-XX.md` 含 `duration` 字段，由 runtime 填值，应无硬编码 15s）；(c) Sidecar follow-up——`shouldUseLongVideoStitch` 默认开（用户要 30s/60s 走 long_video_stitch_mode）依然适用，但单条 = 12s 而非 15s，单条时长更短。

**+ creative-video-suite: MCP 调用硬编码模板 + 2-retry 铁律 + product_ref 漂移对比 widget（待 commit）**：用户两轮要求叠加：(1) `/skill-creator:skill-creator` 优化 MCP 工具使用规范保持用户上传产品一致性 → `references/mcp-usage-guide.md` 现有「10 项 gate + 失败处理」不够硬，AI 在 ref 场景仍可自由组合 mode/images[]；(2) 用户 2026-09-08 锁定**重试铁律**——「所有生成步骤可以重试，不得 fallback，重试 2 次出错交由用户处理」+「所有需要参考图的生成强制硬编码如何使用 mcp 工具以及对应参数」→ 必须消除 AI 自由度。**8 文件改动**：(1) **新 canonical ref `references/mcp-call-templates.md`**（~570 行）—— 12 个硬编码模板 = 3 image_edit (T01 转比例 / T02 多图合成 / T03 局部编辑) + 9 video_generate（drama 4 模板 T04-T07 + UGC T06/T12 + Marketing T07/T09 + Corporate T08 + 公共 T10/T11）+ 4 个公共 block（style_anchor / 产品漂移负向 / 五维物理负向 / ref 角色→images[] 位置映射 product→person→scene→logo→ip）+ 决策表（一图选模板）+ 11 项 gate（升级 10→11 加硬编码铁律）+ 重试铁律段（attempts 1-2 微调 / attempt 3 失败交用户 / 6 条 hard forbidden fallback + 6 条允许微调 + 失败停下标准动作）；(2) `references/mcp-usage-guide.md` 升级——§3.2 失败路径表「1 retry」→「retry #1 + retry #2 + 不得 fallback」+ 7 条硬禁止 fallback + §4.1 错误分类 / §4.2 重试边界 / §4.3 降级禁止 同步升级为「最多 2 次重试 + 任何 attempt 不得 fallback」+ §6 调门前自检 10→11 项（加项 (11) 硬编码铁律）+ 新增 §8 硬编码 MCP 调用模板入口（5 条强制约束）+ §7 集成清单 2→3 项（加 `template_used`）；(3) `SKILL.md` 在 5 步硬门控后新增「🔒 MCP 调用模板硬编码铁律」段——5 条强制约束（必选对应模板 / images[] 顺序按角色 / 公共 block 必嵌入 / 占位符替换必填满 / 不偏离模板）+ 失败重试铁律 2-retry 段；(4) `references/widget-templates.md` 新增 §6.5 `product-ref-drift-compare` widget（product_ref ground truth vs 当前生成结果左右对比 + drift_score 0-1 自评 + 4 档 verdict 文本 `ok/warn/bad/degraded` + drift 颜色条 `low/mid/high`）+ §7 集成清单加第 8 项「涉及产品的生成后必 emit product-ref-drift-compare」；(5) `references/agnes-ai-api.md`「多图引用语法」段后加「🔗 硬编码调用模板」cross-ref；(6) `references/drama/{assets,frame,prompt}.md` 各加 1 段 cross-ref 到 mcp-call-templates.md（drama 走 T04-T05-T10-T11）；(7) `references/commercial/{ugc-talking-video-ref,product-marketing-ad-video-no-storyboard-ref,corporate-business-video-ref}.md` 各加 1 段 cross-ref（UGC T06/T12 / Marketing T07/T09 / Corporate T08）；(8) `references/output-conventions.md` 关键约束后加 1 段 cross-ref（不重复 MCP 规则）。**关键架构决策**：(1) **消除 AI 自由度** = 风险从「AI 误用 ref」降为「AI 漏读模板」+「模板本身错」（两层防御）；(2) **2-retry 是韧性提升不是放弃兜底**——「不得 fallback」+「交由用户」组合 = 任何 attempt 不偷工减料 + 失败后人工接管（避免 1 retry 频繁撞 quota 又没人工介入的中间态）；(3) **drift_score widget 是显式信号**——AI 自评 + 4 档 verdict 让用户**直观看**漂移，不靠肉眼比对；(4) **公共 block 强制嵌入**——style_anchor / product 负向 / 5 维物理负向 = 跨段视觉一致性的物理保证，比约定"AI 记得加"可靠；(5) **images[] 顺序按角色** = `product → person → scene → logo → ip`（§0.4 表）= model 端按 role 解读，不靠 prompt 文字解释顺序；(6) **跨 8 文件 cross-ref 链** = SKILL.md 是总入口 → mcp-usage-guide.md §8 是 hub → mcp-call-templates.md 是 canonical → 各 ref 在自己 MCP 调用点加 🔗 cross-ref。**已知遗留**：(a) utility skill 不自动同步老用户（与 baebe3c / cd6a091 / a79ce1e / dc0bacb / 9207fbd / 4f944b2 同源），如需强制 update promote + bump `SYSTEM_SKILLS_VERSION` 39→40 或 `rm -rf ~/.hamuna/skills/creative-video-suite/`，未在这里 promote（仍待 user 拍板）；(b) `mcp-call-templates.md` 12 模板**未**配单测 / lint 拦截（cross-ref + 字面照抄是约定，依赖 AI 主动读 + 模板完整性），加 lint 需要新规则形态（按模板 ID 校验 prompt 必含对应 placeholder 替换等），本次只做内容契约；(c) `references/drama/scriptwriter.md` 和 `references/drama/storyboard.md` 未单独加 cross-ref（这两个阶段不直接调 MCP，跨阶段引用在 frame / prompt 已覆盖）；(d) product_ref_drift_score 字段**未**强制由 video 阶段落 `project.json.notes`——目前是 AI 自评写字段，**未来**如要强制需要在 `mcp-usage-guide.md` 集成清单加 `drift_score_recorded`。

**+ creative-video-suite: 多视角产品图（opt-in）+ JSON metadata 单源扩展 + T13 单张宫格图模板 + product-multiview-gallery widget（待 commit）**：`/skill-optimizer:skill-optimizer` 触发 → 用户原意 4 点（多视角 weburl / 避开图床 / 本地图→base64 / JSON metadata 单源）→ grlling 4 mental model 错（已在 §3.1 TODO #107 记录）→ 用户 3 决策（opt-in / project.json.notes 扩展 / assets 阶段）→ **用户 mid-turn 关键修正**："产品多视角图为单张宫格图，不是多张图"→ 重设计：原 plan "5 张分图（`views.{front,side,back,top,detail}`）" → 新设计 "1 张宫格图（`multiview_grid_url` + `multiview_grid_layout`）"。**8 文件改动**：(1) `references/output-conventions.md` §2 schema 升级 + §2.1 新增 `notes.product_metadata[<产品名>]` 子对象（`primary_url` / `primary_local_path` / `view_status` / `multiview_grid_url` / `multiview_grid_layout` / `multiview_grid_generated_at`）；**单一权威** 不新建独立 JSON 文件，**扩展** `project.json.notes` 同源结构（与 `video_segments` / `product_image_gate` 一致）；(2) `references/mcp-usage-guide.md` §1.6 改写（5 视角生成 → 1 张宫格图生成，**单张宫格图承载 9/6/4 角度**，video 阶段 `images[0] = multiview_grid_url`） + §6 gate item (8) 更新（views.{front,...} → multiview_grid_url 等） + §7 集成清单 3→4 项（加 `product_metadata_recorded`）+ §8 entry 加 T13 行；(3) `references/mcp-call-templates.md` 新增 §3 image_generate 模板段 + T13 `image_generate_multiview_grid`（1 次 image_generate 调用 → 1 张 HTTPS URL；3 套 grid_layout 派生 placeholder 替换表：3×3 9 角度 / 2×3 6 角度 / 2×2 4 角度 + grid_ratio 1:1/3:4/1:1 + grid_bg_label 按 style_anchor 派生） + §3/§4/§4.1/§5 → §4/§5/§5.1/§6 renumber + §4 决策表加 T13 注释段（T13 是 image_generate 不在表内，video 模板 `{{product_ref_url}}` 优先读 grid_url）；(4) `SKILL.md`「🔒 MCP 调用模板硬编码铁律」段 T01-T12 → T01-T13 + 加 "调 image_generate 多视角产品图之前 → 读 T13"；(5) `references/agnes-ai-api.md`「🔗 硬编码调用模板」cross-ref 加 T13 行；(6) `references/commercial/{ugc-talking-video-ref,product-marketing-ad-video-no-storyboard-ref,corporate-business-video-ref}.md` 各自 🔗 硬编码 MCP 调用 cross-ref 加 T13 行（UGC / Marketing 标注 opt-in 触发场景，Corporate 标注较少触发）；(7) `references/widget-templates.md` 新增 §6.6 `product-multiview-gallery` widget（**单张宫格图展示 + 角度标注 1-N + view_status badge + fallback / error 占位** + Markdown fallback + 3 套 layout 角度文案表）+ §7 集成清单加第 9 项「多视角产品图生成后 emit 了 product-multiview-gallery widget 吗？（§6.6，仅 T13 触发）」；(8) `README.md` 加 `## 产品图处理流程（2026-09-09 加）` 段（4 步：planner 判定 → assets T13 → video 读 metadata → 失败回退 single）+ `## JSON metadata 扩展` 段（schema + 单源说明）+ widget 表加 §6.6 行。**关键架构决策**：(1) **单张宫格图 vs 5 张分图**——1 次 image_generate 调用 vs 5 次，token / 时间 / 资产体积远低；video `images[]` 上限 5 不被多视角吃名额，剩给人物 / 场景 / logo；model 端视觉锚更连贯不会因多图风格漂移打断一致性；(2) **单一权威** = `project.json.notes.product_metadata`，**不**新建独立 JSON 文件（避免双源风险，跨 session 续跑靠 `cat project.json` 看断点已覆盖）；(3) **opt-in 而非 mandatory**——80% 项目 1 张正面图足够，强制多视角 = 增加 token + 生成时间 + 资产膨胀；(4) **view_status enum 保留**（single / multiview-pending / multiview-completed / multiview-failed）——用户认知里的"多视角状态"不变，只是底层字段从 5 URL dict 变单 URL + layout；(5) **video 模板 product_ref 占位符**优先读 `multiview_grid_url`（存在即用），fallback 到 `primary_url`——video 阶段**不**感知多视角 / single 差异，只读最优 URL；(6) **失败回退不阻断**——`view_status: "multiview-failed"` → video 自动回退 single 路径（**不**触发 2-retry gate，多视角是 opt-in 失败即走 single）；(7) **widget §6.6 vs §6.5 区分**——§6.5 product-ref-drift-compare 是左右对比（product_ref ground truth vs 当前生成）+ drift_score；§6.6 product-multiview-gallery 是单张宫格图展示 + 角度标注 + status badge，两者用途独立不冲突。**已知遗留**：(a) utility skill 不自动同步老用户（与 baebe3c / cd6a091 / a79ce1e / dc0bacb / 9207fbd / 4f944b2 同源），强制 update 路径相同，未在这里 promote；(b) `references/drama/*.md` 5 个 ref **未**同步 T13 cross-ref——drama 涉及道具 / 品牌植入也可触发多视角（虽然不常见），可作下一步 follow-up；(c) `mcp-call-templates.md` T13 **未**配单测 / lint 拦截（同上一条 `mcp-call-templates.md` 12 模板），加 lint 需新规则形态；(d) product_metadata 字段未强制 video 阶段落 `project.json.notes`（目前是 assets 阶段落），未来如要强制需要在 `mcp-usage-guide.md` 集成清单加 `product_ref_resolved_recorded`；(e) T13 的 `{{view_angles_desc}}` / `{{grid_bg_label}}` 等 placeholder 是**约定**（runtime 替换），未配 lint 校验 prompt 必含对应替换——和 T01-T12 同源遗留。

---

**+ creative-video-suite: drama 跨段稳定编号 + 双档时长 + 五维物理表演 + 运镜分级（commit `4f944b2`，detail 见 §4 git log + §3.1 TODO #103）**——detail 已 line 29 cross-link 短版覆盖；此处仅指针避免 narrative 重复。**关键架构决策**：(1) storyboard.md 是 canonical（5 大主题），assets/frame/prompt 三文件 cross-reference；(2) MCP 12s 上限通过双档并存吸收（默认 12s + 新增 4-12s 灵活档）；(3) 动作中间态是 AI 视频稳定性核心约束（避免视频模型跳帧）；(4) 6 种表演范式必须写具象动作禁范式名称；(5) 运镜强度按景别硬分级（特写 tripod / 中远 handheld）；(6) 静默硬校验。**已知遗留**：(a) commercial 3 路未同步（drama 受众优先）；(b) storyboard.md 383 行（ref 不限 < 500）。

---

**+ creative-video-suite: 去掉 tvc-director 跨引用（commit 待定）**：用户报"creative-video-suite去掉tvc-director引用"——skill hygiene（移除 sibling skill 显式 cross-ref）。**2 文件改动**：`(1)` `SKILL.md` description 末尾"商业广告大片请走 tvc-director。"直接删（route 表行同步删）+ 路由表右列整行 `| TVC / 商业广告大片 / 品牌广告 / 4A 广告 | **tvc-director** |` 删（route 表只剩 creative-video-suite 自己的关键词）；`(2)` `README.md` 顶部 blockquote `> 商业广告大片请走 \`bundled-skills/tvc-director/\`（TVC 专用）。本 skill 专攻有完整故事线的剧情内容与商业短视频。` 删 + 路由表对应行同步删。**关键架构决策**：(1) **删除而非改中性格式**——用户拍板"最干净"选项（删整行 / 删尾句），不保留 `_未声明 sibling skill_` / `_其他 skill_` 占位（避免误导读者认为本 skill 还在管这条路由）；(2) **TVC-as-domain-term 提及不动**——`corporate-business-video-ref.md:166` + `product-marketing-ad-video-no-storyboard-ref.md:48,60,444,446,724,756,795` 8 处 TVC = Television Commercial 行业术语使用，是 commercial ref 自然引用，**不是** sibling skill cross-ref，**不**在本次改动范围。**已知遗留**：utility skill 不自动同步老用户（与 baebe3c / cd6a091 / a79ce1e / dc0bacb / 9207fbd / 4f944b2 同源），强制 update 路径相同，未在这里 promote。

---

**+ creative-video-suite: frontmatter version + bump-on-commit 自动 SYSTEM_SKILLS_VERSION（commit 待定）**：用户报"creative-video-suite加入版本号，每次修改自动 bump"——`/skill-optimizer:skill-optimizer` 5 步走完：Scope → Review（3 套现有版本机制 ADMIN_AGENT_VERSION / CLI_VERSION / SYSTEM_SKILLS_VERSION；`scripts/bump-on-commit.mjs` 当前只 bump `package.json` / `Cargo.toml` / `tauri.conf.json`）→ Plan（3 方案 A/B/C + grlling 矛盾 4 "自动 bump 真实语义 vs system 版本号爆炸"）→ Implement。**2 文件改动**：(1) `bundled-skills/creative-video-suite/SKILL.md` frontmatter 加 `version: "1"`（破 skill-optimizer Step 5 checklist "frontmatter 只包含 name 和 description"——用户拍板 SKILL.md frontmatter 位置，可接受破例）；(2) `scripts/bump-on-commit.mjs` 加新段 `SYSTEM_SKILLS_VERSION 自动 bump（creative-video-suite 改动触发）`——detect `git diff --cached --name-only -- bundled-skills/creative-video-suite/` 非空 → 读 commands.rs/systemSkills.ts 双源 → 跳过条件（用户主动改 `wcVer !== headVer` / 非 creative-video-suite 改动 / 字段未匹配）→ 双重 patch + `git add` 两文件 + log `[bump-on-commit] SYSTEM_SKILLS_VERSION <n> → <n+1>`。**关键架构决策**：(1) **方案 A 拍板**——promote 为 system skill（v40 生效，commands.rs:1371 + src/server/index.ts:1419 双源已含），复用 SYSTEM_SKILLS_VERSION 全量 sync；(2) **A5 拍板**——严格自动 + 接受爆炸（每次 commit = 全量 7+ system skill 重下载，含 memory / hamuna-cli / tool-creator 等无关项；用户明确接受）；(3) **双源同步保证**——commands.rs + systemSkills.ts 必须同步 patch；(4) **跳过条件**——用户主动改 `wcVer !== headVer` 跳过（参考 npm version 跳过模式）；(5) **SKILL.md `version:` 是 cosmetic 标识**——**不**触发 sync（触发器仍是 SYSTEM_SKILLS_VERSION）。**关键 grlling 矛盾**：(a) 加版本号 ≠ 老用户自动同步已通过 promote 解决（v40 已落地）；(b) frontmatter 不允许放 version 已通过用户拍板破例；(c) bump 触发范围 `bundled-skills/creative-video-suite/` 子目录（含 SKILL.md + README.md + references/），其他 bundled-skills 不触发；(d) bump 类型 patch +1（与 npm version patch 一致）。**已知遗留**（合并）：(a) CLAUDE.md:346 仍写手改要求 manual bump 是 backup；建议后续 PR 同步 CLAUDE.md 文案；(b) commit --amend 走 `--no-verify` 防 hook 再 patch（memory `bump-on-commit-amend-no-verify`）；(c) CI 跳过已生效（`GITHUB_ACTIONS=true` hook 早退）；(d) 其他 17 个 utility skill 仍 seed-once 方案 A 不波及；(e) snapshot.md §0 narrative "utility skill 不自动同步"陈述已 stale（creative-video-suite 已 promote v40）。

---

**± skill-optimizer: 用 AskUserQuestion 替代手敲确认（plugin cache，仅本地，未 commit）**：用户报"与用户对齐需求最好使用 askuserquestion tool，避免用户输入内容太多"——skill-optimizer Step 1/3/4 当前要求手敲确认短语（"按计划执行""开始修改"），对用户输入负担大；改为强制调 `AskUserQuestion` 给 2-4 个候选选项让用户点选。**5 文件改动**（plugin 缓存 `/home/hmcz/.claude/plugins/cache/wuming-skills/skill-optimizer/944c5179a21c/skills/review/skill-optimizer/`，**不是**主仓 git 仓，**未** commit）：(1) `SKILL.md` Step 1（line 46）"调 AskUserQuestion 给 2-4 个候选范围"；(2) Step 3（line 138）"强制 AskUserQuestion 路径"，4 选项（按计划执行 / 调整计划 / 只执行高优先级 / 先讨论风险点）；(3) Step 4（line 169）"如果用户确认语义含糊，调 AskUserQuestion 澄清意图"，4 选项；(4) Gotchas #5（line 153）"AskUserQuestion 选项点选 = 唯一确认通道"；(5) `README.md` 加 `## AskUserQuestion 使用模式` 节 + MCP 12s cap 作为"options must reflect real system constraints"示例。**关键架构决策**：(1) 选项点选是唯一确认通道——"我看看""有道理""先这样"等手敲短语**不算**确认；(2) 选项反映真实系统约束（MCP 12s cap 等硬限制必须体现）；(3) Step 3 计划确认是"强制"调 AskUserQuestion 不是"建议"。**已知遗留**：(a) plugin cache 不是 git 仓，下次 plugin 重新安装可能被覆盖；(b) 需要 upstream 到 wuming-skills/skill-optimizer 源仓（独立 PR）；(c) 当前生效：plugin cache 重新安装前本地修改持续有效。**TODO**：upstream 5 文件改动到源仓（用户单独处理）。

**+ reference_videos: 抖音 9 视频批量下载 + 反爬三件套（task #36）**：用户报"下载 [9 抖音 URLs] 到 reference_videos 目录"——抖音 web 反爬 2026 现状：登录 cookies + Chromium UA + Referer headers 三件套缺一不可（光 cookies 不够 / UA 不匹配仍 401）。`reference_videos/` 落 9 个 mp4（34 MiB 总）= 超帧未来生椰岛 / 一纸花约冷泡茶 / 心相印原生木浆 / 小不礼片场 / vivo Y600Pro / 乐事薯片 / Lucas纸巾 / 灵感AIGC局水蜜桃汁 / 暴风AIGC容声冰箱。**登录脚本** `/tmp/douyin-login/login.mjs`（**不**入仓，仅本地）：(1) Playwright headed Chromium 启 + `page.goto('douyin.com')` 让用户扫码/短信登录；(2) 登录判定走 `page.request.get('/aweme/v1/web/user/self/')` ——**必须**用 Playwright 自带 request 而非 `page.evaluate(fetch)`，因 Douyin `secsdk` 劫持了 `window.fetch` 抛 `TypeError: Failed to fetch`；(3) cookie 真假登录凭证判断：**不能**信 `ttwid`（未登录也存在），要看 `sessionid` / `sid_tt` / `uid_tt` / `passport_csrf_token` 是否有长值；后续 v2 改为只信 API 返回 user_info；(4) 落 Netscape 格式 cookies.txt 到 `~/.hamuna/douyin-cookies.txt`（同 `~/.hamuna/` 既定位置）。**yt-dlp 调参**（落到 9 个视频全部成功）：`--cookies ~/.hamuna/douyin-cookies.txt --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" --add-headers "Referer:https://www.douyin.com/"`，**3 个**首跑失败的（心相印 / Lucas纸巾 / 容声冰箱）重试直接成功（无额外改动）——猜测是首跑后 Douyin 服务端 token 缓存预热或偶发抖动，**重试优先于改参数**。**关键架构决策**：(1) **临时文件不入仓**——`/tmp/douyin-login/login.mjs` 是下载一次性脚本，不需要持久化（`reference_videos/` 是数据产物，用户没说要 commit 进 git，按 .gitignore / `reference_*` 命名约定默认不入仓）；(2) **不抽复用模块**——CLAUDE.md 红线"代码块 >3 引用必须抽象"，但脚本是 1 次性 + 抖音反爬机制可能改，抽到 `src/` 反而成为 stale dead code；(3) **依赖 Chromium 二进制**——`playwright install chromium` 装到 `~/.cache/ms-playwright/chromium-1243/` ~150 MB，不入 git（用户机器本地）。**已知遗留**：(a) `~/.hamuna/douyin-cookies.txt` 含真实 session token，**永久 expires ~6 个月**（`sid_guard` cookie Max-Age=5184000），过期需要重跑 login.mjs；(b) **3 个失败首跑后重试直接成功**——根因未定，可能 Douyin 偶发风控 + token 预热，下次若仍偶发继续重试即可；(c) **不支持 video 水印去除**——下载的是带 Douyin 水印版（page 直接 source 路径），去水印需要走额外 extractor + agnes API 重生成（不在本次范围）；(d) **Mac/Linux 差异**——本机为 Linux Chromium，但 `reference_videos/` 是 macOS 用户看的，**应该没问题**（mp4 容器无关平台）。

**+ reference_videos: 小逻规范 9 视频拉片 + 9 创意模板提炼（待 commit，待 bump）**：用户报"用 `/home/hmcz/Projects/XiaoLuo-AI-Drama-Skill/小逻-视频拉片拆解.md` 规范分析 reference_videos, 优化 creative-video-suite 产品广告的创意方向，总结创意模板"——`/skill-optimizer:skill-optimizer` 决策三件套用户已选（全 9 拉 / 独立文件 `references/commercial/creative-templates-from-9-references.md` / bump 待拍板）。**执行**：(1) 9 个 subagent 并发跑小逻规范逐镜拉片（每个 subagent 严格按"不总结剧情 / 不评价好坏 / 禁抽象情绪词 / 场景标记 / 时间码前闭后开 / 每镜必含景别+摄影距离+方位角度+拍摄方式运镜+角色服装动作+五维微表演+构图+光影+对白+SFX+环境声+BGM 12 字段"），全部完成 9/9（总镜数：冷泡茶 18 / vivo 25 / 一口乐事 28 / Lucas纸巾 8 / 日子 5 / 心相印 10 / 容声冰箱 15 / 哥伦布 33 / 水蜜桃汁 9）；(2) 提炼 9 个创意模板（古风IP包装 / 经典IP痛苦解救 / 都市倦怠+奇观逃离 / 反转悬念式情感 / 拟人IP+冷暖反转 / 异族部落+冰箱奇观 / 历史人物+原料拟人 / 现实痛感+反复怼脸 / 纯产品镜头叙事）；(3) 写新文件 `bundled-skills/creative-video-suite/references/commercial/creative-templates-from-9-references.md`（含 9 视频速览表 + 9 模板详细展开 + 跨模板共性 + 模板选择决策树）。**关键架构决策**：(1) **不与 3 路 commercial ref 重复**——`ugc-talking-video-ref.md`（412 行）+ `product-marketing-ad-video-no-storyboard-ref.md`（848 行）+ `corporate-business-video-ref.md`（495 行）保持各自定位（UGC口播 / 无分镜产品营销 / 企业品牌），新文件是"9 案例拉片提炼出的创意模板总览"，**互补而非替代**；(2) **不重复跨段编号 / 五维物理表演 / 12s 时长边界等已落地规则**——只补 creative direction 维度的横切内容，不与现有 ref 字段重叠；(3) **决策树维度 = 产品类型 + 品牌调性 + 投放目标**，与 3 路商业 ref 的"按场景分"维度交叉（如 UGC 复刻 = 都市倦怠模板，Marketing 复刻 = 古风IP/经典IP/拟人IP模板，Corporate = 异族部落/历史人物/反转情感模板）；(4) **bump 待拍板**——用户明确"先不动，报告完你拍板"，本文件落地后用户需决定是否触发 §5.6 已生效的 bump-on-commit.mjs 自动 SYSTEM_SKILLS_VERSION++，**或**显式让用户选 4 选项（保持 cosmetic / 仅本地 / bump + commit / bump + 等下次 hook）。**已知遗留**：(a) **模板#9（纯产品镜头叙事）** 与现有 commercial 3 路的"无角色叙事"分支有重叠——但本模板用 Charlotte 水蜜桃汁案例具体化"原料产地→加工→使用→静物"四段叙事弧，比现有 3 路更落地；(b) **跨模板共性（运镜/光影/产品植入方式）** 已在 3 路 commercial ref 内部详细论述，本文件不重复，只列 cross-ref 锚点；(c) **跨段编号 `references/commercial/` 已 4 个文件**——后续如需新增第 5 个，建议加 `references/commercial/README.md` 做索引（不在本次范围）；(d) **小逻规范严格度**：subagent 报告里有部分镜位"SFX / 环境声 / BGM 无法从当前证据确认"的诚实标注（非空字段填"无法确认"），符合小逻"不要添加视频中不存在的信息"原则；(e) **9 拉片总报告**留在 subagent task output（`/tmp/claude-1000/.../tasks/*.output`）作为元数据，**不入仓**（同 §5.6 reasoning：临时文件不入仓，体积过大）。**TODO**：用户拍板 bump + commit 决策（参考 AskUserQuestion 选项）。

**+ creative-video-suite: image_generate ratio 分支默认表（单一权威）+ gate (13)**：用户报"检查 skill 调用 aspect ratio 的问题，目前大部分生成图片都锁在 1:1"——`/skill-optimizer:skill-optimizer` 5 步走完：Scope → Review（2 处根因：(H1) `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py:49` `DEFAULT_IMAGE_RATIO = "1:1"` MCP 兜底；(H2) creative-video-suite 各 image_generate 调用模板未显式传 `ratio:`；已有但未串：(M1) `references/mcp-call-templates.md:78` 注释里"drama/Marketing/UGC 默认 9:16 / Corporate 16:9"分支表只在头部未下沉；(M2) product-marketing-ad-video-no-storyboard-ref.md 平台→比例只在 Marketing 单路；(M3) T01 注释 `// size / ratio 不传` 易外推到 image_generate）→ Plan + 4 选项 AskUserQuestion → 用户选「按计划执行」→ Implement → commit `2dcb593`。**7 文件改动（外加 bump-on-commit.mjs 自动 patch 4 文件）**：(1) `SKILL.md` 5 步硬门控加第 5 条 `image_generate 必须显式 ratio:` + 新段「🔒 image_generate ratio 分支默认表（单一权威）」4 行（drama 9:16 / Marketing 9:16 / UGC 9:16 / Corporate 16:9 + Marketing 平台级例外 cross-link）+ 「5 步」→「6 步」标签；(2) `references/mcp-call-templates.md` T01 注释改 image_edit/image_generate 区分；§3 image_generate 段加 🔒 header；§5 gate 加 (13) image_generate 已显式 ratio:（13→14 项 + 14/14 标签）；(3) `references/agnes-ai-api.md` image_generate example 后加 🔒 footnote；(4) `references/mcp-usage-guide.md` §6 gate 加 (13)（13→14 项 + 14/14 标签）；(5) `README.md` 加 `## image_generate 比例（2026-09-09 加）` 段；(6) `references/output-conventions.md` 修正 stale label "12 个 + 12 项" → "13 个 T01-T13 + 14 项"（side-effect of gate count change）；(7) `snapshot.md` closeout。**自动 patch 4 文件**（hook 触发）：`src-tauri/Cargo.toml` + `src-tauri/tauri.conf.json`（HamunaAgent app version 0.3.106 → 0.3.107）+ `src-tauri/src/commands.rs` + `src/shared/systemSkills.ts`（SYSTEM_SKILLS_VERSION 42 → 43，因上一 commit `394387c` 已隐式 bump 41→42，本 commit +1 = 43）。**关键架构决策**：(1) **a 路径**——不改 server.py 默认值（backward compatibility 优先 + 改 skill 侧强制显式传 ratio）；(2) **单一权威 = SKILL.md「🔒 image_generate ratio 分支默认表」** + 4 处 cross-link；(3) **T13 独立性**——T13 `{{grid_ratio}}` 是宫格布局派生（3×3 / 2×2 = 1:1，2×3 = 3:4），与分支默认表独立不冲突；(4) **Marketing 平台级例外 cross-link**——下沉到 product-marketing-ad-video-no-storyboard-ref.md，新表不复制；(5) **T01 注释澄清**——image_edit 用 `aspect_ratio` 不是 `ratio`。**已知遗留**：(a) `server.py:49 DEFAULT_IMAGE_RATIO = "1:1"` **未**改（a 路径选择，外部 caller 漏传 ratio 仍得 1:1，不报错）；(b) **T13 placeholder 替换未配 lint**（同 T01-T12 源遗留，TODO #107 已记录）；(c) **drama/UGC/Corporate 三路无独立平台级 ratio 例外文件**——仅 Marketing 有 product-marketing-ad-video-no-storyboard-ref.md 平台→比例，drama 集横屏需求 / UGC B 站横屏 / Corporate 短视频版走默认表 + 例外字段处理。

**+ hamuna_helper: 跨服务 MCP 工具路由 · agnes-video-25（ADMIN_AGENT_VERSION 24→25）**：用户报"将 agnes-video-25 mcp 每个工具的使用方法内置到 hamuna_helper/CLAUDE.md 中，这是一个全局 md"——grlling 3 矛盾（职责越界 helper 不调 MCP / 与 creative-video-suite 重复 2000+ tokens 常驻税 / 全局加载成本）→ 4 选项 AskUserQuestion（路由 / 错误码 / 自调 MCP / 全量 dump）→ 用户选「helper 给其他 skill 或者任务使用 agnes-video-25 mcp 提供指导」= A 路由变体。**2 commits（931f5ef + 7ff921f chore Cargo.lock sync 触发 hook 二次 patch）**：(1) `bundled-agents/hamuna_helper/CLAUDE.md` 新增「跨服务 MCP 工具路由 · agnes-video-25（multimedia-creator）」段（在「沟通风格」与「股票服务」之间），含 4 子段：完整创作流水线（推荐走 creative-video-suite）/ 直接调用 MCP 兜底（7 工具速查表 + video_generate 3 mode 互斥）/ 关键铁律 4 条（ratio 显式 / seconds 字符串 / mode 互斥 / 失败重试 0 fallback）+ 单一权威 cross-link / 跨场景路由 5 行（按用户意图分发到 creative-video-suite skill / 错误码诊断 / 加新 skill 指引 / ratio 默认 1:1 怎么改）+ 「不要做的事」3 条（不 dump 工具详情 / 不绕过 creative-video-suite / 不改 server.py 默认值）。(2) `src-tauri/src/commands.rs` bump `ADMIN_AGENT_VERSION` "24" → "25"（line 1039 const + line 1735 单元测试 assert + line 1734 测试函数名 `v24_helper_routes_product_knowledge_and_diagnosis` → `v25_helper_routes_product_knowledge_and_diagnosis`）。**关键架构决策**：(1) **轻量化** —— helper 只做"能力路由 + 诊断指引"，**不**重复 dump 7 工具参数表（避免 2000+ tokens 常驻税），用 cross-link 给其他 context 指引；(2) **职责边界守住** —— helper 不直接调 MCP，5 阶段流水线是 creative-video-suite skill 的职责，helper 引导用户加载 skill 而非自己执行；(3) **跨场景路由表 5 行** —— 按"用 MCP 生成 / 问怎么调 / 调试错误 / 加新 skill / ratio 默认怎么改" 5 类用户意图分发，避免 AI 在 helper 里自由发挥；(4) **单一权威 = creative-video-suite skill** —— helper cross-link 到 `bundled-skills/creative-video-suite/SKILL.md` + `references/agnes-ai-api.md` + `references/mcp-call-templates.md §5.1` 等，不另起炉灶；(5) **key 铁律复述 ratio / seconds / mode 互斥** —— helper 上下文加载时这 3 条铁律在 prompt 里常驻（不是常驻完整参数表，是常驻 3 条最高频违反铁律），防御 99% 调用错误；(6) **保留 /support 路径不动** —— 已有 /hamuna-docs + /hamuna-cli + /support 三路径完整，新增段独立挂"跨服务 MCP 路由"，不污染现有路径。**版本流转**：`931f5ef` HamunaAgent 0.3.108→0.3.109（hook patch）+ `7ff921f` 0.3.109→0.3.110（Cargo.lock sync 二次触发 hook）+ Cargo.lock hamuna 0.3.108→0.3.109→0.3.110 三方同步。**已知遗留**：(a) **「股票服务」段同源模式未升级** —— `bundled-agents/hamuna_helper/CLAUDE.md:97-98` 现有"股票服务"是单行 MCP 指引，本次 agnes-video-25 段是新模式（带子段 + 跨场景路由表），后续如要把 stock-datasource MCP 也升级成同模式需独立 PR；(b) **`bundled-agents/hamuna_helper/.claude/skills/support/SKILL.md`（support skill）未同步引用 multimedia-creator 错误码映射** —— 错误处理表在 `agnes-ai-api.md §错误处理` 已存在，但 support skill 没显式 cross-link，diagnostics 走 support 时需加载 `agnes-ai-api.md` 自行定位，独立 PR 补 cross-link。
**desktop install paths 全集审计** → 见 TODO #112 + §2.3 + `specs/tech_docs/install_paths.md`（narrative 不重复，500 行硬 cap）。
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
| creative-video-suite skill | `bundled-skills/creative-video-suite/` | 稳定；utility skill（非 SYSTEM_SKILLS，seed-once）；短剧/UGC/企业宣传；6 风格预设 + 中文 prompt 铁律 + 输出目录持久化契约 + MCP 使用正确性（产品图强制门控 + mode 决策树 + 跨工具链 URL + 失败处理 + 命名空间 + per-branch MCP map）+ per-stage 可视化 widget（6 套模板：planner-meta / scriptwriter-summary / storyboard-shot-table / assets-image-gallery / frame-keyframe-grid / video-segment-list）；5 段口播端到端验证通过；老用户无 SYSTEM_SKILLS bump 不自动更新 |
| agnes-short-drama skill | `bundled-skills/agnes-short-drama/` | utility；Pavo 调研产物；4 字段用户输入 → 6 元数据 → 导演式剧本；未入 `SYSTEM_SKILLS` |
| zenstory-ai/drama-skills | `~/.claude/skills/short-drama*` (symlink → `~/Projects/drama-skills/skills/*`) | vendor user-level；**不**污染 bundled-skills；10 个 skill（routing + 9 垂直阶段）；路由抢答风险自负（详见 §0 narrative）；本地版本 `git clone --depth 1`，需手动 `git pull` 同步 |
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

### 2.3 已安装后真实路径（prod，全集）

`app_dirs::hamuna_data_dir()` (`$HOME/.hamuna/`) 是**单一权威**路径解析器（`src-tauri/src/app_dirs.rs:112-114`）。完整 28 类文件 + 三平台真实路径 + 来源文件 → 见 **`specs/tech_docs/install_paths.md`**（新建，TODO #112）。速查骨架：App bundle → `HamunaAgent.app/Contents/` (macOS) / `<install-dir>` (Win/Linux) / Tauri resource_dir → `<bundle>/Resources/{bundled-*,claude-agent-sdk,nodejs,...}` / 用户数据 → `~/.hamuna/{config.json,sessions.json,skills,agents,providers,tasks.jsonl,...}` / Workspace → 用户在 UI 选定 + `<workspace>/{hamuna_files,creative-video-suite,...}` / MCP output → `$HOME/HamunaAgent/agnes-output/{videos,images}/`（**不在** `~/.hamuna/`）/ 外部凭据 → `~/.claude/` `~/.codex/` `~/.gemini/`（helper 黑名单）。

---

## 3. 当前 TODO（按优先级 + 状态）

### 3.1 进行中

#### TODO #75 — v14 POC: image_edit 修 LED/slat wall bias 🔄
- **策略**：v12 G3 grid（LED 偏白粉最严重）→ `image_edit` mask 染蓝 + 擦黑 → 重跑 G3 keyframe video
- **POC PASS 条件**：G3 末帧 LED ring = 蓝 + 背景 = 纯黑
- **POC FAIL 备选**：post-process color grading / 换 agnes-video-2.5（非 flash）/ 走 v13 lifestyle narrative
- **Stop hook**：v11/v12/v13 都没 3 条件全 PASS；v14 必须先验证 image_edit 路径

#### TODO #103 — 拷 video-skill → bundled-skills/creative-video-suite 🔄
**已落地**（见 §3.4 `#104` + §4 `874ad4f` / `197837b` / `baebe3c` / `cd6a091` / `a79ce1e` / `dc0bacb` / `9207fbd` / `4f944b2`）。5 段口播端到端验证 + URL 复用铁律 + 6 风格预设 + prompt 中文铁律 + 输出目录持久化契约 + MCP 正确性 + per-stage 可视化 widget + **12s 默认时长对齐 MCP 上限** + **drama 跨段稳定编号 + 双档时长 + 五维物理表演 + 运镜分级（导演视角吸收）** + **多视角产品图（opt-in）+ JSON metadata 扩展 + T13 单张宫格图 + product-multiview-gallery widget（TODO #107, 2026-09-09）+ promote 为 system skill + `SYSTEM_SKILLS_VERSION` 39→40 强制 update 老用户（§5.6）**。

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

#### TODO #107 — creative-video-suite: 多视角产品图（opt-in）+ JSON metadata 统一（skill-optimizer 流程）✅ DONE
（落地详见 §5.6 + §4 `aa19103` commit）
#### TODO #108 — creative-video-suite: 视频时长边界单源化（MCP `seconds` 4-12 字符串，硬约束）🔄
**触发**：用户 mid-turn "规范creative-video-suite skill生成分镜的最低/追高秒数要符合mcp对应工具的定义"——MCP `mcp__multimedia-creator__agnes25_video_generate.seconds` 是**字符串**（非 int），合法值集合 `"4"`/`"5"`/`"6"`/`"7"`/`"8"`/`"9"`/`"10"`/`"11"`/`"12"`（9 个整数秒），双重约束（4 下限 / 12 上限），半秒 / 小数 / 浮点字符串均被拒。**问题**：全 skill 散落"4-12 秒"/"≤ 12 秒"措辞，无单一权威源；新增 reference 或 commit 易引入边界漂移（如写"≤ 13 秒" / "11 秒半合法" / 把 `seconds` 写成 int）。**目标**：把完整约束（双重约束 + 9 合法值集合 + 各分支锁定策略 + 边界外异常处理）压到一个 canonical 段；其它 9 个 ref 文件全部 cross-link 到该段，**不**在多处复制。**10 文件改动**：(1) `references/agnes-ai-api.md` 新增 `## 视频时长边界（单一权威 · 2026-09-09 加）` 段（含双重约束表 / 合法值集合 / 各分支默认 vs 锁定策略表 / 边界外异常处理表 / 跨 ref cross-link 锚点表）；(2) `SKILL.md` Step 4 5步硬门控末加 `references/agnes-ai-api.md §视频时长边界（单一权威）` cross-link；(3) `references/drama/frame.md` 残留"90 秒短剧单集默认生成 7 张关键帧"→ 72 秒（与 storyboard 6 段×12s 对齐，**不是** 90/7.5；frame.md 是 image 阶段不直接受 video boundary 约束故不交叉链接）；(4) `references/mcp-usage-guide.md` §6 调用前自检 11→12 项 gate（加 (12) `video_generate.seconds` 字符串 ∈ 9 合法值集合）；(5) `references/drama/storyboard.md` 时长模型表后加 cross-link；(6) `references/drama/prompt.md` line 13 "4-12 秒" 后加 cross-link；(7) `references/commercial/{ugc-talking-video-ref,product-marketing-ad-video-no-storyboard-ref,corporate-business-video-ref}.md` "MCP `seconds` 上限 12" / "MCP 视频 `seconds` 上限 12" 16 处全部改 "MCP `seconds` 边界 `4`-`12`（上限 12）"（in-place 即可，标 (上限 12) 让旧上下文理解延续）；(8) `references/mcp-call-templates.md` T04 seconds 注释 `// 字符串 "4"-"12"` → cross-link 到 §视频时长边界；T07 Marketing `// Marketing 锁死 12 秒（MCP 上限）` → "边界 4-12 上限，见 §视频时长边界（单一权威）"；§5 gate 11→12 项 + "11/11"→"12/12"；(9) `references/widget-templates.md` §6.6 头部加 footnote 标明 T13 多视角宫格图**不受**视频时长边界约束（image_generate 无 `seconds` 参数）；(10) `README.md` 加 `## 视频时长边界（2026-09-09 加）` 段（含双重约束表 / 各分支锁定策略表 / 何时不调此约束 image_generate/image_edit/T13）。**关键架构决策**：(1) **单一权威** = `references/agnes-ai-api.md §视频时长边界（单一权威）`；其余 9 个文件全部 cross-link，**不**重复内容；(2) **in-place 改写 16 处"上限 12"→"边界 4-12（上限 12）"**——保留"上限 12"在括注内让旧上下文理解延续，避免破坏既有跨 ref 引用；(3) **T13 footnote 显式豁免**——多视角宫格图是静态图无 `seconds` 参数，下游 video 阶段才受约束；(4) **drama 72 秒 + 7 帧对齐**——之前 90 秒残留是 12s 上限对齐 PR (`9207fbd`) 漏改，与 storyboard 6 段×12s 不匹配；本次一并修复；(5) **step 5 verify 待执行**：frontmatter / cross-ref / 残留 90 秒 / gate item 一致性。**已知遗留**：(a) utility skill 不自动同步老用户遗留已通过 §5.6 promote + bump `SYSTEM_SKILLS_VERSION` 39→40 解决（**不**再是遗留）；(b) `references/output-conventions.md` 中如有 `15s`/`13 秒` 字眼需独立 grep 复核（与 §5.6 同源 commit `9207fbd` 残留）；(c) `references/drama/scriptwriter.md` 未加 cross-ref（脚本阶段不直接涉及 video_generate `seconds`，跨阶段引用在 storyboard 已覆盖）；(d) `references/drama/assets.md` 未加 cross-ref（同上，assets 阶段产物是图不是视频）。

#### TODO #109 — creative-video-suite: 9 抖音参考视频小逻拉片 → 9 创意模板提炼 🔄
（reference_videos/ 9 抖音产品广告 mp4 / 34 MiB / 详 §5.8 + TODO #36 → `bundled-skills/creative-video-suite/references/commercial/creative-templates-from-9-references.md`（NEW 369 行，9 视频速览 + 9 模板展开 + 决策树 + 与 3 路 commercial ref 边界）+ 3 路 commercial ref 各加 `🔗 创意方向横切` blockquote + SKILL.md 加横切段。**关键**：(a) 9 模板独立互补不与 3 路 commercial ref 重复（按"创意机制"vs 按"场景"）；(b) 时长遵循 MCP 上限 12s（#4/#6/#7/#8 走 long_video_stitch_mode）；(c) 不做剧情总结/评价（小逻规范）；(d) 9 拉片总报告留 subagent task output 不入仓。**落地细节**：(1) 用户已选"commit + 加 cross-ref + 手动 bump" 三件套但执行时发现 SYSTEM_SKILLS_VERSION HEAD=41 → 跳手动 bump 由 hook 接管；(2) 模板 #9 与 3 路无角色叙事分支有重叠，但用 Charlotte 案例更具体不视为冗余；(3) reference_videos mp4 不入仓）

#### TODO #110 — creative-video-suite: image_generate 默认锁 1:1（aspect ratio 缺失）✅ DONE
（落地详见 §5.10 + commit `2dcb593`，SYSTEM_SKILLS_VERSION 41→43 由 bump-on-commit.mjs 自动 +2 触发：上一 commit `394387c` 隐式 bump 41→42 + 本 commit +1→43，强制 sync 老用户）

#### TODO #111 — hamuna_helper: 跨服务 MCP 工具路由 · agnes-video-25（ADMIN_AGENT_VERSION 24→25）✅ DONE
（落地详见 §0 narrative + commits `931f5ef` feat + `7ff921f` chore；ADMIN_AGENT_VERSION "24"→"25" 手动 bump，HamunaAgent 0.3.108→0.3.109→0.3.110 由 bump-on-commit.mjs 自动 +2 触发）
#### TODO #112 — 已安装 desktop 应用文件路径全集审计 ✅ DONE
（落地详见 §2.3 + `specs/tech_docs/install_paths.md` + commit `0a6d583`；216 行新文件，10 节（0 三平台对照 / 1 App bundle 19 项 / 2 Tauri resource_dir 6 类 / 3 用户运行时 32 子项 / 4 Workspace / 5 MCP 自控 / 6 外部凭据 / 7 Platform 日志 / 8 关键决策 10 条 / 9 改动路径同步清单 / 10 已知遗留）。**关键决策**：(1) 单一权威 = `app_dirs::hamuna_data_dir()`；(2) AGNES_OUTPUT_DIR 在 `$HOME/HamunaAgent/agnes-output/`（MCP 自控，**不**在 `~/.hamuna/`）；(3) 外部凭据 `~/.claude/` `~/.codex/` `~/.gemini/` 不在 `~/.hamuna/`；(4) macOS 系统日志双轨（`tauri-plugin-log` 管 `~/Library/Logs/com.hamuna.app/HamunaAgent.log` + `~/.hamuna/logs/unified-*.log`）；(5) Workspace 用户 UI 选定 + Tauri fs scope `$HOME/.hamuna/**` 之外 + `validate_workspace_root` chokepoint。**遗留**：(a) `specs/CLAUDE.md` 必读清单加 install_paths.md 一行 — TODO 已知，独立 commit 补；(b) 跨语言 sync check lint（path-safety.ts vs commands.rs）暂未实现 — PRD 0.2.15 §7.2 已有 TODO，独立 PR；(c) snapshot §2.3 + install_paths.md 双写风险 — 无 lint 拦截）
#### TODO #113 — multimedia-creator MCP: auto-bump pin on every commit（取代 --refresh-package 方案）✅ DONE（落地详见 `extended_buildin_mcp/mcp.json` + `scripts/bump-on-commit.mjs` + commit（即将）。**两步走**：(1) revert `args` 去掉 `--refresh-package` + 加回 `agnes-video-25-mcp==0.1.5` pin（初始 pin 设到 PyPI latest 避免下一 commit 立刻 bump 多余 commit）；(2) `bump-on-commit.mjs` 末尾新增 **AGNES_MCP auto-bump** 段（top-level await + 5s AbortSignal + 用户手动改 wcMcp != headMcp 跳过），每次 commit 查 PyPI JSON API / mismatch 则 patch mcp.json pin + git add + stderr 告警，与 SYSTEM_SKILLS_VERSION auto-bump 同模式。**为什么从 --refresh-package 改 auto-bump**：用户拍板 "Build-time / pre-commit hook auto-bump"（与最初 "每次强制更新最新版" 方向相反——前者用户听完副作用警告选了更克制的方向）；--refresh-package 的副作用（每 spawn PyPI round-trip + rate-limit + breaking change 自动传染 + 故障转 hard error）通过 pin 模式消除，仅在 commit 时付出 ~100ms PyPI check。**已知代价**：开发者必须 commit 才触发 → 老用户必须升级 App 才拿到新 pin（与 system skill 模式一致），如未来要"已安装用户 auto-upgrade"需走 App 启动期 check + `~/.hamuna/` mirror（更重，本任务不做）。**测试**：`node --check` 通过；standalone 干跑 `wcMcp===headMcp → false → 跳过`（本 commit 内 mcp.json 被手动改）+ PyPI fetch 200 + latest=0.1.5 + current pin=0.1.5 + would_bump=false。**TODO 链路**：TODO #113 取代 TODO #111+112 后第三条 MCP 相关 TODO；上一个 MCP TODO（#111 helper 路由 25）保持 DONE）

#### TODO #114 — creative-video-suite: video 阶段轮询 + 串行 + project.json 状态机同步 ✅ DONE
#### TODO #115 — working tree 残留 4 个 version 文件（package.json 0.3.113→0.3.114 / package-lock.json / Cargo.toml / tauri.conf.json）+ SYSTEM_SKILLS_VERSION 未 bump（仍 43） ✅ DONE
#### TODO #116 — bump-on-commit.mjs: SKILL frontmatter version auto-bump（creative-video-suite scope） ✅ DONE
#### TODO #117 — creative-video-suite: 单 segment 视频生成前拆分资产清单 + required_assets 全 ready 硬门控 + recipe 三件套必填 ✅ DONE
#### TODO #118 — creative-video-suite: 分镜设计 JSON schema（storyboard 生产侧权威） 🔄 — landed: user mid-turn 二次扩展 → `output-conventions.md §2.3` 新增 `notes.storyboard.scenes[].shots[]` schema（根 9 + 子 4 字段：shot_id / shot_purpose / shot_duration_seconds / shot_prompt 中文 / mcp_tool_name 6 选 1 / tool_params / required_assets[]按序含 asset_role 6 选 1 first_frame|character_ref|scene_ref|prop_ref|product_ref|brand_ref + asset_id 全局唯一 + asset_path 冗余 + reference_mode 3 选 1 image_generate_direct|image_edit_ref|not_referenced / output_path / status 四态 / created_at / finished_at）+ `§3` 落盘时机表 storyboard 行第 6 列写盘说明 + `§2.2` 标注派生关系（`storyboard` = source of truth / `video_segments[].required_assets[]` = 派生缓存，frame 末尾从 storyboard.shots 聚合去重 + recipe 三件套复制）+ `mcp-usage-guide.md §3.4` pre-flight 加派生一致性校验项（`video_segments[].required_assets[].asset_id ⊆ union(storyboard.shots[].required_assets[].asset_id)`，漂移 → 停下问用户修源头）+ `SKILL.md` 视频生成门禁段 cross-link 补 §2.3。**核心架构决策**：(1) **双源控制**——两者都嵌入 `project.json.notes`，单一权威 = storyboard (§2.3)；(2) **6 类 asset_role** 决定 asset 在 tool_params 怎么分发；(3) **commercial 3 路差异**——ugc / marketing 轻量 storyboard（只列 video shot，不生成分镜图），corporate 强制旁白（shot 必含 shot_duration_seconds）。**未做**：(a) frame 阶段 lint 拦截（依赖 AI cat project.json）；(b) video shot / image shot schema 差异细化（共用 schema，靠 mcp_tool_name 区分）。**已知遗留**：派生一致性校验在 pre-flight 触发，**不**在 frame 末尾写入时拦截（跨阶段延迟 1 stage）；asset_role（shot 内角色）与 §2.2 asset_type（资产本身类型）是两个分类轴
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

- #29 tvc-director chatui 渲染层对齐 v0.9 / #97 hosted_mcps/agnes-video-25/ 7 tools / #14 TypeGraph 重构 KB / #16 fresh install kb-relations poller / #12 skill 安装 `/skillname` unknown command 修复 / #98 30s TVC e2e v9 PASS / #99 v10 60s lifestyle TVC PASS / #100 v11 60s TVC ⚠ 部分通过 / #101 v12 60s TVC ⚠ 条件1 PASS / #102 v13 1x5 reference mode ❌ FAIL / #103 creative-video-suite 全量迁移 ✅ DONE / #104 1st UGC 5 段 60s ✅ DONE + URL 复用铁律

---

## 4. 最近已完成（git log 指针）

| Commit | 摘要 |
|--------|------|
| `874ad4f` | **feat(creative-video-suite): expose 6 visual style presets + commercial style_ref gate** |
| `baebe3c` | **docs(creative-video-suite): enforce Chinese-only prompts with explicit syntax exceptions** |
| `cd6a091` | **feat(creative-video-suite): add output directory + persistence contract for cross-session continuation** |
| `a79ce1e` | **feat(creative-video-suite): add MCP usage correctness contract with product image hard gate (drama + commercial 同级)** |
| `dc0bacb` | **feat(creative-video-suite): add per-stage visualization widget templates + diagnostic clarification** |
| `9207fbd` | **fix(creative-video-suite): align default video duration to MCP 12s cap (15s → 12s across 7 files)** |
| `4f944b2` | **feat(creative-video-suite): absorb director-grade storyboard craft (drama 跨段稳定编号 + 双档时长 + 五维物理表演 + 运镜分级)** |
| `<pending>` | **feat(creative-video-suite): add hard-coded MCP call templates + 2-retry gate + product_ref drift-compare widget (8 files, 12 templates)** |
| `<pending>` | **feat(creative-video-suite): single-source video duration boundary (MCP `seconds` "4"-"12" 字符串, 10 files, 2026-09-09)** |
| `aa19103` | **feat(creative-video-suite): add opt-in multiview grid image + product_metadata JSON schema + promote to system skill (bump SYSTEM_SKILLS_VERSION 39→40)** |
| `f47c650` | **chore(deps): sync Cargo.lock hamuna 0.3.96 → 0.3.100 (bump-on-commit hook drift)** |
| `3eba012` | **fix(creative-video-suite): split input-source iron rule by tool (image_edit 3 forms vs video_generate HTTPS-only)**（dev/skill-input-source-split） |
| `d9a5f70` | **chore(deps): sync Cargo.lock + package.json after 4f944b2** |
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

### 5.3 retry 期间 0 微调铁律全栈落地（2026-09-08）

**用户拍板**：retry #1 / retry #2 期间**完全冻结** prompt 字句 / aspect_ratio / size / seconds（attempt 1 原样重试，只接受 transient 错误通过，否则 attempt 4 撞墙交用户）。

**改动范围**（8 文件 / 9 处修改）：

| 文件 | 改动点 | 关键变化 |
|---|---|---|
| `references/mcp-call-templates.md` §4.1 | 删除"允许的微调 (retry #1 / retry #2 内)" 4 项 | attempt 2/3 改"按 attempt 1 原样重试（0 微调）" |
| `SKILL.md` 铁律段 | line 63 / 67 措辞 | "微调只在重试允许的字句范围内" → "重试 0 微调，按 attempt 1 原样" |
| `references/mcp-usage-guide.md` §3.2 / §3.3 | 失败路径表 + partial success 段 | retry #1/#2 改 "(0 微调)"；同 params 0 微调 |
| `references/commercial/corporate-business-video-ref.md` | line 476 | "重试 1 次" → "重试 2 次（0 微调）" + "连续 2 次失败" → "连续 3 次失败" |
| `references/commercial/ugc-talking-video-ref.md` | line 396 | 同上 |
| `references/commercial/product-marketing-ad-video-no-storyboard-ref.md` | line 828 | 同上 |
| `references/output-conventions.md` §6 | line 154 | "重试一次" → "重试 2 次（0 微调）" |
| `references/drama/frame.md` | line 186 | "重试 1 次（可微调 prompt）" → "重试 2 次（0 微调）" |
| `references/drama/prompt.md` | line 229 / 232 | 同上（含 aspect_ratio 微调删） |

**一致性 fix 副作用**：上轮 commit `ac7da54` 漏改的"重试 1 次"残留（6 文件）一并同步为"重试 2 次 + 连续 3 次失败"，避免 commit message 复杂化。

**语义后果**：3 次原样重试**只能解 transient 错误**（网络 / rate limit / MCP server 临时 5xx）；prompt 自身 typo / ref 引用编号错位 / aspect_ratio 与 first_frame 不一致 / 业务逻辑错误必然撞 attempt 4 停下交用户。诊断 prompt 责任**完全交回用户**。

→ commit `571a9b2` (refactor: retry 期间 0 微调铁律全栈落地, 10 files / +58 / -23) → 见 `git log --oneline --grep="retry 期间 0 微调铁律全栈落地"`

### 5.4 产品带货短剧编剧方法论内化笔记落地（2026-09-08）

**用户拍板**：学 XiaoLuo 方法论，不动 skill；目标形态 = 产品带货短剧；三路 hybrid（UGC 升级 / Marketing 剧情弧 / Drama 完整短剧）。

**新增文档**：`specs/tech_docs/creative-screenwriting-methodology.md`（约 300 行）

**覆盖内容**：
- 4 模式路由（创意开发 / 剧本大纲 / 人物小传 / 剧本正文）→ 对应 planner / scriptwriter / assets / storyboard 阶段
- 三幕结构 vs 短剧结构 vs 广告结构 对比 + hybrid 路径结构选择
- 短剧钩子设计（前 0-10s 异常画面 / 未完成动作 / 身份暴露 / 结果倒置）
- 三路 hybrid 方法论（A / B / C 路径详细结构 + product_ref 门控 + 时长硬约束）
- 人物小传 9 项深层设计 + 戏剧功能 + 关系网
- LuoDesign 五维微表演系统（微表情 / 肢体 / 中间态 / 生理 / 光影）
- 视觉导演化表达（景别 / 运镜 / 镜头提示格式）

**减法原则**：不复制 XiaoLuo 17 个相关 skill 中的 15 个（场景俯视 / 四视图 / 故事面板 / 角色表情 / 道具 / 动作 / 服装 / 三视图 / 设定图 / 分镜脚本 / 资产-DNA-美术 / 九宫格 / 拉片 / 剧本分析 / 剧本改编 / AI 短剧布局）—— 它们是 XiaoLuo "AI 短剧全流程"，本方法论只聚焦"产品带货短剧"编剧子集。

**与现有铁律兼容点**：保留 `cmd_workspace_*` / 中文 prompt / 产品图门控 / 12 T 模板 / retry 0 微调 / drama 5 阶段 / 商业 3 路差异表 / T 模板 images[] 顺序 / 模板硬编码铁律。

**不动任何 skill**：`bundled-skills/` / `specs/DESIGN.md` / `specs/ARCHITECTURE.md` 全部保持现状。

→ 提交后见 `git log --oneline --grep="creative-screenwriting-methodology"`

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
- `references/agnes-ai-api.md:140 / 115`（video_generate first_frame / last_frame 旧描述"本地图路径"）—— video_generate 字段按新铁律仍是 HTTPS URL only，旧描述与新铁律兼容（"本地"是 tool 自身字段类型描述，不是允许本地路径）；保留避免引入新争议

**commit 模板**（已 git 提交，commit `3eba012` on `dev/skill-input-source-split`）：
- subject: `fix(creative-video-suite): split input-source iron rule by tool (image_edit 3 forms vs video_generate HTTPS-only)`
- body 多段：触发（用户原意混淆 image_generate / image_edit / image_paths）+ grlling（4 个矛盾点）+ 实测（官方 agnes API + hosted_mcps wrapper 行为对比）+ 最终拆分方案 + 5 文件改动列表 + 未改动文件理由 + 潜在 follow-up（Sidecar SSE 256KB clamp 验证 / image_edit 本地路径审计字段）

**已知遗留**：
- (a) Sidecar SSE 256KB clamp 行为是否对 `image_edit` 输出生效——`tool-result-attachments.ts` 是否 spill 大 attachment 没看源码，本铁律默认假设 image_edit 输出经 Sidecar SSE 路径受 256KB 约束（与 video_generate base64 撞红线相同）
- (b) `image_edit` 放行本地路径后，`project.json.notes.image_paths_source` 是否加新字段追踪「本地 vs URL vs Data URI」未拍板
- (c) ~~utility skill 不自动同步老用户（与 baebe3c / cd6a091 / a79ce1e / dc0bacb / 9207fbd / 4f944b2 / `<pending>` 同源）—— promote + bump `SYSTEM_SKILLS_VERSION` 39→40 或 `rm -rf ~/.hamuna/skills/creative-video-suite/` 二选一仍未拍板~~ ✅ §5.6 落地 promote + bump 39→40

### 5.6 creative-video-suite: promote utility → system skill + `SYSTEM_SKILLS_VERSION` 39→40（2026-09-09）

**用户拍板**：grlling 指出 utility skill 不自动同步老用户的根因（与 baebe3c / cd6a091 / a79ce1e / dc0bacb / 9207fbd / 4f944b2 / `<pending>` 同源 7 个 commit 已积累 1 周未生效）→ AskUserQuestion 3 选项让用户拍板 → 选 **「Promote + bump（强制更新老用户）」**（vs 仅 mv utility 目录 + 用户手动 `rm -rf`）。

**改动 3 文件**（最小 diff）：
1. `src-tauri/src/commands.rs` — `SYSTEM_SKILLS_VERSION` `"39"` → `"40"` + `SYSTEM_SKILLS` 数组追加 `"creative-video-suite"`（`v40:` 注释说明升级原因：T13 多视角宫格图 + `product_metadata` schema 是 flow-level contract，老用户如不拿到会静默 fallback legacy single-view 路径忽略 metadata）
2. `src/server/index.ts` — `SYSTEM_SKILLS` 数组同步追加 `'creative-video-suite'`（mirror Rust 注释；保持 `seedBundledSkills` 的"系统 skill 跳过种子"行为不变）
3. `snapshot.md` — TODO #107 ✅ DONE / TODO #103 follow-up 改 DONE / §4 git log 加 `aa19103` commit / §5.5(c) 已知遗留划掉 ✅ / 本 §5.6 新增

**关键架构决策**：
1. **版本号为何选 40 而非跳号**——CLAUDE.md 红线是"bump 即强制 overwrite 老用户"，跳号（如 40 → 50）没语义价值；保持线性 bump 与现有 `v8 / v9 / v10 / v18 / v29 / v33 / v35` 注释对齐，未来 `git blame` 一眼能定位 promote 节点
2. **两个清单必须同步**——`commands.rs::SYSTEM_SKILLS` 是 Rust 端 `cmd_sync_system_skills` 的 force-overwrite 权威源，`src/server/index.ts::SYSTEM_SKILLS` 是 Node 端 `seedBundledSkills` 的"skip seed-once"过滤源；任一缺失 = 双 seed（logs 噪音）或漏保护（用户手工改的 skill 不会被覆盖）→ 注释互相 cross-ref（line 1374）
3. **mirror 注释而非只 mirror 字符串**——两处都写明"v40: creative-video-suite promoted"原因（不是同一 commit 由两个 reviewer 各加一遍），半年后 git blame 任何一处都能看到完整理由
4. **不重构既有 v35 `hamuna-docs` / v33 memory-* / v29 prompt-writer 注释风格**——保持现有注释密度（升级原因 + 老用户痛点 + seed-once 不更新的根因），不为了统一而统一

**promote 后续影响（自动）**：
- `cmd_sync_system_skills` 检测 `VERSION` mismatch → 触发 force-overwrite → 老用户 `~/.hamuna/skills/creative-video-suite/` 整个目录被覆盖（含 `SKILL.md` + 8 references/ 子文件）→ 用户已有自定义 skills 与本 skill 命名冲突时会被覆盖（按 `SYSTEM_SKILLS` 设计：本 skill 不允许用户定制，因为 AI flow 依赖它；如有自定义需求需用户 rename skill 名）
- 本 skill 内容变更后续不需再 bump（system skill 模式自动 overwrite）——之前的 baebe3c / cd6a091 / a79ce1e / dc0bacb / 9207fbd / 4f944b2 / `<pending>` 7 个 commit 的内容**下次升级**才会到达老用户，**这次升级**带来 T13 + product_metadata schema

**已知遗留**：
- (a) 老用户本地如有 `~/.hamuna/skills/creative-video-suite/` 下自定义文件（非 skill 内容，如 `my-notes.md`），force-overwrite 会删除——按现有 system skill 设计就该这样（不向用户承诺保留）；如未来需保留用户文件，需在 `cmd_sync_system_skills` 加白名单逻辑（不在本 PR 范围）
- (b) bump 版本号 vs 内容版本号脱钩——后续 creative-video-suite 内容改动**不**再 bump 版本号（system skill 自动同步），但 `SYSTEM_SKILLS_VERSION` 总号仍是同步基线（如未来有新 skill 加入或现有 system skill 大改需 bump）；**未来**如要做"分 skill 独立版本"需要在 `cmd_sync_system_skills` 加每 skill version manifest（独立 TODO，不在本 PR）
- (c) 本 skill `~/.hamuna/skills/creative-video-suite/` 老版本用户本地 `project.json.notes.product_metadata` 不存在——promote 后新约定 T13 + product_metadata schema，AI 在 assets 阶段首次需要时会**主动创建**（不是兼容性问题，是正向演进）

### 5.7 视频时长边界单源化（2026-09-09 落地，§3.1 TODO #108 `<pending>`）

**触发**：用户 mid-turn 报 "creative-video-suite skill 生成分镜的最低/追高秒数要符合 mcp 对应工具的定义"——`video_generate.seconds` 字符串合法值集合与 4-12 双重约束散落 9 个 ref，**没有**单一权威源 → 易在新增 commit 漂移（如把 `seconds` 写 int / 写 13 / 写 11.5）。

**单一权威段**：`bundled-skills/creative-video-suite/references/agnes-ai-api.md §视频时长边界（单一权威 · 2026-09-09 加）`——含双重约束（4 下限 / 12 上限）+ 9 合法值字符串集合 `"4"`-`"12"` + 各分支锁定策略表（drama / UGC / Marketing / Corporate 默认 vs 下探 vs 锁定上限）+ 边界外异常处理表（<4 改 image_generate + 拼接，>12 走 long_video_stitch_mode）+ 跨 ref cross-link 锚点。

**红线条目**：

| 红线 | 后果 | 正确做法 |
|---|---|---|
| 把 `video_generate.seconds` 当 int 喂（如 `12` 而非 `"12"`） | MCP schema 校验失败 → 400 | 严格用字符串字面量 |
| 用 9 合法值集合外的字符串（`"3"` / `"13"` / `"4.5"` / `"11.5"`） | MCP schema 校验失败 → 400 | 用 `"4"`-`"12"` 整数秒字符串 |
| 改 4 下限（写 `< 4 秒` 可生成） | 撞 schema 校验失败 | 必须 ≥ `"4"`，< 4 改 image_generate + frame 拼接 |
| 改 12 上限（写 `≤ 13 秒`） | 撞 schema 校验失败 | 必须 ≤ `"12"`，> 12 走 `long_video_stitch_mode` |
| 在多个 ref 重复完整约束（drift 风险） | 9 处 copy 易漂移 | 全部 cross-link 到 §视频时长边界（单一权威） |

**全栈落地 10 文件**：`agnes-ai-api.md` (canonical) / `SKILL.md` (Step 4 cross-link) / `drama/{frame,storyboard,prompt}.md` (drama 2 路 cross-link + 90→72 fix，frame.md 是 image 阶段不直接受 video boundary 约束故不交叉链接) / `mcp-usage-guide.md` (gate 11→12) / `commercial/{ugc,marketing,corporate}-*-ref.md` (16 处 "上限 12"→"边界 4-12（上限 12）" in-place) / `mcp-call-templates.md` (T04/T07 注释 + gate 11→12) / `widget-templates.md` (§6.6 T13 footnote 显式豁免) / `README.md` (新 `## 视频时长边界` 段) / `snapshot.md` (本段 + TODO #108)。

**image_generate / image_edit / T13 不受约束**：3 类工具无 `seconds` 参数 → widget-templates.md §6.6 footnote 显式说明，README.md 段"何时不调此约束"也列出。
