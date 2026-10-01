# qisi-video-remix skill 与 §8 视频复刻入口的边界（10 维对比）

> **本文件用途**：承接原 SKILL.md §8.5（精简到 5 维后的完整版）。用户在「用 qisi 原 skill」 vs 「用 §8」决策时**必看**。

| 维度 | qisi-video-remix（独立 skill） | §8 视频复刻入口（与 §7 并列） |
|---|---|---|
| **用途** | 通用视频改编策划（任意题材） | 营销广告改编（落地 §3-§6 任一） |
| **拆片 Agent** | Round 0 qisi 拆片（5 字段 + perspective_shift + comparison_table） | **Round 0.5 qisi Remixer（11 字段结构化输出）** |
| **段拼接** | 15s/30s 由用户选 | **12s 铁律**（与 marketing-ad-skill 一致） |
| **字幕** | 默认无 | **drawtext 后处理**（§9.3） |
| **资产生成** | 提示词文字（不调 MCP） | **必须**走 §2.6 + 9/6/6 字段 |
| **Agent 编排** | 单 LLM 顺序 | **12 Agent 编排**（§2.7 Round 0.5→1→1.5→2a→2b→3→3.5→4） |
| **工具** | 任意视频生成工具 | **multimedia-creator MCP**（§9） |
| **时码切片** | 5-10s 数组（必跑） | 5-10s 数组（必跑·Round 0.5 timeline_breakdown） |
| **perspective_shift** | 必跑 | 必跑（11 字段之一） |
| **comparison_table** | 必跑 | 必跑（11 字段之一） |

## 何时用 qisi 原 skill
- 用户做通用视频改编（非营销广告）
- 想保留 qisi 默认 15s/30s 单段上限
- 不要 12 Agent 编排（单 LLM 顺序即可）

## 何时用 §8
- 用户做营销广告改编
- 需要 §3-§6 落地 + 12s 铁律 + drawtext + 资产 identity + 12 Agent 编排

## §8 配套 references（独立使用清单）
- `references/qisi-section-decision-sop.md`（5 切段原则 + split_reason 字段）
- `references/qisi-creative-plan-example.md`（leshi_remix 实战端到端样例）