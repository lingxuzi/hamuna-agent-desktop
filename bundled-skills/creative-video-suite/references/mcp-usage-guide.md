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

### 1.2 必传图类型（默认 1 张正面图 + 可选多视角）

**默认路径（80% 场景）**：**1 张正面 / 包装图必传**——作为产品识别 + 一致性锚点。

```text
04_assets/product-refs/<产品名>.png  ← 默认单图（正面图）
```

| 类型 | 用途 | 是否默认 |
|---|---|---|
| **正面 / 包装图** | 产品识别 + 一致性锚点 | ✅ 默认 1 张必传 |
| **侧面 / 背面** | 立体感 + 细节还原（多角度镜头需要） | ❌ 仅多视角调性触发（§1.6） |
| **细节特写**（logo / 纹理 / 关键卖点） | 视频特写镜头锚点 | ❌ 仅多视角调性触发（§1.6） |
| **使用场景图**（可选） | 让模型理解产品在真实环境的呈现 | ❌ 仅多视角调性触发（§1.6） |

**最少 1 张正面图必传**。多视角（侧 / 背 / 细 / 顶）生成是 **opt-in**（planner 阶段判定调性为 360° reveal / 多角度展示 / 产品 9 宫格 才触发），详见 §1.6。**不**强制 3 张以上——避免 universal cost（80% 场景用不到 1 张以上的多角度）。

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

### 1.6 多视角产品图（opt-in，仅 360° reveal / 多角度调性触发）

**2026-09-09 user 锁定**：多视角产品图是**单张宫格图**（1 张图含 N 个角度），**不是**多张分图。本节描述单张宫格图生成流程。

**为什么 opt-in**：5 分支（drama / UGC / Marketing / Corporate）中只有 Marketing "360° reveal" 调性真正需要多视角——强制生成 = 增加 token + 1 张图生成时间 + 资产体积膨胀，但 80% 场景用不到。

**触发条件**（满足任一即 AI 在确认摘要中询问用户）：

| 触发信号 | 典型关键词 |
|---|---|
| 调性需求 | "360° 产品展示" / "多角度 reveal" / "产品 9 宫格" / "全景产品图" / "产品旋转动画" / "产品特写镜头多角度" |
| shot 类型需求 | 同 segment 有 ≥ 3 个不同角度的产品镜头（如 reveal + packshot + 特写 三角度切换） |
| 用户明示 | 用户明确说"要多个角度的产品图" |

**触发动作**（planner 或 assets 阶段）：

1. AI 在确认摘要中**明示**："本项目涉及多视角产品图，是否需要预生成 1 张多视角宫格图（如 9 宫格 3×3 布局，1 张图含 9 个角度）？如不生成，video 阶段只能用单一 `primary_url` 作 product_ref"
2. 用户 ack → 触发 T13 `image_generate_multiview_grid` 模板（详见 `mcp-call-templates.md §3 T13`），1 张宫格图生成完成后落 `project.json.notes.product_metadata.<产品名>.multiview_grid_url` + `multiview_grid_layout: "3x3"` + `view_status: "multiview-completed"` + `multiview_grid_generated_at`
3. 用户跳过 → 走默认 single 路径（`view_status: "single"`）

**video 阶段如何使用宫格图**：

- `video_generate.images[0] = product_metadata.<产品名>.multiview_grid_url`（**仍是 1 张图**作 product_ref，但宫格内含 9 个角度，model 端一次性看到多角度产品特征）
- 比 5 张分图的好处：(1) 节省 `images[]` 名额给人物 / 场景 / logo；(2) model 端视觉锚更连贯（不会因多张图风格漂移打断一致性）；(3) 上游仅 1 次 image_generate 调用，token / 时间 / 资产体积远低于 5 张分图

**何时不触发**（明确不生成多视角）：

- 商业分支：UGC（产品只在主播手中出现，1 张正面图足够）/ Corporate（产品图仅作 logo+IP 配角，1 张足够）
- drama：产品道具特写（1 张产品图作特写镜头的 anchor）
- text / keyframe 模式的 video：不需要多张产品参考图

**失败回退**（CLAUDE.md 精神：失败停下但**不**阻断下游）：

- 宫格图生成失败 → `view_status: "multiview-failed"`（**保留** `primary_url` 作 fallback，不阻断 video 阶段）
- 宫格图整体失败 → 记 `project.json.notes.last_failure` + widget emit `assets-error-card`；video 阶段回退 single 路径（**不**触发 2-retry gate——多视角是 opt-in，失败就走 single）

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
| `image_paths[]` | ≤ 8（HTTPS URL / Data URI / 本地路径，image_edit） | hosted_mcps 客户端归一化，3 种都接；按顺序对应 `<Picture 1>` / `<Picture 2>` |
| `images[]` | ≤ 5 HTTPS URL（video.reference） | agnes 视频 API 只接受公开可访问 HTTPS URL；本地/data URI 走 `img.remit.ee` 撞 QPS；按顺序对应 `<Picture 1>` / `<Picture 2>` |
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

### 3.2 失败路径（**不得 fallback**）

| 失败点 | 处理（按 2026-09-08 锁定重试铁律） |
|---|---|
| Step 1 image_generate 失败 | retry #1 (0 微调)；retry #2 (0 微调，按 attempt 1 原样)；仍失败 → **交由用户处理**（**禁**降级到 image_edit，image_edit 必传图） |
| Step 2 image_edit 失败（转比例场景） | retry #1 (0 微调)；retry #2 (0 微调，按 attempt 1 原样)；仍失败 → **交由用户处理**（**禁**擅自"接受原图比例不一致"——必须保持目标比例契约） |
| Step 3 video_generate 失败 | **禁**降级到 text 模式（CLAUDE.md 红线）；retry #1 (0 微调)；retry #2 (0 微调，按 attempt 1 原样)；仍失败 → **交由用户处理** |
| 上一步 URL 失效（`AGNES_OUTPUT_DIR` 文件被 OS 清掉 / 上游 CDN 401） | 用 `cmd_workspace_copy_paths` 落盘的本地副本（`<workspace>/.../06_videos/segment-XX.mp4` / `04_assets/...`）反查；本地副本也没了 → 重新跑上游工具（不算失败重试，是数据恢复） |

**硬禁止 fallback（任何 attempt 都不允许）**：
- ❌ 删 `images[]` 中任何一个 ref 元素
- ❌ 改 `mode`（reference ↔ keyframe ↔ text）
- ❌ 把 product_ref 退化成纯文本描述
- ❌ 切换工具（image_generate 失败 → image_edit；反之亦然）
- ❌ 改换模型供应商 / Runtime
- ❌ 简化 prompt（去 negative block / 删 ref 引用 / 删 style_anchor）
- ❌ 用上一步产物 URL 重复当新图喂回去（避免 hallucination 累积）

### 3.3 partial success 处理（多 segment 视频）

5 段视频场景下，3 段成功 + 2 段失败的"半成品"：

```text
1. 成功的 segment 立刻 cmd_workspace_copy_paths 落盘 + 写 segment-XX.md
2. 失败的 segment 不落盘（但 prompt / params / 三次 attempt 错误码写到 project.json.notes 方便用户接手）
3. 单 segment 失败 → retry #1 → retry #2（同 params；不得 fallback；**0 微调**，按 attempt 1 原样重试）
4. 单 segment 两次重试仍失败 → 标记 failed，**交由用户处理**（不自动全段重试，撞二次 quota）
5. 多 segment 同时失败（≥ 50%）→ 立即停下，**交由用户处理**（疑似配额撞顶或网络问题）
```

**`project.json.notes` 字段记录**（status 四态 + 时间戳 + attempt 计数 + 错误码）：

```json
{
  "video_segments": {
    "segment-01": {
      "status": "completed",
      "started_at": "2026-09-09T10:00:00Z",
      "finished_at": "2026-09-09T10:03:30Z",
      "attempt_count": 1,
      "url": "https://...",
      "local_path": "<workspace>/creative-video-suite/<project>/06_videos/segment-01.mp4"
    },
    "segment-02": {
      "status": "in-progress",
      "started_at": "2026-09-09T10:03:35Z"
    },
    "segment-03": {
      "status": "failed",
      "started_at": "2026-09-09T10:08:00Z",
      "finished_at": "2026-09-09T10:18:30Z",
      "attempt_count": 3,
      "last_error_code": "MCP_TIMEOUT_600s",
      "last_error_message": "agnes poll timed out after 3 attempts",
      "params": {...}
    },
    "segment-04": { "status": "pending", "params": {...} },
    "segment-05": { "status": "pending", "params": {...} }
  }
}
```

**status 四态语义**：

| status | 写入时机 | 必含字段 | 含义 |
|---|---|---|---|
| `pending` | video 阶段开始时（pre-flight 阶段） | `params` | 已规划未启动 |
| `in-progress` | 调 `video_generate` **之前**（pre-call 阶段） | `started_at` | MCP 调用已 fire，阻塞等内部 poll 返回 |
| `completed` | MCP 调用成功返回 **之后**（post-call 阶段） | `started_at` + `finished_at` + `attempt_count` + `url` + `local_path` | 视频已落盘到 workspace |
| `failed` | 2-retry 撞墙 **之后**（post-call 阶段） | `started_at` + `finished_at` + `attempt_count` + `last_error_code` + `last_error_message` + `params` | 交用户处理（不自动重试，撞二次 quota） |

**字段约定**：
- `started_at` / `finished_at`：ISO 8601 UTC（与 `project.json.created_at` / `updated_at` 同格式）
- `attempt_count`：成功 = 1（首次即过）；失败 = 实际 attempt 数（1 / 2 / 3）
- `last_error_code`：MCP 层错填 `MCP_TIMEOUT_600s` / `MCP_SPAWN_FAILED`；业务层错填 `AGNES_429_QUOTA` / `AGNES_401_AUTH` / `AGNES_500_SERVER`；状态层错填 `AGNES_TASK_FAILED`
- `last_error_message`：人类可读的错误描述（widget error 占位 + 用户接手诊断用）

**widget 中的失败展示**：`video-segment-list` widget（见 `references/widget-templates.md` §6）对失败的 segment **不**消失，**红色边框 + ⚠️ + 错误摘要 + retry 提示**——用户在 widget 里就看到失败（不需要翻 chat 历史）。失败的 segment 不阻断后续成功的 segment 落盘 + 写 `segment-XX.md` + widget emit。

### 3.4 video 阶段 4 步硬门控（serial + state machine，2026-09-09 加）

**为什么需要**：MCP `video_generate` 内部已 poll（5s / 600s，详见 `references/agnes-ai-api.md`），AI 视角下"轮询" = **project.json 状态机的 `in-progress` 中间态同步**（CLAUDE.md 红线禁 busy-wait，AI 不主动轮询 MCP）；多 segment 场景下"不要并发" = **段间串行 + 段内串行**（单批 ≤ 2 是数量上限，**不**是并发起跑 2 个 MCP 调用）；"避免限流" = 段间冷却建议 + MCP 内部 429 退避 + `AGNES_API_KEYS` 多 key fallback 三层防御（SKILL 层只补"段间冷却"，不重复造 MCP 已做的轮子）。

**video 阶段 MUST 严格按 4 步执行（顺序不可换、不可跳）**：

```text
1. pre-flight   cat project.json → 验证 current_stage ≥ "frame" + notes.video_segments 无 in-progress 残留 + notes.video_segments[<id>].required_assets[] 全部 asset_status === "ready"
2. pre-call     cmd_write_workspace_file 写 notes.video_segments[<id>].status = "in-progress" + started_at
3. serial-call  一次调一个 video_generate（不并发起跑 2 个 MCP call）；段间 sleep 2-5s
4. post-call    cmd_write_workspace_file 写 status = "completed"/"failed" + finished_at + attempt_count + (url/local_path | last_error_code/message) + 把 video CDN url 回写到 required_assets[].asset_url_consumed[]
```

**Step 1 pre-flight 检查项**（必须全过）：

```text
[ ] current_stage ∈ { "frame", "video" }（video 阶段开始时 ≥ frame）
[ ] notes.video_segments 不含 status = "in-progress" 的 segment
    → 若有：上 session 异常退出卡住，必须先标 failed + 写 last_error_code = "PREVIOUS_SESSION_CRASH"
    → 避免本次启动后"看起来在跑"但实际没人 fire
[ ] 本次要生成的 segment 不存在 status = "completed" 且 local_path 文件实际存在
    → 若已存在：用户拍板（"重跑 / 跳过 / 用 _v2 后缀"）后才推进
[ ] notes.video_segments[<id>].required_assets[] 全 ready 检查（2026-09-09 加，H1）
    → 任意 asset_status !== "ready" → 停下问用户补生成
    → 字段 schema + asset_type 枚举 + asset_status 四态见 `references/output-conventions.md §2.2`
    → 4 路（drama / ugc / marketing / corporate）asset 来源差异决策表见 `references/output-conventions.md §5`
[ ] recipe 三件套必填检查（2026-09-09 加，H1 续）
    → 每个 required_assets entry 必须有 `generation_prompt` + `mcp_tool_name` + `tool_params` 三件套（不论 asset_status）
    → 任意字段缺失 → 停下问用户补 recipe（不是自动补——避免 AI 自由发挥 prompt 与原意漂移）
    → 用途：跨 session 续跑 / 重生成 / widget 展示 prompt / 用户审视 recipe
    → 详见 `references/output-conventions.md §2.2` 字段说明表 + 写侧契约 recipe 三件套必填
```

**Step 2 pre-call 写入**：调 MCP 之前 `cmd_write_workspace_file` 落 status="in-progress" + started_at——这是"轮询状态"的语义落点（MCP 内部 poll 不暴露，AI 用 project.json 状态机模拟）。

**Step 3 serial-call 契约**：
- **段内串行**：1 个 video_generate = 1 次 MCP 调用 = 阻塞等内部 poll 返回（不等完不能 fire 下一段）
- **段间串行**：上一段 completed/failed 落盘后才推进下一段
- **段间冷却**：2-5s（不强制；MCP 内部 429 退避兜底；冷却是建议，不是硬闸）
- **单批 ≤ 2 是数量上限**：drama 默认 6 段 / UGC 1-3 段 / Marketing 1 段 / Corporate 2-4 段都是多段；**不**是一次起 N 个 MCP 调用并行

**Step 4 post-call 写入**：
- 成功 → `status="completed"` + `url`（MCP 返回的 video_url） + `local_path`（cmd_workspace_copy_paths 落盘路径） + `finished_at` + `attempt_count=1`
- 失败 → `status="failed"` + `last_error_code` + `last_error_message` + `finished_at` + `attempt_count`（实际次数，含 retry） + `params`（方便用户重试时直接复制）
- 立刻调 cmd_workspace_copy_paths 落盘 + 写 segment-XX.md + emit video-segment-list widget（**不**等全部段完成才 emit，追加模式见 `references/drama/prompt.md` §Widget emit）
- **回写 required_assets**（2026-09-09 加）：成功 → 在 `notes.video_segments[<id>].required_assets[]` 每个元素的 `asset_url_consumed[]` 数组 push 当前 video 的 `video_url`（即该 asset 实际被哪个 segment 消费）；方便后续 widget 显示 asset 引用链路 + 跨集续跑时定位"被消费过的 asset"。**不**写 asset_status（保持 ready，不动），只追加消费记录。

**全部 segment 完成后**：单独一次 `current_stage = "video"` + `stages_completed` append `"video"` + `updated_at` 刷新（**不**在每段 post-call 都推 current_stage，避免 AI 跨 session 续跑误判"video 阶段已完成"）。

**为什么不自己后台 fire + 主动 poll MCP**：
- MCP `video_generate` 是阻塞返回（一次调用 30s-10min），CLAUDE.md pit-of-success 红线明禁同步 busy-wait
- MCP 没暴露 status query 端点，`AGNES_API_KEYS` 多 key fallback 状态也不可查
- "轮询"语义必须在 SKILL 层落地为 project.json 状态机的 `in-progress` 中间态，而不是真的循环 query

**为什么段间冷却只建议不强制**：
- MCP 内部 429 退避已存在（`references/agnes-ai-api.md` 错误处理表）
- `AGNES_API_KEYS` 多 key fallback 已自动切（`extended_buildin_mcp/mcp.json:35`）
- SKILL 层硬闸 = 与 MCP 内部退避双重等待 + 用户体感变慢；建议 = 软引导 + 不破坏现有保护

**drama 与 commercial 共享**：4 步硬门控对 drama / ugc / marketing / corporate 全适用；商业 3 路若分段（long_video_stitch_mode N 段）同样走 4 步。

---

## 4. 失败处理与降级禁止

### 4.1 错误分类

| 错误类型 | 来源 | 处理 |
|---|---|---|
| **MCP 层错**（工具 spawn 失败 / poll timeout） | MCP wrapper / `multimedia-creator` server | retry #1 → retry #2；仍失败 → 交由用户处理（网络 / MCP 配置问题） |
| **业务层错**（agnes API 返回 4xx / 5xx） | agnes 国内版 API | 401 → 永久禁；400 → 检查 params；429 → 工具内部退避后重试；500 → retry #1 → retry #2 → 交由用户 |
| **状态错**（返回 `failed` 状态） | 任务执行失败（模型层） | retry #1 微调 prompt；retry #2 微调 prompt（**禁**降级 mode / 删 ref）；仍失败 → 交由用户 |

### 4.2 重试边界（2026-09-08 锁定铁律）

- **单次工具调用**：最多重试 2 次（共 3 次 attempt：1 initial + 2 retries）
- **retry #1 / retry #2 允许的微调**：修字句 / 补具体视觉描述 / 改 aspect_ratio 候选（**禁**改 mode / 删 ref / 切工具 / 简化 prompt）
- **2 次重试后仍失败**：立即停下，**交由用户处理**；把三次 attempt 的 prompt + 错误码 + URL 映射写到 `project.json.notes.last_failure`；widget emit 失败卡；**不**输出"已生成"等措辞
- **不引入 backoff 调度**：CLAUDE.md pit-of-success 红线"同步 busy-wait"（`Atomics.wait` / spin / `while Date.now()`）禁止；MCP 工具内部自带退避（见 agnes-ai-api.md 错误处理表 "429 Too Many Requests → 工具内部退避重试"）

### 4.3 降级禁止（**任何 attempt 都不允许 fallback**，2026-09-08 升级）

**禁止**为了绕过失败擅自降级（任一项违反 → 该 attempt 作废，按"交由用户"流程走）：
- ❌ video_generate keyframe 失败 → 降级 text 模式（**必保持 keyframe**；失败停下）
- ❌ video_generate reference 失败 → 降级 text 模式（**必保持 reference**；失败停下）
- ❌ video_generate reference 失败 → 删 `images[]` 元素（**必保持所有 ref**；失败停下）
- ❌ image_generate 失败 → 降级 image_edit（image_edit 必传图，零图编辑没有意义）
- ❌ image_edit 失败 → 降级 image_generate（损失参考图锚点）
- ❌ prompt 失败 → 删 negative block / 删 ref 引用 / 删 style_anchor
- ❌ 上一步 URL 失效 → 用上一步产物 URL 重复当新图喂（避免 hallucination 累积）

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

**调用前自检（每条 MCP 调用前必过，14 项 gate）**：

```text
[ ] (0) 产品图门控过吗？（涉及产品 → 用户上传 + 落 product-refs/）
[ ] (1) 输入源按工具拆分：image_edit 字段（image_paths / mask_path）允许 HTTPS URL / Data URI base64 / 本地路径；video_generate 字段（images[] / first_frame / last_frame）**只** HTTPS URL
[ ] (2) prompt 是中文吗？（枚举值 / 参数键 / 数值字面量保留英文）
[ ] (3) mode 与 params 互斥吗？（text 无图 / keyframe 有 first_frame / reference 有 images[]）
[ ] (4) size / seconds / aspect_ratio 取值在合法范围吗？
[ ] (5) first_frame 比例与 aspect_ratio 一致吗？（不一致先 image_edit 转比例）
[ ] (6) images[]（video_generate）是 HTTPS URL；image_paths[]（image_edit）按 (1) 允许 3 种
[ ] (7) style_anchor 一字不差贯穿吗？（与 project.json.style_anchor 对齐）
[ ] (8) 上一步 URL 已记到 project.json.notes <file_path> → <https_url> 映射了吗？（**产品图必落到 `notes.product_metadata.<产品名>.primary_url`**；多视角宫格图完成后填充 `multiview_grid_url` + `multiview_grid_layout` + `view_status: "multiview-completed"`，详见 `output-conventions.md §2.1`）
[ ] (9) 失败重试 ≤ 2 次？超 2 次 → 停下，【交由用户处理】（禁止继续重试 / 自主改 prompt / 自作主张）
[ ] (10) 任何失败【不得 fallback】（不降级 mode、不删 images[] 元素、不改 product_ref 到 text、不简化 prompt、不切 mode 跳过 ref、不擅自换工具）
[ ] (11) 【硬编码铁律】涉及 ref 的生成走对应 T 编号模板吗？images[] 顺序按 mcp-call-templates.md §0.4 排吗？negative block 已嵌入吗？
[ ] (12) video_generate `seconds` 字符串值 ∈ {`"4"`, `"5"`, `"6"`, `"7"`, `"8"`, `"9"`, `"10"`, `"11"`, `"12"`}？完整约束见 `references/agnes-ai-api.md §视频时长边界（单一权威）`
[ ] (13) image_generate 已显式传 `ratio:` 吗？按 SKILL.md「🔒 image_generate ratio 分支默认表」选值（drama 9:16 / Marketing 9:16 / UGC 9:16 / Corporate 16:9；Marketing 平台例外见 product-marketing-ad-video-no-storyboard-ref.md §平台→比例）？MCP 兜底默认 1:1 是图锁 1:1 的直接来源，**不**依赖 MCP 默认
```

14/14 全过才允许调 MCP 工具。**任何一项不过 = 该阶段未完成**，必须停下补做。**项 (11) 的具体模板与强制参数体**见下一节「§8 硬编码 MCP 调用模板入口」。**项 (12) 的 9 合法值集合 / 双重约束（4-12 字符串）/ 各分支锁定策略**见 `references/agnes-ai-api.md §视频时长边界（单一权威）`。**项 (13) 的分支默认表 + Marketing 平台例外 + 单一权威**见 `SKILL.md`「🔒 image_generate ratio 分支默认表（单一权威 · 2026-09-09 加）」。

---

## 8. 硬编码 MCP 调用模板入口

> **2026-09-08 用户锁定**：所有需要参考图的生成**禁止 AI 自由发挥**——必须在 `references/mcp-call-templates.md` 字面照抄对应 T 编号模板，按场景选 mode / images[] 顺序 / prompt 模板 / negative block。

**入口文件**：`references/mcp-call-templates.md`（canonical，~570 行）。

**何时读**：
- 调 `image_edit` 之前 → 读 T01-T03
- 调 `video_generate` 之前 → 读 T04-T12（按 (分支 × ref 类型) 选模板）
- 调 `image_generate` 多视角产品图 → 读 T13（2026-09-09 新增，单张宫格图模板）

**强制约束**（从 §6 项 (11) 提升为铁律）：
1. **必选对应模板**：参考 §4 决策表 / mcp-call-templates.md §4 一图选
2. **images[] 顺序必按角色**：product → person → scene → logo → ip（mcp-call-templates.md §0.4）
3. **公共 block 必嵌入**：style_anchor（§0.1）+ 产品漂移负向（§0.2，涉及产品时）+ 五维物理负向（§0.3，drama video）
4. **占位符替换必填满**：所有 `{{...}}` 替换为具体值，**禁**留 `{{}}` 字面占位符进 prompt
5. **不偏离模板**：模板 prompt 结构 / negative block 不得被 AI 自由改写；如需微调只能在 retry #1 / retry #2 允许的字句范围内

**违反后果**：模板未走 / 模式自由组合 / 顺序错乱 → 产品漂移 + 角色漂移 + 跨段不一致（v0.2.15 实战已记录）；CLAUDE.md 红线"不得 fallback"已封堵任何捷径。

---

## 7. 集成清单（每阶段末落盘前自检）

见 `references/output-conventions.md` §7；本文件专注 MCP 调用，新增 4 项：

```text
[ ] product_image_gate: 用户 brief 含产品关键词 → product-refs/ 有图（否则降级模式 ack 落 project.json.notes）
[ ] mode_decision_recorded: 当前阶段 mode 选择依据落到 stage .md（如 "drama frame 阶段选 keyframe 因为有 SEG01_START 首帧图"）
[ ] template_used: 调 MCP 走的 T 编号模板（如 "video_generate: T04 video_reference_drama_product"）落到 stage .md + project.json.notes
[ ] product_metadata_recorded: 产品图元数据已写到 project.json.notes.product_metadata.<产品名>（含 primary_url + primary_local_path + view_status；多视角 opt-in 用户 ack 时还含 multiview_grid_url + multiview_grid_layout + multiview_grid_generated_at），详见 output-conventions.md §2.1
```

4 项 + output-conventions.md §7 八项 = 12 项集成清单。