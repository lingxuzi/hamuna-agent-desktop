# 运营视图（Ops View）设计稿

> 术语见根目录 `CONTEXT.md`；决策见 `docs/adr/`。本文只讲怎么做。

## 一句话

在 Agent 聊天页里，为 **Sino**（运营 Agent 模板，`templateId: 'sino'`）创建的工作区加一个运营视图：Agent 按 选题 → 素材 → 排期 → 复盘 四段编排产出内容，运营视图把这四段的状态呈现成人可直接增删改的台账。

## 范围

**做**：选题、素材、排期、复盘四域的台账与运营视图界面；热点与对标账号作为选题输入；heartbeat 的分析与沉淀。

**不做**：平台凭据管理、登录态深读他人账号数据、给他人作品评论 / 私信 / 加好友。

## 四个域

| 域 | 是什么 | 谁写 |
|---|---|---|
| 选题 | 待加工的内容意图（角度、目标平台、来源） | Agent 提，视图可改 |
| 素材 | 成品：正文 + 封面 + 配图（+ 分镜） | Agent 产，视图可改 |
| 排期 | 素材的投放时间与目标平台 | Agent 排，视图可改 |
| 复盘 | 已投放素材的表现数据 + 分析结论 | 采集（手动）+ heartbeat 反思 |

排期不是独立实体，是素材的两个字段（`scheduledAt` / `platform`）在月历上的投影 —— 与参考项目一致，少一个概念。

## 数据模型

落盘在**工作区内** `ops/state.json`（人类可读、可 git），素材文件落在 `ops/assets/`。

```jsonc
{
  "version": 1,
  "topics": [{
    "id": "t_<uuid>",
    "title": "string",
    "note": "string",              // 为什么值得做
    "angle": "string",             // 切入角度
    "platform": "xiaohongshu",     // 目标平台（SocialPlatformId）
    "tags": ["string"],
    "status": "idea | planned | produced | dropped",
    "source": "hotspot | benchmark | manual | reflection",
    "sourceRefs": ["string"],      // 热点 / 对标的来源线索
    "createdAt": "ISO", "updatedAt": "ISO"
  }],
  "assets": [{
    "id": "a_<uuid>",
    "topicId": "t_<uuid> | null",
    "title": "string",
    "body": "string",              // 正文 / 脚本
    "product": "string",           // 这条内容要宣传的产品 / 服务
    "cta": "string",               // 期望观众做的动作
    "sourceRef": "ops/assets/imported/<date>/<batch> | null",  // 原始物料在哪
    "cover": "ops/assets/<file>",
    "images": ["ops/assets/<file>"],
    "shots": [{ "no": 1, "visual": "...", "voice": "...", "seconds": 6 }],
    "platform": "douyin",
    "scheduledAt": "ISO | null",
    "status": "draft | ready | published | unverified",
    "publishedAt": "ISO | null",
    "platformWorkId": "string | null",   // 平台侧作品 id，回读核实后才填得出
    "createdAt": "ISO", "updatedAt": "ISO"
  }],
  "reviews": [{
    "id": "r_<uuid>",
    "assetId": "a_<uuid>",
    "platform": "douyin",
    "publishedAt": "ISO",
    "metrics": { "views": 0, "likes": 0, "comments": 0, "shares": 0, "saves": 0, "followers": 0 },
    "note": "string",
    "createdAt": "ISO"
  }],
  "rules": [{                      // 沉淀：反思产出，反哺选题与制作
    "id": "rule_<uuid>",
    "name": "string", "rule": "string",
    "source": "reflection | manual | dialog",
    "status": "proposed | active",
    "confidence": 0.6, "evidence": "string",
    "createdAt": "ISO"
  }],
  "style": {                       // 风格卡：工作区级，单条
    "id": "style_<uuid>",
    "name": "string", "summary": "string", "tone": "string",
    "sentences": ["string"], "opening": "string", "structure": "string",
    "words": ["string"], "avoid": ["string"], "samples": ["string"],
    "updatedAt": "ISO"
  }
}
```

## 落点与交互

- **位置**：Chat 页右侧面板区新增一个「运营」tab，与已有的 文件 / 终端 / 浏览器 并列。该 tab 有独占模式：隐藏另三个，面板拉满右侧约 50%，可手动收起。理由：三域形态差异大（选题卡片墙 / 素材列表+预览 / 排期月历），25% 竖条装不下月历。
- **门控**：只有 `templateId === 'sino'` 的工作区才渲染这个 tab。依据是工作区已有的 `templateId`，不新增绑定字段。
- **人机分工**：运营视图能独立增删改，Agent 也能改同一份数据。视图的写 → Tauri invoke → Rust `OpsStore`；Agent 的写 → `hamuna ops` CLI → 管理 API → 同一个 `OpsStore`。**唯一写者是 Rust 侧**，两边不直接抢文件。
- **刷新**：Agent 侧写入后由轮次完成事件触发重读；面板打开时也重读一次。

## 编排

Sino 模板自带五个 skill，域即段：

| skill | 干什么 | 产出 |
|---|---|---|
| `ops-topic` | 读热点 + 对标，定选题 | topics |
| `ops-intake` | 把人丢进 `ops/inbox/` 的原始物料变成素材，原件归档到 `ops/assets/imported/` | assets |
| `ops-produce` | 把选题或物料变成素材 | assets |
| `ops-schedule` | 排期 | assets 的排期字段 |
| `ops-review` | 分析已投放素材的表现，反思沉淀 | reviews + rules |

热点与对标是**选题的输入源**，不是独立域：选题的 `source` 字段记 `hotspot` / `benchmark`，`sourceRefs` 留来源线索。

**物料入库**同理是一条输入路径而不是一个域：人把物料丢进 `ops/inbox/<批次名>/`（可选放一份
`brief.md` 写清产品、卖点、要观众做什么），入库时整批搬到 `ops/assets/imported/`。搬走本身就是
「处理过了」的标记——不另设状态文件、不另建索引。素材的 `sourceRef` 指回那批原件。

**heartbeat** 分三段：
- 入库 —— 扫 `ops/inbox/`，有批次就入库并接着做稿。
- 采集 —— 无人值守时读创作者后台表现数据；**登录态失效就跳过并通报**，不要用猜的数字填。
- 分析反思 —— 可无人值守：读本地表现数据 → 产出 `rules`（`source: reflection`）→ 反哺选题与制作。

## 采集边界

- 允许：web 搜索、平台**公开**热榜页（`open` / `read` 免审批，可无人值守跑）、用户粘贴链接或文本。
- 禁止：用登录态深读他人账号的后台数据；给他人作品评论、私信、加好友。
- `submit` 类命令（可能真的发帖）仍走既有审批。

## 模块落点

| 层 | 文件 |
|---|---|
| 共享类型 | `src/shared/ops.ts`（schema + 状态枚举 + 校验） |
| Rust 权威 | `src-tauri/src/ops_store.rs`（新：校验 + 原子写 + 文件锁 + CRUD） |
| Rust 命令 | `src-tauri/src/commands.rs`（`cmd_ops_*`） |
| Rust HTTP | `src-tauri/src/management_api.rs`（`/api/ops/*`） |
| CLI | `src/cli/hamuna.ts`（`hamuna ops list|add|update|remove|review`） |
| 模板 | `agent-templates/sino/`（CLAUDE.md / HEARTBEAT.md / rules / skills）+ `tauri.conf.json` 资源映射 + `PRESET_TEMPLATES` 条目 |
| 前端 | `src/renderer/components/ops/`（面板 + 四域视图）+ `src/renderer/pages/Chat.tsx` 接入 |

## 实施顺序

1. `src/shared/ops.ts` 类型 + 状态机单测 → `npm run test:unit`
2. Rust `ops_store.rs` + 命令 + 管理 API + 单测 → `cargo test`
3. CLI `hamuna ops` → 手动跑通增删改查
4. 模板 `agent-templates/sino/` + 注册 → 从模板库能建出工作区
5. 前端面板（先只读）→ 运营 tab 能显示四域
6. 前端写入 → 走 invoke，双向可改
7. 四个 skill + HEARTBEAT → Agent 能跑通一遍编排
8. 热点 / 对标采集 → 选题能带来源
