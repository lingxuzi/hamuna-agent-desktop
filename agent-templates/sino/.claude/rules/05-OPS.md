# OPS.md — 台账纪律

## 唯一写者

`ops/state.json` **只有一个写者是合法的**：App 后端（Rust 的 ops store）。它管 id、管文件锁、管补丁合并。

我能到达它的唯一路径是 `hamuna ops` CLI，它转发给同一个写者。

## 绝对不做

- **不直接读写 `ops/state.json`。** 不用 `Read`、不用 `cat`、不用 `jq`、不用 `Edit`、不用 `sed`。要看台账就 `hamuna ops list --json`。
- **不用脚本改它。** 「先读出来、改一个字段、写回去」正是会把并发写吞掉的形状。
- **不自己造 id。** `ops add` 由后端生成并打印 id，后续 `update` / `remove` 用它。
- **不在 `ops/assets/` 之外放封面和配图**。素材的相对路径是相对工作区根的，放别处面板就找不到。

## 补丁语义

`update` 只覆盖你传的字段，没传的保持原样。

```bash
hamuna ops update asset --id asset-1a2b3c4d --progress 80        # 只动 progress
hamuna ops update review --id review-1a2b3c4d --views 12000     # 其余五个指标保留
```

嵌套对象（复盘的 `metrics`）也是逐键合并。**不要为了改一个数字先把整条读出来再写回去**。

要清空一个字段才显式传空值——不要为了"保险"每次都回填全部字段。

## 状态机

| 实体 | 允许的状态 | 迁移 |
|---|---|---|
| 选题 | `idea` → `planned` → `produced` | `dropped` 可从任一状态进 |
| 素材 | `draft` → `ready` → （`published` / `unverified`） | 见下 |
| 规则 | `proposed` → `active` | 提出来先进 `proposed`，攒到证据再 `active` |

**不要跳状态。** 素材别从 `draft` 直接跳 `published`——那次 `ready` 是「内容本身做完了、可以发了」的分界。

### `unverified` ≠ `published`

| 值 | 什么时候写 |
|---|---|
| `unverified` | 已经对平台提交过，但**没有平台侧证据** |
| `published` | 回到创作者后台的作品列表里，**真的找到这一条**（同时回填 `--platform-work-id`） |

**没有回读证据就把素材标成 `published`，等于对用户撒谎**——面板上「已发布」意味着它在线，用户会据此停止跟进。

`unverified` 也**不许回退成 `ready` 重发**。提交过的东西可能已经在平台上了，退回去就是双发。要重试，先回读确认平台上没有那一条。

## 写之前先读

改一条记录前先 `hamuna ops list`（或 `list <kind>`）确认它现在的状态。凭记忆改会覆盖掉用户刚在面板上改的东西。

## 数字口径

| 字段 | 口径 |
|---|---|
| `hotness` | 参考内容的**播放量**。没有可比参考就**不传**，别填 0——0 会被当成"播放量为零"。 |
| `progress` | 0–100 的整数。每次改素材更新一次，不跳着涨。 |
| `completionRate` | 0–1 的小数（41% 写 `0.41`，不是 `41`）。平台不给就**不传**。 |
| `confidence` | 0–1。凭一条样本写的规则给 0.3 以下，别硬写 0.9。 |
| `evidenceBars.pct` | 0–100 的条长，不是原始数值。原始值放 `val`。 |

## 平台 id

只能是注册表里的：`xiaohongshu` / `douyin` / `kuaishou` / `weixin-channels` / `bilibili` / `zhihu` / `wechat-mp`。写成中文名会被拒。
