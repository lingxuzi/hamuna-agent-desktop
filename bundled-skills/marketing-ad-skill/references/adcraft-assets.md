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

**三视图生成顺序**（参考图集）：
1. `image_generate` 正面半身（无表情）
2. `image_generate` 左侧 45° 半身（微笑）
3. `image_generate` 右侧 45° 半身（特写侧脸）

→ 三张图作为 `reference mode` 的 `<Picture 1> <Picture 2> <Picture 3>` 输入。

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

**多镜头组生成顺序**（场景参考图集 5-7 张）：
1. 全景（建立场景）
2. 中景（人物 + 场景）
3. 特写（道具/产品）
4. 细节（光线/纹理）
5. 反打角度
6. （可选）俯拍
7. （可选）仰拍

→ 选 ≥3 张作为 `reference mode` 输入（≤5 张限制内）。

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

**约束**（AdCraft prop_design Do Not）：
- ❌ 不编产品卖点（hero product 的 selling_points 由 product_design 定）
- ❌ 不引入无关角色/无关场景
- ❌ 不抄 sibling capability prompt（与 character/scene 不重叠）
- ❌ forbidden_props 与 scene.forbidden 一致

---

## §3 资产复用流程（30s 营销广告典型）

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

**结论**：本文档是 AdCraft 资产优先规范的"Claude Code skill 版本"，用 prompt 复现平台能力，无法替代平台的资产存储/版本管理。
