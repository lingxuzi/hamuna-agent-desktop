---
name: easel-produce
description: 制作层。把方案做成真实产物：文案、图片、视频、音频、封面。用户说"写出来""做张图""剪个视频""配音"时用。
---

# 制作层

这一层才产生文件。所有产物写进 `outputs/<主题>/`。

## 规矩

- **成品放项目根，中间素材放 `assets/`，试错放 `outputs/_scratch/`**
- 主题名必须具体，禁止 `test` / `tmp` / `xhs` 这类泛名
- **制作层只读画像的制作相关维度**（style / audience / preferences），不读 platforms
- `preferences` 里的红线原样遵守，不商量
- 付费生成（图/视频/音乐/TTS）先报范围和预估，等确认

## 自检（交付前必做）

| 类型 | 查什么 |
|---|---|
| 文本 | 字数、是否跑题、是否符合 `preferences` 红线 |
| 图片 | 非空、尺寸、画幅、文字有没有错字 |
| 视频 | 非空、时长、分辨率、画幅、音轨 |
| 音频 | 非空、时长、有没有爆音或截断 |

零字节、严重残缺、跑题、规格不符 → 判失败，带具体意见返工一次。轻微瑕疵可以诚实交付并说明，不循环返工。

## 输出

产物用工具产物机制回传给用户（图片视频直接显示），不要只说"已保存到 xxx"。

## 具体技能

| 任务 | 技能 |
|---|---|
| 带货转化文案（种草/信息流/活动/详情页/落地页） | `easel-produce-copywriting` |
| 通用社媒内容（钩子+正文+标签+互动，多平台成稿） | `easel-produce-social-content` |
| 润色已有文案、去 AI 味 | `easel-produce-text-polisher` |

图片、视频、TTS、视频合成还没移植成技能，先用现有生成工具（gemini-image / edge-tts 等）。

## 共用参考

- `.claude/references/hook-title-formulas.md` — 钩子与标题公式
- `.claude/references/copy-frameworks.md` — PAS / AIDA / BAB / FAB / 4U / STAR / SLAY
- `.claude/references/zh-ai-markers.md` — 中文去 AI 味（文案类产出必过）
- `.claude/references/platform-specs.md` — 各平台字数/画幅/时间

## 字数

一律跑脚本，不靠肉眼：

```bash
node scripts/wordcount.mjs count -f outputs/<主题>/copy.txt
node scripts/wordcount.mjs check --target 20 --tolerance 0 -f outputs/<主题>/title.txt
```
