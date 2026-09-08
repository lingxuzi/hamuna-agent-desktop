# Creative Video Suite · 综合剧情视频创作套件

**name**: `creative-video-suite`
**适用场景**: 短剧 / 微电影 / 动画 / 动态漫 / 预告片 / UGC 口播 / 企业宣传 / 商务视频
**模型绑定**: `agnes-image-2.5-flash` + `agnes-video-2.5-flash`
**后端**: `multimedia-creator` MCP（`hosted_mcps/agnes-video-25`，agnes 国内版 `https://api.agnes-ai.cn/v1`）

> 商业广告大片请走 `bundled-skills/tvc-director/`（TVC 专用）。本 skill 专攻有完整故事线的剧情内容与商业短视频。

## 目录结构

```text
creative-video-suite/
├── SKILL.md                        # 主入口（planner / 路由 / 输出约定）
├── README.md                       # 本文件
└── references/
    ├── agnes-ai-api.md             # multimedia-creator MCP 工具参考
    ├── output-conventions.md       # 输出目录 / project.json / 落盘时机 / 商业 3 路差异
    ├── drama/
    │   ├── scriptwriter.md         # 剧本创作
    │   ├── storyboard.md           # 分镜切分
    │   ├── assets.md               # 资产设定（角色 / 场景 / 道具）
    │   ├── frame.md                # 关键帧生成
    │   └── prompt.md               # 视频提示词与生成
    └── commercial/
        ├── ugc-talking-video-ref.md             # UGC 口播
        ├── product-marketing-ad-video-no-storyboard-ref.md  # 产品营销无分镜
        └── corporate-business-video-ref.md      # 企业宣传 / 商务视频
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

## 路由边界

| 关键词命中 | 路由到 |
|---|---|
| TVC / 商业广告大片 / 品牌广告 / 4A 广告 | **tvc-director** |
| 短剧 / 剧情 / 微电影 / 动画 / 动态漫 / 预告片 / UGC / 企业宣传 / 商务视频 | **creative-video-suite** |
