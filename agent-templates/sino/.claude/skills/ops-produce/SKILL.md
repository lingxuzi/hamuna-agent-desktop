---
name: ops-produce
description: >-
  素材制作。把一条选题变成可以直接投放的成品：按人选的形态出正文 / 脚本、封面、配图、
  视频（剪辑已有素材 + 配音，或按产品 AIGC 生成画面），边做边更新台账里的 progress，
  完成时置 ready。
  当用户说「把这条做出来」「写个稿子」「配张封面」「继续做那条」时用这个 skill。
---

# ops-produce — 素材

## 开工前先读

```bash
hamuna ops list asset --json
hamuna ops list direction --json
hamuna ops list material --json
```

还要读跟选题绑定的 topic（方向、平台、`--note` 里的判断）。先跑 `hamuna platforms <topic.platform> --json`，拿 `mediaKinds` 和 `limits`——硬上限只认这个命令；缺字段 = 还没核实，发布前现场看表单计数，不要猜。发布目标平台的创作口径读 `references/platform-profiles.md` 对应小节；它是口径，不是平台默认画幅。

**读上游台账看机会，别读存量产物抄答案。** `ops/` 里旧稿 / 旧 plan / 旧封面是原始记录，
用来参考结构、复用判断可以，但不要把它们当模板直接填空。每条素材重新从 topic 出发。

## 物料怎么挑：按 `note`，别按文件名

`ops/materials/` 是人投进来的原件（产品图、实拍、参考）。文件名不带语义，**依据是台账里
的 `note`**——「折叠桌正面产品图」「门店实拍，门口那台机器」这类。

```bash
hamuna ops list material --json   # 每条带 path / note / noteSource
```

- **`noteSource: 'user'`** —— 人写的，可以当事实用：它说这张是正面图，就是正面图。
- **`noteSource: 'agent'`** —— 我（或上一轮的我）扫出来的推测，**只能当线索**。
  要拿它当依据前先自己看一眼文件；看不出来就问人，别按推测写脚本。
- **`note` 为空** —— 还不知道是什么。别靠扩展名猜用途，直接问：「`2.jpg` 是干嘛的？」
  一次问完所有没描述的，别一个文件一轮。

挑中的物料在 plan 里写它的 `path`（`video_clip` 的 `sourceMaterials[]`、
`image_text` 的参考图），并把路径记进素材的 `--source-ref`，下一轮才知道这条成品用了哪批原图。

**缺物料就停。** 要做视频但台账里没有可用实拍，报给人「缺 X」，不要拿生成画面顶替
「真实产品实拍」——那正是用户要求「必须结合资产库里真实资产」的原因。形态是 `video_aigc`
时可以生成画面，但产品本体仍应取自真实物料。

## 形态由人定，不要猜

发布目标形态（`form`）是人基于 `topic.platform` 在运营面板里挑的。**它记在选题上（`topic.form` / `topic.formAspect`），不在素材上** —— 素材是从选题派生的，形态跟着选题走：

| `form` | 是什么 | 产物形状 |
|---|---|---|
| `image_text` | 有图有文 | 封面 + 配图 + 文案 |
| `image_only` | 只发图 | 图片 |
| `text_only` | 纯文字 / 文章 | 长文 |
| `video_clip` | 手里有现成素材剪成视频 | 素材剪辑 + 配音/字幕 → 成片 |
| `video_aigc` | 按产品 AIGC 生成画面 | 生成画面序列 + 配音 → 成片 |

**门禁：**
- `topic.form` 为空 → 这条先别做。报给人"先在面板上选形态"，停在这。
- `form` 和平台 `mediaKinds` 对不上（比如平台只收图文，人却选了 `video_aigc`）→ 直接停，报 blocker，不要做完才发现发不出去。
- `form` 是 `image_only / image_text / video_aigc` 且 `topic.formAspect` 为空 → 报给人"先在面板上选画幅"，停在这。
- **`formAspect` 没有平台默认值。** 画幅是人在面板上按这条内容定的，agent 不推断、不回退。
- 视频类形态**不在这一步定画幅** —— 画幅在选素材 / 规划阶段定，等到那一步再由人定。

## 先规划，再动手

`form` 明确、且对应的画幅门禁已过之后，**先出 plan**，等人确认了再开始产出。

- 读 `topic.note` / `topic.angle`，在 `03-USER.md` 里确认受众和口吻（用户没写就用中性口吻，不自作主张加人设）。
- 按 `form` 出一份 plan，写到 `ops/assets/<assetId>.plan.json`（schema 见下）。
- **plan 写完先过合规关，过了再报给人。** 见下面「合规关跑两次」——不过就自己改，
  改到过为止再过人，别把一份会被平台拦下的脚本推给用户确认。
- 写完用系统消息或对话把 plan 摘要报给人，**等确认**。
- 人确认后，按 plan 一步步产出。**不要在没确认的情况下直接开做。**

> `ops/assets/<assetId>.plan.json` 在，就说明这条规划过了。**不要重新规划**，接着做就行。只有人明确说"重做规划 / 换方案"，才覆盖 plan。

## 合规关跑两次

规则只有一份：`references/compliance-gate.md`。**跑两次**，两处都不过就不往下走。

| 时机 | 查什么 |
|---|---|
| **plan 确认前**（文字已经写出来，还没生成 / 剪辑） | 标题、正文、旁白、字幕、画面描述、封面大字里的违规表述 |
| **发布前**（成品在手，`ready` 之前） | 上面这些已经查过，这里补**画面本身**：首帧、封面实际渲染的字、素材实际用了哪一批 |

**为什么第一次必须在花钱之前**：`video_aigc` 按分镜收钱。脚本先审、过了再生成，
和先生成、发布前再审，差一整条视频的钱 —— 而且改脚本是改文字，改视频是重做。

**不过就自己改，不要报给人然后停下。** 改完重跑整关（改 A 处常带出 B 处的新问题），
最多 3 轮；3 轮还不过才停，报人时带上「哪条规则没过、试过哪几种改法、还剩哪一句」。
上限和三个兜底选项（放弃 / 换形态 / 人工改写）全在 `compliance-gate.md` 里，别在这里另定一套。

**画面里的字在 plan 阶段就要写出来**（封面大字、首帧标题），那时一起审。
等生成完才发现封面写着「全网最低价」，那笔钱已经花了。

### Plan schema（v1）

所有 plan 共用 envelope：`version: 1`、`assetId`、`topicId`、`form`、`formAspect`（图文/纯图必填，视频可空）、`confirmedAt`（人确认时写入，未确认为空）、`steps`。

各 `form` 的 `steps` 形状固定，内容自由发挥：

- **`image_text`**：`title`、`body`（分段）、`hashtags`、`images[]`（每张 `{role: cover|illustration, prompt, text_on_image?, composition?}`，role=cover 恰好 1 张）、`cta`
- **`image_only`**：`images[]`（`{prompt, text_on_image?, composition?}`，≥1）、`caption?`、`hashtags?`
- **`text_only`**：`outline[]`（章节标题 + 每节要点）、`title`、`estimatedWordCount`、`cta`
- **`video_clip`**：`sourceMaterials[]`（现成素材路径/描述）、`editPlan`（剪辑顺序 + 每段取舍）、`script?`、`subtitles?`、`bgmMood?`、`aspectRatio`、`estimatedDurationSec`
- **`video_aigc`**：`script`（旁白/字幕全文）、`scenes[]`（`{prompt, durationSec, transition?, narration?}`，≥1）、`bgmMood?`、`aspectRatio`（由人定）、`estimatedDurationSec`

`steps` 之外的字段不要加——下游渲染和检查只认这个 schema。

## 做的时候按形态走

**不管哪种形态，先读对应的 `references/`**，别凭感觉出。

### `image_text` / `image_only`

1. 文案：`copy-frameworks.md` 选框架 → `copy-structure-templates.md` 搭结构 → `hook-title-formulas.md` 拟标题/钩子 → `hashtag-strategy.md` 配话题。平台口径看 `platform-profiles.md`。
2. 配图：按 `visual-director.md` 出图，按 `generation-channels.md` 挑工具（有产品图就用带参考图的编辑类工具，别纯文生图）。画幅**只用 `topic.formAspect`**，不要自己挑。小红书封面文字密度和缩略图可读性优先（见 `platform-profiles.md`）。
3. 过质量闸：`ai-flavor-gate.md` + `quality-gate.md`。命中过 `phrases-to-remove.md` / `structures-to-avoid.md` / `zh-ai-markers.md` 的，改完再往下。

### `text_only`

1. 结构：`copy-structure-templates.md` 选长文骨架，`copy-frameworks.md` 定论证方式。
2. 正文：按 outline 写，章节之间要有过渡，不要 bullet 拼盘。知乎 / 公众号口径分别看 `platform-profiles.md`。
3. 过质量闸：同上。长文额外看事实密度和段落节奏。

### `video_clip`

1. **画幅还没定就停**，让人选 `topic.formAspect`（这时才定）。不要猜。
2. 先盘素材：`sourceMaterials[]` 里的东西能不能用、缺什么，报给人。
3. 按 `editPlan` 剪，脚本 / 字幕 / BGM 按 plan 补。不要重新构思一个和 plan 无关的版本。
4. 成片导出前过一遍 `quality-gate.md` 的视频条目（节奏、字幕可读、首帧）。

### `video_aigc`

1. **画幅还没定就停**。
2. 脚本先行：按 `references/visual-director.md` 出分镜 plan（景别、时长、画面、旁白/字幕、转场）。
3. **预览硬门**：先拼联系表**分镜拼图**给人看，确认构图、节奏、主体一致性；人没点头不调付费生成。单镜控制在 **15 秒**内。
4. **确认后按 `references/generation-channels.md` 调生成**：先看这个会话里真的有哪个出视频工具，
   产物要吸收 `ops/materials/` 里的真实产品图（当参考图传进去，不是在 prompt 里描写）。
   **有产品实拍就必须用实拍当参照**，不许拿生成画面顶替真实产品。默认出带音画成片。
5. 生成完过 QA（首帧钩子、节奏、字幕可读、AI 味硬伤）。主体变形就加死锚点重跑，
   每张重跑前问一句。工具缺 / 余额不足 → 报人，**不要自己降级形态**。

## 产物放哪

素材落盘到 `ops/assets/<assetId>/`（相对工作区）。plan 在 `ops/assets/<assetId>.plan.json`。`hamuna ops update asset` 只改台账字段，**不负责搬文件**。

## 更新台账

开始做：

```bash
hamuna ops update asset <id> --progress 10
```

做到一半，随手推：

```bash
hamuna ops update asset <id> --progress 60
```

`progress` 是 0–100 的整数，**只升不降**。卡住了**不要改状态**——素材状态只有
`draft / ready / published / unverified` 四个，没有 `making` / `blocked`；`--blocked`
这个 flag 也不存在，传了会被拒。卡点写进 `memory/YYYY-MM-DD.md` 并在汇报里说清楚，
素材留在 `draft`，`progress` 停在那不动。

做完：

```bash
hamuna ops update asset <id> --status ready --progress 100
```

`ready` 是「可以发了」的信号——**不是「已经发了」**。发布是另一条动作。

## 发布前自检

`ready` 之前过一遍：

- 标题 / 正文 / 话题符合 `platform-profiles.md` 对应平台口径；硬上限已用 `hamuna platforms <id> --json` 核过。
- 封面 / 首帧缩略图可读（小字在手机上看得清）。
- 事实、数字、引述有来源；没有就别写死。
- AI 味、禁用句式、结构套路过了对应闸门。
- 画幅 / 时长 / 文件格式符合平台要求（拿不准就现场看发布页）。

## 不要做

- 不要把 `ready` 当成 `published`；发布动作走 `ops-schedule` / 浏览器发布流，发完再回写 published。
- 不要跳过 `form` / `formAspect` 门禁；也不要自己脑补默认画幅。
- 不要在没确认 plan 的情况下开始产出成品。
- 不要直接改 `ops/state.json`。所有字段变更走 `hamuna ops update asset`。
- 不要为了"显得完整"虚构数据、截图、评论、播放量。
- 不要把别人的原文大段抄进正文；参考可以，改写要彻底。
