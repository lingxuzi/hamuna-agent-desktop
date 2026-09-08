# MCP Usage Guide · multimedia-creator 调用正确性

**何时读**：planner 阶段（了解 MCP 工具 map）+ 每阶段调 MCP 之前（参数互斥 / 跨工具链 / 失败处理）+ 商业分支 + 涉及产品的 drama 段（产品图门控）。

> 完整 MCP 工具 schema 见 `references/agnes-ai-api.md`；输出目录 / project.json / 持久化契约见 `references/output-conventions.md`；prompt 中文铁律见 `SKILL.md`。本文件专注**调用正确性**——选哪个工具、选哪个 mode、参数怎么互斥、失败了怎么办。

---

## 1. 产品图强制门控（最高优先级，调用 MCP 之前）

**铁律**：用户 brief 含**任何**产品关键词 → AI **必须**停下追问产品图，**不进入 MCP 调用**直到产品图到位。**drama 和 commercial 同级强门控**，无差别。

### 1.1 触发关键词（命中即触发门控）

| 关键词类型 | 示例 |
|---|---|
| 品牌名 | "iPhone" / "可口可乐" / "小米 SU7" / "戴森吹风机" / "茅台" |
| 通用商品词 + 修饰 | "那个 XX 牌的手机" / "主角开的车" / "桌上的咖啡机" |
| 行业广告剧情信号 | "广告剧情" / "品牌植入" / "赞助商品" / "甲方指定" |
| 中英文产品词 | "产品" / "product" / "商品" / "包装" / "品牌" / "SKU" / "货品" |

### 1.2 必传图类型

| 类型 | 用途 |
|---|---|
| **正面 / 包装图** | 产品识别 + 一致性锚点 |
| **侧面 / 背面** | 立体感 + 细节还原 |
| **细节特写**（logo / 纹理 / 关键卖点） | 视频特写镜头锚点 |
| **使用场景图**（可选） | 让模型理解产品在真实环境的呈现 |

**最少 1 张正面图必传**；建议 3 张以上（正 / 侧 / 细）覆盖 video 镜头需求。

### 1.3 流程

```text
用户 brief 含产品关键词
    ↓
AI 停下：要求用户上传产品图（具体说明要几张、什么角度）
    ↓
用户提供 → AI 检查（正 / 侧 / 细节至少 1 张到位才放行）
    ↓
AI 落盘产品参考图：<workspace>/creative-video-suite/<project>/04_assets/product-refs/<产品名>.{jpg,png}
    ↓
进入 MCP 调用（image_generate / image_edit / video_generate.mode="reference" 都可用产品图作参考）
```

### 1.4 降级路径（用户**显式 ack**）

如果用户**明确**说"我没有产品图 / 无参考直接生成 / 按概念 brief 生成"：

1. AI **必须**在确认摘要中**明示**：
   > ⚠️ 降级模式：本项目无产品图参考。产品外观、包装、品牌 logo、企业视觉不保证真实一致。如有真实产品需求请上传产品图。
2. 落 `project.json.notes`：标注 `product_image_gate: "bypassed-by-user"` + 时间戳 + 用户原话
3. **仍然**可以调 MCP 生成（用 text 模式 + 产品描述 prompt），但 AI 必须接受结果与用户期望的产品可能不一致

### 1.5 drama 与 commercial 强门控差异

| 分支 | 门控强度 | 范围 |
|---|---|---|
| **drama** | 强门控 | 仅对涉及产品的片段 / 场景 / 道具触发；其他剧情段不受影响 |
| **commercial UGC** | 强门控 | 全项目门控（产品是核心） |
| **commercial Marketing** | 强门控 | 全项目门控 |
| **commercial Corporate** | 强门控 | 第 3 类必填信息扩展为产品图 + logo + IP + VI + 客户案例，**全必传** |

**drama 内部细分**：剧本创阶段如果用户说"我用 XX 牌手机做道具"——AI **必须**先问产品图，**不**自动用"看起来像 XX 牌"的虚构道具图代替。

---

## 2. 工具与 Mode 决策

### 2.1 MCP 工具一览

| 工具 | 用途 | 何时用 |
|---|---|---|
| `mcp__multimedia-creator__agnes25_image_generate` | 文生图（T2I） | 角色 / 场景 / 道具的初版图；**不在 image_edit 链上的所有图都走这个** |
| `mcp__multimedia-creator__agnes25_image_edit` | 图生图（I2I） + 多图合成 + 局部编辑 | 已有图基础上修改 / 拼接 / 局部编辑 / **转比例**（keyframe 比例不一致时必走） |
| `mcp__multimedia-creator__agnes25_video_generate` | 视频生成 | 5 段剧情 / UGC / Marketing / Corporate 视频；三种 mode（text / keyframe / reference） |

### 2.2 video_generate mode 决策树

```text
是否有 first_frame 图？
├── 是 → keyframe 模式
│   ├── 有 last_frame 图？ → keyframe + last_frame
│   └── 无 last_frame 图？ → keyframe 单帧驱动
└── 否 → 是否有 1-5 张参考图（含产品 / 角色 / 场景 / logo）？
    ├── 是 → reference 模式（不锁首帧，锁视觉锚）
    │   ├── 商业 ref 想要 product_ref 强锁 → reference
    │   └── drama 想要连续视觉 → reference
    └── 否 → text 模式（纯文生视频）
```

**默认**：drama 5 阶段流水线**默认 keyframe**（frame 阶段已生成首尾关键帧图）；commercial UGC **默认 text**（真人讲解无 first_frame）；commercial Marketing **默认 keyframe**（产品图作首帧）；commercial Corporate **默认 reference**（多参考图含 logo / IP / 品牌资产）。

### 2.3 Mode ↔ Params 互斥表

**调用前自检**：违反互斥 → 400 Bad Request 浪费 quota + 用户等待。

| mode | `first_frame` | `last_frame` | `images[]` | 用途 |
|---|---|---|---|---|
| **`text`** | ❌ 禁止传 | ❌ 禁止传 | ❌ 禁止传 | 纯文生视频，无参考图 |
| **`keyframe`** | ✅ **必传** HTTPS URL | ⚠️ 可选（首末帧驱动才传） | ❌ 禁止传 | 单帧 / 首末帧驱动 |
| **`reference`** | ❌ 禁止传 | ❌ 禁止传 | ✅ **必传** HTTPS URL[] ≤ 5 | 1-5 张参考图作视觉锚 |

**参数 schema 边界**：

| 参数 | 取值 | 备注 |
|---|---|---|
| `size` | `720P`（video） / `1K` / `2K` / `3K` / `4K`（image） | video **锁死 720P**；旧版 1080P / 1K / 2K 已废除 |
| `seconds` | `"4"` / `"5"` / `"6"` ... `"12"` **字符串** | **字符串**！非 int。范围 4-12 秒 |
| `aspect_ratio` | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `21:9` | 与 first_frame 比例一致（不一致先 image_edit 转比例） |
| `image_paths[]` | ≤ 8 HTTPS URL（image_edit） | 按顺序对应 `<Picture 1>` / `<Picture 2>` |
| `images[]` | ≤ 5 HTTPS URL（video.reference） | 按顺序对应 `<Picture 1>` / `<Picture 2>` |
| `audios[]` | ≤ 3 URL（video） | flash 不接受 video audio |
| `videos[]` | 0（video 2.5-flash 不接受） | flash 限制 |
| `mask_path` | URL（image_edit 局部编辑） | 仅 image_edit 接受 |

**`mask_path` 互斥**：传给 `image_generate` 或 `video_generate` 直接 400。

---

## 3. 跨工具链 URL 传递契约

### 3.1 3-step 标准链（drama 5 阶段核心链）

```text
Step 1: image_generate(prompt=T2I_keyframe_prompt)
        → 返回 data[0].url = HTTPS URL（如 https://cos-platform-outputs.agnes-ai.cn/...）
        ↓
Step 2: image_edit(image_paths=[Step 1 URL], prompt=转比例或局部编辑 prompt)
        → 返回 data[0].url = 新 HTTPS URL
        ↓
Step 3: video_generate(mode="keyframe", first_frame=Step 2 URL, prompt=video_prompt)
        → 返回 video_url = HTTPS URL
        ↓
        cmd_workspace_copy_paths(video_url → <workspace>/.../06_videos/segment-XX.mp4)
```

**关键**：每一步的 URL 必须**当场**记到 `<file_path> → <https_url>` 映射（写到 `project.json.notes` 或 stage .md 头部 metadata）。session 重启 / 上一步 URL 失效时**没有这个映射就找不到原图**。

### 3.2 失败路径 fallback

| 失败点 | Fallback |
|---|---|
| Step 1 image_generate 失败 | 改 prompt 重试 1 次；仍失败 → 停下告诉用户（**禁**降级到 image_edit，image_edit 必传图） |
| Step 2 image_edit 失败（转比例场景） | 改 prompt 重试 1 次；仍失败 → **接受原图比例不一致**，video 阶段调 image_generate 重新生成一张目标比例的 keyframe 替代 |
| Step 3 video_generate 失败 | **禁**降级到 text 模式（CLAUDE.md 红线）；改 prompt / mode 重试 1 次；仍失败 → 停下告诉用户 |
| 上一步 URL 失效（`AGNES_OUTPUT_DIR` 文件被 OS 清掉 / 上游 CDN 401） | 用 `cmd_workspace_copy_paths` 落盘的本地副本（`<workspace>/.../06_videos/segment-XX.mp4` / `04_assets/...`）反查；本地副本也没了 → 重新跑上游工具 |

### 3.3 partial success 处理（多 segment 视频）

5 段视频场景下，3 段成功 + 2 段失败的"半成品"：

```text
1. 成功的 segment 立刻 cmd_workspace_copy_paths 落盘 + 写 segment-XX.md
2. 失败的 segment 不落盘（但 prompt / params 写到 project.json.notes 方便重跑）
3. 单 segment 失败 → 重试 1 次（同 params）
4. 单 segment 重试仍失败 → 标记 failed 停下问用户（**不**自动全段重试，撞二次 quota）
5. 多 segment 同时失败（≥ 50%）→ 立即停下问用户（疑似配额撞顶或网络问题）
```

**`project.json.notes` 字段记录**：

```json
{
  "video_segments": {
    "segment-01": { "status": "completed", "url": "https://...", "local_path": "..." },
    "segment-02": { "status": "completed", "url": "https://...", "local_path": "..." },
    "segment-03": { "status": "failed", "error": "MCP timeout 600s", "last_attempt_at": "...", "params": {...} },
    "segment-04": { "status": "pending", "params": {...} },
    "segment-05": { "status": "pending", "params": {...} }
  }
}
```

**widget 中的失败展示**：`video-segment-list` widget（见 `references/widget-templates.md` §6）对失败的 segment **不**消失，**红色边框 + ⚠️ + 错误摘要 + retry 提示**——用户在 widget 里就看到失败（不需要翻 chat 历史）。失败的 segment 不阻断后续成功的 segment 落盘 + 写 `segment-XX.md` + widget emit。

---

## 4. 失败处理与降级禁止

### 4.1 错误分类

| 错误类型 | 来源 | 处理 |
|---|---|---|
| **MCP 层错**（工具 spawn 失败 / poll timeout） | MCP wrapper / `multimedia-creator` server | 重试 1 次；仍失败 → 停下告诉用户（网络 / MCP 配置问题） |
| **业务层错**（agnes API 返回 4xx / 5xx） | agnes 国内版 API | 401 → 永久禁；400 → 检查 params；429 → 退避后重试 1 次；500 → 重试 1 次 |
| **状态错**（返回 `failed` 状态） | 任务执行失败（模型层） | 改 prompt 重试 1 次（**禁**降级 mode）；仍失败 → 停下 |

### 4.2 重试边界

- **单次工具调用**：最多重试 1 次（同 params 或微调 prompt）
- **连续 2 次失败**：立即停下问用户，不进入第 3 次
- **不引入 backoff 调度**：CLAUDE.md pit-of-success 红线"同步 busy-wait"（`Atomics.wait` / spin / `while Date.now()`）禁止；MCP 工具内部自带退避（见 agnes-ai-api.md 错误处理表 "429 Too Many Requests → 工具内部退避重试"）

### 4.3 降级禁止（CLAUDE.md 红线）

**禁止**为了绕过失败擅自降级：
- ❌ video_generate keyframe 失败 → 降级 text 模式（**必保持 keyframe**；失败停下）
- ❌ video_generate reference 失败 → 降级 text 模式（**必保持 reference**；失败停下）
- ❌ image_generate 失败 → 降级 image_edit（image_edit 必传图，零图编辑没有意义）
- ❌ image_edit 失败 → 降级 image_generate（损失参考图锚点）

**唯一允许的"降级"**：用户在确认摘要中**显式 ack** 改 mode / 改 plan（这是用户决策，不是 AI 自动降级）。

---

## 5. 命名空间对照

商业 ref 内部用的术语 ≠ MCP 参数名。AI 必须知道映射关系：

| 命名空间 | 含义 | 出现在哪 | 映射到 MCP |
|---|---|---|---|
| **`<Picture N>`** | MCP model 端多图引用语法（按 `image_paths[]` / `images[]` 顺序从 1 编号） | MCP prompt 内（`mcp__multimedia-creator__*`） | **就是 MCP 端使用的引用**，不需要映射 |
| **`@image1` / `@image2`** | ref 内部对参考图的引用（prompt 中说"@image1 是产品参考"） | `corporate-business-video-ref.md` / `ugc-talking-video-ref.md` | `images[]` 数组顺序：@image1 → `images[0]`，@image2 → `images[1]` |
| **`@product_ref`** | 商业 ref 对"产品参考图"的简称 | `corporate-business-video-ref.md:114` | `images[][0]`（产品图通常是首张） |
| **`@person_ref`** | 商业 ref 对"人物参考图"的简称 | `corporate-business-video-ref.md:120` | `images[][1]`（产品图后） |
| **`ref_images`** | 商业 ref 内部参数名（不是 MCP 参数） | `ugc-talking-video-ref.md:21-26` | **不直接传给 MCP**；商业 ref 内部先展开成 `images[]` 数组再调 MCP |

**映射示例**：

```text
# ugc-talking-video-ref.md 内部：
ref_images = [@product_ref, @creator_ref]   # @product_ref = 产品图, @creator_ref = 主播图

# 最终 MCP 调用：
mcp__multimedia-creator__agnes25_video_generate({
  mode: "reference",
  images: [
    "https://.../product.png",  # 来自 @product_ref（产品参考）
    "https://.../creator.png"   # 来自 @creator_ref（主播参考）
  ],
  prompt: "@image1 是产品参考（严格保持外观）；@image2 是主播参考（保持面部和服装）；主播手持产品展示..."
})
```

---

## 6. Per-Stage Per-Type MCP Tool Map

每个阶段每个分支用什么工具，一张图看全：

| 阶段 | drama | commercial UGC | commercial Marketing | commercial Corporate |
|---|---|---|---|---|
| **planner** | 不调 MCP | 不调 MCP（先产品图门控） | 不调 MCP（先产品图门控） | 不调 MCP（先 4 类必填信息门控含产品图） |
| **script** | 不调 MCP | (跳过) | (跳过) | (跳过) |
| **storyboard** | 不调 MCP | 不调 MCP | 不调 MCP | 不调 MCP |
| **assets** | `image_generate`（角色 / 场景 / 道具，含产品类道具必走产品图门控） | `image_generate`（**必传产品图**）+ `image_edit`（可选改比例 / 局部） | `image_generate`（**必传产品图**） | `image_generate`（logo / IP / 品牌资产 / 产品图）+ `image_edit` |
| **frame** | `image_generate` + `image_edit`（**转比例必走**） | (跳过) | (跳过) | (跳过) |
| **video** | `video_generate`（**默认 keyframe**） | `video_generate`（**默认 text**） | `video_generate`（**默认 keyframe**） | `video_generate`（**默认 reference**） |

**调用前自检（每条 MCP 调用前必过）**：

```text
[ ] (0) 产品图门控过吗？（涉及产品 → 用户上传 + 落 product-refs/）
[ ] (1) 输入源是 HTTPS URL 吗？（本地路径 / base64 / file:// 全禁止）
[ ] (2) prompt 是中文吗？（枚举值 / 参数键 / 数值字面量保留英文）
[ ] (3) mode 与 params 互斥吗？（text 无图 / keyframe 有 first_frame / reference 有 images[]）
[ ] (4) size / seconds / aspect_ratio 取值在合法范围吗？
[ ] (5) first_frame 比例与 aspect_ratio 一致吗？（不一致先 image_edit 转比例）
[ ] (6) image_paths[] / images[] 全是 HTTPS URL 吗？（不是本地路径）
[ ] (7) style_anchor 一字不差贯穿吗？（与 project.json.style_anchor 对齐）
[ ] (8) 上一步 URL 已记到 project.json.notes <file_path> → <https_url> 映射了吗？
[ ] (9) 失败重试不超过 1 次吗？（不撞二次 quota）
[ ] (10) 不降级 mode 吗？（CLAUDE.md 红线）
```

10/10 全过才允许调 MCP 工具。**任何一项不过 = 该阶段未完成**，必须停下补做。

---

## 7. 集成清单（每阶段末落盘前自检）

见 `references/output-conventions.md` §7；本文件专注 MCP 调用，新增 2 项：

```text
[ ] product_image_gate: 用户 brief 含产品关键词 → product-refs/ 有图（否则降级模式 ack 落 project.json.notes）
[ ] mode_decision_recorded: 当前阶段 mode 选择依据落到 stage .md（如 "drama frame 阶段选 keyframe 因为有 SEG01_START 首帧图"）
```

2 项 + output-conventions.md §7 八项 = 10 项集成清单。