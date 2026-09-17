# BGM/SFX 库 · 4 类营销广告关键时刻表

> **目的**：4 类营销广告的 BGM 三段节奏 + SFX 关键时刻标准表。复用 short-drama-ad-skill 第三十轮 v9 决策（drawtext 后压）。

---

## 一、BGM 三段节奏通用表

| 时段 | 用途 | BGM 状态 | 关键 prompt 关键词 |
|---|---|---|---|
| 0-3s hook | 情绪冲击/视觉冲击 | 强起（鼓点+电子 / 弦乐+紧张） | "dramatic opening beat, energetic intro" |
| 3-25s 主体 | 叙事/产品展示 | 中频持续（轻快/温暖/史诗） | "consistent mid-tempo background music" |
| 25-30s CTA | 收束 + 引导 | 收尾渐弱 + 品牌音 | "fade out + brand jingle ending" |

**核心约束**：
- 禁止静音段（任何时段都必须有 BGM 或环境音）
- BGM 不要突然切换（除非场景强切换）
- CTA 段必须出现品牌 jingle（识别度）

---

## 二、4 类广告 BGM 风格

### 2.1 商品展示

| 时段 | 风格 | 关键词 |
|---|---|---|
| 0-3s hook | 鼓点 + 电子 | "energetic beat drop, electronic intro, product reveal" |
| 3-25s 主体 | 轻快 + 治愈 | "light upbeat, lifestyle music, positive mood" |
| 25-30s CTA | 收尾 + 品牌 | "fade out + brand jingle, call to action ending" |

**典型 BGM 关键词**：
```text
energetic electronic beat, premium product reveal music, lifestyle
upbeat background music, brand jingle ending, consistent mid-tempo
```

### 2.2 电商种草

| 时段 | 风格 | 关键词 |
|---|---|---|
| 0-3s hook | 痛点对比音 | "soft piano opening, problem presentation" |
| 3-25s 主体 | 轻快 + 温暖 | "lifestyle vlog music, soft guitar, warm mood" |
| 25-30s CTA | 收尾 + 引导 | "recommend music, encouraging ending" |

**典型 BGM 关键词**：
```text
soft acoustic opening, lifestyle vlog background music, warm
recommendation music, positive ending fade
```

### 2.3 游戏买量

| 时段 | 风格 | 关键词 |
|---|---|---|
| 0-3s hook | 高能量电子/摇滚 | "epic battle music, intense electronic drop, action opening" |
| 3-25s 主体 | 史诗/电子 | "epic cinematic music, continuous action BGM" |
| 25-30s CTA | 史诗收尾 + logo | "epic ending + game logo music" |

**典型 BGM 关键词**：
```text
epic cinematic battle music, intense electronic drop, dramatic
game trailer score, logo reveal ending
```

### 2.4 品牌宣传

| 时段 | 风格 | 关键词 |
|---|---|---|
| 0-3s hook | 戏剧化弦乐 | "cinematic strings, moody opening" |
| 3-25s 主体 | 情绪叙事 | "emotional cinematic score, brand storytelling music" |
| 25-30s CTA | 情绪升华 + logo | "emotional climax + brand jingle" |

**典型 BGM 关键词**：
```text
cinematic orchestral opening, emotional brand storytelling score,
climax resolution + brand jingle, consistent emotional arc
```

---

## 三、SFX 关键时刻表（4 类通用）

| 时刻 | SFX 类型 | 适用类型 | 触发 prompt 关键词 |
|---|---|---|---|
| 产品开盖 | "啪"开盖声 | 商品展示/电商种草 | "product cap opening sound effect" |
| 涂抹瞬间 | 皮肤触感音 | 商品展示/电商种草 | "gentle skin application sound" |
| hero shot 旋转 | 金属反光音 | 商品展示/品牌宣传 | "metallic reflection swoosh" |
| 价格数字出现 | "叮"清脆提示音 | 电商种草 | "notification bell sound" |
| 品牌 logo | 品牌 jingle | 全 4 类 | "brand logo reveal sound + brand jingle" |
| 抽卡金光爆发 | 魔法光效音 | 游戏买量 | "magical burst sound effect" |
| 战场/技能 | 战斗打击音 | 游戏买量 | "battle impact sound, skill activation" |
| 茶汤注入 | 茶汤流动音 | 品牌宣传（茶饮） | "tea pouring liquid sound" |
| 鸟鸣环境音 | 鸟鸣+清晨 | 电商种草（早晨） | "morning bird chirping" |

---

## 四、Voiceover（人声）使用规则

### 4.1 推荐场景

- **短剧带货**：强烈推荐 narrator voice（讲故事）
- **电商种草**：偶尔用 narrator（推荐口播）
- **商品展示**：偶尔用 narrator（产品介绍）
- **游戏买量**：偶尔用 narrator（"开局抽卡就送 100 抽"）
- **品牌宣传**：极少用（情绪独白）

### 4.2 提示词约束（避免配音漂移 · 第三十轮 v11 决策）

```text
Use consistent [mature female / deep male] narrator voice throughout this
entire N-second segment. Do NOT switch voices between characters.
```

**触发场景**：
- 游戏买量多角色对话
- 品牌宣传多人物同框
- 短剧带货旁白

### 4.3 配音漂移修复

| 症状 | 原因 | 修复 |
|---|---|---|
| 沙僧声变猪八戒声 | 多角色未声明 narrator | 加"Use consistent narrator voice throughout" |
| 男声变女声 | 性别切换 | 显式声明 "mature female voice" |
| 角色声音不一致 | 角色配音切换 | 加"Do NOT switch voices between characters" |

---

## 五、drawtext 后压字幕铁律（v9 决策 · 绝对禁止 AI 内嵌）

### 5.1 prompt 禁写关键词

```text
❌ 禁写：
- "Subtitle at bottom..."
- "MANDATORY BOTTOM SUBTITLE..."
- "AI 内嵌字幕..."
- "屏幕上显示字幕..."
- "添加字幕文字..."

✅ 改写：
- "视频全程不要字幕、不要屏幕文字"（必须保留）
- 字幕用 drawtext 后压（见下）
```

### 5.2 drawtext 后压标准模板

```bash
ffmpeg -i seg.mp4 -vf \
  "drawtext=text='产品名':fontfile=/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttf:fontsize=52:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=10:x=(w-tw)/2:y=h-th-50:enable='between(t,27,28.5)'" \
  -c:a copy seg_with_subtitle.mp4
```

**参数速查**：
- `fontsize=52`（商品展示）/ `42`（电商种草）/ `46`（品牌宣传）
- `fontcolor=white` + `boxcolor=black@0.7`（黑底白字）
- `boxborderw=10`（边框厚度）
- `enable='between(t,T1,T2)'`（时间窗，秒）

### 5.3 视觉标题例外

**允许 AI 内嵌**（不通过 drawtext）：
- 草书大字标题（如"沙僧的行李"）
- hero shot 期间的品牌名（CHARLOTTE RUBY 等）
- 游戏 logo（与游戏画面融合）

**prompt 关键词**：
```text
✅ 允许：
- "金色草书大字'X'占满画面中央"
- "MANDATORY CENTER FRAME 'X' gold calligraphy"
```

---

## 六、4 类广告完整 BGM/SFX 模板示例

### 6.1 商品展示 · 美妆 hero shot · 30s

**时段 BGM/SFX 配置**：
```
0-3s hook: 鼓点 + 电子起（"energetic electronic beat drop"）
3-15s 卖点: 轻快 BGM + 产品开盖音（t=4s）
15-25s 使用: 轻快 BGM 持续 + 涂抹音（t=18s）
25-30s CTA: 收尾渐弱 + 品牌 jingle + "叮"提示音
```

**完整 prompt 模板**：
```text
环境与开场：[产品描述] + [场景] + [光线] + [色调]。

[时长] [景别]，[机位]。[动作描述]。

视频全程不要字幕、不要屏幕文字；必须保留协调统一的全局BGM和必要环境音，
禁止静音段。Use consistent [风格] background music throughout this
entire N-second segment.
```

### 6.2 电商种草 · 美妆日常 vlog · 30s

**时段 BGM/SFX 配置**：
```
0-3s hook: 轻钢琴起（"soft piano opening, problem presentation"）
3-10s 场景1: 轻快 BGM + 鸟鸣（t=5s）
10-20s 场景2: 轻快 BGM + 涂抹音（t=15s）
20-30s CTA: 推荐 BGM + "叮"提示音 + 收尾
```

### 6.3 游戏买量 · SLG 战争 hook · 30s

**时段 BGM/SFX 配置**：
```
0-3s hook: 史诗鼓点 + 战场喊杀声
3-15s 玩法: 史诗 BGM 持续 + 战斗打击音（t=8s, t=12s）
15-25s 高潮: 史诗 BGM 高潮 + 技能激活音（t=18s）
25-30s CTA: 收尾 + 游戏 logo + "叮"礼包音
```

### 6.4 品牌宣传 · 国货茶饮 · 30s

**时段 BGM/SFX 配置**：
```
0-3s hook: 古风弦乐 + 飞鸟掠过
3-20s 叙事: 古风 BGM 持续 + 茶汤注入音（t=10s）
20-25s 升华: 情绪升华 BGM
25-30s logo: 收尾 + 朱红印章 + 品牌 jingle
```

---

## 七、自检清单

- [ ] BGM 三段节奏完整（hook/主体/收尾）
- [ ] SFX 关键时刻表已声明（产品开盖/涂抹/品牌 logo 等）
- [ ] 配音冲突已规避（多角色加 narrator voice）
- [ ] 字幕永远后处理（无 AI 内嵌关键词）
- [ ] 视觉标题例外正确（草书/hero shot 可内嵌）
- [ ] drawtext 时间窗正确（`between(t,T1,T2)`）
- [ ] 字体已指定（NotoSansCJK-Bold）
- [ ] 字号匹配类型（商品展示 52/电商种草 42/品牌宣传 46）