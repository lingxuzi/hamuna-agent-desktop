# AdCraft 角色/场景资产优先规范（营销广告适配版）

> **来源**：AdCraft Character Asset Library + Scene Asset Library + Identity Master Pattern
> **本文档定位**：当营销广告含人物角色或具象场景时（如美妆博主种草 / 服饰穿搭 / 家居场景 / 角色代言），先建立"资产 identity"再生成，避免 AI 漂移。
> **何时加载**：用户提到角色（代言人/模特/演员/虚拟形象）或具象场景（家居/咖啡馆/办公室/户外）时。

---

## §1 角色资产优先规范（Identity Master · 9 字段）

**触发条件**：营销广告含 ≥1 个人物角色（真人/虚拟/历史人物/品牌 IP）。

**9 字段 Identity Master Prompt**（prompt 开头固定声明）：

```text
[角色 Identity Master · 必填 9 字段]
1. 姓名/代号: [例：Charlotte / 小红 / 品牌 IP 名]
2. 性别: [男/女/中性]
3. 年龄段: [例：25-30 岁区间，避免具体岁数避免 #12 content_policy]
4. 种族/肤色: [例：东亚黄种人暖黄肤色 / 高加索白皙肤色]
5. 发型发色: [例：黑色长直发及腰 / 棕色短卷发齐肩]
6. 体型: [例：标准身材 / 高挑纤瘦 / 微胖丰满 · 避开 #12 限制词]
7. 服装风格: [例：极简白色丝绸衬衫 + 黑色西装裤]
8. 标志性配饰: [例：金色耳钉 / 无框眼镜 / 品牌 logo 胸针]
9. 表情基调: [例：温暖治愈微笑 / 高冷疏离 / 活力动感]
```

**三视图生成顺序**（参考图集 · **纯色白底**）：
1. `image_generate` **正面**半身（无表情）
2. `image_generate` **背面**半身
3. `image_generate` **侧面**半身（左侧或右侧任一）

→ 三张图作为 `reference mode` 的 `<Picture 1> <Picture 2> <Picture 3>` 输入。

**强制约束（资产图通用 · 2026-09-22 新增）**：
- **背景**：纯色白底（`pure white background` / `solid white #FFFFFF background` / `plain white backdrop`），便于后续抠图、reference mode 锚脸、contact sheet 拼接
- **人物三视图**：必须正面 + 背面 + 侧面（左/右任一）3 张
- **场景图**：必须 4 个角度（见 §2）
- **道具图**：必须多角度 + 白底（见 §2.5）
- **禁止**：渐变背景 / 场景化背景 / 半透明叠加（避免 reference mode 误读环境信息 → 跨段漂移）

**多场景复用规则**：
- 角色不变 → 仅 `reference mode` 输入 + 场景描述变化
- 服装变化 → 重新跑一次三视图 + 重建 identity master
- 年龄/发型变化 → 必须重建 identity master（漂移风险高）

---

## §2 场景资产优先规范（Identity · 6 字段）

**触发条件**：营销广告含具象场景（家居/咖啡馆/办公室/户外/特定地点）。

**6 字段 Scene Identity Prompt**（每段视频 prompt 开头固定）：

```text
[场景 Identity · 必填 6 字段]
1. 地点类型: [例：现代极简公寓卧室 / 精品咖啡馆 / 户外公园 / 写字楼办公室]
2. 光照条件: [例：暖台灯左侧打光 / 落地窗自然光 / 霓虹灯夜景]
3. 色调风格: [例：暖棕色调 / 冷灰调 / 高饱和撞色]
4. 关键道具: [例：深棕色木质家具 / 绿植 / 工业风金属椅]
5. 景深与构图: [例：浅景深背景虚化 / 全景对称构图]
6. 禁止元素: [例：禁止窗光 / 禁止白天日光 / 禁止冷色调光源]
```

**多镜头组生成顺序**（场景参考图集 · **强制 4 角度 + 纯色白底**）：
1. **角度 1 · 全景**（建立场景 · 90° 正视）
2. **角度 2 · 中景**（人物 + 场景 · 45° 侧视）
3. **角度 3 · 特写**（道具/产品 · 微距）
4. **角度 4 · 反打/俯拍**（与角度 1 反方向 · 高低俯仰之一）

→ 4 张图作为 `reference mode` 的 `<Picture 1>~<Picture 4>` 输入。

**强制约束（2026-09-22 新增 · 与 §1 一致）**：
- **背景**：纯色白底（`pure white background`）— **场景图也用白底**（不是真实场景背景！），目的是把场景作为"几何/光线/构图锚点"而非环境信息，避免 reference mode 误读环境 → 跨段漂移到其他场景
- **白底 ≠ 抠图**：保留场景的几何结构（墙/地/窗/家具剪影）+ 光照方向，但抹去真实环境细节
- **4 角度必全**：不可只给 2-3 张，必须全景 + 中景 + 特写 + 反打/俯拍，缺一则 reference mode 漂移风险 +30%
- **禁止**：真实场景背景 / 渐变色 / 电影感环境（统一白底后由 prompt 文字描述"该场景实际是 XX 办公室"）

**场景锁定指令**（防 #8 漂移）：
每段 prompt 末尾固定加：
```text
视频全程严格在 [场景名] 场景，禁止场景漂移到任何其他场景。
```

---

## §2.5 道具资产优先规范（Identity · 6 字段 · AdCraft prop_design）

**触发条件**：营销广告含次要道具（除 hero product 外的复用道具）。如眼影盘 hero 之外的眼影刷、宵夜盒、咖啡杯等。

**6 字段 Prop Identity Prompt**：

```text
[道具 Identity · 必填 6 字段]
1. 名称: [例：木质眼影刷 / 红色塑料袋宵夜盒 / 透明咖啡杯]
2. 材质: [例：榉木 + 金属箍 / 红色塑料 / 双层玻璃]
3. 颜色: [例：暖棕色 + 金色 / 红色 + 品牌贴纸 / 透明]
4. 剪影: [例：细长锥形 + 圆润刷头 / 方形提手 / 圆柱带盖]
5. 比例（与 hero product）: [例：刷子长度 = 眼影盘直径 ×1.5 / 宵夜盒与主角手机同高]
6. 与品牌关联: [例：hero 配角锚点 / 竞品锚点 / 路人道具]
```

**跨段复用字段**（关键）：
- `recurs_across_segments`: true/false（是否跨段出现）
- `first_appearance_segment`: N（第几段首次出现）
- `continuity_lock_instruction`: 跨段锁定 prompt 句（如"红色塑料袋+品牌贴纸宵夜盒锚点跨段统一禁止漂移到牛皮纸袋"）

**多角度资产生成**（2026-09-22 新增 · 与 §1 §2 一致）：
- `image_generate` 道具时强制 **纯色白底**（`pure white background` / `solid white #FFFFFF`）
- 至少 **2-3 个角度**：正面 + 侧面 + 俯视（视道具类型增减）
- 目的：抠图、reference mode 锚定、跨段锁定
- hero product（主推产品）不在此列 → 走 §3 hero shot 涂抹/旋转，不强制白底

**约束**（AdCraft prop_design Do Not）：
- ❌ 不编产品卖点（hero product 的 selling_points 由 product_design 定）
- ❌ 不引入无关角色/无关场景
- ❌ 不抄 sibling capability prompt（与 character/scene 不重叠）
- ❌ forbidden_props 与 scene.forbidden 一致

---

## §3 Asset-First Pipeline（5 步铁律 · 2026-09-23 用户拍板）

**核心变更**：从"先生成剧本→然后顺带生成资产"改为"**先反推每个镜头所需资产 → 生成资产并赋予 ID → 用 ID 写分镜 prompt → 替换为实际 URL**"。

🔴 **CHECKPOINT 1**：进入 Pipeline 前确认 brief 完整（产品/品类/时长/平台/调性）→ 缺任一项先问用户，**禁止假设**。

### 5 步流程（不可跳序 · 不可逆 · 每步间必 🔴 确认）

| Step | 产出 | 工具 | 关键原则 | 🔴 卡点 |
|---|---|---|---|---|
| **1. 剧本** | `agent_script.json` | LLM | hook/body/cta + selling_points + dialogues + visual_directions — **不引用资产** | 🔴 剧本 8 句台词 / 5 场次确认 |
| **2. 分镜** | `agent_storyboard.json` | LLM | 离散分镜 + `<Picture N>` 占位 — **N 不绑定资产**，只表达"镜头需要什么参考" | 🔴 分镜 12s × N 段 + 3-4 discrete_shots/段确认 |
| **3. 资产需求清单** 🆕 | `agent_asset_plan.json` | LLM | **每个 storyboard shot 反推所需资产** → 同一资产被多镜头引用 = 1 次生成（复用优先）| 🔴 资产清单 + 复用率 ≥70% 确认（避免浪费 API）|
| **4. 资产生成 + ID 化** | `outputs/asset_<id>.png` | image_generate | 每个资产一次生成 · 文件名 = `asset_<id>.png` · `asset_index.json` 维护 id→url 映射 | 🔴 资产图视觉确认（白底 + 4 角度齐）+ 反手风险评估（#15）|
| **5. video_generate prompt 重写** | `agent_video.json` | video_generate | `<Picture N>` 按 **prompt 引用顺序**重映射（从 1 开始）· images 列表按 ID 顺序填充 · 仍走单元素数组铁律 | 🔴 audit_video_generate EXIT 0 + 双 audit 复跑验收 |

### Step 3 schema（`agent_asset_plan.json` · 🆕 新增）

```json
{
  "label": "<project> · Asset Plan · N 资产跨 M 镜头复用",
  "assets": [
    {
      "id": "lin_xiaoxi_3view",
      "type": "character",
      "purpose": "林小溪立绘 · Seg1 全部 + Seg3 sub1+2 复用",
      "image_generate_step": 1,
      "used_in_shots": ["seg1_shot1", "seg1_shot2", "seg1_shot3", "seg3_shot1", "seg3_shot2"]
    },
    {
      "id": "glass_bowl_heroshot",
      "type": "prop",
      "purpose": "玻璃碗 hero shot · Seg2 全部 + Seg3 sub3 复用",
      "image_generate_step": 2,
      "used_in_shots": ["seg2_shot1", "seg2_shot2", "seg2_shot3", "seg2_shot4", "seg3_shot3"]
    }
  ],
  "shots_without_asset": ["seg2_shot2"],
  "reuse_rate": "8/9 = 88.9% （9 镜头中 8 个复用资产）"
}
```

### Step 4 schema（`asset_index.json` · 🆕 新增）

```json
{
  "version": 1,
  "assets": {
    "lin_xiaoxi_3view": {
      "type": "character",
      "file": "outputs/asset_lin_xiaoxi_3view.png",
      "url": "https://cos-platform-outputs.agnes-ai.cn/.../output_xxx.png",
      "prompt_summary": "3-view contact sheet of East Asian woman (cream T + gray shorts + slippers)",
      "generated_at_step": 1
    },
    "glass_bowl_heroshot": {
      "type": "prop",
      "file": "outputs/asset_glass_bowl_heroshot.png",
      "url": "https://cos-platform-outputs.agnes-ai.cn/.../output_xxx.png",
      "prompt_summary": "Top-down macro hero shot of transparent glass bowl with oatmeal layers",
      "generated_at_step": 2
    }
  }
}
```

### Step 5 Picture N 重映射铁律（核心）

```
prompt 第一次提到 林小溪 → <Picture 1> = lin_xiaoxi_3view
prompt 第一次提到 玻璃碗 → <Picture 2> = glass_bowl_heroshot
images=["https://...lin_xiaoxi_3view.png", "https://...glass_bowl_heroshot.png"]
```

**铁律**：
1. **video_generate images 仍单元素数组**（harness 序列化坑不变）→ 1 张参考
2. **Picture N 由"该段 prompt 引用顺序"决定** → 同一资产在 Seg1 是 Picture 1，在 Seg2 可能因引用顺序变成 Picture 2
3. **多参考时合成 1 张 contact sheet**（2×2/3×2 拼图）再传 images=[1张] → 避免 #15 多手/反手 bug
4. **重复检测**：Step N 与 Step N-1 都是同类资产（如"玻璃碗 3 视图"与"玻璃碗 hero shot"重叠）→ 合并 step

### 防浪费 4 条（HL-2 if-then 三段式 · 触发 / 一线修复 / 仍失败兜底）

| 检查 | 触发条件 | 一线修复 | 仍失败兜底 |
|---|---|---|---|
| **重复检测** | Step N 与 Step N-1 同类型资产（如"玻璃碗 3 视图" + "玻璃碗 hero shot"重叠）| 合并到 1 个 step · 取用途更广的角度 | 保留两者 · 在 asset_plan.json 加 `note: 重复但角度互补` |
| **使用率审计** | 资产生成后 `used_in_shots` = 0（未被任何 video_generate 引用）| 删 unused 资产 + 从 asset_index.json 移除 | 保留 + 在 plan 加 `note: 备用资产 · 可能跨项目复用` |
| **多段复用优先** | 同一资产被 ≥2 镜头引用（reuse_rate ≥70%）| ✅ 标记为最佳实践 · Step 4 优先生成 | 复用率 < 70% → 检查 Step 3 拆资产太细 → 合并同类镜头 |
| **空镜头检测** | `shots_without_asset` 非空（如 macro 蜂蜜淋下慢镜无人物/无道具）| 纯文字 prompt + scene lock 即可（无需资产）| 补生成对应资产（如 macro 蜂蜜参考图）|

### 反例与黑名单（dim9 · 不要做什么）

| # | 反模式 | 为什么不要 | 替代做法 |
|---|---|---|---|
| 1 | **先写分镜再补资产** | 资产已生成才发现"该镜头需要新参考" → 重跑浪费 API | 先反推每个镜头所需资产（Step 3）|
| 2 | **Picture N 在分镜阶段绑定资产 ID** | 资产 ID 后定（如 lin_xiaoxi_3view），分镜先写 `Picture 1` 后 ID 映射错位 | Picture N 在 Step 5 按 prompt 引用顺序重映射（从 1 开始）|
| 3 | **同一资产生成 2 次（不同 prompt）** | API token 浪费 · 视觉一致性破坏 | Step 3 资产清单去重 · 1 个 ID 对应 1 次 image_generate |
| 4 | **images=[] 多元素数组** | harness 序列化成 dict 报错（`Input should be a valid list`）| 单元素数组铁律不变 · 多参考 → contact sheet 合成 1 张 |
| 5 | **asset_id 命名含 `step1/2/3` 等步骤序号** | 资产 ID 应语义化（lin_xiaoxi_3view）不是流程化 | 命名格式：`{type}_{subject}_{view}` 三段式 |
| 6 | **跳过 Step 3 直接进 Step 4** | 资产生成后才发现某镜头无对应参考 | Step 3 必跑 · 复用率审计后再生成 |
| 7 | **asset_index.json 用相对路径** | video_generate images 需要 HTTPS URL（非本地路径）| 上传到 img.remit.ee 或用 generation 返回的 public URL |
| 8 | **shots_without_asset 全空（100% 复用）就跳过** | 可能漏了"空镜头"（如纯 macro 蜂蜜淋下）| Step 3 必扫 storyboard.segments[].discrete_shots[].prompt 检查是否有"X 资产"字样 |

### 与旧 §3 流程对比

| 旧 §3 | 新 Asset-First（Step 1-5）|
|---|---|
| A 角色 + B 场景 + C 视频 + D 拼接 | 剧本 → 分镜 → **资产需求清单（新增）** → 资产生成 ID 化 → **prompt 重映射（新增）** |
| 资产生成无清单 → 可能浪费 | **Step 3 复用率审计**：每资产生成前确认 used_in_shots ≥1 |
| 图片文件名 = `asset_character_3view.png` 等通用名 | **文件名 = `asset_<id>.png`** + asset_index.json 维护 url 映射 |
| Picture N 在分镜阶段绑定资产 | **Picture N 在 Step 5 才按 prompt 引用顺序重映射** |

---

## §3.1 资产复用流程（旧表 · 保留作 30s 快速参考）

| 阶段 | 步骤 | 工具调用 |
|---|---|---|
| **A. Identity 建立** | 跑 9 字段角色 + 6 字段场景 + **6 字段道具** identity master prompt | 1-3 次 image_generate |
| **B. 三视图/多镜头组** | 角色三视图 + 场景 5-7 张 + **道具多角度 2-3 张** | 5-10 次 image_generate |
| **C. 视频段生成** | 段 1/2/3 用 `reference mode` 输入 identity + scene + prop 图 | 3 次 video_generate |
| **D. 拼接 + 字幕** | ffmpeg concat demuxer + drawtext 后压 | ffmpeg |

**Asset 重用决策树**：

```
广告中含人物？ → 是 → 跑 §1 角色 identity + 三视图
              ↓ 否
广告中含具象场景？ → 是 → 跑 §2 场景 identity + 多镜头组
                    ↓ 否
广告中含跨段复用道具？ → 是 → 跑 §2.5 道具 identity + continuity_lock_instruction
                              ↓ 否
走纯产品/产品特写 → 不需要资产，直接 §3 hero shot 强制规则
```

---

## §4 失败模式（资产相关）

| # | 模式 | 触发 | 修复 |
|---|---|---|---|
| #A1 | 角色跨段脸漂移 | 多段 video_generate 用 text mode | 改 reference mode + 输入三视图 |
| #A2 | 场景漂移到白天窗边 | 涂抹场景默认 window light | 删"morning sunlight"等暗示 + 暖台灯锁定 |
| #A3 | 服装变化后脸也变了 | 服装描述改变同时影响脸部 | 服装变化 → 重建 identity master |
| #A4 | 种族/年龄触发 #12 | "middle-aged+chubby+wrinkles+smile" | 删 wrinkles/smile/chubby + 改年龄区间 |

---

## §5 完整 SOP 应用示例（美妆博主种草 30s）

```text
[A] Identity Master
角色：小美（25-30 岁东亚女，黑色长直发，标准身材，丝绸睡衣，温暖微笑）
场景：现代极简公寓卧室（暖台灯左侧打光，暖棕色调，深棕色木质家具）

[B] 资产生成
- image_generate 角色三视图（正/侧45°/特写）→ 3 张
- image_generate 场景全景 + 中景 + 特写 → 3 张
共 6 张参考图

[C] 段拼接 30s
段 1 12s（reference mode · 角色三视图 + 场景全景）：小美坐在卧室梳妆台前开场
段 2 12s（reference mode · 角色特写 + 场景特写）：小美涂抹产品 6s + 效果展示 6s
段 3 6s（reference mode · 角色 + 产品）：小美展示效果 + 价格 CTA

[D] ffmpeg concat + drawtext 后压（按 §7.3 4 句字幕）
```

---

## §6 与 AdCraft 平台的关系

| 维度 | AdCraft 平台 | marketing-ad-skill（本文档）|
|---|---|---|
| 资产存储 | PostgreSQL + Asset Library + 版本管理 | 无（每次 image_generate 重新出图）|
| 资产复用 | 跨项目跨工作流引用 | 单次 SOP 内复用 |
| 三视图自动化 | Character Designer Agent 自动出 | Claude 按 §1 9 字段 prompt 出 |
| 场景多镜头自动化 | Scene Designer Agent 自动出 | Claude 按 §2 6 字段 prompt 出 |
| 资产 ID 追踪 | UUID + version + 项目引用 | 无 |

**结论**：本文档是 AdCraft 资产优先规范的"Agent Skill 版本"，用 prompt 复现平台能力，无法替代平台的资产存储/版本管理。
