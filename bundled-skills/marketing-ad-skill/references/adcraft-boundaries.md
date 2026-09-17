# AdCraft Do Not 边界铁律

> 来源：`AdCraft/apps/api/agent/skills/video_agent_*/SKILL.md` 11 个 agent 全部含 "Do Not" 章节。
> 用途：marketing-ad-skill 8/9-Agent 编排 + 4 类广告 SOP 必须遵守的硬约束（不是建议）。

## 11 条不可逾越

### 1. 不编造（Do not invent）
- 不编造产品规格 / 奖项 / 认证 / 销量 / 用户证言
- 不编造品牌历史 / 创始人故事 / 价格优惠（除非用户明确给出）
- 失败模式 #12：50-year-old+chubby+wrinkles+smile 触发 content_policy_violation → 删

### 2. 不伪造输出（Do not fabricate completed URLs）
- Agent 不能伪造已完成的 MCP 输出（URL/path 必须真的来自 MCP 返回）
- `scripts/run_8agent_mcp.py record` 必须接收真实 MCP 输出

### 3. 不覆盖身份字段（Do not paraphrase identity）
character_turnaround 的 protected 字段必须**精确传递**，不意译/不总结/不翻译/不丰富化：
- `identity`（name, age, gender, ethnicity）
- `face and hair`（发型发色 / 五官）
- `silhouette and proportions`（体型比例）
- `wardrobe`（服装）
- `accessories`（配饰）
- `rendering mode`（CG / 写实 / 二次元）
- `gender presentation`（性别表达）

editable_prompt 只能描述 requested turnaround presentation（站位/构图/灯光），不能替换 protected fields。

### 4. 不混语言（Render user-visible in response_locale）
- user-visible（prompt 描述 / 字幕文字 / 产品名）→ 用户语言
- internal control（agent capability / parameter name）→ English
- 多语言处理：zh-CN 用户 → prompt 主体中文 + 技术参数 English

### 5. 不复制 sibling prompt（Do not import sibling full prompts）
- 每个 Agent 只读自己的输入 + 必要上游 JSON，不抄其他 Agent 的 prompt 全文
- AdCraft 各 skill 明确禁止"Do not copy sibling prompts, use unbound Assets"
- 对应失败模式 #8B-1 风险实证（eval-5 重跑前 Character 抄了 Scene 的 "禁止男性入镜"）

### 6. 不在 video prompt 里要求 AI 渲染字幕（v9 铁律）
- 字幕永远后处理（drawtext `enable='between(t,T1,T2)'`）
- video_generate prompt 必须含 "禁止任何字幕文字出现在画面中"
- subtitle / CTA / 价格数字 全部走 `drawtext_subtitles_command` 后处理

### 7. 不跨段漂移（Scene lock mandatory）
- 多场景视频必须显式列举场景元素 + 跨段道具锚点 + 角色识别锚点
- 失败模式：#7 跨段场景叙事漂移 / #8 多场景 prompt 漂移 / #13 reference mode 反派镜头背景漂移

### 8. 不引入无关角色/道具
- `scene_board` 不能引入 positive Character/Product/Prop 内容（AdCraft world_setting 硬约束）
- `prop_design` 不能变成 unsupported product claim

### 9. 不选择 provider / credential
- prompt 编写类 Agent（role_prompt_authoring / quick_media / video_direction）**不**选 provider / model / duration / aspect-ratio / resolution
- 这些由 Python orchestration 层决定

### 10. 不提交任务（Do not submit tasks）
- 所有 Agent 输出 JSON，不直接调 MCP / provider API
- 实际 MCP 调用由 Claude 在 `next` 步骤执行

### 11. 不读 unbound Assets
- character / scene / prop 只能用 approved references（同 shot / 同 segment 提供的）
- 不能引用其他段或其他场景的资产
- 对应失败模式 #4 hero shot 漂移（用未授权图片作 first_frame）

---

## 失败模式 → Do Not 映射

| 失败模式 # | Do Not 编号 | 一句话修复 |
|---|---|---|
| #4 hero shot 漂移 | #7 #11 | 强制 first_frame image_generate + keyframe mode |
| #7 跨段场景叙事漂移 | #7 | 场景锁定 + ≥4s 单一景别 |
| #8 多场景 prompt 漂移 | #7 | 多场景必须 scene_lock_instruction |
| #10 "无字幕"误读 | #6 | 字幕永远后处理（drawtext） |
| #11 zombie 误读 | #1 | 不写"眼眶微红+瞳孔微缩" → 改"眼神聚焦+眼睛瞪大" |
| #12 content_policy_violation | #1 | 删 wrinkles / smile / chubby / middle-aged |
| #13 反派镜头背景漂移 | #7 #11 | scene_lock 列举反派镜头背景元素 |
| #14 涂抹场景漂移 | #7 | 涂抹 ≥4s + 删 morning sunlight + 暖台灯锁死 |
| #8B-1 角色名漂移 | #3 #5 | character protected 字段精确传递 + 不抄 sibling prompt |

---

## 4 类广告边界特殊约束

### §3 商品展示广告
- 不能编造产品认证 / 奖项
- hero shot 必须含产品包装 / 颜色 / logo（identity constraints）

### §4 电商种草广告
- 不能编造销量 / 用户证言 / 网红推荐
- 价格 / 优惠数字必须后处理（drawtext），不写进 video prompt

### §5 游戏买量广告
- 不能编造游戏特色 / 上线时间 / 礼包码
- CG / 二次元 / 写实 三选一，不能混搭（参考 style-library.md §3.2）

### §6 品牌宣传广告
- 不能编造品牌历史 / 创始人故事 / 媒体评价
- 情绪基调必须来自 brief，不能擅自升华到"民族品牌"等
