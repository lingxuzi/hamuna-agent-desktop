# Settings: ideas and decisions

## Route chrome
- **Route:** /tab/:id (settings view)
- **Layout:** Sidebar + Content（左侧导航 + 右侧设置面板）
- **Header variant:** Custom title bar（全局 Sidebar/TabBar ChromeBar：Logo + NavCluster 4 全局导航 + TabsGroup「设置」Tab + UpdateBtn + 窗口控件）
- **Footer variant:** None
- **Target layout strategy:** inherit (desktop-only)

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | 左侧导航是否可折叠 | 固定不折叠（11 个分区需要常驻可见） | open | direction |
| 2 | 设置分区是否使用独立页面还是锚点滚动 | 独立面板切换 | locked | — |
| 3 | 是否需要搜索设置项 | 待定 | open | variant |
| 4 | Provider 管理的交互模式 | 卡片列表 + 展开详情 | open | direction |

## Page states

| # | State | Trigger | Renders | Dispatches | Exit | Status |
|---|-------|---------|---------|------------|------|--------|
| 1 | general | 默认分区 | 语言、启动、外观、代理设置 | — | 切换分区 | shipped |
| 2 | providers | 切换到 Provider 分区 | Provider 卡片列表 + 添加/编辑 | — | 切换分区 | shipped |
| 3 | mcp | 切换到 MCP 分区 | MCP 服务器列表 + 预设/自定义 | — | 切换分区 | shipped |
| 4 | about | 切换到关于分区 | 版本、开发者模式、日志、Bug 报告 | — | 切换分区 | shipped |

## Design variations

### Variation A — "经典设置"
左侧窄导航栏（图标 + 文字），右侧大面积内容面板。类似 macOS 系统设置。

### Variation B — "标签页设置"
顶部水平标签页（11 个分区），内容在下方。节省横向空间，但标签数量多可能拥挤。

## Design rationale — 2026-08-05

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- `[final] Sidebar/TabBar — A (u9fa6)` — 38px 融合 ChromeBar（LogoMark + 设置 Tab pill + 更新按钮 + 窗口控件）沿用为两个变体的顶部 chrome。

### Variants generated
- **A: 经典设置（侧边导航）** — 232px 左侧导航（11 个真实分区 + 连接/运行时/其他分组头 + 底部版本号，macOS 系统设置心智）+ 右侧内容面板（外观/网络/启动分组，复用 Segmented / SelectField / Toggle 控件）。落地 decision #1（11 分区常驻可见）。
- **B: 标签页设置** — 顶部 44px 标签栏横排 11 分区 + 搜索框，内容双列（Provider 卡片流 1016w + 右侧密钥安全提示卡 320w）。搜索落地（decision #3）+ 双列布局是亮点。

### 对照结论与选定
- A 与 decision #1（11 分区需常驻可见）直接契合——侧边导航是 11 分区场景的最优形态；B 的顶部标签 11 个偏多，本地化变长时拥挤。
- **选定：A（经典设置）**，frame `cTjk2` 晋升 `[final]`，B `[deprecated]`（详见 `DESIGN-TAXONOMY.md` artifact-index）。
- **落地时从 B 带过**：① 搜索设置项（A 顶栏加搜索框）；② 双列 Provider 卡流布局（Provider 分区落地时用）；③ 「添加供应商」主行动。

## Review — 2026-08-05

逐页 review 轮次修复，全部写入 `cTjk2`：

1. **ChromeBar 同步定稿（u9fa6）** — 原实现为「Simplified」头部（返回按钮 + 标题），与定稿 Sidebar/TabBar 的融合 ChromeBar 不一致。已重建为全局 chrome：LeftCluster（LogoMark + NavCluster 4 全局导航 26×26 + TabsGroup「设置」Tab pill + NewTabBtn）+ RightCluster（UpdateBtn 26×26 + WinControls 30×28）。窗口控件 glyph 语义沿用定稿（Min/Max `$text-tertiary`、Close `$intent-error`）。
2. **图标统一（react-icons）** — 全局指令：所有字符 glyph 占位统一替换为 react-icons。设计端用 Pencil 原生 lucide Icon 节点，`context:"react-icons:lu:LuXxx"` 记录实现映射。ChromeBar 5 处（layout-grid/list-checks/orbit/settings/plus）+ NavSidebar 11 处（sliders-horizontal/keyboard/server/cable/sparkles/bot/puzzle/user-round-cog/bar-chart-3/heart/info）共 16 处已替换。项目当前未安装 react-icons，落地时需新增依赖。
3. **渲染验证** — 整帧截图 `design/qa/cTjk2.png`（2880×1800 scale 2）确认：NavCluster 4 图标横向排布于 Logo 与「设置」Tab 之间且垂直居中、窗口控件右缘贴齐 1438、NavSidebar 图标正常、无 y-offset 错位。

### Review 第二轮 — 2026-08-05

逐页 review 第二轮的修改，全部写入 `cTjk2`：

1. **NavSidebar 去图标** — 11 个 lucide 图标全部删除，改为纯文字导航。原因：图标大小不一（14×14 但字形视觉重量参差），去掉后更干净统一。活动项仍用 `$accent` 填充 + `$on-accent` 文字，其余 `$text-secondary`。
2. **设置行左右对齐** — 5 行设置项（外观模式 / 界面语言 / 代理设置 / 启动时打开 / 后台运行）改为 `justifyContent: space_between`：label + desc 左对齐、控件（Segmented / SelectField / Toggle）右对齐，贴合 macOS 系统设置惯例。
3. **右侧「眼前一亮」** — ContentPanel 顶部新增 Hero 欢迎横幅（160px）：accent 双色渐变（#7B8F6B → #5E7152）+ 白色标题/副标题 + 右侧环形进度「60%」+ 白色「继续配置」pill 按钮，作为设置页视觉锚点，打破纯表单单调。
4. **渲染验证** — 整帧截图 `design/qa/cTjk2.png` 确认：图标删除后导航干净、设置行控件右对齐、Hero 渐变横幅渲染正常、无布局溢出。

**遗留（留给实现时）**：① 搜索设置项（decision #3 open，落地时从 B 带过）；② Provider 分区双列卡流 + 「添加供应商」主行动（decision #4 open）。

### Review 第三轮 — 2026-08-05

参考 `c:\Users\hmcz\Pictures\捕获.PNG`（分组卡片式设置页）重新设计右侧设置内容排版，**主体配色保持不变**（$paper / $accent / $ink）：

1. **分组升级为 elevated 卡片** — 三个 Group（外观/网络/启动）从裸分组改为 `$paper-elevated` 底 + `cornerRadius 14` + 阴影（#00000010 18px），贴近参考图的浅色卡片网格。
2. **每行加「圆角色块图标」左列** — 5 行设置项（外观模式/界面语言/网络代理/开机自启动/启动到托盘）各新增 40×40 `$accent` 圆角色块（cornerRadius 10），内嵌 lucide 图标（monitor / languages / globe / rocket / panel-bottom），图标 + 标题 + 描述左对齐、控件右对齐，完全对齐参考图的行内图标 + 双行文字结构。
3. **图标映射** — 5 处新 lucide Icon 均记录 `context:"react-icons:lu:LuMonitor"` 等实现映射，落地时用 react-icons（`lu-react-icons` 同名）。
4. **渲染验证** — 整帧截图 `design/qa/cTjk2.png` 确认：卡片阴影/圆角正常、5 个图标色块渲染正常、控件右对齐、Hero 保留、无布局溢出。

**遗留（留给实现时）**：① 搜索设置项（decision #3 open，落地时从 B 带过）；② Provider 分区双列卡流 + 「添加供应商」主行动（decision #4 open）。

## Design rationale — 2026-08-05（内容页布局方向）

### 背景
用户反馈：设置各子页内容页与原始 896px 窄卡片堆叠「差别不大」，询问有没有更好的方向。根因：9 个子页复用 `Content(1232) > XxxContent(896) > cards` 结构，全部是窄列卡片堆叠——与 GRID_DENSITY sparse (1-3) + DESIGN_VARIANCE distinctive (7-8) 相悖，也是「千篇一律」的来源。

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- `[final] Settings — A (cTjk2)` — 既有整体设置页（衬线页头 + NavSidebar + `$accent` 活动态），三个变体复用其 chrome 与控件语言（Segmented / SelectField / Toggle），内容清单与 SettingsPage 1:1。
- ChromeBar 沿用定稿 `u9fa6`。

### Variants generated（proposal group `gv2Uy`）
- **A: 分组工作台 (IFfik)** — Tabs + 双列卡片网格。SectionTabs（外观/启动/队列/通知/代理 5 pills）+ 双列 570px SettingCell（图标块 + 标题 + 描述 + 控件右对齐，共 8 项）。布局模式：选项卡 + 双列卡片网格。最接近现状，安全但独特度最低，双列对称偏静态。
- **B: Bento 卡片 (t2DE7F)** — 不等尺寸瓦片：外观 776w + 启动 392w / 队列 584w + 工作区 584w。每卡：图标头 + 1px 分隔线 + 紧凑行（图标 + 标签 + 值 + 控件）。布局模式：Bento Grid。打破「三等宽卡片」AI 反模式，匹配 DESIGN_VARIANCE 7-8；密度随设置项增长会变挤。
- **C: 表格式 (kOMZn)** — 设置项数据化：单列 `$paper-elevated` 表卡，4 组（外观/启动/队列/工作区）uppercase 小节头 + 8 数据行（图标 14 + 标签 200w + spacer + 控件：Select 值+caret / Toggle 34×20），1px `$line` 行分隔线。布局模式：分组数据表。与现状差异最大、可扩展性最好（设置增多=加行，布局不变）；表格式偏「sharp」、需靠 46px 行高与分组保持 warmth。

### 对照结论（critique 摘要）
- 三个变体均通过 AI-slop 门禁（无三等宽卡/居中/紫蓝渐变）；token 合规、衬线页头一致。
- 与主动 taste 设定对齐度：B（warm + distinctive 7-8）最贴合；C（distinctive 7-8 + 扩展性）最直接回答「差别不大」；A 最保守但最不解题。
- 冲突点（呈给用户，不代决）：C 的表格行分隔形态偏「sharp」，与 PERSONALITY warm 有轻微张力——靠行高/分组舒缓；A 双列对称与 DESIGN_VARIANCE 7-8 有张力。

### 选定（2026-08-05）
- **选定 B：Bento 卡片**。理由：最贴合 DESIGN_VARIANCE 7-8 + PERSONALITY warm；不等尺寸瓦片打破「三等宽卡片」AI 反模式；是三个方向中视觉最有记忆点、最像"为产品精心设计"的一个。
- 原子晋升：`t2DE7F` → `[final] Settings Content — B: Bento 卡片`（sync: Not started）；`IFfik` A / `kOMZn` C → `[deprecated]`。`cTjk2`（Settings 整页 final）保留，其内容区窄卡片堆叠在实现 Bento 时被替换。
- 遗留（留给实现）：瓦片高度随设置项行数自适应；>12 项时 Bento 并入滚动；落地到各子页时先「外观」页，验证后铺开。

### 修订 — 2026-08-05（用户反馈）

用户反馈「模型供应商 / 工具箱 / 插件三页卡片大小不一致」，三页（providers JW6Ha / mcp KB8c4 / plugins jz3RU）由不等宽 Bento 瓦片改为 **2×2 等宽规则 grid**（每卡 584×584、gap 16、行内 spacer 改 `fill_container` 自适应右对齐）。Bento 方向（t2DE7F）在其余 7 页保留。

## Next steps
1. ~~决定导航形式（侧边 vs 顶部标签）~~（选定侧边）
2. ~~Provider 管理的卡片设计~~（B 已画 Provider 卡流，落地时参考）
3. **待决策：内容页布局方向 A/B/C（见上方 rationale，decision open）**——选定后原子晋升并落地
4. 落地实现 `[final] Settings — A`，随后 /visual-qa
