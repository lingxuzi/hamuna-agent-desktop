# HamunaAgent — Visual Layer Redesign

## Genre
Modern-minimal, warm paper twist. The app is a productivity tool, but the warm paper base gives it an editorial, tactile warmth — not cold, not sterile, not "yet another white SaaS".

## Theme (Custom)

### Palette
| Layer | Light | Dark | Role |
|---|---|---|---|
| Paper | `oklch(96% 0.012 70)` | `oklch(14% 0.008 60)` | Base surface |
| Paper-elevated | `oklch(98% 0.008 65)` | `oklch(18% 0.01 60)` | Cards, modals |
| Paper-inset | `oklch(90% 0.015 65)` | `oklch(12% 0.008 60)` | Inputs, code blocks |
| Ink | `oklch(22% 0.015 55)` | `oklch(92% 0.008 60)` | Primary text |
| Ink-secondary | `oklch(35% 0.018 50)` | `oklch(78% 0.01 60)` | Secondary text |
| Ink-muted | `oklch(50% 0.025 45)` | `oklch(60% 0.015 60)` | Muted text |
| Accent (primary) | `oklch(58% 0.12 45)` | `oklch(72% 0.12 45)` | Terracotta — CTAs, active states, focus rings |
| Accent-secondary | `oklch(55% 0.06 175)` | `oklch(68% 0.06 175)` | Teal — secondary actions, success signals |
| Line | `oklch(80% 0.015 60)` | `oklch(30% 0.01 60)` | Borders, dividers |
| Line-strong | `oklch(70% 0.02 55)` | `oklch(40% 0.015 60)` | Strong borders |

### Body background
Keep the radial gradient texture approach but simplify to one warmer source:
```
radial-gradient(1200px 700px at 85% -10%, oklch(78% 0.04 45 / 0.3) 0%, transparent 55%),
radial-gradient(900px 600px at -10% 110%, oklch(75% 0.025 175 / 0.2) 0%, transparent 50%),
var(--paper)
```
Texture overlay: `radial-gradient(ink 0.7px, transparent 0.7px)` at 20% opacity, multiply blend.

### Typography
Keep existing font stack (SF Pro / PingFang SC). No new font families.
- Display: 700 weight, `line-height: 1.1`
- Body: 400 weight, `line-height: 1.6`
- Mono: keep existing stack

### Radii
Keep existing radii (4/6/10/14/20/24/9999). No change.

### Shadows
Keep existing shadow system. No change.

### Motion
Keep existing "no third-party motion" stance. Use CSS transitions only (`--duration-fast: 150ms`, `--duration-normal: 200ms`, `--duration-slow: 300ms`).

## Macrostructure per page

| Page | Macrostructure | Rationale |
|---|---|---|
| Launcher | **Marquee Hero** | Brand entry — warm, centered hero with asymmetric supporting content |
| Chat | **Workbench** | Core workspace — tool surface, structured conversation |
| Settings | **Workbench** | Config surface — grouped sections, sidebar navigation |
| TaskCenter | **Workbench** | Task management — list/detail, progress indicators |
| Space | **Workbench** | Agent workspace — hybrid list/detail |

## Nav archetype
**N9 (Edge-aligned minimal)** — the app already uses a minimal top bar. Keep it edge-aligned, no full-bleed background, just the wordmark + actions.

## Structural changes per page

### Launcher
Current: 60/40 two-column (brand left, workspaces right).
New: **Marquee Hero** layout.
- Full-width hero area with centered brand statement + tagline + primary CTA
- Below: asymmetric content grid — featured workspace cards staggered left, recent activity or quick actions on the right
- Bottom: compact workspace grid or template gallery
- Keep the warm paper tone, but give the hero breathing room

### Chat
Current: standard chat layout.
New: **Workbench** layout.
- Top bar: minimal, just conversation title + actions
- Main area: full-height conversation thread
- Input area: grounded, with tool attachment strip
- Sidebar (optional): collapsible panel for context / tools / session info
- Keep the message bubble warmth, but add clearer visual hierarchy

### Settings
Current: sidebar navigation + content area.
New: **Workbench** layout.
- Keep the sidebar navigation pattern
- Group settings into visually distinct cards with clear section headers
- Use the accent sparingly — only for active nav items and primary toggles
- More breathing room between sections

### TaskCenter
Current: task list + detail.
New: **Workbench** layout.
- Task list with staggered card layout (not flat table)
- Detail panel on the right (or bottom on mobile)
- Progress indicators as subtle accent elements
- Status badges with minimal footprint

### Space
Current: agent workspace.
New: **Workbench** layout.
- Agent cards in a staggered grid
- Detail panel on the right
- Keep the warm paper tone, but add more visual structure

## Component tokens to add

### Section spacing
- `--section-gap: 32px` (between major sections)
- `--section-gap-lg: 48px` (between page-level sections)
- `--card-gap: 16px` (between cards in a grid)

### Card variants
- `--card-radius: var(--theme-radius-lg)`
- `--card-padding: 20px`
- `--card-shadow: var(--theme-shadow-sm)`
- `--card-shadow-hover: var(--theme-shadow-md)`

### Surface elevation
- `--elevation-base: var(--paper)` — 0
- `--elevation-raised: var(--paper-elevated)` — 1 (cards, dropdowns)
- `--elevation-overlay: var(--paper-elevated)` — 2 (modals, dialogs)
- `--elevation-tooltip: var(--paper-elevated)` — 3 (tooltips, popovers)

## Accent discipline
- Accent (terracotta) occupies **≤ 3%** of any viewport
- Use it for: active nav items, focus rings, primary CTA text/border, small decorative squares beside headings
- **Do not** fill large buttons with it
- **Do not** set entire sections on it
- Secondary accent (teal) for success indicators and secondary actions only

## Pre-emit critique
P5 H4 E5 S4 R5 V5