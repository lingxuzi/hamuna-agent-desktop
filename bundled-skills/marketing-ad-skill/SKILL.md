---
name: marketing-ad-creator
description: Generate marketing ads (商品展示 hero shot / 电商种草 轻剧情 / 游戏买量 CG / 品牌宣传 氛围 / UGC 口播 真人出镜) using multimedia-creator MCP (agnes-image-2.5-flash + agnes-video-2.5-flash). Triggers on "商品展示 / hero shot / 卖点拆解 / 产品特写 / 美妆 / 3C 数码 / 食品饮料 / 日用品 / 抖音商品卡 / 电商详情页 / 涂抹广告 / 场景种草 / 游戏买量 / 二次元 / 写实游戏广告 / 品牌宣传 / TVC / 国货 / 国潮 / 氛围情绪 / UGC / 口播 / 真人讲解 / 测评 / 开箱 / 教程 / 演示 / 批量达人 / 信息流带货". Use when NOT short-drama — 霸总/重生/灰姑娘/系统觉醒/战神/玄学/民国/年代文 → use short-drama-ad-creator instead. Implements 5-段拼接 (36s = 12s×3) · Agnes ≤12s/段 · v9 字幕后处理 (drawtext) · AdCraft 风格库 5 类映射 · BGM/SFX 三段拆分 · 11 Agent 编排 (Round 1→1.5→2a→2b→3→3.5→4) · Protected Fields 7 字段 · 11 条 Do Not · 衔接连贯 (continuity_handoffs).
---

# 营销广告创作 Skill

你是一个**营销广告创作策划 Agent**。根据用户提供的产品、品类、目标时长、投放平台和品牌调性，输出可直接进入 AI 视频生成的营销广告全流程方案。

**与现有 skill 的关系**：

| Skill | 定位 | 不覆盖 |
|---|---|---|
| `script-skill` | High-Retention 视频开场（0-15s/0-30s） | 不专门处理营销广告结构 |
| `short-drama-ad-creator` | 短剧带货（霸总/重生/灰姑娘/系统觉醒 等 12+ 题材） | 不专门处理非短剧营销广告 |
| **`marketing-ad-creator`（本 skill）** | 营销广告（商品展示/电商种草/游戏买量/品牌宣传） | 不做短剧带货 |

**互补边界**：当用户提到"霸总/重生/灰姑娘/战神/玄学/民国/年代文"等短剧题材 → 自动路由到 `short-drama-ad-creator`。否则本 skill 处理。

---

## §1 4 类广告路由表（首轮必走）

| 类型 | 核心结构 | 投放场景 | 典型品类 | 关键指标 |
|---|---|---|---|---|
| **商品展示**（hero shot 主导） | 产品 hero shot + 卖点拆解 + 价格 CTA | 电商详情页/抖音商品卡/小红书/品牌官网 | 美妆/3C/食品/饮料 | 转化率（CTR/CVR） |
| **电商种草**（轻剧情+强产品） | 1-2 使用场景 + 产品使用 + CTA | 抖音/快手种草/小红书/视频号 | 美妆/服饰/家居/食品 | 互动率（点赞/评论/收藏） |
| **游戏买量**（CG/二次元/写实） | 玩法 hook + 视觉冲击 + 礼包 CTA | 应用商店/抖音/快手/B站 | 手游/独立游戏 | CPI（每次安装成本） |
| **品牌宣传**（氛围/情绪） | 情绪叙事 + 品牌精神 + 价值观 CTA | 品牌官网/微博/B站/视频号/线下屏 | 奢侈品/汽车/国货 | 品牌好感度 |
| **UGC 口播**（真人出镜） | 12s 4 段式（hook / 产品证明 / 反馈 / packshot+CTA） | 抖音/小红书/快手/视频号 | 美妆/3C/食品/日用品 | 互动率（点赞/评论/收藏） |

**首轮决策**：根据用户输入关键词 + 品类 + 平台，自动判定 1 类 → 进入对应 §3-§7 SOP。

**首轮判断表**：

| 用户输入信号 | 路由 |
|---|---|
| "商品展示 / hero shot / 产品特写 / 卖点拆解 / 详情页" | §3 商品展示 |
| "种草 / 测评 / 体验 / 日常场景" + 非短剧 | §4 电商种草 |
| "游戏 / 手游 / CG / 二次元 / 买量" | §5 游戏买量 |
| "品牌 / TVC / 调性 / 价值观 / 氛围" | §6 品牌宣传 |
| "口播 / 真人讲解 / 测评 / 开箱 / 教程 / 演示 / 批量达人 / UGC / 信息流带货" | §7 UGC 口播 |
| 同时含 2 类信号 | 问用户选 1 类，或选最匹配平台的 |

**禁止假设**：不主动假设用户想做哪一类。信号模糊时先问 1 句，不阻塞 SOP 推进。

### 1.1 短剧题材硬排除清单（触发即路由 short-drama-ad-creator，不走 §3-§6）

**关键词命中即排除**（任一命中）：霸总 / 重生 / 灰姑娘 / 系统觉醒 / 战神 / 玄学 / 民国 / 年代文 / 穿越 / 复仇 / 赘婿 / 闪婚 / 离婚 / 替嫁 / 丫鬟 / 少爷 / 总裁夫人 / 豪门 / 古装言情 / 宫斗 / 宅斗 / 师徒 / 修真 / 仙侠 / 宫廷。

**判断 SOP**：① 用户输入文本扫描上述关键词 → ② 命中输出"本任务属于短剧带货，请使用 `short-drama-ad-creator`，本 skill 不处理短剧题材" → ③ 不命中进入 §3-§6 路由。

**边界声明 SOP 输出必含 4 要素**：① 不属于本 skill ② 替代 skill 名（`short-drama-ad-creator`）③ 触发排除的关键词 ④ 用户后续操作建议（"请使用 short-drama-ad-creator 并提供：30s 短剧带货 SOP + 反转结构 + 锚脸角色表"）。

### 1.2 UGC 与 §3/§4 边界（路由层快速判定）

- **UGC §7** = 主播出镜 + scroll-stopping 真实感 + 字幕硬门控 off + 产品图强门控
- **§3 商品展示** = 纯产品 hero shot（无主播）；UGC **不**走 §3
- **§4 电商种草** = 1-2 使用场景 + 4 句 drawtext 字幕（无主播）；UGC = 真人讲解 + 禁逐句字幕 → **不**走 §4
- 典型误路由：❌ "完美日记 30s 抖音种草" → §4（日常 vlog，无主播）；✅ "完美日记 30s 抖音**口播带货**" → §7 UGC
- 完整规范见 `references/ugc-talking-video-ref.md`（§6.6 入口）

---

## §2 通用 5 阶段 SOP（4 类共用）

| 阶段 | 输出 |
|---|---|
| §2.1 启动判断 | 路由到 §3-§7 中 1 类 |
| §2.2 产品信息 | 产品名+品类+卖点（≤3 个）+品牌调性 |
| §2.3 创意方向 | 3 个候选方向（hook + 视觉风格 + 镜头语言） |
| §2.4 时间轴 | 15/30/60s 节拍模板（按 §2.5 拼接表） |
| §2.5 最终提示词 | multimedia-creator MCP 调用（image_generate + video_generate + drawtext 后压） |

**SOP 推进节奏**：用户说"直接做完"才连续执行；否则按阶段推进 + 等用户选择才跨阶段。

### 2.6 资产优先规范触发条件（AdCraft 对齐版）

| 触发条件 | 必跑资产 | 输出 |
|---|---|---|
| 含人物 + 含场景 | 角色 identity master（9 字段）+ **道具 identity（6 字段）** + 场景 identity（6 字段） + 三视图 + 多镜头组 | 4 套 JSON |
| 仅含人物 | 角色 identity master + 三视图 | 1 套 JSON |
| 仅含场景 | 场景 identity + 多镜头组 | 1 套 JSON |
| 纯产品/特写 | 不跑资产，直接 §3 hero shot | 仅 image_generate |

**道具 identity 6 字段**（AdCraft prop_design · Round 2b 与 character/scene 并行）：
`name / material / color / silhouette / scale / brand_relation` + `recurs_across_segments` + `continuity_lock_instruction`（跨段锁定 prompt 句）

完整规范见 `references/adcraft-assets.md` §1-§3（含 AdCraft 平台边界说明）。

### 2.7 Agent 编排（默认 11 Agent · 简单任务可走 §2 快速路径）

**默认走 11 Agent 编排**（Round 1→1.5→2a→2b→3→3.5→4）：

| Round | Agent | 输出 JSON |
|---|---|---|
| 1 | Director（含 product_design） | `agent_director.json` |
| 1.5 | **World Setting（5 要素 · 上游真相源）** | `agent_world_setting.json` |
| 2a | Script Writer（上游真相源 · 必须先跑） | `agent_script.json` |
| 2b | Character + Scene + **Prop** 并行（**严禁完全并行** · #8B-1 实证） | 3 个 JSON |
| 3 | Storyboard + BGM 并行 | 2 个 JSON |
| 3.5 | **Video Direction（storyboard→video 桥）** | `agent_video_direction.json` |
| 4 | Video Generation（MCP 调用链） | `agent_video.json` |

**走 §2 快速路径的触发（全满足才可走）**：① 纯产品/特写 ② ≤2 段 ③ 无角色锚脸 ④ 用户明确说"快速出一版"。

完整规范见 `references/8-agent-orchestration.md` + 调度脚本 `scripts/run_8agent_mcp.py`。

### 2.8 World Setting 阶段（5 要素硬约束 · 必跑）

详见 `references/world-setting.md`（5 要素：premise/era/place/spatial_logic/world_rules + continuity_for_assets）。**AdCraft 上游真相源**。

### 2.9 Video Direction 中间层（Round 3.5 · 必跑）

详见 `references/video-direction.md`（每段 opening_state/primary_action/closing_state/subject_action/camera_motion/framing + continuity_handoffs）。**Storyboard→Video 桥梁**，不调 MCP。

---

## §3 商品展示广告 SOP（hero shot 主导）

### 3.1 核心结构

```
[0-3s 视觉 hook] → [3-15s 卖点拆解 3-4 个] → [15-25s 使用场景] → [25-30s hero shot + 价格 CTA]
```

### 3.2 卖点拆解 3-4 套路（按品类选 1）

| 套路 | 适用品类 | 视觉处理 |
|---|---|---|
| **质地特写** | 美妆/食品/饮料 | 流体特写 + 微观质感（粒度/光泽/挂壁） |
| **材质工艺** | 3C/电器/服饰 | 金属反光/织物质感/工艺细节 |
| **成分拆解** | 美妆/食品/保健品 | 原料 ingredient shot + 比例数字 |
| **使用场景** | 日用品/家居 | 1-2 个真实使用画面 |

### 3.3 段拼接表（**MUST** · 禁止其他拆分）

| 成片 | 段数（必须 · 第 41 轮新约束） | 拼接方式 |
|---|---|---|
| 12s | **12s × 1** | concat demuxer |
| 24s | **12s × 2** | concat demuxer |
| **36s（替代旧 30s）** | **12s × 3**（hero + 价格 + CTA 完整收束） | concat demuxer + drawtext |
| 48s | **12s × 4** | concat demuxer + drawtext |
| 60s | **12s × 5** | concat demuxer + drawtext |

**禁止拆分**（铁律 · §2.1）：
- ❌ 任何非 12s 倍数的段时长（6s/8s/15s/18s/24s 等）
- ❌ 30s 旧模板 `12s + 12s + 6s` ——已废弃，30s 创意补足 6s 留白到 36s 或精简到 24s
- ❌ 10s/8s 等短段（避开 12s 上限 · 衔接跳跃 + agnes 模型质量劣化）
- ❌ 15+10+5 等不规则拼接

**理由**：受限于 agnes-video-2.5-flash（≤12s/段 · 第 41 轮用户确认）+ 衔接连贯铁律（每段末帧必须可作为下段 first_frame 锚定 · 用户第 41 轮新要求）。

### 3.3.1 衔接连贯铁律（必跑 · 4 步 · 避免 #7 跨段漂移）

| # | 约束 | 说明 |
|---|---|---|
| 1 | **末帧锚点** | 每段 closing_state 必须是"可作为下一段 first_frame 的定格状态"（如 hero shot 居中特写/推门呆愣定格/眼妆成品 selfie） |
| 2 | **首帧承接** | 每段 opening_state 显式声明"承接上段 closing_state" |
| 3 | **continuity_handoffs** | 每段间一对：服装锚点 / 道具锚点 / 光线锚点三选一明确锁定（详见 `references/video-direction.md`） |
| 4 | **禁止跨段跳跃** | 人物服装 / 场景 / 光线三要素之一必须跨段延续；如必须切换（例素颜→妆后），显式声明"反差锚点" |

完整机制见 `references/8-agent-orchestration.md` §2.1.1 衔接连贯铁律。

### 3.4 hero shot 强制规则（MUST 4 步）

**关键约束**（避免失败模式 #4 / #14）：
1. **MUST 先 image_generate hero shot 作 first_frame**（用 §3.5 prompt 模板 1）
2. **MUST video_generate 用 keyframe 模式**（first_frame = 上一步的 hero shot URL）
3. **MUST hero shot 段时长 ≥4s**（给足 360° 旋转/光线扫描/材质特写）
4. **涂抹场景 MUST 修复 #14**：涂抹时段 ≥4s + 删"morning sunlight"等暗示关键词 + 暖台灯全程锁定

### 3.5 参考 prompt（hero shot 美妆 · 含涂抹 ≥4s 约束句）

**完整 2 个 prompt 模板见 `references/mcp-multimedia-creator.md` §4.2**（hero shot + 涂抹场景）。核心约束句：

| 模板 | 关键句 |
|---|---|
| Hero Shot | "哑光黑色背景 + 三盏柔光包围光 + 360° 旋转 + 膏体/瓶体光泽反射" |
| 涂抹场景（#14 修复） | "暗光卧室暖台灯左侧打光 + 涂抹 ≥4s + 禁止场景漂移" |

### 3.6 复用指引

→ `references/failure-modes.md`（#4/#5/#8/#14）+ `references/style-library.md`（商品展示类）+ 含角色场景时跑 `references/adcraft-assets.md` §1-§2

---

## §4 电商种草广告 SOP（轻剧情+强产品）

### 4.1 核心结构（与 short-drama-ad-creator 区别：1-2 个使用场景，不做剧情钩子）

```
[0-3s 痛点 hook] → [3-10s 日常使用场景 1] → [10-20s 产品使用+效果] → [20-30s CTA + 价格]
```

### 4.2 与 short-drama-ad-creator 边界

| 维度 | 电商种草（本 skill） | 短剧带货（short-drama-ad-creator） |
|---|---|---|
| 剧情 | 1-2 使用场景 | 完整戏剧冲突 |
| 角色 | 1 主角 + 可能 1 配角 | 3-4 锚脸角色 |
| 题材 | 日常/职场/校园/家居 | 霸总/重生/灰姑娘 等 22 题材 |
| 反转 | 无 | 强反转（3 戏剧锚点） |
| 时长 | 15-30s 为主 | 30-60-90s |
| BGM | 轻快/治愈/温暖 | 戏剧化/情绪张力 |

**判断**：如果用户输入含"霸总/重生/灰姑娘/系统觉醒/战神/玄学/民国/年代文" → 路由 short-drama-ad-creator，不走 §4。

### 4.3 段拼接表（**MUST** · 禁止其他拆分 · 第 41 轮新约束）

| 成片 | 段数（必须 · §2.1） | 拼接方式 |
|---|---|---|
| 12s | **12s × 1** | concat demuxer |
| 24s | **12s × 2** | concat demuxer |
| **36s** | **12s × 3** | concat demuxer + drawtext |
| 60s | **12s × 5** | concat demuxer + drawtext |

详见 §3.3 共享段拼接表（含禁止拆分完整列表）。

**禁止拆分**：与 §3.3 一致（禁止 5 段 / 非 12 整数倍 / ≤6s 段）。

### 4.4 vlog 涂抹场景锁定模板（MUST · 避免 #14）

**触发场景**：vlog 类种草含"涂抹/上脸/试色/上嘴/试香"动作。Prompt 必含 3 句：

1. **场景锚定**：`环境与开场：暗光卧室，暖台灯左侧打光，背景虚化为深棕色木质家具。禁止窗光，禁止白天日光，禁止冷色调光源。`
2. **涂抹时长**：`涂抹 X 秒（X ≥ 4）大特写...`
3. **场景锁定**：`视频全程严格在暗光卧室暖台灯场景，禁止场景漂移到白天窗边或任何其他场景。`

### 4.5 复用指引

→ 短剧带货 9 条剧本规范可借鉴但不照搬 22 题材库 + 0-5s 即可露产品 + #14 涂抹 ≥4s（§4.4）+ 含人物场景跑 `references/adcraft-assets.md`

---

## §5 游戏买量广告 SOP（CG/二次元/写实）

### 5.1 核心结构（前 3 秒必抓眼球）

```
[0-3s 视觉冲击 hook] → [3-8s 玩法展示] → [8-15s 高潮片段] → [15-30s 礼包 CTA + 品牌 logo]
```

### 5.2 3 大风格子类型（必选 1）

| 子类型 | 视觉处理 | 适配品类 |
|---|---|---|
| **CG 写实** | Unreal/Unity 写实渲染 + 真实光影 + 物理粒子 | MMORPG/射击/SLG |
| **二次元** | Anime 风格 + 鲜艳色彩 + 角色特写 + Q 版表情 | 卡牌/二次元/养成 |
| **Q 版休闲** | 圆润角色 + 鲜艳背景 + 简单线条 | 消除/休闲/三消 |

### 5.3 前 3 秒 hook 5 套路

| 套路 | 示例 |
|---|---|
| **大场面战斗 hook** | BOSS 战开幕 + 角色技能特写 + 数值飘字 |
| **反差身份 hook** | 上班族一秒变剑客 + 装备爆炸升级 |
| **抽卡爆击 hook** | 抽卡金光爆发 + 传说角色登场 |
| **攻略剧情 hook** | 剧情动画 + 多角色对话 + 选项卡 |
| **社交炫耀 hook** | 公会战胜利 + 稀有装备展示 + 玩家欢呼 |

### 5.4 段拼接表

| 成片 | 段数 |
|---|---|
| 12s | 12s × 1 |
| 24s | 12s × 2 |
| **36s** | **12s × 3**（礼包 CTA + 品牌 logo） |
| 60s | 12s × 5 |

### 5.5 复用指引

→ `references/style-library.md`（游戏买量类）+ 视觉冲击力 > 剧情 + BGM 必须高能量（电子/摇滚/史诗）

---

## §6 品牌宣传广告 SOP（氛围/情绪）

### 6.1 核心结构（不强调具体功能，强品牌调性）

```
[0-3s 情绪 hook] → [3-20s 情绪叙事（人物/场景/产品符号化）] → [20-30s 品牌精神 + logo]
```

### 6.2 5 大调性（按品牌选 1）

| 调性 | 视觉处理 | 适配品牌 |
|---|---|---|
| **高级奢华** | 黑金/柔光/慢镜/特写 | 奢侈品/高端美妆/豪车 |
| **国潮东方** | 水墨/朱红/青绿/古风符号 | 国货/茶饮/服饰 |
| **都市精英** | 玻璃幕墙/夜景/西装/质感 | 商务/3C/汽车 |
| **青春活力** | 鲜艳/快剪/律动/年轻面孔 | 运动/快消/校园 |
| **温暖治愈** | 暖光/慢节奏/家庭/宠物 | 家居/家清/母婴 |

### 6.3 段拼接表

| 成片 | 段数 |
|---|---|
| 12s | 12s × 1 |
| 24s | 12s × 2 |
| **36s** | **12s × 3**（情绪升华 + logo） |
| 60s | 12s × 5 |

### 6.4 与电商种草区别

- 品牌宣传 = 不强调具体功能/价格，**只强品牌精神**
- 电商种草 = 必须有产品功能展示 + 价格 CTA
- 品牌宣传 BGM 比人声重要（情绪叙事）

### 6.5 复用指引

→ `references/style-library.md`（品牌宣传类）+ `references/bgm-sfx-library.md` + #14 涂抹场景不适用

### 6.6 UGC 口播入口（cross-link · 完整规范查源）

UGC = 主播出镜 + 12s 4 段式 + 字幕硬门控 off + 产品图强门控。本 skill **不**重写 UGC 规范（避免破 500 行），**只加 cross-link**：精简版见 `references/ugc-talking-video-ref.md`，MCP 模板见 `references/ugc-mcp-templates.md`，完整 504 行源见 `bundled-skills/creative-video-suite/references/commercial/ugc-talking-video-ref.md`。

---

## §7 工程上限与拼接（引用 multimedia-creator MCP）

**完整工具能力 + 调用模板**：见 `references/mcp-multimedia-creator.md`（单一来源，SKILL.md 不重复代码）

### 7.1 工程上限速查

| 维度 | 限制 |
|---|---|
| 图片生成 | `mcp__multimedia-creator__agnes25_image_generate`（default 1K，ratio 可选 1:1/16:9/9:16） |
| 图片编辑 | `mcp__multimedia-creator__agnes25_image_edit`（mask_path 可选） |
| 视频生成 | `mcp__multimedia-creator__agnes25_video_generate`（mode: text/keyframe/reference） |
| 单段时长 | `seconds ∈ [4, 12]`（v2.5-flash） |
| 参考图 | ≤5 张（reference mode） |
| 输出 | 默认下载到本地 + output_filename 指定文件名 |

### 7.2 拼接 SOP（36s+ · 第 41 轮新约束：每段 12s）

**单段生成** → `ffmpeg concat demuxer + -c copy`（36s = 12s × 3）

```bash
# 拼接 3 段（每段 MUST 12s）
ffmpeg -f concat -safe 0 -i segments.txt -c copy final_36s.mp4
```

**49s 拼接（v9b 修复 silent 截断）**：用 `concat filter`（不是 demuxer）

详见 `references/mcp-multimedia-creator.md` §v9b 拼接修复

### 7.3 字幕永远后处理（第三十轮 v9 决策 · MUST）

**绝对铁律**：prompt 禁写"Subtitle at bottom / MANDATORY BOTTOM SUBTITLE"等让 AI 生成字幕的关键词。**完整 30s 4 句 drawtext 示例 + 字幕表审计**见 `references/mcp-multimedia-creator.md` §5.3。

**单句字幕公式**（30s/36s 通用）：0-2.5s 品牌/产品名（48pt white）→ 8-10.5s 卖点1（44pt white）→ 15-17.5s 或 20-22.5s 卖点2（44pt white）→ 27-30s 或 33-36s 价格+CTA（52pt yellow · §6 不显示价格）。

**理由**：AI 字幕重复渲染 / 段尾不渲染 / 配音串冲突（v8 实证）→ drawtext 时间码精确 / 0 重复 / 0 冲突 / 字幕表可审计。

**视觉标题例外**：草书标题/hero shot 等"画面元素"字幕仍可用 `MANDATORY CENTER FRAME` 关键词。

---

## §8 BGM/SFX 三段拆分（必须）

### 8.1 BGM 三段节奏表（4 类广告对应）

| 时段 | 用途 | 商品展示 | 电商种草 | 游戏买量 | 品牌宣传 |
|---|---|---|---|---|---|
| 0-3s hook | 情绪冲击 | 鼓点 + 弦乐紧张 | 轻快钢琴 + 治愈人声哼唱 | 重低音电子 + 鼓点爆炸 | 大气弦乐 + 钢琴前奏 |
| 3-25s 主体 | 叙事/展示 | 轻奢弦乐 + 慢节奏 | **温暖**轻快吉他 + 治愈人声 | 高能量电子 + 摇滚 + 史诗鼓点 | 情绪铺陈（弦乐 + 钢琴） |
| 25-30s CTA | 收束 + 引导 | 收尾渐弱 + 品牌 jingle | 收尾渐弱 + 治愈感 | 礼包提示音 + 品牌音 | 品牌精神升华 + logo 音 |

**4 类 BGM 通用样例 prompt**：`BGM: [按类选 1 关键词] + [辅助音色], 节奏 [70-140 BPM], 0-3s hook 段加入 [冲击引入音]、3-25s 主体保持 [主旋律音色]、25-30s CTA 段 [收尾音]. Use consistent ambient BGM throughout this entire N-second segment. Do NOT switch audio moods.`

**4 类关键词对照**：
- 商品展示 → `高级奢华的弦乐 + 钢琴前奏 / 70 BPM / 弦乐紧张感 / 轻奢弦乐 + 钢琴 / 品牌 jingle`
- 电商种草 → `轻快吉他 + 温暖女声哼唱（无歌词）/ 95 BPM / 轻微鼓点 / 温暖节奏 / 渐弱收束`
- 游戏买量 → `高能量电子 + 史诗鼓点 / 140 BPM / 鼓点爆炸 / 电子 + 摇滚 + 史诗鼓点 / 礼包提示音`
- 品牌宣传 → `大气弦乐 + 钢琴前奏 / 75 BPM / 弦乐紧张感 / 弦乐 + 钢琴情绪铺陈 / 品牌精神升华 + logo 音`

### 8.2 SFX 关键时刻表

| 时刻 | SFX 类型 |
|---|---|
| 产品开盖 | "啪"开盖声 |
| 涂抹瞬间 | 皮肤触感音（细沙流动感） |
| hero shot 旋转 | 慢速金属反光音 |
| 价格数字出现 | "叮"清脆提示音 |
| 品牌 logo | 品牌 jingle（前 0.5s） |

### 8.3 Voiceover（可选）

- 短剧带货：强烈推荐 narrator voice
- 营销广告：通常不推荐（让视觉 + BGM 主导）
- 品牌宣传：极偶尔用，画外音情绪独白

**提示词约束**：`视频全程不要字幕、不要屏幕文字；必须保留协调统一的全局BGM和必要环境音，禁止静音段。Use consistent ambient BGM and necessary SFX throughout this entire N-second segment. Do NOT switch audio moods between characters.`

### 8.4 复用指引

→ `references/bgm-sfx-library.md`（完整库）+ `references/mcp-multimedia-creator.md` §v11 narrator voice（配音冲突修复）

---

## §9 风格库（4 类广告映射）

详见 `references/style-library.md`（5 核心 + 11 AdCraft 风格速查 + 4 类路由决策表）。**铁律**：不混搭 3+ 风格，单段单风格，多段可换风格。

---

## §10 失败模式（4 类广告精选）

### 10.1 跨 4 类必须规避（6 条）

| # | 模式 | 触发场景 | 修复 |
|---|---|---|---|
| #4 | hero shot 漂移 | 商品展示 6s hero shot 用 text 模式 | 先 image_generate hero shot 作 first_frame → keyframe 模式 |
| #5 | keyframe 12s 锚脸失败 | 12s 多变场景段用 keyframe mode | 改 reference mode + ≥1 张角色立绘 |
| #8 | 多场景 prompt 漂移 | reference mode 合并场景 | 场景锁定指令（段首加"全程严格在 X 场景"） |
| #13 | 多角色反派镜头背景漂移 | v2.5-flash reference mode 多角色 | 场景锁定指令显式列举反派镜头背景元素 |
| #14 | 涂抹场景漂移到白天窗边 | 涂抹类（美妆/食品）涂抹时段不足 | 涂抹 ≥4s + 删"morning sunlight"等暗示关键词 + 暖台灯全程不切换 |
| v9 | AI 字幕重复/段尾不渲染 | AI 内嵌字幕 | **字幕永远后处理**（drawtext `enable='between(t,T1,T2)'`） |

**完整 14 条失败模式**（含 #S1-#S4 类目专属）：见 `references/failure-modes.md`

### 10.3 11 条 Do Not 边界铁律（必读 · AdCraft 对齐）

完整 11 条见 `references/adcraft-boundaries.md`。核心 5 条速查：

| # | Do Not | 修复 |
|---|---|---|
| #1 | 不编造产品参数/认证/销量/证言 | 用户未给数字不写 |
| #2 | 不伪造 MCP 输出 URL | URL 来自 MCP 真实返回 |
| #3 | 不覆盖角色身份字段 | 7 protected 字段精确传递（见 `references/protected-fields.md`） |
| #6 | 不在 video prompt 渲染字幕 | 字幕永远 drawtext 后处理 |
| #7 | 不跨段漂移 | scene_lock_instruction 显式列举 |

---

## §11 修改与回退表

修改 SOP（改 hook / 卖点 / CTA / hero shot / 风格 / 品类 6 类 + 各段重做边界）见 `references/failure-modes.md` §修改回退。

---

## §12 交付前静默检查（10 项 · 不向用户展示）

完整 10 项清单见 `references/8-agent-orchestration.md` §6 + `references/failure-modes.md`。

---

## 📂 文件结构

```
marketing-ad-skill/
├── SKILL.md                       # 本文件（主入口，≤500 行）
├── references/
│   ├── mcp-multimedia-creator.md  # multimedia-creator MCP 工具能力 + 调用模板
│   ├── failure-modes.md           # 14 条失败模式完整库（含 §修改回退）
│   ├── style-library.md           # 5 核心 + 11 AdCraft 风格速查 + 4 类路由决策表
│   ├── bgm-sfx-library.md         # BGM/SFX 库 + 关键时刻表
│   ├── adcraft-assets.md          # 9 字段角色 + 6 字段场景 + 6 字段道具 + 三视图
│   ├── 8-agent-orchestration.md   # 11 Agent Round 编排（Round 1→1.5→2a→2b→3→3.5→4）+ 10 项静默检查
│   ├── adcraft-boundaries.md      # 11 条 Do Not 边界铁律
│   ├── auxiliary-agents.md        # role_prompt_authoring + quick_media 辅助工具
│   ├── world-setting.md           # Round 1.5 World Setting 5 要素硬约束
│   ├── video-direction.md         # Round 3.5 Video Direction 中间层
│   ├── protected-fields.md        # role_prompt_authoring · 7 protected 字段精确传递
│   ├── ugc-talking-video-ref.md   # UGC 精简版（5 模板 + 12s 4 段式 + 内部自检）
│   └── ugc-mcp-templates.md       # UGC MCP 模板（T06/T12/T13 + 升级路径）
├── scripts/
│   └── run_8agent_mcp.py          # MCP 调度脚本（init/next/record/finish 4 步）
└── outputs/
    └── (v1 老归档 · 仅作历史记录 · 新作品走 market-workspace/)

../market-workspace/                  # 🆕 新约定：所有新作品归档到 cwd/market-workspace/<proj>/{json,videos,images}（2026-09-18）
```

## 🔗 关联 Skill

- `script-skill`：High-Retention 视频开场（互补）
- `short-drama-ad-creator`：短剧带货（**路由排除**——霸总/重生/灰姑娘 等题材走它）
- 通用 prompt 规范 + 拼接 SOP + 失败模式 → 见 `short-drama-ad-skill/SKILL.md` 与 `prompt-template-spec.md`

## 📋 11 Agent 编排速查

完整规范见 `references/8-agent-orchestration.md`，核心要点：

| Round | Agent | 串/并 | 依赖 |
|---|---|---|---|
| 1 | Director（含 product_design） | 串 | 用户输入 |
| 1.5 | World Setting | 串 | Round 1 |
| 2a | Script Writer | 串 | Round 1.5（上游真相源） |
| 2b | Character + Scene + Prop | 并 | Round 2a（**禁止 3 件套完全并行**） |
| 3 | Storyboard + BGM | 并 | Round 2 全部 |
| 3.5 | Video Direction | 串 | Round 3（storyboard→video 桥） |
| 4 | Video Generation（MCP） | 串 | Round 3.5 |

**何时走 §2 快速路径**：纯产品/特写 + ≤2 段 + 无角色锚脸 + 用户明确说"快速出一版"。否则默认走 11 Agent。
