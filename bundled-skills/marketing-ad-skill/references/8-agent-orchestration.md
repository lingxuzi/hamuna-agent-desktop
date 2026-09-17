# 独立 Agent 编排规范（完全对齐 AdCraft）

> **设计目标**：100% 对齐 AdCraft 8-Agent 架构，用 Claude Code Agent 工具并行起独立 subagent。
> **来源**：AdCraft `apps/api/app/services/workflow_skill_registry.py` + `agent_canvas_prompt_preparation.py` 真实定义。
> **AdCraft 真实 Agent 角色**（7 user-facing + 多 capability）：
>
> | 1 | Director Agent（创意总监）| 含 product_design + world_setting 子能力 |
> | 2 | Script Writer Agent |
> | 3 | Character Designer Agent |
> | 4 | Scene Designer Agent |
> | 5 | Storyboard Agent |
> | 6 | BGM Agent |
> | 7 | Video Generation / Composition Agent |
> | 8 | Quick Media Agent（轻量文本节点处理）|

---

## §1 AdCraft Agent 角色对照表

| # | AdCraft Agent ID | 角色名 | Capability ID | 输入 | 输出 |
|---|---|---|---|---|---|
| 1 | `director` | Director Agent（创意总监 · Round 1 内嵌 product_design） | `video_agent_product_design`<br>`video_agent_world_setting` | 用户原始需求 | 整体方案（产品定位 + 世界观设定） |
| 2 | `world-setting` | World Setting Agent（世界观/连续性规则 · Round 1.5 串行） | `video_agent_world_setting` | 创意总监方案 | 世界观 5 要素（premise/era/place/spatial_logic/world_rules） |
| 3 | `script` | Script Writer Agent | `video_agent_script_authoring` | 创意总监方案 + 世界观 | 30s 脚本 + 卖点 + 字幕钩子 |
| 4 | `character-generation` | Character Designer Agent | `video_agent_character_design` | 脚本 + 世界观 | 角色 identity master + 三视图 |
| 5 | `scene-generation` | Scene Designer Agent | `video_agent_scene_design` | 脚本 + 角色 + 世界观 | 场景 identity + 多镜头组 |
| 6 | `prop-generation` | Prop Designer Agent（道具设计 · Round 2b 与 character/scene 并行） | `video_agent_prop_design` | 脚本 + 角色 + 场景 + 世界观 | 道具 identity + 跨段复用列表 |
| 7 | `storyboard` | Storyboard Agent | `video_agent_storyboard_design` | 脚本+角色+场景+道具+世界观 | 段拼接表 + 分镜 |
| 8 | `bgm` | BGM Agent | `video_agent_bgm_direction` | 分镜 | BGM 三段节奏 + SFX 关键时刻 |
| 9 | `storyboard-video-direction` | Video Direction Agent（动态设计 · 中间层） | `video_agent_video_direction` | 分镜+角色+场景+道具+世界观 | 每段 motion direction（subject action / camera motion / framing / transition） |
| 10 | `storyboard-video-generation` | Video Generation Agent（MCP 调用链） | (MCP execute) | motion direction + 资产 | 完整 MCP image_generate + video_generate 步骤 |
| 11 | Quick Media Agent（辅助 · 不在 Round 内） | Quick Media Agent | (TextNodeExecutor) | 单个文本节点 | 快速文本输出 |

---

## §2 编排策略（对齐 AdCraft 5 Round）

**Round 1**（串行）：Director（内嵌 product_design）→ 输出 `agent_director.json`
**Round 1.5**（串行 · 上游真相源）：World Setting Agent → 输出 `agent_world_setting.json`（5 要素：premise/era/place/spatial_logic/world_rules · 跨段连续性硬约束）🆕
**Round 2a**（串行 · Script 先出）：Script Writer 是上游真相源（女主名/配角/剧情锚点），必须先跑 → `agent_script.json`
**Round 2b**（并行 3 个 · 严格依赖 Script + World Setting）：Character Designer + Scene Designer + **Prop Designer** 并行，但**都必须读 director + script + world_setting**，才能锁定人物身份 / 配角入镜 / 道具复用 🆕 Prop
**Round 3**（并行 2 个）：Storyboard + BGM（都依赖 director + script + world_setting + character + scene + prop）
**Round 3.5**（串行 1 个 · 关键中间层）：Video Direction Agent → 输出 `agent_video_direction.json`（每段 motion direction，storyboard→video 的真实桥）
**Round 4**（串行 1 个）：Video Generation（MCP 调用链 · 依赖 Round 2+3+3.5）
**Round 5**（Quick Media · 辅助 · 不在 Round 内）：如需快速文案修订，可单起 Quick Media Agent

**AdCraft 真实 DAG 顺序**（来源：`apps/api/app/workflows/ad_workflow.py` line 1172-1300 edges）：
```
creative-direction → world-setting（串行 · Round 1.5）🆕
creative-direction + world-setting → script（串行 · Round 2a · 上游真相源）
script → character-design（并行）
script → scene-design（并行）
script → prop-design（并行）🆕
script → subtitle-generation（并行）  ← AdCraft 还有第 4 个并行项（我们的 marketing-ad-skill 简化用 drawtext 后处理替代）
character-design + scene-design + prop-design → storyboard
storyboard → storyboard-image-generation → storyboard-video-generation
                                                     ↑
                                          video_direction 是 video 的输入
                                          （storyboard-image-generation 输出 first_frame → video_direction 用 first_frame 设计 motion → video 跑 MCP）
```

**同步点 + 顺序依赖（重要）**：
- Script 是**上游真相源**（定义女主名/配角/场景锚点）→ 必须先串行
- Character 必须读 Script 的角色名 / 配角列表 → 不能与 Script 并行
- Scene 必须读 Script 的场景列表 / 配角入镜规则 → 不能与 Script 并行
- **禁止 Round 2 三件套完全并行**（否则必然出现"女主名不一致 / 配角入镜冲突"，eval-5 实测翻车）
- Storyboard + BGM 都在 Round 2 完成后才能并行启动
- Video 必须等 Storyboard 完成（需要分镜数据）

**eval-5 实测翻车记录（#8B-1 风险实证）**：
- 第一轮按 Round 2 三件套完全并行跑 → Character 女主名错"小鹿"（script 是"林小溪"）+ Scene 错锁"禁止男性入镜"（script 有男主江屿）
- 修复：按 AdCraft 真实 DAG 重跑 Character（读 director + script）→ 3 角色全填（林小溪/江屿/小胖）
- 下一步：Scene 重跑（读 director + script + character）→ 允许江屿+小胖入镜

---

### §2.1 段时长硬约束（12s 切分 · 受 agnes 视频模型限制）

**铁律**：所有 `video_generate_call.params.seconds` 必须 = **12**。

- **背景**：agnes-video-2.5-flash（multimedia-creator MCP）实测稳定输出 ≤12s，超过 12s 会被强制截断/拼接质量劣化/出现跳跃感
- **总时长换算表**（按 12s 切分）：

| 成片目标 | 段拼接 | 段数 | 备注 |
|---|---|---|---|
| 12s（单镜头广告） | 12 | 1 | 极少用 · 适合纯产品展示 |
| 24s | 12 + 12 | 2 | 适合极简剧情 |
| **36s（推荐短剧带货）** | **12 + 12 + 12** | **3** | **取代 30s 旧模板 · 段3 有完整 CTA 收束空间** |
| 48s | 12 + 12 + 12 + 12 | 4 | 长剧情 |
| 60s | 12 × 5 | 5 | 完整故事片 |

- **禁止**：6s/8s/15s/18s/24s 等非 12s 切分（旧 §3.3 段拼接表已废弃）
- **脚本/storyboard 同步**：脚本总时长必须 = N × 12s。若创意天然不是 12 倍数（如 30s），脚本补 6s 留白到 36s 或精简到 24s，不要出 6s 段
- **衔接连贯铁律**（用户第 41 轮新要求）：
  1. **末帧锚点**：每段 closing_state 必须是"可作为下一段 first_frame 的定格状态"（如 hero shot 居中特写/推门呆愣定格/眼妆成品 selfie）
  2. **首帧承接**：每段 opening_state 必须显式声明"承接上段 closing_state"
  3. **video_direction.continuity_handoffs** 每段间一对：服装锚点 / 道具锚点 / 光线锚点三选一明确锁定
  4. **禁止跨段跳跃**：人物服装 / 场景 / 光线三要素之一必须跨段延续；如必须切换（例素颜→妆后），显式声明"反差锚点"
  5. **finish 衔接校验**（脚本层）：抽每段末帧 vs 下首帧做 SHA1 比对 / 颜色直方图距离 < 阈值 → 报警告

---

## §3 Agent Prompt 模板（每个 Agent 一个 subagent 任务）

### Agent 1 · Director Agent（创意总监）

```
你是 AdCraft Director Agent。任务：
- 接收：{用户原始需求}
- Capability: video_agent_product_design + video_agent_world_setting
- 输出（JSON · 写到 outputs/agent_director.json）：
  {
    "creative_director": {
      "routing": "§3 商品展示 / §4 电商种草 / §5 游戏买量 / §6 品牌宣传",
      "category_signals": ["<关键词1>", "<关键词2>"],
      "product_design": {
        "product_name": "<产品名>",
        "category": "<品类>",
        "selling_points": ["<卖点1>", "<卖点2>", "<卖点3>"],
        "tone": "<品牌调性>"
      },
      "world_setting": {
        "contains_character": true/false,
        "contains_scene": true/false,
        "duration_seconds": 30,
        "platform": "<抖音/淘宝/小红书>",
        "style_keywords": ["<style1>", "<style2>"]
      }
    }
  }
- 验证：routing 唯一 + style_keywords ≥3 + duration ∈ {15, 30, 60}
- 完成后启动 Round 1.5（World Setting）和 Round 2a（Script）的 subagent
```

### Agent 1.5 · World Setting Agent（世界观 · Round 1.5 串行 · 上游真相源）🆕

```
你是 AdCraft World Setting Agent。任务：
- 接收：{outputs/agent_director.json}
- Capability: video_agent_world_setting
- 角色定位：定义广告世界的**硬约束**（跨段连续性 · 不允许后期漂移）· Round 2b 三件套的隐性上游
- 输入约束：
  - 不创作剧本 / 不写 dialogue / 不出 shot list / 不出 timeline / 不出 editing plan
  - 不选 provider / model / 时长 / 比例 / 分辨率
  - 不引用 sibling capability / Style package 内容
- 输出（JSON · 写到 outputs/agent_world_setting.json）：
  {
    "world_setting": {
      "premise": "<一句话世界观前提：抖音短剧带货 / 都市写字楼加班 / 古风仙侠试炼>",
      "era": "<时间锚点：现代都市 2024 / 民国 1930s / 架空古代>",
      "place": "<空间锚点：北京 CBD 写字楼 / 邋遢出租屋卧室 / 赛博朋克霓虹街>",
      "spatial_logic": "<空间一致性：卧室锁死禁止漂移到客厅厨房卫生间 / 街景锁死禁止漂移到室内>",
      "world_rules": ["<规则1：化妆前后反差需镜子>", "<规则2：≥3 角色入镜需每人锚点>", "<规则3：...>"],
      "continuity_for_assets": {
        "characters_required_to_appear": ["<角色1>", "<角色2>"],
        "props_required_to_recur": ["<道具1：眼影盘 hero>", "<道具2：宵夜盒>"],
        "forbidden_elements": ["<其他品牌化妆品>", "<字幕文字出现在画面中>"]
      },
      "style_keywords_seed": ["<style1>", "<style2>", "<style3>"]
    }
  }
- 验证：
  - 5 要素齐：premise / era / place / spatial_logic / world_rules ≥2
  - continuity_for_assets 3 子字段齐
  - 不写脚本 / 不写镜头
```

### Agent 2 · Script Writer Agent（脚本）

```
你是 AdCraft Script Writer Agent。任务：
- 接收：{outputs/agent_director.json 内容}
- Capability: video_agent_script_authoring
- 输出（JSON · 写到 outputs/agent_script.json）：
  {
    "script": {
      "hook_0_3s": "<视觉 hook 描述>",
      "body_3_25s": "<3-4 个卖点按时序>",
      "cta_25_30s": "<CTA 描述>",
      "selling_points": ["<卖点1>", "<卖点2>", "<卖点3>"],
      "subtitle_triggers": [
        {"time": "<时间点>", "text": "<字幕>"}
      ]
    }
  }
- 验证：30s 时长分配 + selling_points ≥3
```

### Agent 3 · Character Designer Agent（角色设计）

```
你是 AdCraft Character Designer Agent。任务：
- 接收：{outputs/agent_director.json + agent_script.json}
- Capability: video_agent_character_design
- 触发条件：director.creative_director.world_setting.contains_character = true
- 参考：`references/adcraft-assets.md` §1 9 字段
- 输出（JSON · 写到 outputs/agent_character.json）：
  {
    "character": {
      "identity_master": {
        "name": "<姓名/代号>",
        "gender": "<性别>",
        "age_range": "<年龄区间>",
        "ethnicity": "<种族/肤色>",
        "hair": "<发型发色>",
        "body": "<体型>",
        "outfit": "<服装>",
        "accessory": "<配饰>",
        "expression": "<表情基调>"
      },
      "three_views": ["<正面>", "<左45°>", "<右45°>"],
      "three_view_prompts": ["<image_generate prompt 1>", "<prompt 2>", "<prompt 3>"]
    }
  }
- 验证：9 字段全填 + three_view_prompts 长度 = 3
```

### Agent 4 · Scene Designer Agent（场景设计）

```
你是 AdCraft Scene Designer Agent。任务：
- 接收：{outputs/agent_director.json + agent_script.json + agent_world_setting.json + agent_character.json}
- Capability: video_agent_scene_design
- 触发条件：director.creative_director.world_setting.contains_scene = true
- 参考：`references/adcraft-assets.md` §2 6 字段
- 输出（JSON · 写到 outputs/agent_scene.json）：
  {
    "scene": {
      "identity": {
        "location": "<地点>",
        "lighting": "<光照>",
        "tone": "<色调>",
        "props": "<道具 · 与 prop_designer.json 跨段锚点对齐>",
        "depth": "<景深>",
        "forbidden": "<禁止元素>"
      },
      "multi_shot_set": ["<全景>", "<中景>", "<特写>", "<细节>", "<...>"],
      "scene_lock_instruction": "<场景锁定 prompt 句>"
    }
  }
- 验证：6 字段全填 + multi_shot_set ≥3 + props 与 prop_designer.json 一致
```

### Agent 4.5 · Prop Designer Agent（道具设计 · Round 2b 与 Character/Scene 并行）🆕

```
你是 AdCraft Prop Designer Agent。任务：
- 接收：{outputs/agent_director.json + agent_script.json + agent_world_setting.json + agent_character.json + agent_scene.json}
- Capability: video_agent_prop_design
- 角色定位：定义**次要道具**（除 hero product 外的小物件），不能抢主角戏，但跨段必须一致
- 输入约束：
  - 不编产品卖点（hero product 的 selling_points 由 product_design 定）
  - 不引入无关角色 / 无关场景
  - 不抄 sibling capability prompt
- 输出（JSON · 写到 outputs/agent_prop.json）：
  {
    "prop_design": {
      "props": [
        {
          "prop_id": "<prop_1>",
          "purpose": "<道具目的：眼影盘展示 / 宵夜盒锚点 / 咖啡杯路过>",
          "identity": {
            "name": "<名称>",
            "material": "<材质>",
            "color": "<颜色>",
            "silhouette": "<剪影>",
            "scale": "<与 hero product 比例>",
            "brand_relation": "<与产品的关联：竞品锚点 / 配角锚点>"
          },
          "recurs_across_segments": true/false,
          "first_appearance_segment": <N>,
          "continuity_lock_instruction": "<跨段锁定 prompt 句：'红色塑料袋+品牌贴纸宵夜盒锚点跨段统一禁止漂移到牛皮纸袋'>"
        }
      ],
      "forbidden_props": ["<其他品牌化妆品>", "<其他 logo 包装>"]
    }
  }
- 验证：
  - props 长度 ≥1（hero product 之外的次要道具）
  - recurs_across_segments=true 的 prop 必须有 continuity_lock_instruction
  - forbidden_props 与 scene.forbidden 一致
```

### Agent 5 · Storyboard Agent（分镜）

```
你是 AdCraft Storyboard Agent。任务：
- 接收：{outputs/agent_director.json + agent_script.json + agent_character.json + agent_scene.json}
- Capability: video_agent_storyboard_design
- **MUST 遵循 §2.1 段时长硬约束**：所有 segment.duration = 12（受 agnes 视频模型限制）
- **MUST 遵循衔接连贯**：每段 closing_state 显式说明"作为下段 first_frame 的定格状态"
- 输出（JSON · 写到 outputs/agent_storyboard.json）：
  {
    "storyboard": {
      "segment_table": "12s + 12s + 12s"（36s 总长）或 "12s × N",
      "total_duration_seconds": 36,
      "continuity_anchors": [
        {"from_seg": 1, "to_seg": 2, "anchor": "<服装/道具/光线跨段锚点>"}
      ],
      "segments": [
        {"idx": 1, "duration": 12, "shot": "<镜头>", "scene_id": "<场景>",
         "closing_state_for_next_segment": "<末帧定格描述 · 直接对接下段 first_frame>"},
        {"idx": 2, "duration": 12, "shot": "<镜头>", "scene_id": "<场景>",
         "closing_state_for_next_segment": "..."},
        {"idx": 3, "duration": 12, "shot": "<镜头>", "scene_id": "<场景>",
         "closing_state_for_next_segment": "..."}
      ],
      "storyboard_markdown_table": "<Markdown 表格>"
    }
  }
- 验证：
  - 所有 segments[].duration == 12（铁律）
  - total_duration_seconds = N × 12
  - continuity_anchors 长度 = N-1
  - 每段 closing_state_for_next_segment 非空
```

### Agent 6 · BGM Agent（背景音乐）

```
你是 AdCraft BGM Agent。任务：
- 接收：{outputs/agent_storyboard.json}
- Capability: video_agent_bgm_direction
- 参考：`references/bgm-sfx-library.md`
- 输出（JSON · 写到 outputs/agent_bgm.json）：
  {
    "bgm": {
      "three_stage": {
        "0-3s_hook": "<BGM 描述>",
        "3-25s_body": "<BGM 描述>",
        "25-30s_cta": "<BGM 描述>"
      },
      "sfx_key_moments": [
        {"time": "<时间>", "type": "<SFX>", "duration_ms": <ms>}
      ],
      "drawtext_subtitles": [
        {"time": "<0-2.5s>", "text": "<...>", "font_size": 48, "color": "white"}
      ]
    }
  }
- 验证：three_stage 3 时段齐 + sfx ≥2 + drawtext ≥3
```

### Agent 7 · Video Direction Agent（动态设计 · 关键中间层）🆕

```
你是 AdCraft Video Direction Agent（Capability: video_agent_video_direction）。任务：
- 接收：{outputs/agent_storyboard.json + agent_character.json + agent_scene.json + agent_director.json}
- 角色定位：**storyboard 与 video 之间的桥梁**。不直接调 MCP，只输出每段 motion direction
- 输入约束：
  - **MUST 遵循 §2.1 段时长硬约束**：所有 directions[].duration_seconds = 12（受 agnes 视频模型限制）
  - **MUST 衔接连贯**：每段 closing_state 必须是"可作为下段 first_frame 的定格状态"
  - 严格遵循 storyboard 的段拼接表（12 × N）
  - 跨段连续性来自 storyboard.continuity_anchors（角色服装锚点/场景道具锚点/光照连续性）
  - 不编造 duration / aspect_ratio / resolution / model（这些由 video agent 决定）
- 输出（JSON · 写到 outputs/agent_video_direction.json）：
  {
    "video_direction": {
      "summary": "<整片 motion direction 概览 · 一句话>",
      "continuity_handoffs": [
        {
          "from_segment": <N>,
          "to_segment": <N+1>,
          "anchor": "<跨段锚点：眼影盘纹理/林小溪服装反差/江屿宵夜盒>"
        }
      ],
      "directions": [
        {
          "segment": 1,
          "duration_seconds": 12,
          "opening_state": "<段首定格状态：林小溪疲惫坐姿 + 凌乱床铺>",
          "primary_action": "<段内核心动作链：狂翻抽屉→啪地甩出眼影盘→手部捏盘展示>",
          "closing_state": "<段末定格状态：眼影盘 hero shot 居中特写>",
          "subject_action": "<角色动作描述：林小溪手部动作 / 江屿推门动作 / 小胖路过>",
          "camera_motion": "<机位运动：固定顶视→轻微下摇跟随→推近 hero>",
          "framing": "<景别序列：中景→中近景→特写>",
          "transition_intent": "<段尾承接意图：眼影盘 hero shot 为段2 keyframe 锚定>"
        }
      ]
    }
  }
- 验证：
  - directions 长度 = storyboard.segments 长度（严格 1:1）
  - 每段 opening_state / primary_action / closing_state 三态齐
  - continuity_handoffs 长度 = directions 长度 - 1（每个段间过渡一个锚点）
  - 不写 prompt 全文（留给 Agent 8 拼装）
```

### Agent 8 · Video Generation Agent（MCP 调用链）

```
你是 AdCraft Video Generation Agent。任务：
- 接收：{outputs/agent_video_direction.json + agent_storyboard.json + agent_character.json + agent_scene.json}
- 角色定位：把 motion direction 转成实际 MCP 调用步骤（image_generate + video_generate）
- 必读 video_direction.directions[].{opening_state, primary_action, closing_state, subject_action, camera_motion, framing} → 拼装成完整 prompt
- **MUST 遵循 §2.1**：所有 video_generate_calls[].params.seconds = 12（铁律）
- 参考：`references/mcp-multimedia-creator.md` + `references/failure-modes.md`
- 输出（JSON · 写到 outputs/agent_video.json）：
  {
    "video": {
      "image_generate_calls": [
        {"step": 1, "purpose": "<对应 direction[0].closing_state 的 hero shot>", "prompt": "<完整 prompt>"}
      ],
      "video_generate_calls": [
        {"step": 2, "segment": 1, "mode": "keyframe", "first_frame": "step1 output", "seconds": 12, "prompt": "<拼装：direction[0] 三态 + 失败模式规避>"},
        {"step": 3, "segment": 2, "mode": "reference", "images": ["step2 角色立绘"], "seconds": 12, "prompt": "<...>"},
        {"step": 4, "segment": 3, "mode": "keyframe", "first_frame": "step3 末尾帧", "seconds": 12, "prompt": "<...>"}
      ],
      "concat_command": "ffmpeg -f concat -safe 0 -i segments.txt -c copy final_36s.mp4",
      "drawtext_subtitles_command": "ffmpeg -i final_36s.mp4 -vf \"drawtext=...\" -c:a copy final_36s_with_subtitle.mp4"
    }
  }
- 验证：
  - image_generate_calls ≥1（hero shot first_frame）
  - video_generate_calls = storyboard.segments 长度
  - **所有 video_generate_calls[].params.seconds == 12（铁律 · §2.1）**
  - 每段 first_frame / images 引用正确的 step 输出
  - 拼装的 prompt 含 direction 的 opening_state / primary_action / closing_state 全部三态
  - **#15 三轨同步**：dialogue_blocks ↔ drawtext_subtitles_command ↔ 各段 prompt DIALOGUE BLOCK 时间码 1:1 对齐 + 核心台词不跨段重复
  - drawtext_subtitles_command 必须为 v9 后处理（不在 video prompt 里要求 AI 渲染文字）
```

### Agent 9 · Quick Media Agent（可选 · 用于单节点文本修订）

```
你是 AdCraft Quick Media Agent。任务：
- 接收：{单个文本节点输入}
- 适用场景：用户在 Agent Canvas 上点单个文本节点，要求快速修订
- 输出：直接文本（不写 JSON 文件，直接返回）
- 验证：内容 ≤ 200 字
```

---

## §4 编排启动示例（Claude Code 实际操作）

**Round 1 · 串行**（起 1 个 Agent）：
```
Agent(prompt="Agent 1 · Director Agent prompt + 用户需求", subagent_type="general-purpose")
→ 完成后读 outputs/agent_director.json
```

**Round 2 · 串行 + 严格顺序依赖**（起 1 + 2 个 Agent）：
```
Round 2a · 串行：
- Agent 2 · Script Writer（先跑，定义女主名/配角/剧情锚点）

Round 2b · 并行（Script 完成后才能起）：
- Agent 3 · Character Designer（必读 director + script）
- Agent 4 · Scene Designer（必读 director + script）
```

**Round 3 · 并行**（起 2 个 Agent）：
```
并行起：
- Agent 5 · Storyboard
- Agent 6 · BGM
```

**Round 3.5 · 串行**（起 1 个 Agent · 关键中间层 🆕）：
```
Agent 7 · Video Direction Agent（storyboard→video 桥 · 输出 motion direction）
→ 完成后读 outputs/agent_video_direction.json（directions 长度 = storyboard.segments 长度）
```

**Round 4 · 串行**（起 1 个 Agent）：
```
Agent 8 · Video Generation（拼装 MCP image_generate + video_generate 步骤）
```

**Round 5 · 可选 Quick Media**（用户后续修订时）：
```
Agent 9 · Quick Media Agent
```

### §4.1 MCP 调度脚本（run_8agent_mcp.py · 一键出图+出片+字幕）

**痛点**：8-Agent JSON 里 `<step 1 image_generate 输出>` / `<step 2 末尾帧 (段1末尾帧)>` 占位符需要人手替换、抽末帧手跑 ffmpeg、最后手动 concat + drawtext — 容易在最后 100 米翻车。

**解决**：`scripts/run_8agent_mcp.py`（120 行 · 单文件 · 0 第三方依赖），4 步交互：

```bash
# 1. init：从 agent_video.json 解析步骤计划
python3 scripts/run_8agent_mcp.py init \
  --plan outputs/8-agent-test/eval-4/agent_outputs/agent_video.json \
  --output-dir ./run_xiaomei

# 2. next：打印下一个 step 的 MCP 调用参数（first_frame / images 占位符已自动 resolve）
python3 scripts/run_8agent_mcp.py next --output-dir ./run_xiaomei
#   → 打印 step 1 params，Claude 直接复制调 mcp__multimedia-creator__agnes25_image_generate

# 3. record：把 MCP 输出回喂（image 加 --image）
python3 scripts/run_8agent_mcp.py record --output-dir ./run_xiaomei \
  --step 1 --output https://cos-platform.../output_xxx.png --image
# 重复 next + record 6 次（3 image + 3 video），video 自动 ffmpeg 抽末帧

# 4. finish：一键出成片
python3 scripts/run_8agent_mcp.py finish --output-dir ./run_xiaomei
#   → 自动 ffmpeg concat demuxer + drawtext 4 句字幕后处理
#   → 输出 final_30s.mp4 + final_30s_with_subtitle.mp4
```

**脚本职责边界**：
- ✓ 管调度：state.json + step_plan.json + 占位符递归 resolve
- ✓ 管工程：自动抽末帧（ffmpeg `-sseof -0.1`）+ concat demuxer + drawtext 4 句后处理
- ✗ **不调 MCP**（multimedia-creator 工具只能在 Claude Code 会话内调用，由 Claude 按 next 步骤调）

**实证验证**（eval-0 用真实 MCP 产出重跑 record + finish）：

| | 原产出（手动 MCP） | 脚本产出（重跑） |
|---|---|---|
| final_30s.mp4 | 4.79 MB | 4.79 MB ✓ |
| final_30s_with_subtitle.mp4 | 5.72 MB | 5.59 MB ✓ |

**环境依赖**（脚本启动时**未**自动检测，需手动确认）：
- `ffmpeg` 在 PATH 中
- `wqy-microhei.ttc` 在 `/usr/share/fonts/truetype/wqy/`（drawtext 字幕字体）

**何时用**：
- 8-Agent 编排跑完后，你想**真出片**而不是只看 SOP — 用此脚本
- 想**局部重跑某段**（如段 2 涂抹效果不满意）→ 单跑 video_generate step 2 + 重新 record → finish 自动用新段替换
- 想**对比 2 次产出** → 把第一次 output-dir 备份，重跑新 output-dir，diff state.json 看哪段不同

---

## §5 与 SKILL.md 主流程的关系

| 维度 | SKILL.md 主流程（§2 5 阶段）| AdCraft 8-Agent 编排（本规范）|
|---|---|---|
| 执行方式 | 单 LLM 顺序 | 8 个独立 subagent 并行 |
| 成本 | 1x | 8x |
| 上下文连贯性 | 高（单 LLM 持有全局）| 中（依赖 JSON 传递 + 同步点）|
| 局部重跑 | 难（单次输出不可拆分）| 易（任一 agent 可单独 rerun）|
| 与 AdCraft 平台相似度 | 方法学 wrapper | 运行时模拟 |
| 适用 | 简单快速 SOP | 复杂多角色多场景 / 需 audit trail |

**默认走主流程**（§2）。仅在 §2.7 触发时切到本规范。

---

## §6 失败模式

| # | 模式 | 触发 | 修复 |
|---|---|---|---|
| #8B-1 | Agent 间 JSON 字段丢失 | 某 agent 漏字段 | 验证清单：每轮必查上一轮输出 JSON 含必填字段 |
| #8B-2 | 角色 Agent 输出污染场景 | 角色 JSON 含场景描述 | 角色 Agent prompt 明确限制只输出 9 字段人物特征 |
| #8B-3 | 分镜 Agent 段拼接错误 | 段拼接表选错 | 强制套用 §3.3/§4.3 MUST 12+12+6 |
| #8B-4 | 视频 Agent MCP 链断裂 | 缺 first_frame 步骤 | 强制 image_generate 在 video_generate 前 |
| #8B-5 | 声音 Agent drawtext 时间码超出 30s | enable=between(t, 27, 35) | 强制 t ≤30s |
| #8B-6 | Round 同步阻塞 | Round 3 等 Round 2 完成 | 明确每个 Round 等待上一 Round 完成 |
| #8B-7 | AdCraft 角色名不一致 | skill 用 "video_agent" / AdCraft 用 "storyboard-video-generation" | 本规范统一用 AdCraft agent_id 作为子 agent 标识 |