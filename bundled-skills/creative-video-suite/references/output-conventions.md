# Output Conventions · 输出目录与产物规范

**何时读**：planner 阶段（建项目） + 每阶段完成落盘时（持续参考）。

creative-video-suite 的产物分两层：

| 层 | 写在哪 | 谁写 | 谁读 |
|---|---|---|---|
| **MCP server output**（素材层） | `AGNES_OUTPUT_DIR=~/HamunaAgent/agnes-output/`（`multimedia-creator` server 控制） | MCP server | skill 通过 `cmd_workspace_copy_paths` 复制到 user workspace |
| **Skill user workspace**（项目层） | `<workspace>/creative-video-suite/<project-name>/` | **skill（AI）** 调 `cmd_write_workspace_file` / `cmd_workspace_copy_paths` 写 | 同 session + 跨 session 续跑 + 用户 |

**关键约束**（违反会破坏二次创作 + 跨 session 续跑）：

1. **每阶段完成 + 用户确认后**，AI **必须** 把该阶段产物落盘到 user workspace（不是可选、不是建议）。落盘门控与"用户确认"门控平级，没落盘等于没完成。
2. **落盘走 Tauri invoke**（`cmd_write_workspace_file` / `cmd_workspace_copy_paths`），**禁止**直写 Sidecar HTTP / `node:fs` / `path.join` 拼绝对路径。理由：CLAUDE.md pit-of-success 红线「工作区文件 IO 必须走 Rust invoke，Sidecar HTTP `/api/files/*` 已全部下线」。
3. **跨阶段 file 引用走 workspace-relative path**（`<workspace>/creative-video-suite/<project>/04_assets/characters/林远_设定.png`），**不依赖 URL 字符串**。URL 是 model 端用的（`image_generate.first_frame`），file path 是 AI 端用的，分清。
4. **失败 / 重跑旧产物加 `_v1` / `_v2` 后缀**，**不**直接覆盖。用户要清理就手动 `rm`。
5. **`<workspace>` 由用户在 HamunaAgent 工作区选择时确定**，AI 不要硬编码 `~/Documents/...` 之类具体路径——通过 `useWorkspaceFileService(workspacePath)` 拿当前 workspace。

> **🔗 MCP 调用契约**：所有调 `mcp__multimedia-creator__agnes25_*` 的场景必读 `references/mcp-call-templates.md`（12 个硬编码模板 + 决策表 + 11 项 gate）+ `references/mcp-usage-guide.md`（决策树 / 跨工具链 / 失败处理）。本文件专注落盘契约，不重复 MCP 调用规则。

---

## 1. 项目目录结构

```text
<workspace>/
└── creative-video-suite/                                  # 顶层（区分于其他 skill 产物）
    └── <project-name>/                                   # 项目名（kebab-case,planner 阶段确认）
        ├── project.json                                  # 项目元数据（见 §3 schema）
        ├── 01_planner.md                                 # 阶段产物按 01-06 顺序
        ├── 02_script.md                                  # drama 才有；commercial 跳过
        ├── 03_storyboard.md                              # drama 必有；commercial 视分支
        ├── 04_assets/                                    # 资产层
        │   ├── characters/<角色名>/<角色名>_设定.png      # 角色资产图（人设 / 三视图 / 表情 / 服装）
        │   ├── characters/<角色名>/assets.md             # 角色资产清单 + 验收表
        │   ├── scenes/<场景名>/<场景名>_全景.png          # 场景资产图
        │   ├── scenes/<场景名>/assets.md
        │   ├── props/<道具名>/<道具名>.png                # 道具资产图
        │   └── props/<道具名>/assets.md
        ├── 05_keyframes/                                 # drama 才有
        │   ├── episode-01/segment-XX/                    # 按 episode / segment 组织
        │   │   ├── SEG01_START.png
        │   │   ├── SEG01_END.png
        │   │   └── frames.md                             # 该 segment 关键帧 prompt + 验收
        │   └── frames-index.md                           # 全剧关键帧总索引
        └── 06_videos/                                    # 最终视频产物（drama + commercial 共用）
            ├── segment-01.mp4                            # 本地副本（cmd_workspace_copy_paths 从 AGNES_OUTPUT_DIR 复制）
            ├── segment-01.md                             # segment 元数据：prompt / mode / 时长 / 比例 / 风格锚点 / 口播或旁白
            ├── segment-02.mp4
            ├── segment-02.md
            └── ...
```

**命名规范**：
- 项目名：`kebab-case` 自动从用户 brief 提炼（`<subject>-<type>-<yyyymmdd>` 格式，如 `afternoon-tea-tvc-20260908` / `gufeng-drama-ep01-20260908`）。planner 阶段输出项目名提议 + 让用户确认或改。
- 角色 / 场景 / 道具名：用中文（与项目文档语言一致），目录名做转码处理（中英混排按字符直存；如 `林远/` 合法；如要纯 ASCII 备份名可以 `_linyuan/` 平行，但首选中文）。
- segment 编号：`segment-01` / `segment-02` ...（2 位零填充，10 段以内；超过 99 段用 3 位）

---

## 2. project.json Schema

`project.json` 是 AI 跨 session 续跑的"断点文件"。**每阶段完成 + 用户确认后** AI 必须 update 它。

```json
{
  "name": "afternoon-tea-tvc-20260908",
  "type": "drama" | "ugc" | "marketing" | "corporate",
  "style_anchor": "广告质感",                          // 6 个预设之一
  "aspect_ratio": "16:9",                              // 项目默认画幅
  "created_at": "2026-09-08T12:00:00Z",
  "updated_at": "2026-09-08T14:30:00Z",
  "stages_completed": [                                // 推进过的阶段（planner 必出现）
    "planner",
    "storyboard",
    "assets",
    "frame",
    "video"
  ],
  "current_stage": "video",                            // 当前所在阶段（= stages_completed[last] 或下一个）
  "notes": {                                          // object 结构（已知子字段见 §2.1 + mcp-usage-guide.md §1.4 / §3.3）
    "summary": "用户原 brief 摘要 + 关键决策",        // AI 自由写,做 session 续跑 context
    "product_image_gate": "passed" | "bypassed-by-user",  // 已在用,详见 mcp-usage-guide.md §1.4
    "video_segments": { /* partial success 时填,详见 mcp-usage-guide.md §3.3 */ },
    "product_metadata": { /* 产品图元数据,详见 §2.1 */ }
  }
}
```

### 2.1 `notes.product_metadata` 子对象（产品图元数据）

`product_metadata` 是产品图的**单一权威元数据**——记录主图 URL / 本地路径 / 多视角状态。所有 video 阶段 + downstream 资产生成都从这里读（**避免每次重新扫描 / 重新转换**）。

**触发条件**：assets 阶段生成产品图后**必填**（commercial 涉及产品 + drama 涉及产品道具）。

**schema**：

```json
{
  "notes": {
    "product_metadata": {
      "<产品中文名>": {
        "primary_url": "https://cos-platform-outputs.agnes-ai.cn/.../output.png",
        "primary_local_path": "<workspace>/creative-video-suite/<project>/04_assets/product-refs/<产品名>.png",
        "view_status": "single" | "multiview-pending" | "multiview-completed" | "multiview-failed",
        "multiview_grid_url": "https://cos-platform-outputs.agnes-ai.cn/.../grid.png",
        "multiview_grid_layout": "3x3" | "2x3" | "2x2",
        "multiview_grid_generated_at": "2026-09-09T12:00:00Z"
      }
    }
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `primary_url` | string (HTTPS URL) | ✅ | 主图 HTTPS URL；`video_generate.images[0]` 默认读这个（沿用 `3eba012` video_generate HTTPS-only 铁律，0 img.remit.ee） |
| `primary_local_path` | string (workspace-relative) | ✅ | 主图本地副本路径（AI 自己定位用） |
| `view_status` | enum | ✅ | 当前视角状态：`"single"`（默认 1 张主图，80% 场景）/ `"multiview-pending"`（宫格图生成中）/ `"multiview-completed"`（单张宫格图完成）/ `"multiview-failed"`（宫格图失败但保留 single fallback，**不**阻断 video 阶段） |
| `multiview_grid_url` | string (HTTPS URL, optional) | ❌ | **单张**多视角宫格图 HTTPS URL；9 个/6 个/4 个角度**合在一张图里**呈现（不是多张分图）；opt-in 生成（详见 `mcp-usage-guide.md §1.6` + `mcp-call-templates.md §3 T13`） |
| `multiview_grid_layout` | enum (optional) | ❌ | 宫格布局：`"3x3"`（默认 9 视角）/ `"2x3"`（6 视角）/ `"2x2"`（4 视角）；与 `multiview_grid_url` 配对填 |
| `multiview_grid_generated_at` | string (ISO timestamp, optional) | ❌ | 宫格图生成完成时间；用于诊断 stale URL（CDN purge / 失效） |

> **2026-09-09 user 锁定**：多视角产品图是**单张宫格图**（一张图含 N 个角度），**不是**多张分图。`views.{front,side,back,top,detail}` 的 5 URL 设计是过度拆分——video 阶段 `images[]` 上限 5，1 张宫格图即承载全部角度信息，**单 URL 落地更轻**。

**读侧契约**（video 阶段 / 资产生成阶段）：

- **默认场景**（`view_status: "single"`）：`video_generate.images[0] = product_metadata.<产品名>.primary_url`
- **多视角场景**（`view_status: "multiview-completed"`）：`video_generate.images[0] = product_metadata.<产品名>.multiview_grid_url`（仍是 1 张图，但宫格内含全部视角 → model 端一次性看到多角度产品特征，比 5 张分图更连贯，且节省 `images[]` 名额给人物 / 场景 / logo）
- **多视角失败回退**（`view_status: "multiview-failed"`）：回退到 single 路径，video 阶段可继续（**不**阻断）

**写侧契约**（assets 阶段）：

- 主图生成完成 → 立刻写 `primary_url` + `primary_local_path` + `view_status: "single"`
- 多视角宫格图生成完成（T13 模板）→ 写 `multiview_grid_url` + `multiview_grid_layout` + `view_status: "multiview-completed"` + `multiview_grid_generated_at`
- 多视角宫格图生成中 → `view_status: "multiview-pending"`
- 多视角宫格图生成失败 → `view_status: "multiview-failed"`（**保留** `primary_url` 作 fallback）

**为什么是单一权威**：

- 双源风险（新建独立 `.asset_metadata.json`）易与 `project.json.notes` 不同步 → 跨 session 续跑时哪边是真？哪边过期？
- 扩展 `project.json.notes.product_metadata` 与现有 `video_segments` / `product_image_gate` 子对象同源结构一致（详见 mcp-usage-guide.md §1.4 / §3.3 既有用法）
- AI 续跑第一件事 `cat project.json` 看断点已经覆盖这个字段（output-conventions.md §6 续跑逻辑）

**与 `project.json.stages_completed` 关系**：写入时机与 assets 阶段落盘同步；不强制每次 video 阶段都 update `view_status`，但 video 阶段首次使用某产品时应落 `project.json.notes.video_segments[<segment>]` 包含 `product_ref_url` 字段。

**`type` 取值决定产物形态**：
- `drama`：完整 5 阶段（planner → script → storyboard → assets → frame → video）
- `ugc`：planner → storyboard（轻量）→ assets（产品图）→ video
- `marketing`：planner → storyboard → video（**不**生成分镜图、不调 image_edit）
- `corporate`：planner → assets（含 brand-refs）→ storyboard → video（强制旁白）

`stages_completed` 是 AI 续跑的 **唯一权威**。新 session 开始时 AI 先 `cat project.json` 看 `current_stage`，从下一个阶段继续。

---

## 3. 落盘时机与门控

| 阶段完成 | 落盘什么 | 路径 | 门控 | widget emit |
|---|---|---|---|---|
| **planner** | `01_planner.md`（项目 brief + 风格锚点 + 路线选择 + 项目名确认）+ `project.json`（新建） | `<project>/01_planner.md` + `project.json` | 用户确认项目名 + type + style_anchor + aspect_ratio | **planner-meta-card** |
| **script** | `02_script.md` | `<project>/02_script.md` | 用户确认剧本 | **scriptwriter-summary-card** |
| **storyboard** | `03_storyboard.md`（含分镜表 + 符号规则 + 运镜） | `<project>/03_storyboard.md` | 用户确认分镜 | **storyboard-shot-table** |
| **assets** | 每个角色 / 场景 / 道具生成后立刻落盘（不等全部完成）；阶段末落盘资产清单 `04_assets/<type>/<name>/assets.md` | `<project>/04_assets/...` | 用户确认资产验收表（每张"已生成"才进 frame 阶段） | **assets-image-gallery**（追加模式：每张图生成后立即 emit） |
| **frame** | 每个关键帧生成后立刻落盘；阶段末落盘 `05_keyframes/frames-index.md` | `<project>/05_keyframes/...` | 用户确认关键帧 | **frame-keyframe-grid**（追加模式：每张关键帧生成后立即 emit） |
| **video** | 每个 segment 视频 `cmd_workspace_copy_paths` 从 `AGNES_OUTPUT_DIR` 复制到本地 + 写 `segment-XX.md` 元数据 | `<project>/06_videos/...` | 用户确认视频 + update `project.json.current_stage` | **video-segment-list**（追加模式：每段视频生成后立即 emit；失败段显示 ⚠️ 占位） |

**门控 = AND**：用户确认 AND 落盘成功 AND widget emit，三件事都做完才能进入下一阶段。**禁止**"口头确认 + 不落盘就推进" / "落盘但 widget 没 emit 就推进"。Widget HTML 模板 + 占位符替换规则见 `references/widget-templates.md`。

**widget emit 追加模式语义**：每生成一张图 / 一个 segment 后立即 emit 最新 widget（不是等全部完成才 emit 一次）——WidgetRenderer streaming-style，前端看到的是不断追加新图的最新版 widget。失败的 segment / 图片在 widget 中以 ⚠️ 占位（红色边框 + 错误摘要）保留，不消失。

---

## 4. 跨阶段 File 引用规则

drama 流水线跨阶段 file 引用走 workspace-relative path，**不**用 URL 字符串。

**示例**：

```text
# frame 阶段引用 assets 阶段生成的林远人设
prompt_first_frame_ref: "<workspace>/creative-video-suite/gufeng-drama-ep01-20260908/04_assets/characters/林远/林远_设定.png"

# frame 阶段引用 frame 阶段前一集的关键帧
prompt_ref: "<workspace>/creative-video-suite/gufeng-drama-ep01-20260908/05_keyframes/episode-01/segment-05/SEG05_END.png"
```

**给 model 的 URL vs 给 AI 的 file path**：
- `image_generate` / `image_edit` / `video_generate` 的 `image_paths` / `first_frame` / `last_frame` / `images` 参数 → 按工具拆分：`image_edit` 字段（`image_paths` / `mask_path`）接受 HTTPS URL / Data URI / 本地路径（hosted_mcps client-side 归一化，**不**走 `img.remit.ee`）；`video_generate` 字段（`images[]` / `first_frame` / `last_frame` / `audios[]`）只接受 HTTPS URL（避免 `img.remit.ee` QPS 限流）。完整规范见 `references/agnes-ai-api.md`「输入源支持 · 按工具拆分」。
- AI 自己跨阶段定位文件 → 用 file path（workspace-relative）
- **AI 内部维护一个 `<relative_path> → <https_url>` 的映射**（`project.json.notes` 或各阶段 .md 头部 metadata），切换时手查

**反例**（错误）：
- 把 `https://cos-platform-outputs.agnes-ai.cn/...` 直接传给 `cmd_workspace_copy_paths`——那是 MCP 资源，Tauri fs scope 不认
- 把 `<workspace>/creative-video-suite/.../林远_设定.png` 直接喂 `image_generate.first_frame`——model 端不认本地路径，会触发 server 上传 `img.remit.ee` 撞 QPS 限流（见 `agnes-ai-api.md` 输入源铁律）

---

## 5. 商业 3 路差异点

| type | 必含目录 | 产物形态 | 必填门控 |
|---|---|---|---|
| **ugc** | `06_videos/segment-XX.md` + `06_videos/segment-XX-script.md`（**口播台词**） | 完整分镜表 + 口播视频 | style_ref 来源（强门控,见 `SKILL.md` 视觉风格选择）；口播原文进入 `{具体台词}`；重点花字走 `emphasis_text` 不入视频 prompt |
| **marketing** | `04_assets/product-refs/<产品名>.png`（**产品参考图**） | 完整分镜表 + 视频；**不**生成分镜图、不调 image_edit | `product_ref` 必传 + 卖点锁定；15s 结构 `0-2s hook / 2-5s 揭示 / 5-10s 证明 / 10-13s 结果 / 13-15s packshot hold`；旁白走 `voiceover_scene_map` |
| **corporate** | `04_assets/brand-refs/<资产名>.png`（**logo / IP / 品牌资产**） + `06_videos/narration.md`（**完整旁白稿**） | 完整分镜表 + 视频；默认带旁白 | 4 类必填信息（企业信息 / 宣传文案 / 品牌资产 / 旁白）；任何一类缺失必须补问 |

**drama 与 commercial 共用顶层**（`<workspace>/creative-video-suite/<project>/`）；不分子目录（`drama/` / `commercial/`），**靠 `project.json.type` 区分**——因为跨 session 续跑只看 `type`，不强求路径区分。

---

## 6. 失败 / 重跑 / 旧产物处理

| 场景 | 处理 |
|---|---|
| 单张图 / 单段视频生成失败 | 重试 2 次（**0 微调**，按 attempt 1 原样重试）；连续 3 次失败则停下说明失败原因 + 所需补充信息 |
| 重跑前次产物（用户说"这张再抽一次"） | 新产物加 `_v2` / `_v3` 后缀,**不**覆盖原文件;同时 update `project.json.notes` 记录"v2 替换 v1 的原因" |
| 整个项目废弃 | 用户手动 `rm -rf <project>/`；AI 不主动删 |
| session 中断后用户重启 | AI 进项目第一件事 `cat project.json` 看 `current_stage` + `stages_completed`,从下一个未完成阶段继续 |
| 项目名冲突 | planner 阶段输出提议名 + 让用户改;不引入复杂命名空间(避免 auto-suffix `-1` `-2` 让人搞不清哪个是哪个) |

---

## 7. 集成清单（每阶段落盘前自检）

每写一个产物前,AI 内部跑一遍（mental check 或自检脚本):

```text
[ ] 走的是 Tauri invoke (cmd_write_workspace_file / cmd_workspace_copy_paths) 吗？
[ ] 路径是 workspace-relative (以 <workspace>/creative-video-suite/... 开头) 吗？
[ ] 该阶段已经在 project.json.stages_completed 之前 update 过 current_stage 吗？
[ ] 用户已经明确确认本阶段产物吗？
[ ] 跨阶段引用的 file 都存在吗？(前一阶段产物落盘了吗)
[ ] 失败 / 重跑场景用 _v2 后缀而不是覆盖吗？
```

8 项全过才允许进入下一阶段。**任何一项没过 = 该阶段未完成**,必须停下补做。

---

## 8. 不要做的事

- ❌ **不要**把 chat 即时输出当唯一交付——chat 历史会滚走,产物必须落盘
- ❌ **不要**绕开 `cmd_workspace_*` 走 Sidecar HTTP / `node:fs`——CLAUDE.md 红线
- ❌ **不要**让 project.json 缺失 `current_stage` 字段——新 session 不知道从哪继续
- ❌ **不要**用 `~/Documents/...` 等具体绝对路径——用户的工作区由 HamunaAgent 在 UI 层选择
- ❌ **不要**在 `06_videos/` 直接放 URL 字符串——必须是 `.mp4` 本地文件 + `.md` 元数据
- ❌ **不要**假设 `AGNES_OUTPUT_DIR` 路径已知——MCP server 控制,AI 通过 `cmd_workspace_copy_paths` 从 `output_filename` / `local_path` 字段复制,不能直接拼 `~/HamunaAgent/agnes-output/...`

---

## 9. 完整示例 (drama 跑完整 5 阶段)

```text
# 用户 brief: "我想做一个 60 秒的职场逆袭短剧,主角林远被踢出公司又逆袭"
# planner 阶段确认:
#   - project name: workplace-comeback-drama-ep01-20260908
#   - type: drama
#   - style_anchor: 写实电影
#   - aspect_ratio: 16:9
#   - episodes: 1 (60s)

# 项目目录最终结构
<workspace>/creative-video-suite/workplace-comeback-drama-ep01-20260908/
├── project.json                                       # name/type/style/锚点/stages
├── 01_planner.md                                      # brief 摘要 + 决策 + 6 段规划
├── 02_script.md                                       # 完整剧本 + 角色清单 + 场景清单 + 道具清单
├── 03_storyboard.md                                   # 6 段 × 3 镜头 = 18 行分镜 + 符号 + 运镜
├── 04_assets/
│   ├── characters/
│   │   ├── 林远/林远_设定.png                          # 人设正脸
│   │   ├── 林远/林远_三视图.png                        # 正面 / 侧面 / 背面
│   │   ├── 林远/林远_服装.png                          # 西装
│   │   ├── 林远/assets.md                              # 角色资产清单 + 验收
│   │   ├── 周凯/周凯_设定.png
│   │   └── 周凯/assets.md
│   ├── scenes/
│   │   ├── 林远办公室/林远办公室_全景.png
│   │   ├── 林远办公室/林远办公室_氛围.png
│   │   └── 林远办公室/assets.md
│   └── props/
│       ├── 怀表/怀表.png                              # 关键道具
│       └── 怀表/assets.md
├── 05_keyframes/
│   ├── episode-01/
│   │   ├── segment-01/SEG01_START.png
│   │   ├── segment-01/SEG01_END.png
│   │   ├── segment-01/frames.md
│   │   ├── segment-02/SEG02_END.png
│   │   └── ...
│   └── frames-index.md
└── 06_videos/
    ├── segment-01.mp4                                 # 5s 开幕冲突
    ├── segment-01.md                                  # prompt / mode / 时长 / 锚点 / 链接
    ├── segment-02.mp4
    ├── segment-02.md
    ├── ...
    └── segment-06.mp4
```

每阶段完成 + 用户确认 → 落盘 → update `project.json.current_stage`。新 session 重启时 `cat project.json` 即知断点。
