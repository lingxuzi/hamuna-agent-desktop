---
name: ops-publish
description: >-
  发布。把到点的 ready 素材在浏览器里投出去，再回创作者后台回读核实：
  核实到了置 published，核实不了置 unverified。
  用户在 Chat 里说「发出去」「这条到点了」，或者刚点完「开工」、这一轮要一路做到发布时，
  用这个 skill。发布只有一条合法通道：`hamuna browser publish`。
---

# ops-publish — 发布

## 谁在什么时候叫它

**这件事必须有东西真的来叫。** 排期只是台账上的一个时间字段，`scheduledAt` 到点
**不会自己触发任何动作** —— 没有轮询、没有倒计时、没有后台定时器。所以「到点发布」
靠的是有人 / 有 agent 在那个时刻**恰好跑到这一步**，而这一步需要**有浏览器面板的会话**。

浏览器面板属于**会话**，不是属于 App：`hamuna browser *` 的每个动词都按当前会话的
session id 找一个已经存在的面板。找不到、且 session id 非空 → 直接报错，不回退到别的会话
（`browser_api.rs::resolve_browser`：空 id 才走「随便找一个」的回退；带 id 就只认那个）。
`browser open` 会发一个「请开面板」的事件，但**只有持有同一个 session 的那个 Chat 标签页会认领**
（`Chat.tsx` 比对 `sessionIdRef.current === requested`），定时任务的 session 永远不是你正在看的那个。

所以：

| 场景 | 能不能发 |
|---|---|
| 用户在这个 Chat 里说「发」「这条到点了」 | 能 —— 面板就在这个会话里 |
| 心跳（IM 会话）跑到这一步 | **基本不能**。除非那个 IM 会话恰好被加载在某个打开的 Chat 标签页里，否则没人认领开面板的事件 → 15 秒超时 |
| 定时任务跑到这一步 | **不能**。实测 `status` / `list` / `read` 三个动词都报 `No browser is open for session <task-session-id>` |

**「心跳在跑」不等于「心跳能发」** —— 心跳是无人值守的，而浏览器恰恰需要有人在屏幕前。
这不是配置问题，是这一段本来就是人在的态度：发布要有面板，面板要有人看得见。

没浏览器时的正确行为：**什么都不做，也不要声称发了。** 报「有三条到点、需要你在 Chat 里发」，
把到点的素材 id 列出来，等一个有面板的会话接手。**不要在 `browser` 报错后改用 `click` 之类的
别的动词去凑** —— 那些同样要面板，而且绕过了发布闸。

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

**失效就跳过这个平台，不是可以重试的错误。**

`loginProbe` 决定怎么查（规格里给了）：

- `url` —— `hamuna browser state`，比对 `loggedInUrl.includes` / `excludes`
- `text` —— 抖音是这种：扫码前后 URL 一模一样，URL 判不出。用 `hamuna browser read`
  读正文，命中 `loginWallMarkers` 里任意一个就当没登录

没登录 → **跳过这个平台的这次发布**（素材留在 `ready`，下一轮再来），告诉用户「douyin 需要你扫一次码」。别的平台、别的步骤照跑，别因为一个平台把整轮丢掉。
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

## 4. 传图 / 传视频

```bash
hamuna browser upload --selector "<file input 的选择器>" --file <工作区里的绝对路径>
```

- 一次传一张，多图就传多次。传进去是**追加**，不会覆盖前一张。
- 12 MiB 以内的文件直接内联进页面；更大的走**分片**（每片 8 MiB，页面自己拼成
  一个文件），硬上限 **256 MiB**。命令不用变，还是这一条。
- 图片格式按规格里的 `imageFormats`，视频按 `videoFormats`。
- **能不能投视频看规格的 `mediaKinds`**：里面有 `video` 才能传（抖音现在可以）。
  没有就是这一条通道还没打通 —— 别试，报给用户。

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

## 6. 发布前三关

发布之前必须过三关。**任何一关不过就不发** —— 发出去再改的成本是删稿，不是改稿。
细则在 `references/publish-gates.md`。

| 关 | 查什么 | 不过怎么办 |
|---|---|---|
| 一、完整性 | 该有的都有：正文、封面 / 配图（张数按 `limits.maxImages`）、话题、格式硬要求 | 补齐再发 |
| 二、合规 | 规则在 `../ops-produce/references/compliance-gate.md`。文案在 plan 阶段已经过了一遍，这里补**画面本身**：首帧、封面实际渲染出来的字、字幕、素材实际用了哪一批 | 改掉再发；改不动就停 |
| 三、原创度与版权 | 洗稿特征、引用出处、素材授权、品牌商标 | 补引用 / 换素材 / 重写 |

**平台硬指标以 `hamuna platforms <id> --json` 为准**（`limits.maxTitleLength` / `maxBodyLength` /
`maxImages`）。命令里没有的字段就是「还没核实」，去发布页现场看，别拿记忆里的数字发。

三关都给「通过 / 不通过 + 要改什么」，**不给分数百分比**。编一个「相似度 87%」出来比不给更坏 ——
它让人以为查过了。

## 7. 发布

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

## 8. 回读核实（这一步才算数）

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
