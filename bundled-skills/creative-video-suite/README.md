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

**每阶段生成完后 emit `<generative-ui-widget>` HTML 块**让用户在 chatui **直观看**生成内容（不是裸 URL 文本）。6 套模板：

| 阶段 | widget | 用途 |
|---|---|---|
| planner | planner-meta-card | 项目元数据 + 阶段推进状态 |
| scriptwriter | scriptwriter-summary-card | 标题 / 类型 / 角色 / 场景 / 道具清单 |
| storyboard | storyboard-shot-table | 分镜表 + 关键帧图 |
| assets | assets-image-gallery | 角色 / 场景 / 道具缩略图（追加模式） |
| frame | frame-keyframe-grid | drama 关键帧网格（追加模式） |
| video | video-segment-list | 视频列表 + 失败占位（追加模式） |

完整 HTML 模板 + 占位符替换规则见 `references/widget-templates.md`。

**诊断澄清**：creative-video-suite 的 HTTPS URL → MCP 输入是**正确**的（MCP 只接受 HTTPS URL）；问题在 MCP → chatui 输出——`src/server/utils/tool-result-attachments.ts::classifyToolAttachmentPresentation` 当前未把 `mcp__multimedia-creator__agnes25_*` 纳入包装，URL 仅以纯文本落到 chat。本 skill 通过 emit widget 块补偿。Sidecar 包装属于另一 PR follow-up。

## 路由边界

| 关键词命中 | 路由到 |
|---|---|
| TVC / 商业广告大片 / 品牌广告 / 4A 广告 | **tvc-director** |
| 短剧 / 剧情 / 微电影 / 动画 / 动态漫 / 预告片 / UGC / 企业宣传 / 商务视频 | **creative-video-suite** |
