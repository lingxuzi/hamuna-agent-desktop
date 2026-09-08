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

## 6.5 product-ref-drift-compare（产品参考漂移对比块）

**渲染目标**：让用户**直观看** product_ref（用户上传的真实产品图）vs 当前 segment / 关键帧生成结果，**第一眼识别漂移**——产品包装 / logo / 颜色 / 比例 / 细节是否有偏差。

**触发条件**：
- **涉及产品的 video_generate 调用后**（无论成功 / 失败）必 emit——即每段商业视频（UGC / Marketing / Corporate 含产品图）或 drama 产品特写段
- **降级模式**：text 模式生成产品外观时（产品图未上传 + 用户 ack 降级）必须 emit 漂移风险提示

**数据来源**：
- `{{productRefUrl}}` → `04_assets/product-refs/<产品名>.png` 的 HTTPS URL（用户上传的 ground truth）
- `{{generatedFrameUrl}}` → 当前 segment / 关键帧生成结果的 HTTPS URL（来自 `image_generate` 或 `video_generate` 返回的 `data[0].url`）
- `{{driftScore}}` → `project.json.notes.product_ref_drift_score[<segment>]`（0-1，0=完全一致，1=完全漂移；多模态自评字段）
- `{{productName}}` → `04_assets/product-refs/<产品名>.png` 文件名中的产品名

**HTML 骨架**：

```html
<generative-ui-widget title="产品参考漂移对比 · {{segmentLabel}}">
<style>
  .cv-drift { padding: 12px; font-family: var(--font-sans); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .cv-drift h2 { margin: 0 0 8px; font-size: 14px; }
  .cv-drift .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
  .cv-drift .pane { background: var(--paper-inset); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .cv-drift .pane-label { padding: 4px 8px; font-size: 11px; color: var(--ink-secondary); text-transform: uppercase; border-bottom: 1px solid var(--line); }
  .cv-drift .pane img { width: 100%; aspect-ratio: 9/16; object-fit: contain; background: #000; display: block; }
  .cv-drift .drift-bar { padding: 8px; background: var(--paper-inset); border-radius: 4px; }
  .cv-drift .drift-bar .label { font-size: 11px; color: var(--ink-secondary); margin-bottom: 4px; }
  .cv-drift .drift-bar .bar { height: 8px; background: var(--paper); border-radius: 4px; overflow: hidden; }
  .cv-drift .drift-bar .fill { height: 100%; transition: width 0.3s; }
  .cv-drift .drift-bar .fill.low { background: #16a34a; }       /* drift < 0.2 OK */
  .cv-drift .drift-bar .fill.mid { background: #eab308; }       /* 0.2-0.5 警告 */
  .cv-drift .drift-bar .fill.high { background: #dc2626; }      /* > 0.5 严重漂移 */
  .cv-drift .verdict { padding: 8px; margin-top: 8px; border-radius: 4px; font-size: 12px; }
  .cv-drift .verdict.ok { background: rgba(22, 163, 74, 0.1); color: #16a34a; }
  .cv-drift .verdict.warn { background: rgba(234, 179, 8, 0.1); color: #ca8a04; }
  .cv-drift .verdict.bad { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
  .cv-drift .verdict.degraded { background: rgba(107, 114, 128, 0.1); color: var(--ink-secondary); }
</style>

<h2>{{productName}} · {{segmentLabel}}</h2>

<div class="compare">
  <div class="pane">
    <div class="pane-label">📌 product_ref（ground truth）</div>
    <img src="{{productRefUrl}}" alt="{{productName}}" />
  </div>
  <div class="pane">
    <div class="pane-label">🎬 当前生成结果</div>
    <img src="{{generatedFrameUrl}}" alt="{{segmentLabel}}" />
  </div>
</div>

<div class="drift-bar">
  <div class="label">product_ref_drift_score: {{driftScoreFormatted}}</div>
  <div class="bar">
    <div class="fill {{driftLevel}}" style="width: {{driftPercent}}%;"></div>
  </div>
</div>

<div class="verdict {{verdictLevel}}">
  {{verdictText}}
</div>
</generative-ui-widget>
```

**占位符替换规则**：

| 占位符 | 来源 |
|---|---|
| `{{productName}}` | `04_assets/product-refs/<产品名>.png` 文件名 → 产品中文名 |
| `{{segmentLabel}}` | 当前 segment 编号（如 `segment-02` / `SEG03_END`） |
| `{{productRefUrl}}` | `04_assets/product-refs/<产品名>.png` HTTPS URL（已落盘的 ground truth） |
| `{{generatedFrameUrl}}` | 当前帧的 HTTPS URL（image_generate / video_generate 首帧） |
| `{{driftScore}}` | `project.json.notes.product_ref_drift_score[<segment>]` 数值（0-1） |
| `{{driftScoreFormatted}}` | 格式化为两位小数（如 `0.08` / `0.34` / `0.72`） |
| `{{driftLevel}}` | `low` (<0.2) / `mid` (0.2-0.5) / `high` (>0.5) |
| `{{driftPercent}}` | `{{driftScore}} * 100` |
| `{{verdictLevel}}` | `ok` / `warn` / `bad` / `degraded` |
| `{{verdictText}}` | 见下方判定文本表 |

**判定文本表**：

| driftScore | level | verdict 文本 |
|---|---|---|
| **< 0.2** | `ok` | ✅ 产品外观与参考图高度一致（包装 / logo / 颜色 / 比例匹配） |
| **0.2-0.5** | `warn` | ⚠️ 轻微漂移：检测到部分细节偏差（颜色 / 比例 / 细节），建议用户肉眼复核；如不接受可走 2-retry 铁律 |
| **> 0.5** | `bad` | ❌ 严重漂移：包装 / logo / 颜色明显不一致，建议重试（retry #1）微调 prompt，或**交由用户处理** |
| **降级模式** | `degraded` | ⚠️ 当前为 text 降级模式（产品图缺失），产品外观由 prompt 描述生成，**不保证**真实一致；如需真实一致请上传产品图 |

**drift_score 计算（AI 自评，多模态对比）**：
- 0.0-0.2：包装形状 / logo 颜色 / 主色调 / 比例 4 项全部匹配
- 0.2-0.5：1-2 项轻微偏差（如 logo 字体粗细 / 包装高光方向）
- 0.5-1.0：3 项以上偏差，或产品变体（不同型号 / 不同品牌）/ 整体外观替换

**追加模式**：每个涉及产品的 video segment / 关键帧生成后立即 emit；新 emit 替换当前 segment 的对比块（同一 segment 多次生成取最新一次）。

**占位符缺失处理**：
- `{{productRefUrl}}` 缺失 → 不 emit 本 widget，改用 `assets-image-gallery` 的 `productRefs` 组直接展示（用户根本没传产品图）
- `{{driftScore}}` 缺失 → 默认 0.0 + `ok`（无自评数据时不假设漂移）

**Markdown fallback**：

```markdown
🔍 **产品参考漂移对比 · {{productName}} · {{segmentLabel}}**

📌 product_ref: ![]({{productRefUrl}})
🎬 当前生成: ![]({{generatedFrameUrl}})

drift_score: **{{driftScoreFormatted}}**（{{driftLevel}}）

> {{verdictText}}
```

---

## 6.6 product-multiview-gallery（产品多视角宫格图展示块，2026-09-09 新增）

**渲染目标**：让用户**直观看**多视角产品宫格图（**单张图含 9/6/4 个角度**）+ 各角度标注 + view_status badge + 生成时间。区别于 §6.5 漂移对比：§6.5 是「用户上传 product_ref vs 当前生成」左右对比；§6.6 是「单张宫格图 + 角度标注 + 元数据」展示块。

**触发条件**：
- T13 `image_generate_multiview_grid` 调用成功（`view_status: "multiview-completed"`）→ assets 阶段 emit 一次
- 用户在 planner / assets 阶段 ack 多视角时也 emit 占位卡片（"待生成"）
- 多视角失败（`view_status: "multiview-failed"`）→ emit 失败占位（红色边框 + 错误摘要 + primary_url fallback 提示）

**数据来源**：
- `{{productName}}` → `04_assets/product-refs/<产品名>.png` 文件名 → 产品中文名
- `{{gridUrl}}` → `project.json.notes.product_metadata.<产品名>.multiview_grid_url`（T13 落盘的 HTTPS URL）
- `{{gridLayout}}` → `multiview_grid_layout`（"3x3" / "2x3" / "2x2"）
- `{{viewCount}}` → 派生自 gridLayout（9 / 6 / 4）
- `{{viewAngles}}` → 派生自 gridLayout（3×3 9 角度 / 2×3 6 角度 / 2×2 4 角度，参考 `mcp-call-templates.md §3 T13` 角度描述）
- `{{viewStatus}}` → `"single"` / `"multiview-pending"` / `"multiview-completed"` / `"multiview-failed"`
- `{{generatedAt}}` → `multiview_grid_generated_at`（ISO timestamp）
- `{{primaryUrl}}` → `multiview_grid_url` 不存在时的 fallback（同时显示 primary_url 作 single fallback）
- `{{errorMessage}}` → 仅 `view_status: "multiview-failed"` 时填

**HTML 骨架**：

```html
<generative-ui-widget title="产品多视角宫格图 · {{productName}}">
<style>
  .cv-mvg { padding: 12px; font-family: var(--font-sans); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .cv-mvg h2 { margin: 0 0 8px; font-size: 14px; }
  .cv-mvg .header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .cv-mvg .badge { padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 500; }
  .cv-mvg .badge.completed { background: rgba(22, 163, 74, 0.15); color: #16a34a; }
  .cv-mvg .badge.pending { background: rgba(234, 179, 8, 0.15); color: #ca8a04; }
  .cv-mvg .badge.failed { background: rgba(220, 38, 38, 0.15); color: #dc2626; }
  .cv-mvg .badge.single { background: rgba(107, 114, 128, 0.15); color: var(--ink-secondary); }
  .cv-mvg .meta { font-size: 11px; color: var(--ink-secondary); }
  .cv-mvg .grid-wrap { background: var(--paper-inset); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
  .cv-mvg .grid-img { width: 100%; aspect-ratio: {{gridAspectRatio}}; object-fit: contain; background: #000; display: block; }
  .cv-mvg .angles { display: grid; grid-template-columns: repeat({{angleCols}}, 1fr); gap: 4px; margin-top: 8px; }
  .cv-mvg .angle { padding: 6px 8px; background: var(--paper-inset); border: 1px solid var(--line); border-radius: 4px; font-size: 11px; }
  .cv-mvg .angle-num { font-weight: 600; color: var(--ink-secondary); margin-right: 4px; }
  .cv-mvg .fallback { padding: 8px; margin-top: 8px; background: var(--paper-inset); border-radius: 4px; font-size: 12px; }
  .cv-mvg .fallback a { color: var(--link); text-decoration: underline; }
  .cv-mvg .error { padding: 8px; margin-top: 8px; background: rgba(220, 38, 38, 0.1); color: #dc2626; border-radius: 4px; font-size: 12px; }
</style>

<h2>{{productName}} · {{viewCount}} 视角宫格（{{gridLayout}} 布局）</h2>

<div class="header">
  <span class="badge {{viewStatusClass}}">{{viewStatusBadge}}</span>
  <span class="meta">生成于 {{generatedAt}}</span>
</div>

<div class="grid-wrap">
  <img class="grid-img" src="{{gridUrl}}" alt="{{productName}} 多视角宫格图" />
</div>

<div class="angles">
  <div class="angle"><span class="angle-num">1</span>{{angle1}}</div>
  <div class="angle"><span class="angle-num">2</span>{{angle2}}</div>
  <div class="angle"><span class="angle-num">3</span>{{angle3}}</div>
  {{如有更多}}
  <div class="angle"><span class="angle-num">N</span>{{angleN}}</div>
  {{/如有更多}}
</div>

{{如有 fallback}}
<div class="fallback">
  ⚠️ 多视角宫格图未生成（view_status: "multiview-failed"）→ video 阶段自动回退使用 primary_url：
  <a href="{{primaryUrl}}" target="_blank">{{primaryUrlLabel}}</a>
</div>
{{/如有 fallback}}

{{如有 error}}
<div class="error">
  ❌ 多视角宫格图生成失败：{{errorMessage}}<br/>
  video 阶段回退 single 路径（images[0] = primary_url），不阻断下游。
</div>
{{/如有 error}}
</generative-ui-widget>
```

**占位符替换规则**：

| 占位符 | 来源 |
|---|---|
| `{{productName}}` | `04_assets/product-refs/<产品名>.png` 文件名 → 产品中文名 |
| `{{viewCount}}` | 派生自 `multiview_grid_layout`（3×3→9 / 2×3→6 / 2×2→4） |
| `{{gridLayout}}` | `multiview_grid_layout` 字面量（"3x3" / "2x3" / "2x2"） |
| `{{gridUrl}}` | `multiview_grid_url` HTTPS URL |
| `{{gridAspectRatio}}` | 派生自 `gridLayout`（3×3 / 2×2 → "1/1" / 2×3 → "3/4"） |
| `{{angleCols}}` | 派生自 `gridLayout`（3×3 / 2×3 → 3 / 2×2 → 2） |
| `{{angle1..N}}` | 派生自 `gridLayout`（参考 `mcp-call-templates.md §3 T13::{{view_angles_desc}}`） |
| `{{viewStatus}}` | `view_status` 字面量（"single" / "multiview-pending" / "multiview-completed" / "multiview-failed"） |
| `{{viewStatusClass}}` | 派生自 viewStatus（completed/pending/failed/single） |
| `{{viewStatusBadge}}` | 派生文本（`✅ multiview-completed` / `⏳ multiview-pending` / `❌ multiview-failed` / `single`） |
| `{{generatedAt}}` | `multiview_grid_generated_at` 格式化为本地时间（**不是** UTC `toISOString().split('T')[0]`） |
| `{{primaryUrl}}` / `{{primaryUrlLabel}}` | `primary_url` HTTPS URL / 简化标签（"primary_url"） |
| `{{errorMessage}}` | 多视角失败时的错误摘要（来自 `project.json.notes.last_failure`） |

**angle 角度文案**（3 套布局，硬编码复用 `mcp-call-templates.md §3 T13::{{view_angles_desc}}`）：

| Layout | angle1-9 文案 |
|---|---|
| **3x3** | `正面` / `3/4 视角` / `左侧面` / `背面` / `正面放大特写` / `顶部俯视` / `logo 特写` / `纹理材质细节` / `比例对比参照` |
| **2x3** | `正面` / `3/4 视角` / `侧面` / `背面` / `顶部俯视` / `局部细节` |
| **2x2** | `正面` / `侧面` / `背面` / `顶部俯视` |

**追加模式**：
- assets 阶段 T13 成功 → emit 完整 widget（status=completed）
- 多视角失败 → emit 错误占位（status=failed，含 errorMessage + primary_url fallback 链接）
- 同一产品多次重跑 → 替换当前 widget（多次 emit 取最新一次）

**占位符缺失处理**：
- `{{gridUrl}}` 缺失（`view_status: "single"` 或 `multiview-pending`）→ 不 emit 本 widget；改用 §4 `assets-image-gallery` 的 `productRefs` 组直接展示 primary_url 单图
- `{{errorMessage}}` 缺失（`view_status: "multiview-failed"` 但无 last_failure）→ 简化为 `"生成失败，详情见 unified log"`

**Markdown fallback**：

```markdown
📐 **产品多视角宫格图 · {{productName}}（{{viewCount}} 视角 / {{gridLayout}} 布局）**

**状态**: {{viewStatusBadge}} · 生成于 {{generatedAt}}

![]({{gridUrl}})

**角度清单**: 1) {{angle1}} · 2) {{angle2}} · 3) {{angle3}} · ... {{如有更多}} N) {{angleN}} {{/如有更多}}

{{如有 fallback}}
⚠️ 多视角宫格图未生成 → video 阶段回退使用 primary_url: ![primary_url]({{primaryUrl}})
{{/如有 fallback}}

{{如有 error}}
❌ 多视角宫格图生成失败：{{errorMessage}}（video 阶段回退 single 路径，不阻断下游）
{{/如有 error}}
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
[ ] 涉及产品的生成后 emit 了 product-ref-drift-compare widget 吗？（§6.5）
[ ] 多视角产品图生成后 emit 了 product-multiview-gallery widget 吗？（§6.6，仅 T13 触发）
```

8 项全过才允许 emit widget，**任何一项不过 = 该阶段未完成**。