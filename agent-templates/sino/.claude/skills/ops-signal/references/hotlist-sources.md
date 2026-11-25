# 热榜从哪读

> **方法论来源**：Easel `skills/shared/hotlist-apis.md`。
> **改动**：
> 1. **取数通道换了两轮**：
>    - 第一轮：Easel 用 `web_fetch` 打公益 API（60s / xxapi），因为它跑在服务端、IP 被平台反爬。
>      sino 跑在用户机器的内嵌浏览器里，有真实 IP 和登录态，平台自己的热榜页能直接读 ——
>      所以 60s / xxapi 的 API 清单**没有搬**。榜源清单（哪些平台值得看）搬过来了。
>    - 第二轮：补了一条 newsnow 聚合接口，用于**没有浏览器面板的会话**（心跳 / IM /
>      后台任务），那些场景 `browser open/read` 整条用不了。它不替代交互式那套：
>      人在电脑前选题，读平台原页仍然更准。
>    **60s / xxapi 依然没搬** —— 那是每个平台一个 scraper，newsnow 一个接口就聚合了六个平台，
>   多引一个聚合依赖换掉六个平台的解析维护，这个交换是划算的；当年那批单平台 scraper 不是。
>    > **没有「热点定时任务」。** 模板不预置任何扫榜 cron，用户创建的工作区里也没有。
>    > 热点是 `ops-topic` 开一轮时触发 `ops-signal` 拿的；无人值守轮次里看到这个文件，
>    > 是那一轮自己恰好没面板，不是有个任务替你扫好了。
> 2. URL 换成实测过的公开热榜页（2026-11-21 逐个验过状态）。
> 3. Easel 文档把响应字段写作 `hot`，**实测是 `hot_value`**（抖音 / 微博）、`score`（小红书）、`hot_value_desc`（知乎）。按实测的写。
> 4. 加了一条 Easel 没有的红线：**热榜热度值 ≠ `--hotness`**。
> Easel 那边改了这里要跟着改。这行出处别删 —— 删了就没人知道它抄的是哪。

---

## 榜源

| 平台 | 热榜页 | 备注 |
|---|---|---|
| 抖音 | `https://www.douyin.com/hot` | 页面内 fetch 出来的，`browser read` 能读到 |
| 微博 | `https://s.weibo.com/top/summary` | 没登录态会跳 visitor 登录页 |
| 知乎 | `https://www.zhihu.com/hot` | |
| 今日头条 | `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | 直接给榜单 HTML |
| B站 | `https://www.bilibili.com/v/popular/rank/all` | 全站热门榜，不是热搜榜 |
| 百度 | `https://top.baidu.com/board?tab=realtime` | |
| 小红书 | —— | **没有公开网页热榜**（热搜只在 App 内）。不猜 URL |
| 快手 | —— | 没有公开热榜页；`/brilliant` 是精选页，不是热榜 |
| 视频号 / 公众号 | —— | 微信生态没有公开热榜 |

小红书 / 快手 / 视频号 / 公众号要热点，走下面的降级链，**别硬凑**。

## 怎么读

```bash
hamuna browser open "https://www.douyin.com/hot"
hamuna browser read              # 当前页读成 markdown
```

抖音热榜是页面内 fetch 出来的，`browser read` 能读到 —— 这条已经在
`ops-benchmark-analysis/references/data-collection.md` 里记过一次。

浏览器面板不可用 → 退回 `hamuna browser search "抖音 热榜 今天"`，不要反复重试。

## 热度值 ≠ 播放量（红线）

榜上给的是**平台的热度分**（抖音字段 `hot_value`，量级是八位数），**不是播放量**。

`--hotness` 填的是**参考内容的播放量**（口径见 `05-OPS.md`）。

**热榜热度值不许填进 `--hotness`。** 想要 `--hotness` 就打开一条具体的参考内容，
读它的播放量；读不到就**不传**。

## 扫几个、扫多久

- 一次最多扫 2–3 个榜。默认**抖音 + 微博**；单平台号只扫自己那个平台的榜。
- 热榜 5–10 分钟刷新一次。反复刷同一个榜拿不到新信息。
- 一次选题最多提 3 条（硬约束在 `SKILL.md`）。扫 5 个榜提 20 条，等于没提。

## 降级链

榜读不到 → `browser search` 找公开榜页 → 还是没有 → **问用户**（截图，或者直接说他看到的热点）
→ 换榜源。

不要用没核实过的第三方接口充数，也不要把接口挂了说成「今天没热点」。

（newsnow 是**核实过**的那一个，下面单独写。除此之外不要临时找别的接口顶上来。）

---

## 无人值守时怎么取（定时任务 / 后台）

定时任务跑在 headless sidecar 里，**没有 Chat 的浏览器窗口**：`hamuna browser open` 会去要
一个永远不会有人开的面板（15 秒超时），`browser read` 直接报
「No browser is open for session X」。所以后台场景**不用**上面那套 `browser open/read`。

改用 newsnow 的公开聚合接口（本项目新增，不是 Easel 搬来的）：

```bash
curl -s \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
  -H 'Accept: application/json' \
  'https://newsnow.busiyi.world/api/s?id=douyin'
```

**两个头缺一不可。** 不带 `User-Agent`（或带默认的 `curl/x.y`）会被 403 —— 实测过。

返回：

```json
{ "status": "cache", "id": "douyin", "updatedTime": 1795247749687,
  "items": [ { "id": "2756443", "title": "…", "url": "https://www.douyin.com/hot/2756443" } ] }
```

| 字段 | 用法 |
|---|---|
| `status` | `success`（刚抓的）/ `cache`（默认 30 分钟缓存）。两种都能用 |
| `updatedTime` | 这份数据是什么时候的（毫秒）。**拿它判新鲜度**，别拿 `Date.now()` |
| `items[].title` / `.url` | 条目标题 + 平台原链接。`url` 是打开具体内容读播放量的入口 |
| `items[].id` | 平台侧条目 id，不是播放量 |

可用的 `id`（2026-11-21 逐个实测）：

| id | 平台 | 实测 |
|---|---|---|
| `douyin` | 抖音 | ✅ 30 条 |
| `weibo` | 微博 | ✅ 30 条 |
| `zhihu` | 知乎 | ✅ 20 条 |
| `bilibili` | B站热搜 | ✅ 30 条 |
| `toutiao` | 今日头条 | ✅ 30 条 |
| `baidu` | 百度热搜 | ✅ 30 条 |
| ~~`kuaishou`~~ / ~~`xiaohongshu`~~ | 快手 / 小红书 | ❌ 该源不存在，返回 0 条 |

**它不给热度值，只给标题和链接。** 这正好：`--hotness` 要的是播放量，接口里根本没有能
填进去的数 —— 想填就得按 `items[].url` 打开那条具体内容去读播放量，读不到就不传。

三条纪律：

- **未知 `id` 会返回 500**（`Invalid source id`）。宁可少扫一个榜，不要猜 id。
- **接口 403 / 500 / 空列表 → 跳过这个榜，不重试、不换榜硬凑。** 反复重试会把这个第三方
  服务的 IP 拉黑，而且拿不到的东西重试十次也拿不到。
- **返回空列表 ≠ 今天没热点。** 永远说「榜没取到」，不要把它说成「今天没热点」。

它是第三方聚合，不是平台官方 —— 榜位顺序和平台自己的一致，但**延迟 30 分钟量级**（缓存）。
爆发期（0-4 小时）的榜要抢，就还是得靠有浏览器的交互式选题。
