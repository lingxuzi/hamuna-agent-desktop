# 热榜从哪读

> **方法论来源**：Easel `skills/shared/hotlist-apis.md`。
> **改动**：
> 1. **取数通道换了**：Easel 用 `web_fetch` 打公益 API（60s / xxapi），因为它跑在服务端、IP 被平台反爬。
>    sino 跑在用户机器的内嵌浏览器里，有真实 IP 和登录态，平台自己的热榜页能直接读。
>    **所以 60s / xxapi 的 API 清单没有搬** —— 那是绕开一个我们没有的约束，还多一个第三方依赖。
>    榜源清单本身（哪些平台值得看）搬过来了。
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
