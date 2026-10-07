## 目标

两件事：给 `miniapp-creator` skill 加上能真正约束住 `app.*` 调用的编码规范；生成之后有一条能跑的验证链，把**方法调用错误**和**点不动的死 handler** 拦下来。

## 现状（已核实）

协议层其实已经防得不错，洞不在宿主：

| 层 | 覆盖 | 漏什么 |
|---|---|---|
| `app-parity.unit.test.ts` | `APP_METHODS` ↔ runtime 门面 ↔ dispatch 三方一致 | — |
| `miniapp-docs-parity.unit.test.ts` | 文档 ↔ 协议 | — |
| `bundled-apps-permissions.test.ts` | 已提交 app 的调用 ↔ 权限声明 | 只扫**已提交**目录；且 `extractCalls` 穷举的是 `listAppMethods()` 的 34 个名字 —— **拼错的名字压根不进集合**，静默漏掉 |
| `validate-miniapp.mts` | 生成后 parse 闸 | **只有语法** |

关键：`scripts/shoot-miniapp.mjs` 已经用 Playwright + **真** `buildAppRuntimeScript` 把 app 挂进真 iframe，但宿主 `hostShim` 对**任何**方法都回 `ok:true`（:205-211），没有调用记录、没有 `pageerror` 监听、不点任何东西。它自己的 `ponytail:` 就写着「this is not an integration test」。全文件还有一个 `:424` 建了从不落盘的 `report` 对象。

## 改动

### 1. `src/shared/miniapp/method-contract.ts`（新）

静态方法契约闸。acorn 解析（复用 `script-syntax.ts:74-78` 的同一组选项；仓库没有 `acorn-walk`，照 `ast-policy.ts` 的 `memberChain` / `memberPropertyName` 写法手写 visitor，computed 形式 `app['fs']['writeFile']` 也要认）：

- 收集所有以标识符 `app` 为根的 `CallExpression`，拆成 `group` / `method`。
- 合法来源二选一：`APP_METHODS` 的 dispatch 方法，或 facade 上的非调用键（`appId` `locale` `appearanceMode` `platform` `workspaceDir` `appDataDir` `mode` `on` `onAppearanceChange` `onLocaleChange` `onActivate` `onDeactivate` `t`）。
- `app.X(...)` 单段调用只允许 `app.call`。
- 报错形状与 `ScriptSyntaxError` 一致：`file / line / column / message / excerpt`，配一个 `formatAppMethodError` —— 定位信息能让 AI 直接照着改，不用重写文件。

facade 键从 `buildAppRuntimeScript` 产物里正则抽（`miniapp-docs-parity.unit.test.ts:81-91` 已有这个手法），避免再抄一份手维护的表。

### 2. `scripts/validate-miniapp.mts`

在现有 parse 闸后面接上方法闸，两类错误一起汇总、一起非 0 退出。SKILL 第 10 步已经让 AI 跑这条命令，所以**不新增流程步骤**。

### 3. `scripts/shoot-miniapp.mjs` — 浏览器驱动冒烟

- **宿主如实拒绝未知方法**：shim 改用 `isKnownAppMethod`，名单外的方法回 `{ok:false, error:{code:'UNKNOWN_METHOD'}}`，跟真宿主一个行为。现在它对一切回 `ok:true`，运行时这条通道形同虚设。
- **记录调用**：`window.__shootCalls`，shim 里 push `{method, ok}`，`page.evaluate` 取回。
- **错误监听**：`page.on('pageerror')` + `page.on('console')`，**必须在 `setContent` 之前注册** —— `verify-miniapp-error-surface.mts:83-85` 的注释记着这个坑的踩法（注册晚了，parse 错误会报成 ok）。
- **驱动交互**：iframe settle 之后点遍所有可交互元素（沿用 PROBE 里已有的选择器 `:374`），跳过 `disabled`；表单字段额外派发 `input` / `change`，让监听 `change` 的 handler 也会跑。每次点击之间留短等待。
- **转成 findings**：任何 `pageerror`、`#hamuna-app-error` banner 出现、任何 `UNKNOWN_METHOD`、任何 `app.*` 调用的 `ok:false`，各记一条，汇总进退出码。
- **落盘 JSON 报告**：把那个死掉的 `report` 对象写到 `.miniapp-shots/<appId>/report.json`。

顺带修一处**新输出要用就必须修**的：`buildAppRuntimeScript(meta.id, 0)` 的 `authorLineOffset` 硬编码 0（:487），所以 error banner 报的行号是错的。照 `verify-miniapp-error-surface.mts:69-73` 的两趟测量补上——否则新加的 finding 会输出一个错的行号，比不报更糟。

### 4. `bundled-skills/miniapp-creator/SKILL.md` — 编码规范

在 `## window.app` 之后新增一节，收拢成「能照着写」的形态：

- **方法索引**：一张完整表，逐组列全，取代现在散在各小节的写法（`miniapp-docs-parity` 会验证覆盖度，所以合并不丢保护）。
- **硬规则**（每条都对应一类真实错误）：
  - 唯一入口是 `window.app`；不自己 `postMessage`，不写 `__miniappStorage`
  - 能力全返回 Promise → 要么 `await`，要么显式 `.catch()`；漏掉就是 unhandledrejection
  - `app.fs.*` 的路径必须是 `{appdata}` / `{workspace}` 前缀的完整字面量，中段 `*` 不生效，`{user-selected}` 一律不合法
  - `catch` 里只认 `PERMISSION_DENIED` / `UNKNOWN_METHOD` / `INVALID_PARAMS` / `HOST_ERROR` / `NETWORK_ERROR` 五个码，前三个是「改代码才有用」，后两个别笼统重试
  - `app.onX()` 返回取消订阅函数，**必须保存**（没有 `app.off`）
  - `app.locale` / `app.appearanceMode` 是 getter，别在加载时缓存
  - 指向已有的「明确不存在的能力」清单

并改第 10 步文案：同一条命令现在同时查语法和方法。

### 5. 测试

- `src/shared/miniapp/method-contract.unit.test.ts`：好/坏样例各若干（含 computed 形式、未知 group、未知 method、单段误调用），再加一次对 `bundled-miniapps` + skill examples 的全量扫描，沿用 `miniapp-script-syntax.test.ts` 的目录根，并带反空跑断言（确实扫到了文件、确实扫到了 `app.*` 调用）。
- `shoot-miniapp.mjs` 的新行为用 `bundled-miniapps/_e2e-fixtures/icon-generator` 实跑一次验证 —— 那个 fixture 现在是孤儿，没有任何东西跑它，正好当冒烟输入。

## 验证

- `npx tsc --noEmit`
- `npx vitest run --project unit`，与改动前 stash 出的基线逐文件对比（当前基线：22 个失败 / 8 个文件，全是 theme、MCP、Windows 路径那批先前就存在的）
- `node --import tsx/esm scripts/validate-miniapp.mts bundled-miniapps/*` 与 `.../_e2e-fixtures/*` 全绿
- `node scripts/shoot-miniapp.mjs bundled-miniapps/_e2e-fixtures/icon-generator` 真跑一遍，把报告贴出来
- `node scripts/audit-miniapp-style.mjs`（在 `npm run lint` 里，不能弄红）
- 故意造一个 `app.http.get(...)` 和一个方法名拼错的 app，确认两条闸都拦得住、报错带行号

## 不做的事

- 不做像素级视觉回归基线比对 —— 现在是「有 finding 就红」，加基线会引入另一套要维护的快照。
- 不把 Playwright 拉进 vitest：仓库里没有 playwright vitest 配置，浏览器部分保持独立 script（和现状一致）。
- 不改 `_e2e-fixtures` 之外的任何已提交 app 的内容 —— 如果第 5 步的全量扫描扫出既有 app 有方法错误，我先报给你再决定是修还是就地改文档。