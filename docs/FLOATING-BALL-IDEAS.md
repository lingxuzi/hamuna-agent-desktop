# Floating Ball: ideas and decisions

## Route chrome
- **Route:** 独立 Tauri 窗口（fb-ball / fb-companion / fb-shield）
- **Layout:** 无传统布局 — 浮窗系统
- **Header variant:** None
- **Footer variant:** None
- **Target layout strategy:** inherit (desktop-only)

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | 宠物精灵的动画风格 | 像素风 / 扁平风 / 3D | open | direction |
| 2 | Companion 窗口的尺寸和位置策略 | 贴 Ball 窗口右侧展开 | open | direction |
| 3 | Ball 窗口吸附边缘的行为 | 拖拽到屏幕边缘自动吸附半隐藏 | locked | — |
| 4 | 宠物状态映射（idle/running/blocked/done/error）的视觉差异 | 动画帧切换 + 颜色指示器 | open | variant |

## Page states

| # | State | Trigger | Renders | Dispatches | Exit | Status |
|---|-------|---------|---------|------------|------|--------|
| 1 | idle | 无任务 | PetSprite 空闲动画 | — | 点击/拖拽 | shipped |
| 2 | running | AI 执行中 | PetSprite 工作动画 | — | 完成 | shipped |
| 3 | blocked | 等待用户输入 | PetSprite 等待动画 + badge | — | 响应 | shipped |
| 4 | done | 任务完成 | PetSprite 完成动画 | — | 超时回 idle | shipped |
| 5 | error | 出错 | PetSprite 错误动画 | — | 点击查看详情 | shipped |
| 6 | companion-peek | hover Ball | CompanionWindow 半透明 | — | 移开鼠标 | shipped |
| 7 | companion-pin | 点击 Ball | CompanionWindow 完全展开 + 键盘焦点 | — | 点击外部 | shipped |

## Design variations

### Variation A — "可爱宠物风"
圆润的宠物精灵，丰富的表情动画，Companion 窗口用圆角毛玻璃效果。偏可爱/趣味。

### Variation B — "极简助手风"
几何化的图标，微妙的状态动画，Companion 窗口用简洁的深色面板。偏专业/克制。

## Direction chosen — 2026-08-05

**方向**: Glass Workshop × Paper Terminal（详见 `docs/DESIGN-HEURISTICS.md`）

**Floating Ball 方向指引**:
- 宠物精灵风格：介于可爱与极简之间——几何化的有机形状，自然色系
- Companion 窗口：暖色毛玻璃面板，与主窗口视觉一致
- Ball 窗口像"放在桌角的小物件"——有存在感但不打扰

## Design rationale — 2026-08-05

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- `[final] Sidebar/TabBar — A (u9fa6)` / `[final] Launcher — qjQtx` — 色彩、毛玻璃、字阶语言延续；Floating Ball 是独立浮窗（fb-ball/fb-companion/fb-shield），不共享主窗口 TabBar，顶部 chrome 不适用。
- shipped 基线 page states（7 态：idle/running/blocked/done/error/companion-peek/companion-pin）。

### Variants generated
- **A: 可爱宠物风（桌角小物）** — 桌面舞台 + 右侧吸附胶囊球（天空蓝圆脸 + 五态表情「· · / ◔ ◔ / … / ✓ / !」+ 状态徽章）+ 暖色毛玻璃 Companion 面板（小助理头像 + 当前任务进度条 + 三行任务队列 + 暂停/查看操作）。顶部五态图例完整映射 decision #4（表情帧 + 颜色指示器双通道）。落地 decision #2（贴 Ball 右侧展开）。
- **B: 极简助手风（几何浮标）** — 深色玻璃 Companion（完成态「✓ 已完成 3 项任务」+ 新任务按钮）+ 六边形几何浮标 + 圆角卡片浮标 + 三色状态 dot。为 decision #1（几何化 vs 有机）与 #4（克制色点 vs 表情动画）提供对比选项。

### 对照结论与选定
- decision #1 方向指引「几何化的有机形状」+ 产品定位「桌角小物」：A 的圆脸有机形态直接契合；B 的纯几何浮标偏工具化，作为「宠物」缺乏情感锚点。
- decision #4 状态差异：A 用表情帧 + 颜色指示器双通道（五种状态肉眼可辨且保持可爱）；B 仅颜色 dot，blocked/error 区分弱。
- **选定：A（可爱宠物风）**，frame `zQxyc` 晋升 `[final]`，B `[deprecated]`（详见 `DESIGN-TAXONOMY.md` artifact-index）。
- **落地时从 B 带过**：① 深色玻璃 Companion 作为夜间/专注皮肤参考；② 完成态「✓ 已完成 N 项任务」简明汇报文案；③ 几何浮标作为「助手形态」（非宠物）设置选项参考。
- 落地时需：① 五态动画帧（当前是静态表情占位，A 只画了 running 态场景）；② Companion 窗口布局协议（peek 半透明 / pin 完全展开 + 键盘焦点）；③ decision #2「贴 Ball 右侧展开」位置策略；④ 正式 icon set。

## Next steps
1. ~~运行 `/design-agent 'design Floating Ball'` 生成具体设计变体~~
2. 落地实现 `[final] Floating Ball — A`，随后 /visual-qa
3. 实现五态动画帧与 decision #4 的状态切换逻辑
