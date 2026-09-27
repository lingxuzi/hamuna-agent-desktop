# qisi 叙事手法映射 SOP（§8 路由 · Round 0.5 输入）

> **触发**：qisi-evidence-frame-extraction.md 完成后必跑。
> **目标**：从 evidence_frames 提取**叙事手法**（不是风格标签），并映射到 §3-§6 任一落地。
> **关键区别**：手法 = **机制**（为什么有效），不是 **风格名**（看起来像什么）。

---

## 1. 4 维叙事手法（qisi 核心 · 通用模板）

### 维度 1：空间建构（spacial_construct）

| 手法 | 机制 | 识别特征 |
|---|---|---|
| **多口味宇宙** | 每个 SKU/口味对应一个独立异世界 | 4 场景切换 + 每个场景用特定产品元素 |
| **单一空间多层** | 同一空间在不同维度切换（现实/梦境/回忆） | wardrobe 不变但场景色调/光线剧变 |
| **地理拼贴** | 多城市/多地标快速切换 | 每个镜头一个地标 + 字幕标注地名 |

**apply_to_§3-§6**：维度 1 直接对应 §3 多 SKU 商品展示，§4 单一场景体验，§5 多关卡游戏，§6 跨城市品牌精神。

### 维度 2：节奏签名（pacing_signature）

| 手法 | 机制 | 识别特征 |
|---|---|---|
| **押韵口播** | 七言/五言律诗节奏 + 韵脚 → 强迫跟读 | 字幕 7±2 字 + 偶数位押韵 |
| **3 秒注意力 spike** | 每 3s 一个动作/转场/特写 → 锁定注意力 | 镜头时长普遍 ≤3s |
| **出神停顿** | 关键节拍前 0.5-1s 静默 → 制造预期 | scene 切换前有 freeze frame |

### 维度 3：视角动线（perspective_motion）

| 手法 | 机制 | 识别特征 |
|---|---|---|
| **单人 POV** | 单一角色视角贯穿 | 主角色出现 ≥ 80% 镜头 |
| **交叉视角** | 两人/两视角切换 + 信息差揭晓 | 每个角色各占 ~50% 镜头 + 段 N 揭晓 |
| **骑乘道具** | 主角色骑/坐在物体上 → 空间移动 | 道具作为角色延伸（如骑马/坐扫帚） |

### 维度 4：细节符号化（detail_symbolism）

| 手法 | 机制 | 识别特征 |
|---|---|---|
| **产品即元素** | 产品不是展示品而是叙事元素 | 角色在场景里使用/穿戴/被产品围绕 |
| **动作符号** | 重复动作（撕袋/挥手/V 字）作为情绪符号 | 同动作出现 ≥ 3 次 + 每次触发不同情绪 |
| **道具符号** | 道具在不同场景复用同一隐喻 | 同一道具出现 ≥ 3 场景 |

---

## 2. 提取流程（5 步 · 从 evidence_frames 到手法表）

### Step 1：维度分类

每个 evidence_frame 标 1 个主导维度（spacial / pacing / perspective / detail）：

```python
for frame in evidence_frames:
    if frame['scene'] != prev_frame['scene']:
        dimension = 'spacial_construct'  # 场景切换
    elif frame['subtitle'] is new rhyme:
        dimension = 'pacing_signature'    # 押韵出现
    elif frame['camera'] in ['POV', '主观']:
        dimension = 'perspective_motion'  # 视角切换
    else:
        dimension = 'detail_symbolism'    # 默认
```

### Step 2：聚合维度 → 命名手法

把同维度 evidence_frames 聚合成一个手法，命名规则：

```
{维度}.{核心机制}
例：spacial.多口味宇宙
    pacing.押韵七言律诗
    perspective.交叉视角
    detail.产品即元素
```

### Step 3：填 narrative_methods 数组

```json
{
  "method_id": 1,
  "name": "多口味宇宙",
  "dimension": "spacial_construct",
  "original_role": "原片用 4 种口味对应 4 个异世界",
  "evidence_frames": ["4-8s", "26-30s", "50-54s"],
  "key_visual_signatures": ["梦境物体由食材构成", "色彩随口味变化"],
  "apply_to_§3": {
    "feasibility": "✅ 可行",
    "compressed_to_target_duration": "压缩为 2 个梦境",
    "specific_application": "段1 = 青柠宇宙；段2 = 烧烤宫殿"
  }
}
```

### Step 4：apply_to_§3-§6 落地映射

每个手法必须有一个 `apply_to_§X` 落地（不能空）：

| 原片手法 | §3 商品展示 | §4 电商种草 | §5 游戏买量 | §6 品牌宣传 |
|---|---|---|---|---|
| 多口味宇宙 | ✅ 多 SKU 展示 | 部分（场景少） | ✅ 多关卡 | ❌ |
| 押韵口播 | ✅ 短押韵 CTA | ✅ 体验押韵 | ✅ 战斗押韵 | ✅ 精神押韵 |
| 三段闭环 | ✅ hook+CTA | ✅ 种草+分享 | ✅ 开场+BOSS+通关 | ✅ 问题+共鸣+升华 |
| 产品即元素 | ✅ SKU 作为道具 | 部分 | ✅ 武器/装备 | 部分 |

### Step 5：rhythmic_signature 总结

总节奏签名（跨维度）：

```json
{
  "scene_change_rate": "原片 86.5s 内 6 个场景切换",
  "camera_motion_density": "原片每个场景 2-3 个镜头",
  "subtitle_density": "原片 86.5s 有 4 句押韵"
}
```

---

## 3. 输出 schema

完整文件结构：

```json
{
  "project_id": "...",
  "narrative_methods": [
    {"method_id": 1, "name": "...", "dimension": "...", ...},
    {"method_id": 2, ...},
    {"method_id": 3, ...},
    {"method_id": 4, ...}
  ],
  "rhythmic_signature": {...},
  "applied_to_storyboard": {
    "key_beats_retained": [...],
    "key_beats_compressed_out": [...]
  },
  "methodology_audit": {
    "applied_methods_count": 4,
    "coverage": "100%"
  }
}
```

---

## 4. 避坑（实测）

| 坑 | 症状 | 修复 |
|---|---|---|
| ❌ 标签化（"情绪价值"） | `narrative_pattern = "反转 + 情绪价值"` | 必写机制：什么动作 → 触发什么情绪 |
| ❌ evidence_frames 引用错 | 引用了不存在的时间窗 | 必与 original_story_facts.json 对齐 |
| ❌ apply_to_§X 为空 | Round 1 Director Agent 不知道怎么落地 | 每个手法必须 3 字段：feasibility/compressed/application |
| ❌ 维度单一（只用 spacial） | 复刻只有场景切换没有押韵/视角/细节 | 强制 4 维各至少 1 个手法 |
| ❌ 100% 复刻不压缩 | 36s 装下 86.5s 所有节拍 → 信息过载 | 必填 key_beats_retained（核心保留）+ key_beats_compressed_out（删除） |

---

## 5. 与下游接口

| 下游消费者 | 读取字段 |
|---|---|
| copywriting_rhymes.json | `narrative_methods[method_id=2押韵].evidence_subtitles` |
| Storyboard `narrative_arc` | `applied_to_storyboard.key_beats_retained` |
| Round 0.5 `borrowed_methods[]` | `narrative_methods[].name` |
| Round 0.5 `comparison_table[]` | `narrative_methods[].apply_to_§3.specific_application` |

---

## 6. 参考实战

- `market-workspace/leshi_remix_s3_36s/references/narrative_methods_extracted.json`（4 手法 100% 应用 · v4 13/13 帧验证）

> **跳过维度 4（detail_symbolism）**：复刻看起来"产品是贴片"而不是"叙事元素"。用户反馈 v3「产品像贴上去的」= 维度 4 没应用。