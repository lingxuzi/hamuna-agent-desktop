# multimedia-creator MCP 工具能力 + 调用模板

> **目的**：marketing-ad-skill 唯一允许的素材生成工具来源。所有 `image_generate` / `image_edit` / `video_generate` / `upload_image` 调用必须按本文档规范。

---

## 一、可用工具清单

| 工具名 | 用途 | 必传参数 | 常用可选参数 |
|---|---|---|---|
| `mcp__multimedia-creator__agnes25_image_generate` | 文生图/图生图 | `prompt` | `size`, `ratio`, `image_paths`（参考图）, `n`, `output_filename` |
| `mcp__multimedia-creator__agnes25_image_edit` | 图像编辑（含 mask） | `prompt`, `image_paths` | `mask_path`, `size`, `ratio`, `output_filename` |
| `mcp__multimedia-creator__agnes25_video_generate` | 文生视频/关键帧/参考图 | `prompt` | `mode`（text/keyframe/reference）, `seconds`（4-12）, `size`, `aspect_ratio`, `first_frame`, `last_frame`, `images[]`, `audios[]`, `videos[]`, `output_filename` |
| `mcp__multimedia-creator__agnes25_upload_image` | 上传本地图片到 img.remit.ee 公开 URL | `path` | - |

**模型**：默认 `agnes-image-2.5-flash` / `agnes-video-2.5-flash`

**第三方图片 host**：`img.remit.ee`（20MB 单文件上限，约 429 速率限制，调用间隔 15s）

---

## 二、4 类广告路由 → MCP 工具组合

| 广告类型 | 必须工具 | 典型调用流程 |
|---|---|---|
| 商品展示 | image_generate（hero）+ video_generate（参考图 mode） | hero 图 → 关键帧视频 → drawtext |
| 电商种草 | image_generate（角色/场景）+ video_generate（reference mode） | 角色立绘 → 多段视频 → drawtext |
| 游戏买量 | image_generate（CG 风格图）+ video_generate（text/keyframe mode） | 风格图 → 短段（4-8s）冲击 → drawtext + logo |
| 品牌宣传 | image_generate（氛围图）+ video_generate（keyframe mode） | 氛围图 → 慢镜视频 → 品牌 jingle |

---

## 三、video_generate 4 种 mode 用法

### 3.1 text mode（纯文本）

```json
{
  "prompt": "12s 视频规格...",
  "mode": "text",
  "seconds": "12",
  "size": "720P",
  "aspect_ratio": "9:16"
}
```

**适用**：纯文字描述、无需参考图的短视频片段（品牌宣传氛围段）。

### 3.2 keyframe mode（首帧图驱动）

```json
{
  "prompt": "12s 视频规格...",
  "mode": "keyframe",
  "seconds": "12",
  "size": "720P",
  "aspect_ratio": "9:16",
  "first_frame": "https://img.remit.ee/xxx.png"
}
```

**适用**：
- **商品展示 hero shot**（关键！避免失败模式 #4）
- 视频复刻（`first_frame` = 参考视频的关键帧）

### 3.3 reference mode（参考图锚定）

```json
{
  "prompt": "12s 视频规格...",
  "mode": "reference",
  "seconds": "12",
  "size": "720P",
  "aspect_ratio": "9:16",
  "images": [
    "https://img.remit.ee/char1.png",
    "https://img.remit.ee/scene1.png"
  ]
}
```

**适用**：
- **多角色/多场景锚脸**（电商种草、品牌宣传）
- **场景/角色不漂移**（避免失败模式 #5/#8/#13）

**约束**：≤5 张参考图。

### 3.4 关键决策树

| 场景 | mode |
|---|---|
| 商品展示 hero shot | **keyframe** |
| 电商种草 1-2 使用场景 | **reference**（角色立绘 + 场景图） |
| 电商种草 涂抹类（美妆） | **reference**（涂抹 ≥4s + 场景锁定） |
| 游戏买量 hook 大场面 | text 或 reference |
| 游戏买量 抽卡金光爆发 | **reference**（角色立绘） |
| 品牌宣传 氛围 | **keyframe**（氛围图作 first_frame） |
| 品牌宣传 人物 | **reference**（角色立绘） |

### 3.5 reference mode 资产重映射规范（来自 storyboard-prompt-spec §4）

**核心契约**：`<Picture N>` 的 N 必须与 `images[]` 索引对齐。`images[]` 只传 prompt 实际引用的资产，按引用顺序排列；prompt 里的 `<Picture N>` 也按这个顺序从 1 连续编号。

```python
# ✓ 正确（重映射）
images = [asset_林远, asset_徽章, asset_档案室]  # 只传用到的 3 张
prompt = "<Picture 1>(林远) 在 <Picture 2>(徽章) 中间，站在 <Picture 3>(档案室) 的窗前"

# ✗ 错误（保持全局索引）→ 仓库没在 prompt 出现但 images[1] 是它，模型误用
images = [asset_林远, asset_仓库, asset_徽章, asset_档案室]
prompt = "<Picture 1>(林远) ... <Picture 3>(徽章) ... <Picture 4>(档案室)"
```

**写法示例**：

| 规则 | 写法 |
|---|---|
| 单资产 | `<Picture 1>` |
| 资产关系（人物在场景） | `<Picture 1>(人物) 在 <Picture 2>(场景) 中间` |
| 多资产并列 | `<Picture 1>(A) 走向 <Picture 2>(B)，背景是 <Picture 3>(场景)` |
| 括号注释 | 必须写角色名/物体名/场景名，便于模型理解 |

**实测根因**（2026-09-17 game_anime_36s #8B-2 + 2026-09-19 v3）：Claude Code harness 对 `images` 多元素数组会序列化为 `{"item": [...]}` dict → 工具调用报 `Input should be a valid list`。**当前铁律**：

1. **单元素 contact sheet**：多参考图先用 `image_edit` 合成 2×2 / 3×2 contact sheet，再传 reference mode 单元素数组
2. **拼图 prompt**：`2x3 grid contact sheet of 6 reference images, [style], 9:16 vertical layout`
3. **SOP 主路径**：reference mode + 单元素数组，**禁止** fallback 到 keyframe mode（会触发 #5/#8/#13 失败模式）

### 3.6 段内离散分镜 + "X秒" 文字驱动（来自 storyboard-prompt-spec §0/§2）

**解决"全程空转"问题**（leshi_remix v1 翻车教训：v1 每段只有 1 个大动作，整 12s "空转"）：

**三步流程**：
1. **设计离散分镜**（每段 3-4 个 1-4s 子镜头，所有子镜头秒数之和 = 12s）
2. **合并成段**（按剧情连续性合并相邻子镜头，每段 12s，输出 `## 第N段` 结构）
3. **MCP video_generate**（每段独立调用 reference mode，`seconds=12`，子镜头秒数写在 prompt 文字里驱动节奏）

**关键约束**：
- 步骤 1 的子镜头秒数（3s/4s 等）写在 prompt 文字里驱动模型节奏
- 步骤 3 传给 MCP 的 `seconds` 是段总秒数（不是子镜头秒数之和）
- 子镜头合并决策：跨场景 / 跨视角 / 无过渡的禁止合并

**示例 prompt 段结构**：

```text
## 段1：办公孤独 → 梦境闪现 → 撕袋
<子镜头1 2s>办公桌特写。林晚低头批改试卷，表情疲惫。
<子镜头2 2s>青柠味梦境：水上乐园，林晚草帽+蓝裙。
<子镜头3 3s>林晚走在黄瓜切片城堡栈道上，回头微笑。
<子镜头4 2s>梦境切换至烧烤城堡大门。
<子镜头5 3s>林晚回到办公桌，从抽屉撕开乐事青柠味薯片袋。

涉及资产时使用 <Picture 1>(林晚) 在 <Picture 2>(办公桌) 中间。

视频全程不要字幕、不要屏幕文字；必须保留协调统一的全局BGM和必要环境音，禁止静音段。
```

### 3.7 prompt 写作禁忌（来自 storyboard-prompt-spec §5.2 + §11）

#### 3.7.1 对白描写禁忌（避免触发 AI 自动加字幕）

**禁止**：prompt 用直接引号 `""` 包裹台词却不加粗反向声明 → AI 把台词字幕化叠加在画面上。

**唯一已知有效写法（X2 验证）**：

```text
<Picture 1>(林远) 绝望而嘶哑地喊出："你看着我……看着我！"
镜头收拢在他被雨水打散的眼神上。

**严禁在画面上叠加任何字幕、严禁屏幕文字、严禁任何文字元素出现在画面中。**

视频全程不要字幕、不要屏幕文字；...
```

#### 3.7.2 道具文字 vs 字幕叠加（关键区分）

| 类型 | 例子 | 是否允许 |
|---|---|---|
| 徽章刻字 | 徽章上刻「公安」两字 | ✅ 允许 |
| 报纸标题 | 背景报纸标题清晰可读 | ✅ 允许 |
| 灯牌/霓虹 | 灯牌写着"营业中" | ✅ 允许 |
| 文档内容 | 摊开的证词纸有手写字 | ✅ 允许 |
| 字幕叠加 | 画面下方显示「调查进度：70%」 | ❌ 禁止 |
| 水印 | 画面角落有"@XX工作室" | ❌ 禁止 |

**推荐动词**（降低触发字幕概率）：`刻着 / 印着 / 写着 / 显示 / 标注 / 题着 / 题写`

**反面写法（容易触发字幕叠加）**：
- ❌ `画面显示「公安」字样`
- ❌ `画面中出现文字"第七起失踪案"`
- ❌ `字幕写着"你看着我"` ← 直接触发字幕

**反向声明模板**（凡是 prompt 含道具/场景文字描写，末尾必须加粗）：

```text
**严禁在画面上叠加任何字幕、严禁屏幕文字、严禁任何文字元素以字幕形式出现在画面中。**
**严禁水印、Logo、时间码、进度条等任何 UI 元素叠加。**
**只允许场景内道具/环境/文档上自然存在的文字。**
```

#### 3.7.3 配音 6 层约束（口播 / 视频复刻场景必跑）

| # | 层级 | 关键句式 |
|---|---|---|
| 1 | 角色独白 | 「画面中只允许出现一个角色」「绝对禁止出现任何其他人物」 |
| 2 | **配音语言（2026-09-22 强化为全 skill 铁律）** | **默认 = 中文（普通话）**，每段对白前加「中文（普通话）」前缀 + 多处重复禁止外语；除非 brief 明确指定其他语言 |
| 3 | 字幕抑制 | 加粗「严禁字幕/严禁屏幕文字」 |
| 4 | 音频纯度 | 禁止任何人声混入 BGM/环境音；BGM 必须是纯器乐 |
| 5 | 旁白抑制 | 禁止「用中文讲述/旁白：」句式，改为镜头动作描写 |
| 6 | 道具文字 | 用「刻着/印着/写着」动词描写场景文字 |

**漏掉任何一条都会触发对应副作用**（W1-W3 演进实证，详见 storyboard-prompt-spec.md §5.2）。

**配音语言默认 = 中文（普通话）· 全 skill 通用铁律（2026-09-22 新增）**：
- **触发场景**：所有含人物台词 / 画外音 / 口播 / 旁白的 video_generate prompt
- **默认行为**：人物台词 + 画外音 = 中文（普通话），无需用户确认
- **例外**：用户在 brief 明确指定其他语言（英文/粤语/日语/小语种）或 §8 视频复刻原片对白非中文 → 走原片语言 + brief 标注
- **prompt 落地模板**：
  ```
  中文（普通话）配音。
  全程中文对白，禁止英文/日文/粤语音节混入。
  每位角色说话前再次声明「中文（普通话）」。
  ```
- **来源铁律**：SKILL.md §10 Voiceover 段（2026-09-22 用户新增约束）

#### 3.7.4 手部解剖约束 + 反向提示词（2026-09-22 新增 · 解决"两个手"问题）

**触发场景**：video_generate prompt 含"手部动作"（拿/拿/舀/搅/举/抹/翻/拉/握）必跑。

**常见 AI 多手 / 镜像反手 bug**（实测 2026-09-22 oatmeal_vlog_36s）：
- ❌ **双源手叠加**：reference mode 给了角色 3 视图（含手部细节），当前镜头 prompt 又写"手部从冰箱拿出 X"，模型把 reference 图里局部手元素 + 新生成手叠加 → 一只角色 + 两只手（最常见）
- ❌ **镜像反手**：侧身镜头（45° / 90°）左右手错位，模型按 reference 图"镜像翻转"
- ❌ **多余手 / 三只手**：手部动作 + 背景物体（如"手伸向燕麦脆桶"+"燕麦脆桶位于画面外右侧"），模型额外生成"扶桶的手"

**反向提示词模板**（手部镜头必加 · 加粗）：
```text
**手部解剖约束**：画面中只允许出现一只手 + 一只手臂；严禁出现两只手同时执行同一动作；严禁镜像反手 / 左右手错位；手指数必须正确（5 指）；严禁多手 / 三只手 / 手从画面外凭空出现。
**anatomically correct hands, only one hand visible per shot, no mirror-flip, no extra hands, no third hand, five fingers per hand.**
```

**prompt 写法（强制约束 + 明确手数）**：
```text
# ✅ 正例（显式声明手数 + 反向约束）
4秒 特写：<Picture 1>(林小溪) 单手（右手）从冰箱拿出燕麦脆桶 · 燕麦脆桶侧面带品牌贴纸 · 镜头焦点在桶身。

**手部解剖约束**：画面中只允许出现一只手 + 一只手臂；严禁镜像反手；anatomically correct hands, only one hand visible, no extra hands.

# ❌ 反例（reference 已有角色 + 模糊"手部"）
4秒 特写：<Picture 1>(林小溪) 手部从冰箱拿出燕麦脆桶
→ 触发 bug：reference 图局部手元素 + 新生成手叠加 = 两只手
```

**reference mode 额外约束**（reference 给了角色立绘时）：
- 手部动作镜头 prompt 必须**显式写"单手 / 右手 / 左手"**，禁止只写"手部"
- 若镜头设计本应"双手"（如双手捧碗），reference 图必须包含该姿态示例，否则改用 keyframe 模式（先生成 first_frame）

**实战修复案例**：oatmeal_vlog_36s seg01 sub_idx 3（手部从冰箱拿出燕麦脆桶）出现两只手 → 修复后 prompt 见 §v1.1 重跑段。

---

## 四、image_generate 关键参数

### 4.1 size 与 ratio 对应（默认 1K）

| ratio | 适用平台 | 备注 |
|---|---|---|
| 9:16 | 抖音/视频号/竖屏 | 默认推荐 |
| 16:9 | B站/横屏 TVC | 横屏广告 |
| 1:1 | 小红书/Instagram | 商品展示图 |

### 4.2 关键 prompt 模式（直接复用）

**商品 hero shot 模式**：
```text
studio product photography, [产品名], dramatic side light,
matte black background, hyperrealistic, premium commercial photography,
faint film grain
```

**角色立绘模式**（参考 video-skills/short-drama-ad-skill §角色资产优先规范）：
```text
character identity master, full body portrait, front view,
[角色详细描述], [服装], [表情], consistent lighting setup
```

**氛围图模式**：
```text
[调性关键词] atmosphere, [场景], [光线], [色调], cinematic composition,
no character, no text
```

### 4.3 输出文件命名约定

```text
[广告类型]_[产品]_[版本]_[段号]_[元素].png
示例：show_charlotteruby_v1_seg3_heroshot.png
示例：brand_tea_v2_seg1_atmosphere.png
```

### 4.4 `n=1` API 硬约束（2026-09-21 落地）

| 参数 | 推荐值 | 说明 |
|---|---|---|
| `size` | `1K` 起步，资产图 `2K` 更稳 | 2K 给视频截帧留余量 |
| `ratio` | 视频用 `9:16`，角色立绘用 `3:4` | 与最终视频画幅对齐，避免裁切 |
| `n` | **`1`（API 硬约束，`n>1` 返回 400）** | 一次出一张最可控，重抽需要**串行多次调用** |
| `output_filename` | `asset<N>_<类型>_<描述>.png` | 见 §4.5 命名规范 |

**禁止 `n=4` 重抽策略**：必须**串行 4 次 `n=1`** 调用。

### 4.5 风格一致性约束（避免换场景换美术风格）

资产图的**色调/光线/噪点/焦段**必须统一，否则视频里会出现"换场景就换美术风格"的撕裂感。

**做法**：
1. **第一张资产出图后，立刻锁定风格关键词**（例：`冷白色侧光`、`低饱和青灰冷调`、`电影级数字噪点`、`85mm焦段浅景深`）
2. 后续资产图 prompt **必须复用同一组风格关键词**，只换主体/动作/场景
3. 风格关键词建议放在 prompt **末尾位置**（靠近模型视觉权重高的尾部）

**道具/场景类资产的材质色陷阱**：
- 道具放在**暖色材质**（木桌/纸堆/暖色布料）上，整图色调会被材质色拉离锚点
- 实测：徽章特写放在"深色木桌"上，整图漂移到暖棕褐
- **修复**：①背景改用冷色材质（金属/玻璃/水泥）；②prompt 末尾加**显式反向声明**：「整体色调严格保持冷青灰，禁止任何暖色调、棕褐色调混入」
- 角色类资产（人物+服装）色温相对稳定，主要踩点在道具/场景类

### 4.6 资产命名规范

```text
asset<N>_<类型>_<主体>_<状态>.png
```

| 字段 | 含义 | 示例 |
|---|---|---|
| `N` | 资产编号（与全局资产库索引对齐） | `1`、`2`、`3`、`4` |
| `类型` | `char` / `prop` / `scene` | `char`、`prop`、`scene` |
| `主体` | 角色名/物品名/场景名 | `linyuan`、`badge`、`archive_room` |
| `状态` | 可选，区分多张同类资产 | `front`、`side`、`closeup` |

**示例**：`asset1_char_linyuan_front.png` / `asset3_prop_badge_closeup.png`

### 4.7 资产图内中文渲染（已知字形陷阱）

**踩坑清单**：
- 形近字混淆（`公安` → `公案`；实测 `档案室` → `拭除室`）
- 简体/繁体不一致（prompt 写"繁体字"也会被生成简体）
- 标点错位（全角 vs 半角）
- 文字方向错误（横排 vs 竖排）

**文字生成三策略**（按命中率从高到低）：

**策略 1：具体文字 + 字体 + 引号（命中率 ≤30%）**

```text
门牌表面用 <字体>（<字体英文名>字体）印着<N>个<颜色><粗细>字："<具体文字>"，
字号占据门牌面积的<X>%。
文字必须连写为一个词，不能拆字、不能颠倒、不能使用形近字替换。
```

实测：6/6 渲染出字体/视觉权重但字形内容随机替换（"档"被替成"杭/梵/拉/扰/抚"等形近字）。**结论**：中文短词（≤3 字）写具体内容命中率 ≤30%。

**策略 2：模糊文字描写（推荐，命中率 100%）**

```text
门牌上有黑色宋体字（具体内容后期合成）
```

模型生成的是文字"凸起的视觉暗示"，无具体字也无错字。后期用 Photoshop/FFmpeg 在底图上叠加真实文字。**实测：5/5 命中**。

**策略 3：放弃图片文字，改用视频后期**

视频里如果有字幕叠加需求，**不要让模型生成文字**——视频后期用 ffmpeg `drawtext` 加字幕（与 §5.3 字幕永远后处理铁律协同）。

**经验法则**：中文短词（≤3 字）写具体内容命中率 ≤30% → 直接走策略 2/3。

**实战原则**：不为"字形不出错"而妥协改字。按规范生成，字错了就接受；改字迎合模型反而违背创作意图。

---

## 五、拼接 SOP（30s+ 必走）

### 5.1 30s 拼接（concat demuxer + -c copy）

```bash
# segments.txt
file 'seg1.mp4'
file 'seg2.mp4'
file 'seg3.mp4'

# 拼接
ffmpeg -f concat -safe 0 -i segments.txt -c copy final_30s.mp4
```

### 5.2 49s+ 拼接（v9b 修复 · concat filter，避免 silent 截断）

```bash
# 段 1/3 配 silent audio（避免 demuxer -c copy 在 24.5s 截断）
ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t 12 seg1_silent.mp4 \
  -i seg1.mp4 -c:v copy -c:a aac -map 1:v -map 0:a -shortest seg1_final.mp4

# concat filter（不是 demuxer）
ffmpeg -f concat -safe 0 -i segments.txt -filter_complex \
  "[0:v][1:v][2:v][3:v]concat=n=4:v=1[outv]" \
  -map "[outv]" final_49s.mp4
```

### 5.3 字幕永远后处理（第三十轮 v9 决策 · 铁律）

**绝对禁止**：prompt 中写"Subtitle at bottom / MANDATORY BOTTOM SUBTITLE / AI 内嵌字幕"等让 AI 生成字幕的关键词。

**正确做法**：`ffmpeg drawtext` 后压每句字幕：

```bash
ffmpeg -i seg.mp4 -vf \
  "drawtext=text='产品名':fontfile=/path/font.ttf:fontsize=52:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=10:x=(w-tw)/2:y=h-th-50:enable='between(t,27,28.5)'" \
  -c:a copy seg_with_subtitle.mp4
```

**理由**：
- AI 字幕重复渲染（v8 实证 4 次 → 2 次仍不彻底）
- AI 字幕段尾不渲染（最后 0.5s 渲染窗口不足）
- AI 配音串冲突（v8 沙僧声变猪八戒声）
- drawtext 时间码精确（fps=1 抽帧校准）/ 0 重复 / 0 配音冲突 / 字幕表可审计

**视觉标题例外**：草书标题/hero shot 等"画面元素"字幕仍可用 `MANDATORY CENTER FRAME` 关键词（AI 渲染中央大字）。

### 5.4 配音冲突修复（第三十轮 v11 决策）

```text
Use consistent [ambient/dedicated] audio throughout this entire
N-second segment. Do NOT switch audio between characters.
```

**触发场景**：游戏买量多角色对话、品牌宣传多人物同框。

### 5.5 video_generate prompt 通用 3 铁律（2026-09-23 · oatmeal_vlog_36s v1.4 沉淀 · 适用 §3-§7 全部含人物台词路由）

> **背景**：oatmeal_vlog_36s v1.0→v1.3 期间用户 3 次 grlling 暴露 3 类系统性 bug（台词重复 / vlog 变口播 / 单手约束不现实 / 跨段重复念同一句）。本节把修复提炼为 3 条**通用铁律**，所有含人物台词的 video_generate prompt 必须遵守（不限于 §4 vlog）。

#### 铁律 1：台词按段分配（每段只列本段负责的台词）

**反例 bug**：v1.2 prompt 末尾塞完整 8 句台词 + 强制"全程中文对白"→ 模型困惑，把全部 8 句都念 → 每段配音行为重复。

**正确做法**：把台词按时序分配到各段 prompt，每段 prompt **只列该段负责的台词**（不重复字面）：

```
Seg1 prompt:  本段仅播 2 句台词 —— 句①②（不提句③④⑤⑥⑦⑧）
Seg2 prompt:  本段仅播 3 句台词 —— 句③④⑤（不提句①②⑥⑦⑧）
Seg3 prompt:  本段仅播 3 句台词 —— 句⑥⑦⑧（不提句①②③④⑤）
```

**禁止**：在 prompt 末尾粘贴完整台词表（如"8 句台词依次为 ①... ⑧..."）—— 这是 v1.2 的元 bug。

#### 铁律 2：vlog/剧情类默认画外音，口播/UGC 类才明示对镜头说话

**反例 bug**：v1.2 prompt 写"林小溪讲：句①" / "林小溪此时开口讲" → 模型理解为人对镜头口播 → 触发口播脸模板，**vlog 真实感丢失**。

**正确做法**（按路由分类）：

| 路由类型 | 台词呈现方式 | prompt 措辞模板 |
|---|---|---|
| **§4 vlog / §8 剧情复刻 / §3 商品展示 hero shot** | **画外音独白**（声音来自画面外，画面中人物嘴部始终闭合不念词） | "本段全程画外音 · 林小溪独白（声音来自画面外，画面中林小溪不开口念词）：句①②" |
| **§5 游戏买量 / §6 品牌宣传** | **画外音旁白或环境音**（视情况） | "画外音旁白" / "环境音优先" |
| **§7 UGC 口播 / §3 纯产品讲解** | **口播对镜头说话**（人物面对镜头念稿） | "主播面对镜头口播台词句①②③" |

**强制反向提示**（vlog/剧情类必加）："严禁画面中人物张嘴说话、面对镜头口播、对着镜头念稿"。

#### 铁律 3：手部约束按场景现实（禁重叠手/第三只手/镜像反手/5 指错）

**反例 bug**：v1.1「两个手」修复矫枉过正 → 硬约束"只允许一只手" + "严禁两只手" → 与现实动作冲突（开冰箱门要扶门、搅拌要扶碗、拿食材可双手捧）。

**正确做法**：人手数量按现实需要**动态 1-2 只**，每只手必须 5 指正确，**只禁 4 类真实 bug**：

```
**手部解剖约束（按场景现实 · 禁重叠手）**：人手数量按现实需要动态 1-2 只
（拿食材可单手提 / 双手捧；开冰箱可一手开门一手扶门；拿勺搅可一手扶碗一手搅），
但每只手必须 5 指正确；严禁出现第三只手；严禁镜像反手（左右手结构对称错乱）；
严禁出现多只手重叠执行同一动作（v1.1 bug 根因：参考图残留手 + 新生成手叠加）；
per-scene realistic hand count, five fingers per hand, no third hand,
no mirror-flip, no overlapping hands, anatomically correct hands.
```

**禁止**：硬约束"画面中只允许出现一只手"——这是 v1.1 的矫枉过正元 bug。

#### 附加铁律：跨段不能重复同一完整句

v1.3 把句③拆成"首段"+"续段"配 Seg1 末 + Seg2 头 → 同一句念 2 次。**跨段不能重复同一完整句**——每句台词只归属 1 段（不能让 1 句横跨 2 段配音）。

#### v1.4 反向自检表（video_generate prompt 出炉前必查 4 项）

| # | 检查项 | 错误模式 |
|---|---|---|
| 1 | prompt 末尾是否粘贴完整台词表？ | ❌ 末尾贴 8 句完整台词 → 改"按段分配" |
| 2 | vlog/剧情 prompt 是否写了"人物讲：句①"措辞？ | ❌ "人物讲：句①" → 改"画外音·独白" + 严禁口播反向提示 |
| 3 | 手部约束是否硬约束"只允许一只手"？ | ❌ "只允许一只手" → 改"按场景动态 1-2 手 + 禁 4 类真实 bug" |
| 4 | 是否有完整句横跨 2 段？ | ❌ 句③拆"首段+续段" → 改"完整归属 1 段" |

---

## 六、调用时机与并发

| 阶段 | 调用 |
|---|---|
| §2.2 产品信息 | 不调用（仅收集信息） |
| §2.3 创意方向 | 不调用（仅产出文字方向） |
| §2.4 时间轴 | 不调用（仅产出节拍） |
| §2.5 最终提示词 | **调用**（按 4 类广告路由） |

**并发建议**：
- 多个 `image_generate` 可并行（如 hero shot + 角色立绘 + 场景图）
- `video_generate` 默认串行（避免速率限制 + 输出文件管理）
- drawtext 后处理在视频生成完成后串行

**速率限制**：
- image_generate：约 5-10 秒/次
- video_generate：约 3-8 分钟/段
- img.remit.ee 上传：约 15 秒/次（429 限速）

---

## 七、image_edit 用法（可选）

适用场景：
- hero shot 局部修改（如替换产品包装颜色）
- 角色立绘服装换色
- 场景图细节调整

```json
{
  "prompt": "将产品包装从红色改为黑色",
  "image_paths": ["https://img.remit.ee/original.png"],
  "mask_path": "/path/to/mask.png",  // 可选：仅修改 mask 区域
  "output_filename": "product_v2_black.png"
}
```

**mask 生成方法**：用 image_edit 工具的提示词或外部工具生成 mask PNG（白色区域 = 待修改）。

---

## 八、错误处理速查

| 错误 | 原因 | 修复 |
|---|---|---|
| `APIConnectionError` | 网络/服务商问题 | 重试 1-2 次；检查 API Key |
| `content_policy_violation` | prompt 含违规关键词 | 删除敏感词（wrinkles/smile/chubby/middle-aged） |
| 视频生成超时 | 队列等待过长 | 增加 `timeout_seconds`（默认 600s） |
| 字幕重复渲染 | prompt 含 AI 内嵌字幕关键词 | 删除（v9 决策） |
| 角色配音漂移 | 多角色段未声明 narrator | 加 `Use consistent narrator voice` |
| reference mode 场景漂移 | 多场景未锁定 | 段首加场景锁定指令 |
| `Input should be a valid list` | harness 把 `images` 序列化为 `{"item": [...]}` dict | 改用单元素 contact sheet 数组 |
| `n 必须为 1` | API 拒绝 `n>1` | 改为串行多次 `n=1` 调用 |
| 字幕"丢失"误判 | fps=1/12 抽帧漏掉 2.5s 短字幕中心点 | 按字幕中心点 ±0.1s 单独抽帧 |

## 九、自检清单（来自 storyboard-prompt-spec §6）

### 9.1 视频生成自检

- [ ] 离散分镜总秒数 = 12s × N
- [ ] 每个离散分镜 1s ≤ t ≤ 4s
- [ ] 每段 3-4 个离散分镜（避免"全程空转"）
- [ ] `<Picture N>` 从 1 开始**连续编号**（与 images[] 顺序对齐）
- [ ] `images[]` 长度 = prompt 实际引用的资产数（只传用到的）
- [ ] 资产关系句式合法：`X 在 Y 中间`、`X 走向 Y`
- [ ] 含对白段已套用 6 层配音约束 + X2 加粗反向声明
- [ ] 道具/场景文字段已加反向声明模板（§3.7.2）
- [ ] `mode="reference"` + `seconds=12` + 单元素 `images` 数组

### 9.2 资产图生成自检

- [ ] 同一角色多角度/多状态资产风格一致（色调/光线/噪点统一）
- [ ] 资产图分辨率 ≥ 720P 长边（视频截帧用 2K 更稳）
- [ ] 资产命名规范：`asset<N>_<类型>_<主体>_<状态>.png`
- [ ] 角色类资产出图后立刻人工/脚本校验一致性（瞳色/服装/伤痕/配饰）
- [ ] 场景类资产含明确空间感（前景/中景/背景），避免纯白背景
- [ ] 风格关键词统一锁（首张出图后立刻锁定，后续复用同一组）
- [ ] 道具放在暖色材质上时已加反向声明防色温漂移

### 9.3 图生视频自检

- [ ] `mode="keyframe"` 时 `first_frame` 与 prompt 起手镜头一致
- [ ] `first_frame`/`last_frame` 选自已有资产图或专门生成的关键帧
- [ ] 仅传 1 帧时用 `first_frame` 而非 `last_frame`（模型对首帧控制力更强）
- [ ] reference mode 与 keyframe mode **不要混用**——选一种
- [ ] 落幅是道具特写时拆成两段（人物镜头 + 纯道具特写）—— 见 snapshot.md v7 last_frame 踩坑

### 9.4 验证经验（避免误判）

⚠️ **单帧抽帧 ≠ 视频真实质量**。视频生成模型会做"连续叙事"，单子镜的中段帧可能：
- 看起来像别的子镜画面（其实是前后伏笔/铺垫）
- 缺少该子镜的主体（因为主体在动态中段而非静态帧）

**正确验证方式**：
1. 用户**完整观看视频**判断连贯性（首选）
2. 抽帧只能校验：时长/分辨率/音频流/资产出现
3. 不要用单帧判断"子镜错位"——模型可能做了文学性叙事

**字幕抽帧**（避免"字幕丢失"误判）：
- ❌ `fps=1/12`（每 12s 一帧）→ 全错过字幕中心点
- ✅ 按每句字幕中心时间点 ±0.1s 单独抽（`ffmpeg -ss T -frames:v 1`）