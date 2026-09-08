# MCP 调用模板（硬编码）

**何时读**：每次调 MCP 工具之前；涉及参考图的生成 100% 必读本文件。
**目的**：消除 AI 自由组合 `mode` / `images[]` / `first_frame` / `prompt` 的自由度——**所有需要参考图的生成禁止 AI 自由发挥**，必须字面照抄本文件对应模板（按场景编号）。

> 工具 schema 见 `references/agnes-ai-api.md`；参数互斥 + 跨工具链 + 失败处理见 `references/mcp-usage-guide.md`；输出目录 + 持久化见 `references/output-conventions.md`；风格锚点 / Prompt 中文铁律见 `SKILL.md`。本文件**只**提供硬编码调用模板。

---

## 0. 公共块（所有模板复用）

### 0.1 全局风格锚点 block（`{{style_anchor}}` 替换点）

**强制嵌入位置**：`prompt` 参数**最开头**，且**一字不差**贯穿全项目。`{{style_anchor}}` 由 runtime 替换为 `project.json.style_anchor`（如 `真人电影风格` / `3D国漫风格` / `2D日漫赛璐璐风格` / `高质感真人写真` / `赛博朋克风格` / `古风工笔风格` / `广告质感风格`）。

```
{{style_anchor}}，
```

### 0.2 产品漂移负向 block（防 hallucinate 产品）

**强制嵌入位置**：涉及产品的 image_generate / image_edit / video_generate 调用，`prompt` 参数**末尾**追加。`{{product_name}}` 替换为用户在 `04_assets/product-refs/<产品名>.{jpg,png}` 命名的产品名。

```
【产品一致性硬约束】严格保持 <产品N>（{{product_name}}）的真实外观：包装、logo、颜色、材质、比例、品牌细节 100% 匹配参考图；禁止生成任何虚构替代品、相似外观、错误品牌 logo、变形包装、错误颜色变体；禁止添加参考图不存在的文字、刻字、标签、二维码。
```

### 0.3 五维物理表演负向 block（drama video 必用）

**强制嵌入位置**：drama video_generate 调用，`prompt` 参数**末尾**追加（在 0.2 之后）。

```
【表演硬约束】主体动作必须含至少 3 维度具象表演（微表情视线 / 肢体体态 / 动作中间态 / 生理应激 / 光影呼吸）；严禁使用抽象情绪词（难过 / 愤怒 / 委屈 / 绝望 / 崩溃）；动作中间态（欲言又止 / 转身一滞 / 抬手悬空）替代"已完成动作 + 跳下一个已完成动作"，防视频模型跳帧；运镜按景别硬分级：特写 tripod static + high facial detail focus（禁剧烈运镜，防面部融化/残影）；中近 subtle cinematic handheld + realistic camera inertia；中远 full-scale cinematic handheld + natural breathing。
```

### 0.4 ref 角色 → `images[]` 位置映射（video.reference 模式硬约定）

**video.reference 模式的 `images[]` 数组顺序必须严格按角色排**：

| 位置 | 角色 | 物理来源 | 例外分支 |
|---|---|---|---|
| `images[0]` | **product_ref**（产品图，**最强锚**） | `04_assets/product-refs/<产品名>.png` | drama 无产品段：跳过此位 |
| `images[1]` | **person_ref**（人物参考，主播 / 角色） | `04_assets/characters/<角色名>/<角色名>_设定.png` 或 UGC 主播图 | text 模式 / drama 无人物段：跳过此位 |
| `images[2]` | **scene_ref**（场景参考，主场景） | `04_assets/scenes/<场景名>/<场景名>_全景氛围.png` | 无场景概念的 UGC：跳过此位 |
| `images[3]` | **logo_ref**（品牌 logo） | `04_assets/brand-refs/logo.png` | 仅 Corporate 必传 |
| `images[4]` | **ip_ref**（IP / 吉祥物） | `04_assets/brand-refs/ip.png` | 仅 Corporate 必传 |

**硬规则**：
- 涉及产品 → `images[0]` 必传 product_ref
- 涉及人物 → `images[1]` 必传 person_ref
- 涉及场景延续 → `images[2]` 必传 scene_ref
- Corporate → `images[3]` logo_ref + `images[4]` ip_ref 必传
- 跳过位不留空，**数组紧凑**（如 UGC 只有产品+主播 → `images.length === 2`）

---

## 1. image_edit 模板（3 个）

### T01 — `image_edit_aspect_ratio_convert`（转比例）

**适用场景**：keyframe / 产品图 / 资产图比例 ≠ 目标 `aspect_ratio`，必须先转比例再喂 video_generate。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_image_edit({
  image_paths: [
    "{{source_url}}"          // 上游 image_generate 返回的 HTTPS URL（或上一阶段落盘的 product-refs URL）
  ],
  prompt: "{{style_anchor}}，保持<产品N>（如涉及）的外观 / 角色身份 / 场景结构 / 光影方向 100% 不变；仅调整画幅比例为 {{target_aspect_ratio}}；不修改内容、不裁切主体、不变形。",
  aspect_ratio: "{{target_aspect_ratio}}"  // "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9"
  // size / ratio 不传（MCP 默认）
})
```

**占位符替换**：
- `{{source_url}}` → 上游 `data[0].url`
- `{{target_aspect_ratio}}` → 本项目目标比例（drama 默认 9:16 / Marketing 默认 9:16 / UGC 默认 9:16 / Corporate 默认 16:9）
- `{{style_anchor}}` → 见 §0.1

**落盘**：`cmd_workspace_copy_paths(url → <workspace>/.../04_assets/<type>/<name>/<name>_<ratio>.png)` + 写 `<file_path> → <https_url>` 映射到 `project.json.notes`。

---

### T02 — `image_edit_multiref_synthesis`（多图合成）

**适用场景**：单个关键帧需要融合多张资产图（角色 + 场景 + 道具 / 产品 + 主播 + 背景），单图生成无法表达。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_image_edit({
  image_paths: [
    "{{ref_1_url}}",          // <Picture 1>：按 ref 角色排序（同 §0.4 顺序，product → person → scene）
    "{{ref_2_url}}",          // <Picture 2>
    "{{ref_3_url}}",          // <Picture 3>（可选）
    "{{ref_4_url}}"           // <Picture 4>（可选，≤ 8）
  ],
  prompt: "{{style_anchor}}，合成 <Picture 1> 的 {{role_1}}（{{role_1_desc}}）、<Picture 2> 的 {{role_2}}（{{role_2_desc}}）{{如有 3+}}、<Picture N> 的 {{role_N}}（{{role_N_desc}}）{{/如有}}；保持各参考图的主体身份、外观、场景空间、光影方向 100% 不变；按场景构图融合，不裁切、不变形、不替换任何参考元素。",
  aspect_ratio: "{{target_aspect_ratio}}"
  // size / ratio / mask_path 不传
})
```

**占位符替换**：
- `{{ref_N_url}}` → 按 §0.4 顺序填入
- `{{role_N}}` → `产品` / `主角` / `场景` / `IP` / `道具` 等
- `{{role_N_desc}}` → `iPhone 15 Pro 钛金色正面照` / `林远 30 岁职业装正面设定图` / `苏家大厅全景氛围图`

**落盘**：同 T01。

---

### T03 — `image_edit_local_mask`（局部编辑）

**适用场景**：用户明确要求"修这张图的某个区域"（如"去掉背景里那个路人"），需要 mask 局部编辑。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_image_edit({
  image_paths: [
    "{{source_url}}"          // 待编辑原图
  ],
  mask_path: "{{mask_url}}",  // 用户提供的 mask PNG（白=编辑区，黑=保留区，HTTPS URL）
  prompt: "{{style_anchor}}，仅修改 <Picture 1> 中 mask 标注的区域为 {{target_desc}}（{{target_spec}}）；mask 外的区域 100% 保留（角色身份、场景结构、光影、周围元素不变）；编辑区域与周围融合自然，无明显接缝、无色差。",
  aspect_ratio: "{{source_aspect_ratio}}"  // 与原图一致，不改比例
})
```

**占位符替换**：
- `{{mask_url}}` → 用户上传 mask 的 HTTPS URL
- `{{target_desc}}` + `{{target_spec}}` → 如"空荡的石板路" + "无人物、保留石板纹理和光线"

**落盘**：同 T01。

---

## 2. video_generate 模板（9 个）

### T04 — `video_reference_drama_product`（drama 产品特写段）

**适用场景**：drama 5 阶段流水线中，分镜表涉及**产品特写镜头**（产品包装 / logo / 道具细节镜头）。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "reference",          // 强制 reference，不用 keyframe（产品漂移问题）
  images: [
    "{{product_ref_url}}",    // <Picture 1> = product_ref（04_assets/product-refs/<产品名>.png HTTPS URL）
    "{{person_ref_url}}"      // <Picture 2> = person_ref（涉及人物出镜时传；纯产品特写无人物则 images.length === 1）
  ],
  prompt: "{{style_anchor}}，参考 <产品N>（<Picture 1>，{{product_name}}）的包装、logo、颜色、材质 100% 锁定；<角色N>（<Picture 2>）{{如有人物}}手持 / 使用 / 呈现 该产品{{/如有人物}}；分镜脚本：{{storyboard_shot_description}}；镜头时长严格 {{seconds}} 秒；{{negative_product_block}}{{negative_drama_block}}",
  seconds: "{{seconds}}",     // 字符串 "4"-"12"
  size: "720P",               // 锁死
  aspect_ratio: "{{aspect_ratio}}"  // drama 默认 9:16
  // audios / videos / first_frame / last_frame / mask_path 不传
})
```

**占位符替换**：
- `{{product_ref_url}}` → `04_assets/product-refs/<产品名>.png` 的 HTTPS URL
- `{{person_ref_url}}` → `04_assets/characters/<角色名>/<角色名>_设定.png` 的 HTTPS URL（如无人物，省略此位 + images.length=1）
- `{{product_name}}` → 产品中文名
- `{{storyboard_shot_description}}` → drama 分镜该镜头的画面描述（已通过 stage .md 锚点）
- `{{seconds}}` → 该集该段时长字符串 "12"
- `{{negative_product_block}}` → §0.2 替换 `{{product_name}}` 后的产品漂移负向
- `{{negative_drama_block}}` → §0.3 五维物理负向

**落盘**：`cmd_workspace_copy_paths(url → <workspace>/.../06_videos/segment-XX.mp4)` + 写 `project.json.notes.video_segments[<id>] = { status: "completed", url, local_path }`。

---

### T05 — `video_reference_drama_character_continuity`（drama 角色跨段延续）

**适用场景**：drama 跨集 / 跨 segment 出现同一角色，需要视觉锚锁防止**跨段角色形象漂移**（v0.2.15 实战：换 Runtime 后图片不渲染 / 角色发色 / 服装 / 脸型漂移）。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "reference",
  images: [
    "{{character_ref_url}}"   // <Picture 1> = character_ref（04_assets/characters/<角色名>/<角色名>_设定.png HTTPS URL）
  ],
  prompt: "{{style_anchor}}，参考 <角色N>（<Picture 1>，{{character_name}}）的脸部特征、发型、服装、体型、识别特征 100% 锁定；分镜脚本：{{storyboard_shot_description}}；镜头时长严格 {{seconds}} 秒；不允许重绘、变形、替换、新增服装、换发型、换脸型。{{negative_drama_block}}",
  seconds: "{{seconds}}",
  size: "720P",
  aspect_ratio: "{{aspect_ratio}}"
})
```

**占位符替换**：
- `{{character_ref_url}}` → character 设定图 HTTPS URL
- `{{character_name}}` → 角色名

**适用前提**：assets 阶段已生成 `[图N]` character 编号（见 `drama/storyboard.md` 资产统一铁律）。

---

### T06 — `video_reference_ugc`（UGC 主播 + 产品双锚）

**适用场景**：commercial UGC（口播带货），产品 + 主播同框，必须双锚锁视觉。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "reference",          // 强制 reference（text 模式产品/主播都会漂移）
  images: [
    "{{product_ref_url}}",    // <Picture 1> = product_ref（04_assets/product-refs/<产品名>.png）
    "{{creator_ref_url}}"     // <Picture 2> = person_ref（UGC 主播图，用户上传或上轮 image_generate 产物）
  ],
  prompt: "{{style_anchor}}，参考 <产品N>（<Picture 1>，{{product_name}}）的包装、logo、颜色 100% 锁定；参考 <主播N>（<Picture 2>）的面部特征、发型、服装 100% 锁定；主播手持 / 展示 / 讲解 产品（{{voiceover_excerpt}}，包含产品卖点）；分镜：{{ugc_segment_shots}}；镜头时长严格 {{seconds}} 秒；{{negative_product_block}}",
  seconds: "{{seconds}}",
  size: "720P",
  aspect_ratio: "9:16"         // UGC 默认 9:16
})
```

**占位符替换**：
- `{{creator_ref_url}}` → 主播参考图 HTTPS URL（来自 `04_assets/characters/ugc-creator/` 或用户提供）
- `{{voiceover_excerpt}}` → 该段旁白/口播原文（按 `references/ugc-talking-video-ref.md::speech_pace` 控制字数：12 秒 60-72 字 / 高密度 72-84 字）
- `{{ugc_segment_shots}}` → 该段镜头描述（如 4 段式 Cut1 0-2s hook / Cut2 2-5s 产品揭示 / Cut3 5-9s 卖点证明 / Cut4 9-12s packshot）

---

### T07 — `video_reference_marketing`（Marketing 产品 + 卖点）

**适用场景**：commercial Marketing 12 秒营销广告片（产品是核心，5 段式结构 0-2/2-4/4-8/8-10/10-12）。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "reference",
  images: [
    "{{product_ref_url}}",    // <Picture 1> = product_ref
    "{{voiceover_scene_url}}" // <Picture 2> = voiceover_scene_map（来自 03_storyboard.md 的 voiceover_scene_map 落盘 PNG / 02_assets）
  ],
  prompt: "{{style_anchor}}，参考 <产品N>（<Picture 1>，{{product_name}}）的包装、logo、颜色、卖点视觉 100% 锁定；按 5 段式结构生成：0-2s hook 视觉反差强冲击、2-4s 产品揭示 logo/产品居中、4-8s 卖点证明（3 个卖点用 voiceover_scene_map <Picture 2> 锚定视觉）、8-10s 结果 + 受众收益、10-12s packshot hold logo 持续露出；旁白（{{voiceover_excerpt}}）；镜头时长严格 12 秒；{{negative_product_block}}",
  seconds: "12",              // Marketing 锁死 12 秒（MCP 上限）
  size: "720P",
  aspect_ratio: "9:16"         // Marketing 默认 9:16
})
```

**占位符替换**：
- `{{voiceover_scene_url}}` → `voiceover_scene_map` 落盘的 PNG（卖点视觉锚定图）
- `{{voiceover_excerpt}}` → 完整旁白（≤ 12 秒字数限制：60-72 字 / 高密度 72-84 字）

---

### T08 — `video_reference_corporate`（Corporate 全套 logo + IP + 产品 + 场景）

**适用场景**：commercial Corporate 12 秒企业宣传片（4 类必填信息全必传 + 8-10 分镜 + 完整旁白稿 `narration.md`）。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "reference",          // 强制 reference（4 类必传 brand_ref）
  images: [
    "{{logo_ref_url}}",       // <Picture 1> = logo_ref（04_assets/brand-refs/logo.png）
    "{{ip_ref_url}}",         // <Picture 2> = ip_ref（04_assets/brand-refs/ip.png）
    "{{product_ref_url}}",    // <Picture 3> = product_ref（升级后第 3 类必传）
    "{{space_ref_url}}",      // <Picture 4> = scene_ref（04_assets/scenes/<空间名>/_全景氛围.png 或空间参考）
    "{{case_ref_url}}"        // <Picture 5> = 可选 case_ref（04_assets/brand-refs/case/<客户案例>.<ext>），无案例则 images.length === 4
  ],
  prompt: "{{style_anchor}}，参考 <logoN>（<Picture 1>）严格保持 logo 形状、颜色、比例、间距、位置，不重绘、不风格化、不替换、不生成假字；参考 <IPN>（<Picture 2>）保持角色外形、颜色、服饰、表情特征和品牌识别点；参考 <产品N>（<Picture 3>）{{product_name}} 包装、logo、颜色 100% 锁定；参考 <场景N>（<Picture 4>）{{space_name}} 空间结构、光线、品牌色统一锚定；{{如有 case}}<案例N>（<Picture 5>）{{case_name}} 视觉锚定{{/如有 case}}；按 8-10 分镜结构（默认 8 镜）：hook → 业务范围 → 能力证据 1 → 能力证据 2 → 人物/客户/场景互动 → 差异化优势 → logo/IP hold；旁白（{{voiceover_full_excerpt}}，完整旁白原文，逐句 {{}} 包裹，不得压缩成 slogan）；镜头时长严格 12 秒；事实准确，不编造客户/数据/认证/奖项；保持 logo/IP/品牌资产一致；{{negative_product_block}}",
  seconds: "12",
  size: "720P",
  aspect_ratio: "16:9"         // Corporate 默认 16:9（PC / 电视 / 会议大屏）
})
```

**占位符替换**：
- `{{logo_ref_url}}` / `{{ip_ref_url}}` / `{{product_ref_url}}` / `{{space_ref_url}}` / `{{case_ref_url}}` → brand-refs/ 目录 HTTPS URL
- `{{voiceover_full_excerpt}}` → 该段在 `narration.md` 全片旁白稿的子集（完整可配音台词，每句 `{}` 包裹，3-6 句 / 4-7 句 / 3-4 句 / 3-5 句 按路线调性）
- `{{space_name}}` / `{{product_name}}` / `{{case_name}}` → 资产阶段命名的中文名

**硬门控**：4 类必填信息（企业信息 / 宣传文案 / logo+IP+VI+客户案例+产品图 / 旁白）齐备 + 用户已 ack 才能调本模板；缺一类 = 不进 planner。

---

### T09 — `video_keyframe_marketing`（Marketing keyframe 模式）

**适用场景**：Marketing 12 秒产品图作首帧（部分调性路线用 keyframe 替代 reference，如"产品全屏展示"型广告）。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "keyframe",            // 锁 keyframe
  first_frame: "{{product_ref_url}}",  // <产品N> 作首帧
  prompt: "{{style_anchor}}，以 <Picture 1>（{{product_name}} 产品图）为起始画面；按 5 段式结构：0-2s hook 从产品特写开始（构图变化或 logo reveal）、2-4s 产品揭示延续、4-8s 卖点证明（场景化使用）、8-10s 结果 + 收益、10-12s packshot hold 回到产品原图或 logo；旁白（{{voiceover_excerpt}}）；镜头时长严格 12 秒；保持产品外观 100% 一致于 first_frame；{{negative_product_block}}",
  seconds: "12",
  size: "720P",
  aspect_ratio: "9:16"
  // images[] / last_frame / audios / videos 不传
})
```

**何时用 T07 vs T09**：T07（reference）适合"产品 + 旁白视觉锚 + 镜头多 cut"调性；T09（keyframe）适合"产品全屏 reveal + 单 cut 长镜头"调性。两者**互斥**，planner/storyboard 阶段必选一个。

---

### T10 — `video_keyframe_drama_normal`（drama 普通剧情段）

**适用场景**：drama 5 阶段流水线**默认**，frame 阶段已生成首尾关键帧图，video 阶段 keyframe 模式驱动。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "keyframe",
  first_frame: "{{seg_start_frame_url}}",  // <起始帧N> = frame 阶段已落的 SEG_XX_START.png HTTPS URL
  last_frame: "{{seg_end_frame_url}}",     // <结束帧N> = SEG_XX_END.png（首末帧驱动才传；单帧驱动则不传）
  prompt: "{{style_anchor}}，从 <起始帧N>（<Picture 1>，SEG_XX_START 起始帧）{{如有末帧}}过渡到 <结束帧N>（<Picture 2>，SEG_XX_END 结束帧）{{/如有末帧}}；保持场景空间、角色身份、光影方向、摄影机逻辑 100% 与起始帧一致；分镜脚本：{{storyboard_segment_description}}；镜头时长严格 {{seconds}} 秒；{{negative_drama_block}}",
  seconds: "{{seconds}}",
  size: "720P",
  aspect_ratio: "{{aspect_ratio}}"  // drama 默认 9:16
  // images[] / audios / videos / mask_path 不传
})
```

**占位符替换**：
- `{{seg_start_frame_url}}` / `{{seg_end_frame_url}}` → frame 阶段已落盘的 `05_keyframes/episode-XX/segment-YY/SEGXX_*.png` HTTPS URL
- `{{storyboard_segment_description}}` → 该段所有镜头的连贯动作描述

**何时升级到 T04 / T05**：该段涉及产品特写 → 用 T04（reference + product_ref）；该段角色跨集延续 → 用 T05（reference + character_ref）。T10 是默认 fallback。

---

### T11 — `video_text_drama_no_ref`（drama 无 ref 纯剧情段）

**适用场景**：drama 纯对话 / 心理独白 / 室内静态镜头，**无产品 / 无角色延续需求**，纯文生视频可接受。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "text",                // 锁 text（无参考图才能用 text）
  prompt: "{{style_anchor}}，分镜脚本：{{storyboard_segment_description}}；镜头时长严格 {{seconds}} 秒；纯文生视频，无参考图；{{negative_drama_block}}",
  seconds: "{{seconds}}",
  size: "720P",
  aspect_ratio: "{{aspect_ratio}}"
  // first_frame / last_frame / images[] / audios / videos / mask_path 全部不传
})
```

**硬门控**：T11 是 text 模式的**唯一合法场景**——必须确认该段无产品 / 无角色延续需求；如有任何一项，**禁止**用 T11，必须用 T10（keyframe）或 T04/T05（reference）。

---

### T12 — `video_text_ugc_default`（UGC 默认 text 模式）

**适用场景**：commercial UGC 默认 text（用户真实口播场景，无首帧图）。

**硬编码参数**：

```javascript
mcp__multimedia-creator__agnes25_video_generate({
  mode: "text",                // UGC 默认 text（real human speaking, no keyframe）
  prompt: "{{style_anchor}}，真人主播口播带货：{{voiceover_full_excerpt}}（{{seconds}} 秒字数：12s 60-72 字 / 高密度 72-84 字）；分镜：{{ugc_segment_shots}}（4 段式 Cut1 0-2s hook / Cut2 2-5s 产品揭示 / Cut3 5-9s 卖点证明 / Cut4 9-12s packshot）；产品 {{product_name}} 视觉外观由 prompt 描述锁定（非 ref 模式，外观可能漂移，已在确认摘要明示降级）",
  seconds: "{{seconds}}",
  size: "720P",
  aspect_ratio: "9:16"
})
```

**何时升级到 T06**：用户上传主播图（creator_ref）→ 用 T06 reference 模式锁主播面部；用户上传产品图 → 必走 T06（**禁止**纯 text 描述产品外观）。

---

## 3. 模板选择决策表（一图选模板）

按 (分支 × ref 类型) 一眼选：

| 分支 \ ref 类型 | 无 ref | 已有 first_frame | 已有 product_ref | 已有 character_ref | 已有 brand_refs |
|---|---|---|---|---|---|
| **drama 普通段** | T11 (text) | T10 (keyframe) | **T04** (reference) | **T05** (reference) | N/A |
| **commercial UGC** | **T12** (text) | N/A | **T06** (reference) | **T06** (reference，person 位) | N/A |
| **commercial Marketing** | N/A | **T09** (keyframe) | **T07** (reference) | N/A | N/A |
| **commercial Corporate** | N/A | N/A | **T08** (reference) | N/A | **T08** (reference) |

**粗体** = 该分支涉及该 ref 类型时的**唯一合法模板**。其它模板禁止使用。

## 4. 调用前自检（11 项 gate，每条必过）

```text
[ ] (0)  产品图门控过吗？（涉及产品 → product-refs/ 有图，否则降级模式 ack 落 project.json.notes）
[ ] (1)  输入源是 HTTPS URL 吗？（本地路径 / base64 / file:// 全禁止）
[ ] (2)  prompt 是中文吗？（枚举值 / 参数键 / 数值字面量保留英文）
[ ] (3)  mode 与 params 互斥吗？（text 无图 / keyframe 有 first_frame / reference 有 images[]）
[ ] (4)  size / seconds / aspect_ratio 取值在合法范围吗？
[ ] (5)  first_frame 比例与 aspect_ratio 一致吗？（不一致先 T01 转比例）
[ ] (6)  image_paths[] / images[] 全是 HTTPS URL 吗？（不是本地路径）
[ ] (7)  style_anchor 一字不差贯穿吗？（与 project.json.style_anchor 对齐）
[ ] (8)  上一步 URL 已记到 project.json.notes <file_path> → <https_url> 映射了吗？
[ ] (9)  失败重试 ≤ 2 次？超 2 次 → 停下，【交由用户处理】（禁止继续重试 / 自主改 prompt / 自作主张）
[ ] (10) 任何失败【不得 fallback】（不降级 mode、不删 images[] 元素、不改 product_ref 到 text、不简化 prompt、不切 mode 跳过 ref、不擅自换工具）
[ ] (11) 【硬编码铁律】涉及 ref 的生成走对应 T 编号模板吗？images[] 顺序按 §0.4 排吗？negative block 已嵌入吗？
```

11/11 全过才允许调 MCP 工具。**任何一项不过 = 该阶段未完成**，必须停下补做。

### 4.1 重试铁律（用户 2026-09-08 收紧：retry 期间 0 微调）

**所有生成步骤**（image_generate / image_edit / video_generate，无论 mode）的重试策略：

```text
attempt 1 (initial)  →  fail
attempt 2 (retry #1) →  按 attempt 1 原样重试（0 微调：prompt 字句 / mode / images[] / aspect_ratio / size / seconds 全部冻结）
attempt 3 (retry #2) →  按 attempt 1 原样重试（同上 0 微调）
attempt 4 → 停下，原地待命，【交由用户处理】
```

**硬禁止（任何 attempt 都不允许的 fallback）**：
- 删 `images[]` 中任何一个 ref 元素
- 改 `mode`（reference ↔ keyframe ↔ text）
- 把 product_ref 退化成纯文本描述
- 切换工具（image_generate 失败 → 改 image_edit；image_edit 失败 → 改 image_generate）
- 改换模型供应商 / Runtime
- 简化 prompt（如去掉 negative block / 删 ref 引用 / 删 style_anchor）
- 用上一步产物 URL 重复当新图喂回去（避免 hallucination 累积）
- **retry 期间微调任何参数**（prompt 字句 / aspect_ratio / size / seconds 全部冻结；只接受 transient 错误通过，否则 attempt 4 撞墙交用户）

**attempt 4 停下时的标准动作**：
1. 把 attempt 1-3 的完整 prompt + 返回错误码 + URL 映射写到 `project.json.notes.last_failure`
2. widget emit `assets-error-card` / `video-segment-error-card`，附失败上下文
3. **不**输出"已生成 / 完成 / 成功"等措辞
4. 直接问用户：是否继续重试 / 调整 prompt / 调整 ref / 跳过本步 / 放弃本步

---

## 5. 集成清单（每阶段末落盘前自检）

见 `references/output-conventions.md` §7；本文件新增 3 项：

```text
[ ] product_image_gate: 用户 brief 含产品关键词 → product-refs/ 有图（否则降级模式 ack 落 project.json.notes）
[ ] mode_decision_recorded: 当前阶段 mode 选择依据落到 stage .md（如 "drama frame 阶段选 T10 keyframe 因为有 SEG01_START 首帧图"）
[ ] template_used: 调用走的 T 编号模板（如 "video_generate: T04 video_reference_drama_product"）落到 stage .md + project.json.notes
```

3 项 + output-conventions.md §7 八项 + mcp-usage-guide.md §7 二项 = 13 项集成清单。
