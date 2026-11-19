---
name: ops-schedule
description: >-
  排期。给 ready 的素材定投放时间和目标平台，写进台账的 scheduledAt / platform。
  当用户说「什么时候发」「排一下这周的」「这条定周六」时用这个 skill。
  排期不是独立实体，是素材的两个字段。
---

# ops-schedule — 排期

排期不是一张独立的表，是素材的 `scheduledAt` 和 `platform` 两个字段。所以这里所有操作都是 `ops update asset`。

## 开工前先读

```bash
hamuna ops list asset --json     # 哪些 ready 还没排、哪些已排什么时候
```

只看 `status: ready` 且 `scheduledAt` 为空的——那是待排的。`draft` 的没做完不该排。

## 先确认这个平台收这种形态

排期前做的第一件事：**拿素材所属选题的 `form` 对这个平台的 `mediaKinds`**。

```bash
hamuna ops list topic --json         # 找到 asset.topicId 对应的 form
hamuna platforms <id> --json         # 这个平台收哪些形态
```

| `form` | 平台侧形态 | 收它的平台 |
|---|---|---|
| `image_text` | `image-text` | 除知乎外的六个 |
| `image_only` | `image-text` | 除知乎外的六个 |
| `text_only` | `image-text` 或 `article` | 全部 |
| `video_clip` / `video_aigc` | `video` | 目前只有抖音 |

**对不上就停，别排。** 一条 `image_text` 的素材排到知乎，到点发布时平台根本
没有那个表单，这一轮白做。停下来告诉用户「这条是图文，知乎收不了，换平台
还是改形态」，让人决定 —— 形态是人的，不是我改的。

**纯文字有两处要在发布页现场确认**：抖音 / 小红书的图文框通常要至少一张图，
公众号 / 知乎不收封面。规格里没有这一条（`mediaKinds` 只到 `image-text` 这一层），
所以排期时对得上的，发布时先在发布页看一眼表单：确实填不进去就回来问，
不要临时补一张图凑数 —— 形态是人定的。

选题上没有 `form`（老记录）：按素材实际有什么推 —— 有视频就是视频，有封面
配图就是图文，只有正文就是纯文字。**推完要在交接里说一句「按素材内容判定为
X」**，不要默默当成某个形态。

## 定时间

判断依据，按重要性排：

1. **用户已有的节奏** — `03-USER.md` 的 `cadence`（一周几条、什么时候发）。先顺着它，别自作主张改节奏。
2. **不撞车** — 同一天同一平台已经有一条了，就换天。两条同平台同天发会互相抢流量。
3. **观众什么时候在** — 平台差异很大（抖音晚 8–10 点、小红书中午和晚 9 点、B 站晚 6 点后）。不知道就按用户现有数据最好的时段。
4. **热点时效** — 蹭热点的内容有半衰期，过了时间就没意义，优先排最近的时间槽。

时间用带时区的 ISO 8601：

```bash
hamuna ops update asset --id asset-1a2b3c4d \
  --scheduled-at 2026-11-16T20:00:00+08:00 \
  --platform douyin
```

**给用户看的永远是本地时间**（"周六晚 8 点"），不要甩一个 UTC 时间戳让用户自己换算。

## 调整

```bash
hamuna ops update asset --id asset-1a2b3c4d --scheduled-at 2026-11-18T12:00:00+08:00
```

改期只传 `--scheduled-at`，其余字段不动。取消排期才显式传空值。

## 交接

排完把一个周期的时间表整体报给用户（一行一条：日期 + 时间 + 平台 + 标题），不要一条条问"这条行吗"。

## 不要做

- **发布不归这个 skill。** 排期只写时间字段；到点由心跳那条线去发（`HEARTBEAT.md` 第 1 步 / `ops-publish`）。
- 不在用户没同意的情况下改动已定的排期。
- **不要直接编辑 `ops/state.json`** —— 排期就是 asset 的两个字段，走 `ops update asset`。
- 不为了填满日历硬排没做完的素材。
