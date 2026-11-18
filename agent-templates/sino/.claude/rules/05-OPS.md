# OPS.md — 台账纪律

## 唯一写者

`ops/state.json` **只有一个写者是合法的**：App 后端（Rust 的 ops store）。它管 id、管文件锁、管补丁合并。

我能到达它的唯一路径是 `hamuna ops` CLI，它转发给同一个写者。

## 绝对不做

- **不直接读写 `ops/state.json`。** 不用 `Read`、不用 `cat`、不用 `jq`、不用 `Edit`、不用 `sed`。要看台账就 `hamuna ops list --json`。
- **不用脚本改它。** 「先读出来、改一个字段、写回去」正是会把并发写吞掉的形状。
- **不自己造 id。** `ops add` 由后端生成并打印 id，后续 `update` / `remove` 用它。
- **不在 `ops/assets/` 之外放封面和配图**。素材的相对路径是相对工作区根的，放别处面板就找不到。
- **不改 `ops/inbox/` 里的东西。** 那是人正在往里丢的输入，只许整批搬到 `ops/assets/imported/`，其余一律不碰。

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
| 线索 | `new` → `qualified` → `archived` | `archived` 可回到 `new`（捡回来） |

**不要跳状态。** 素材别从 `draft` 直接跳 `published`——那次 `ready` 是「内容本身做完了、可以发了」的分界。

### `unverified` ≠ `published`

| 值 | 什么时候写 |
|---|---|
| `unverified` | 已经对平台提交过，但**没有平台侧证据** |
| `published` | 回到创作者后台的作品列表里，**真的找到这一条** |

`--platform-work-id` **只在作品列表里真的读得到那个 id 时**才回填。读不到就不传 ——
编一个 id 比空着更坏，它会让下一次回读误以为已经核实过。

**没有回读证据就把素材标成 `published`，等于对用户撒谎**——面板上「已发布」意味着它在线，用户会据此停止跟进。

`unverified` 也**不许回退成 `ready` 重发**。提交过的东西可能已经在平台上了，退回去就是双发。要重试，先回读确认平台上没有那一条。

### 发布纪律

**发布只有一条通道：`hamuna browser publish --platform <id>`。**

它是唯一一个同时经过「用户授权 → 平台域校验 → 平台 id 校验」的动词。用 `browser click`
点发布按钮也能看起来发出去，但那条路走的是自动放行名单：不弹审批、不留记录、授权
形同虚设。**这是封掉的做法，不是还没做的功能。**

授权在设置页按平台给（「允许自动发布」），`hamuna config set` 写不了它 —— 我自己授不了权。
没授权时发布命令会弹给用户确认，那是正常行为，不是失败。

**点击 ≠ 发布成功。** 见上面 `unverified` / `published` 那张表。

平台规格（发布页、作品列表页、字数 / 图片上限、登录墙标记）走 `hamuna platforms <id> --json`。
规格里缺的字段是「还没核实」，从 `creatorHomeUrl` 出发现场找，找到把实际路径记进
`memory/topics/<平台>.md`。**不许猜 URL。**

## 线索与对标账号

两个横切的面，不是流水线的一环：线索是**输入信号**，对标账号是**参照系**。

| 集合 | 是什么 | 天然键 |
|---|---|---|
| `clues` | 观众在我们**自己作品**下面说的话 | `(platform, commentId)` |
| `benchmarks` | 方向相近、规模更大的对标号 | `(platform, profileUrl)` |

天然键少一半都定位不到唯一一条。**重复采集同一条评论只合并成一条** ——
不合并的话，「多少人问价」会被灌上假数。

### 线索

```bash
hamuna ops add clue --platform xiaohongshu --comment-id "c-abc123" \
  --asset-id asset-1a2b3c4d --author-name "露营小王" \
  --content "这个折叠桌多少钱？" --intent price
hamuna ops update clue --platform xiaohongshu --comment-id "c-abc123" --status qualified
```

- `--intent` 只能是 `price`（问价格）/ `where`（问在哪买）/ `howto`（问怎么用）/ `other`。
  判不出就 `other` —— 猜一个具体的会把后面的统计带歪。
- `--status` 只能是 `new` / `qualified` / `archived`。**「值得跟进」是人的判断，我不替人标** ——
  连这条线索是不是需求我都还不知道。
- `--content` 留原文，不要改写、不要翻译。改写过的评论没法拿去回看。
- 楼中楼用 `--parent-comment-id`。

### 对标账号

```bash
hamuna ops add benchmark --platform xiaohongshu --name "露营老张" \
  --profile-url "https://…" --why "同样做入门装备实测" \
  --evidence "2026-11-16 公开页读到 38.2w 粉" --source agent
```

- `--source` 只能是 `user`（用户给的）/ `agent`（我找的）。
  **`agent` 的记录要用户点头才写。**
- `--profile-url` 必填 —— 它是天然键的一半，少了它下次认不回来。
- 不存粉丝数这种**会过期的数字**当字段。规模写进 `--evidence`，时间也写在证据里。

### 采集边界（这两个集合专属）

- **登录态可以读**：自己账号后台的评论页、平台公开的达人榜 / 对标榜页。
  榜是平台给所有人看的，只是要登录才给看 —— 这跟「看别人后台」不是一回事。
- **登录态不可以读**：别人账号的后台、私域数据。
- **只读，不互动**：回评论、私信、加好友、点赞关注，一律留给用户。
- 别人作品的评论区不碰 —— 那是别人的数据。我们要的是**观众对我们自己内容**的反应。

## 物料入库

物料从 `ops/inbox/<批次名>/` 来，入库后**整批**搬到 `ops/assets/imported/<日期>/<批次名>/`。

**搬走本身就是「处理过了」的标记**——不另设状态文件、不另建索引：文件不在 `ops/inbox/` 了，
下一次巡检就扫不到它。原件留在 `imported/` 下，不删。

素材的 `sourceRef` 指回那批原件。做稿之前先读它——`brief.md` 里有产品、卖点、禁用词、平台，
那是唯一写这些的地方。

## 写之前先读

改一条记录前先 `hamuna ops list`（或 `list <kind>`）确认它现在的状态。凭记忆改会覆盖掉用户刚在面板上改的东西。

## 数字口径

| 字段 | 口径 |
|---|---|
| `hotness` | 参考内容的**播放量**。没有可比参考就**不传**，别填 0——0 会被当成"播放量为零"。 |
| `progress` | 0–100 的整数。每次改素材更新一次，不跳着涨。 |
| `completionRate` | 0–1 的小数（41% 写 `0.41`，不是 `41`）。平台不给就**不传**。 |
| `confidence` | 0–1。凭一条样本写的规则给 0.3 以下，别硬写 0.9。 |
| `sampledCount` | 这条结论基于**多少个样本**（整数）。`confidence` 的分母——不写就等于没有分母。 |
| `evidenceBars.pct` | 0–100 的条长，不是原始数值。原始值放 `val`。 |

## 规则的缺口

规则不只写「结论是什么」，还写「还欠什么」：

| 字段 | flag | 口径 |
|---|---|---|
| 缺口 | `--gap` | 这条结论**还缺什么**，一条一句，可重复传。例：`"评论只读到前 20 条，共 87 条"`、`"没有同题材对照组"` |

**看不到的东西写进缺口，别猜数字填。** 缺口只留在这一轮的上下文里，下一轮就蒸发了；
写进台账，下一轮才知道还欠什么。缺口和样本量一起，结论才复核得动。

## 平台 id

只能是注册表里的：`xiaohongshu` / `douyin` / `kuaishou` / `weixin-channels` / `bilibili` / `zhihu` / `wechat-mp`。写成中文名会被拒。
