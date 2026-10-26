---
name: easel-publish-checklist
description: 发布前快速查漏：标题、正文、封面、标签、格式、链接齐不齐。只查"有没有漏东西"，不做深度合规审查。用户说"能发了吗""检查一下""发之前看一眼"时用。
---

# 发布前查漏

**只做一件事：有没有漏。** 深度合规审查归 `easel-publish`，人设归 `easel-publish-persona-check`，这里不重复。

## 输入

- 产物目录 `outputs/<主题>/`（有 meta 就读 meta）
- 单篇文案文本
- 混合：文案 + 图片路径

平台：读画像 `platforms`，或用户指定。定不了就做通用检查。

## 通用清单

**必检（fail 即阻塞）**

| # | 查什么 |
|---|---|
| 1 | 标题存在，长度在 `.claude/references/platform-specs.md` 的限制内 |
| 2 | 正文有实质内容，不是空壳或占位符 |
| 3 | 图文帖有封面图；视频有封面帧 |
| 4 | 结构完整，图片引用有效，链接格式正确 |

**建议（warn 不阻塞）**

| # | 查什么 |
|---|---|
| 5 | 标签存在，数量在合理区间 |
| 6 | 有 CTA（点赞/收藏/关注/评论引导） |
| 7 | URL 格式正确 |
| 8 | 图片规格符合平台（竖版/横版/比例） |
| 9 | 字数在推荐范围 |
| 10 | emoji 使用得当（视平台） |

## 平台追加

读 `.claude/references/platform-specs.md` 拿具体数值，常见追加项：

- **小红书** — 卡片 3–9 张、每张 ≤80 字、有 caption、封面 3:4
- **抖音 / 视频号** — 仅视频、有字幕文案、有封面标题
- **微博** — ≤2000 字、话题 `#话题#` 双井号格式
- **B站** — 简介 ≤2000 字、封面 16:9
- **公众号** — 有摘要/导语、封面 2.35:1、媒体必需

## 字数怎么核

不靠肉眼：

```bash
node scripts/wordcount.mjs check --target 20 --tolerance 0 -f outputs/<主题>/title.txt
```

`pass: false` 就是超了或不够，`adjust` 告诉你差几个字。

## 输出（JSON）

```json
{
  "status": "ready | not_ready",
  "score": "7/10",
  "platform": "xhs | generic | ...",
  "checklist": [
    { "item": "标题", "status": "pass | fail | warn", "detail": "19/20 字" }
  ],
  "blocking_issues": [],
  "warnings": [],
  "summary": "可以发 / 还差什么"
}
```

有任何 `fail` → `not_ready`。

对话里只说三行：能不能发、卡在哪、补什么。
