# 分镜提示词规范（multimedia-creator MCP · marketing-ad-skill 集成版）

> **来源**：原 `storyboard_prompt_spec.md`（287 行 · 实战验证 Z4/W3 写法 · 与 multimedia-creator MCP 配套）。
> **本文件作用**：作为 Round 3 Storyboard Agent + Round 4 Video Generation Agent 的**段内节奏驱动规范**。原 spec §0-§8 全部继承，并在每章加「marketing-ad-skill 适配」层。

---

## §0 三步流程（不可跳步）

### 0.1 三步定义

| 步骤 | 产出 | 落地 Agent |
|---|---|---|
| 1. 生成离散分镜 | `storyboard.discrete_shots[]`：每片 1-4s · 完整 prompt 文字 | Storyboard Agent |
| 2. 合并分镜组 | `storyboard.segments[]`：每段 8-12s · 合并依据 | Storyboard Agent |
| 3. 调用 MCP 生成视频 | `video.video_generate_calls[]`：每段一次 reference mode | Video Generation Agent |

### 0.2 关键约束

- **步骤 1** 的片段秒数（4s/2s 等）写在 prompt 文字里驱动模型节奏
- **步骤 3** 传给 MCP 的 `seconds` = 段总秒数（不是片段秒数之和）
- **步骤 2** 合并决策：跨场景/跨视角/无过渡的禁止合并

### 0.3 API 限制

MCP 视频生成 `seconds` ∈ **[4, 12]** · 单次调用时长硬约束。

### 0.4 与 marketing-ad-skill 12s 铁律的协同

| spec | marketing-ad-skill | 协同说明 |
|---|---|---|
| 段总秒数 8-12s | 段总秒数 **12s**（§3.3 铁律 · 60+ 轮验证） | **统一为 12s**：每段 12s（spec 下限 8s 取上限，符合 agnes-video-2.5-flash 限制） |
| 离散分镜 1-4s | 无（SKILL.md 原本只有 12s 单层） | **新增 discrete_shots 字段**：每段内拆 3-4 个 3-4s 子镜头 |
| 总时长模板 30s | 36s = 12s × 3（§3.3 新约束） | **段数变 N=3 起**：12/24/36/48/60s（12s 倍数） |

> **核心要点**：spec 的"段总秒数 8-12s"在本 skill 内**统一锁 12s**（受 agnes ≤12s 限制 + 衔接连贯铁律）。spec 的"每段拆 1-4s 离散分镜"作为**新增规范**进入 Storyboard Agent 输出，填补"段内节奏"的空白。

---

## §1 总时长

### 1.1 spec 默认

固定 **30 秒**，总秒数偏差 ≤ 0.5s。

### 1.2 marketing-ad-skill 适配

**总时长必须 = 12s × N**（N = 1/2/3/4/5，对应 12/24/36/48/60s）：

| 成片目标 | 段数 | 段拼接 |
|---|---|---|
| 12s | 1 | 12s × 1（极少用） |
| 24s | 2 | 12s × 2 |
| **36s（推荐）** | **3** | **12s × 3** |
| 48s | 4 | 12s × 4 |
| 60s | 5 | 12s × 5 |

**禁止**：30s（30 不是 12 倍数）/ 15s / 18s / 任意非 12 倍数。

### 1.3 §8 视频复刻例外（原片 ≥ 60s 时突破上限）

§8 视频复刻路由下，原片可能超过 60s（如 86.5s 乐事片）。**总时长 = 12s × N，N = ceil(原片时长 / 12)，上限放宽到 N ≤ 10（120s）**：

| 原片时长 | N | 拼接 | 适用 |
|---|---|---|---|
| ≤ 60s | 1-5 | 12s × N | §3-§7 路由 + §8 短原片 |
| 60-84s | 6-7 | 12s × N | §8 路由 |
| **85-96s** | **8** | **12s × 8** | **§8 路由（如 86.5s 乐事片）** |
| 97-108s | 9 | 12s × 9 | §8 路由 |
| 109-120s | 10 | 12s × 10 | §8 路由上限 |
| > 120s | ❌ | 不支持 | 拆分原片（按场景分段复刻）或拒绝 |

**§8 例外的 4 条配套规则**：
1. **每段末帧仍作下段 first_frame 锚定**（continuity_handoffs 不变）
2. **discrete_shots 仍按 3-4 个 1-4s 子镜头/段**（节奏不稀释）
3. **N > 8 时分批调用 video_generate**（避免 harness 5min timeout，建议 batch_size=4 + 串行）
4. **drawtext 后处理 公式按 §3 路由不变**（不按段数线性扩展，4-6 句足够）

**禁止**：N > 10（120s 上限，硬性） / 原片 < 60s 时硬套 N>5（§3-§7 路由仍走 60s 上限）。

---

## §2 两阶段结构（步骤 1 + 2 的设计依据）

### 2.1 阶段 A：离散分镜（raw shots）

- 每个分镜时长：**1s ≤ t ≤ 4s**（节拍紧凑，突出细节）
- 所有分镜秒数之和 = 段总秒数（= 12s × N）
- 同一分镜内部不可再分镜头/不可换场景/不可断角色动线
- 单段离散分镜数量预估：**3-4 个**（每段 12s 内）

### 2.2 阶段 B：合并分镜组（final storyboard groups）

- 将阶段 A 中**剧情连续、场景一致、角色动线无断裂**的相邻分镜合并
- 每个分镜组时长：**8s ≤ t ≤ 12s**（本 skill 统一 **12s**）
- 同一分镜组内可包含 1 ~ N 个原离散分镜

### 2.3 合并依据（满足任一即可合并）

1. 同一场景无切换
2. 同一角色动线延续（走位、对话、动作序列）
3. 同一情绪/节奏段

### 2.4 禁止合并

跨场景、跨时间（日/夜切换）、跨视角且无过渡的分镜。

### 2.5 marketing-ad-skill 适配：§8 qisi 复用

§8 入口触发时，**额外**继承 `references/qisi-section-decision-sop.md` §1 的 5 类 `split_reason` 枚举：
- `scene_change` / `time_layer_shift` / `wardrobe_change` / `action_complexity` / `duration_cap`

---

## §3 输出结构

### 3.1 spec 段结构

```
## 段 N：<段落标题>
<分镜组标题 1>
<秒数>s
<机位>+<光线>+<氛围>+<焦段>的连续描写，<分镜组内容>。
涉及资产时使用 <Picture N>(<角色名/物体名>) 在 <Picture M>(<场景名>) 中间 表示相对关系。

视频全程不要字幕、不要屏幕文字；必须保留协调统一的全局BGM和必要环境音，禁止静音段。
```

### 3.2 marketing-ad-skill Storyboard JSON 集成

Storyboard Agent 输出 `agent_storyboard.json` 必须含两个层：

```json
{
  "storyboard": {
    "total_duration_seconds": 36,
    "segments": [
      {
        "idx": 1,
        "duration": 12,
        "shot": "<段总标题>",
        "scene_id": "<场景ID>",
        "closing_state_for_next_segment": "<末帧定格>",
        "split_reason": "<5 类枚举 · §8 必填>",
        "discrete_shots": [
          {
            "sub_idx": 1,
            "duration_seconds": 3,
            "prompt": "<3s 子镜头完整 prompt>",
            "shot_type": "<中景/特写/微距>",
            "handoff_to_next": "<衔接下子镜头的元素>"
          },
          {
            "sub_idx": 2,
            "duration_seconds": 4,
            "prompt": "...",
            "shot_type": "...",
            "handoff_to_next": "..."
          },
          {
            "sub_idx": 3,
            "duration_seconds": 3,
            "prompt": "...",
            "shot_type": "...",
            "handoff_to_next": "<末子镜头必填 · 段尾承接>"
          }
        ],
        "prompt_combined": "<所有子镜 prompt 拼接 · 末尾接 BGM/字幕规则>"
      }
    ]
  }
}
```

### 3.3 子镜头 prompt 驱动节奏（spec §0 第 1 条落地）

每段 `prompt_combined` 内部必须用**"X秒"文字驱动节奏**，例如：

```
3秒 中景：林小溪疲惫靠在办公椅上，眼皮微抬。
4秒 推近特写：她手伸向抽屉，啪地甩出眼影盘，盘中粉彩闪烁。
3秒 微距 hero shot：眼影盘居中，光线扫过四色纹路。
4秒 推回中景：林小溪凝视眼影盘，嘴角微扬。

视频全程不要字幕、不要屏幕文字；必须保留协调统一的全局BGM和必要环境音，禁止静音段。
```

模型按文字"3秒/4秒/3秒/4秒"节奏生成，不会自动平均分配时间。

---

## §4 资产引用规则（reference mode 重映射）

### 4.1 spec 核心契约

`<Picture N>` 的 N 必须和 `images[]` 参数的索引对齐：
- `images[]` **只传 prompt 里实际引用的资产**，按引用顺序排列
- prompt 里的 `<Picture N>` 从 1 **连续编号**，无跳号
- `<Picture 1>` = `images[0]`，`<Picture 2>` = `images[1]`，依此类推

### 4.2 重映射示例

```python
# 全局资产库：林远(1)、仓库(2)、徽章(3)、档案室(4)
# 本段 prompt 实际引用：林远、徽章、档案室（不引用仓库）

# ✓ 正确：重映射
images = [asset_林远, asset_徽章, asset_档案室]  # 只传用到的 3 张
prompt = "<Picture 1>(林远) 在 <Picture 2>(徽章) 中间，站在 <Picture 3>(档案室) 的窗前"

# ✗ 错误：保持全局索引
images = [asset_林远, asset_仓库, asset_徽章, asset_档案室]
prompt = "<Picture 1>(林远) ... <Picture 3>(徽章) ... <Picture 4>(档案室)"
```

### 4.3 写法规范

| 规则 | 写法 |
|---|---|
| 单资产 | `<Picture 1>` |
| 资产关系（人物在场景） | `<Picture 1>(人物) 在 <Picture 2>(场景) 中间` |
| 多资产并列 | `<Picture 1>(A) 走向 <Picture 2>(B)，背景是 <Picture 3>(场景)` |
| 索引 N | 从 1 开始，**与 images[] 顺序对齐**（连续编号） |
| 括号注释 | 必须写角色名/物体名/场景名，便于模型理解 |

### 4.4 marketing-ad-skill 适配：与 §2.6 资产优先规范协同

- `images[]` 输入 = `character.three_views[]` + `scene.identity` 全景 + `prop.identity` 单图（每段按需选）
- **≤5 张限制**（agnes reference mode 上限）
- **多图场景**：合成 contact sheet（2×2/3×2 拼图）作单元素 `images[0]`（规避 harness dict 序列化坑，见 snapshot.md 复用经验 §"MCP reference mode 数组序列化规范"）
- **`scene_id` / `character_id` / `prop_id`** 来自 Round 2b 资产 ID，跨段一致

---

## §5 风格要求（继承自 sample_prompt.md + marketing-ad-skill 验证）

### 5.1 spec 默认要求

- 中文描写，机位/光线/焦段/氛围完整
- 镜头语言：低角度、平视、过肩、特写等
- 电影质感：噪点、黑柔、高光滚降
- 禁止字幕/屏幕文字（**仅限字幕叠加，道具/环境文字允许，详见 §5.1**）
- 强制全局 BGM + 环境音，禁止静音段
- **默认中文配音**（如需其他语言，在 prompt 中显式声明，详见 §5.2）

### 5.2 场景文字 vs 字幕叠加

| 类型 | 例子 | 是否允许 |
|---|---|---|
| 徽章刻字 | 徽章上刻「公安」两字 | ✅ 允许 |
| 报纸标题 | 背景报纸标题清晰可读 | ✅ 允许 |
| 灯牌/霓虹 | 灯牌写着"营业中" | ✅ 允许 |
| 文档内容 | 摊开的证词纸有手写字 | ✅ 允许 |
| 字幕叠加 | 画面下方显示「调查进度：70%」| ❌ 禁止 |
| 水印 | 画面角落有"@XX工作室" | ❌ 禁止 |

**实测验证**（spec §5.1）：prompt "徽章表面清晰刻着「公安」两个字" → 模型正确生成刻字，无字幕叠加 ✓

**写作建议**：描述道具文字时用"刻着/写着/印着/显示"等动词，避免"显示在画面上/出现文字"等可能触发字幕的措辞。

### 5.3 marketing-ad-skill 适配：drawtext 后处理（铁律）

**marketing-ad-skill 强制**（与 spec 字幕禁止一致 + drawtext 后压）：

1. **prompt 永远不写 AI 内嵌字幕**（避免 v9 决策的 AI 字幕重复/段尾不渲染/配音冲突）
2. **drawtext 4 句公式**（30s/36s 通用）：0-2.5s 品牌名（48pt white）→ 8-10.5s 卖点1（44pt white）→ 15-17.5s 或 20-22.5s 卖点2（44pt white）→ 27-30s 或 33-36s 价格+CTA（52pt yellow · §6 不显示价格）
3. **画面内嵌中文**（非字幕叠加）走 snapshot.md 复用区「画面内嵌中文渲染规范」：思源宋体 / 思源黑体 / 微软雅黑 + 引号包中文 + 字号 0.04-0.06m

---

## §5.2 配音语言（spec §5.2 W3 写法 · 完整性参考）

### 5.2.1 spec 验证结论

W3 是当前唯一已知同时满足所有约束的完整写法。

| 版本 | prompt 写法 | 配音 | 字幕 | 音频纯度 | 角色独白 | 旁白 | 道具文字 |
|---|---|---|---|---|---|---|---|
| Z1 | 末尾单点声明"中文普通话" | ❌ | - | - | - | - | - |
| Z2 | 全程中文 + 对白前明确语言 | ✅ | ❌ | - | - | - | - |
| Z3 | + 加粗严禁字幕 | ✅ | ✅ | ❌ BGM含人声 | - | - | - |
| Z4 | + 音频纯度反向声明 | ✅ | ✅ | ✅ | - | - | - |
| W1 | Z4 + 多个道具文字 + 旁白【】括号 | ✅ | ✅ | ✅ | ✅ | ❌ 旁白被配音 | ✅ |
| W2 | W1 + 旁白改动作描写 | ✅ | ✅ | ✅ | ❌ 画面出现 NPC | ✅ | ✅ |
| **W3** | W2 + **画面规则硬约束**（禁止生成额外人物） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 5.2.2 6 层正交约束（缺一不可）

1. **角色独白层**：**画面规则硬约束**（"画面中只允许出现一个角色"、"绝对禁止出现任何其他人物"）
2. **配音语言层**：全程中文 + 每段对白前"中文（普通话）"前缀 + 多处重复禁止外语
3. **字幕抑制层**：加粗"严禁字幕/严禁屏幕文字"
4. **音频纯度层**：禁止任何人声混入 BGM/环境音
5. **旁白抑制层**：禁止"用中文讲述/旁白："等句式，改为镜头动作描写
6. **道具文字允许层**：用"刻着/印着/写着"动词描写场景文字

### 5.2.3 对白描写禁忌

**禁止在 prompt 中使用直接引号 `""` 或 `""` 包裹台词**（会触发模型把台词字幕化叠加在画面上）。

**推荐方案**（X2 用例 · 实测）：

```
<Picture 1>(林远) 绝望而嘶哑地喊出："你看着我……看着我！"
镜头收拢在他被雨水打散的眼神上。

**严禁在画面上叠加任何字幕、严禁屏幕文字、严禁任何文字元素出现在画面中。**

视频全程不要字幕、不要屏幕文字；...
```

### 5.2.4 marketing-ad-skill 适配

- §7 UGC（口播）：W3 写法适用，但口播本身就是"角色独白"层无需额外约束
- §3-§6（4 类广告）：默认无对白（hero shot/种草场景），配字幕走 drawtext 后处理
- §8 视频复刻：若原片含中文对白，走 W3 写法；若含外语对白，需显式声明目标语言

---

## §6 自检清单（生成后必查）

### 6.1 spec 自检清单

- [ ] 离散分镜总秒数 = 段总秒数（每段 12s）
- [ ] 每个离散分镜 1s ≤ t ≤ 4s
- [ ] 合并后分镜组数量 = N（12s 总时长 / 12）
- [ ] 每个分镜组 8s ≤ t ≤ 12s（本 skill 统一 12s）
- [ ] `<Picture N>` 必须从 1 开始**连续编号**（与 images[] 顺序对齐）
- [ ] images[] 长度 = prompt 实际引用的资产数（只传用到的）
- [ ] 资产关系句式合法：`X 在 Y 中间`、`X 走向 Y`

### 6.2 marketing-ad-skill 增强自检（5 条新增）

- [ ] **每段 closing_state_for_next_segment 非空**（衔接连贯铁律 · §3.3.1）
- [ ] **每段内 discrete_shots 数量 = 3-4**（避免单段 1 个大动作导致"全程空转"，见 leshi_remix v1 翻车）
- [ ] **避免文学性间接表达**（"瞳孔倒映梦境" → AI 字面化为眼睛微距，改用"完整场景快速闪现"）
- [ ] **scene_lock_instruction 显式列举**（段首加"全程严格在 X 场景"，避免失败模式 #8 多场景漂移）
- [ ] **涂抹场景 ≥4s + 删"morning sunlight"暗示**（失败模式 #14 修复）

---

## §7 验证经验（避免误判）

### 7.1 spec 验证警告

⚠️ **单帧抽帧 ≠ 视频真实质量**。视频生成模型会做"连续叙事"，单子镜的中段帧可能：
- 看起来像别的子镜画面（其实是前后伏笔/铺垫）
- 缺少该子镜的主体（因为主体在动态中段而非静态帧）

### 7.2 正确验证方式

1. 用户**完整观看视频**判断连贯性（首选）
2. 抽帧只能校验：时长/分辨率/音频流/资产出现
3. 不要用单帧判断"子镜错位"——模型可能做了文学性叙事

### 7.3 当前测试结果

用户观看确认通过 ✓

### 7.4 marketing-ad-skill 适配：抽帧 SOP

- **避免 fps 抽帧漏掉字幕中心点**（leshi_remix 实战）：短字幕（2.5s）必须按**字幕中心时间点 ±0.1s 单独抽帧**（`ffmpeg -ss T -frames:v 1`）
- **覆盖所有子镜头切换点**：每段抽 N+1 帧（段首 + 每个子镜头切换点 + 段末），N = 离散分镜数
- **v6 → v7 短切片验证**：每段拆 6s 短切片 + 5 类显式标签（KEY VISUAL / DREAM SCENE SWITCH / WARDROBE CHANGE BACK / COLOR STORM TRANSITION / FINALE）→ 对齐率 79%（v6=64%）

---

## §8 步骤 3 调用示例（MCP video_generate）

### 8.1 spec 调用模板

```python
# 伪代码：每段独立调用
for segment in segments:
    # 按 prompt 首次引用顺序排列 assets（不是全局顺序）
    referenced = segment.referenced_assets_in_prompt_order
    response = agnes25_video_generate(
        prompt=segment.prompt_text,          # 含所有子镜prompt拼接
        mode="reference",
        seconds=segment.total_seconds,        # 段总秒数 12（本 skill 统一）
        size="720P",
        aspect_ratio="16:9",                 # 或 "9:16"
        images=[asset.url for asset in referenced],  # 与 <Picture N> 对齐
        output_filename=f"group{segment.index}.mp4",
    )
```

### 8.2 注意事项

- `mode="reference"` 必传，否则模型不知道资产关系
- `images` 顺序对应 `<Picture 1>`、`<Picture 2>`...（**只传用到的**，按引用顺序）
- 上游限流时**一路一路调用**，避免并发触发 key pool disable
- API 返回的 `seconds` 是请求值，实际视频时长可能有 ±0.25s 容器溢出，属正常

### 8.3 marketing-ad-skill 适配

- **必传 `mode="reference"`**（reference mode 比 keyframe 更稳 · 失败模式 #5/#8/#13 修复）
- **`images` 单元素数组 `["url1"]`**（harness dict 序列化坑 · 见 snapshot.md 第 35-44 行）；多图合成 contact sheet
- **`seconds=12`**（铁律 · 受 agnes-video-2.5-flash 限制）
- **`aspect_ratio="9:16"` 抖音 / `"16:9"` 横屏**（按平台）
- **视频生成调用前**：先 `image_generate` 出 hero shot / first_frame（§3 商品展示铁律 + §4-§6 通用增强）
- **drawtext 后处理**（铁律）：不在 prompt 里写 AI 内嵌字幕，走 §5.3 drawtext 4 句公式
- **contact sheet 拼图 prompt**：`2x3 grid contact sheet of 6 reference images, [风格关键词], 9:16 vertical layout`

---

## §9 与 Storyboard Agent 输出字段的对接（新增）

### 9.1 字段映射表

| spec 概念 | Storyboard Agent 输出字段 |
|---|---|
| 步骤 1 离散分镜 | `storyboard.segments[].discrete_shots[]` |
| 步骤 2 合并分镜组 | `storyboard.segments[]` |
| 步骤 3 MCP 调用 | `agent_video.json.video.video_generate_calls[]` |
| `<Picture N>` 重映射 | `agent_video.json.video.video_generate_calls[].params.images` |
| prompt 文字驱动节奏 | `storyboard.segments[].discrete_shots[].prompt` + `prompt_combined` |
| 自检清单 | Storyboard Agent 内置校验逻辑（5.2 + 6.2） |

### 9.2 Storyboard Agent 必读本文件（强制）

`references/8-agent-orchestration.md` Agent 5 · Storyboard Agent prompt 必须含：
> **MUST 遵循 `references/storyboard-prompt-spec.md`**：
> 1. 每段内拆 3-4 个 1-4s 离散分镜（`discrete_shots` 字段）
> 2. 离散分镜 prompt 用 "X秒" 文字驱动节奏（`prompt_combined` 字段拼接）
> 3. 资产引用走 `<Picture N>` 重映射规则（§4）
> 4. 末子镜头必填 `handoff_to_next`（承接段尾 closing_state）
> 5. 自检清单 6.1 + 6.2 全过

### 9.3 Video Generation Agent 必读本文件（强制）

`references/8-agent-orchestration.md` Agent 8 · Video Generation Agent prompt 必须含：
> **MUST 遵循 `references/storyboard-prompt-spec.md`**：
> 1. 每段独立 `video_generate` 调用，参数 `seconds=12`
> 2. `mode="reference"`，`images` 按 `<Picture N>` 顺序排列（只传用到的）
> 3. `prompt` 取 `storyboard.segments[].prompt_combined`（已含离散分镜 + BGM/字幕规则）
> 4. drawtext 后处理（v9 铁律）：不调 AI 内嵌字幕
> 5. 自检清单 §8.2 全过

---

## 📋 Round 0.5/§8 qisi 入口 + 本 spec 协同（关键）

§8 视频复刻入口触发时：
1. **Round 0.5** qisi Remixer 拆片 → 产出 `agent_qisi_remixer.json`（11 字段）
2. **Round 1-3** 与本 spec 协同：
   - `timeline_breakdown`（5-10s 切片）→ 对应 `discrete_shots`（1-4s 切片）
   - `borrowed_methods` → 离散分镜 prompt 必须用「在原片如何起作用」1-2 句标注（`narrative` 字段）
   - `pacing_signature` → `split_reason` 必填（5 类枚举）
3. **完整端到端样例**见 `references/qisi-creative-plan-example.md`

---

## 📂 相关 references

- `references/8-agent-orchestration.md` · Agent 5/8 必读
- `references/mcp-multimedia-creator.md` · MCP 调用模板
- `references/failure-modes.md` · 14 条失败模式
- `references/qisi-section-decision-sop.md` · §8 split_reason 5 类枚举
- `references/qisi-creative-plan-example.md` · §8 + spec 完整端到端样例