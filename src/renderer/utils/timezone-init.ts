/**
 * 强制全 app 时区 = Asia/Shanghai — 用户拍板 "全 app 显示强制用 Asia/Shanghai"（跨时区用户也看北京时间）。
 *
 * 实现思路：monkey-patch `Intl.DateTimeFormat` 构造函数，把 `timeZone` 作为默认注入；
 * 不显式传 `options.timeZone` 的所有路径（`Date.toLocaleString()` / `toLocaleTimeString()` /
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`）都自动拿到 Asia/Shanghai；
 * 显式传 `options.timeZone` 的路径（如 cron 任务"用户时区 = Asia/Tokyo"）通过 spread
 * 让用户的值覆盖默认 — 用户主动选过的 timezone 永远不会被吞。
 *
 * **必须**在 app 入口（main.tsx 顶部）首 import，先于任何用到 Intl / Date.toLocale* 的代码；
 * 本模块自身也用 `export {}` 保 side-effect 不被 tree-shake 掉。
 *
 * `Intl.DateTimeFormat.supportedLocalesOf` 等静态方法在 ES6 class extends 链上自动继承，
 * 不需要手动 copy。`format` / `formatToParts` / `formatRange` 走 prototype，继承也 OK。
 *
 * **必须保留「不用 new 也能调用」**：ECMA-402 里 `Intl.DateTimeFormat` 本身是
 * `DateTimeFormat(...)` 和 `new DateTimeFormat(...)` 都合法的。直接拿 ES6 class 顶上去会
 * 只剩 `new` 一种形式，于是任何裸调用（`Intl.DateTimeFormat().resolvedOptions()`）
 * 抛 "Class constructor cannot be invoked without 'new'"，把整个 ScheduleTypeTabs 挂掉。
 * 故用 Proxy 补一个 apply trap 把裸调用转成 `new`，其余行为（静态方法 / prototype /
 * instanceof）全部原样转发。
 */

const APP_TIMEZONE = 'Asia/Shanghai';
const OriginalDateTimeFormat = Intl.DateTimeFormat;

class AppDateTimeFormat extends OriginalDateTimeFormat {
  constructor(
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    super(locales, { timeZone: APP_TIMEZONE, ...options });
  }
}

// ponytail: 不动 server 端 / Tauri Rust 端（它们用 chrono::Utc / SystemTime::now()，无 timezone 概念）；
// 升级路径：若未来用户想要"按 OS locale 自适应"，把 override 改成读 env var / 用户设置，
// 或在 apply/construct trap 里按语言路由（zh → Asia/Shanghai, en → America/Los_Angeles 等）。
Intl.DateTimeFormat = new Proxy(AppDateTimeFormat, {
  apply: (target, _thisArg, args) => new target(...args),
}) as unknown as typeof Intl.DateTimeFormat;

export {}; // 纯 side-effect module：保证 bundler 不 tree-shake