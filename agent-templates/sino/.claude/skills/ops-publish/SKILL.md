---
name: ops-publish
description: >-
  发布。把到点的 ready 素材在浏览器里投出去，再回创作者后台回读核实：
  核实到了置 published，核实不了置 unverified。
  心跳跑到点、用户说「发出去」「这条怎么还没发」时用这个 skill。
  发布只有一条合法通道：`hamuna browser publish`。
---

# ops-publish — 发布

## 开工前先读

```bash
hamuna ops list asset --json                                    # 哪些到点该发
hamuna platforms douyin --json                                  # 这个平台的规格
```

选素材的条件，三条都要满足：

- `status: ready`
- `scheduledAt` 已到（没排期的不发，先回 `ops-schedule`）
- 不是 `published` / `unverified` —— 提交过的不存在重发（`05-OPS.md`）

平台规格就是 `hamuna platforms <id>` 给的那份。里面没有的字段一律当**没核实**，
去现场找，不要照记忆填一个 URL。

## 1. 先查登录态

**失效就整轮停下，这不是可以重试的错误。**

`loginProbe` 决定怎么查（规格里给了）：

- `url` —— `hamuna browser state`，比对 `loggedInUrl.includes` / `excludes`
- `text` —— 抖音是这种：扫码前后 URL 一模一样，URL 判不出。用 `hamuna browser read`
  读正文，命中 `loginWallMarkers` 里任意一个就当没登录

没登录 → 停下来告诉用户「douyin 需要你扫一次码」，回 `HEARTBEAT_OK` 之外只说这一件。
**不要自己登，不要拿密码去试，不要在登录墙上继续点。**

## 2. 打开发布页

```bash
hamuna browser open <规格里的 publishUrl>
```

规格里没有 `publishUrl` → 从 `creatorHomeUrl` 进去，用 `hamuna browser fields` 找发布入口，
找到后把实际路径记进 `memory/topics/<平台>.md`，下一轮就不用再找。

## 3. 摸清这一页

```bash
hamuna browser fields
```

每个可见的输入框 / 按钮都会带一个能用的选择器。**不要猜选择器**，也不要凭上一轮的
记忆直接填 —— 平台改版是常态，`fields` 是唯一能告诉你「现在长什么样」的东西。

## 4. 传图

```bash
hamuna browser upload --selector "<file input 的选择器>" --file <工作区里的绝对路径>
```

- 一次传一张，多图就传多次。传进去是**追加**，不会覆盖前一张。
- 单张硬上限 12 MiB（内联base64 的通道限制），格式按规格里的 `imageFormats`。
- **视频现在传不过去**：规格里 `mediaKinds` 只有 `image-text` 就是这意思。别试。

## 5. 写文案

抖音的标题和正文是**同一个「作品描述」框**：第一行是标题，换行接正文，最后接话题。
按这个拼成一个文件（比如 `ops/assets/<assetId>.publish.txt`），再用 `--value-file` 读进去：

```bash
hamuna browser fill --selector "<描述框的选择器>" --value-file ops/assets/asset-1a2b3c4d.publish.txt
```

**不要用 `--value` 内联多行文本**：换行会被审批层判定成「无法静态证明无害」，
`fill` 从自动放行退回弹窗；而且引号 / `#` 还要在命令行上再转义一遍。

`fill` 失败是**静默**的（节点找到、值没进去也算成功返回）。所以填完必须回读：

```bash
hamuna browser read
```

读回的正文里能看到标题那行，才算真的写进去了。看不到 → 换选择器重填，不要接着点发布。

## 6. 发布

```bash
hamuna browser publish --platform douyin --text "发布"
```

这是**唯一**允许的发布方式。它有三道自己的闸：

1. 审批 —— 用户在设置里给这个平台开了「允许自动发布」才不弹；没开就会弹给用户点
2. 范围 —— 当前页面必须在 `creator.douyin.com` 域内，否则直接拒
3. 平台 id —— 拼错的 id 当场报错

**不要用 `browser click --text "发布"` 代替。** `click` 走的是自动放行名单，不弹审批、
不留审批记录，等于绕过上面三道闸。这条路是被明确封掉的，不是还没做。

发布命令报错 / 被拒 → **什么都没提上去**。素材留在 `ready`，把原因告诉用户，
下一轮重来。这种情况不是 `unverified`。

## 7. 回读核实（这一步才算数）

点了按钮不等于发出去了。回作品列表页看：

```bash
hamuna browser open <规格里的 workListUrl>
hamuna browser read
```

在列表里按标题找到这一条，且时间对得上（发布后 10 分钟内出现在列表里）：

```bash
hamuna ops update asset --id asset-1a2b3c4d \
  --status published \
  --published-at 2026-11-16T20:03:00+08:00
```

列表里能直接读到作品 id（链接里带的那种）才补 `--platform-work-id`。
**读不到就不传**，不要自己编一个。

找不到 / 列表还没刷新 / `workListUrl` 缺失：

```bash
hamuna ops update asset --id asset-1a2b3c4d --status unverified --published-at 2026-11-16T20:03:00+08:00
```

`unverified` = 提交过、没证据。它在面板上和「已发布」视觉可分，用户知道还要跟进。
**不要为了好看写 `published`。** `unverified` 也不许退回 `ready` —— 那可能就是双发。

拿不准是"还没刷新"还是"压根没发上"→ 写 `unverified`，下一轮再回读一次。

## 交接

说了什么就报什么：哪条、发到哪、核到什么程度。三行以内。

## 不要做

- **不要用 `click` / `submit` 点发布按钮**，只有 `browser publish` 是发布。
- **没有回读证据不写 `published`。**
- 不在登录失效时重试、不自己登录、不碰账号设置。
- 不改 `ops/state.json`（`05-OPS.md`）。
- 不在同一轮里发第二条：平台限流和重复内容判定都在你这边。
- 规格里没核实的 URL 不去猜；从 `creatorHomeUrl` 出发现场找，找到记进记忆。
