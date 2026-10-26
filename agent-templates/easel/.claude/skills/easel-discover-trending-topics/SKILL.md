---
name: easel-discover-trending-topics
description: 抓微博/抖音/知乎/头条/B站/百度实时热搜，筛出和账号赛道相关的热点并给二创选题。用户说"今天有什么热搜""最近在聊什么""追个热点""帮我找选题"时用。
---

# 热点发现

产出**选题清单**，不产出内容。选题评估交给 `easel-plan-topic-evaluator`。

## 输入（都能从画像推断，别追问）

- **平台** — 默认读 `.claude/rules/03-USER.md` 的 platforms；没填就微博 + 抖音
- **赛道** — 读 identity 的赛道与定位
- **目的** — 浏览 / 找二创选题

## 抓数据

用 `WebFetch` 打下面这些已验证可用的免费 JSON 接口（无需 key）。

🚫 **绝对不要抓平台官网**（weibo.com / zhihu.com / douyin.com）**或 tophub.today** —— 反爬，返回登录页或 403，不是数据。也不要用没列出的第三方接口。

**主源 60s**，base `https://60s.viki.moe`，路径必须带 `/v2/`：

| 平台 | URL |
|---|---|
| 微博 | `https://60s.viki.moe/v2/weibo` |
| 抖音 | `https://60s.viki.moe/v2/douyin` |
| 知乎 | `https://60s.viki.moe/v2/zhihu` |
| 头条 | `https://60s.viki.moe/v2/toutiao` |
| 小红书 | `https://60s.viki.moe/v2/rednote` |
| 百度 | `https://60s.viki.moe/v2/baidu/hot` |

返回 `{"code":200,"data":[{"title","hot","url"},...]}`；部分端点是嵌套 `data.data`，两种都判断。

**备源 xxapi**（主源某端点失败时用，尤其 B站），base `https://v2.xxapi.cn`：
微博 `/api/weibohot` ｜ 抖音 `/api/douyinhot` ｜ B站 `/api/bilibilihot` ｜ 百度 `/api/baiduhot`

降级顺序：60s → xxapi → 全失败就如实说，请用户贴热搜截图或文字。**不要编造热搜。**

## 输出

写进 `outputs/<主题>/ideas.md`，并在对话里给表格（≤ 10 条，按契合度排序）。

```markdown
# 热点速报 {date}
平台: {platforms}

## 全平台热搜 Top 10
| # | 平台 | 话题 | 热度 | 与账号相关度（高/中/低） |

## 推荐二创选题（3–5 个）
### {标题}
- 热点来源：
- 二创角度：{怎么切，不是搬运}
- 建议形式：图文 / 短视频 / thread
- 时效窗口：{多久内发还有效}

## 趋势洞察
{跨平台重合话题 = 大事件；上升趋势；可预判的后续热点}
```

## 判断标准

有资格进清单的选题要同时满足：有讨论空间、和账号定位匹配、时效窗口还够、能做出差异化。四条缺一条就往下排，别硬凑。

## 边界

- 不写方案、不做图（那是 `easel-plan` / `easel-produce`）
- 擦边、谣言类热点标出来但**不推荐**
- 热点和你无关就直说「今天没有适合你的」，别为交差硬找

## 心跳里的轻量版

心跳巡检只做**精简形态**：查有没有和赛道相关、还没做过的新热点，有就记一条（标题 + 为什么适合 + 建议形式），**最多 3 条**，没有就什么都不做。**不**拉完整榜、**不**拆爆款、**不**出表格。
