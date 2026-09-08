# Agnes Short Drama · AI Micro-Drama Director

[中文版](README.md)

From a 100-character story seed to multi-episode AI micro-dramas — your AI short drama director.

A skill that turns your AI agent into an **AI Short Drama Director**, covering the complete production pipeline for microdramas / vertical-screen dramas: from one story idea to production-ready multi-episode director-style scripts + asset library keyframe prompts + shot-by-shot video prompts.

## How It Works

The workflow mirrors real short drama production stages:

```
"An introverted high school girl finds a talking diary in the library..."
                  ↓
   Phase 1: Creative Brief        ← User 4 fields (story seed + style + ratio + episodes)
   Phase 2: World & Characters    ← AI auto-expands (episodes/genre/audience/summary/world/cast)
   Phase 3: Episode Scripts       ← Director grammar 【场景】/△/角色（情感，语调）：/【道具】
   Phase 4: Asset Library         ← Character/Scene/Prop keyframe prompts (agnes-image-2.5-flash)
   Phase 5: Storyboard & Shoot    ← Multi-grid storyboard + 12-field shot prompts (agnes-video-2.5-flash)
   Phase 6: Review & Delivery     ← Iteration + ffmpeg compositing
                  ↓
   Copy-paste-ready scripts, asset prompts, video prompts + final mp4
```

## Key Features

- **Minimal user input** — Only 4 fields required (story seed + style + ratio + episodes); AI auto-expands the remaining 6 metadata
- **Three style tiers** — 60+ templates: Live-Action (25+), 3D Stylized (10+), 2D Animation (25+)
- **4 AI micro-drama narrative models** — Mystery Escalation, Conflict Escalation, Power Climax, Growth Diary
- **Director-style screenplay grammar** — Unified 4 markers spanning episode → shot level
- **12-field shot template** — Opening/Size/Movement/Character/Scene/Action/Transition/Expression/Dialogue/SFX/Lighting/Close
- **Style = 4-dimension coupling** — Not just a filter; binds visual + camera + script + emotion
- **Copy-paste ready** — Prompts invoked directly via `mcp__multimedia-creator__agnes25_*`

## Three Style Tiers

### 1. Live-Action Realism
- 25+ templates: suspense cinema, 90s HK cinema, Tarantino film grain, ancient romance soft-light, Korean drama soft-light, Russian melancholy, Kore-eda Japanese realism, horror cinema, etc.
- For: plot-driven, twist-driven, romance, human nature

### 2. 3D Stylized
- 10+ templates: 3D ancient-Chinese animation, Chinese-style 3D rendering, 3D Disney, UE5 photoreal, 3D simple cartoon, claymation, etc.
- For: xianxia, fantasy, power-fantasy, mythological, food

### 3. 2D Animation
- 25+ templates: anime, Miyazaki style, shojo manga, Chinese mythology, oriental ink-wash, Chinese shadow puppetry, Otomo Katsuhiro, Tezuka Osamu, 90s Japanese anime, Shanghai Animation Studio vintage, etc.
- For: school, youth, romance, healing, anime-original

## Four Narrative Models

| Model | Name | Core Logic | Suitable Genres |
|-------|------|-----------|-----------------|
| A | Mystery Escalation | Each episode reveals one truth layer, ends with deeper secret | Suspense/Mystery/Crime |
| B | Conflict Escalation | Each episode escalates conflict; protagonist struggles harder | Romance/School/Workplace |
| C | Power Climax | Each episode delivers one "face-slap" or victory event | Transmigration/Rags-to-riches/Power fantasy |
| D | Growth Diary | Each episode triggers inner transformation; final episode consolidates | Youth/Healing/Fantasy |

## Entry Modes (Auto-detected)

| Mode | Trigger | Starting Phase |
|------|---------|---------------|
| **A: Full short drama creation** | "Help me make a short drama", "I want a 5-episode series" | Creative Brief |
| **B: Script to storyboard** | User provides complete/partial script or episode outline | Asset Library → Storyboard |
| **C: Shot/single-camera generation** | "Help me write a shot prompt for X" | Storyboard & Shoot |
| **D: Iteration** | "This script is wrong", "Change the style" | Review |

## Quick Start: A 5-Episode School Fantasy Drama

### Step 1 — One-line story seed

> "An introverted high school girl finds a talking diary in the library; the diary contains letters from her ten-years-later self. She musters courage before the rooftop confession deadline."

AI auto-expands to:
- Style: Anime
- Episodes: 5
- Ratio: 9:16
- Story Type: School Fantasy
- Target Audience: Teenagers

### Step 2 — AI auto-generates world/characters

- Plot Summary (4-6 sentence structure: hook → core conflict → escalation → twist → climax → hook)
- World Setting: Contemporary high school campus; main scenes are library, classroom, rooftop
- 3 characters + 1 object:
  - Lin Xiaoman (protagonist, introverted high school girl)
  - Lu Yan (love interest, sunny boy)
  - Diary (talking fantasy item)

### Step 3 — AI generates 5-episode director-style scripts

Each episode uses unified 4 markers:
```
【场景】Contemporary high school campus, library (flashback: 3 years ago).
...
△ Camera action / visual description.
Lin Xiaoman (nervous, trembling): "Why... why can't I say it out loud."
【道具】Deep brown diary
```

### Step 4 — AI generates asset library via agnes-image-2.5-flash

- Character asset: @Lin Xiaoman (full body / medium close-up / state variants)
- Scene assets: @Library / @Classroom / @Rooftop
- Prop asset: @Diary

### Step 5 — AI generates video via agnes-video-2.5-flash reference mode

Each shot independently generated, using 12-field complete prompt:
```
[约束]: Clamp duration to 4-15s
[起幅]: Medium close-up opening, @Lin Xiaoman stands by library window
[景别]: Medium close-up
[运镜]: Camera slowly pushes forward
[角色@]: @Lin Xiaoman
[场景@]: @Library
[动作]: @Lin Xiaoman opens blank page, tears drop on paper
[转场]: None
[表情]: Eyes reddened, biting lips
[对白]: "Why... why can't I say it out loud."
[音效/声]: Inner BGM plays (piano light music)
[色调/光线]: Warm sunset rays + high saturation
[落幅]: Closing on diary's fading "LXM" gold stamp
```

### Output Summary

| Deliverable | Tool | Purpose |
|-------------|------|---------|
| Story metadata | — | Phase 2 auto-expand (episodes/genre/audience/summary/world/cast) |
| Episode scripts | — | Phase 3 director grammar 4 markers |
| Asset library | `agnes25_image_generate` | Character/scene/prop keyframes; cross-episode visual consistency |
| Shot videos | `agnes25_video_generate` (`mode="reference"`) | 12-field prompt, single shot 4-12s |
| Composed mp4 | ffmpeg | Episode + full series + intro/outro concatenation |

## Knowledge Base Architecture

Knowledge base is organized by crew roles in real drama production, loaded on demand:

| Crew Role | File | Real Production Equivalent | Loading |
|-----------|------|---------------------------|---------|
| Director/Producer | `SKILL.md` | Workflow control, phase transitions, 4-mode entry | Always loaded |
| Screenwriter | `references/narrative.md` | 4 narrative models, summary/world/character formulas | Creative Brief / World |
| Art Director | `references/style-library.md` | 60+ style templates + 4-dimension coupling | Creative Brief |
| Casting Director | `references/pre-production.md` | Character/scene/prop assets + consistency maintenance | Asset Library |
| Director of Photography | `references/shot-language.md` | 12-field shot template, shot size/movement/transition lexicon | Storyboard & Shoot |
| Storyboard Artist | `references/storyboard.md` | Multi-grid storyboard + Multi-Phase video prompt | Storyboard & Shoot |
| Post-production | `references/delivery.md` | Output formats, iteration guide, ffmpeg compositing | Review / Delivery |

## License

Apache-2.0