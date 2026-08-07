# Design language

方向：**Glass Workshop × Paper Terminal** — 温暖工坊感 × 纸端精密感。详见 `DESIGN-HEURISTICS.md`。

## Typography — 三轨系统

- **UI 控件**：人文 sans-serif（`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`）
- **AI 输出 / 代码 / 数据**：等宽字体（`"JetBrains Mono", "Fira Code", "Cascadia Code", monospace`）
- **页面级标题**：衬线字体（`"Georgia", "Noto Serif", "Source Serif", serif`）— 仅用于 Launcher hero、Settings 标题等少数场景
- **字阶**：固定七档（12/14/16/18/20/22/28px），对应 `text-xs/sm/base/lg/xl/2xl/3xl`
- **层级策略**：通过 weight + size + 字体家族的组合建立清晰的三层信息层级
- **标题与正文**：标题用 600-700 weight，正文 400 weight，行高 1.5-1.6
- **字符宽度**：正文 45-75ch，大标题收紧 letter-spacing（-0.02em to -0.04em）
- **AI 输出文本**：绝不用纯黑，使用 `#2D2A26`（暖墨色）或 `--text-primary`

## Color strategy — 自然色系

- **底色**：象牙/暖米色（Light: `#FAF8F5`），暗色模式为深暖灰（Dark: `#1E1D1B`），不是纯白/纯黑
- **中性色阶梯**：暖灰系（tinted warm），不使用纯灰
- **语义色（自然来源）**：
  - 苔藓绿 → success/active
  - 沙色 → warning
  - 赤陶/赭石 → error/urgent
  - 天空蓝 → info/neutral-accent
- **色彩克制**：60-30-10 法则——60% 暖中性底、30% 次要层、10% 自然色 accent
- **深色模式**：独立设计系统，不是浅色模式反转。暖深灰底 + 柔和的自然色 accent
- **语义四层**：surface / text / accent / intent，所有 Token 有 Light / Dark 双值
- **主题系统**：支持自定义主题包，通过 runtime CSS Token 注入

## Layout principles — 稀疏呼吸感

- **侧边栏 + 内容**：主导航模式，左侧窄边栏（可折叠），右侧为主内容区
- **Tab 系统**：Chrome 风格多标签，每个 Tab 独立会话/视图
- **Overlay 分层**：模态 / 面板 / 浮层三级 z-index 层级，`useCloseLayer` 统一管理
- **内容密度**：稀疏有呼吸感——每个区域有足够留白，不追求信息密度最大化
- **面板层次**：毛玻璃（`backdrop-filter: blur`）+ 微妙纸张叠放阴影，创造功能性深度
- **圆角**：8-12px（结构感），不用 24px+（泡泡感）
- **4pt 基准单位**，间距 scale: 8/16/24/32/48/64/96px
- **纸张纹理**：微妙的背景质感（非装饰性），增加触感

### Target layout strategy
desktop-only

## Interaction philosophy — 安静温暖

- **即时反馈**：所有可交互元素有 hover/active/focus 状态
- **流式更新**：AI 回复实时流式渲染，工具调用过程实时展示
- **安静动画**：过渡动画 ≤ 200ms，使用 `cubic-bezier(0.16, 1, 0.3, 1)`（ease-out-quart），不使用弹跳/弹性动画
- **渐进披露**：高级功能默认隐藏，通过显式操作展开（折叠面板、更多菜单）
- **`prefers-reduced-motion`**：强制支持，35% 的 40 岁以上成年人受影响
- **只动画 `transform` 和 `opacity`**，永远不动画布局属性
