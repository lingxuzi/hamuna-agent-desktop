# Design heuristics

HamunaAgent 的设计方向：**Glass Workshop × Paper Terminal** — 温暖工坊感 × 纸端精密感。

## Direction chosen

**Concept**: "Glass Workshop + Paper Terminal"（玻璃工坊 × 纸端）

**来源传统**:
- Scandinavian Design（温暖、自然材料、民主美学）
- Editorial / Magazine Layout（排版即视觉、留白有节奏）
- Japanese Ma（間）（负空间是积极的存在）
- Dieter Rams / Industrial Design（每个元素都有存在的理由）

**核心隐喻**: 你坐在一个有温暖自然光的设计工作室里，桌上铺着几层半透明的描图纸，每层承载不同的工作内容。AI 的输出像"打印在纸上的终端"——精密但温暖。

**签名张力**: Terminal 的数据密度 × 纸张的阅读舒适度。信息密度高但不压迫，因为层次靠透明度而不是边框。

## Key design decisions

- **底色**：象牙/暖米色（不是纯白），暗色模式为深暖灰（不是纯黑），搭配微妙纸张纹理
- **面板层次**：毛玻璃（`backdrop-filter: blur`）+ 微妙纸张叠放阴影，创造功能性深度
- **Typography 三轨**：人文 sans-serif（UI 控件）+ 等宽（数据/代码/AI 输出）+ 衬线（页面级标题）
- **色彩**：自然色系低饱和度——苔藓绿、沙色、赤陶、天空蓝。暖灰阶梯做层级
- **密度**：稀疏有呼吸感，每个区域有足够留白
- **动效**：极克制——"呼吸"式过渡，几乎察觉不到，200ms 以内

## Texture profile

**Warm Glass + Paper Stack**（自定义融合）:
- 毛玻璃表面（`backdrop-blur`）用于功能面板，但底色是暖的（米白/浅杏）
- 面板之间通过微妙阴影和偏移创造"纸张叠放"层次感
- 数据密集区域（工具输出、Agent 状态）用等宽字体 + 结构化布局，被"放在"温暖的毛玻璃卡片里
- 纸张纹理作为微妙的背景质感（非装饰性，增加触感）

## Active settings

| Parameter | Label | Range | Rationale |
|-----------|-------|-------|-----------|
| DESIGN_VARIANCE | distinctive | 7-8 | 玻璃+纸张融合非常规，杂志风排版 |
| MOTION_INTENSITY | micro-only | 3-4 | 温暖但克制，仅 hover/状态反馈 |
| TYPE_CONTRAST | clear | 4-6 | 三轨字体清晰层级，不追求戏剧性 |
| COLOR_ECONOMY | restrained | 3-4 | 暖中性色 + 自然 accent，60-30-10 |
| GRID_DENSITY | sparse | 1-3 | 用户明确选择"稀疏·呼吸感" |
| PERSONALITY | warm | — | 用户明确选择"有温度的空间" |

## Anti-patterns (closed off)

以下风格 **绝对不要** 出现在 HamunaAgent 中：
- ❌ 赛博朋克 AI 风（暗色 + 霓虹 accent）
- ❌ 典型 SaaS（纯白 + 蓝色按钮 + 圆角卡片）
- ❌ IDE 密集风（VS Code / JetBrains 那种压迫感）
- ❌ 紫/蓝渐变白底
- ❌ Inter/Roboto 作为展示字体
- ❌ 一切居中
- ❌ 三个等宽卡片横排
- ❌ 纯黑文本
- ❌ 霓虹发光效果

## Conventions

- **深色模式是独立设计系统**，不是浅色模式的反转
- **所有视觉值追溯到 CSS Token**，无孤立 hex/px
- **圆角 8-12px**（结构感），不用 24px+（泡泡感）
- **字符宽度**：正文 45-75ch
- **4pt 基准单位**，间距 scale: 8/16/24/32/48/64/96px
- **`prefers-reduced-motion`** 强制支持
