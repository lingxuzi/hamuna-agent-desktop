/**
 * 社媒平台注册表 —— 静态定义（登录入口 + 登录成功判定），不含任何运行时状态。
 *
 * 运行时登录记忆在 `AppConfig.socialAccounts`。分开的理由：这张表要同时被
 * renderer（设置页）和未来的发布侧 / hook 读取，放 `shared/` 才不会两边漂移。
 *
 * 判定有两条路，按平台选：
 * - `loggedInUrl`：登录后换域 → 听 `browser:url-changed` 即可（6 个平台都适用）。
 * - `loggedInSelector`：登录后 URL 原地不动 → 只能问页面要元素。抖音是这种情况，
 *   而且是唯一一个：`creator.douyin.com` 扫码前后 URL 完全一致（真机日志 2026-10-25
 *   全程只有 `creator.douyin.com/`，`creator-micro` 从未出现），所以 URL 白名单在
 *   抖音上永不可能命中。Easel 同样给抖音开了专用判定
 *   （`douyin_publish.py::_logged_in`：无二维码 且 有「高清发布」按钮）。
 */

export type SocialPlatformId =
  | 'xiaohongshu'
  | 'douyin'
  | 'kuaishou'
  | 'weixin-channels'
  | 'bilibili'
  | 'zhihu'
  | 'wechat-mp';

export interface SocialPlatformDefinition {
  id: SocialPlatformId;
  /** 两个字的角标，替代品牌图标（不引入图标库）。 */
  badge: string;
  /** 登录入口。打开后用户扫码 / 密码登录。 */
  loginUrl: string;
  /**
   * 登录成功的 URL 判定：小写 URL 命中 `includes` 且不命中 `excludes` 即判成功。
   * `excludes` 防的是「登录入口本身就在目标域名下」的情况（小红书 / 快手 / 视频号）。
   */
  loggedInUrl: { includes: string; excludes?: string[] };
  /**
   * 登录成功的 DOM 判定（CSS 选择器，任一元素可见即算成功）。
   *
   * **给了它就是唯一判据**，`loggedInUrl` 对该平台不再参与判定 —— 因为需要它
   * 的平台恰恰是 URL 判不出登录的那些。抖音的 `loggedInUrl` 仍保留（发布侧
   * 可能要按域名归属判断），只是这里不用。
   */
  loggedInSelector?: string;
  /**
   * 登录墙元素（CSS 选择器）。与 `loggedInSelector` 配套成对使用：只有
   * 「登录后元素可见 **且** 登录墙元素不可见」才算登录成功。
   *
   * 单靠 `loggedInSelector` 会在登录墙弹出时误判 —— SPA 把创作者后台的
   * 外壳节点留在 DOM 里、上面盖一层扫码浮层。Easel 的抖音判定是同一对手性
   * 检查（`douyin_publish.py::_logged_in`：无二维码 且 有高清发布按钮）。
   */
  loggedOutSelector?: string;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatformDefinition[] = [
  {
    id: 'xiaohongshu',
    badge: '小红',
    loginUrl: 'https://creator.xiaohongshu.com/login',
    loggedInUrl: { includes: 'creator.xiaohongshu.com', excludes: ['login'] },
  },
  {
    id: 'douyin',
    badge: '抖音',
    loginUrl: 'https://creator.douyin.com/',
    // creator.douyin.com 的 URL 扫码前后完全一致，URL 判定对它无意义；
    // 真正的信号是登录后才出现的「高清发布」主按钮（选择器取自 Easel
    // douyin_publish.py::SELECTORS["hd_publish"]，真机验证过）。
    loggedInUrl: { includes: 'creator.douyin.com' },
    loggedInSelector:
      'button[class*="douyin-creator-master-button"], #douyin-creator-master-side-upload-wrap button',
    loggedOutSelector:
      'img[class*="qr"], [class*="qrcode"] img, [class*="qrcode"] canvas, img[aria-label="二维码"]',
  },
  {
    id: 'kuaishou',
    badge: '快手',
    // 直接进 passport 登录页：cp.kuaishou.com 本身是营销落地页，
    // 未登录时也停在那里，URL 上分辨不出来。
    loginUrl: 'https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api',
    loggedInUrl: { includes: 'cp.kuaishou.com', excludes: ['passport', 'login'] },
  },
  {
    id: 'weixin-channels',
    badge: '视频',
    loginUrl: 'https://channels.weixin.qq.com',
    loggedInUrl: { includes: 'channels.weixin.qq.com', excludes: ['login'] },
  },
  {
    id: 'bilibili',
    badge: 'B站',
    loginUrl: 'https://passport.bilibili.com/login',
    // 登录后落点不稳定（member.bilibili.com 或 www.bilibili.com），只排除 passport 域。
    loggedInUrl: { includes: 'bilibili.com', excludes: ['passport'] },
  },
  {
    id: 'zhihu',
    badge: '知乎',
    loginUrl: 'https://www.zhihu.com/signin',
    loggedInUrl: { includes: 'zhihu.com', excludes: ['signin', 'login'] },
  },
  {
    id: 'wechat-mp',
    badge: '公众号',
    loginUrl: 'https://mp.weixin.qq.com/',
    loggedInUrl: { includes: 'cgi-bin/home' },
  },
];

/**
 * 一个社媒平台的账号记忆。
 *
 * **这不是登录态的权威。** 登录态的唯一权威是内嵌浏览器里那份 cookie 的现场
 * 状态（`browser.rs` 的 webview 不带 `data_directory`，全 App 共用一个
 * WebKit/WebView2 数据目录 —— 用户在任意 Tab 登录一次，所有 agent 的
 * `hamuna browser` 就是登录态）。这里只记「上次真正确认登录成功」的结果，
 * 供设置页展示和 agent 决策参考；任何发布前置校验 MUST 现场探一次，
 * 不得仅凭 `lastLoginState` 放行。
 */
export interface SocialAccount {
  /** 平台侧显示的账号名，用户手填（渲染器没有 eval 通道，读不到页面上的昵称）。 */
  displayName?: string;
  /** L1 记忆层。`unknown` = 从未登录过或从未校验过。 */
  lastLoginState: 'success' | 'expired' | 'unknown';
  /** 上次写入 `lastLoginState` 的 Unix 秒。 */
  lastCheckedAt?: number;
}

export function getSocialPlatform(id: SocialPlatformId): SocialPlatformDefinition {
  const found = SOCIAL_PLATFORMS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown social platform: ${id}`);
  return found;
}

/** 当前 URL 是否可判定为该平台「已登录」。纯函数，便于单测。 */
export function isLoggedInUrl(platform: SocialPlatformDefinition, url: string): boolean {
  const lower = url.toLowerCase();
  if (!lower.startsWith('http')) return false;
  if (!lower.includes(platform.loggedInUrl.includes)) return false;
  return !platform.loggedInUrl.excludes?.some((marker) => lower.includes(marker));
}

/**
 * 该平台能否只靠 URL / 只靠页内元素判出登录。
 *
 * `loggedInSelector` 需要 renderer 主动向页面查询（URL 事件对它不触发），
 * 所以设置页要按这个值决定是否开轮询。
 */
export function needsSelectorProbe(platform: SocialPlatformDefinition): boolean {
  return Boolean(platform.loggedInSelector);
}

/**
 * 用两条探针结果裁定登录态。纯函数，便于单测。
 *
 * `loggedInSelector` 平台用「登录后元素可见 且 登录墙元素不可见」这对手性
 * 信号（Easel 同款）；其余平台回落到 URL 白名单。
 */
export function resolveLoginState(
  platform: SocialPlatformDefinition,
  probe: { url: string; loggedInVisible?: boolean; loggedOutVisible?: boolean },
): boolean {
  if (platform.loggedInSelector) {
    if (!probe.loggedInVisible) return false;
    if (platform.loggedOutSelector && probe.loggedOutVisible) return false;
    return true;
  }
  return isLoggedInUrl(platform, probe.url);
}

/**
 * 把一次账号变更合并进整张 `socialAccounts` 表。
 *
 * 存在的唯一理由：写盘时的合并必须是**按平台**的。`updateConfig({ socialAccounts })`
 * 在根上浅合并 —— 登一次小红书会把抖音/快手的记录整条冲掉。这个函数把「按平台合并」
 * 这条不变量变成可断言的东西，而不是靠调用方记得写 spread。
 */
export function withSocialAccount(
  previous: Record<string, SocialAccount> | undefined,
  platformId: SocialPlatformId,
  patch: Partial<SocialAccount>,
): Record<string, SocialAccount> {
  return {
    ...previous,
    [platformId]: {
      lastLoginState: 'unknown',
      ...previous?.[platformId],
      ...patch,
    },
  };
}
