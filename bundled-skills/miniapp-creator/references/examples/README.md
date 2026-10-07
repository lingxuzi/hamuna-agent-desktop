# 参考产物

生成新 MiniApp 前**挑最贴近形态的一个读完**，不要从零起手。每个样例只教一件事，
覆盖面靠数量而不是靠单个体量。

| 样例 | 形态 | 重点看什么 |
|---|---|---|
| `design-reference/` | 工具型 · 清单 | **默认基线，先读它。** `:root` 里的派生层（`color-mix`）、动效 token 三时长两曲线、磨砂顶栏、焦点环、染色 chip |
| `data-board/` | 工具型 · 数据密集 | 紧凑行高、等宽数字对齐、冻结表头、语义色只点状态、空状态与密度档位 |
| `signal-chart/` | 工具型 · 数据可视化 | SVG 图表的刻度与路径怎么算而不是写死、`tabular-nums` 为什么是图表质感的分水岭、悬停十字线不触发布局、**设计过的空状态与骨架屏** |
| `canvas-lab/` | 工具型 · 画布 | `devicePixelRatio` 怎么缩 backing store、画布颜色怎么从 token 取、`requestAnimationFrame` 怎么在 Tab 失焦时停下、种子 PRNG 怎么保证"同一个种子画出同一张图" |
| `form-desk/` | 工具型 · 密集表单 | 校验失败时焦点该去哪、`aria-invalid` / `aria-describedby` 怎么串、确认性反馈的完整生命周期（进入→停留→退场→摘节点）、必填与可选不能只靠颜色区分 |
| `showcase/` | 展示型 | 什么情况下才可以放飞：`meta.json::appearance` 的自建色板怎么同时做深浅两套、动效怎么编排才不失控 —— **工程纪律一条没少** |
| `celestial-atlas/` | 展示型 · **天花板** | **想看这个 skill 的上限在哪，看它。** 自持色板 + 衬线显示字 + 场景随选中对象染色 + 高密度数据面板，四套机制同时成立；四个语义色 × 三种表面 = 12 组对比度数字全部算过并写进注释；强调色占比压到 1% |

读法：`meta.json` 看能力声明与 i18n，`index.html` 看骨架有多小，`style.css`
**从顶部注释读设计系统声明**，再读 `:root`，`ui.js` 看行为层怎么编排。

> **形态没有样例时，先读最接近的那一个**，把它的骨架换掉，而不是打开一个空白
> 文件从零写。从零生成正是"AI 味"的主要来源 —— 它意味着没有可模仿的判断。

`showcase/` 只在用户明确要展示型时才读。默认调性是工具型，见 `../../design-playbook.md` §三。

## 三个样例都踩过的同一个坑

`onAppearanceChange` 和 `onLocaleChange` **不会为首屏状态触发**。宿主在
`host.ready` 里下发的初始值要走这条订阅：

```js
app.on((e) => {
  if (e.type !== 'ready') return;
  syncOnce(app.appearanceMode, app.locale);   // 首屏对齐一次
});
app.onAppearanceChange(syncAppearance);        // 之后才是变化事件
app.onLocaleChange(syncLocale);
```

只写后两行的话，界面会用 runtime 自己的默认值（`dark` / `en-US`）起手，
在浅色宿主或中文宿主下就整屏错色——而这两个函数**一个都不会响**。