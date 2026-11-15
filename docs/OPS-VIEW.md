# 运营视图（Ops View）设计稿

> 术语见根目录 `CONTEXT.md`；决策见 `docs/adr/`。本文只讲怎么做。

## 一句话

在 Agent 聊天页里，为 **Sino**（运营 Agent 模板，`templateId: 'sino'`）创建的工作区加一个运营视图：Agent 按 选题 → 素材 → 排期 → 复盘 四段编排产出内容，运营视图把这四段的状态呈现成人可直接增删改的台账。

## 范围

**做**：选题、素材、排期、复盘四域的台账与运营视图界面；热点与对标账号作为选题输入；heartbeat 的分析与沉淀。

**不做**：平台凭据管理、登录态深读他人账号数据、给他人作品评论 / 私信 / 加好友。

## 五个域

| 域 | 是什么 | 谁写 |
|---|---|---|
| 方向 | 每个平台「这个号是什么」：定位、受众、内容支柱、目标、节奏 | 人给一句原话，Agent 结构化；已生效的改动由 Agent 提修订、人采纳 |
| 选题 | 待加工的内容意图（角度、目标平台、来源） | Agent 提，视图可改 |
| 素材 | 成品：正文 + 封面 + 配图（+ 分镜） | Agent 产，视图可改 |
| 排期 | 素材的投放时间与目标平台 | Agent 排，视图可改 |
| 复盘 | 已投放素材的表现数据 + 分析结论 | 采集（手动）+ heartbeat 反思 |

排期不是独立实体，是素材的两个字段（`scheduledAt` / `platform`）在月历上的投影 —— 与参考项目一致，少一个概念。

方向不是第五个抽屉，是其余四域共用的前提：选题判断「值不值得做」读的是它，复盘沉淀的
`rules` 要能反过来改它。**一个平台一条**，唯一性是 `validate_state` 里的结构约束而不是
调用方约定——重复平台直接拒写，因为那意味着两份互相矛盾的定位同时存在。

方向的修订**嵌在记录里**（`proposal` 字段），所以「人点采纳」是一次原子写；
`--accept-proposal` / `--reject-proposal` 是 Rust 侧的**动作键**，不是字段——调用方
不需要知道 proposal 里有哪些字段，也就不需要把字段清单复制到每一个写者里。

## 数据模型

落盘在**工作区内** `ops/state.json`（人类可读、可 git），素材文件落在 `ops/assets/`。

```jsonc
{
  "version": 1,
  "directions": [{                 // 每个平台一条，唯一性在 Rust validate_state 里硬校验
    "id": "dir-<platform>",        // 从平台派生，所以同平台重复 upsert 落在同一条
    "platform": "douyin",
    "brief": "string",             // 用户原话，可以很模糊
    "positioning": "string",       // 以下是 Agent 结构化的结果
    "audience": "string",
    "pillars": ["string"],
    "goal": "string",
    "cadence": "string",
    "status": "draft | active",
    "proposal": {                  // 待确认修订；嵌套 → 采纳是一次原子写
      "positioning": "string", "audience": "string", "pillars": ["string"],
      "goal": "string", "cadence": "string",
      "rationale": "string",       // 面板上原样显示给用户，是唯一的采纳依据
      "evidence": "string", "proposedAt": "ISO"
    },
    "createdAt": "ISO", "updatedAt": "ISO"
  }],
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

Sino 模板自带七个 skill，域即段：

| skill | 干什么 | 产出 |
|---|---|---|
| `ops-direction` | 把用户一句模糊原话拆成定位 / 受众 / 内容支柱 / 目标 / 节奏；跑过几轮后按数据提修订 | directions |
| `ops-topic` | 读热点 + 对标，定选题 | topics |
| `ops-intake` | 把人丢进 `ops/inbox/` 的原始物料变成素材，原件归档到 `ops/assets/imported/` | assets |
| `ops-produce` | 把选题或物料变成素材 | assets |
| `ops-schedule` | 排期 | assets 的排期字段 |
| `ops-publish` | 到点在浏览器里发出去，再回创作者后台回读核实 | assets 的 `status` / `publishedAt` / `platformWorkId` |
| `ops-review` | 分析已投放素材的表现，反思沉淀 | reviews + rules |

热点与对标是**选题的输入源**，不是独立域：选题的 `source` 字段记 `hotspot` / `benchmark`，`sourceRefs` 留来源线索。

**物料入库**同理是一条输入路径而不是一个域：人把物料丢进 `ops/inbox/<批次名>/`（可选放一份
`brief.md` 写清产品、卖点、要观众做什么），入库时整批搬到 `ops/assets/imported/`。搬走本身就是
「处理过了」的标记——不另设状态文件、不另建索引。素材的 `sourceRef` 指回那批原件。

**heartbeat** 四条自动段：
- 发布 —— 到点的 `ready` 素材发出去，再回读核实；**登录态失效就整轮停下通报**。
- 入库 —— 扫 `ops/inbox/`，有批次就入库并接着做稿。
- 采集 —— 无人值守时读创作者后台表现数据；**登录态失效就跳过并通报**，不要用猜的数字填。
- 分析反思 —— 可无人值守：读本地表现数据 → 产出 `rules`（`source: reflection`）→ 反哺选题与制作。

## 平台规格层

平台上限和创作者后台路径会变，而 agent 模板**只在建工作区时拷一次**，改了不会补给老工作区。
所以规格不进模板：它放在 App 侧（`src/shared/socialPlatforms.ts`），随 App 升级，agent 通过
`hamuna platforms <id> --json` 读。

规格回答「在这个平台上发一条内容需要知道什么」：形态（平台接受 ∩ 我们传得过去）、字数 / 图片 /
话题上限、发布页、作品列表页、数据页、登录探针（`url` / `text`）与登录墙标记。

**缺字段 = 还没核实**，不是「没有」。缺 URL 时从 `creatorHomeUrl` 进后台现场找入口，找到的真实
路径记进工作区记忆。给一个猜的地址，发布线会拿着它跑一圈再失败。

## 发布授权模型

`unverified` / `published` 这条分界线只有在**发布确实是 agent 做的**时候才有意义，所以发布必须
可无人值守，同时又不能变成「随便哪个页面点一下」。

三层，缺一层授权就名不副实：

1. **审批层**（`agent-session.ts`）—— `hamuna browser publish` 是受闸动作。用户在
   设置 → 社交账号里给某个平台开了「允许自动发布」，这个平台的发布才免审批；其余照弹。
   授权只能从设置页写（`socialAccounts` 在 `handleConfigSet` 的 `protectedKeys` 里），
   agent 不能给自己授权。
2. **范围层**（`browser-api.ts`）—— 当前页面必须在该平台的**创作者后台域**内
   （`isPlatformPublishHost`，精确匹配 host）。B 站在 `passport.bilibili.com` 登录、
   `member.bilibili.com` 发布，所以判的是后台域名不是登录域名。
3. **动词层**（`browser-command-approval.ts`）—— `publish` 与 `submit` 同为受闸动作，
   **永不进自动放行名单**。用 `browser click` 点「发布」绕得过整套闸，所以在模板规则里明确封掉。

## 采集边界

- 允许：web 搜索、平台**公开**热榜页（`open` / `read` 免审批，可无人值守跑）、用户粘贴链接或文本。
- 禁止：用登录态深读他人账号的后台数据；给他人作品评论、私信、加好友。
- `submit` / `publish`（可能真的发帖）走审批；`publish` 可被按平台的常驻授权免掉。

## 模块落点

| 层 | 文件 |
|---|---|
| 共享类型 | `src/shared/ops.ts`（schema + 状态枚举 + 校验） |
| Rust 权威 | `src-tauri/src/ops_store.rs`（新：校验 + 原子写 + 文件锁 + CRUD） |
| Rust 命令 | `src-tauri/src/commands.rs`（`cmd_ops_*`） |
| Rust HTTP | `src-tauri/src/management_api.rs`（`/api/ops/*`） |
| CLI | `src/cli/hamuna.ts`（`hamuna ops list|add|update|remove|review`） |
| 模板 | `agent-templates/sino/`（CLAUDE.md / HEARTBEAT.md / rules / skills）+ `tauri.conf.json` 资源映射 + `PRESET_TEMPLATES` 条目 |
| 前端 | `src/renderer/components/ops/`（面板 + 五域视图）+ `src/renderer/pages/Chat.tsx` 接入 |

## 实施顺序

1. `src/shared/ops.ts` 类型 + 状态机单测 → `npm run test:unit`
2. Rust `ops_store.rs` + 命令 + 管理 API + 单测 → `cargo test`
3. CLI `hamuna ops` → 手动跑通增删改查
4. 模板 `agent-templates/sino/` + 注册 → 从模板库能建出工作区
5. 前端面板（先只读）→ 运营 tab 能显示四域
6. 前端写入 → 走 invoke，双向可改
7. 七个 skill + HEARTBEAT → Agent 能跑通一遍编排（含发布 + 回读）
8. 热点 / 对标采集 → 选题能带来源
