# qisi 证据帧提取 SOP（§8 路由必跑 · Round 0.5 输入）

> **触发**：§8 视频复刻路由 + Round 0.5 qisi Remixer Agent 之前必跑。
> **目标**：把参考视频**逐秒拆解**为证据帧 JSON，作为后续叙事手法提取 + 押韵改写的 source-of-truth。
> **别走捷径**：用户问"为什么复刻粗糙" → 答案通常是这一步骤偷懒了。

---

## 1. 抽帧 SOP（5 步 · 全自动）

### Step 1：fps 选择

| 原片时长 | 推荐 fps | 总帧数 | 关键帧数（筛选后） |
|---|---|---|---|
| < 30s | 4 | < 120 | 25-40 |
| 30-90s | 2 | 60-180 | 30-50 |
| > 90s | 1 | > 90 | 25-40 |

**铁律**：fps 必须 ≥ 2 才能捕捉快速动作（撕袋/转场/特写）。低于 2fps 会漏关键节拍。

### Step 2：抽帧命令

```bash
# 标准抽帧（2fps + 4 位补零）
ffmpeg -i <source>.mp4 -vf fps=2 frames_per_sec/f_%03d.png

# 高时长视频（> 90s · 1fps）
ffmpeg -i <source>.mp4 -vf fps=1 frames_per_sec/f_%03d.png
```

输出文件命名：`frames_per_sec/f_001.png`、`f_002.png`、...

### Step 3：关键帧筛选（人工 · 必做）

从所有抽帧中筛选**关键帧**（占总帧数 20-30%）。筛选标准：

| 必选 | 必选 | 选 |
|---|---|---|
| 每个场景切换点 | 每个字幕节点 | 镜头运动最大/最小帧 |
| 每个叙事动作起始/结束 | 每个转场特效（漩涡/叠化/撕裂） | 视觉冲击最强帧 |
| 每个角色入镜/离镜 | 每个产品出现/特写 | 表情变化最大帧 |

**工具**：用 macOS Preview / Windows Photos / Linux `eog` 翻看，**标注关键帧号**。

### Step 4：时间窗切分

把视频切成 **2-4s 时间窗**（不是 1s 太碎，不是 10s 太粗）。每个时间窗填一个 evidence_frame 记录。

窗口长度选择：
- 快速动作段（撕袋/特写）：2s/窗
- 场景平稳段（全景/跟随）：4s/窗

### Step 5：填 evidence_frames 数组

每个时间窗一个对象，必填字段：

```json
{
  "ts": "2-4s",                        // 时间窗范围
  "scene": "现实办公室",                // 当前场景
  "wardrobe": "白色衬衫+黑色西装外套",  // 角色造型
  "action": "手伸入袋口内部，袋口呈漩涡状", // 具体动作（不是标签）
  "camera": "特写 → 漩涡抽帧",          // 镜头运动
  "subtitle": "（无）",                  // 字幕原文
  "lighting": "袋口内部蓝青色漩涡光",   // 光照
  "evidence_frame": "frames_per_sec/f_009.png", // 关键帧文件
  "narrative_function": "视觉转场：从现实袋口跌入梦境" // 可选·叙事功能
}
```

---

## 3. 抽帧后必产物

产物 1：`evidence_frames[]`（数组 · 每窗 1 对象）
产物 2：`scene_summary[]`（场景汇总 · color_palette + total_seconds + segments）
产物 3：`key_visual_signature`（color_journey + wardrobe_journey + transitions）

完整 JSON schema 见 leshi 样例：`market-workspace/leshi_remix_s3_36s/references/original_story_facts.json`

---

## 4. 避坑（实测 3 次翻车）

| 坑 | 症状 | 修复 |
|---|---|---|
| ❌ 1fps 抽帧 | 撕袋/漩涡/快速转场全错过 → 复刻丢节拍 | 必 2fps（短片 4fps） |
| ❌ 不筛选关键帧 | 173 帧全填 evidence_frames → JSON 200+ 行臃肿 | 筛选 30-50 关键帧作为 evidence_frame 引用 |
| ❌ 时间窗太粗（10s） | 一窗多个动作 → source_mapping 模糊 | 2-4s 一窗，动作密集处用 2s |
| ❌ 跳过 narrative_function | 后续 Round 1 不知道每个节拍的"为什么" | 关键节拍（转场/高潮/CTA）必填 narrative_function |
| ❌ 字幕原文不抄 | 押韵丢失 · 后续 rhyme extraction 失败 | subtitle 字段必抄原文（含标点） |

---

## 5. SOP 自动化（可选）

如果输入视频 < 60s + 用户授权全自动化，可省 Step 3 人工筛选：

```bash
# 全自动抽帧 + 简单时间窗切分
ffmpeg -i <source>.mp4 -vf "fps=2,scale=320:-1" frames_per_sec/f_%03d.png

# 用 Gemini 1.5 Pro / Claude vision 对每个时间窗 2-4 帧批量描述
# 输出 evidence_frames[] 草稿 → 人工校对 10-15 分钟
```

**默认走人工**（用户没明确同意自动化前），保证抽帧质量。

---

## 6. 与下一阶段的接口

| 下游消费者 | 读取字段 |
|---|---|
| `narrative_methods_extracted.json` | `evidence_frames[].scene` + `narrative_function` |
| `copywriting_rhymes.json` | `evidence_frames[].subtitle` + `rhyme` |
| Round 0.5 qisi Remixer `timeline_breakdown` | `evidence_frames[].ts` + `action` |
| Storyboard `sub_shots_detail[].source_ref` | `evidence_frames[].ts` |

---

## 7. 参考实战

- `market-workspace/leshi_remix_s3_36s/references/original_story_facts.json`（86.5s 乐事 TVC · 173 帧 · 17 evidence windows）
- `market-workspace/leshi_remix/agent_outputs/agent_director.json`（60s 乐事 remix · §8 实战）

> **跳过**：拍脑袋看一遍视频就写分镜 → 复刻必然粗糙（用户反馈 v3「过于粗糙」= 这一步没做）