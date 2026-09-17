# UGC 口播路由（精简版）

> **完整 504 行规范**见 `bundled-skills/creative-video-suite/references/commercial/ugc-talking-video-ref.md`。本文件只放**精简执行版**——执行 UGC 任务的最小规则集，详细规则查源。

## 1. 触发关键词（首轮判定）

命中任一即路由 §7 UGC，**不走 §3 商品展示 / §4 电商种草 / §5 游戏买量 / §6 品牌宣传**：
**口播 / 真人讲解 / 种草 / 测评 / 开箱 / 教程 / 演示 / 批量达人 / UGC / 参考视频复刻 / 达人带货 / 信息流带货**

## 2. 与 §3/§4 的边界

| 维度 | UGC（本路由） | §3 商品展示 | §4 电商种草 |
|---|---|---|---|
| 主播出镜 | ✅ 必有（1-2 个真人） | ❌ 纯产品 | ❌ 纯产品或纯场景 |
| 剧情 | ❌ 无（无反转/逆袭/霸总） | ❌ 卖点拆解 | ✅ 1-2 使用场景 |
| 字幕 | ❌ **禁逐句字幕** | ✅ 4 句 drawtext | ✅ 4 句 drawtext |
| 真实感 | ✅ scroll-stopping 真人感 | ❌ 广告级 | ⚠️ 日常 vlog |
| 平台 | 抖音/小红书/快手/视频号 | 电商详情页 | 抖音/小红书 |

**典型误路由**：
- ❌ "完美日记 30s 抖音种草" → §4（日常 vlog）
- ✅ "完美日记 30s 抖音**口播带货**/真人讲解" → §7 UGC

## 3. 硬门控（视频生成前必过）

### 3.1 产品图强门控
- **必传产品图**（用户上传 / 04_assets/product-refs/）→ 否则**禁止**调 MCP 视频
- 降级路径（用户显式 ack"无产品图"）→ prompt 用文字描述产品（外观可能漂移），落 `project.json.notes.product_image_gate: "bypassed-by-user"`

### 3.2 字幕硬门控
- `subtitle_policy = off` 固定
- 视频 prompt **禁止**：逐句字幕 / 自动 caption / 双语字幕框 / lower-third / 口播逐字转写
- 口播台词**只能**用 `{具体台词}` 包裹，进入 `Monologue` / `Audio` / `audio_voiceover` 字段，**不进画面文字**
- 重点花字（卖点/价格/CTA）允许 ≤2 次、每次 2-6 中文字符；写在 `emphasis_text` 字段，**不**进视频 prompt

### 3.3 先分镜表再调视频
**禁止**在用户可见回答里输出分镜表前调用 `text_to_video/image_to_video`

## 4. 输出契约（5 项必输块缺一不可）

| # | 必输块 | 来源 |
|---|---|---|
| 1 | 风格调性 | style_anchor 强门控（用户提供 / ref 提取 / AI 起草必填） |
| 2 | 主播设定 | creator_identity_seed + 5 模板抽 1 |
| 3 | 产品锁定 | product_ref + product_lock 复述 |
| 4 | 轻量分镜表 | 时间/画面/口播/花字/产品保留点 5 列 |
| 5 | 视频链接/生成状态 | MCP 返回 URL 或本地路径 |

## 5. 强门控（commercial 输出契约层 + persistence 层双重确认）

1. **`style_ref` 来源强门控**：落盘前 `project.json.notes` 必含 `style_ref` 来源
2. **口播台词必独立落盘**：每段 `segment-XX-script.md` 纯文本，方便用户复制/二次创作
3. **重点花字落 `emphasis_text` 字段**：写在 `segment-XX.md` 头部 metadata，**不**进视频 prompt
4. **不**调 `image_edit`，**不**生成分镜图（默认交付是分镜表）

## 6. 主播脸谱（5 模板 + 男性映射 + 防撞脸）

模型只换衣服不换脸。解法：5 模板锁脸型/眼型/骨骼，再随机性别/肤色/发色/年龄/妆造/服饰。

| 模板 | 脸型/眼型/骨骼 | 鼻型/法令纹 | 气质（女/男映射） | 适配品类 |
|---|---|---|---|---|
| T1 清冷高级 | 鹅蛋脸/丹凤眼/颧骨平内收 | 高鼻梁挺直/几乎不可见 | 女:疏离精致 / 男:禁欲冷感 | 奢品/高端时尚 |
| T2 甜美邻家 | 圆脸/圆眼/颧骨低圆润 | 鼻头圆润小巧/极浅 | 女:甜美亲和 / 男:干净阳光邻家 | 日化/校园/生活方式 |
| T3 成熟御姐 | 方脸/桃花眼/颧骨高突出 | 高挺鹰钩感/自然浅 | 女:气场强大 / 男:硬朗成熟 | 职场/高端美妆/商务 |
| T4 中性盐系 | 长脸/单眼皮/颧骨平略突 | 直鼻鼻头圆润/浅 | 女:中性少年 / 男:寡淡盐系 | 潮牌/日杂/独立设计 |
| T5 异域浓颜 | 立体轮廓/深眼窝大双/高颧骨 | 立体高鼻翼/自然浅 | 女:异域深邃 / 男:硬汉浓颜 | 国际大片/美妆/旅游 |

**抽取规则**：
- 单条抽 1 模板做骨架锚点
- 批量 ≤5：每条用不同模板；>5：复用模板时必须换全部次级维度
- `used_creator_profiles` 维护：新主播不能与任一已用主播共享 > 3 主特征（模板/肤色/发色/年龄/妆造/服装主色）
- **男性映射**：男主播按模板男性映射走气质，**显式点名脸型+骨骼+鼻型差异**（方脸宽颧 vs 长脸窄脸 vs 立体深眼窝），严防男生同脸

## 7. 主播 5 维跨镜恒定硬门控（任何 UGC 视频 ≥2 镜头含主播必过）

| # | 维度 | 锁字段 | 跨镜字面一致 |
|---|---|---|---|
| 1 | 表情基线 | `appeal_baseline`（自然微笑 + 视线正对镜头） | MUST |
| 2 | 光线方向 | `light_direction`（窗边柔光/室内自然灯光/柔和顶侧光）+ `light_layers` | MUST |
| 3 | 服装 | 12 色板正向选择（雾霾蓝/砖红/墨绿/酒红/灰紫/牛仔蓝/炭灰黑/橄榄绿/海军蓝/珊瑚粉/薄荷绿）+ 同段内不换 | MUST |
| 4 | 发型/妆容 | 8 值正向抽值（深棕长直/黑色高马尾/栗棕微卷/酒红波浪/深黑短发/红棕锁骨发/利落黑色短发/深棕侧分短发）+ 妆容基底（淡妆/精致） | MUST |
| 5 | 身份锚点 | `creator_identity_seed` + `identity_anchor` **每段 prompt 头部逐字复用** | MUST |

**5 反模式**（任一命中 = 重新生成）：
- ❌ 表情跨镜头漂移（镜头 1 自然微笑 → 镜头 2 严肃凝视 → 镜头 3 疲惫）
- ❌ 跨镜头光线漂移（镜头 1 右前柔光 → 镜头 2 顶光硬光 → 镜头 3 侧光逆光）
- ❌ 跨镜头服装漂移（雾霾蓝 → 白色 T → 黑色）
- ❌ 跨镜头发型/妆容漂移（深棕长直淡妆 → 黑色马尾浓妆）
- ❌ 身份锚点首次写但后续段不复制（segment 1 完整 → segment 2 只写"主播继续出镜"）

## 8. 12s 4 段式（默认结构）

| Cut | 时长 | 任务 | 关键动作 |
|---|---|---|---|
| 1 hook | 0-2s | pattern interrupt 停滑开场 | 痛点暴击 / 反差 / 悬念 / 数字 |
| 2 产品证明 | 2-5s | 大特写 / 试用 / 质地 | 拿出产品 + 试用动作 + 关键特写 |
| 3 反馈 | 5-9s | 体验反馈 + 前后对比 | 戏剧反应 / 对比 / 推荐语 |
| 4 packshot+CTA | 9-12s | 产品 hold + 软 CTA | 产品清晰出现 + 软引导（收藏/看链接） |

**每段只做一个主动作，必须有信息增量**。全片 ≤4 段，每段 ≥3s，切镜只发生在段边界。

## 9. 逐秒分镜卡（YAML 模板）

```yaml
- label: "@image1"  # product_ref
  role: first_frame | product_only_frame | product_texture_frame | usage_effect_frame | final_state_frame
  time_range: 0-3s
  visual_description: 主播、产品、场景和情绪的完整画面
  spatial_description:
    foreground: 产品/手部/质地位置与占比
    midground: 主播半身/脸部/服装位置
    background: 按品类选（窗边晨光/原木厨房/咖啡馆/极简工作台/浴室梳妆台/ins风卧室/户外自然光）
    product_position: 产品在左/中/右/桌面/手中，logo 朝向
    camera_angle: 平视/俯拍/特写/中近景
    light_direction: 窗边柔光/室内自然灯光/柔和顶侧光
    light_layers: 明亮自然窗光 + 柔和暖色环境光，画面通透清晰不过曝
  shot_type: 中近景/特写/俯拍/产品微距/手部细节
  second_by_second:
    0-1s: 具体动作
    1-2s: 具体动作
  audio_voiceover: {具体台词}（12s 60-72 字 / 高密度 72-84 字；中文 5-6 字/秒；遵守 language_lock）
  seedance_motion_notes: 运镜、产品中心稳定、动作连续性
  must_preserve: [产品logo清晰, 包装与参考图一致, 场景/光源连续, 人物本条内一致, 有人时自然双眼眨眼]
  do_not_generate: [逐句字幕/自动caption/lower-third/口播逐字转写/水印, 修改产品包装, 新增假logo/假标签, 鼻钉/面部穿孔/大面积纹身]
```

## 10. 提示词编译（10 块名强制）

最终视频 prompt 必须使用块名：
- `Monologue` / `Selling points` / `Product name` / `Creator description`
- `Shots description` / `Style & Mood` / `Narrative Summary`
- `Dynamic Description` / `Static Description` / `Audio` / `Constraints`

**`Monologue` / `Audio` 中的完整口播**必须使用 `{具体台词}` 包裹（仅作声音/口型，不作字幕）。
**`Dynamic Description` 只写人物正在说话、口型同步、表情和动作，不写完整台词文本**。

**编译结构**（Seedance 2.0 指南）：
```
参考素材说明 → 全局目标/wow_target → 镜头1/镜头2/镜头3... → 画质风格 → 约束词
每个镜头 = 时间 + 主体(2-3个核心特征) + 动作表情(幅度/速度/力度) + 空间位置变化 + 运镜/切镜 + 光线风格 + 口播/音频
导演稿补充 = Style & Mood + Narrative Summary + Dynamic Description + Static Description + Audio
```

## 11. 真实感与防崩约束（prompt 末尾模板）

**硬负向**（0 分风险）：
```
preserve only the real product logo/label from the reference image;
no subtitles/no auto captions/no lower-third/no transcript-style text/no watermark;
emphasis text only if explicitly confirmed;
no fake/new/extra logo, no relabeled packaging;
不要逐句字幕、自动 caption、双语字幕框、口播逐字转写、水印；
不要连续滚动文字；
不要遮挡产品 logo/包装关键信息/人物眼睛/手部证明动作；
不要产品包装变形、logo/标签漂移、材质与参考图不符、产品比例漂移；
不要面部/手指/人体结构异常、人物重复分身、ID 漂移；
不要昏暗、低照度、曝光不足、画面发灰发闷、脸部大面积阴影、关键动作看不清；
不要鼻钉/鼻环/唇钉/眉钉/面部穿孔/大面积纹身；
不要口播语言与 brief 语言不一致、不要吞音含糊。
```

**软负向**（按需抽样）：不要全程僵直对镜/纯说话静止长镜头/全程咧嘴/单眼挤眼/TTS 机械念稿/廉价杂乱空间/滤镜感影棚感/面部痣/动作按固定节拍表演/每句同样语气。

## 12. 落盘契约

```
<workspace>/creative-video-suite/<project-name>/
├── project.json                                  # type="ugc" / style_anchor 强门控必填
├── 01_planner.md                                 # brief + style_ref 来源
├── 02_storyboard.md                              # 轻量分镜表
├── 03_assets/
│   └── product-refs/<产品名>.png                 # UGC 必传产品参考图
├── 04_videos/                                    # UGC 视频最终落这里
│   ├── segment-01.mp4
│   ├── segment-01.md                             # 元数据 + emphasis_text
│   ├── segment-01-script.md                      # 完整口播台词稿（独立文件）
│   ├── segment-02.mp4
│   ├── segment-02.md
│   ├── segment-02-script.md
│   └── ...
```

## 13. 工具调用（参考 templates/ugc-mcp-templates.md）

- **T06 video_reference_ugc**（首选）：产品图 + 主播图双锚，`mode="reference"` + `images=[product_ref, creator_ref]`
- **T12 video_text_ugc_default**（降级）：纯文生口播无图，`mode="text"`
- **T13 image_generate_multiview_grid**（opt-in）：仅 360° reveal / 多角度 packshot 触发
- 默认 12s、9:16、720P
- 单次失败重试 2 次（**0 微调**）；连续 3 次失败停下问用户；**不**降级 mode

## 13.1 价格/价格字符渲染铁律（2026-09-17 ugc_animal_eyeshadow_24s 实测）

**根因**：MCP `video_generate` prompt 内出现 `¥129` / `性价比` / `价格` / `价格对比` 等字符时，**AI 会自动渲染价格文字到画面**（即使没要求字幕）。emphasis_text 字段不能写进 Constraints 文本内，会被当 prompt 内容读，触发渲染。

**铁律**：
1. **video_generate prompt 内禁止出现 `¥价格` 字符**（包括 ¥/价格/数字价格）→ 改用语义表达 `性价比超高` `白菜价` `百元价位` `大牌平替`（AI 不会自动渲染成语义文字）
2. **emphasis_text 字段不写进 Constraints 文本**——它是 metadata 不进 prompt；如要画 ¥129，**必须**用 drawtext 后处理（v9 决策）
3. **加 1 句硬负向**：`no price / no ¥ symbol / no yen symbol / no RMB / no price tag / no cost number rendered on screen; no banner/ribbon/badge text overlaid on product; no sticker label`
4. **grade 必抽帧验证**：抽帧 5 个时间点（0/3/6/9/11s），**实际看到画面没有价格字幕才算通过**，不能只查 prompt 文字合规
5. **若需要价格花字**：默认走 drawtext 后处理（§6 drawtext 公式），**不**让 MCP 渲染

## 14. 升级路径（T12 → T06）

- 用户**未上传主播图** → 走 T12 text 模式
- 用户**上传主播图**（creator_ref）→ 走 T06 reference 模式锁主播面部
- 用户**上传产品图** → 必走 T06（**禁止**纯 text 描述产品外观）

## 15. 内部自检清单

- [ ] 是否先输出轻量分镜表再调用视频工具？成功格式 5 项齐全？
- [ ] 是否先产出 shooting script，并标注每段的高分目的（hook/产品证明/信任建立/视觉回报/CTA 收束）？
- [ ] 视频 prompt 是否包含 10 块名（Monologue/Selling points/Creator description/Shots description/Style & Mood/Narrative Summary/Dynamic Description/Static Description/Audio/Constraints）？
- [ ] 产品图是否最高优先级？每段复述 `product_lock`？包装/logo/SKU/材质不漂移？
- [ ] `excellent_target/wow_target` 是否明确？是否使用 12s 4 段式且至少 1 个高冲击镜头？
- [ ] 主播模板/男性映射/体型/服装发色是否去重并逐段复用？人物真实好看不撞脸？
- [ ] 口播是否中文 5-6 字/秒、12 秒 60-72 字？语言是否遵守 brief？音频是否清晰可懂？
- [ ] 是否满足 `recommendation_score`，每句有卖点/体感/证据动作，语感像真人临场推荐？
- [ ] 字幕 off 时是否没有逐句字幕/自动 caption/双语字幕框/口播逐字转写进入视频 prompt？
- [ ] 重点信息花字/贴纸文字是否只用于卖点/优惠/CTA/痛点反差或结果关键词？短、少、不遮挡？
- [ ] 硬负向是否没有误禁真实产品 logo？

---

**完整 504 行规范见** `bundled-skills/creative-video-suite/references/commercial/ugc-talking-video-ref.md`
