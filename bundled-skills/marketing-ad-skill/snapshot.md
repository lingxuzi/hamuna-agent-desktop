# video-skills 项目 snapshot

> 实时同步项目状态。完成后从 ACTIVE 区删除任务，保持 ≤500 行。

---

## 🧠 复用经验（已沉淀 · 跨任务可用）

### 段拼接铁律（第 41 轮）
- 36s = 12s × 3（hero + 价格 + CTA 完整收束）
- 24s = 12s × 2 / 60s = 12s × 5 / 48s = 12s × 4
- ❌ 任何非 12s 倍数 / 旧 30s 模板 `12+12+6` 已废 / ≤6s 短段

### hero shot 强制 4 步（§3.4 · 验证有效 · 仅 §3 商品展示）
1. MUST 先 `image_generate` 作 first_frame
2. MUST `video_generate` keyframe 模式（first_frame = 上一步 URL）
3. MUST hero shot 段时长 ≥4s（旋转/光线扫描/材质特写）
4. 涂抹场景 #14 修复：涂抹 ≥4s + 删"morning sunlight"暗示 + 暖台灯全程锁定

### 字幕永远后处理（v9 决策 · 验证有效）
- drawtext 4 句公式（30s/36s 通用）：0-2.5s 品牌名 / 8-10.5s 卖点1 / 15-17.5s 或 20-22.5s 卖点2 / 27-30s 或 33-36s 价格+CTA
- 字号阶梯：品牌名 48 / 卖点 44 / 价格 CTA 52 yellow
- 字体路径（Linux）：`/usr/share/fonts/truetype/wqy/wqy-microhei.ttc`
- 禁 AI 生成字幕（重复渲染/段尾不渲染/配音冲突）
- §6 品牌宣传 CTA 不显示价格（§6.4），改用品牌精神/CTA 句

### MCP 调用规范（实测 v2.5-flash）
- 单段 ≤12s · ratio 9:16 抖音 · size 1K 图片 / 720P 视频
- image_generate URL：`https://cos-platform-outputs.agnes-ai.cn/images/t2i/task_XXX/output_XXX.png`
- video_generate URL：`https://cos-platform-outputs.agnes-ai.cn/videos/agnes-video-2.5/task_XXX.mp4`
- 本地路径：`outputs/videos/{filename}.mp4` + `outputs/images/{filename}-1.png`
- 串行 vs 并行：文档说"video_generate 默认串行"，但实战验证并行可成功（小米 14 Ultra 3 段并行 ✅）。串行更稳，避免速率限制触发。

### MCP reference mode 数组序列化规范（2026-09-17 game_anime_36s 实测 · #8B-2）
- **铁律**：reference mode 的 `images` 必须是 **单元素数组** `["url1"]`，禁止多元素
- 根因：Claude Code harness 对**多元素数组**（≥2 项）会序列化成 `{"item": [...]}` dict → 工具调用返回 `Input should be a valid list [type=list_type, input_value={'item': [...]}]`
- 单元素数组 `["url1"]` 序列化正常（已实测：`status: pending → in_progress`，未触发 dict 化错误）
- **多元素场景规范**：
  1. 先用 `image_edit` / `image_generate` 把多张参考图 **合成为 1 张 contact sheet**（2×2 / 3×2 拼图），再传 reference mode 单元素数组
  2. 拼图 prompt：`2x3 grid contact sheet of 6 reference images, anime game PV style, 9:16 vertical layout`
  3. 多参考细节由合成图的视觉内容承载（模型读得到），prompt 内仍可补充描述
- **禁止 fallback 到 keyframe mode**：keyframe 模式单图作首帧，模型对多角色/多场景的"理解"全靠 prompt 文字 → 容易触发 #5/#8/#13 失败模式（场景漂移/锚脸失败）
- **禁止 keyframe 模式**当 reference mode 是更优解时，**SOP 主路径永远是 reference mode + 单元素数组**
- **修复验证**（2026-09-17 21:25 seg03 重跑）：reference mode + 单元素 contact sheet **2m 9s 一次过**，比 keyframe 兜底（8m 24s + 2 次 503 + 1 次 90% 超时）快 4 倍且零错误

### 画面内嵌中文渲染规范（2026-09-17 · game_anime_36s · 第 N 轮新约束）
- 触发场景：游戏买量 / 品牌 logo / 招牌 / 卷轴 / UI 文字 / 礼包文字需要**画面内直接显示中文**（非 drawtext 后处理）
- 必做 2 件事：
  1. **明确字体**：`思源宋体 Source Han Serif`（古风/书法）/ `思源黑体 Source Han Sans CN`（UI）/ `微软雅黑 Microsoft YaHei`（现代 UI）/ `KaiTi 楷体`（印章/卷轴）/ `SimSun 宋体`
  2. **引号包中文**："传说" "立即下载" "4K 60帧"  →  防止 AI 把中文当 token 语义化而忽略字形渲染
- 推荐模板（卷轴印章）：
  ```
  卷轴中央印有清晰楷体汉字 "传说"（黑色字体 · 思源宋体 Source Han Serif / KaiTi · 字号 0.15m 高度 · 居中 · 描金边）
  ```
- 推荐模板（UI 标识）：
  ```
  UI 标识区显示白底黑字游戏 UI 文字 "4K 60帧"（思源黑体 Source Han Sans CN / 微软雅黑 Microsoft YaHei · 字号 0.2m · 黑色加粗 · 白色描边）
  ```
- ⚠️ drawtext 后处理字幕不在此列（后处理用 `/usr/share/fonts/truetype/wqy/wqy-microhei.ttc`，已实测可用）

### drawtext 字幕时间码对齐 SOP（2026-09-17 game_anime_36s v3 · 实测）
- **铁律**：drawtext 时间码必须**按 final 视频实际累计偏移**计算，禁止套用段内模板
- Agnes 视频段**实际时长 12.256s**（非 12s 整数），3 段累加 final = 36.768s
- 偏移公式：段 N 字幕时间码 = `(N-1) × 12.256 + 段内相对时间`
- **更严格**：必须**抽帧验证**字幕与实际画面语义对齐（AI 生成的段内容可能与故事板叙事顺序不完全一致）
- v3 修复例（game_anime_36s）：
  ```
  句1 抽卡 hook    : 4.000 -  7.000  (段1 4-7s 金光球 + 星野遥走出)
  句2 4K 60 帧    : 12.256 - 15.256  (段2 开头 4 角色同框 + 60帧UI)
  句3 4 人联机    : 18.256 - 22.256  (段2 中后 副本门 + 联机UI)
  句4 BOSS CTA    : 30.512 - 35.512  (段3 末 BOSS 倒下 + 段尾)
  ```
- **禁止**：直接套用 `0-2.5/8-10.5/20-22.5/33-36` 模板（段3 末句会超出 final 时长 36.768s → 用户看不到）

### MCP 错误模式根因表（实测 3 次翻车后总结）
| 错误信息 | 真因 | 修复 |
|---|---|---|
| `'str' object has no attribute 'get'` | **API 返回 503 video_queue_full**，MCP 错误处理 bug 把 503 转成 Python str 错误 | 等待 60-120s 让队列恢复重试；不是参数问题 |
| `503 service_503 video_queue_full` | API 队列饱和，4 个 key 都失败 | 等 60-120s 重试 |
| `content_policy_violation` | prompt 含 wrinkles/smile/chubby/middle-aged | 删除敏感词 |
| 视频生成超时 | 队列等待过长 | 增加 `timeout_seconds`（默认 600s） |

### ffmpeg 拼接 SOP（验证有效）
```bash
cat > segments.txt <<EOF
file 'seg01.mp4'
file 'seg02.mp3'
file 'seg03.mp4'
EOF
ffmpeg -f concat -safe 0 -i segments.txt -c copy final.mp4
ffmpeg -i final.mp4 -vf "drawtext=..." -c:a copy final_sub.mp4
```

### 路由排除 §1.1（短剧带货 · 22 关键词）
命中即路由 `short-drama-ad-creator`：霸总/重生/灰姑娘/系统觉醒/战神/玄学/民国/年代文/穿越/复仇/赘婿/闪婚/离婚/替嫁/丫鬟/少爷/总裁夫人/豪门/古装言情/宫斗/宅斗/师徒/修真/仙侠/宫廷

### 视觉风格叠加规则（§9）
单段单风格，多段可换风格。推荐叠加：tech-cyberpunk + 雨夜/霓虹/故障/全息 · luxury-product-photography + Y2K/8-bit · 国潮东方 + 水墨/朱红/青绿/古风符号

### §6 品牌宣传 4 铁律（与 §4 区别）
1. 不强调具体功能/价格（§6.4）
2. CTA 只显示品牌精神 + logo，不显示 ¥价格
3. BGM 比人声重要（情绪叙事）
4. 适合品牌：奢侈品/汽车/国货/新茶饮/潮牌食品

### 11 Agent 编排铁律（2026-09-17 第 N 轮 · AdCraft 完整对齐）
- **默认走 11 Agent**（简单任务可走 §2 快速路径）
- **Round 2b 三件套严禁完全并行**（#8B-1 实证：Character 漏读 world_setting → 女主名错"小鹿"应为"林小溪"）
- **Round 3.5 Video Direction 是 storyboard→video 桥梁**，不能跳过
- 7 个 protected fields 不可覆盖（identity/face and hair/silhouette/wardrobe/accessories/rendering/gender）
- continuity_handoffs 段间锚点（服装/道具/光线三选一）

### MCP 视频生成并行可行（2026-09-17 multichar_3c_36s 实测）
- **段 3 (keyframe) + 段 2 (reference) + 段 1 (reference) 并行 3 段** ✅ 全部成功
- 单段失败（`'str' object has no attribute 'get'` = 503 队列问题）→ 等 60-120s 单段重试，不要全段重跑
- 视频下载路径会被 MCP 接管到 base dir `outputs/videos/`（不是 caller cwd），需要 `cp` 归位到工作目录

### run_8agent_mcp.py 完整版 5 命令（2026-09-17 · 端到端实测通过）
- `init` / `next` / `record` / `finish` / `grade` 5 命令（精简版 4 + grade）
- `next` 递归 resolve `<step N ... output>` 多层占位符（≤5 层 · **multichar_3c_36s 端到端验证通过**）
- `next` 自动推进 current_idx（让下一次 next 跳到下一步）
- `record` 视频步骤自动抽末帧（ffmpeg -sseof -0.1）
- `finish` 自动执行 ffmpeg concat demuxer + drawtext 4 句后处理（从 plan.post_process.drawtext 读字幕表）
- `grade` 21 断言自动验证（multichar_3c_36s 实测 **21/21 通过**）

**3 个真实 bug 修复**（端到端测试发现）：
1. `current_idx` 不自增 → next 死循环同一步（修：next 末尾 `plan["current_idx"] = step_num`）
2. JSON key 是 `str` 不是 `int` → resolve_placeholders miss（修：`step_num = m.group(1)` 不用 int()）
3. `first_frame` 实际路径在 `params.first_frame` 不是顶层（修：双路径查找 `step["first_frame"]` / `step["params"]["first_frame"]`）

### 风格库完整版 35 风格（2026-09-17 · style-library.md 重写）
- 5 核心 + 30 扩展 = 35 风格（含 4 类广告路由决策表）
- 单段单风格 · 禁止混搭 3+ 风格 · 多段可换风格

---

## 🚪 项目入口

| 模块 | 入口 | 状态 |
|---|---|---|
| `marketing-ad-skill/SKILL.md` | 主入口 · 500 行 | ✅ AdCraft 对齐 |
| 4 类路由 | §3/§4/§5/§6 + §1.1 短剧排除 | ✅ |
| 5 阶段 SOP | §2.1 路由 → §2.2 产品 → §2.3 创意 → §2.4 时间轴 → §2.5 提示词 | ✅ |
| 11 Agent 编排 | §2.7 + `references/8-agent-orchestration.md` | ✅ |
| 资产优先规范 | §2.6（角色+场景+道具） + `references/adcraft-assets.md` §2.5 道具 | ✅ |
| World Setting 5 要素 | §2.8 + `references/world-setting.md` | ✅ |
| Video Direction 中间层 | §2.9 + `references/video-direction.md` | ✅ |
| Protected Fields 7 字段 | §10.4 + `references/protected-fields.md` | ✅ |
| 11 条 Do Not 铁律 | §10.3 + `references/adcraft-boundaries.md` | ✅ |
| 衔接连贯铁律 | §3.3.1（4 步 · continuity_handoffs） | ✅ |
| 失败模式 | §10.1 + §10.2 + `references/failure-modes.md`（14 条） | ✅ |
| MCP 工具文档 | `references/mcp-multimedia-creator.md` | ✅ |
| 风格库 | §9 + `references/style-library.md`（5 核心 + 11 AdCraft 速查） | ✅ |
| 辅助 Agent | `references/auxiliary-agents.md`（role_prompt_authoring + quick_media） | ✅ |
| MCP 调度脚本 | `scripts/run_8agent_mcp.py`（init/next/record/finish 4 步骨架） | ✅ |
| 测试用例 | `evals/evals.json`（9 个：5 旧 + 36s × 2 + 多角色 + **§5 二次元 11 Agent**） | ✅ |
| 历史作品 | `outputs/` | ✅ **4 个归档**（xiaomi14u + chabaidao + multichar_3c_36s + **game_anime_36s**） |

---

## 📂 已交付作品归档

### game_anime_36s/（星云纪元 · 36s · §5 游戏买量 · 二次元卡牌/动作 · 3 角色 · **11 Agent 实测** · 2026-09-17 21:13）
- 主产品：虚构二次元动作手游「星云纪元」· 100 抽保底传说 / 4K 60 帧 / 4 人联机 / 礼包 CTA
- 风格：anime-game-pv · vivid color + cel shading + 暗紫浮空战场 / 召唤祭坛粉樱
- 角色：星野遥（5 星女剑士 · 银白长发 + 白色和服 + 太刀天照）+ 夜凛（5 星男法师 · 深蓝短发 + 黑色斗篷 + 法杖星辰）+ 深渊君主·厄夜（6 星 BOSS · 黑色铠甲 + 红色斗篷 + 金色面具 + 双手黑色巨剑灭世）
- 场景：二次元召唤祭坛（段 1）+ 二次元浮空战场（段 2-3）
- 视频：720×1280 9:16 · 24fps · h264+aac · **36.79s** · 16.4MB · 4 句 drawtext
- 段拼接：12s × 3（抽卡 hook+传说角色 → 4K 60 帧+联机共斗 → BOSS 战+礼包 CTA）
- 11 Agent JSON 全交付：director + world_setting + script + character + scene + prop + storyboard + bgm + video_direction + video（共 10 个 JSON）
- evals id 9 已实测通过（**28/28 断言 PASS**）
- **新发现 #8B-2**：MCP reference mode 数组被 harness 序列化成 `{"item": [...]}` dict → 改用 keyframe mode + first_frame + last_frame 兜底

### multichar_3c_36s/（漫步者 Lolli Pro 3 · 36s · §3 商品展示 · 3 角色 · **11 Agent 实测** · 2026-09-17 19:55）
- 主产品：漫步者 Lolli Pro 3 主动降噪真无线耳机 · 38dB 降噪 / Hi-Res 金标 / 30h 续航 / ¥499
- 风格：tech-cyberpunk · 玻璃幕墙夜景霓虹
- 角色：林小溪（女主·白领）+ 江屿（同事）+ 小胖（闺蜜·收尾）
- 场景：办公室（段 1-2）+ 公寓客厅（段 3 hero shot）+ 地铁（段 1 开场）
- 视频：720×1280 9:16 · 24fps · h264+aac · 36.79s · 8.4MB · 4 句 drawtext
- 段拼接：12s × 3（通勤痛点 hook → 卖点拆解 → hero shot+CTA）
- 11 Agent JSON 全交付：director + world_setting + script + character + scene + prop + storyboard + bgm + video_direction + video（共 10 个 JSON）
- evals id 8 已实测通过

### xiaomi14u_cyberpunk_36s/（小米 14 Ultra · 36s · §3 商品展示 · 2026-09-17 17:32）
- 风格：tech-cyberpunk + 雨夜/霓虹/全息叠加 · 平台：抖音
- 视频：704×1280 9:16 · 24fps · h264+aac · 36.79s · 8.6MB
- 段拼接：12s × 3（cyberpunk hook / 徕卡卖点拆解 / hero shot + 价格 CTA）

### chabaidao_zhuyeqingolong_36s/（茶百道 · 竹荞乌龙 · 36s · §6 品牌宣传 · 2026-09-17 18:00）
- 风格：国潮东方 + 水墨/朱红/青绿/古风符号 · 平台：抖音/快手
- 品牌精神：东方意境（"一口山水 · 万里清欢"）
- 视频：704×1280 9:16 · 24fps · h264+aac · 36.79s · 10.7MB（4 句 drawtext）
- 段拼接：12s × 3（国潮水墨 hook / 茶艺情绪叙事 / 品牌精神升华 + logo）
- CTA 段：§6.4 不显示价格（"国潮新饮 · 东方意境" 替代 ¥价格）

---

## 📋 11 Agent 补齐记录（2026-09-17）

### 调研结论（与 AdCraft 7 个关键差异）

| # | 差异 | 补齐方式 |
|---|---|---|
| 1 | World Setting（5 要素硬约束） | SKILL.md §2.8 + `references/world-setting.md` |
| 2 | Video Direction 中间层 | SKILL.md §2.9 + `references/video-direction.md` |
| 3 | Prop Designer（次要道具） | SKILL.md §2.6 + `references/adcraft-assets.md` §2.5 |
| 4 | 衔接连贯铁律（continuity_handoffs） | SKILL.md §3.3.1（4 步） |
| 5 | 角色身份保护（protected fields） | SKILL.md §10.4 + `references/protected-fields.md` |
| 6 | 11 条 Do Not 边界铁律 | SKILL.md §10.3 + `references/adcraft-boundaries.md`（已存在） |
| 7 | MCP 调度脚本 | `scripts/run_8agent_mcp.py`（精简骨架） |

### 12 步执行清单（全 ✅）

| # | 步骤 | 状态 |
|---|---|---|
| 1 | SKILL.md §2.6 加 Prop Designer | ✅ |
| 2 | SKILL.md §2.7 改默认 11 Agent（简单任务可选快速路径） | ✅ |
| 3 | SKILL.md §2.8 新增 World Setting 引用 | ✅ |
| 4 | SKILL.md §2.9 新增 Video Direction 引用 | ✅ |
| 5 | SKILL.md §3.3.1 衔接连贯铁律（4 步） | ✅ |
| 6 | SKILL.md §10.3 + §10.4 Do Not + Protected 引用 | ✅ |
| 7 | SKILL.md 文件结构 + 11 Agent 速查表 | ✅ |
| 8 | 创建 `references/world-setting.md` | ✅ |
| 9 | 创建 `references/video-direction.md` | ✅ |
| 10 | 创建 `references/protected-fields.md` | ✅ |
| 11 | 创建 `scripts/run_8agent_mcp.py`（精简骨架） | ✅ |
| 12 | 更新 `evals/evals.json`（加 36s + 2 个多角色用例） | ✅ |
| 13 | 更新 `references/adcraft-assets.md`（加 Prop §2.5） | ✅ |

**SKILL.md 行数**：497 → 575（超 75 行）→ 精简至 500 行 ✅