# UGC MCP 调用模板（T06 / T12 / T13）

> **完整模板见** `bundled-skills/creative-video-suite/references/mcp-call-templates.md` §T06/T12/T13。本文件只放**精简执行版**——执行 UGC 视频生成时直接复制填占位符。

## 升级路径（铁律）

| 用户输入 | 走的模板 | 原因 |
|---|---|---|
| 上传了主播图（creator_ref）+ 上传了产品图 | **T06 video_reference_ugc** | 双锚锁脸 + 锁产品 |
| 上传了主播图 + **未上传产品图** | **T06 + 文字描述产品**（禁止）→ 走 T12 | T12 允许无产品图，但需 ack |
| 未上传主播图 + 上传了产品图 | **T12 video_text_ugc_default** | 文字生成主播脸（不锁脸） |
| **完全无图** | **T12 video_text_ugc_default** | 纯文生口播，prompt 文字描述主播 + 产品（外观可能漂移） |

**禁止**：
- ❌ T06 + 用户未上传主播图（reference mode 必传图）
- ❌ T12 + 用户已上传产品图（浪费产品图锁不住产品外观）
- ❌ 失败后切换 mode（T06 → T12 或 T12 → T06）→ 走失败重试 2 次停下问用户

---

## T06 · video_reference_ugc（首选）

**用途**：产品图 + 主播图双锚，锁脸 + 锁产品。

```python
mcp__multimedia-creator__agnes25_video_generate(
    prompt=<shots_script_full>,                # 必含 10 块名（§10）
    mode="reference",                          # 必 reference
    images=[                                   # ⚠️ 单元素数组！多元素会被 harness 序列化成 dict 失败
        "<product_ref_url>",                   # 产品参考图 URL（用户上传 / image_generate 输出）
    ],
    seconds="12",
    size="720P",
    aspect_ratio="9:16",
    output_filename="seg01_ugc.mp4"
)
```

**images 必传**：
1. `product_ref_url`（产品图；2+ 张则先用 contact sheet 合成 1 张 → 单元素）
2. **可选**：creator_ref（若需锁脸）；产品图单元素已能锁产品，但主播脸仍可能漂移

**prompt 必含**：
- `Monologue`: `{完整口播台词}`（仅声音/口型，不进画面文字）
- `Creator description`: 主播身份锚点（模板/性别/肤色/发色/服装/年龄 五维固定）
- `Product name` + `Selling points`: 产品名 + 3 个核心卖点
- `Shots description`: Cut1 hook 0-2s / Cut2 产品证明 2-5s / Cut3 反馈 5-9s / Cut4 packshot+CTA 9-12s
- `Style & Mood`: 真实感强 / 自然光 vlog / UGC scroll-stopping
- `Narrative Summary`: 痛点 → 产品 → 反馈 → CTA 4 步叙事弧
- `Dynamic Description`: 正在说话 + 口型同步 + 表情和动作（**不**写完整台词文本）
- `Static Description`: 镜头构图 / 光线 / 场景布局
- `Audio`: BGM + SFX + 配音人声说明
- `Constraints`: 硬负向末尾模板（见 ugc-talking-video-ref.md §11）

**subtitle_policy 强制**：
- 视频 prompt **不含** "Subtitle / MANDATORY BOTTOM / Caption" 等字幕关键词
- 口播台词**仅**用 `{具体台词}` 包裹，进 Monologue / Audio 字段
- 重点花字（≤2 次、2-6 字）进 `emphasis_text` 字段，**不**进视频 prompt
- drawtext 后处理字幕在 UGC 默认 **off**（subtitle_policy = off）；若用户显式要字幕，按 §6 drawtext 公式 + 4 句公式（12s 用 1-2 句即可）

---

## T12 · video_text_ugc_default（无图降级）

**用途**：纯文生口播，用户未上传任何图。主播脸 + 产品外观全靠 prompt 文字。

```python
mcp__multimedia-creator__agnes25_video_generate(
    prompt=<shots_script_full>,                # 必含 10 块名（同 T06）
    mode="text",                               # 必 text
    # 不传 images=[]
    seconds="12",
    size="720P",
    aspect_ratio="9:16",
    output_filename="seg01_ugc.mp4"
)
```

**降级条件**（必须满足 1 条）：
1. 用户**明确表示**"没有产品图/主播图"
2. 用户**未上传**任何图片 + `project.json.notes.product_image_gate: "bypassed-by-user"`

**prompt 必加 2 句**（产品/主播视觉保真）：
```
product_visual_lock: <产品名> 外观必须 = <品牌/包装/SKU/材质/颜色详描>，禁止修改包装、禁止假 logo、禁止新增标签
creator_visual_lock: 主播 = <5 维身份锚点>（模板 + 性别 + 肤色 + 发色 + 服装主色 + 妆造），跨镜头字面一致
```

**失败模式预告**（T12 vs T06）：
- T12 主播脸可能**轻微漂移**（不同镜头脸型/发色轻微变）→ 接受（UGC 真实感不强求）
- T12 产品外观可能**轻微漂移**（不同镜头包装/颜色轻微变）→ 接受 if 用户已 ack
- 若用户要求严格锁脸/锁产品 → **必须**升级到 T06 + 让用户上传图

---

## T13 · image_generate_multiview_grid（opt-in · 特殊触发）

**用途**：产品 360° reveal / 多角度 packshot / 宫格展示。

**触发条件**（满足任 1 才调）：
1. 用户要求"产品 360° 旋转 / 多角度展示"
2. 段结构含 `Cut4 packshot+CTA` 且产品视觉变化要求高
3. 多 SKU 一次性展示（如 3 色口红 / 5 件套礼盒）

```python
mcp__multimedia-creator__agnes25_image_generate(
    prompt="<产品名> 多视角宫格：<角度列表>，<风格>，<背景>。<产品外观锁定描述>。",
    num_images=1,                              # 单张宫格图（不是 6 张分图）
    size="2K",                                 # 2K 保证多视角清晰
    ratio="1:1",                               # 3x3 / 2x2 宫格用 1:1
    # ratio="3:4"                              # 2x3 宫格用 3:4
    output_filename="product_multiview_grid.png"
)
```

**角度列表**（典型）：
- 3x3 宫格：正面 / 左 45° / 右 45° / 顶视 / 仰视 / 包装展开 / 质地特写 / 使用中 / 包装背面
- 2x2 宫格：正面 / 左 45° / 右 45° / 包装
- 2x3 宫格：正面 / 左 / 右 / 顶视 / 仰视 / 包装

**ratio 派生规则**：
- 3x3 宫格 → `ratio="1:1"`
- 2x2 宫格 → `ratio="1:1"`
- 2x3 宫格 → `ratio="3:4"`

**prompt 必含**：
- 产品名 + 品牌 + 包装 + 颜色 + 材质 5 项外观锁定
- 宫格描述（"2x2 grid" / "3x3 grid" / "2x3 grid"）+ 角度列表
- 风格统一（与视频主风格一致）
- 背景纯净（白底 / 纯色 / 简约场景，不抢产品视觉）

**输出用**：
- T13 输出图（T13 单图） → 喂给 **T06** 作 `images[0]`（product_ref 单元素）
- 或喂给 §3.4 hero shot 作 `first_frame`

---

## 重试 SOP（3 模板共用）

| 失败次数 | 动作 |
|---|---|
| 第 1 次失败 | **等 60-120s** 单段重试，**0 微调**（prompt 不变） |
| 第 2 次失败 | 再等 60-120s 重试，**0 微调** |
| 第 3 次失败 | **停下问用户**："MCP 队列连续 3 次失败（错误信息 XXX），是否降级或调整？候选：① 等更长再试 ② 简化 prompt ③ 换 mode（仅 T12 ↔ T06） ④ 放弃本段" |

**禁止**：
- ❌ 失败后立刻换 mode（T06 → T12 或反向）——违反 §失败重试铁律
- ❌ 失败后修改 prompt（"微调"）——MCP 错误多为队列问题，prompt 没问题
- ❌ 失败后跳过本段——UGC 12s 4 段式缺一段就破坏完整叙事
- ❌ 跨段串行失败（段 1 失败 → 段 2/3 也失败）→ 检查 images[] 单元素 + 检查 prompt 是否含字幕关键词

---

## 输出归档

每次调用结果必须落 4 项：

```
04_videos/
├── segment-01.mp4                  # 视频
├── segment-01.md                   # 元数据 + emphasis_text 字段（不进视频 prompt）
├── segment-01-script.md            # 完整口播台词稿（独立文件，方便用户复制/二次创作）
└── segment-01-thumb.png            # 末帧缩略图（ffmpeg -sseof -0.1）
```

**§商业广告 §1.2 边界**：UGC ≠ 电商种草 ≠ 商品展示，三者边界见 `references/ugc-talking-video-ref.md` §2。

---

**完整模板见** `bundled-skills/creative-video-suite/references/mcp-call-templates.md` §T06/T12/T13