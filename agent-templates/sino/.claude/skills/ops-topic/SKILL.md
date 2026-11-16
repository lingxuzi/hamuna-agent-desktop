---
name: ops-topic
description: >-
  选题。读热点、看对标、判断值不值得做，把结果落进运营台账的 topics。
  当用户说「今天做什么」「有什么可做的」「这个热点能不能蹭」「帮我找几个选题」，
  或者你刚做完了复盘、要按规律开下一轮时，用这个 skill。
  产出是一条或几条选题记录——不是内容，不是脚本。
---

# ops-topic — 选题

选题是四段循环的第一段。它的产出**只是一条记录**：做什么、为什么值得做、从哪个角度切、打哪个平台。写成内容不是这一步的事。

## 开工前先读

```bash
hamuna ops list --json          # 现在手上有什么，别重复提
hamuna ops list rule --json     # 复盘沉淀的规律，选题要顺着它们走
```

读 `.claude/rules/05-OPS.md` 里的数字口径，尤其 `hotness`。

## 输入源

按可信度排：

| 来源 | 怎么拿 | `source` |
|---|---|---|
| 平台公开热榜 | `hamuna browser open <热榜URL>` → `hamuna browser read`，读返回的 markdown；或 web 搜索「XX 平台 热榜 今天」 | `hotspot` |
| **台账里的对标账号** | `hamuna ops list benchmark --json` 拿到主页链接 → `hamuna browser open <主页URL>` → `hamuna browser read`。**只读公开页，不用登录态进别人后台** | `benchmark` |
| **台账里的评论线索** | `hamuna ops list clue --json` —— 观众在我们自己作品下面问过的东西（「这个多少钱」「哪里买」「怎么用」） | `benchmark` |
| 用户直接给的线索 | 用户粘贴的链接、截图描述、一句话 | `manual` / `benchmark` |
| 上一轮复盘的结论 | `ops list rule` 里的 `active` 规则 | `reflection` |

**采集边界**：公开热榜、公开主页、用户粘贴的内容可以读。他人账号后台、私域数据、需要登录才能看到的东西不碰。

**用对标账号时必须指名**：一条 `source: benchmark` 的选题要说清是**哪个对标账号**的什么内容给了启发，
写进 `--ref`（主页链接）和 `--note`。写「参考了对标账号」等于没说 —— 下一轮没人知道该去看谁。

**用线索时必须指名**：说清是哪个问题（几个人问、问了什么）。「最近有 3 个人问价格」比「用户关心价格」有信息量得多。

**用内嵌浏览器，不用系统浏览器。** `hamuna browser open` 打开的是 App 内嵌 webview（`hamuna browser read` 能把当前页读成 markdown），页面留在 App 里用户看得见，采集过程透明。打开失败（浏览器面板不可用）就退回 web 搜索，不要反复重试。

## 判断值不值得做

四条，全过才落库：

1. **和这个号的定位有关** — 读 `03-USER.md` 的赛道。不相关再好也不做。
2. **有差异角度** — 同样的题材已经被讲过八百遍，我要说的是哪一句不一样的话。
3. **现在做还来得及** — 热点有半衰期，超过 72 小时的"热点"通常已经是旧闻。
4. **做得出来** — 手上的素材、时间、能力够不够。够不着的选题不是选题，是愿望。

任何一条不过，就不提。**宁可不提，也不提一条你其实不看好只是为了凑数的。**

## 落库

```bash
hamuna ops add topic \
  --title "选题标题（用户能看懂的一句话）" \
  --platform douyin \
  --source hotspot \
  --angle "切入角度：我这句不一样的话" \
  --note "为什么值得做：和定位的关系 + 现在做还来得及的理由" \
  --hotness 86000 \
  --tag 职场 --tag 反常识 \
  --ref "https://参考内容链接"
```

字段规则：

- `--title` 是用户能在面板上一眼认出这条选题的标题，不是内容标题的草稿
- `--platform` 只能是 `xiaohongshu` / `douyin` / `kuaishou` / `weixin-channels` / `bilibili` / `zhihu` / `wechat-mp`
- `--hotness` 填**参考内容的播放量**（整数）。没有可比的参考内容就**不传**——传 0 会被当成播放量为零
- `--tag` / `--ref` 可以重复传多次
- 不加 `--status`，新建默认 `idea`

**一次最多提 3 条。** 提 20 条等于没提。

## 交接

提完把 id 报给用户，一句话说清每条的核心判断（不是复述标题）。用户点头后进 `ops-produce`。

## 不要做

- 不要在这一步写正文、画封面。那是 `ops-produce` 的事。
- 不要改已有选题的状态——那是用户在面板上按的检查点。
- **不要直接编辑 `ops/state.json`。**
