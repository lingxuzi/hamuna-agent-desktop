# Design tokens

方向：**Glass Workshop × Paper Terminal**。详见 `DESIGN-HEURISTICS.md` 和 `DESIGN-LANGUAGE.md`。

> 具体 Token 值需与现有 Theme System（`tech_docs/theme_system.md`）对齐。
> 以下为方向指导值，实际实现时需确保与现有 CSS 变量体系兼容。

## Color

### Surface（底色）
| Token | Light | Dark | CSS variable |
|-------|-------|------|--------------|
| surface-primary | `#FAF8F5`（象牙暖白） | `#1E1D1B`（深暖灰） | `var(--surface-primary)` |
| surface-secondary | `#F5F2EE`（暖灰） | `#262422`（次深暖灰） | `var(--surface-secondary)` |
| surface-glass | `rgba(250,248,245,0.7)` | `rgba(30,29,27,0.7)` | `var(--surface-glass)` |
| surface-paper | `#FAF8F5` + subtle texture | `#1E1D1B` + subtle texture | `var(--surface-paper)` |

### Text（文本）
| Token | Light | Dark | CSS variable |
|-------|-------|------|--------------|
| text-primary | `#2D2A26`（暖墨色） | `#E8E4DF`（暖白灰） | `var(--text-primary)` |
| text-secondary | `#6B6560`（暖中灰） | `#9B9590`（暖浅灰） | `var(--text-secondary)` |
| text-tertiary | `#9B9590` | `#6B6560` | `var(--text-tertiary)` |

### Accent（强调色 — 自然来源）
| Token | Light | Dark | 来源 | CSS variable |
|-------|-------|------|------|--------------|
| accent-primary | `#7B8F6B`（苔藓绿） | `#9BAF8B` | 苔藓 | `var(--accent-primary)` |
| accent-warm | `#C4956A`（赤陶） | `#D4A57A` | 赤陶土 | `var(--accent-warm)` |
| accent-sky | `#7BA3B8`（天空蓝） | `#8BB3C8` | 天空 | `var(--accent-sky)` |

### Intent（语义色）
| Token | Light | Dark | CSS variable |
|-------|-------|------|--------------|
| intent-success | `#7B8F6B`（苔藓绿） | `#9BAF8B` | `var(--intent-success)` |
| intent-warning | `#C4A46A`（沙色） | `#D4B47A` | `var(--intent-warning)` |
| intent-error | `#B87B6B`（赤陶） | `#C88B7B` | `var(--intent-error)` |
| intent-info | `#7BA3B8`（天空蓝） | `#8BB3C8` | `var(--intent-info)` |

## Typography
| Token | Value | CSS variable |
|-------|-------|--------------|
| font-sans | system-ui stack | `var(--font-sans)` |
| font-mono | monospace stack | `var(--font-mono)` |
| font-serif | `'Playfair Display', 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', 'Times New Roman', serif`（衬线展示字阶，Launcher 杂志封面 hero / 设置页衬线页头；经 fonts.font.im 国内镜像加载，CSP 放行 `fonts.font.im` + `fonts.gstatic.font.im`） | `var(--font-serif-family)` → utility `font-serif` |
| text-2xs | 10px | |
| text-xs | 12px | |
| text-sm | 14px | |
| text-base | 16px | |
| text-lg | 18px | |
| text-xl | 20px | |
| text-2xl | 22px | |
| text-3xl | 28px | |

## Spacing
| Token | Value | CSS variable |
|-------|-------|--------------|
| <!-- 从现有 spacing scale 提取 --> | | |

## Radius
| Token | Value | CSS variable |
|-------|-------|--------------|
| <!-- 从现有 radius scale 提取 --> | | |

## Shadows
| Token | Value | CSS variable |
|-------|-------|--------------|
| <!-- 从现有 shadow scale 提取 --> | | |

## Motion
| Token | Value | CSS variable |
|-------|-------|--------------|
| duration-fast | 150ms | |
| duration-normal | 200ms | |
| ease-out | ease-out | |

## Grid
<!-- 桌面端布局，无列系统 -->

| Token | Value | Meaning |
|-------|-------|---------|
| sidebar-width | 260px | 侧边栏宽度（可折叠） |
| titlebar-height | 38px | 自定义标题栏高度 |
| tab-height | 36px | Tab 栏高度 |
| content-max-width | none | 内容区无最大宽度限制 |
