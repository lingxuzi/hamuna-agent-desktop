# Video Direction（Round 3.5 · Storyboard → Video 桥梁）

> **目的**：把 storyboard 的静态分镜转成 motion direction JSON（每段 opening_state / primary_action / closing_state / subject_action / camera_motion / framing + continuity_handoffs 段间锚点）。
>
> **来源**：AdCraft `video_agent_video_direction` capability · `agent_video_direction.json`

---

## 一、角色定位

**Storyboard 与 Video 之间的桥梁**。不直接调 MCP，仅输出 motion direction JSON，由 Video Generation Agent (Round 4) 拼装成完整 prompt。

---

## 二、必填字段（每段 6 字段）

| 字段 | 说明 | 示例 |
|---|---|---|
| **opening_state** | 段首定格状态（承接上段 closing_state） | 林小溪疲惫坐姿 + 凌乱床铺 |
| **primary_action** | 段内核心动作链 | 狂翻抽屉→啪地甩出眼影盘→手部捏盘展示 |
| **closing_state** | 段末定格状态（可作为下段 first_frame） | 眼影盘 hero shot 居中特写 |
| **subject_action** | 角色动作描述 | 林小溪手部动作 / 江屿推门动作 / 小胖路过 |
| **camera_motion** | 机位运动 | 固定顶视→轻微下摇跟随→推近 hero |
| **framing** | 景别序列 | 中景→中近景→特写 |
| **transition_intent** | 段尾承接意图 | 眼影盘 hero shot 为段 2 keyframe 锚定 |

---

## 三、continuity_handoffs（段间锚点）

```json
{
  "continuity_handoffs": [
    {
      "from_segment": 1,
      "to_segment": 2,
      "anchor": "<跨段锚点：眼影盘纹理/林小溪服装反差/江屿宵夜盒>"
    }
  ]
}
```

**3 选 1 锁定**：服装锚点 / 道具锚点 / 光线锚点（详 §3.3.1 衔接连贯铁律）。

---

## 四、约束（不可违反）

1. **所有 directions[].duration_seconds 必须 = 12**（§2.1 铁律）
2. **directions 长度 = storyboard.segments 长度**（严格 1:1）
3. **continuity_handoffs 长度 = directions 长度 - 1**（每个段间过渡一个锚点）
4. **不写 prompt 全文**（留给 Agent 8 拼装）
5. **不编造 duration / aspect_ratio / resolution / model**（由 video agent 决定）

---

## 五、JSON 输出 Schema

完整 schema 见 `references/8-agent-orchestration.md` §3 Agent 7 prompt 模板。

---

## 六、与 Storyboard 的边界

| 维度 | Storyboard (Round 3) | Video Direction (Round 3.5) |
|---|---|---|
| 输出 | 静态分镜（镜号/场景） | motion direction（动态+连续性） |
| 关键字段 | shot / scene_id / closing_state_for_next_segment | opening_state / primary_action / closing_state / subject_action / camera_motion / framing / transition_intent |
| 谁用 | Video Direction 读 → Video Generation 拼装 prompt | Video Generation Agent 直接消费 |

---

## 七、与 11 Agent 编排的集成位置

```
Round 3 (Storyboard + BGM 并行)
  ↓
Round 3.5 (Video Direction · 串行 · 读 storyboard)
  ↓
Round 4 (Video Generation · 拼装 prompt 调 MCP)
```

**严禁 Round 3 与 Round 4 之间跳过 Round 3.5**（会导致 prompt 缺失 subject_action / camera_motion 字段）。