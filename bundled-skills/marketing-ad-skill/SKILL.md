---
name: marketing-ad-skill
description: Generate marketing ads (商品展示 hero shot / 电商种草 轻剧情 / 游戏买量 CG / 品牌宣传 氛围 / UGC 口播 真人出镜 / **参考视频改编 remix**) using multimedia-creator MCP (agnes-image-2.5-flash + agnes-video-2.5-flash). Triggers on "商品展示 / hero shot / 卖点拆解 / 产品特写 / 美妆 / 3C 数码 / 食品饮料 / 日用品 / 抖音商品卡 / 电商详情页 / 涂抹广告 / 场景种草 / 游戏买量 / 二次元 / 写实游戏广告 / 品牌宣传 / TVC / 国货 / 国潮 / 氛围情绪 / UGC / 口播 / 真人讲解 / 测评 / 开箱 / 教程 / 演示 / 批量达人 / 信息流带货 / **参考视频 / 借鉴 / 同款 / remix / 竞品 / 对标 / 复刻 / 拆片 / qisi**". Use when NOT short-drama — 霸总/重生/灰姑娘/系统觉醒/战神/玄学/民国/年代文 → use short-drama-ad-creator instead. Implements 5-段拼接 (36s = 12s×3) · Agnes ≤12s/段 · v9 字幕后处理 (drawtext) · AdCraft 风格库 5 类映射 · BGM/SFX 三段拆分 · 11 Agent 编排 (Round 1→1.5→2a→2b→3→3.5→4) + §8 路由 +Round 0.5 qisi Remixer（拆片+叙事方法提取·11 字段结构化） · Protected Fields 7 字段 · 11 条 Do Not · 衔接连贯 (continuity_handoffs) · **§8 qisi 改编分支（Round 0.5 拆片 → 写营销新故事 → 复用 §3-§6 SOP）**.
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

## §1 路由架构（首轮必走）

**skill 两大并列入口功能 + 4 类广告主 SOP · 合并路由表**：

| 类型 | 触发关键词 | 落地 |
|---|---|---|
| **§7 UGC 口播**（与 §8 并列入口） | 口播/真人讲解/测评/开箱/教程/演示/批量达人/UGC/信息流带货 | 12s 4 段式 + 主播出镜（详见 §7） |
| **§8 视频复刻**（与 §7 并列入口） | 参考视频/借鉴/同款/remix/竞品/对标/复刻/拆片/qisi | Round 0.5 qisi Remixer（11 字段）→ 复用 §3-§6 任一 + 12s 铁律 + 12 Agent 编排 |
| §3 商品展示 | 商品展示/hero shot/产品特写/卖点拆解/详情页 | §3.3 段拼接 |
| §4 电商种草 | 种草/体验/日常场景（非短剧）| §4.3 段拼接 |
| §5 游戏买量 | 游戏/手游/CG/二次元/买量 | §5.4 段拼接 |
| §6 品牌宣传 | 品牌/TVC/调性/价值观/氛围 | §6.3 段拼接 |

**禁止假设**：不主动假设用户想做哪一类。信号模糊时先问 1 句，不阻塞 SOP 推进。同时含 2 类信号 → 问用户选 1 类。

### 1.1 短剧题材硬排除清单（触发即路由 short-drama-ad-creator，不走 §3-§6）

**关键词命中即排除**（任一命中）：霸总 / 重生 / 灰姑娘 / 系统觉醒 / 战神 / 玄学 / 民国 / 年代文 / 穿越 / 复仇 / 赘婿 / 闪婚 / 离婚 / 替嫁 / 丫鬟 / 少爷 / 总裁夫人 / 豪门 / 古装言情 / 宫斗 / 宅斗 / 师徒 / 修真 / 仙侠 / 宫廷。

**判断 SOP**：① 扫描上述关键词 → ② 命中输出"本任务属于短剧带货，请使用 `short-drama-ad-creator`" → ③ 不命中进入 §3-§6 路由。**边界声明 SOP 输出必含 4 要素**：① 不属于本 skill ② 替代 skill 名 ③ 触发排除的关键词 ④ 用户后续操作建议。

### 1.2 UGC 与 §3/§4 边界（路由层快速判定）

详见 §7.2 关键边界（UGC 完整规范见 `references/ugc-talking-video-ref.md`）。

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

> 🔴 **CHECKPOINT · 4 产物必确认门控（2026-09-22 新增铁律）**
>
> 在跑 MCP 生成前，**4 个产物必须由用户确认**，否则禁止进入下一阶段。用户跳过任一产物确认 → 直接进入的产物质量不可控、返工成本 ×3。
>
> | # | 产物 | 对应 Round | 必确认时机 | 跳过后果 |
> |---|---|---|---|---|
> | 1 | **剧本** | Round 2a Script Writer | agent_script.json 落地后、调 Round 2b 资产前 | 卖点错位 → 11 Agent 全链路返工 |
> | 2 | **资产卡** | Round 2b Character/Scene/Prop | 3 个 JSON 落地后、调 Round 3 分镜前 | 脸漂移 / 场景漂移 → 视频段全部重生成 |
> | 3 | **分镜** | Round 3 Storyboard | agent_storyboard.json 落地后、调 Round 3.5 视频方向前 | 段间节奏错位 → 视频无法拼接 |
> | 4 | **生成前提示词** | Round 4 Video Generation | agent_video.json（image_generate_calls + video_generate_calls）落地后、调 MCP 前 | prompt 漂移 → 视频生成失败/语义偏移 |
>
> **门控执行 SOP**：
> - **默认走"产物确认门"**：每个产物生成后，agent 必须输出 markdown 摘要（含核心字段）→ 用户确认 / 修改 / 重做 → 才进入下一产物
> - **用户说"直接做完"才跳过门控**：跳过所有 4 个产物确认门 → 一路跑到 final.mp4 + drawtext（高风险，需用户主动授权）
> - **产物修改 ≠ 后续返工**：用户在任一产物阶段修改 → 后续 Round 必须重跑确认，不得用旧产物

**4 产物漏确认失败模式（2026-09-22 新增 · HL-2 if-then 三段式）**：

| 漏确认产物 | 触发条件 | 一线修复 | 仍失败兜底 |
|---|---|---|---|
| **剧本**（Round 2a 跳过） | agent_script.json 未展示就给下游用 | 暂停 → 输出 markdown 摘要（含 segments[]/selling_points/cta）→ 等用户确认 | 用户说"重写" → Round 2a 全跑重生成 |
| **资产卡**（Round 2b 跳过） | 3 个 JSON 未审阅就跑分镜 | 暂停 → 输出 identity master 9/6/6 字段摘要 + 三视图/4 角度图像 → 等用户确认 | 脸漂移 / 场景漂移已发生 → 全部 Round 2b 重做 + Round 3-9 全部重跑 |
| **分镜**（Round 3 跳过） | agent_storyboard.json 未审阅就跑视频方向 | 暂停 → 输出 markdown 表格（含 segments[]/discrete_shots[]/sub_shot_detail）→ 等用户确认 | 段间节奏错位已发生 → Round 3-4 全部重做 + Round 4 video_generate 重跑 |
| **生成前 prompt**（Round 4 跳过） | agent_video.json 未审阅就调 MCP | 暂停 → 输出 3-12 段 prompt + images[] + mode + first_frame + drawtext 时间码 → 等用户确认 | video_queue_full / content_policy_violation / prompt 漂移已发生 → Round 4 单段重试（不要全段重跑，等 60-120s） |

**门控自检清单**（每个产物确认前必跑）：
- [ ] 该产物 markdown 摘要已输出？
- [ ] 摘要包含核心字段（剧本=segments[]/selling_points/cta；资产=9 字段+三视图；分镜=discrete_shots[]；prompt=mode+images[]+first_frame）？
- [ ] 用户给了"确认 / 修改 / 重做"三选一明确答复？
- [ ] 用户选"修改"或"重做" → 后续 Round 已用新产物（不是缓存）？

**4 产物审阅要点（2026-09-22 新增 · 防止 agent 摘要"看起来 OK 但漏关键"）**：

| 产物 | 用户审阅时必看 4 点 |
|---|---|
| **剧本** | ① selling_points 排序与用户原意一致（≤3 个） ② hook 句是否抓人（前 3s） ③ CTA 是否含价格或品牌精神 ④ 时长合计 = 12s × N |
| **资产卡** | ① 角色 9 字段是否齐全（姓名/性别/年龄/肤色/发型/体型/服装/配饰/表情） ② 三视图/4 角度背景纯白无杂物 ③ continuity_lock_instruction 跨段锁定清晰 ④ forbidden 与 hero product 一致 |
| **分镜** | ① discrete_shots[] 每段 3-4 个子镜头 ② 子镜头时长合计 = 段时长（≤2s 短镜 < 1） ③ continuity_handoffs 段间锚点三选一 ④ split_reason 在 5 类枚举内 |
| **生成前 prompt** | ① mode 选择（reference / keyframe） ② images[] 单元素数组铁律 ③ first_frame URL 已 resolve（非 `<step N>` 占位） ④ drawtext 时间码在 final 实测累计偏移内 |

### 2.6 资产优先规范触发条件（AdCraft 对齐版）

| 触发条件 | 必跑资产 | 输出 |
|---|---|---|
| 含人物 + 含场景 | 角色 identity master（9 字段）+ **道具 identity（6 字段）** + 场景 identity（6 字段） + **三视图（正/背/侧）** + **场景 4 角度** | 4 套 JSON |
| 仅含人物 | 角色 identity master + **三视图（正/背/侧）** | 1 套 JSON |
| 仅含场景 | 场景 identity + **4 角度（全景/中景/特写/反打）** | 1 套 JSON |
| 纯产品/特写 | 不跑资产，直接 §3 hero shot | 仅 image_generate |

**资产图通用规范（2026-09-22 新增铁律）**：
- **背景纯色白底**（`pure white #FFFFFF background`）：所有资产图（角色三视图 / 场景 4 角度 / 道具多角度）都用纯色白底，禁止场景化背景/渐变/半透明
- **人物三视图**：正面 + 背面 + 侧面（左侧或右侧任一）= 3 张
- **场景 4 角度**：全景 + 中景 + 特写 + 反打/俯拍 = 4 张
- **道具多角度**：正面 + 侧面 + 俯视 = 2-3 张
- **目的**：抠图 / reference mode 锚脸锚物 / contact sheet 拼接 / 跨段锁定；避免环境信息被模型误读导致漂移
- 完整规范见 `references/adcraft-assets.md` §1-§2.5

**道具 identity 6 字段**（AdCraft prop_design · Round 2b 与 character/scene 并行）：
`name / material / color / silhouette / scale / brand_relation` + `recurs_across_segments` + `continuity_lock_instruction`（跨段锁定 prompt 句）

完整规范见 `references/adcraft-assets.md` §1-§3（含 AdCraft 平台边界说明）。

### 2.7 Agent 编排（默认 11 Agent · §8 入口触发时加跑 Round 0.5 = 12 Agent · 简单任务可走 §2 快速路径）

**默认走 11 Agent 编排**（§3/§4/§5/§6/§7 路由 · Round 1→1.5→2a→2b→3→3.5→4）：

| Round | Agent | 输出 JSON | 触发条件 |
|---|---|---|---|
| **0.5** | **qisi Remixer（拆片+叙事方法提取 · §8 触发时必跑）** | `agent_qisi_remixer.json` | **仅 §8 路由**：用户给了参考视频/链接/截图/梗概 |
| 1 | Director（含 product_design） | `agent_director.json` | 全部任务 |
| 1.5 | **World Setting（5 要素 · 上游真相源）** | `agent_world_setting.json` | 全部任务 |
| 2a | Script Writer（上游真相源 · 必须先跑） | `agent_script.json` | 全部任务 |
| 2b | Character + Scene + **Prop** 并行（**严禁完全并行** · #8B-1 实证） | 3 个 JSON | 含人物+场景 |
| 3 | Storyboard + BGM 并行 | 2 个 JSON | 全部任务 |
| 3.5 | **Video Direction（storyboard→video 桥）** | `agent_video_direction.json` | 全部任务 |
| 4 | Video Generation（MCP 调用链） | `agent_video.json` | 全部任务 |

**Round 0.5 qisi Remixer 11 字段完整规范见 §8.4**（结构化 11 字段 + 校验铁律 6 条）。

**Round 0.5 决策**：
- §1 路由表命中「参考视频/借鉴/同款/remix/竞品/对标/复刻/拆片/qisi」→ **必跑 Round 0.5**
- 其它路由（§3/§4/§5/§6/§7）→ **跳过 Round 0.5**
- §8 路由 + §2 快速路径（纯产品/特写）→ **仍跑 Round 0.5 但只填 `narrative_pattern` 1 字段 + `route_recommendation`，其余标 N/A**

**Round 0.5 → Round 1 输入**：Round 0.5 JSON 整体作为 Round 1 Director Agent 的「参考分析 + 叙事方法」输入段，Director 必须复述 `borrowed_methods` 至少 2 项到自己的 `agent_director.json.borrowed_narrative_methods` 字段。

**走 §2 快速路径的触发（全满足才可走）**：① 纯产品/特写 ② ≤2 段 ③ 无角色锚脸 ④ 用户明确说"快速出一版"。

完整规范见 `references/8-agent-orchestration.md` + 调度脚本 `scripts/run_8agent_mcp.py`。

### 2.8 World Setting 阶段（5 要素硬约束 · 必跑）

详见 `references/world-setting.md`（5 要素：premise/era/place/spatial_logic/world_rules + continuity_for_assets）。**AdCraft 上游真相源**。

### 2.9 Video Direction 中间层（Round 3.5 · 必跑）

详见 `references/video-direction.md`（每段 opening_state/primary_action/closing_state/subject_action/camera_motion/framing + continuity_handoffs）。**Storyboard→Video 桥梁**，不调 MCP。

### 2.10 Storyboard Prompt Spec（Round 3 + Round 4 必跑）

详见 `references/storyboard-prompt-spec.md`（整合自 `storyboard_prompt_spec.md` · 287 行实战规范）。**核心 4 条铁律**：
1. **每段内拆 3-4 个 1-4s 离散分镜**（`storyboard.segments[].discrete_shots[]`），避免"全程空转"（leshi_remix v1 翻车教训）
2. **离散分镜 prompt 用 "X秒" 文字驱动节奏**（不是 MCP `seconds` 参数）
3. **资产引用走 `<Picture N>` 重映射**（§4）· `images[]` 按 prompt 首次引用顺序排列
4. **`mode="reference"` + `seconds=12` + 单元素 `images` 数组**（harness dict 序列化坑已规避）

Storyboard Agent + Video Generation Agent prompt 必含「**MUST 遵循 `references/storyboard-prompt-spec.md`**」声明。

**🆕 自动化审计**（2026-09-22）：Video Generation Agent 调 MCP 前**必跑** `scripts/audit_video_generate.py`（15 项 spec 规则），EXIT 0 才允许调 video_generate。详见 `references/8-agent-orchestration.md` Agent 8 必跑项。

**🆕 跨段连续性自动化审计**（2026-09-22 · LibTV seg.md 整合）：Video Direction Agent（Round 3.5）写 `agent_video_direction.json` 后**必跑** `scripts/audit_segment_continuity.py`（10 项连续性规则：handoffs 长度 / 段首承接 / 末帧定格 / 场景锁定 / 服装光线漂移），EXIT 0 才允许进 Round 4。详见 `references/8-agent-orchestration.md` Agent 7/8 必跑项。

### 2.11 Script Writer 剧本设计铁律（🆕 2026-09-22 · screenwriter.md 整合 · §3-§6 4 类路由共用 · §7 UGC 例外）

| screenwriter.md 规范 | marketing-ad-skill 字段（agent_script.json） | 审计规则 |
|---|---|---|
| **核心冲突 6 类**（§核心冲突）| `script.core_conflict` 含 欲望/利益/身份/关系/世界阻力/失败代价 ≥ 3 类 | S08 |
| **人物小传 9 字段**（§人物小传）| `hero_desire` / `hero_fear` / `hero_arc`（欲望/恐惧/弧光 3 字段）| S09 |
| **场次规划 7 字段**（§场次规划）| `scenes[]` 每场 5 字段：goal/obstacle/info_release/relationship_change/exit_hook | S10 |
| **角色名称硬性规则**（§角色名称）| `dialogues[].character` 必正式姓名，**禁'她/他/它/对方'** | S11 |
| **对话数**（§剧本正文）| `dialogues[]` ≥ 3 条（避免无声剧本） | S12 |
| **§2.2 selling_points ≤3** | `selling_points[]` 3-5 个（hook + CTA 可补 2）| S04 |
| **卖点-口播对齐** | `body_3_25s` 引用 ≥ 2 个 selling_points + `cta_25_30s` 命中 ≥ 1 个 | S06 / S07 |
| **字幕 4 句公式** | `subtitle_triggers[]` ≥ 3 条 | S05 |

**适用范围**：§3 商品展示 / §4 电商种草 / §5 游戏买量 / §6 品牌宣传 · **§7 UGC 口播 例外**（走 ugc-talking-video-ref.md 专用规范，不走本整合）。

**自动化审计**（Round 2a 必跑）：调 MCP 前必跑 `scripts/audit_script.py`（12 项规则），EXIT 0 才允许进 Round 2b。详见 `references/8-agent-orchestration.md` Agent 2 必跑项。

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
| 12s / 24s | **12s × 1-2** | concat demuxer |
| **36s（替代旧 30s）** | **12s × 3**（hero + 价格 + CTA 完整收束） | concat demuxer + drawtext |
| 48s / 60s | **12s × 4-5** | concat demuxer + drawtext |

**禁止拆分**（铁律 · §2.1）：❌ 任何非 12s 倍数 / ❌ 30s 旧模板 `12+12+6` 已废 / ❌ ≤6s 短段（衔接跳跃 + agnes 模型质量劣化）。理由：受限于 agnes-video-2.5-flash（≤12s/段）+ 衔接连贯铁律（每段末帧必须可作下段 first_frame 锚定）。

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

### 3.5 参考 prompt（hero shot 美妆 · 涂抹 ≥4s 约束）

完整 2 个 prompt 模板见 `references/mcp-multimedia-creator.md` §4.2（hero shot + 涂抹场景）。

- **Hero Shot**："哑光黑色背景 + 三盏柔光包围光 + 360° 旋转 + 膏体/瓶体光泽反射"
- **涂抹场景（#14 修复）**："暗光卧室暖台灯左侧打光 + 涂抹 ≥4s + 禁止场景漂移"

### 3.6 复用指引

→ §9 末尾「复用指引统一声明」

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

### 4.3 段拼接表（**MUST** · 禁止其他拆分）

同 §3.3 段拼接表（12s × N）。禁止拆分列表见 §3.3。

### 4.4 vlog 涂抹场景锁定模板（MUST · 避免 #14）

vlog 类种草含「涂抹/上脸/试色/试香」动作。Prompt 必含 3 句：① 场景锚定（暗光卧室+暖台灯左侧+禁止窗光/白天/冷色）② 涂抹时长 ≥4s ③ 视频全程严格在暗光卧室暖台灯场景，禁止漂移到白天窗边。

### 4.5 复用指引

→ §9 末尾「复用指引统一声明」

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

同 §3.3 段拼接表（12s × N · 36s = 12s × 3 礼包 CTA + 品牌 logo）。

### 5.5 复用指引

→ §9 末尾「复用指引统一声明」

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

同 §3.3 段拼接表（12s × N · 36s = 12s × 3 情绪升华 + logo）。

### 6.4 与电商种草区别

- 品牌宣传 = 不强调具体功能/价格，**只强品牌精神**
- 电商种草 = 必须有产品功能展示 + 价格 CTA
- 品牌宣传 BGM 比人声重要（情绪叙事）

### 6.5 复用指引

→ §9 末尾「复用指引统一声明」

---

## §7 UGC 口播入口（真人出镜 · 12s 4 段式 · 与 §8 视频复刻并列）

> **入口定位**：§7 与 §8 视频复刻是本 skill 的**两大并列入口功能**。§7 是本 skill 内完整实现的 UGC 口播（精简入口说明在本节，**完整 15 节规范在 `references/ugc-talking-video-ref.md`，skill 可独立使用不依赖外部源**），§8 是本 skill 内完整实现的视频复刻。

### 7.1 触发关键词（精简版 · 完整版查 references §1）

口播 / 真人讲解 / 种草 / 测评 / 开箱 / 教程 / 演示 / 批量达人 / UGC / 达人带货 / 信息流带货 → §7

> 「参考视频复刻」**不**路由 §7（走 §8 视频复刻）

### 7.2 与 §3/§4 关键边界（精简 3 行 · 完整对照表查 references §2）

- **§7 = 主播出镜** + scroll-stopping 真实感 + **禁逐句字幕** + 产品图强门控
- **§3 = 纯产品** hero shot（无主播）；**§4 = 1-2 使用场景** + 4 句 drawtext 字幕（无主播）
- 典型误路由：❌ "完美日记 30s 抖音种草" → §4（日常 vlog）；✅ "完美日记 30s 抖音**口播带货**" → §7 UGC

### 7.3 5 大铁律（精简 · 完整细节查 references §3-§15）

1. **字幕硬门控 off**（UGC 不输出 drawtext 逐句字幕）
2. **产品图强门控**（产品 hero 包装特写 + 价格字符渲染约束 references §13.1）
3. **主播 5 维跨镜恒定**（脸型/肤色/眉眼/唇色/发型 ≥2 镜头必一致 references §7）
4. **先分镜表再调视频**（YAML 逐秒分镜卡 references §9 模板）
5. **12s 4 段式**（hook 0-3s / 产品证明 3-9s / 反馈 9-15s / packshot+CTA 15-24s · 默认 24s = 12s × 2）

### 7.4 完整规范位置

精简版 15 节规范 + MCP 模板全部在本 skill 内：
- `references/ugc-talking-video-ref.md`（15 节完整规范 · 触发词/边界/硬门控/输出契约/主播脸谱/12s 4 段式/分镜卡/提示词编译/真实感/落盘契约/工具调用/升级路径/自检清单）
- `references/ugc-mcp-templates.md`（MCP T06/T12/T13 调用模板）

**独立使用声明**：本 skill 复制到任何环境后，UGC §7 入口完整可用。所有规范、模板与决策依据全部内化在上述 references 文件中，无需查任何外部 skill / 仓库。

---

## §8 视频复刻入口（参考视频 → 营销广告 · 与 §7 UGC 口播并列）

> **入口定位**：§8 与 §7 UGC 口播是本 skill 的**两大并列入口功能**。§7 是本 skill 内完整实现的 UGC 口播（精简版见 §7 + 完整 15 节规范在 `references/ugc-talking-video-ref.md`），§8 是本 skill 内完整实现的视频复刻（含 Round 0.5 qisi Remixer + 复用 §3-§6 任一）。

**触发条件**：用户输入含「参考视频 / 借鉴 / 同款 / remix / 竞品 / 对标 / 复刻 / 拆片 / qisi」任一关键词，且提供参考材料（视频附件 / 本地路径 / 链接 / 截图 / 文字梗概 / 逐字稿）。

**落地原则**：qisi Remixer（Round 0.5）做"叙事方法 + 新故事方向"的结构化前置分析（11 字段），**不替换**本 skill 的 §3-§6 4 类广告 SOP。**§8 入口下 Round 0.5 必跑**，§3-§7 其它路由跳过 → §8 总编排为 12 Agent（Round 0.5 + 11 Agent）。落地仍走 §3/§4/§5/§6 + 12s 段拼接 + drawtext 后处理 + 9 字段角色 / 6 字段场景 / 6 字段道具。

### 8.1 3 步改编思路（借鉴 qisi-video-remix）

1. **还原可确认内容**。简述参考材料的故事 / 开场吸引点 / 人物目标 / 冲突升级 / 信息揭示 / 结尾。关键判断附时间点或截图定位；分清观察事实与解释。无法确认的声音、身份、转折记为未知，**不填造**元数据。
2. **提取值得借用的叙事方法**（不是标签，是机制）。例如：先给结果后揭原因 / 误会逐层升级 / 重复动作形成反差 / 信息差揭示 / 反差身份 / 抽卡爆击 / 社交炫耀 / 情绪铺陈 / 留白结局。描述该方法在原片中**如何起作用**，不只贴"反转 / 情绪价值"标签。
3. **写一个营销广告新故事**。新意落实到人物选择 / 事件发展 / 信息差 / 解决方式。只换姓名 / 服装 / 地点 = 未完成改编。营销广告约束：产品 hero 必须出现在 §2.4 时间轴内，反转后必须收束到 §2.3 选定的卖点 + §2.2 产品名。

### 8.2 落地 SOP（4 类路由决策）

| 原片叙事方法 | 推荐路由 | 必走铁律 |
|---|---|---|
| 反差身份 / 抽卡爆击 / 社交炫耀 / 大场面战斗 | §5 游戏买量 | 12s × 3 + 礼包 CTA |
| 误会升级 / 先结果后原因 / 信息差揭示 / 重复反差 | §4 电商种草 | 12s × 3 + 价格 CTA |
| 情绪铺陈 / 留白结局 / 先结果后原因 / 价值观升华 | §6 品牌宣传 | 12s × 3 + 品牌精神（不显价格） |
| 反差身份 / 社交炫耀 / 抽卡爆击 + 强产品卖点 | §3 商品展示 | hero shot ≥4s + 价格 CTA |

### 8.3 铁律（与 marketing-ad-skill 一致 · **不**走 qisi 默认）

- **段拼接**：12s × N（受 agnes-video-2.5-flash ≤12s/段 限制，**不**采用 qisi 的 15s/30s 单段上限）
- **段拼接表**：见 §3.3 / §4.3 / §5.4 / §6.3（按选定路由）
- **资产生成**：仍走 §2.6 资产优先规范（角色 9 字段 / 场景 6 字段 / 道具 6 字段 + continuity_lock_instruction）
- **同人物多造型**：若改编故事含同人物换衣 / 换妆 / 换年龄，**必须**走 adcraft-assets §1「造型拆分」模式（参考 qisi 「小雨／下班装」命名规范），**禁止**靠 prompt 文字硬塞造型变化
- **字幕**：仍走 §9.3 drawtext 后处理铁律（**不**采用 qisi 默认"无字幕"）
- **Agent 编排**：走 §2.7 12 Agent 编排（**Round 0.5→1→1.5→2a→2b→3→3.5→4**）。**§8 路由必跑 Round 0.5 qisi Remixer**（拆片+叙事方法提取·结构化 11 字段）；其它路由跳过。Round 0.5 JSON 整体作为 Round 1 Director Agent 输入。

> **段拼接决策补充**（qisi 切段 5 原则 + 本 skill 落地 + split_reason 独立字段）见 `references/qisi-section-decision-sop.md`。
> **完整端到端样例**（基于 leshi_remix 实战的 qisi 格式 creative-plan.md）见 `references/qisi-creative-plan-example.md`。

### 8.4 Round 0.5 qisi Remixer 输出字段（**必跑 · 结构化 11 字段**）

替代旧的"输入材料覆盖范围声明"——所有声明都进 `agent_qisi_remixer.json`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `source_materials` | object | `{given: [...], unconfirmed: [...]}` — 用户给了什么 + 不可确认什么 |
| `timeline_breakdown` | array | 5-10s 切片：每片 `{start_t, end_t, beat, visual_elements, audio_cue, info_density}` |
| `narrative_pattern` | string | 1-2 句概括的故事机制（**不是标签**，是机制） |
| `pacing_signature` | string | 时间节奏签名（hook 时长/转场密度/段尾是否落点） |
| `hook_mechanism` | string | 开场吸引点机制（**不是描述**，是机制） |
| `visual_signature` | string | 视觉风格签名（**不是风格名**，是固定色板/构图/重复元素） |
| `perspective_shift` | array | `{from, to, technique, beat}` 视角切换数组 |
| `comparison_table` | array | 4 列对照：参考画面/参考解读/新画面/新解读（**4 项改动至少 2 项**有变化） |
| `borrowed_methods` | array | 借鉴方法（≤3 个 + 每条「在原片如何起作用」1-2 句） |
| `new_story_changes` | object | `{人物, 事件, 信息差, 解决方式}` 各标 ✓/✗（**至少 2 项 ✓**） |
| `route_recommendation` | object | `{route: §3/§4/§5/§6, reason: string}` |

**§8.4 校验铁律**（必跑·`grade` 第 12 断言）：
1. `timeline_breakdown.length ≥ 3`（至少 3 个切片）
2. `narrative_pattern` 非空 + ≥10 字（防止"反转/情绪价值"空标签）
3. `borrowed_methods.length ≥ 1`
4. `new_story_changes` 至少 2 项 ✓
5. `route_recommendation.route` ∈ {§3, §4, §5, §6}
6. `comparison_table.length ≥ 2`（至少 2 行 4 列对照）

> **§8.4 实战 references（拆原片 → 写分镜 三件套 SOP）**：`qisi-evidence-frame-extraction.md`（逐秒抽帧 + ffmpeg 命令 + 关键帧筛选法）→ `qisi-narrative-methods-mapping.md`（4 维叙事手法 + apply_to_§3-§6 落地模板）→ `qisi-rhyme-copywriting.md`（原片押韵 → §3-§6 短押韵 7 步改写）。**完整落地样例见 `market-workspace/leshi_remix_s3_36s/references/` 3 个 JSON**。v4 storyboard 每个 sub_shot_detail 的 source_ref 引用原片时间戳 + narrative 引用叙事方法名（qisi_methodology_coverage: 100% · v4 13/13 帧验证完美）。

### 8.5 与 qisi-video-remix skill 的边界（精简 5 条 · 完整 10 维对照见 references）

- **用途**：qisi 通用改编 vs §8 营销广告改编
- **拆片 Agent**：qisi Round 0 vs §8 Round 0.5 qisi Remixer（11 字段）
- **段拼接**：qisi 15s/30s vs §8 12s 铁律
- **字幕**：qisi 默认无 vs §8 drawtext 后处理
- **何时用 qisi 原 skill**：通用视频改编 / 保留 15s-30s / 不要 12 Agent；否则用 §8

完整 10 维对比表见 `references/qisi-boundary.md`。

---

## §9 工程上限与拼接（引用 multimedia-creator MCP）

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

### 7.4 复用指引统一声明（§3-§6 + §10 共享）

- **§3 商品展示**：`references/failure-modes.md`（#4/#5/#8/#14）+ `references/style-library.md`（商品展示类）+ 含角色场景时跑 `references/adcraft-assets.md` §1-§2
- **§4 电商种草**：短剧带货 9 条剧本规范可借鉴但不照搬 22 题材库 + 0-5s 即可露产品 + #14 涂抹 ≥4s（§4.4）+ 含人物场景跑 `references/adcraft-assets.md`
- **§5 游戏买量**：`references/style-library.md`（游戏买量类）+ 视觉冲击力 > 剧情 + BGM 必须高能量（电子/摇滚/史诗）
- **§6 品牌宣传**：`references/style-library.md`（品牌宣传类）+ `references/bgm-sfx-library.md` + #14 涂抹场景不适用
- **§10 BGM/SFX**：`references/bgm-sfx-library.md`（完整库）+ `references/mcp-multimedia-creator.md` §v11 narrator voice

---

## §10 BGM/SFX（4 类广告共享）

**BGM 三段节奏**：0-3s hook 情绪冲击 / 3-25s 主体叙事 / 25-30s CTA 收束（4 类广告的 BGM 关键词对照表见 `references/bgm-sfx-library.md`）。

**SFX 关键时刻**（5 条精简）：产品开盖"啪" / 涂抹瞬间皮肤触感音 / hero shot 旋转金属反光 / 价格数字"叮" / 品牌 logo jingle（前 0.5s）。

**Voiceover**（可选）：短剧带货强烈推荐 / 营销广告通常不用 / 品牌宣传极偶尔用画外音独白。

**语言铁律（2026-09-22 新增 · 全 skill 通用）**：
- **人物台词 + 画外音默认 = 中文（普通话）**，除非用户在 brief 明确指定其他语言
- 适用于 §3-§7 全部路由（含 §7 UGC 口播 + §8 视频复刻）
- 例外：用户明确说"英文广告/粤语/日语/小语种"或参考视频原片对白非中文 → 走原片语言 + 在 brief 标注
- video_generate prompt 落地：每段对白前加「中文（普通话）」前缀（详见 references/mcp-multimedia-creator.md §3.7.3 第 2 条）

**video_generate prompt 通用 3 铁律（2026-09-23 新增 · §3-§7 全部含人物台词路由适用）**：
1. **台词按段分配** — 每段 prompt 只列本段负责的台词（禁止末尾粘贴完整台词表）
2. **vlog/剧情类默认画外音** — 「人物讲：句①」措辞会触发口播脸 → 改"画外音·独白" + 严禁口播反向提示（§7 UGC 口播例外）；详情见 references/mcp-multimedia-creator.md §5.5
3. **手部约束按场景现实** — 禁硬约束"只允许一只手"（与现实冲突），改"按场景动态 1-2 手 + 禁 4 类真实 bug（重叠手/第三只手/镜像反手/5 指错）"；详情见 references/mcp-multimedia-creator.md §5.5
4. **跨段不能重复同一完整句** — 每句台词只归属 1 段（不能让 1 句横跨 2 段配音）

**反向自检表**（prompt 出炉前必查 4 项）：① prompt 末尾是否贴完整台词表？② vlog prompt 是否写了"人物讲：句①"？③ 手部是否硬约束"只允许一只手"？④ 是否有完整句横跨 2 段？
- UGC 口播的 `language_lock` 字段默认填 `zh-CN`（普通话），见 references/ugc-talking-video-ref.md

---

## §11 风格库（4 类广告映射）

详见 `references/style-library.md`（5 核心 + 11 AdCraft 风格速查 + 4 类路由决策表）。**铁律**：不混搭 3+ 风格，单段单风格，多段可换风格。

---

## §12 失败模式 + Do Not 铁律

**核心 6 失败模式速查**（完整 14 条见 `references/failure-modes.md`）：

| # | 模式 | 修复 |
|---|---|---|
| #4 | hero shot 漂移 | 先 image_generate hero shot 作 first_frame → keyframe 模式 |
| #5 | keyframe 12s 锚脸失败 | 改 reference mode + ≥1 张角色立绘 |
| #8 | 多场景 prompt 漂移 | 场景锁定指令（段首加"全程严格在 X 场景"） |
| #13 | 多角色反派镜头背景漂移 | 场景锁定指令显式列举反派镜头背景元素 |
| #14 | 涂抹场景漂移到白天窗边 | 涂抹 ≥4s + 删"morning sunlight"等暗示关键词 + 暖台灯全程不切换 |
| **#15** | **多手 / 镜像反手（2026-09-22 新增 · 2026-09-23 v1.4 修正）** | **手部镜头反向提示词已升级（详见 `references/mcp-multimedia-creator.md` §5.5 铁律 3）：v1.1「只允许一只手」矫枉过正 → 改"按场景动态 1-2 手 + 禁 4 类真实 bug（重叠手/第三只手/镜像反手/5 指错）+ per-scene realistic hand count, five fingers per hand, no third hand, no mirror-flip, no overlapping hands, anatomically correct hands"** |
| v9 | AI 字幕重复/段尾不渲染 | **字幕永远后处理**（drawtext `enable='between(t,T1,T2)'`） |

**核心 5 Do Not 铁律**（完整 11 条见 `references/adcraft-boundaries.md`）：#1 不编造产品参数 / #2 不伪造 MCP URL / #3 不覆盖 7 protected 字段（见 `references/protected-fields.md`）/ #6 不在 video prompt 渲染字幕 / #7 不跨段漂移（scene_lock_instruction 显式列举）。

---

## §13 修改与回退表

修改 SOP（改 hook / 卖点 / CTA / hero shot / 风格 / 品类 6 类 + 各段重做边界）见 `references/failure-modes.md` §修改回退。

---

## §14 交付前静默检查（10 项 · 不向用户展示）

完整 10 项清单见 `references/8-agent-orchestration.md` §6 + `references/failure-modes.md`。

---

## 📂 文件结构

```
marketing-ad-skill/
├── SKILL.md                   # 主入口
├── references/                # 14 个 references（见各章节指向）
├── scripts/run_8agent_mcp.py  # MCP 调度脚本
└── outputs/                   # v1 老归档 · 新作品走 ../market-workspace/<proj>/
```

## 🔗 关联 Skill

- `script-skill`：High-Retention 视频开场（互补）
- `short-drama-ad-creator`：短剧带货（**路由排除**——霸总/重生/灰姑娘等题材走它）
- 通用 prompt 规范 + 拼接 SOP + 失败模式 → 见 `short-drama-ad-skill/SKILL.md` 与 `prompt-template-spec.md`

## 📋 11 Agent 编排速查（精简版）

完整规范见 `references/8-agent-orchestration.md`。核心要点（Round 0.5→1→1.5→2a→2b→3→3.5→4）：Director（含 product_design）→ World Setting → Script Writer（上游真相源）→ Character + Scene + Prop 并行 → Storyboard + BGM 并行 → Video Direction → Video Generation（MCP）。§8 路由必跑 Round 0.5（其它路由跳过）。

**何时走 §2 快速路径**：纯产品/特写 + ≤2 段 + 无角色锚脸 + 用户明确说"快速出一版"。否则默认走 11 Agent（§8 路由 + Round 0.5 = 12 Agent）。
