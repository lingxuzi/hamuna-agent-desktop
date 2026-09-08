# Creative Video Suite · 综合剧情视频创作套件

**name**: `creative-video-suite`
**适用场景**: 短剧 / 微电影 / 动画 / 动态漫 / 预告片 / UGC 口播 / 企业宣传 / 商务视频
**模型绑定**: `agnes-image-2.5-flash` + `agnes-video-2.5-flash`
**后端**: `multimedia-creator` MCP（`hosted_mcps/agnes-video-25`，agnes 国内版 `https://api.agnes-ai.cn/v1`）

> 商业广告大片请走 `bundled-skills/tvc-director/`（TVC 专用）。本 skill 专攻有完整故事线的剧情内容与商业短视频。

## 目录结构

```text
creative-video-suite/
├── SKILL.md                        # 主入口（planner / 路由 / 输出约定 + 5 步硬门控 + 每阶段 widget emit）
├── README.md                       # 本文件
└── references/
    ├── agnes-ai-api.md             # multimedia-creator MCP 工具参考 + 参数互斥 + 调用前自检清单
    ├── mcp-usage-guide.md          # MCP 使用正确性指南（产品图门控 / mode 决策树 / 跨工具链 / 失败处理）
    ├── output-conventions.md       # 输出目录 / project.json / 落盘时机 / 商业 3 路差异（widget emit 列）
    ├── widget-templates.md         # 6 套 per-stage 可视化 widget HTML 模板（chatui 实时可视化）
    ├── drama/
    │   ├── scriptwriter.md         # 剧本创作（含产品图强制门控 + Widget emit）
    │   ├── storyboard.md           # 分镜切分（含产品图强制门控 + Widget emit）
    │   ├── assets.md               # 资产设定（角色 / 场景 / 道具 / 产品类禁止 AI 自由生成 + Widget emit）
    │   ├── frame.md                # 关键帧生成（含 MCP 工具调用 + Widget emit）
    │   └── prompt.md               # 视频提示词与生成（含 MCP 工具调用 + mode 决策树 + Widget emit）
    └── commercial/
        ├── ugc-talking-video-ref.md             # UGC 口播（强门控升级 + MCP 调用 + Widget emit）
        ├── product-marketing-ad-video-no-storyboard-ref.md  # 产品营销无分镜（强门控 + MCP 调用 + Widget emit）
        └── corporate-business-video-ref.md      # 企业宣传 / 商务视频（4 类必填信息升级 + MCP 调用 + Widget emit）
```

## 5 阶段剧情流水线

```text
planner (SKILL.md) → scriptwriter → storyboard → assets → frame → prompt → 视频生成
```

每阶段读对应 `references/drama/*.md`，不得跳阶段。每阶段完成输出后必须用户确认才能推进。

## MCP 工具速查

| 工具 | 用途 |
|---|---|
| `mcp__multimedia-creator__agnes25_image_generate` | 文生图（T2I） |
| `mcp__multimedia-creator__agnes25_image_edit` | 图生图 / 多图合成（I2I） |
| `mcp__multimedia-creator__agnes25_video_generate` | 视频生成（text / keyframe / reference 三模式） |

详细参数：`references/agnes-ai-api.md`。

## 输出约定

每跑一个项目，产物落盘到 `<workspace>/creative-video-suite/<project-name>/`，配 `project.json` 跟踪断点（跨 session 续跑）。drama 5 阶段产物结构、商业 3 路（UGC / Marketing / Corporate）差异点、落盘时机门控、跨阶段 file 引用规则见 `references/output-conventions.md`。

## 可视化 widget

**每阶段生成完后 emit `<generative-ui-widget>` HTML 块**让用户在 chatui **直观看**生成内容（不是裸 URL 文本）。6 + 2 套模板：

| 阶段 | widget | 用途 |
|---|---|---|
| planner | planner-meta-card | 项目元数据 + 阶段推进状态 |
| scriptwriter | scriptwriter-summary-card | 标题 / 类型 / 角色 / 场景 / 道具清单 |
| storyboard | storyboard-shot-table | 分镜表 + 关键帧图 |
| assets | assets-image-gallery | 角色 / 场景 / 道具缩略图（追加模式） |
| frame | frame-keyframe-grid | drama 关键帧网格（追加模式） |
| video | video-segment-list | 视频列表 + 失败占位（追加模式） |
| (跨段) | product-ref-drift-compare (§6.5) | 产品参考 vs 当前生成结果左右对比 + drift_score 自评 |
| (跨段) | product-multiview-gallery (§6.6, 2026-09-09 新增) | 多视角产品宫格图展示 + 角度标注 + view_status badge |

完整 HTML 模板 + 占位符替换规则见 `references/widget-templates.md`。

**诊断澄清**：creative-video-suite 的 HTTPS URL → MCP 输入是**正确**的（MCP 只接受 HTTPS URL）；问题在 MCP → chatui 输出——`src/server/utils/tool-result-attachments.ts::classifyToolAttachmentPresentation` 当前未把 `mcp__multimedia-creator__agnes25_*` 纳入包装，URL 仅以纯文本落到 chat。本 skill 通过 emit widget 块补偿。Sidecar 包装属于另一 PR follow-up。

## 产品图处理流程（2026-09-09 加）

涉及产品的项目（commercial 全支 + drama 涉及道具 / 品牌植入）必须走以下流程：

1. **planner 阶段**：判定调性是否需要多视角
   - 调性含 "360° reveal" / "多角度" / "产品 9 宫格" / "全景" 等 → AI 在确认摘要中**明示**询问用户是否生成多视角
   - 用户 ack → 触发 T13 `image_generate_multiview_grid`（assets 阶段执行）
   - 用户跳过 → 走默认 single 路径（`view_status: "single"`）
2. **assets 阶段**：
   - 默认：1 张正面图 → `primary_url` + `primary_local_path` + `view_status: "single"`
   - 多视角 ack 后：T13 生成 1 张宫格图（如 9 宫格 3×3 布局）→ `multiview_grid_url` + `multiview_grid_layout` + `multiview_grid_generated_at` + `view_status: "multiview-completed"`
3. **video 阶段**：从 `project.json.notes.product_metadata.<产品名>` 读 product_ref（**优先** `multiview_grid_url`，fallback 到 `primary_url`）→ 作为 `video_generate.images[0]`
4. **失败回退**：多视角失败 → `view_status: "multiview-failed"`，video 自动回退 single，不阻断

**为什么 opt-in**：80% 项目 1 张正面图足够；强制多视角 = 增加 token + 1 张图生成时间 + 资产体积膨胀。

**为什么是单张宫格图**（不是多张分图）：一次 `image_generate` 调用 → 1 张 HTTPS URL；video 阶段 `images[]` 上限 5，宫格图省名额给人物 / 场景 / logo；model 端视觉锚更连贯。

完整规范：`references/mcp-usage-guide.md §1.6`（触发条件）+ `references/output-conventions.md §2.1`（JSON schema）+ `references/mcp-call-templates.md §3 T13`（调用模板）+ `references/widget-templates.md §6.6`（可视化）。

## JSON metadata 扩展

产品图元数据**统一存 `project.json.notes.product_metadata.<产品名>` 子对象**——**不**新建独立 JSON 文件（避免双源风险）。schema：

```json
{
  "primary_url": "<HTTPS URL>",
  "primary_local_path": "<workspace>/creative-video-suite/<project>/04_assets/product-refs/<产品名>.png",
  "view_status": "single" | "multiview-pending" | "multiview-completed" | "multiview-failed",
  "multiview_grid_url": "<HTTPS URL>",         // 仅多视角生成后填
  "multiview_grid_layout": "3x3" | "2x3" | "2x2",  // 仅多视角生成后填
  "multiview_grid_generated_at": "<ISO timestamp>"  // 仅多视角生成后填
}
```

完整 schema + 读侧 / 写侧契约见 `references/output-conventions.md §2.1`。

## 路由边界

| 关键词命中 | 路由到 |
|---|---|
| TVC / 商业广告大片 / 品牌广告 / 4A 广告 | **tvc-director** |
| 短剧 / 剧情 / 微电影 / 动画 / 动态漫 / 预告片 / UGC / 企业宣传 / 商务视频 | **creative-video-suite** |
