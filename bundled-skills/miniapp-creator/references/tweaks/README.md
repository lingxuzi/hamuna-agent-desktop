# tweaks — 外观微调运行时

两个文件，直接复制进你的 MiniApp：

```
references/tweaks/tweaks.js     # 行为：面板、持久化、data 属性
references/tweaks/tweaks.css    # 样式：右下角面板与齿轮
```

## 它解决什么

用户第二次打开一个小工具时才会形成偏好：字太小、信息太密、动效晃眼。这些不会
出现在第一次的需求描述里。没有地方承接，模型就只能照抄用户的第一句话，于是产出
「正确但平庸」的东西。

这个模块给的正是那个地方。**它不是可选装饰** —— 没有它，"用户没说要什么"这件事
就没有出口。

## 用法

`index.html` 里引入两个文件，然后：

```js
import { mountTweaks } from './tweaks.js';

mountTweaks({
  items: [
    { id: 'density',
      label: { 'zh-CN': '密度', 'en-US': 'Density' },
      options: [['comfortable', '宽松'], ['compact', '紧凑']],
      default: 'comfortable' },
    { id: 'motion',
      label: { 'zh-CN': '动效', 'en-US': 'Motion' },
      options: [['full', '完整'], ['reduced', '减少']],
      default: 'full' },
  ],
});
```

你的 CSS 只需要写规则，不需要调用任何 API：

```css
:root[data-density='compact'] { --row-h: 32px; }
.row { height: var(--row-h); }
```

## 两条边界

**appearance-only。** 这里只放"长什么样"。业务偏好（默认视图、排序方式、是否自动
刷新）属于主界面 —— 把两者混在一个齿轮面板里，用户找不到真正想找的那个设置，
作者也会把业务状态藏进一个语义不明的属性里。

**最多 6 项。** 超过就不是"微调"而是一份设置页了。真需要设置页，那是一个独立应用。

## 为什么用 data 属性而不是内联样式

内联样式只能带值，于是"档位 A 用 12px、档位 B 用 14px"要由 JS 在每次切换时重写
每个用到它的元素 —— 漏掉一个的后果是"一半界面变了、一半没变"，而且永远不会报错。
写成 `data-density="compact"` 之后，CSS 自己解释，一处声明覆盖所有使用点。

## 被门禁检查

`tweaks.css` 与 `bundled-miniapps/` 和 `references/examples/` 受同一套
`npm run verify:miniapp-style` 管辖。一个示范硬编码 hex 的片段比没有片段更糟 ——
因为它会被逐字复制进每一个用它的应用。