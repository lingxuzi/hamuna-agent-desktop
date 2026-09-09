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

> **🔗 MCP 调用契约**：所有调 `mcp__multimedia-creator__agnes25_*` 的场景必读 `references/mcp-call-templates.md`（13 个硬编码模板 T01-T13 + 决策表 + 14 项 gate）+ `references/mcp-usage-guide.md`（决策树 / 跨工具链 / 失败处理）。本文件专注落盘契约，不重复 MCP 调用规则。

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

### 2.2 `notes.video_segments[].required_assets[]` 子对象（分镜资产清单，2026-09-09 加）

`required_assets[]` 是每个 video segment 依赖资产的**结构化清单**——把分镜表（`03_storyboard.md`）里 inline 的 `@图1` / `@图2` / 首帧 / 尾帧拆成 JSON 数组，video 阶段 4 步硬门控 pre-flight 第 4 项必读（详见 `references/mcp-usage-guide.md §3.4`）。

**为什么需要**：
- 单 segment 视频生成依赖 N 类资产（角色 / 场景 / 道具 / 关键帧 / 产品图 / brand-refs），缺一个就视频生成失败或产物与分镜设计漂移
- 现有机制只在 `03_storyboard.md` 里 inline 描述分镜，AI video 阶段需要手工 grep 每个 segment 行提取 asset 引用 → 易遗漏 + 跨 session 续跑时读 markdown 重 parse 慢
- 拆分到 `notes.video_segments[<id>].required_assets[]` 后，video 阶段 `cat project.json` 一次拿到全部分镜资产状态
- **2026-09-09 补**：除"产物指针"（asset_path / asset_url），`required_assets[]` 还必带 **recipe 三件套**（`generation_prompt` / `mcp_tool_name` / `tool_params`）——记录"这个 asset 是怎么生成的"，跨 session 续跑 / 重生成 / widget 展示生成历史 / 用户审视 prompt 质量都靠它。无 recipe = "图还在但怎么再出一张"无答案 = 续跑失败 / 重生成 prompt 全靠 AI 重新摸索 = 风格漂移 + 耗时翻倍。

**schema**：

```json
{
  "notes": {
    "video_segments": {
      "segment-01": {
        "status": "in-progress",
        "started_at": "2026-09-09T11:00:00Z",
        "required_assets": [
          {
            "asset_id": "char-linyuan",
            "asset_type": "character",
            "asset_path": "04_assets/characters/林远/林远_设定.png",
            "asset_status": "ready",
            "asset_url": "https://cos-platform-outputs.agnes-ai.cn/.../linyuan.png",
            "generation_prompt": "写实电影风格，35 岁中国男性，林远，西装革履，正面半身像，<style_anchor>",
            "mcp_tool_name": "mcp__multimedia-creator__agnes25_image_generate",
            "tool_params": {"model": "agnes-image-2.5-flash", "size": "2K", "ratio": "9:16"},
            "generated_attempt": 0,
            "generated_at": "2026-09-09T10:00:00Z",
            "asset_url_consumed": []
          },
          {
            "asset_id": "scene-office",
            "asset_type": "scene",
            "asset_path": "04_assets/scenes/林远办公室/林远办公室_全景.png",
            "asset_status": "ready",
            "asset_url": "https://cos-platform-outputs.agnes-ai.cn/.../office.png",
            "generation_prompt": "写实电影风格，<style_anchor>，现代都市高级办公室落地窗夜景，全景俯拍",
            "mcp_tool_name": "mcp__multimedia-creator__agnes25_image_generate",
            "tool_params": {"model": "agnes-image-2.5-flash", "size": "2K", "ratio": "9:16"},
            "generated_attempt": 1,
            "generated_at": "2026-09-09T10:05:00Z",
            "asset_url_consumed": []
          },
          {
            "asset_id": "kf-seg01-start",
            "asset_type": "keyframe",
            "asset_path": "05_keyframes/episode-01/segment-01/SEG01_START.png",
            "asset_status": "ready",
            "asset_url": "https://cos-platform-outputs.agnes-ai.cn/.../seg01-start.png",
            "generation_prompt": "写实电影风格，<style_anchor>，林远站在办公室窗前，背对镜头望向城市夜景，medium shot",
            "mcp_tool_name": "mcp__multimedia-creator__agnes25_image_generate",
            "tool_params": {"model": "agnes-image-2.5-flash", "size": "1K", "ratio": "9:16"},
            "generated_attempt": 0,
            "generated_at": "2026-09-09T11:00:00Z",
            "asset_url_consumed": []
          },
          {
            "asset_id": "kf-seg01-end",
            "asset_type": "keyframe",
            "asset_path": "05_keyframes/episode-01/segment-01/SEG01_END.png",
            "asset_status": "missing",
            "asset_url": null,
            "generation_prompt": "写实电影风格，<style_anchor>，林远转身面对镜头，表情凝重，close-up",
            "mcp_tool_name": "mcp__multimedia-creator__agnes25_image_generate",
            "tool_params": {"model": "agnes-image-2.5-flash", "size": "1K", "ratio": "9:16"},
            "generated_attempt": null,
            "generated_at": null,
            "asset_url_consumed": []
          }
        ]
      }
    }
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `asset_id` | string | ✅ | 资产唯一标识（kebab-case + 类型前缀：`char-` / `scene-` / `prop-` / `kf-` / `prod-` / `brand-`）。AI 跨阶段续跑引用锚点。 |
| `asset_type` | enum | ✅ | 6 选 1：`"character"`（角色）/ `"scene"`（场景）/ `"prop"`（道具）/ `"keyframe"`（关键帧）/ `"product"`（产品图）/ `"brand"`（brand-refs logo / IP）。**与 4 路 asset 来源决策表 §5 一一对应**。 |
| `asset_path` | string (workspace-relative) | ✅ | 资产本地副本路径，`<workspace>/creative-video-suite/<project>/` 开头。**drama 跨集场景**支持跨 episode path（如 `05_keyframes/episode-02/segment-05/SEG05_END.png` 作为 episode-03 segment-01 的 first_frame）。 |
| `asset_status` | enum | ✅ | 资产状态四态：`"pending"`（未生成）/ `"generating"`（MCP 调起中）/ `"ready"`（已生成 + 落盘）/ `"missing"`（生成失败 + 不重试 / 用户主动跳过）。**命名与 §3.3 video_segment status 四态（pending / in-progress / completed / failed）刻意不同**：`generating` vs `in-progress` 区分"asset 本身在生成"和"video segment 在生成"，避免术语混淆。 |
| `asset_url` | string (HTTPS URL, optional) | ❌ | 资产 HTTPS URL（CDN / AGNES_OUTPUT）。`video_generate.images[]` / `first_frame` / `last_frame` 实际读的字段（沿用 `3eba012` video_generate HTTPS-only 铁律，0 `img.remit.ee`）。`asset_status !== "ready"` 时为 `null`。 |
| `generation_prompt` | string (optional) | ❌ | 生成该 asset 用的完整 prompt（中文，沿用 §MCP 调用前 5 步硬门控"中文 prompt 铁律"）。**`asset_status` 任意值都建议保留**——missing/pending 时记录"原计划怎么生成"，跨 session 续跑可直接复读 + 复用模板。Widget 可显示"该 asset 用的 prompt"，方便用户审视生成 recipe。 |
| `mcp_tool_name` | enum (optional) | ❌ | 生成该 asset 的 MCP 工具名（6 选 1 主用 `multimedia-creator` 三件套：`mcp__multimedia-creator__agnes25_image_generate` / `mcp__multimedia-creator__agnes25_image_edit` / `mcp__multimedia-creator__agnes25_video_generate`）。与 `generation_prompt` + `tool_params` 一起构成**生成 recipe 三件套**——跨 session 续跑直接复读即可重生成。 |
| `tool_params` | object (optional) | ❌ | 传给 MCP 工具的 params（JSON 化），如 `{"model":"agnes-image-2.5-flash","size":"2K","ratio":"9:16","mode":"text"}` / `{"model":"agnes-video-2.5-flash","mode":"keyframe","first_frame":"<url>","seconds":"5","aspect_ratio":"9:16"}`。keyframe 类 asset 的 `first_frame` URL 应回指同一 segment 上一个 keyframe asset 的 `asset_url`，构成 keyframe 链。 |
| `generated_attempt` | number (optional) | ❌ | 失败重试计数：`0` = 首次即成功；`1` / `2` = 第 1 / 第 2 次重试成功（沿用 §3 失败重试铁律"单次工具调用最多 2 retries"共 3 attempt）；`null` = 未生成（asset_status 为 pending / generating / missing）。widget 可显示"这个 asset 重试 N 次才成功"提示，引导用户审视 prompt 质量。 |
| `generated_at` | string (ISO timestamp, optional) | ❌ | 资产生成完成时间；用于诊断 stale URL（CDN purge / 失效）。`asset_status !== "ready"` 时为 `null`。 |
| `asset_url_consumed` | array<string> | ❌ | 消费记录：每个元素 = 1 个 segment-XX video 的 video_url（video 阶段 post-call 时 push）。**不**写 asset_status，保持 ready 不变。Widget 可基于此字段显示"asset 被哪些 segment 消费"链路。 |

**写侧契约**（frame 阶段末尾）：

- drama：每个 segment 的关键帧生成完成 → frame 阶段末尾**立即**写 `notes.video_segments[<id>].required_assets[]`，含所有 4-5 类资产（character / scene / prop / keyframe + 可选 product）
- commercial 3 路：根据 type 写不同 asset_type 集合（详见 §5 决策表）
- asset_status 由 AI 在写入时根据资产目录文件存在性判断：`existsSync(asset_path) === true` → `"ready"`，否则根据上游 stage 状态判断 `pending` / `generating` / `missing`
- **recipe 三件套必填**：写 `required_assets[]` 每个 entry 时 `generation_prompt` / `mcp_tool_name` / `tool_params` 三件套**必填**（不论 asset_status 是 ready / pending / missing / generating）——recipe 是"计划 + 产物指针"，与 status 解耦。`generated_attempt` 在成功后回写（首成功 = 0，重试成功 = 1/2），pending/missing 时为 null。

**读侧契约**（video 阶段 pre-flight）：

- **必读**：每段 video_generate 调用前**必须**遍历 `required_assets[]`，任意元素 `asset_status !== "ready"` → 停下问用户补生成
- **video_generate 输入**：从 `required_assets[]` 提取 `asset_type === "keyframe"` 的元素的 `asset_url`（按 first_frame / last_frame 角色分发），其余 `asset_type` 的 `asset_url` 汇集到 `images[]` 参数（按 `mcp-usage-guide.md §1` 输入源拆分铁律：video_generate 字段只接 HTTPS URL）

**为什么是单一权威**（与 §2.1 product_metadata 同模式）：
- 双源风险（新建独立 `<project>/notes/segment-XX-assets.json`）易与 `project.json.notes` 不同步 → 跨 session 续跑哪边是真？哪边过期？
- 扩展 `project.json.notes.video_segments[].required_assets[]` 与现有 `video_segments[].status` / `product_metadata` / `product_image_gate` 子对象同源结构
- AI 续跑第一件事 `cat project.json` 看断点已经覆盖这个字段（output-conventions.md §6 续跑逻辑）

**与 `project.json.stages_completed` 关系**：写时机 = frame 阶段末尾（关键帧全部生成完成时）；与 §3 落盘时机表 frame 行新加列 `notes.video_segments[].required_assets[] 同步落盘` 联动。

**`type` 取值决定产物形态**：
- `drama`：完整 5 阶段（planner → script → storyboard → assets → frame → video）
- `ugc`：planner → storyboard（轻量）→ assets（产品图）→ video
- `marketing`：planner → storyboard → video（**不**生成分镜图、不调 image_edit）
- `corporate`：planner → assets（含 brand-refs）→ storyboard → video（强制旁白）

`stages_completed` 是 AI 续跑的 **唯一权威**。新 session 开始时 AI 先 `cat project.json` 看 `current_stage`，从下一个阶段继续。

---

## 3. 落盘时机与门控

| 阶段完成 | 落盘什么 | 路径 | 门控 | widget emit | notes 同步落盘 |
|---|---|---|---|---|---|
| **planner** | `01_planner.md`（项目 brief + 风格锚点 + 路线选择 + 项目名确认）+ `project.json`（新建） | `<project>/01_planner.md` + `project.json` | 用户确认项目名 + type + style_anchor + aspect_ratio | **planner-meta-card** | `project.json` 首次创建（schema 见 §2） |
| **script** | `02_script.md` | `<project>/02_script.md` | 用户确认剧本 | **scriptwriter-summary-card** | `notes.summary` 更新（剧情核心摘要） |
| **storyboard** | `03_storyboard.md`（含分镜表 + 符号规则 + 运镜） | `<project>/03_storyboard.md` | 用户确认分镜 | **storyboard-shot-table** | — |
| **assets** | 每个角色 / 场景 / 道具生成后立刻落盘（不等全部完成）；阶段末落盘资产清单 `04_assets/<type>/<name>/assets.md` | `<project>/04_assets/...` | 用户确认资产验收表（每张"已生成"才进 frame 阶段） | **assets-image-gallery**（追加模式：每张图生成后立即 emit） | 涉及产品 → 写 `notes.product_metadata.<产品名>`（§2.1 schema） |
| **frame** | 每个关键帧生成后立刻落盘；阶段末落盘 `05_keyframes/frames-index.md` | `<project>/05_keyframes/...` | 用户确认关键帧 | **frame-keyframe-grid**（追加模式：每张关键帧生成后立即 emit） | **每 segment 末尾写 `notes.video_segments[<id>].required_assets[]`**（§2.2 schema；含所有 4-5 类资产 status + path + url） |
| **video** | 每个 segment 视频 `cmd_workspace_copy_paths` 从 `AGNES_OUTPUT_DIR` 复制到本地 + 写 `segment-XX.md` 元数据 | `<project>/06_videos/...` | 用户确认视频 + update `project.json.current_stage` | **video-segment-list**（追加模式：每段视频生成后立即 emit；失败段显示 ⚠️ 占位） | 4 步硬门控（§3.4）pre-flight 第 4 项读 `required_assets[]` 全 ready + post-call 写 `required_assets[].asset_url_consumed[]` |

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

### 5.1 `notes.video_segments[].required_assets[]` 4 路来源决策表（2026-09-09 加）

**为什么需要**：4 路（drama / ugc / marketing / corporate）asset 来源差异巨大——drama 5 类全要 / marketing 只 1 类产品图 / corporate 2 类（brand-refs + 关键帧）。frame 阶段末尾写 `required_assets[]` 时 AI 必须按 type 决定 asset_type 集合，写少了 video 阶段 pre-flight 第 4 项会漏 check，写多了硬凑（keyframe 在 marketing 没需求 → 写空）。

**决策表**（4 行 × 6 列，行 = project.json.type，列 = 6 类 asset，✅ = 该 type 该类资产必含 / △ = 可选 / 空 = 该 type 不需要该类）：

| project.json.type | character（角色） | scene（场景） | prop（道具） | keyframe（关键帧） | product（产品图） | brand（brand-refs） |
|---|---|---|---|---|---|---|
| **drama** | ✅ | ✅ | ✅ | ✅ | △（仅当涉及品牌植入 / 产品道具） | — |
| **ugc** | △（仅当真人口播 / 多人出镜） | △（仅当需要场景背景） | △（仅当涉及产品） | — | ✅（主图必传，§2.1 product_metadata） | — |
| **marketing** | — | — | △（仅当涉及产品配件） | — | ✅（主图必传，§2.1 product_metadata，video 阶段读 `primary_url` / `multiview_grid_url`） | — |
| **corporate** | — | — | — | ✅（如分了镜；不分镜 → 空） | — | ✅（logo / IP / 品牌资产必传） |

**判定细则**：

- ✅ = 该 type **默认必含**，frame 阶段末尾写 `required_assets[]` 时**必须**列出至少 1 个此类型元素
- △ = 该 type **条件性必含**——根据具体需求判断是否有；AI 在 frame 阶段末尾**应主动评估**是否需要（不要省略写"理论上可以要"）
- — = 该 type **不需要**该类资产，frame 阶段末尾写 `required_assets[]` 时**不要**列出此类型元素（避免 video 阶段 pre-flight 第 4 项误以为有）

**drama 的特例**：drama 5 类全 ✅，但 `product` 是 △（drama 涉及品牌植入 / 产品道具才需要，如古装剧道具奶茶杯）。AI 在 storyboard 阶段看到分镜表提到具体产品/品牌名时才在 required_assets 写 product 类型；否则不写。

**ugc 的特例**：3 类 △ 是同一判断标准——"该 segment 是否需要人/场景/产品出现？"。单人口播对镜头 → 只 1 个 character 元素（speaker 设定图）；产品种草视频 → 1 个 product 元素 + 1 个 prop 元素（产品本体）。AI 按 segment 维度判断，不按项目维度一刀切。

**marketing 的特例**：**不生成分镜图**（output-conventions.md §5 marketing 既有约束），所以 `keyframe` 列空。`character` / `scene` 也空——marketing 默认走 product 主图 + `images[]` references，**不**走人物/场景 ref。

**corporate 的特例**：`brand-refs` 必传（output-conventions.md §5 corporate 既有 4 类必填信息"品牌资产"）；`keyframe` △（如分了镜 → 必含，如不分镜直接 corporate 风格 prompt → 空）。AI 看分镜表是否生成决定。

**为什么是单一权威**：与 §2.1 product_metadata / §2.2 required_assets 同源——单一表 + 4 行决策 + frame 阶段末尾按表写盘，避免 AI 自由组合 asset_type 集合导致跨 4 路漂移。

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
