# World Setting（Round 1.5 · AdCraft 上游真相源）

> **目的**：定义广告世界的**硬约束**（跨段连续性 · 不允许后期漂移）。所有后续阶段必须读此 JSON 才能锁定人物/场景/道具一致性。
>
> **来源**：AdCraft `video_agent_world_setting` capability · `agent_world_setting.json`

---

## 一、触发条件

- **必跑**：所有走 11 Agent 编排的任务（§2.7 默认路径）
- **跳过**：走 §2 快速路径的纯产品/特写任务

---

## 二、5 要素（必填）

| 要素 | 说明 | 示例 |
|---|---|---|
| **premise** | 一句话世界观前提 | 抖音短剧带货 / 都市写字楼加班 / 古风仙侠试炼 |
| **era** | 时间锚点 | 现代都市 2024 / 民国 1930s / 架空古代 |
| **place** | 空间锚点 | 北京 CBD 写字楼 / 邋遢出租屋卧室 / 赛博朋克霓虹街 |
| **spatial_logic** | 空间一致性约束 | 卧室锁死禁止漂移到客厅厨房卫生间 |
| **world_rules** | 跨段规则数组（≥2 条） | ["化妆前后反差需镜子", "≥3 角色入镜需每人锚点"] |

---

## 三、continuity_for_assets（3 子字段必填）

```json
{
  "continuity_for_assets": {
    "characters_required_to_appear": ["<角色1>", "<角色2>"],
    "props_required_to_recur": ["<道具1：眼影盘 hero>", "<道具2：宵夜盒>"],
    "forbidden_elements": ["<其他品牌化妆品>", "<字幕文字出现在画面中>"]
  }
}
```

---

## 四、JSON 输出 Schema

完整 schema 见 `references/8-agent-orchestration.md` §3 Agent 1.5 prompt 模板。

---

## 五、失败模式

- **#8B-1**：Round 2b 三件套完全并行 → Character 漏读 world_setting（女主名/配角入镜冲突）
- **修复**：Character/Scene/Prop 都必须显式 read agent_world_setting.json，不能只读 director+script

---

## 六、与 Director Agent 的边界

| 维度 | Director (Round 1) | World Setting (Round 1.5) |
|---|---|---|
| 输出 | 整体方案 + 产品定位 | 世界观硬约束 |
| 性质 | 创意方向 | 连续性规则 |
| 可修改 | 用户可推翻 | 上游真相源 · 修改需重启 Round 2 |
| 谁读 | Round 1.5 + Round 2a | Round 2b + Round 3 + Round 3.5 + Round 4 |