# Style Guide — HamunaAgent visual contract

> **Authority:** This file describes the visual language of `src/renderer/`. It is derived from real shipped code in `src/renderer/pages/**` and `src/renderer/components/**`.
>
> **Use this file** for any new feature that targets `src/renderer/pages/...` — including the **Employees Panel + Meeting Room** (`src/renderer/pages/space/agents/` + future `meeting-room/`).
>
> Owner: code. Edit on visual drift only — update the source code or update both sides.

## 1. Surface & background

| Element | Token (light) | Token (dark) | CSS class pattern |
|---|---|---|---|
| Page background | `--paper #faf6ee` | `--paper #1a1614` | `bg-[var(--paper)]` |
| Page gradient overlay | `--paper-elevated → --paper → color-mix(--paper 86%, --paper-inset)` | same | `style={SPACE_BACKGROUND_STYLE}` |
| Paper grid texture (24px) | `--line-subtle` lines on `--paper-a0` (alpha=0) | same | `style={PAPER_GRID_STYLE}` at `opacity-20` with mask gradient `linear-gradient(to bottom, transparent 0, #000 120px, #000 calc(100% - 120px), transparent 100%)` |
| Card / panel | `--paper-elevated #fffcf7` | `--paper-elevated #242018` | `bg-[var(--paper-elevated)]` |
| Inset region (sub-card, filled field, divider) | `--paper-inset #e8dccf` | `--paper-inset #12100e` | `bg-[var(--paper-inset)]` |
| Hover (any list row) | `--hover-bg rgba(194,109,58,0.07)` | `--hover-bg rgba(194,109,58,0.12)` | `hover:bg-[var(--hover-bg)]` |

`SPACE_BACKGROUND_STYLE` and `PAPER_GRID_STYLE` are owned by `src/renderer/pages/space/spaceUi.ts`. Reuse them; do not invent new gradient overlays.

## 2. Typography (100% sans-serif; no Playfair in main pages)

| Role | Size / weight | Token | Where |
|---|---|---|---|
| Drawer header (h2) | `text-xl font-semibold leading-tight` | `--ink` | `AgentsWorkspace.tsx` agent detail drawer; `IssueDetailDrawer` body h2 uses `text-2xl` for issue title |
| Section title (h3) | `text-base font-semibold` | `--ink` | drawer sections, card group titles |
| Section title with icon | `text-base font-semibold` + 16px icon | icon `--ink-muted`, text `--ink` | drawer section h3 pattern |
| Body | `text-sm font-medium` or default | `--ink-secondary` / `--ink` | drawer body, field values |
| Label (input/form) | `text-sm font-medium` | `--ink` | form fields (above input) |
| Sub-label / hint | `text-sm` | `--ink-muted` | under input |
| Inline metadata | `text-xs font-medium` | `--ink-muted` | card fields, timestamps |
| Mono (id / path / device id) | `font-mono text-xs` | `--ink-muted` / `--ink-subtle` | `AgentCard` workspace path, `AgentDetailRow` `mono` flag |
| Pill / chip text | `text-xs font-semibold` | per pill below | status pill |
| Empty-state body | `text-sm` | `--ink-muted` | empty-state inside cards |

**Rule:** No `font-serif` / Playfair in `src/renderer/pages/`. Playfair Display is only used for Launcher hero and Settings hero (per `theme/themes/*.css` `--font-serif-family` + `tailwind.config.ts` `font-serif` utility). **Don't add serif headings to employee pages.**

## 3. Color (semantic roles)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ink` | `#1c1612` | `#e4dcd4` | primary text, headings |
| `--ink-secondary` | `#2e2825` | `#cfc5ba` | body text, emphasized values |
| `--ink-muted` | `#6f6156` | `#968a7e` | sub-text, hint |
| `--ink-subtle` | `#a69a90` | `#685c52` | icon, label, mono value muted |
| `--ink-faint` | `#c4b8ad` | `#4a4038` | rarely used |
| `--accent-warm` | `#c26d3a` | `#d4803f` | **single accent color** — primary button bg, focus border, brand mark |
| `--accent-warm-hover` | `#e18a58` | `#e89860` | primary button hover |
| `--accent-warm-subtle` | `rgba(194,109,58,0.08)` | `rgba(212,128,63,0.12)` | selected nav item, hover list, active tab pill |
| `--accent-primary` | `#7b8f6b` | `#9baf8b` | moss green — secondary semantic accent (e.g. avatar presence green) |
| `--accent-cool` | `#2e6f5e` | `#4aad8a` | teal — not currently used in v1 chrome; available for status |
| `--accent-sky` | `#7ba3b8` | `#8bb3c8` | sky blue — not currently used in v1 chrome; available for status |
| `--button-primary-bg` | `#c26d3a` (alias of --accent-warm) | `#d4803f` | primary CTA |
| `--button-secondary-bg` | `#e8dccf` | `…` (theme-dependent) | secondary CTA |
| `--success` / `--success-bg` | `#2d8a5e` / `#e2f0e8` | `#4aad7a` / `rgba(74,173,122,0.15)` | status pill "online" |
| `--warning` / `--warning-bg` | `#d97706` / `#fef3c7` | `#f59e0b` / `rgba(245,158,11,0.15)` | status pill "connecting", banner |
| `--error` / `--error-bg` | `#dc2626` / `#fee2e2` | `#ef4444` / `rgba(239,68,68,0.15)` | delete CTA, validation |
| `--line` | `rgb(28 22 18 / 0.10)` | same | card border, drawer border, divider |
| `--line-subtle` | `rgb(28 22 18 / 0.06)` | same | section divider inside a card |
| `--line-strong` | `rgb(28 22 18 / 0.18)` | same | input border-strong (rare) |

**Rule:** the v1 page surface palette is **paper / ink / accent-warm** plus **green (presence) / amber (warn) / red (danger) status**. **Don't introduce Playfair Display, terracotta hex (`#C4956A`), moss-green hex (`#7B8F6B`), sky-blue hex (`#7BA3B8`), or the `intent-warning-soft` family — those are v2 docs that don't map to the live Theme CSS.** Use `--accent-warm`, `--accent-primary`, `--accent-sky`, `--success`, `--warning`, `--error` — every one of these already exists in the Theme CSS.

## 4. Radius (radix: rounded-xl cards, rounded-lg buttons, rounded-full pills)

| Element | Class | Why |
|---|---|---|
| Page surface / sidebar | none (square) | flat base |
| Card / panel / drawer | `rounded-xl` | v1 universal card radius |
| Special large card (empty-state placeholder) | `rounded-[20px]` (only when explicitly card-shaped empty) | Settings/Agents empty card uses this |
| Button | `rounded-xl` (primary CTA) / `rounded-lg` (secondary / destructive icon button) | drawer footer uses `rounded-xl px-4` |
| Input | `rounded-lg` | form field |
| Avatar | `rounded-xl` | 32 / 36 / 44 / 56 px |
| User avatar (Settings) | `rounded-full` | profile contexts only |
| Status pill | `rounded-md px-2 py-1` (chip) or `rounded-full` (badge) | depends on size |
| Tag (skill / role chip) | `rounded-md` | inline |

**Rule:** cap card radius at `rounded-xl`. **Do not** use `rounded-2xl` / `rounded-3xl` / 20px+ for product chrome — that's a v2 signature.

## 5. Shadows

| Element | Class / token | Why |
|---|---|---|
| Card rest | `shadow-none` (default) or `shadow-sm` on hover | hover is `hover:shadow-sm` |
| Dialog / drawer | `shadow-xl` | `EditAgentDialog`, `IssueDetailDrawer` |
| Overlay panel (menu, popover) | `shadow-md` | account menu, dropdown |
| Floating status bar | `shadow-lg backdrop-blur-md` | `AgentStatusPanel` panel |
| Disabled card | `opacity-60 saturate-50` | `AgentCard` `managementDisabled` |

**Rule:** shadows are reserved for floating layers (drawer, menu, panel) and hover lift. Cards at rest are flat. Backdrop blur is reserved for floating layers (`backdrop-blur-md` / `backdrop-blur-sm`).

## 6. Spacing (4 / 8 grid)

| Spacing | Tailwind | Where |
|---|---|---|
| 4px | `gap-1`, `p-1` | icon-only padding |
| 8px | `gap-2`, `p-2`, `px-2.5` | card field rows, account menu items |
| 12px | `gap-3`, `p-3`, `px-3.5` | card inner padding (`AgentCard` `px-3.5 py-3`) |
| 16px | `gap-4`, `p-4`, `px-5` | drawer section inner padding, card padding |
| 20px | `px-7 py-5` / `px-7 py-6` | drawer header / body padding |
| 24px | `gap-6` | section vertical gap |
| 32px | `gap-3.5` (sidebar) / `space-y-3` | page-level rhythm |

**Rule:** use Tailwind standard scale (`gap-2`, `gap-3`, `gap-4`, `gap-6`). Avoid arbitrary values like `[13px]`.

## 7. Component patterns (copy these, don't redesign)

### 7.1 Card (`AgentCard` is the canonical reference)

```tsx
<article className="group relative rounded-xl bg-[var(--paper-elevated)] px-3.5 py-3 text-left transition-[box-shadow,opacity,filter] hover:shadow-sm disabled:opacity-60">
  <button
    type="button"
    aria-label="…"
    className="absolute inset-0 z-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-warm)]/30"
  />
  <div className="pointer-events-none relative z-10 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
    {/* avatar | name + meta | menu */}
  </div>
</article>
```

- Whole-card-click is via the absolutely-positioned button + `pointer-events-none` on siblings
- `focus-visible:ring-2 focus-visible:ring-[var(--accent-warm)]/30` for keyboard focus
- Avatar size 36 / detail 56
- `disabled:opacity-60 saturate-50` for revoked/disabled

### 7.2 Status pill

```tsx
<span className={`rounded-md px-2 py-1 text-xs font-semibold ${
  online    ? 'border border-[var(--success)]/20 bg-[var(--success-bg)] text-[var(--success)]'
  : connecting ? 'border border-[var(--accent-warm)]/20 bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]'
  : 'border border-[var(--line-subtle)] bg-[var(--paper-inset)] text-[var(--ink-muted)]'
}`}>
```

### 7.3 Drawer header (agent detail, issue detail)

```tsx
<header className="sticky top-0 z-10 border-b border-[var(--line-subtle)] bg-[var(--paper-elevated)]/95 px-7 py-5 backdrop-blur-md">
  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
    {/* avatar | name + meta + status | action buttons + close */}
  </div>
</header>
```

### 7.4 Dialog header (edit / register / create)

```tsx
<div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
  <div>
    <h2 className="text-lg font-semibold text-[var(--ink)]">{title}</h2>
    <p className="text-sm text-[var(--ink-muted)]">{subtitle}</p>
  </div>
  <button className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]">
    <X className="h-4 w-4" />
  </button>
</div>
```

### 7.5 Dialog footer

```tsx
<div className="flex justify-end gap-2 border-t border-[var(--line)] px-5 py-4">
  <button className="h-10 rounded-xl bg-[var(--button-secondary-bg)] px-4 text-sm font-semibold …">
    Cancel
  </button>
  <button className="flex h-10 items-center gap-2 rounded-xl bg-[var(--button-primary-bg)] px-4 text-sm font-semibold …">
    Save
  </button>
</div>
```

### 7.6 Empty state card

```tsx
<div className="grid h-40 place-items-center rounded-[20px] border border-dashed border-[var(--line)] bg-[var(--paper-elevated)]/40 text-sm text-[var(--ink-muted)]">
  <div className="text-center">
    <Bot className="mx-auto mb-3 h-8 w-8 text-[var(--ink-muted)]" />
    <p>{emptyMessage}</p>
    {admin && <button>…</button>}
  </div>
</div>
```

### 7.7 Form input

```tsx
<input
  className="h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent-warm)]"
/>
<textarea
  className="min-h-28 w-full resize-y rounded-lg border bg-[var(--paper)] px-3 py-2.5 text-sm leading-6 text-[var(--ink)] outline-none transition-colors …"
/>
```

### 7.8 Card grid

```tsx
<div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
  {agents.map(agent => <AgentCard key={agent.id} … />)}
</div>
```

`SPACE_TWO_COLUMN_GRID_CLASS` is the canonical class for "agents, agent detail summary blocks, goals cards". Card collection uses `mx-auto max-w-6xl` (`SPACE_COLLECTION_FRAME_CLASS`).

### 7.9 Section title row (page header pattern)

```tsx
<section className="flex min-h-10 items-center gap-3">
  <div className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold text-[var(--ink-secondary)]">
    <Bot className="h-4 w-4 shrink-0" />
    <h2 className="truncate">Agents</h2>
    <span className="rounded-md bg-[var(--paper-inset)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
      {count}
    </span>
  </div>
  {admin && (
    <button className={SPACE_PRIMARY_TOOL_BUTTON_CLASS}>
      <Plus className="h-4 w-4" />{t('space.agents.register')}
    </button>
  )}
</section>
```

## 8. Layout containers

| Pattern | Class | Where |
|---|---|---|
| Page collection (max-width, centered) | `mx-auto max-w-6xl space-y-3` (`SPACE_COLLECTION_FRAME_CLASS`) | `AgentsWorkspace`, `GoalsWorkspace`, `SkillsWorkspace` |
| Page narrative (max-width) | `mx-auto max-w-4xl` (`SPACE_LIST_FRAME_CLASS`) | narrow reading list |
| Sidebar | `w-64 shrink-0 border-r border-[var(--line)] bg-[var(--paper)]/70 p-3.5` | `SpaceSidebar` |
| Two-column grid | `grid grid-cols-2 gap-3 max-lg:grid-cols-1` (`SPACE_TWO_COLUMN_GRID_CLASS`) | agents, summary blocks |
| Drawer right side | `w-[min(72vw,900px)] border-l bg-[var(--paper-elevated)] shadow-xl` | agent detail, issue detail |
| Dialog | `max-w-[720px] rounded-xl border bg-[var(--paper-elevated)] shadow-xl` | edit / register dialogs |
| Full-page surface | `h-full overflow-hidden bg-[var(--paper)]` + `SPACE_BACKGROUND_STYLE` + paper grid | `Space` top-level |

## 9. Iconography

- Library: `lucide-react` (`@/components/ui/DropdownMenu` and `lucide-react` imports across `src/renderer/pages/space/`).
- Sizes: `h-3.5 w-3.5` for inline list / menu; `h-4 w-4` for primary CTAs and section h3 prefixes; `h-8 w-8` for empty-state decorative; `h-14 w-14` for drawer avatar trigger.
- Icon button: `grid h-8 w-8 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]`.

## 10. New page checklist

When adding a new page under `src/renderer/pages/...`:

1. Use `bg-[var(--paper)]` + `SPACE_BACKGROUND_STYLE` + `PAPER_GRID_STYLE` overlay for the page surface.
2. Use `mx-auto max-w-6xl` for collection layout, `max-w-4xl` for narrative.
3. Section title row pattern (7.9) with icon + count chip + primary CTA.
4. Two-column grid (7.8) for repeated card lists.
5. Cards follow (7.1).
6. Status pill follows (7.2).
7. Drawer / dialog if needed follows (7.3) / (7.4) / (7.5).
8. Empty state follows (7.6).
9. Typography: 100% sans. Caps at `text-xl font-semibold` for page chrome; `text-2xl` only for in-drawer issue title / create-issue title input.
10. Color: only `--accent-warm` for primary action. Status uses `--success` / `--warning` / `--error`.
11. Radius: cap at `rounded-xl`. Pills `rounded-md` or `rounded-full`.
12. Shadow: cards flat at rest; `shadow-md` / `shadow-xl` / `backdrop-blur-md` only for floating layers.