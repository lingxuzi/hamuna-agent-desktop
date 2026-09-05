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
- 输出：按 `layout_type` 自适应生成（6 类见 §4.2）

**通用三段式 prompt 结构**（每 panel 必须遵循，写在 layout prompt 模板之前）：

1. **视觉锚点**：`[Visual Style: <selected_style> · <摄影/色彩/光线要点>]`
2. **人设锚点**：`[Character Lock: <年龄 性别>, <种族>, <体型>, <发型发色>, <关键服饰>; face anchor: <1-2 不可漂移特征>]`（无主角 block 填 `none`，不省略）
3. **镜头运镜 + 场景光影 + 动作情绪 + 音效**：见 §4.2 各 layout 模板内的 `panel annotations`

三段缺一即 reject（§4.6 反模式 +1 项）。

### 4.2 Layout 类型与决策（6 类 — v0.5 升级）

**不再使用 v0.4 的"3×3 黏土白模默认"**。每 block 先按场景内容选 `layout_type`，再写 prompt 模板。6 类如下：

| `layout_type` | 何时用 | Panel 数 | Aspect | 模板 |
|---------------|--------|---------|--------|------|
| `grid` | 默认段落分镜；产品演示、场景切换、节奏推进 | 4×3 / 3×3 / 2×2 | 16:9 / 4:3 | 模板 A |
| `fixed-camera` | 长镜头 / 固定机位对话 / 戏剧化停顿 | 1-3（水平排）| 16:9 | 模板 B |
| `scene-planning` | 场景走位调度；人物移动路径；空间布局 | 1（整图俯视 + 走位标注）| 16:9 宽幅 | 模板 C |
| `top-down-staging` | 多人站位、群戏调度、镜头走位预演 | 1（整图俯视 + 角色位置）| 1:1 或 4:3 | 模板 D |
| `action-keyframes` | 动作分解、关键转折、动态捕捉 | 3（水平三连）| 16:9 三联 | 模板 E |
| `narrative-comic` | 情节推进、叙事弧线、悬念揭示 | 4（水平四联 / 2×2）| 16:9 | 模板 F |

**模板 A — grid（4×3 / 3×3 / 2×2 默认）**：

```text
[Visual Style: {selected_style} · {摄影/色彩/光线要点}]
[Character Lock: {固定人设}]
故事板图，{grid_layout}（4行3列 | 3行3列 | 2行2列），共 {N} 格，
白底干净布局，格子间有细线分隔，禁止镜号/数字/时间码/字幕/箭头/水印，
每格独立 TVC 关键状态，按 segment 顺序：

格 {i}（segment {i}）：shot_type={shot_type}，character_emotion={character_emotion}，
sound_effect={sound_effect}，{framing}，{camera_move}，{core_action}，{color_light}，{mood_keyword}
...（共 N 格）

整体风格：{selected_style} 风格语法，{aspect_ratio}，{resolution_preset}
```

**模板 B — fixed-camera**（单镜多帧水平排，强调"同一机位不同瞬间"）：

```text
[Visual Style: {selected_style} · {摄影/色彩/光线要点}]
[Character Lock: {固定人设}]
固定机位故事板（fixed-camera 模式），{N} 帧水平排列（{N} ≤ 3），
同一镜头（无 cut），展示 {N} 个关键时刻的状态演变，
白底干净布局，帧间细线分隔，禁止镜号/数字/时间码/字幕/箭头/水印：

帧 {i}（t={t_i}s）：shot_type={shot_type_i}，character_emotion={character_emotion_i}，
sound_effect={sound_effect_i}，{framing}，{camera_move=none_locked}，{core_action_i}，{color_light}，{mood_keyword}

{resolution_preset}
```

**模板 C — scene-planning**（整图走位调度，强调"先看空间再发生事件"）：

```text
[Visual Style: {selected_style} · {摄影/色彩/光线要点}]
[Character Lock: {固定人设}]
场景规划图（scene-planning 模式），单张 16:9 宽幅，
俯视/斜俯视展示 {location} 的空间布局：
- 主活动区：{main_zone}（含 {key_props}）
- 人物路径：{character_path}（起点 → 终点，标注 {N} 个关键节点）
- 摄像机位：{camera_position_1}（拍 {action_1}）/ {camera_position_2}（拍 {action_2}）
- 光照：{lighting_setup}

不出现最终镜头画面，仅展示空间关系与运动路径
```

**模板 D — top-down-staging**（俯视多人站位调度）：

```text
[Visual Style: {selected_style} · {摄影/色彩/光线要点}]
[Character Lock: 各角色分别列出}]
俯视调度图（top-down-staging 模式），单张 1:1 或 4:3，
{scene_location} 平面布局：
- 角色 {role_name} 站位：{x,y}（标注 {facing_direction}）
- 角色 {role_name} 站位：{x,y}
...（共 {N} 个角色）
- 关键道具：{props_position}
- 摄像机位 + 拍摄方向：{camera_facing}

不出现人物面部细节，仅展示空间关系
```

**模板 E — action-keyframes**（动作分解三连）：

```text
[Visual Style: {selected_style} · {摄影/色彩/光线要点}]
[Character Lock: {固定人设}]
动作分解图（action-keyframes 模式），3 帧水平排列（t1 / t2 / t3 三连），
展示 {core_action} 的 3 个关键时刻：
- 帧 1（t1={t1}s，开始）：shot_type={shot_type}，character_emotion={emotion_1}，
  sound_effect={sfx_1}，{state_1}
- 帧 2（t2={t2}s，峰值）：shot_type={shot_type}，character_emotion={emotion_2}，
  sound_effect={sfx_2}，{state_2}
- 帧 3（t3={t3}s，结果）：shot_type={shot_type}，character_emotion={emotion_3}，
  sound_effect={sfx_3}，{state_3}

三帧构图连贯，主体姿态递进，禁止字幕/数字/箭头
```

**模板 F — narrative-comic**（四格叙事弧线）：

```text
[Visual Style: {selected_style} · {摄影/色彩/光线要点}]
[Character Lock: {固定人设}]
四格连环画（narrative-comic 模式），4 帧水平四联（或 2×2），
展示情节推进的 4 个节拍：
- 格 1（起，{beat_1}）：shot_type={shot_type}，character_emotion={emotion_1}，
  sound_effect={sfx_1}，{action_1}
- 格 2（承，{beat_2}）：shot_type={shot_type}，character_emotion={emotion_2}，
  sound_effect={sfx_2}，{action_2}
- 格 3（转，{beat_3}）：shot_type={shot_type}，character_emotion={emotion_3}，
  sound_effect={sfx_3}，{action_3}
- 格 4（合，{beat_4}）：shot_type={shot_type}，character_emotion={emotion_4}，
  sound_effect={sfx_4}，{action_4}

四格构图连贯，色调按节拍递进
```

**per-panel 3 项硬强制（所有 6 类共用）**：每 panel prompt 必带 `shot_type` / `character_emotion` / `sound_effect` 三键，缺一即 reject：

- `shot_type` ∈ `extreme-wide / wide / medium / medium-close-up / close-up / extreme-close-up / over-the-shoulder / top-down / dutch-angle`
- `character_emotion` ∈ `calm / tense / joyful / melancholy / determined / surprised / focused / anxious / exhausted / hopeful`（product-only panel 可空字符串 `""`，但 key 必出现）
- `sound_effect` ∈ `dialogue / ambient / music-beat / sfx-impact / silence / vo-over / whoosh / crunch / sizzle / heartbeat / breath / city-noise`

### 4.3 参考图输入与固定人设（v0.7 升级为结构化）

**两层模型**（v0.7 区分"全集"与"精挑子集"）：

| 层 | 字段 | 内容 | 何时填 |
|----|------|------|--------|
| Envelope 顶层 | `references[]` | **全集**：每项 `{name, source: base64_data_uri}`，name 是字符串 ID（`product-hero` / `character-<role>` / `scene-<location>`）；一张图只在 envelope 顶层存一次 | Phase 1 收集所有产物图 |
| Block 级 | `blocks[].references[]` | **精挑子集**：每项是 envelope 顶层 `references[].name` 的**字符串引用**（**不**重复 base64） | Phase 2 每 block 必填 |

**block 级 references[] 决策表**（必走，先于 layout / prompt 拼装）：

| block 场景内容 | `references[]` 必含 | 不应包含 |
|----------------|-------------------|----------|
| 含产品（产品演示 / 特写 / 包转）| `product-hero` | 该 block 无关的其他场景图 |
| 含人物（角色入镜）| `character-<role_name>`（按角色名）| 无关角色 |
| 场景切换 / 转场 block | 该 block 起始场景对应的 `scene-<location>` | 其它 location 场景图 |
| 多场景混合 block（少见）| 按 panel 顺序列出全部相关 scene + product + character（基本 = envelope 全集）| 无关 ref |
| 纯文字 / 纯 typography / logo endboard | `[]`（空数组）| 任何图 |

**参考图输入**：
- **类型**：按 §1 / §2 / §3 收集产物图（必填 base64 在 envelope 顶层）
- **block 级引用**：name 字符串，无 base64
- **缺口处理**：缺任意参考图 → 触发 §5 failure code `missing_scene_ref`，**故事板编译前必 grilling** 用户确认是否退化到"全文字描述"（不推荐）；envelope 顶层全集必填，block 级精挑允许 `[]`（纯文字 block）

**反模式**（v0.7 新增，§4.6 自动 reject）：
- ❌ block 含人物入镜但 `references[]` 没 `character-*` → agnes 凭空生成人脸，跨 block 漂移
- ❌ block 跨场景切换但 `references[]` 没对应 scene 图 → 转场前后视觉断裂
- ❌ block `references[]` 是 envelope 顶层全集的复制粘贴（含 base64）→ 浪费 token + 引入无关 ref 污染
- ❌ block `references[]` 出现 envelope 顶层不存在的 `name` → 解析期找不到 base64（hang）

**固定人设（Character Setup Pinning）规则**：

每段 prompt 开头粘贴人设描述，作为"防漂移锚点"：

```
[Character Lock: <年龄区间> <性别>, <种族>, <体型>, <发型发色>, <关键服饰>;
 face anchor: <1-2 个不可漂移的面部特征>]
```

- 主角三视图（§2 输出）必须已生成；如未生成则先用 §2 流程生成
- 若 block 无主角（如纯产品 / 纯场景 / scene-planning / top-down-staging 无角色）→ 填 `none`，不省略
- 跨 block 同主角 → 必须粘贴完全相同的 `Character Lock`（防止漂移）

**panel 级精挑（v0.8 新增）**：

每 panel 必填 `reference_tags[]`，从 block 级 `references[]`（候选全集）里挑 panel 真正需要的：

| panel 内容 | `reference_tags[]` 推荐 |
|------------|----------------------|
| 产品特写 / 包转 / 旋转 | `["product-hero"]`（不含 character/scene）|
| 人物反应 / 入镜 / 表情 | `["character-<role_name>"]`（不含 product/scene）|
| 场景切换 / 转场帧 | `["scene-<location>"]` |
| 多元素同框（人物 + 产品互动）| `["product-hero", "character-<role>", "scene-<location>"]`（按重要性）|
| 纯文字 / typography / logo | `[]`（不消费）|
| 继承 block 默认 | `[]` |

**block 级 vs panel 级**：

- block 级 `references[]` 是**候选全集**；panel 级 `reference_tags[]` 是**精挑子集**
- 缺省行为：panel `reference_tags[]` 缺省 = 继承 block 级 `references[]`（向后兼容）
- panel `reference_tags[]` 不允许出现 block 级 `references[]` 之外的 `name`（envelope 顶层全集越界）

### 4.4 段落分镜自适应网格算法

**段落分镜拆分规则**（用户可在 Step 4 Phase 2 覆盖）：

| 成片时长 T | 段数 = `ceil(T/10)` | 默认段长分配 | 推荐 layout |
|-----------|---------------------|-------------|-----------|
| T < 5s | 1 | T（单段）| `grid` 2×2 或 `narrative-comic` 4 联 |
| 5s ≤ T < 10s | 1 | T（单段）| `grid` 3×3 / `action-keyframes` 3 连 |
| 10s ≤ T < 20s | 2 | 向上 5s 倍数 | 各 block 按内容选（多 `grid`）|
| 20s ≤ T < 30s | 3 | 向上 5s 倍数 | 多 `grid` + 1 个 `action-keyframes` |
| 30s ≤ T < 45s | 3-4 | 向上 5s 倍数 | `grid` + `scene-planning` 转场 |
| T ≥ 45s | ≥5 | 拆为多个 15s 板块 | 混合 6 类 |

**段长分配规则**：每段时长向上取整到 5s 倍数（例：25s → 3 段 → 10s/10s/5s；例：30s → 3 段 → 全部 10s）。

**自适应规则（v0.5 扩展）**：

- 段落时长 ≥ 10s 且 ≥3 个 segment → 默认 `grid` 3×3 / 4×3
- 段落时长 < 10s → 默认 `grid` 2×2；若是单一动作 → `action-keyframes` 3 连
- 段落是叙事弧线（起承转合 4 拍）→ `narrative-comic` 4 联
- 段落是空间建立 → `scene-planning` 或 `top-down-staging`
- 段落是固定机位长拍 → `fixed-camera` 1-3 帧

### 4.5 摄影与视觉风格（跟 selected_style）

- **不再使用黏土白模**作为默认视觉基线
- 视觉风格 = `selected_style` 的视觉语言（摄影 / 色彩 / 光线 / 质感）
- selected_style 的 `category`（cinematic-narrative / commercial-craft / lifestyle-documentary）直接映射 prompt 中的摄影 + 色彩 + 光线描述
- 故事板仅用于**整体节奏评审 + 客户提案**，不是视频生成的首帧
- 每格构图必须**可执行**：framing / camera_move / focal length 必须具体
- 颜色叙事（color narrative）：相邻 panel 的 mood_keyword 必须形成**渐进或对比**弧线

**selected_style → 摄影要点速查表**：

| selected_style | category | 摄影 + 色彩 + 光线 |
|----------------|----------|-------------------|
| `tvc-style-brand-manifesto` | cinematic-narrative | 长焦 85mm、低饱和 3200K、戏剧化光位、电影质感 |
| `tvc-style-cinematic-food` | lifestyle-documentary | 35mm 浅景深、暖色温 3200K、大光比、食物肌理 |
| `tvc-style-industrial-product` | commercial-craft | 50mm 标准镜头、5600K 中性色温、均匀柔光 |
| `tvc-style-product-promo` | commercial-craft | 35-50mm、5600K + rim light、卖点层级受控光 |
| `tvc-style-one-take` | commercial-craft | 24-35mm 广角、动机转场、连续空间 |
| `tvc-style-beat-synced` | commercial-craft | 50mm、节奏化运镜、运动-剪辑协调 |

### 4.6 反模式（自动 reject）

**v0.5 新增 5 项**（与 v0.4 旧 5 项合并，共 10 项）：

- ❌ 使用黏土白模视觉（v0.4 默认）→ 已被 `selected_style` 取代
- ❌ 三段式 prompt 缺 Visual Style 或 Character Lock → 漂移源
- ❌ per-panel 缺 `shot_type` / `character_emotion` / `sound_effect` 任意一项 → QC fail
- ❌ 同一角色跨 block 的 `Character Lock` 字面值不同 → 漂移
- ❌ `layout_type` 选了 `top-down-staging` 但 prompt 写了人物面部细节 → 风格冲突

**v0.4 保留 5 项**：

- ❌ 故事板里出现数字 / 时间码 / 字幕 / 箭头 → 污染
- ❌ N 格全部用同一构图（仅换主角）→ 节奏失败
- ❌ 不分场景把 N 格塞进同一背景 → 场景混淆
- ❌ 忽略 segment 时长硬塞 3×3 → 长 segment 信息密度不够
- ❌ 不带产品 / 角色的 segment 也画主角（违反产品出镜率红线）→ QC fail

**v0.5 → 视频翻译反漂移 3 项**（Step 9 video-prompt 必守门，详 SKILL §15.6 handoff contract）：

- ❌ 视频 segment prompt 的"全局风格声明"重新从 `selected_style` 推算，而非直接 copy `blocks[].visual_style_anchor` → 双源漂移（cheatsheet §4.5 算一次，agent 再算一次）
- ❌ 视频 segment prompt 的"人设描述"重新拼凑，而非直接 copy `blocks[].character_setup` → 跨 block 字面值漂移（破坏 §4.6 v0.5 第 4 项守门）
- ❌ 视频 segment prompt 缺 `shot_type` / `character_emotion` / `sound_effect` 任意一项（v0.5 故事板已强制 → video 不消费 = 评审与成片脱节）

**v0.7 → block 级参考图反漂移 4 项**（Step 4 Phase 2 必守门，详 SKILL §15.7 per-block reference decision）：

- ❌ block 含人物入镜但 `references[]` 没 `character-*` → agnes 凭空生成人脸，跨 block 漂移
- ❌ block 跨场景切换但 `references[]` 没对应 scene 图 → 转场前后视觉断裂
- ❌ block `references[]` 是 envelope 顶层全集的复制粘贴（含 base64）→ 浪费 token + 引入无关 ref 污染
- ❌ block `references[]` 出现 envelope 顶层不存在的 `name` → 解析期找不到 base64（hang）

**v0.8 → panel 级参考图反漂移 2 项**（Step 4 Phase 2 panel 必守门，详 SKILL §15.7 panel-level）：

- ❌ panel 元素只占 1 个但 `reference_tags[]` 含 ≥3 个无关 ref → 污染 agnes
- ❌ panel `reference_tags[]` 含 block 级 `references[]` 之外的 `name` → 越权（envelope 顶层全集越界）

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