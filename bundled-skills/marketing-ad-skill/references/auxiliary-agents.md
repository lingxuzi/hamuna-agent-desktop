# AdCraft 辅助 Agent（不在 8/11-Agent 编排内）

> 主流程编排见 `references/8-agent-orchestration.md`。本章是 Canvas 节点级辅助工具，按需调用，不参与 Round 编排。

## 1. role_prompt_authoring（角色 Prompt 包装器 · 防身份漂移）

**AdCraft Capability**: `video_agent_role_prompt_authoring`
**用途**: 把 `character_turnaround` / `scene_board` 转成最终 prompt 时，**保护 protected 字段不被覆盖**。

### 核心规则（铁律 · 见 `adcraft-boundaries.md` §3）

character_turnaround 的 protected 字段必须**精确传递**，不意译/不总结/不翻译/不丰富化：
- `identity`（name, age, gender, ethnicity）
- `face and hair`
- `silhouette and proportions`
- `wardrobe`
- `accessories`
- `rendering mode`
- `gender presentation`

editable_prompt 只能描述 requested turnaround presentation（站位/构图/灯光），不能替换 protected fields。

### 失败模式 #8B-1 实证

eval-5 第一次跑 Round 2 三件套完全并行 → Character 抄了 Scene 的 "禁止男性入镜" 锁死指令（不当覆盖）→ 重跑读 director + script 才修复。

### 使用方式

```python
# 在 character/scene agent 内部，把 protected 字段"原样"嵌入 prompt
prompt = f"""
[protected · 不能改]
{character.identity_master}

[editable · 可写]
composition: front-view portrait anchor sheet
lighting: clean studio frontal lighting
"""
# agent_scene.json 类似处理 scene.identity.location / lighting / tone
```

---

## 2. quick_media（单节点快速媒体生成 · 绕开 8-Agent 全链路）

**AdCraft Capability**: `video_agent_quick_media`（也覆盖 `quick_media` Agent Canvas Node）
**用途**: 用户在 Canvas 上点单个文本节点，要求快速修订（如改一句字幕、生成一张 hero shot）→ 不用重跑整个 8-Agent 编排。

### 触发场景

- 用户说"帮我把字幕'完美日记动物眼影盘'改成'完美日记眼影盘'"
- 用户说"给我快速出一张眼影盘 hero shot 测试"
- 用户说"换一句 CTA 试试"

### 与主流程区别

| | 主流程（8/11-Agent） | Quick Media |
|---|---|---|
| 触发 | 全新 30s 广告创作 | 单节点文本 / 单图 / 单视频修订 |
| 输出 | 7-9 个 JSON + 成片 | 直接文本 / 单图 / 单视频 |
| 验证 | grading 12 断言 | 业务一句话确认 |
| MCP 调用 | scripts/run_8agent_mcp.py 全套 | 单次 `mcp__multimedia-creator__*` 调用 |

### Prompt 编写要点

```python
prompt = """
[quick_media · 视频 / 图像 / 音频 · 选 1]
[objective · 用户原话]
[media_kind · image / video / audio]
[references · approved refs 列表]
[constraints · 由 Python 端决定，不在 prompt 里]

只输出一个 bounded prompt 计划，不选 provider / model / 时长 / 比例 / 分辨率
"""
```

### 验证清单

- idea 具体可拍 / 可听
- 保留 approved references 的 identity 和 brand constraints
- 不选 provider / model / 时长
- 不复制 sibling prompt

---

## 3. 何时不调用辅助 Agent

- 全新 30s 广告 → 走 `references/8-agent-orchestration.md` 主流程
- 多角色多场景 → 必走主流程（不能 quick_media 一锅端）
- 用户要求"重跑某一段" → 走 `references/8-agent-orchestration.md` §3.5 Round 局部重跑（不是 quick_media）
- 只想预览某个风格 → 看 `references/style-library.md` + `AdCraft/apps/api/agent/video-skills/<style>/` 源 SKILL.md

---

## 4. 辅助 Agent vs 主流程选型决策树

```
用户输入
  ├─ 新需求 / 新产品 / 新视频？
  │   └─ 是 → 主流程（11-Agent 编排）
  └─ 已有产物？
      ├─ 改单句字幕 / 改单图 / 改单视频？
      │   └─ 是 → quick_media
      └─ 改某段分镜 / 改某角色 / 改某场景？
          └─ 是 → 主流程局部重跑（Round 3.5 / 4 单步）
```
