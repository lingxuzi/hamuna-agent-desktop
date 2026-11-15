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

- **发布不归这个 skill。** 排期只写时间字段；到点由心跳那条线去发（见 `HEARTBEAT.md`）。
- 不在用户没同意的情况下改动已定的排期。
- **不要直接编辑 `ops/state.json`** —— 排期就是 asset 的两个字段，走 `ops update asset`。
- 不为了填满日历硬排没做完的素材。
