# qisi 段拼接决策 SOP（独立于 §3-§6 段拼接表）

> **来源**：qisi-video-remix SKILL.md §"分段与可复制提示词"（行 56-66）+ delivery-guide.md §6（行 31-48）。本 skill §8 入口复用。
> **触发时机**：Round 0.5 qisi Remixer 输出 `timeline_breakdown` 后，Round 1 Director 编排分镜前，Round 3 Storyboard 组段时**必查**。
> **位置说明**：本文件**不**替代 §3.3/§4.3/§5.4/§6.3 段拼接表（那是按 4 类广告规定的固定 N 段拼接）；本文件给的是**切段决策原则**（在已定的 N 段拼接下，判断段间是否需要二次拆段，或合并相邻段）。

---

## 1. 5 条切段原则（qisi 原文 + 本 skill 落地）

### 原则 1：重大换景即切段
- **触发**：下一镜头跳到不同空间（如 office → street → apartment）
- **本 skill 落地**：由 scene_id 切换判定；§2.7 Round 2b Scene Designer 已锁定 scene_id 列表，Storyboard 跨 scene_id 时必拆段
- **本 skill 缺省例外**：同一场景内子空间切换（如公寓内「客厅→玄关」）**不**切段，归属同一段（leshi_remix 段 3-5 都在 space_C 内）

### 原则 2：换时间层即切段
- **触发**：下一镜头跳到不同时间段（如「白天 → 夜晚」「现代 → 回忆」）
- **本 skill 落地**：由 video_direction.directions[].scene_id 的 lighting 字段锁定（白天 vs 夜晚不混用），lighting 字段变化必拆段

### 原则 3：同人物换造型即切段
- **触发**：下一镜头同一人物换衣 / 换妆 / 换年龄（adcraft-assets §1 造型拆分已规范）
- **本 skill 落地**：character_wardrobe 字段变化必拆段（leshi_remix 段 2 「林默/加班装」→「林默/通勤装」虽属同场景但同段，因换装仅叠加雨衣外层不冲突）

### 原则 4：动作/运镜/互动复杂度即切段
- **触发**：下一镜头加入会让独立动作、运镜或人物互动过于复杂（如对话+复杂运镜+多人同时反应）
- **本 skill 落地**：storyboard.segments[].camera 字段描述运镜复杂度，≥3 个独立运镜指令的段必须拆段
- **典型例外**：同一空间内的正反打**不**自动拆段（leshi_remix 段 4 反打「男友推门→女友侧身」属同段）

### 原则 5：超 12s 上限即切段
- **触发**：累计时长 ≥ 12s（MCP agnes-video-2.5-flash 实测上限）
- **本 skill 落地**：12s 铁律是硬约束，所有段 video_generate_call.params.seconds = 12（§9.1）

---

## 2. 切分原因独立字段（弥补 qisi §3 缺口）

qisi 源要求显式记录「切分原因」（delivery-guide.md §6 表头），本 skill **新增** 字段：

| 字段 | 位置 | 取值 |
|---|---|---|
| `storyboard.segments[].split_reason` | 每段 | 字符串（5 类原则之一）+ 具体说明 |
| `storyboard.continuity_handoffs[].split_reason` | 段间锚点 | 字符串（5 类原则之一） |

**5 类原因取值枚举**：`scene_change` / `time_layer_shift` / `wardrobe_change` / `action_complexity` / `duration_cap`。

---

## 3. 段拼接表使用顺序

```
Round 0.5 qisi Remixer → timeline_breakdown + narrative_pattern
    ↓
Round 1 Director → 路由决策（§3/§4/§5/§6 + 时长 24s/36s/48s/60s）
    ↓
按 §3.3/§4.3/§5.4/§6.3 段拼接表定 N 段总数（如 60s = 12s × 5）
    ↓
按本 SOP 5 条原则二次拆段（在已定 N 段内判断是否需再拆 / 合并相邻段）
    ↓
Round 3 Storyboard 输出 segments[].split_reason + continuity_handoffs[].split_reason
    ↓
Round 4 Video Generation 按 segments[].duration 严格执行 12s
```

---

## 4. 反例：leshi_remix 实战切段决策（2026-09-19）

| 段 | wardrobe | scene_id | 决策 | split_reason |
|---|---|---|---|---|
| 段 1→段 2 | 加班装→通勤装 | office→street | 拆段（换景+换装叠加）| `scene_change` + `wardrobe_change` |
| 段 2→段 3 | 通勤装（林默仅）+ street | street→apartment | 拆段（换景）| `scene_change` |
| 段 3→段 4 | 家居装→家居装（林默换+苏晓出场）| apartment | **不拆段**（同 scene_id 子空间）| — |
| 段 4→段 5 | 家居装（不变）| apartment（沙发子空间）| **不拆段**（同 scene_id + 角色不变）| — |

**结论**：60s = 12s × 5，5 段无二次拆段，**全段 split_reason 字段已记录在 agent_storyboard.json.segments[].shot 字段注释里**。