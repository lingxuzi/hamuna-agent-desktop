# HamunaAgent Desktop — 功能与产品特性清单

> **Slogan**：**自我进化的个人智能体**
> **产品**：HamunaAgent Desktop（v0.3.221 · 开源 Apache-2.0 · macOS / Windows / Linux）

---

## 1. 产品特性（面向用户）

| # | 特性 | 一句话说明 |
|---|------|----------|
| 1 | **桌面原生应用** | 不是网页、不是 IDE 插件——是装在电脑里的独立 App（macOS / Windows / Linux） |
| 2 | **零环境依赖** | Node、Python、uv 全部打包好——装上就用，不需要你配 PATH |
| 3 | **持久 Session** | 会话永久保留，AI 不会"失忆"，可任意暂停/继续 |
| 4 | **多 Tab 并行** | 每个聊天页独立 Stable、独立上下文，互不干扰 |
| 5 | **全局可唤起** | 悬浮球 + 系统托盘 + 全局快捷键——任意界面随时叫出 AI |
| 6 | **桌面通知** | 任务完成主动推送提醒（无需打开 App） |
| 7 | **开机自启** | 后台常驻，电脑开机即在 |
| 8 | **多 IM 渠道** | 飞书 / 钉钉 / Telegram 都能挂你的 AI |
| 9 | **多模型支持** | Claude / 中国广电 / Codex / Gemini / OpenAI 兼容，同一会话可切换 |
| 10 | **多 Runtime 切换** | 内置 SDK / Claude Code / Gemini CLI / Codex CLI 自由切 |
| 11 | **22 个内置 Skills** | 写文档 / 做 PPT / 做 Excel / 跑量化 / 做营销 / 上网 / 下载……即开即用 |
| 12 | **MCP 工具扩展** | 3 个内置 + 无限自添加，接入任何第三方服务 |
| 13 | **定时任务** | 每天 9 点自动拉股票新闻 / 每周五整理收件箱 / 每月 1 号出报表 |
| 14 | **长任务 / Goal 模式** | 设一个"调研 10 家竞品"，AI 拆任务、多轮推进、定期 review |
| 15 | **本地知识库** | 文档自动建索引（jieba 中文分词 + pinyin + 图谱关系） |
| 16 | **直接操作电脑文件** | 读 / 改 / 创建你电脑上的文档、表格、图片、视频 |
| 17 | **云端备份（Cloud Space）** | 会话自动云端备份，换电脑接着聊；可建团队共享 Skill |
| 18 | **浏览器自动化** | 让 AI 自己开网页、点按钮、填表单、抢票、抓数据 |
| 19 | **多媒体生成** | 输入文字生成 4-12 秒视频 / 图片 / 多图参考 / 图改图 |
| 20 | **跨平台一致体验** | macOS / Windows / Linux 三端功能对齐 |
| 21 | **i18n + 本地化托盘** | 中文 / 英文全栈，系统托盘语言跟随系统 |
| 22 | **多 Theme 主题系统** | 明 / 暗 + 多种配色预设 |
| 23 | **自动更新** | App + Skills 跟随版本自动升级 |
| 24 | **本地优先 / 数据不出端** | 敏感数据优先本地处理，可控再上云 |
| 25 | **三层长期记忆** | `hamuna-memory-{update,gardener,molt}` —— 用得越多越懂你 |
| 26 | **AI 自我进化** | `darwin-skill` —— AI 自动评估、改进自己的 Skill（用 AI 优化 AI） |
| 27 | **可量化策略开发** | A 股策略开发 / 回测 / 实盘一站式 |
| 28 | **学术研究方法论** | 文献综述、研究笔记、参考文献一键整理 |
| 29 | **写作系统** | 长篇结构 + 草稿 + 验收一体化 |
| 30 | **Office 四件套深度处理** | Word / Excel / PPT / PDF 都能读、能改、能生成 |

---

## 2. 功能清单（按能力维度）

### 2.1 写作与内容
- 长篇写作（大纲 → 草稿 → 审稿）
- Word / PDF / PPT / Excel 读改
- 学术综述与文献整理
- 文案 / 邮件 / 演讲稿

### 2.2 设计与创意
- 营销广告脚本
- 图片生成（文生图 / 图改图 / 参考图生图）
- 视频生成（4-12s 文生视频 / 关键帧 / 多图参考）
- 思维导图 / 流程图 / 数学公式 / 关系图谱

### 2.3 数据与投资
- 股票行情 + 新闻实时查询
- A 股量化策略开发 / 回测 / 实盘
- Excel 财务对账 / 数据清洗 / 复杂公式
- 批量数据整理

### 2.4 浏览器与下载
- 让 AI 自己上网（点按钮、填表单、截图、抓数据）
- 全网资源下载（视频 / 音乐 / 论文 / 软件 / 网盘）

### 2.5 自动化与定时
- 表达式 cron / 自然语言 cron / 心跳间隔
- 长任务 / Goal 协同多轮推进
- 持久化跨重启

### 2.6 IM 机器人
- 飞书 / 钉钉 / Telegram 三平台
- 群聊自动回复 / 私聊客服值班
- 主动推送消息
- 一个大脑多渠道复用

### 2.7 知识库（KB）
- TypeGraph 关系图谱 + Tantivy 全文搜索
- jieba 中文分词 + pinyin 索引
- 工作区文件自动入图 KB
- d3 力导向图可视化
- LLM 关系抽取

### 2.8 文件与工作区
- Tauri 原生 invoke 读 / 改 / 创建本地文件
- 唯一 `useWorkspaceFileService()` 入口
- 路径安全 chokepoint 防越权
- 双向 workspace ↔ KB 挂载

### 2.9 桌面集成
- 全局快捷键（macOS Carbon / Windows RegisterHotKey / Linux X11）
- 系统托盘（含中文 / 英文本地化）
- 开机自启
- 桌面通知 + Badge
- 悬浮球 / 浮动窗口

### 2.10 Provider / Runtime 切换
- Anthropic（Claude Sonnet / Opus / Haiku）
- 中国广电 Token（nxgd，零登录免费，首选）
- OpenAI 兼容（Chat Completions / Responses API）
- xAI / Anthropic / Codex / xAI Subscription（OAuth / Cookie）
- Claude Code / Codex / Gemini CLI（外部 Runtime）
- 同会话内可切换

### 2.11 Skills 生态
- 22 个内置 Skills（详见下表）
- System Skills 强制更新（产品能力保证）
- Utility Skills 用户级可定制
- `skill-creator` / `tool-creator` / `prompt-writer` 元能力——AI 自己写 Skill

### 2.12 云端协作
- Supabase Session E2E 备份
- 永久免费层
- Space Issue / Space Skill / Registered Agent 三类协作对象
- SSE relay 跨设备同步会话

---

## 3. 22 个内置 Skills 一览

### System Skills（系统级 · 强制更新）

| Skill | 作用 |
|-------|------|
| `hamuna-cli` | 产品能力总入口——AI 通过 CLI 直接执行所有产品能力 |
| `hamuna-docs` | 产品使用知识库 + 用户可见行为说明 |
| `hamuna-memory-update` | 三层长期记忆——增量巩固 |
| `hamuna-memory-gardener` | 三层长期记忆——整理 |
| `hamuna-memory-molt` | 三层长期记忆——进化 |
| `darwin-skill` 2.0 | **AI 自我进化**——9 维评分 + paired 比较 + keep/revert 棘轮 |
| `marketing-ad-skill` | 营销广告全链路 |
| `hatch-pet` | 桌面宠物（Hatch 系列） |

### Utility Skills（用户级 · 可自定义）

| Skill | 作用 |
|-------|------|
| `hamuna-writing-system` | 长篇写作系统（结构 + 草稿 + 验收） |
| `hamuna-strategy-v2` | A 股 akquant 0.3.x 量化策略 |
| `agent-browser` | 浏览器自动化（截图 / 表单 / 点击 / 抓取） |
| `download-anything` | 全网资源下载 |
| `research` | 学术 / 行业研究方法论 |
| `grilling` | 决策压力测试（多轮 frontier 提问） |
| `docx` | Word 深度处理 |
| `pdf` | PDF 深度处理 |
| `pptx` | PPT 深度处理 |
| `xlsx` | Excel 深度处理 |
| `prompt-writer` | 元能力——写 prompt |
| `tool-creator` | 元能力——写工具 |
| `skill-creator` | 元能力——写 Skill |
| `task-alignment` | 任务对齐 workflow |
| `task-implement` | 任务实现 workflow |

---

## 4. 3 个内置 MCP 工具

| MCP | 作用 |
|-----|------|
| `stock-datasource` | 股票行情 + 新闻（HTTP） |
| `mobile-control` | 手机运营控制（控制手机执行） |
| `multimedia-creator` | Agnes 视频 / 图片生成 |

支持用户自添加任意 stdio / HTTP / SSE MCP。

---

## 5. 核心差异化

| 维度 | HamunaAgent | 普通 ChatGPT 网页 | Claude Code 官方 |
|------|-------------|------------------|-----------------|
| 形态 | **桌面 App** | 浏览器 | 命令行 / IDE |
| 永久上下文 | ✅ 持久 Session | ❌ 刷新丢 | ✅ |
| 操作本地文件 | ✅ | ❌ | ✅ |
| 内置 Skills | ✅ **22 个** | ❌ | ❌ |
| 内置 MCP | ✅ **3 个 + 扩展** | ❌ | ✅ |
| IM 机器人 | ✅ **三平台** | ❌ | ❌ |
| 定时任务 | ✅ | ❌ | ❌ |
| 长任务 / Goal | ✅ | ❌ | ❌ |
| 本地知识库 | ✅ | ❌ | ❌ |
| 多 IM / 多 Runtime / 多 Provider | ✅ | ❌ | ❌ |
| 中文支持 | ✅ **一等** | ⚠️ | ⚠️ |
| 桌面原生（Tauri） | ✅ | ❌ Electron | ❌ |
| 开源 | ✅ Apache-2.0 | ❌ | ❌ |
| 自我进化 | ✅ `darwin-skill` | ❌ | ❌ |

---

## 6. 自我进化的具体表现

| 维度 | 怎么进化 |
|------|---------|
| **记忆层** | `hamuna-memory-{update,gardener,molt}` 三层机制——聊越多越懂你 |
| **Skill 层** | `darwin-skill` 自动评估 + 改进 Skill——用 AI 优化 AI |
| **写作层** | `hamuna-writing-system` 长篇结构化 + 自动审稿 |
| **知识层** | 本地 KB 自动建索引 + 关系抽取——文档越多越能"联想" |
| **策略层** | `hamuna-strategy-v2` 量化策略迭代 |
| **Skill 自创** | `skill-creator` / `tool-creator` / `prompt-writer`——AI 自己写新能力 |

---
