# memory-system

本工作区长期记忆底座的物理形态。verified 2026-10-04。

## 自动装载层不在版本控制里

`.gitignore:101` 是 `/.claude/`，整目录被忽略：

```bash
git ls-files .claude/                          # 空
git check-ignore -v .claude/rules/04-MEMORY.md # .gitignore:101:/.claude/
git cat-file -e HEAD:.claude/rules/04-MEMORY.md
# fatal: path '.claude/rules/04-MEMORY.md' exists on disk, but not in 'HEAD'
```

因此 **SOUL / USER / MEMORY 三个自动装载文件、以及全部 `.claude/skills/`，都是本机私有的**：不进 git 历史、clone 不出来、重装即丢。它们仍然是每次会话必加载的（harness 读盘不看 git），但它们**不是**唯一真相。

仓库根的 `memory/` 不在这条 ignore 里（`git check-ignore memory/topics/engineering.md` → not ignored），是唯一受版本控制的记忆层。

## 由此产生的写记忆规则

- 要活过重装 / 要被同事看到的记忆 -> 写 `memory/`（已跟踪）或 `specs/`、`CLAUDE.md`（已跟踪）。
- `.claude/rules/*` 只是本机工作副本。**不要**把"唯一一份"的事实留在那里。
- 反向也别做：别因为想让记忆进 git 就去动 `.gitignore:101`。本仓库 Apache-2.0 开源，那条 ignore 同时在替 SOUL 的 "Keep private context private" 挡个人记忆进公开仓库。相关取舍见 `memory/gardener/flags-for-molt.md`。

## 相关

- 24h 捕获层 / 72h 整编层 / 14d 深反层的分工：见 skill `hamuna-memory-gardener/SKILL.md` 的"边界"节。
- 首跑记录：`memory/gardener/2026-10-04.md`。
