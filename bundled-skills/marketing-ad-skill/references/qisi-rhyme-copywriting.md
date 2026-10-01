# qisi 押韵改写 SOP（§8 路由 · Round 0.5 输入）

> **触发**：narrative_methods_extracted.json 完成后必跑。
> **目标**：从 evidence_frames 提取原片押韵 → 改写为 §3-§6 落地短押韵。
> **核心铁律**：保留 **韵脚** + **古诗意境** + **强迫跟读节奏**，删除**冗余**和**非通用场景词**。

---

## 1. 押韵识别（5 特征 · 来自 evidence_frames.subtitle）

| 特征 | 阈值 |
|---|---|
| **字数** | 7±2 字（短句）/ 7×2 字（律诗）/ 7×3 字（铺排） |
| **韵脚位置** | 第 2/4/6 字押韵 |
| **意境词** | 古诗词汇（踏/过/迷失/山河/烟火/远方） |
| **段落功能** | 基调 / 转场 / 高潮 / 收束 / slogan |
| **重复结构** | 同节拍 ≥ 2 次出现 = 强迫记忆点 |

---

## 2. 提取原片押韵（从 evidence_frames）

### Step 1：扫描 subtitle 字段

```python
rhyme_candidates = []
for frame in evidence_frames:
    sub = frame.get('subtitle', '')
    if len(sub) >= 6 and len(sub) <= 21:
        rhyme_candidates.append({
            'verse': sub,
            'ts': frame['ts'],
            'scene': frame['scene'],
            'narrative_function': frame.get('narrative_function', ''),
            'rhyme_word': extract_rhyme_word(sub)
        })
```

### Step 2：韵脚提取（regex）

```python
def extract_rhyme_word(verse):
    # 七言律诗：第 7 字或最后一字（如果是变体）
    if len(verse) == 7:
        return verse[6]  # 末字
    elif len(verse) == 14:  # 七言 × 2
        return verse[6]  # 上联末字
    elif len(verse) == 21:  # 七言 × 3
        return verse[6]  # 第一句末字
    return verse[-1]
```

### Step 3：去重 + 段落功能标注

```json
{
  "verse": "踏过青柠浪，迷失夏日场",
  "section": "梦境1·青柠水上乐园",
  "function": "建立梦境基调",
  "rhyme_word": "场"
}
```

---

## 3. 改写 SOP（7 步 · 原片押韵 → 目标押韵）

### Step 1：确定目标时长

| 目标时长 | 推荐押韵数 | 字数限制 |
|---|---|---|
| 36s（3 段） | 4 句（每段 1 句） | 每段 7-9 字 |
| 60s（5 段） | 6 句（每段 1 句 + 1 句 slogan） | 每段 7-9 字 |
| 24s（2 段） | 3 句 | 每段 7-9 字 |
| 12s（1 段） | 1-2 句 | 7-9 字 |

### Step 2：保留韵脚清单

从原片提取的押韵词，**保留 40-60%**（避免完全原创丢风味）：

```
原片韵脚：浪/场/肠/响/香/肉/酱/河/火/绽/笑/方/差
§3 保留：场/香/方（3 个）→ 韵脚覆盖率 43%
```

### Step 3：每段押韵功能映射

| 段 | 功能 | 押韵句要求 |
|---|---|---|
| 段 1（hook） | 情绪入口（孤独/好奇/冲突） | 直接复用原片 + 加场景触发词 |
| 段 2（产品展示） | 梦境/场景切换 | 韵脚与段 1 呼应 |
| 段 3（CTA） | 品牌 slogan | 原片 slogan 原句移植 |

### Step 4：填 remixed_rhymes 数组

```json
{
  "verse": "深夜加班，薯片敲醒灵魂",
  "section": "段1 · 办公孤独 + 漩涡袋口",
  "function": "建立 §3 现实情绪入口",
  "source_borrowing": "原片「踏过青柠浪·迷失夏日场」意境移植",
  "duration_in_storyboard": "段1 漩涡袋口子镜头（3-5s）",
  "rhyme_word": "魂"
}
```

### Step 5：CTA 押韵单独处理

§3/§4 跳过价格（用户指令），CTA 押韵 = **品牌价值 + 行动指令**：

| 章节 | 押韵示例 | 韵脚 |
|---|---|---|
| §3 | 三袋带回家，尝遍夏日场 | 场 |
| §4 | 一次下单，全家都爱 | 爱 |
| §5 | 即刻开战，BOSS 必败 | 败 |
| §6 | 远方不远，一起出发 | 发 |

**铁律**：CTA 押韵韵脚必须与段 1/段 2 押韵韵脚不同（避免重复疲劳）。

### Step 6：rhyme_overlap_table 标注映射

每句复刻押韵必标原片来源：

| remixed_verse | original_source | 类型 |
|---|---|---|
| 咬下青柠浪，跌入夏日场 | **原片「踏过青柠浪·迷失夏日场」字面移植** | 原句移植 |
| 四袋风味，步步皆满肉食香 | **原片「弯酥肠·辣蟹响·步步皆满肉食香」意境合并** | 意境合并 |
| 乐事一口，便是远方 | **原片「乐事薯片·一口便是远方」原句移植** | 原句移植 |
| 深夜加班，薯片敲醒灵魂 | 新写（§3 孤独入口 · 无直接对应原片） | 新写 |

### Step 7：methodology_audit

```json
{
  "applied_methods_count": 1,        // 仅 method_id=2（押韵）
  "original_rhymes_retained_ratio": "3/7 = 43%",
  "compression_ratio": "7 → 4 = 57%",
  "rhyme_word_coverage": "原片韵脚 13 个 → 复刻保留 3 个"
}
```

---

## 4. 避坑（实测）

| 坑 | 症状 | 修复 |
|---|---|---|
| ❌ 完全原创押韵 | 失去原片风味 → 复刻不像 | 必保留 40-60% 原片韵脚 |
| ❌ 字数超 9 字 | 字幕塞不下 → 显示不全 | 七言为主，超长句拆为 2 句 |
| ❌ 韵脚错位 | "浪/场" 不押韵（韵母不同） | 必押同韵母：-ang/-eng/-iang/-ong |
| ❌ CTA 价格硬塞 | 用户指令"跳过价格" → 仍写"¥9.9" | §3 CTA 用"三袋带回家"代替价格 |
| ❌ 字面化梦境词 | "瞳孔倒映梦境" → AI 字面化为眼睛微距 | 用完整梦境场景词代替抽象比喻 |

---

## 5. 与下游接口

| 下游消费者 | 读取字段 |
|---|---|
| Storyboard `sub_shots_detail[].narrative` | `remixed_rhymes[].verse`（按段匹配） |
| Round 0.5 `borrowed_methods[]` | `rhyme_overlap_table[].original_source` |
| Round 1 Script Writer | `remixed_rhymes[].function` |
| drawtext 字幕后处理 | `remixed_rhymes[].verse`（直接复用） |

---

## 6. 字体渲染规范（避免 AI 字面化）

字幕用 drawtext 后处理（不走 AI 生成），但**画面内嵌中文**仍需 prompt 规范：

```
字幕「踏过青柠浪 · 迷失夏日场」叠加（思源宋体 Source Han Serif · 字号 0.08m · 居中 · 描金边 · 半透明黑色底）
```

完整中文渲染规范见 snapshot.md 第 47-58 行。

---

## 7. 参考实战

- `market-workspace/leshi_remix_s3_36s/references/copywriting_rhymes.json`（7 → 4 押韵映射 · v4 13/13 帧验证）
- `market-workspace/leshi_remix/agent_outputs/agent_script.json`（60s 5 段押韵 · 韵脚覆盖率 43%）

> **跳过押韵改写**：复刻没有强迫记忆点 → 用户看完 30s 后想不起产品。押韵是**唯一**能在 3 秒内留下印象的口播形式。