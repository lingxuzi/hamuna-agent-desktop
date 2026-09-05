# 资产生成提示词速查表

> **唯一权威**：本文件是 tvc-director 资产阶段所有 MCP 生成调用（`agnes_image_generate` / `agnes_video_generate` / `edge-tts.text_to_speech`）的提示词 + 参考图规范**唯一来源**。
> 任何 agent SKILL.md / orchestrator 章节若与本表冲突，以本表为准。
> **版本**：1.0｜**适用范围**：tvc-director v0.3+｜**互链**：被 asset-standards.md / agnes-prompting.md / product-image-anchor.md / storyboard-style.md 引用。

## 何时使用本表

| 阶段 | 章节 | 调用类型 |
|------|------|---------|
| asset_generation（Step 4 Phase 1）| §1 产品多角度资产图 | `agnes_image_generate` |
| asset_generation（Step 4 Phase 1）| §2 短片主角三视图 | `agnes_image_generate` |
| asset_generation（Step 4 Phase 1）| §3 场景图片 | `agnes_image_generate` |
| storyboard_compilation（Step 4 Phase 2）| §4 故事板图 | `agnes_image_generate`（九宫格 / 2×2 / 首尾帧）|
| 任意节点失败 | §5 Failure Recovery | —（grilling 入口）|

---

## §1. 产品多角度资产图（`asset_generation` 第一棒）

### 1.1 Mandatory — 何时必生成

- 任何含**实体产品**（食品 / 饮品 / 3C / 美妆 / 服饰 / 工业品）的 TVC
- 主体识别度直接决定后续视角一致性的所有项目
- 跨段续作（multi-segment TVC）必须为每个产品独立生成

### 1.2 参考图输入

- **类型**：上游 brief 提供的 `product_anchor.png`（用户上传或前序 hook 抓取）
- **格式**：**base64 data URI**（直接喂 `image_paths`，**不**上传到 img.remit.ee）
- **来源**：brief card 的 `product_reference_path` 或 `inputs.product_anchor`
- **缺口处理**：缺图 → 触发 §5 failure code `missing_anchor`，grilling 用户补图

### 1.3 Prompt Template

```text
{product_name}（{category}），{core_material} 材质，{core_color} 主色，
产品锁定 {focal_angle} 视角（front 3/4 | top-down | back | side | macro-detail），
{lighting_setup} 光照，{surface_finish} 表面处理，
白底干净，{aspect_ratio}，{resolution_preset}，
禁止 Logo 改字 / 包装错印 / 比例变形 / 多余反光噪点
```

### 1.4 必生成角度清单

| 角度 | 用途 | 强制 |
|------|------|------|
| front 3/4 | 主视觉 / 故事板主角格 | ✓ |
| side profile | 旁白 / 工艺特写衔接 | ✓ |
| top-down | 食材 / 平面产品 | 视产品形态 |
| macro-detail | 包装小字 / 工艺 / 纹理 | ✓ |
| back / 三维角度 | 跨角度旋转镜头 | 视运镜需求 |

**最少 3 张**，最多 5 张；超出范围需 grilling 用户。

### 1.5 光照 + 摄影规约

- 摄影：单灯主光（45° 左前 / 45° 右前二选一），辅以柔光板，无 HDR 多源光
- 景深：产品前后景深一致，**禁止**强虚化把产品糊掉
- 色彩空间：sRGB；输出 PNG；分辨率 ≥ 2048×2048
- 焦距提示（写进 prompt）：`85mm-equivalent prime, low distortion`

### 1.6 反模式（自动 reject）

- ❌ 同一 prompt 同时塞 ≥2 个角度 → 视角混乱
- ❌ 用产品 logo 反推"应该长这样" → AI 臆造
- ❌ 多产品同框（除套餐场景）→ 主产品被稀释
- ❌ 商业摄影棚强闪（hard light）→ 包装反光噪点
- ❌ 比例变形（用 `wide-angle` / `fisheye`）→ 后续拼接不一致

---

## §2. 短片主角三视图（`asset_generation` 第二棒）

### 2.1 Mandatory — 何时必生成

- 主角为人 / 拟人化角色 / 动物吉祥物 / 有"人格"的产品代言人
- 后续视频段（Step 9）含 ≥1 段主角入镜
- 视角漂移会触发 segment-to-segment 不连续的强制重做项

### 2.2 参考图输入

- **类型**：上游 brief 的 `character_anchor.png` 或上一步 §1 输出的产品主图（若产品即主角）
- **格式**：**base64 data URI**（`image_paths`）
- **缺口处理**：缺图 → 触发 §5 failure code `missing_character_anchor`，grilling 用户补图或选择"使用 AI 凭空生成"（**此选项必须显式风险提示**）

### 2.3 Prompt Template — 三视图合版

```text
{character_name}（{character_type}），{age_or_stage}，{ethnicity_or_species}，
正面 / 左侧 90° / 背面 90° 三视图合版（左中右并排，等比例等高），
{outfit_lock}，{hair_or_fur_state}，{body_proportion}，
白底干净，16:9 横版，{resolution_preset}，
禁止换脸 / 换装 / 变身高矮 / 视角角度变化
```

### 2.4 三视图分版（高精度版）

- 三视图**合版**用一次 `agnes_image_generate`
- 高精度场景改用 3 次单图调用（front / side / back），但**每张必带同一锚图作 reference**，确保三张视觉完全锁
- 分版优先用于 CGI / 拟人角色；合版用于真人 / 常规吉祥物

### 2.5 光照 + 摄影规约

- 主光：环形光或蝴蝶光（人像通用），保证三视图光位一致
- 摄影：85mm-105mm 等效人像头，无 wide-angle 变形
- 三视图合版：每格高度相同，比例锁定 ±2% 以内
- 表情：中性表情 + 自然姿态，**禁止**戏剧化表情（会污染后续表演 prompt）

### 2.6 反模式（自动 reject）

- ❌ 三视图角度不对称（front 85° / side 70°）→ 后续运镜基准线漂移
- ❌ 服装在三视图之间变化 → 跨段服装一致性失效
- ❌ 用 `random` 关键词让 AI 自由决定年龄 / 体型 → 漂移源
- ❌ 道具在三视图出现与否不一致 → 后续镜头道具乱入
- ❌ 拟人动物保留"人性比例"过头 → 物种识别度丢失

---

## §3. 场景图片（`asset_generation` 第三棒）

### 3.1 Mandatory — 何时必生成

- 任何 TVC 含**外景**或**大型内景**（非产品 / 角色特写镜头即"环境镜头"）
- ≥1 个 segment 含明确的场景切换
- 场景概念图为后续视频的 `image` 参数（首帧）直接服务

### 3.2 参考图输入

- **类型**：brief 提供的 `scene_moodboard[]`（0-N 张）或 `style.cover_image`
- **格式**：**base64 data URI**（`image_paths`），多图按 brief 顺序排列
- **缺口处理**：moodboard 为空时，prompt 用**纯文字**描述场景（已知 risk：可能与用户脑面不一致 → **首次生成必走 §15.2 Pre-Gen Confirmation**）

### 3.3 Prompt Template

```text
{scene_name}（{scene_type}），{time_of_day}，{weather_or_atmosphere}，
{spatial_layout}（foreground / midground / background 三层），
{key_props[]}，{color_palette} 主调，
{lighting_setup} 光照（key light 方向 + 色温 + 强度），
{style_grammar}（与 selected_style 对齐），
{aspect_ratio}，{resolution_preset}，
禁止人物 / 产品 / 文字 / Logo 出现（场景图独立，不带主体）
```

### 3.4 必生成场景清单（按 segment 数）

| segment 数 | 必生成场景数 | 说明 |
|-----------|------------|------|
| 1 | 1 | 单场景 |
| 2-3 | 2 | 主场景 + 至少 1 转场场景 |
| 4-6 | 3-4 | 主场景 + 关键转场 + 收束场景 |
| ≥7 | ≥5 | 视剧本，每个独立场景独立生成 |

### 3.5 光照 + 摄影规约

- 主光方向：必须**与视频段 prompt 一致**（否则会出现"场景图有光、视频段换向"的不连续）
- 色温：暖场景 3200K / 冷场景 5600K / 中性 4500K（写进 prompt）
- 空间感：必须 foreground + midground + background 三层可读
- 不允许出现人物（即使剪影也不允许）→ 避免后续人物合成时剪影冲突

### 3.6 反模式（自动 reject）

- ❌ 场景图混入产品 / 人物 → 后续合成遮挡难
- ❌ 多个场景共用同一 moodboard 但 prompt 完全相同 → 场景雷同
- ❌ 写"beautiful / stunning / amazing"等评价词 → 无信息量且触发违禁词
- ❌ 光源方向与视频段矛盾（场景左光、视频右光）→ 跨段不连续
- ❌ 强行把场景图拉伸成 16:9 → 构图畸变

---

## §4. 故事板图（`storyboard_compilation` 唯一棒）

### 4.1 Mandatory — 何时必生成

- **任何 TVC 必生成**（Step 4 Phase 2 唯一硬交付物）
- 输入：shot plan + selected_style + segment_durations[] + scene_anchors[]
- 输出：自适应网格（≥10s → 3×3；<10s → 2×2；<5s → 首尾帧）

### 4.2 参考图输入

- **类型**：按 segment 拼装 reference list
  - 产品图（§1 输出）
  - 角色三视图（§2 输出，若涉及）
  - 场景图（§3 输出，按 segment 选）
- **格式**：**base64 data URI 列表**（按 segment 顺序）
- **缺口处理**：缺任意参考图 → 触发 §5 failure code `missing_scene_ref`，**故事板编译前必 grilling** 用户确认是否退化到"全文字描述"（不推荐，会大幅降低一致性）

### 4.3 Prompt Template — 自适应网格

```text
故事板图，{grid_layout}（3行3列 | 2行2列 | 单图首尾帧），共 {N} 格，
白底干净布局，格子间有细线分隔，禁止镜号/数字/时间码/字幕/箭头/水印，
每格独立 TVC 关键状态，按 segment 顺序：

格 1（segment 1）：{shot_id_1} — {framing}，{camera_move}，{core_action}，{color_light}，{mood_keyword}
格 2（segment 2）：{shot_id_2} — ...
...（共 N 格）

整体风格：{selected_style} 风格语法，{aspect_ratio}（3×3 用 16:9 / 2×2 用 4:3 / 首尾帧用 16:9 双联），
{resolution_preset}
```

### 4.4 段落分镜自适应网格算法

| 段落分镜时长 | 网格 | 格数 | 备注 |
|------------|------|------|------|
| ≥10s | 3×3 | 9 | 默认上限 |
| 5s ~ <10s | 2×2 | 4 | 紧凑 |
| <5s | 首尾帧 | 2（左右双联）| 极简 |

**段落分镜拆分规则**（用户可在 Step 4 Phase 2 覆盖）：
- 默认 `ceil(T/10)` 段，每段向上取整到 5s 倍数
- 例：30s → `ceil(30/10)=3` 段，每段 10s → 全部 3×3
- 例：25s → `ceil(25/10)=3` 段，每段 8s（25/3≈8.33，向上 5s 倍数 → 10s/10s/5s）→ 2 段 3×3 + 1 段 2×2
- 例：12s → `ceil(12/10)=2` 段，每段 6s → 全部 2×2

### 4.5 摄影 + 风格规约

- 故事板仅用于**整体节奏评审 + 客户提案**，不是视频生成的首帧
- 每格构图必须**可执行**：framing / camera_move / focal length 必须具体
- 颜色叙事（color narrative）：相邻 segment 的 mood_keyword 必须形成**渐进或对比**弧线
- style grammar：与 selected_style 严格对齐（industrial / cinematic-food / beat-synced 等）

### 4.6 反模式（自动 reject）

- ❌ 故事板里出现数字 / 时间码 / 字幕 / 箭头 → 污染
- ❌ N 格全部用同一构图（仅换主角）→ 节奏失败
- ❌ 不分场景把 N 格塞进同一背景 → 场景混淆
- ❌ 忽略 segment 时长硬塞 3×3 → 长 segment 信息密度不够
- ❌ 不带产品 / 角色的 segment 也画主角（违反产品出镜率红线）→ QC fail

---

## §5. Failure Recovery（任意节点失败必走）

### 5.1 失败必停 + 必 grilling（orchestrator §15.2）

**铁律**：本表范围内任意 MCP 生成调用失败 → **禁止降级 / 禁止跳过 / 禁止用旧资产** → 必走 5.2 四选项 grilling。

### 5.2 Grilling 四选项（默认 retry_same）

| 选项 | 默认概率 | 行为 | 何时选 |
|------|---------|------|--------|
| `retry_same` | 60% | 完全相同 prompt + reference 重试（云端偶发超时 / GPU 排队） | 失败信息含 `timeout` / `queue` / `5xx` |
| `revise_prompt` | 25% | 改写 prompt（光位 / 焦距 / 材质描述），reference 不变 | 失败信息含 `bad_request` / 内容审核 / 提示词违规 |
| `retry_revised` | 10% | prompt + reference 都改（更换角度 / 简化 reference） | `revise_prompt` 后仍失败，或视觉与 brief 不符 |
| `abort_step` | 5% | 放弃整个 step，回滚上游 + grilling 用户决策 | 连续 3 次 retry 失败 / 资产方向错误 |

### 5.3 Failure Code 清单

| Code | 触发条件 | 缺省行为 |
|------|---------|---------|
| `missing_anchor` | brief 无 product_anchor / character_anchor | abort_step + grilling 补图 |
| `missing_scene_ref` | 故事板编译缺参考图 | abort_step + grilling 是否退化 |
| `soft_words_present` | prompt 含 cinematic / 电影感 / 高级感 等违禁词 | revise_prompt + 查 ban-word 表 |
| `cross_segment_reference` | video prompt 引用前段 | revise_prompt + 段独立性强制 |
| `param_invented` | 视频 prompt 自创 duration / aspect / model | revise_prompt + 查 upstream |
| `partial_asset_saved` | 部分成功 + 写入 `workspace/<project>/storyboard/.partial/` | retry_same 优先（partial 落盘）|

### 5.4 Partial Asset 保留策略

- 部分资产已生成时，**必落盘**到 `workspace/<project>/storyboard/.partial/`：
  - 命名：`{segment_id}_{asset_type}_{timestamp}.png`
  - 落盘后才允许 retry（不丢失已完成 work）
- 全部成功后由 orchestrator 把 partial → final（`workspace/<project>/storyboard/final/`）
- 完整步骤失败时保留 partial，grilling 用户决定 manual rescue / retry / abort

### 5.5 与 orchestrator 的接口

- agent 调用 MCP 失败 → 抛 `{ failure_report: { failed_step, failed_agent, failed_phase, code, message, completed_artifacts, recoverable, remediation_hint } }`
- orchestrator 收到 failure_report → 强制 grilling 用户（4 选项 + 自定义）
- 用户答复后 → orchestrator 调 `scheduleRetry()` 或 `abortStep()`（详见 SKILL.md §15.2）

---

## §6. 速查总表

### 6.1 调用类型 → 输入格式

| 调用 | input 类型 | 备注 |
|------|----------|------|
| `agnes_image_generate` | base64 data URI（`image_paths[]`）| **不**上传到 img.remit.ee |
| `agnes_image_edit` | base64 data URI（`image_paths[]`）| 同上 |
| `agnes_video_generate` | HTTP URL（先上传到 img.remit.ee）| **必**先上传 |
| `edge-tts.text_to_speech` | 文本 + voice_id | 无参考图 |

### 6.2 分辨率预设

| preset | 尺寸 | 用途 |
|--------|------|------|
| `reference_2k` | 2048×2048 | 默认资产图 |
| `storyboard_4k` | 4096×4096 | 3×3 / 2×2 故事板 |
| `packshot_2k` | 2048×1152 | 16:9 包装特写 |
| `video_first_frame_2k` | 1920×1080 | 上传到 img.remit.ee 后用 |

### 6.3 Aspect Ratio 速查

| 比例 | 用途 |
|------|------|
| 1:1 | 产品主图 / 角色三视图合版 |
| 16:9 | 场景图 / 故事板 3×3 / 视频首帧 |
| 4:3 | 故事板 2×2 |
| 21:9 | 电影版视频（如 selected_style 指定）|

### 6.4 必读互链

- 资产提示词编译：[asset-standards.md](asset-standards.md)
- 视频 prompt 编译：[agnes-prompting.md](agnes-prompting.md)
- 产品图锚定：[product-image-anchor.md](product-image-anchor.md)
- 故事板样式：[storyboard-style.md](storyboard-style.md)
- 反懒散契约（违禁词表）：[anti-laziness-contract.md](anti-laziness-contract.md)