---
name: ops-produce
description: >-
  素材制作。把一条选题变成可以直接投放的成品：正文 / 脚本、封面、配图（视频则加分镜），
  边做边更新台账里的 progress，完成时置 ready。
  当用户说「把这条做出来」「写个稿子」「配张封面」「继续做那条」时用这个 skill。
---

# ops-produce — 素材

## 开工前先读

```bash
hamuna ops list topic --json      # 编辑哪条，它现在什么状态
hamuna ops list asset --json      # 手上有没有半成品，别开重
```

如果是从选题开的：`hamuna ops update topic --id <topicId> --status planned`，表示这条已在做。

## 读风格

文案风格不是每次即兴发挥。按顺序读：

1. `.claude/rules/03-USER.md` 的 `style` 与 `redlines` — 语气、绝对不用的词、格式硬要求
2. `hamuna ops list rule --json` 里 `status: active` 的规则 — 复盘沉淀下来的、被验证过的做法
3. `memory/topics/<系列>.md` — 这个系列之前做过什么、什么有效

台账里还有一条工作区级的风格卡（`style`），它存在时优先按它走。

## 做

按平台形态分：

- **图文**：正文 + 封面 + 配图
- **短视频**：脚本 + 分镜（每镜的 `visual` / `voice` / `seconds`）+ 封面

产出的文件放工作区的 `ops/assets/`，路径写相对工作区根的形态（`ops/assets/cover.png`）。

## 落库

建一条素材，挂到选题上：

```bash
hamuna ops add asset \
  --title "素材标题" \
  --platform douyin \
  --topic-id topic-1a2b3c4d \
  --body-file ops/assets/script.md \
  --cover ops/assets/cover.png \
  --progress 30
```

`--body-file` 读文件内容进 `body`（正文多行、含中文标点时用这个，别塞进命令行）。图片用 `--image` 重复传，分镜用 `--shot` 传 JSON：

```bash
--shot '{"no":1,"visual":"…","voice":"…","seconds":6}'
```

**边做边更新进度**，不要做完才写一次：

```bash
hamuna ops update asset --id asset-1a2b3c4d --progress 60
hamuna ops update asset --id asset-1a2b3c4d --progress 80 --cover ops/assets/cover.png
```

`--progress` 是 0–100 的整数，反映**真实完成度**：正文写完 40，封面定了 70，分镜齐了 90，全部可投 100。不要为了显得快而虚报——用户会按这个数判断还剩多久。

## 完成

成品可以直接投放时：

```bash
hamuna ops update asset --id asset-1a2b3c4d --status ready --progress 100
hamuna ops update topic --id topic-1a2b3c4d --status produced
```

`ready` 是给用户过目的检查点。**不要跳 `ready` 直接 `published`** —— 发布权在用户手上。

## 交接

报给用户：素材 id、标题、正文路径、还剩什么。然后问要不要进 `ops-schedule` 排期。

## 不要做

- 不发布、不登录平台、不调付费生成服务（除非用户明确要求）
- **不要直接编辑 `ops/state.json`**
- 不要在一条素材跨多个平台时复制成多条——先在一条里做完，分发时再说
