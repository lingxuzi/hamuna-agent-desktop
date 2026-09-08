# Widget Templates · 每阶段可视化模板

**何时读**：每阶段产物落盘后 + 写完 `segment-XX.md` 后。AI **必须** emit `<generative-ui-widget>` 块在 chatui 实时渲染，让用户**直观看**生成内容，**不**只看到裸 URL 文本。

> **诊断澄清**：creative-video-suite **input 端**用 HTTPS URL 喂 MCP 是**正确**的——MCP server 只接受 HTTPS URL（本地路径触发 `img.remit.ee` 图床上传撞 QPS 限流，5 步硬门控第 1 条强制）。问题在 **output 端**——`mcp__multimedia-creator__agnes25_*` 当前没在 `src/server/utils/tool-result-attachments.ts::classifyToolAttachmentPresentation` 注册，URL 仅以纯文本落到 chat，没被 `ToolImageAttachment` 渲染成本地图卡。本文件作为 **skill 侧补偿**：AI 主动 emit widget 块让用户看到。Sidecar 包装属于另一 PR follow-up。

---

## 0. 通用规则

1. **每阶段完成后 emit 一个 widget**，**不**抢跑（前一阶段产物未落盘 = 不可 emit）/ **不**延后（用户看不到进度）。
2. **widget 内容用 HTTPS URL**——sandboxed iframe CSP 只放 `data:` + `https:`（`WidgetRenderer.tsx:101-114`）；本地 file path 必须经 `resolveLocalMediaSrcs()` 转 base64。本模板默认全用 HTTPS URL，避开本地路径。
3. **模板提供骨架 + 占位符**——AI 用真实数据填，**不**自由发挥写新结构。6 套模板 = 6 种固定形态，禁演化。
4. **失败 segment 在 widget 中显示 ⚠️ 占位**（红色边框 + 错误摘要），**不**消失——partial success 处理见 `references/mcp-usage-guide.md` §3.3。
5. **主题用 CSS token**：`var(--paper)` / `var(--line)` / `var(--ink)` / `var(--ink-secondary)` / `var(--paper-inset)` / `var(--accent)`——保证 widget 在 light/dark 主题都正常（`WidgetRenderer` 用 `buildWidgetCssVars` 注入）。
6. **widget emit 后保留 Markdown fallback**——用户终端不支持 iframe 或 widget 解析失败时仍能看到 `![image](<URL>)` / `![video](<URL>)`。
7. **widget 体积约束**：caption 字符串硬上限 4KB（`MAX_TOOL_ATTACHMENT_CAPTION_BYTES`）；widget HTML 总长建议 ≤ 50KB（sandboxed iframe + streaming preview 性能）。

---

## 1. planner-meta-card

**渲染目标**：项目元数据（项目名 / type / 风格锚点 / 比例 / 阶段推进状态）

**数据来源**：`project.json` + `01_planner.md` 头部

**HTML 骨架**：

```html
<generative-ui-widget title="项目卡片 · <project-name>">
<style>
  .cv-meta { padding: 12px; font-family: var(--font-sans); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .cv-meta h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  .cv-meta .badges { display: flex; gap: 6px; margin-bottom: 8px; }
  .cv-meta .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; background: var(--paper-inset); color: var(--ink-secondary); }
  .cv-meta .brief { font-size: 13px; color: var(--ink-secondary); line-height: 1.5; margin-bottom: 8px; }
  .cv-meta .stages { display: flex; gap: 4px; flex-wrap: wrap; }
  .cv-meta .stage { padding: 3px 8px; border-radius: 4px; font-size: 11px; border: 1px solid var(--line); }
  .cv-meta .stage.done { background: var(--accent); color: var(--paper); border-color: var(--accent); }
  .cv-meta .stage.todo { color: var(--ink-secondary); }
</style>
<div class="cv-meta">
  <h2>{{projectName}}</h2>
  <div class="badges">
    <span class="badge">{{type}}</span>
    <span class="badge">{{styleAnchor}}</span>
    <span class="badge">{{aspectRatio}}</span>
    <span class="badge">{{totalEpisodes}}集</span>
  </div>
  <div class="brief">{{userBriefSummary}}</div>
  <div class="stages">
    <span class="stage {{plannerDone}}">planner</span>
    <span class="stage {{scriptDone}}">script</span>
    <span class="stage {{storyboardDone}}">storyboard</span>
    <span class="stage {{assetsDone}}">assets</span>
    <span class="stage {{frameDone}}">frame</span>
    <span class="stage {{videoDone}}">video</span>
  </div>
</div>
</generative-ui-widget>
```

**占位符替换规则**：

| 占位符 | 来源 |
|---|---|
| `{{projectName}}` | `project.json.name` |
| `{{type}}` | `project.json.type`（drama / ugc / marketing / corporate） |
| `{{styleAnchor}}` | `project.json.style_anchor` |
| `{{aspectRatio}}` | `project.json.aspect_ratio` |
| `{{totalEpisodes}}` | `01_planner.md` 头部声明集数（drama 才有） |
| `{{userBriefSummary}}` | 用户原始 brief 摘要（≤ 200 字） |
| `{{plannerDone}}` 等 | 阶段名 + `_Done` 后缀，对比 `project.json.stages_completed`：`done` vs `todo` |

**Markdown fallback**：

```markdown
📋 **项目卡片**
- 项目名：`{{projectName}}`
- 类型：`{{type}}` · 风格：`{{styleAnchor}}` · 比例：`{{aspectRatio}}`
- 阶段进度：`planner ✅` / `script ⏳` / `storyboard ⏳` / `assets ⏳` / `frame ⏳` / `video ⏳`
- Brief：{{userBriefSummary}}
```

---

## 2. scriptwriter-summary-card

**渲染目标**：剧本摘要（标题 / 类型 / 角色清单 / 场景清单 / 道具清单 + 段数 / 集数）

**数据来源**：`02_script.md` 头部 + 末尾"角色清单 / 场景清单 / 道具清单"段

**HTML 骨架**：

```html
<generative-ui-widget title="剧本摘要 · {{title}}">
<style>
  .cv-script { padding: 12px; font-family: var(--font-sans); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .cv-script h2 { margin: 0 0 6px; font-size: 16px; }
  .cv-script .meta { font-size: 12px; color: var(--ink-secondary); margin-bottom: 8px; }
  .cv-script .meta span { margin-right: 12px; }
  .cv-script .columns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .cv-script .column h3 { font-size: 12px; font-weight: 600; margin: 0 0 4px; color: var(--ink-secondary); text-transform: uppercase; }
  .cv-script .column ul { margin: 0; padding-left: 16px; font-size: 12px; line-height: 1.6; }
  .cv-script .column li { color: var(--ink); }
</style>
<div class="cv-script">
  <h2>{{title}}</h2>
  <div class="meta">
    <span>📚 {{genre}}</span>
    <span>🎬 {{episodeCount}}集 × {{secondsPerEpisode}}秒</span>
    <span>👥 {{characterCount}}角色</span>
    <span>🏛 {{sceneCount}}场景</span>
    <span>📦 {{propCount}}道具</span>
  </div>
  <div class="columns">
    <div class="column">
      <h3>角色</h3>
      <ul>{{characterList}}</ul>
    </div>
    <div class="column">
      <h3>场景</h3>
      <ul>{{sceneList}}</ul>
    </div>
    <div class="column">
      <h3>道具</h3>
      <ul>{{propList}}</ul>
    </div>
  </div>
</div>
</generative-ui-widget>
```

**占位符替换规则**：

| 占位符 | 来源 |
|---|---|
| `{{title}}` | `02_script.md` 标题 |
| `{{genre}}` | 题材（剧情 / 都市 / 古风 / 玄幻...） |
| `{{episodeCount}}` / `{{secondsPerEpisode}}` | 集数 / 单集时长 |
| `{{characterCount}}` / `{{sceneCount}}` / `{{propCount}}` | 各清单条目数 |
| `{{characterList}}` | `<li>{{name}} — {{role}}</li>` × N |
| `{{sceneList}}` | `<li>{{sceneName}}</li>` × N |
| `{{propList}}` | `<li>{{propName}}</li>` × N |

**Markdown fallback**：

```markdown
📜 **剧本摘要** · {{title}}
- {{episodeCount}}集 × {{secondsPerEpisode}}秒 · 题材：{{genre}}
- 👥 角色（{{characterCount}}）：{{characterListInline}}
- 🏛 场景（{{sceneCount}}）：{{sceneListInline}}
- 📦 道具（{{propCount}}）：{{propListInline}}
```

---

## 3. storyboard-shot-table

**渲染目标**：分镜表（按片段 / 镜头 / 时长 / 主体 / 镜头语言 / 旁白 / 关键帧图）

**数据来源**：`03_storyboard.md` 分镜表 + `04_assets/<角色名>/<角色名>_设定.png` 的 HTTPS URL（assets 阶段已落盘的副本）

**HTML 骨架**：

```html
<generative-ui-widget title="分镜表 · {{episodeLabel}}">
<style>
  .cv-storyboard { padding: 12px; font-family: var(--font-sans); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .cv-storyboard h2 { margin: 0 0 8px; font-size: 15px; }
  .cv-storyboard table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .cv-storyboard th, .cv-storyboard td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  .cv-storyboard th { color: var(--ink-secondary); font-weight: 600; text-transform: uppercase; font-size: 10px; }
  .cv-storyboard .shot-no { font-family: var(--font-mono); color: var(--accent); font-weight: 600; white-space: nowrap; }
  .cv-storyboard .time { font-family: var(--font-mono); color: var(--ink-secondary); white-space: nowrap; }
  .cv-storyboard .dialogue { color: var(--ink); font-style: italic; }
  .cv-storyboard .keyframe-thumb { width: 60px; height: 100px; object-fit: cover; border-radius: 4px; border: 1px solid var(--line); }
</style>
<h2>{{episodeLabel}}</h2>
<table>
  <thead>
    <tr>
      <th>镜</th>
      <th>时间</th>
      <th>主体 / 动作</th>
      <th>镜头语言</th>
      <th>旁白 / 台词</th>
      <th>关键帧</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="shot-no">#01</td>
      <td class="time">0.0-1.2s</td>
      <td>{{shotGoal01}}</td>
      <td>{{cameraPath01}}</td>
      <td class="dialogue">{{dialogue01}}</td>
      <td><img class="keyframe-thumb" src="{{keyframe01Url}}" alt="SEG01_START" /></td>
    </tr>
    <!-- 每个 shot 重复 <tr>...</tr>，drama 默认 7-12 行；commercial 按 10-12 行 -->
  </tbody>
</table>
</generative-ui-widget>
```

**占位符替换规则**：

| 占位符 | 来源 |
|---|---|
| `{{episodeLabel}}` | `第1集` / `第2集` 等 |
| `{{shotGoalNN}}` | `shot_goal` 字段 |
| `{{cameraPathNN}}` | `camera_path` 字段（景别 / 视角 / 镜头） |
| `{{dialogueNN}}` | `audio_or_dialogue` 字段（用 `{}` 包裹的口播 / 旁白） |
| `{{keyframeNNUrl}}` | 关键帧 HTTPS URL（drama 从 `05_keyframes/episode-XX/segment-YY/SEGXX_YY.png` 复制后的本地副本 + 上传到 `img.remit.ee` 转 HTTPS；commercial Marketing 无分镜图，传空 `<td></td>`） |

**关键帧 HTTPS URL 获取**：本地副本路径 `<workspace>/.../05_keyframes/.../SEGXX_YY.png` → 走 `cmd_workspace_copy_paths` 上传到 `img.remit.ee` 拿 HTTPS URL（见 mcp-usage-guide §3.1 输入源铁律，本地路径会触发 server 自动上传，**不**手动上传避免 QPS 限流）。**替代方案**：从 `image_generate` 返回的 `data[0].url` 直接用（drama frame 阶段已生成关键帧，URL 在 stage .md 头部 `<file_path> → <https_url>` 映射里）。

**Markdown fallback**：

```markdown
🎞 **分镜表 · {{episodeLabel}}**

| 镜 | 时间 | 主体 / 动作 | 镜头语言 | 旁白 / 台词 |
|---|---|---|---|---|
| #01 | 0.0-1.2s | {{shotGoal01}} | {{cameraPath01}} | _{{dialogue01}}_ |
| #02 | 1.2-2.4s | ... | ... | ... |

关键帧图：![SEG01_START]({{keyframe01Url}})
```

---

## 4. assets-image-gallery

**渲染目标**：资产图集（角色 / 场景 / 道具缩略图，按 type 分组）

**数据来源**：`04_assets/<type>/<name>/<name>_设定.png` 的 HTTPS URL（每张图生成后立刻上传 / `image_generate` 返回的 `data[0].url`）

**HTML 骨架**：

```html
<generative-ui-widget title="资产图集 · {{stageCount}}张">
<style>
  .cv-assets { padding: 12px; font-family: var(--font-sans); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .cv-assets .group { margin-bottom: 12px; }
  .cv-assets .group-title { font-size: 12px; font-weight: 600; color: var(--ink-secondary); text-transform: uppercase; margin-bottom: 6px; }
  .cv-assets .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .cv-assets .item { background: var(--paper-inset); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
  .cv-assets .item img { width: 100%; aspect-ratio: 1/1; object-fit: cover; display: block; }
  .cv-assets .item .name { padding: 4px 6px; font-size: 11px; color: var(--ink-secondary); text-align: center; }
</style>

<div class="cv-assets">
  {{#if characters}}
  <div class="group">
    <div class="group-title">👥 角色（{{charactersCount}}）</div>
    <div class="gallery">
      <div class="item">
        <img src="{{character01Url}}" alt="{{character01Name}}" />
        <div class="name">{{character01Name}}</div>
      </div>
      <!-- 每个角色重复 .item -->
    </div>
  </div>
  {{/if}}

  {{#if scenes}}
  <div class="group">
    <div class="group-title">🏛 场景（{{scenesCount}}）</div>
    <div class="gallery">{{scenesItems}}</div>
  </div>
  {{/if}}

  {{#if props}}
  <div class="group">
    <div class="group-title">📦 道具（{{propsCount}}）</div>
    <div class="gallery">{{propsItems}}</div>
  </div>
  {{/if}}

  {{#if productRefs}}
  <div class="group">
    <div class="group-title">📦 产品参考图（{{productRefsCount}}）</div>
    <div class="gallery">{{productRefsItems}}</div>
  </div>
  {{/if}}

  {{#if brandRefs}}
  <div class="group">
    <div class="group-title">🎨 品牌资产（{{brandRefsCount}}）</div>
    <div class="gallery">{{brandRefsItems}}</div>
  </div>
  {{/if}}
</div>
</generative-ui-widget>
```

**占位符替换规则**：

| 占位符 | 来源 |
|---|---|
| `{{stageCount}}` | 当前总资产数（含本次新增） |
| `{{charactersCount}}` / `{{character01Url}}` / `{{character01Name}}` | `04_assets/characters/<name>/<name>_设定.png` |
| `{{scenesCount}}` / `{{scenesItems}}` | 同上 for scenes |
| `{{propsCount}}` / `{{propsItems}}` | 同上 for props |
| `{{productRefsCount}}` / `{{productRefsItems}}` | **commercial only** `04_assets/product-refs/<name>.png` |
| `{{brandRefsCount}}` / `{{brandRefsItems}}` | **corporate only** `04_assets/brand-refs/<name>.png` |

**追加模式**：每生成一张图立即 emit widget（**不**等全部完成）；新 emit 的 widget 包含全部已生成图（含本次新增）。前端 `WidgetRenderer` 渲染最新版本（streaming-style 行为）。

**drama 内部细分**：产品类道具（品牌手机 / 真实商品 / 包装）→ 必传用户图；通用道具（桌椅 / 装饰 / 抽象物）→ AI 自由生成（见 `references/drama/assets.md` 产品图强制门控）。

**Markdown fallback**：

```markdown
🎨 **资产图集 · {{stageCount}}张**

**👥 角色（{{charactersCount}}）**
![{{character01Name}}]({{character01Url}})

**🏛 场景（{{scenesCount}}）**
![{{scene01Name}}]({{scene01Url}})

**📦 道具（{{propsCount}}）**
![{{prop01Name}}]({{prop01Url}})
```

---

## 5. frame-keyframe-grid

**渲染目标**：drama 关键帧网格（按 episode × segment 排列，让用户一眼看到帧序对不对）

**数据来源**：`05_keyframes/episode-XX/segment-YY/<KEYFRAME_NAME>.png` 的 HTTPS URL

**HTML 骨架**：

```html
<generative-ui-widget title="关键帧网格 · {{episodeLabel}}">
<style>
  .cv-frames { padding: 12px; font-family: var(--font-sans); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .cv-frames h2 { margin: 0 0 8px; font-size: 15px; }
  .cv-frames .segment-row { display: grid; grid-template-columns: 60px 1fr; gap: 8px; margin-bottom: 8px; align-items: start; }
  .cv-frames .segment-label { font-family: var(--font-mono); color: var(--accent); font-weight: 600; font-size: 12px; padding-top: 4px; }
  .cv-frames .frame-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px; }
  .cv-frames .frame { background: var(--paper-inset); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
  .cv-frames .frame img { width: 100%; aspect-ratio: 9/16; object-fit: cover; display: block; }
  .cv-frames .frame .name { padding: 3px 4px; font-size: 10px; color: var(--ink-secondary); text-align: center; font-family: var(--font-mono); }
</style>

<h2>{{episodeLabel}} · {{frameCount}}张</h2>
{{#each segments}}
<div class="segment-row">
  <div class="segment-label">{{segmentLabel}}</div>
  <div class="frame-grid">
    {{#each keyframes}}
    <div class="frame">
      <img src="{{frameUrl}}" alt="{{frameName}}" />
      <div class="name">{{frameName}}</div>
    </div>
    {{/each}}
  </div>
</div>
{{/each}}
</generative-ui-widget>
```

**占位符替换规则**：

| 占位符 | 来源 |
|---|---|
| `{{episodeLabel}}` | `第1集` 等 |
| `{{frameCount}}` | 该集关键帧总数（默认 7 张：SEG01_START / SEG01_END / SEG02_END...SEG06_END） |
| `{{segmentLabel}}` | `segment-01` / `segment-02` 等 |
| `{{frameUrl}}` / `{{frameName}}` | `05_keyframes/episode-XX/segment-YY/<KEYFRAME>.png` → HTTPS URL |

**追加模式**：每生成一张关键帧立即 emit widget（**不**等全部 7 张）；新 emit 包含该 segment 已生成的关键帧（streaming-style）。

**drama 默认 7 张**：1 集 6 段，每段 SEG_END + SEG01_START。**commercial 不调 frame 阶段**（无分镜图 / Marketing 强门控）。

**Markdown fallback**：

```markdown
🎞 **关键帧网格 · {{episodeLabel}} · {{frameCount}}张**

**segment-01**
- SEG01_START: ![]({{seg01StartUrl}})
- SEG01_END: ![]({{seg01EndUrl}})

**segment-02**
- SEG02_END: ![]({{seg02EndUrl}})
...
```

---

## 6. video-segment-list

**渲染目标**：视频卡列表（每段含视频本体 + 元数据 + 失败占位）

**数据来源**：`06_videos/segment-XX.mp4` 的 HTTPS URL（`cmd_workspace_copy_paths` 复制后从 agnes CDN 拿）+ `segment-XX.md` 头部元数据

**HTML 骨架**：

```html
<generative-ui-widget title="视频列表 · {{projectName}}">
<style>
  .cv-videos { padding: 12px; font-family: var(--font-sans); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .cv-videos h2 { margin: 0 0 8px; font-size: 15px; }
  .cv-videos .seg { margin-bottom: 12px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper-inset); }
  .cv-videos .seg.failed { border-color: #dc2626; background: rgba(220, 38, 38, 0.05); }
  .cv-videos .seg-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px; }
  .cv-videos .seg-title { font-family: var(--font-mono); color: var(--accent); font-weight: 600; }
  .cv-videos .seg-meta { color: var(--ink-secondary); font-size: 11px; }
  .cv-videos .seg video { width: 100%; border-radius: 4px; background: #000; }
  .cv-videos .seg.failed .error { padding: 8px; color: #dc2626; font-size: 12px; }
  .cv-videos .seg.failed .retry-hint { padding: 4px 8px; background: var(--paper); border-radius: 4px; font-size: 11px; color: var(--ink-secondary); }
</style>

<h2>{{projectName}} · {{completedCount}}/{{totalCount}} 完成</h2>

{{#each segments}}
<div class="seg {{status}}">
  <div class="seg-header">
    <div class="seg-title">{{segmentLabel}}</div>
    <div class="seg-meta">{{duration}}s · {{aspectRatio}} · {{mode}}{{#if voiceover}} · 旁白{{/if}}</div>
  </div>
  {{#if completedStatus}}
      <video src="{{videoUrl}}" controls preload="metadata" />
    {{else}}
      <div class="error">⚠️ {{errorMessage}}</div>
      <div class="retry-hint">已记录到 <code>project.json.notes.video_segments[{{segmentLabel}}]</code>，请告知是否重试。</div>
    {{/if}}
</div>
{{/each}}
</generative-ui-widget>
```

**占位符替换规则**：

| 占位符 | 来源 |
|---|---|
| `{{projectName}}` | `project.json.name` |
| `{{completedCount}}` / `{{totalCount}}` | 成功段数 / 总段数（drama 6 段 / commercial 1 段 / `long_video_stitch_mode` N 段） |
| `{{segmentLabel}}` | `segment-01` 等 |
| `{{duration}}` / `{{aspectRatio}}` / `{{mode}}` | `segment-XX.md` 头部元数据 |
| `{{voiceover}}` | 是否含旁白（drama / corporate 必有，UGC / Marketing 可选） |
| `{{status}}` | `completed` 或 `failed`（`project.json.notes.video_segments[<id>].status`） |
| `{{videoUrl}}` | `cmd_workspace_copy_paths` 复制后从 agnes 拿的 HTTPS URL（或本地副本路径） |
| `{{errorMessage}}` | 失败摘要（`MCP timeout 600s` / `429 Too Many Requests` 等） |

**追加模式**：每生成一段视频立即 emit widget；新 emit 包含全部已生成段（含失败占位）。

**partial success 展示**：失败的 segment **不**消失，**红色边框 + ⚠️ + 错误摘要 + retry 提示**——用户在 widget 里就看到失败（不需要翻 chat 历史）。

**commercial 3 路差异**：
- **UGC**：每段额外显示 `Monologue` 口播原文（从 `segment-XX-script.md` 拿）
- **Marketing**：每段显示 `voiceover_scene_map` 旁白摘要
- **Corporate**：每段显示 `narration.md` 该段旁白子集 + 引用全片 `narration.md`

**Markdown fallback**：

```markdown
🎬 **视频列表 · {{projectName}} · {{completedCount}}/{{totalCount}} 完成**

**{{segmentLabel}}** ({{duration}}s · {{mode}})
![{{segmentLabel}}]({{videoUrl}})
{{#if voiceover}}
> 旁白：{{voiceoverExcerpt}}
{{/if}}

{{#if failedSegments}}
**⚠️ 失败段**
- {{failedSegmentLabel}}: {{errorMessage}}（已记录到 `project.json.notes.video_segments`，请告知是否重试）
{{/if}}
```

---

## 7. 集成清单（每阶段 emit widget 前自检）

```text
[ ] 产物已落盘到 <workspace>/.../<stage>/ 了吗？（output-conventions.md §3 落盘门控）
[ ] 用户已确认本阶段吗？（"确认"/"OK"/"looks good"）
[ ] 所有图 / 视频 URL 都是 HTTPS 吗？（不是本地路径）
[ ] 占位符都替换成真实数据了吗？（{{projectName}} 等）
[ ] 失败 segment 已显示 ⚠️ 占位吗？（不消失）
[ ] Markdown fallback 已保留吗？（widget 解析失败时仍能看到）
[ ] widget HTML 总长 ≤ 50KB 吗？（sandboxed iframe 性能）
```

8 项全过才允许 emit widget，**任何一项不过 = 该阶段未完成**。