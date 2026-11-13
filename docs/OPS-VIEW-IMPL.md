# 运营视图 · 实现计划

> 功能设计：`docs/OPS-VIEW.md`　界面设计：`docs/OPS-VIEW-UI.md`（方向 D 已选定）
> 决策记录：`docs/adr/0001..0003`　术语：`CONTEXT.md`
> 范围：**全量**，含四个 skill 与 HEARTBEAT。界面按 mock 原样，数据模型配合补齐字段。

---

## 一、先更正两处与现状不符的说法

### 1. 「运营 tab 与文件 / 终端 / 浏览器 并列」不成立

Chat 右栏没有常驻 tab 条。真实结构是 `splitActiveView: 'file' | 'terminal' | 'browser'`，tab 条只在 `activeViews >= 2` 时渲染（`src/renderer/pages/Chat.tsx:746`、`:5628`），各视图由 DirectoryPanel 的按钮按需打开。

**所以运营视图不是"加一个 tab"，是加第 4 个 view 值 + 自己的打开入口 + 自带顶栏。** 顶栏由面板自己画（D 的域胶囊条正好就是它），不挤进 split 的 tab 条。

### 2. mock 里四处数据，`OPS-VIEW.md` 的模型产不出来

| mock 显示 | 原模型 | 处理 |
|---|---|---|
| 选题「热度 8.6 万」 | `topics` 无评分 | 加 `topics[].hotness: number \| null` —— 同角度参考内容的播放量，缺失显示「—」 |
| 素材「完成度 80%」 | 只有三态 status | 加 `assets[].progress: number`（0–100），Agent 每次改素材时更新 |
| 复盘「平均完播 33%」 | `metrics` 无完播 | 加 `reviews[].metrics.completionRate: number`（0–1，null 表示平台不给） |
| 建议卡「封面有数字 1.8× vs 无数字 1.0×」 | 无属性维度 | 加 `rules[].evidenceBars?: { name, val, pct, mut? }[]` |

**`evidenceBars` 为什么不是客户端算的**：按属性分组跨内容求均值是一台分析引擎，前端算等于把业务逻辑塞进渲染层。反思（reflection）产出规则时**算一次、存下来**，前端只渲染——compute once at the owner, render many。`assets` 不加 `attrs` 字段，因为除了这张卡没人读它。

---

## 二、数据模型增量（相对 `OPS-VIEW.md`）

```jsonc
{
  "topics":  [{ "hotness": 86000 }],                    // number | null，参考内容播放量
  "assets":  [{ "progress": 80 }],                      // 0–100
  "reviews": [{ "metrics": { "completionRate": 0.41 } }],// 0–1 | null
  "rules":   [{ "evidenceBars": [                        // 可选，只有"有对照"的规则才有
    { "name": "封面有数字", "val": "1.8×", "pct": 100 },
    { "name": "封面无数字", "val": "1.0×", "pct": 56, "mut": true }
  ]}]
}
```

**Hero 三条指标全部可由四个数组派生**，不进 `state.json`：待加工 / 已产素材 / 热点来源 ← `topics`；制作中 / 待排期 / 本周完成 ← `assets`；本周待发 / 空缺日 ← `assets.scheduledAt`；总播放 / 总互动 / 平均完播 ← `reviews.metrics`。派生逻辑放 `src/shared/ops-derive.ts`（纯函数，可单测），前后端共用同一份口径——写两遍必然漂移。

状态分布的四态也派生，不加字段：`draft`（无 scheduledAt）/ `ready` + 无 scheduledAt = 待排期 / `ready` + 有 scheduledAt = 已排期 / `published`。

### 派生口径里的几个判断（实现时定的，写在这里备查）

| 项 | 决定 | 理由 |
|---|---|---|
| 一周从周一开始 | mock 里写的是「11/14–11/18」（周六起），那是画手随手写的日期，不是有意的周定义 | 中文语境周一是一周第一天；周一到周日 7 天 |
| 「本周完成」 | 用 `updatedAt` 落在本周、非草稿的素材数 | `state.json` 不另存完成时间，否则又多一个字段要同步 |
| 「今天该收尾」 | 草稿且 `updatedAt` 早于今天零点 | 同上，用更新时间代理「今天动过没有」 |
| 「本周待发」 | 本周内已排期**且还没到时间**的条数 | 已过时间的算「本周排了」，不算「待发」 |
| 分布条只出现有数的条目 | 值为 0 的来源 / 状态 / 平台不进榜 | 没有信息的行是噪音；mock 里那条 0 值的行是占位 |
| 平台分布按值降序，来源与状态按固定流程顺序 | 平台是排名维度，来源与状态是流程维度 | 排序规则跟着维度走 |
| 领跑优势 | 差距 = 第 1 名 − 第 2 名，百分比以**第 2 名**为基数 | 与 mock 的 +4,435 / 53% 对得上 |
| 完播率 | 只按有值的求均值；一条都没有时为 `null`（界面显示「—」） | 平台不给这个指标时不能当 0 拉低均值 |
| 榜单条数 | 复盘取前 5，其余域不截断 | 复盘是排行，其余域是待办清单，截断会漏掉卡住的那条 |

---

## 三、分阶段

每阶段独立可验收。**任何一阶段不能靠"下一阶段会补"过关。**

### Phase 1 · 共享类型与派生口径（约 2h）

| 项 | 内容 |
|---|---|
| 产出 | `src/shared/ops.ts`（schema 类型 + 状态枚举 + 判定守卫）、`src/shared/ops-derive.ts`（四域指标 / 列表 / 分布 / 深墨主角卡的纯函数） |
| 验证 | `src/shared/ops.unit.test.ts` + `ops-derive.unit.test.ts`：非法状态被守卫拒绝、空数据不出现 NaN / 不除零、`hotness: null` 保持 null、完播率只按有值的求均值、领跑差距与百分比口径 |
| 命令 | `npm run test:unit` |

**坑**：`shared/` 必须纯净（不许 import 任何进程特定模块，depcruise 会拦）。派生函数收 `OpsState` + 注入的 `now`，返回纯数据，不要返回已格式化的中文——文案在 i18n。

**已修正的一处过度设计**：初稿让 `src/shared/ops.ts` 带一个 `validateOpsState()`，在 TypeScript 侧再实现一遍 schema 校验。实现时发现这等于**第二套校验规则**——Rust 侧 `ops_store.rs` 本来就得有一份（serde 结构体 + 显式检查），两份规则迟早漂移，而漂移的方向是「界面认为合法、Rust 拒绝写」或反之，两边都难查。

改为：校验只在 Rust（唯一写者，且 `state.json` 是人可编辑的文件，读的时候必须挡住坏数据）；TS 侧只留**窄判定守卫**（`isOpsTopicStatus` 等），供 renderer 把未知状态降级成兜底文案，而不是让整页崩掉（React 根没有子边界，一崩就是白屏）。

防枚举漂移的办法放在 Rust：加一条单测，用 `include_str!` 读到 `src/shared/ops.ts`，逐个校验 Rust 的枚举值在这个文件里都有对应字面量——**Rust 写出一个界面读不出来的状态值**是这个方向最危险的漂移，测试挡住它。改 TS 枚举时必须同步改 Rust 枚举，否则那条单测会红。

### Phase 2 · Rust `OpsStore`（约 5h，本轮最重）

| 项 | 内容 |
|---|---|
| 产出 | `src-tauri/src/ops_store.rs`：读、校验、原子写（临时文件 + rename，锁内）、`with_file_lock_blocking`，CRUD 六个动作（topic / asset / review / rule 各一套，style 单条） |
| 命令 | `commands.rs` 加 `cmd_ops_read` / `cmd_ops_upsert_*` / `cmd_ops_delete_*`，全部 `pub async fn` + `spawn_blocking` |
| 路径 | `ops/state.json` 与 `ops/assets/` 经 `validate_file_path` + 组件级判断（拒绝 `Prefix`/`RootDir`/`ParentDir`，复用 `join_inside` 系列的判断） |
| 事件 | 每次写成功后 `app.emit("ops:changed", { workspace })` —— 唯一写者最清楚自己写过，不需要轮询 |
| 验证 | `ops_store` 单测：并发写同一文件不丢数据、坏 JSON 不覆盖原文件、越界路径拒绝、写入后读回一致；`cargo clippy` 无红线 |

**坑（照抄既有事故）**：
- 不能用 `fs::rename` 裸奔路径判断，也不用 `Path::exists()` 探 symlink —— 用 `fs::symlink_metadata`。
- 锁用 `with_file_lock_blocking`，Python 式 `tmp + rename` 会丢密钥级的并发问题（本项目已有结论）。
- 不要 `tokio::spawn`。

**落地记录（Phase 2 完成后补）**：

| 原计划 | 实际 | 为什么 |
|---|---|---|
| 命令写进 `commands.rs` | 命令落在 `ops_store.rs` 自己身上 | `workspace_files/*` 每个模块自带自己的 `#[tauri::command]`；`commands.rs` 已经是 4000 行的杂物袋，运营台账自成一个模块更贴既有做法 |
| `ops/state.json` 与 `ops/assets/` 各自做组件级路径判断 | 两者都走 `path_safety::resolve_inside_workspace` | 它已经是工作区路径的单点出口（拒 `Prefix`/`RootDir`/`ParentDir` 越界 + 词法越界），再造一套组件判断就是第二份规则 |
| —— | 额外加一条：**`ops/` 或 `ops/state.json` 是 symlink 就拒绝读写** | 词法解析挡不住「目录本身是链接」；不挡的话一次写就能把台账打到工作区外面 |
| `assets[].topicId` 必填 | 改成可空 | 手动导入的稿件是常见起点，不该被迫先建一条选题才能记 |
| —— | 枚举 parity 落到 Rust 的 `include_str!` 单测上 | 读 `src/shared/ops.ts` 的枚举数组字面量，逐个核对 Rust 侧的值；改 TS 枚举不同步改 Rust，这条单测会红 |

**顺手修的一处**：clippy 硬闸（`cargo clippy --all-targets -D clippy::disallowed_methods`）在本次开工前**就是红的** —— `build.rs` 用裸 `std::process::Command::new` 起 node，两个 sidecar 测试辅助函数同样如此。build script 是独立 crate，够不到 `crate::process_cmd::new()`，逐行放行并写明理由；另两处改走封装。闸门不打开，新的违规会被旧违规淹没。

### Phase 3 · 管理 API + CLI（约 3h）

| 层 | 内容 |
|---|---|
| Rust | `management_api.rs` 加 `/api/ops/read`、`/api/ops/upsert`、`/api/ops/delete`（`workspace` 必填，路径在 Rust 侧校验） |
| Sidecar | `src/server/admin-api.ts` 加 `handleOpsRead/ Upsert/ Delete`，转发用现成的 `managementApi()`；`index.ts` 的 route 分发加 `ops/*` |
| CLI | `src/cli/hamuna.ts` 加 `hamuna ops list\|add\|update\|remove` |
| 验证 | 手动跑通：`hamuna ops list` → `add` → `list` 见到 → `update` → `remove`。写入后 `ops/state.json` 是合法 JSON 且人类可读 |

**坑**：CLI 改动 MUST bump `CLI_VERSION` 并同步 `bundled-skills/hamuna-cli/SKILL.md` + `SYSTEM_SKILLS_VERSION`，否则用户的 CLI 不更新。

**落地记录（Phase 3 完成后补）**：

| 原计划 | 实际 | 为什么 |
|---|---|---|
| 写接口发完整实体 | 发**补丁**，只带这次改的字段 | 完整实体要求调用方先读一遍再回写，那正是三个写者最会踩的 read-modify-write 竞态。补丁让「只改播放量」在文件锁内完成合并，调用方不必知道其余字段长什么样 |
| 写接口返回状态快照 | 额外回传 `id` | id 是 store 造的，调用方造不出来。不回传就得写完再 list 一遍去找自己刚建的那条 |
| CLI 缺省 `--workspace` 取 `process.cwd()` | 缺省不传，由 Sidecar 按 session 上下文解析 | `process.cwd()` 是 Agent 子进程的 cwd，不是用户的工作区；而且在 Chat 里 Agent 的 cwd 可能与工作区不同。缺省交给 Sidecar 才和 `cron`/`task` 的口径一致 |
| 只支持 `ops add topic` | 两种词序都收（`ops topic add`） | Agent 写命令时词序不固定，多认一种顺序比让它失败重试便宜 |
| —— | `style` 不在 CLI 暴露 | 风格档案是面板独有的单条记录，没有脚本化的场景；加进去就是没人用的命令面 |
| —— | 加 `src-tauri/tests/ops_management_api.rs` | 只有 Rust 单测的话，「CLI 发的 JSON 字段名和路由长什么样」没人验；这份测试走真 axum + 真落盘，覆盖 patch 语义与嵌套 `metrics` 合并 |

**顺手修的两处**：

1. `OpsReview.metrics` 加 `#[serde(default)]` —— 刚投放还没数据是正常起点，缺 `metrics` 不该让整条记录反序列化失败。
2. `now_iso()` 改用 `to_rfc3339_opts(SecondsFormat::Millis, true)` —— 默认的 `to_rfc3339()` 输出 9 位小数（纳秒），ES 规范只认 3 位，V8 宽松解析而 WebKit 不保证；这个值最终喂给 macOS 渲染进程的 `new Date(...)`。单测 `timestamps_are_millisecond_precision` 钉住。

**手动 E2E 实测结果**（真 Rust 管理 API + 真 Sidecar + 真 CLI，临时工作区）：`list`（空） → `add topic` → `list` 见到 → `update --status produced` → `add asset --body-file` → `add review --views/--likes/--comments` → `update review --views`（其余指标保留）→ `add rule --evidence-bar ×2` → `remove topic` → `list`。`ops/state.json` 是缩进过的合法 JSON，时间戳为 `2026-11-13T13:30:17.569Z`。错误路径也验了：未知平台 / 缺必填字段 / 缺 `--id` / 删不存在的 id / 未知动词，各自给出可读错误而非 panic。

### Phase 4 · Sino 模板 + 门控（约 3h）

| 项 | 内容 |
|---|---|
| 产物 | `agent-templates/sino/`：`CLAUDE.md`（人格 + 四域职责 + 只走 `hamuna ops` 不许手改 state.json）、`HEARTBEAT.md`、`.claude/rules/`、`.claude/skills/{ops-topic,ops-produce,ops-schedule,ops-review}/SKILL.md` |
| 注册 | `tauri.conf.json` 资源映射加 `"../agent-templates/sino": "sino"`；`PRESET_TEMPLATES` 加一条（`id: 'sino'`，`name: 'Sino'`，`isBuiltin: true`，heartbeat 默认开） |
| 门控 | `SINO_TEMPLATE_ID = 'sino'` 常量放 `src/shared/ops.ts`；`currentProject?.templateSource === 'builtin' && currentProject.templateId === SINO_TEMPLATE_ID` |
| 验证 | 从模板库能建出工作区；`ops/` 目录与空 `state.json` 初始种子就位；普通工作区 Chat 页不出现运营入口 |

**命名**：模板 id / 目录 / 显示名都是 `sino`（人格名，与 `mino` 同一套命名法）。**数据目录仍叫 `ops/`** —— 那是域的数据，不是某个 Agent 实例的私有物；换人格不该换数据路径。CLI 命令面同理仍是 `hamuna ops`。

**坑**：初始 `state.json` 必须是**合法空骨架**。UI 在文件不存在时要能渲染空态，不要靠"首次打开时创建"——那是第二个写者。

### Phase 5 · 前端面板（只读）（约 6h）

| 项 | 内容 |
|---|---|
| 产出 | `src/renderer/components/ops/`：`OpsPanel.tsx`（顶栏 + 域胶囊 + 四域外壳）、`OpsHero.tsx`、`OpsCard*.tsx`、`ops.css`（D 的样式，容器查询 760 / 400） |
| 接入 | `Chat.tsx` 加 `'ops'` 到 `splitActiveView` 联合类型；DirectoryPanel 头部加「运营」入口按钮；面板自带打开/收起 |
| 数据 | 直接 `invoke('cmd_ops_read', { workspace })`；监听 `ops:changed` 重新读；`workspacePathsEqual` 判 workspace 身份 |
| 验证 | 四域在 600px 与窄栏下切换无 console 错误、无溢出；字号只用 12/14/16/18/20/22/28；颜色只用 token；`npm run test:dom` 加一个 `OpsPanel.test.tsx`（空态 + 有数据两态） |

**坑**：
- 不许 `fetch` 到 sidecar —— 工作区数据走 invoke（红线：Launcher 没有 Sidecar）。
- 不许硬编码颜色 / 任意 px 字号（eslint 会拦）。
- `order` 只在容器查询里声明（`OPS-VIEW-UI.md` 已记录的坑）。
- 文案全部进 `i18n/locales/{zh-CN,en-US}/`，`resourceParity.test.ts` 会校验两边 key 一致。

### Phase 6 · 前端写入（约 4h）

| 项 | 内容 |
|---|---|
| 产出 | 选题/素材增删改、状态切换、排期设置、录入复盘数据、规则写回。统一走 `cmd_ops_upsert_*` |
| 交互 | 主操作按下即时回执（160ms）→ 进行中文案 + 禁用 → 成功 toast / 失败保留输入并提示 |
| 验证 | 写入后重新读回（刷新页面数据仍在）；写入失败时输入不丢；`npm run test:dom` 覆盖一次「保存成功」与一次「保存失败保留输入」 |

**坑**：乐观更新要能被 `ops:changed` 的权威读数覆盖，不要两套 state 各说各话。

### Phase 7 · 四个 skill（约 6h）

| skill | 干什么 | 落点 |
|---|---|---|
| `ops-topic` | 读热点 / 对标 → `hamuna ops add topic --hotness` | topics |
| `ops-produce` | 选题 → 素材，写正文/封面/分镜 → `ops update asset --progress` | assets |
| `ops-schedule` | 定 `scheduledAt` + `platform` | assets 的两个字段 |
| `ops-review` | 录表现数据 → 提炼规则 + `evidenceBars` | reviews + rules |

| 验证 | 在真工作区里从「一条选题」跑到「一条素材 + 排期 + 复盘 + 一条规则」，全程只有 `hamuna ops` 写盘 |
|---|---|

**坑**：skill 里不许出现"直接编辑 `ops/state.json`"的指令——这是 ADR 0002 的核心纪律，AI 一定会想抄近路。

### Phase 8 · HEARTBEAT + 热点/对标采集（约 5h）

| 项 | 内容 |
|---|---|
| HEARTBEAT | 两段：**采集**（手动触发，内嵌浏览器带登录态，只读创作者后台）与**反思**（可无人值守，读本地数据产规则） |
| 采集边界 | 只允许 web 搜索、平台公开热榜页、用户粘贴；禁止登录态深读他人账号、禁止代投放 |
| 验证 | 反思段在无人值守下能产出至少一条 `rules`；采集段在没有登录态时**主动跳过**而不是报错 |

---

## 四、验收清单（全量完成的定义）

1. 从模板库建出运营工作区 → Chat 右栏出现「运营」入口 → 四域都能渲染
2. 手动改台账 → 关掉面板再开，数据还在
3. Agent 跑一遍 `ops-topic → ops-produce → ops-schedule → ops-review`，面板在一次 turn 后自动刷到新数据（不用手动点刷新）
4. `grep -r "ops/state.json" src/ --include=*.ts | grep -v "ops_store\|admin-api\|shared/ops"` 为空 —— 没有旁路写者
5. `npm run typecheck && npm run lint && npm run test:unit && npm run test:dom && npm run test:integration` 全绿
6. `cargo clippy --all-targets -- -D clippy::disallowed_methods -D clippy::disallowed_macros` 无输出

---

## 五、不做

- 平台官方 API 接入（ADR 0003 已定：不存凭据）
- 代投放
- 客户端分析引擎（`evidenceBars` 由反思侧算好存下）
- 第二个模板复用运营视图的抽象（只有 `ops` 一个来源，等真出现第二个再说）

---

## 六、工时

| 阶段 | 估时 |
|---|---|
| Phase 1–3（数据 + Rust + CLI） | 10h |
| Phase 4–6（模板 + 面板 + 写入） | 13h |
| Phase 7–8（skill + heartbeat + 采集） | 11h |
| 合计 | **约 34h**，按每天 4–6h 有效推进算 6–8 个工作日 |
