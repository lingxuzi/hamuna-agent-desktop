/**
 * 社媒平台注册表 —— 静态定义（登录入口 + 登录成功判定 + 发布规格），不含任何运行时状态。
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
 *
 * ── 规格层（`SOCIAL_PLATFORM_SPECS`）────────────────────────────
 *
 * 规格回答的是「在这个平台上发一条内容需要知道什么」：形态、上限、发布页、作品
 * 列表页、数据页。放在这里而不是 agent 模板里，理由是**升级路径**：模板只在建
 * 工作区时拷一次，改了也不会补给老工作区；平台上限和后台路径是会变的，所以规格
 * 必须随 App 一起升级。规格通过 `hamuna platforms <id> --json` 交给 agent。
 *
 * **没核实过的字段宁可不给。** 缺字段 = "不知道，去现场探测"；给一个错 URL =
 * 发布线拿着错地址跑一圈然后失败。发布线拿到缺失的 URL 时从 `creatorHomeUrl`
 * 出发自己找入口，并把找到的实际路径记进工作区。
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
  /**
   * 登录态的 **cookie 判据**：这些 cookie 名里任意一个存在 = 已登录。
   *
   * **cookie 才是登录态的权威**，DOM 只是兜底 —— 这条字段存在的理由是抖音：
   *
   * 1. `creator.douyin.com` 扫码前后 URL 完全一样，URL 判定对它无意义；
   * 2. 登录成功那一刻页面会导航（`/` → `/creator-micro/home`），正在被销毁的
   *    JS 上下文里 `querySelectorAll` 会抛，探针读到的 `false` 与「确实没
   *    登录」在返回值上分不开 —— 于是判定永远不成立（2026-11 实战：cookie
   *    早就写进 jar 了，台账却还是 `accounts: []`）；
   * 3. 抖音的 `sessionid` 是 **HttpOnly**，`document.cookie` 根本读不到它 ——
   *    再多 DOM 探针也找不到登录证据。
   *
   * cookie 读的是 cookie jar，不碰页面上下文，导航吃不掉它。
   */
  loggedInCookieNames?: string[];
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
    // 登录态的权威：cookie。抖音的 `sessionid` 是 HttpOnly 的域 cookie
    // （`.douyin.com`），DOM 探针永远看不到它 —— 没有这条判据，扫码成功
    // 之后面板只会一直停在创作者中心。
    loggedInCookieNames: ['sessionid'],
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

// ---------------------------------------------------------------------------
// 规格层
// ---------------------------------------------------------------------------

/** 一个平台能承载的内容形态。 */
export type SocialMediaKind = 'image-text' | 'video' | 'article';

/**
 * 平台的硬限制。
 *
 * **这些数字会变。** 它们写在 App 里而不是 skill 里，是因为 skill 是 agent 读的
 * 提示词 —— 数字放进去，agent 会当真，而平台改上限时提示词不会跟着改。放这里
 * 至少能随 App 升级。
 *
 * `maxTitleLength` 指的是**平台那个「作品描述」框的行数上限**（抖音的标题就是
 * 描述的第一行），不是另一个字段。
 */
export interface SocialPlatformLimits {
  /** 标题 / 首行上限（字符）。 */
  maxTitleLength?: number;
  /** 正文上限（字符）。 */
  maxBodyLength?: number;
  /** 单条内容的图片张数上限。 */
  maxImages?: number;
  /** 单条内容的视频个数上限。 */
  maxVideos?: number;
  /** 话题标签个数上限。 */
  topicMaxCount?: number;
  /** 允许的图片扩展名（小写，不含点）。 */
  imageFormats?: readonly string[];
  /** 允许的视频扩展名（小写，不含点）。 */
  videoFormats?: readonly string[];
}

/**
 * 一个平台的发布规格。
 *
 * 字段全部可选，除了 `id` / `mediaKinds` / `creatorHomeUrl`。**缺字段的意思是
 * "还没核实"**，不是 "没有" —— 发布线遇到缺失的 URL 时从 `creatorHomeUrl`
 * 出发现场找入口，而不是拿一个猜的地址去撞。
 */
export interface SocialPlatformSpec {
  id: SocialPlatformId;
  /**
   * 这条素材能投的形态。
   *
   * 口径 = **平台接受 ∩ 我们现在能传**。不是平台能力表：抖音能收视频，但我们的
   * 浏览器通道一次只能内联 12 MiB（`browser_api.rs::MAX_UPLOAD_BYTES`），视频
   * 走不过去，所以现在抖音只有 `image-text`。通道打通后这里加 `'video'`。
   */
  mediaKinds: readonly SocialMediaKind[];
  /** 创作者后台首页（登录后的落点，也是发布入口所在页）。 */
  creatorHomeUrl: string;
  /** 发布页。缺 = 未核实，发布线自己从后台首页找入口。 */
  publishUrl?: string;
  /** 作品列表页 —— 回读核实（确认「真的发出去了」）用的那页。缺 = 未核实。 */
  workListUrl?: string;
  /** 数据页 —— 复盘读表现数据。缺 = 未核实。 */
  analyticsUrl?: string;
  /**
   * 达人榜 / 对标账号榜入口。缺 = 未核实。
   *
   * 冷启动找「方向相似的顶流对标账号」时要读的那页。跟 `publishUrl` 一样，
   * **缺字段 = 还没核实**，采集线要自己从 `creatorHomeUrl` 出发现场找入口，
   * 找到后回填到这里并记进 `memory/topics/<平台>.md`。
   */
  benchmarkUrl?: string;
  /**
   * 创作者后台的评论管理页 —— 读「观众在我们自己作品下面说了什么」。缺 = 未核实。
   *
   * 只读，不回。回评论 / 私信 / 加好友一律留给用户。
   */
  commentsUrl?: string;
  limits?: SocialPlatformLimits;
  /**
   * 未登录时页面上的文字标记。
   *
   * 抖音的创作者后台扫码前后 URL 完全一样（真机日志 2026-10-25 全程只有
   * `creator.douyin.com/`），URL 判不出登录，只能看页面上有没有登录墙。
   *
   * **这是启发式，方向是 fail-closed**：读到标记就当没登录，停下来让人扫一次码。
   * 误判成"没登录"只是多问一次；误判成"已登录"却真没登录，会在登录墙上点发布。
   */
  loginWallMarkers?: readonly string[];
  /** 规格来源与核验日期。给 agent 看的可信度提示。 */
  source?: string;
  verifiedAt?: string;
}

/**
 * 通用登录墙标记。
 *
 * 绝大多数平台未登录时，页面上会出现「扫码登录」「二维码」这类词。平台各自的
 * 文案会变，所以这是**启发式**：命中就当没登录，停下来让人扫一次码。
 *
 * 误判成"没登录"只是多问一次；误判成"已登录"却真没登录，会在登录墙上点发布 ——
 * 后者更糟，所以方向永远偏向"宁可停下"。
 */
export const COMMON_LOGIN_WALL_MARKERS: readonly string[] = [
  '扫码登录',
  '二维码',
  '立即登录',
  '登录/注册',
];

/**
 * 发布规格表。
 *
 * 来源标注（`source`）分三档：
 * - 「实测」—— 在本机跑通过，路径和选择器都对得上。
 * - 「平台文档」—— 来自平台官方文档的限制值。
 * - 「参考实现」—— 来自别的项目的常量，**本机未验证**，发布时以现场为准。
 *
 * 抖音的限制值（标题 30 / 正文 1000 / 图 12 / 话题 5）是平台侧的硬限制，
 * 跟我们的传输通道无关，所以照收。
 */
export const SOCIAL_PLATFORM_SPECS: readonly SocialPlatformSpec[] = [
  {
    id: 'douyin',
    mediaKinds: ['image-text'],
    creatorHomeUrl: 'https://creator.douyin.com/',
    publishUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    workListUrl: 'https://creator.douyin.com/creator-micro/content/manage',
    limits: {
      maxTitleLength: 30,
      maxBodyLength: 1000,
      maxImages: 12,
      maxVideos: 1,
      topicMaxCount: 5,
      imageFormats: ['jpg', 'jpeg', 'png', 'bmp'],
      videoFormats: ['mp4', 'avi', 'mkv', 'mov'],
    },
    // 登录墙浮层的文案。命中任意一个就当没登录。
    loginWallMarkers: ['扫码登录', '二维码', '登录后可发布'],
    source: '限制值来自抖音开放平台文档；URL 路径来自参考实现，本机未实测。',
    verifiedAt: '2026-11-15',
  },
  {
    id: 'xiaohongshu',
    mediaKinds: ['image-text'],
    creatorHomeUrl: 'https://creator.xiaohongshu.com/new/home',
    publishUrl: 'https://creator.xiaohongshu.com/publish/publish',
    workListUrl: 'https://creator.xiaohongshu.com/new/note-manager',
    source: '作品管理页来自本项目登录判定用例；发布页路径来自参考实现，本机未实测。',
    verifiedAt: '2026-11-15',
  },
  {
    id: 'kuaishou',
    mediaKinds: ['image-text'],
    creatorHomeUrl: 'https://cp.kuaishou.com/',
    source: '只核实了后台首页；发布页与作品列表页待实测。',
    verifiedAt: '2026-11-15',
  },
  {
    id: 'weixin-channels',
    mediaKinds: ['image-text'],
    creatorHomeUrl: 'https://channels.weixin.qq.com/',
    publishUrl: 'https://channels.weixin.qq.com/platform/post/create',
    source: '发布页路径来自参考实现，本机未实测。',
    verifiedAt: '2026-11-15',
  },
  {
    id: 'bilibili',
    mediaKinds: ['image-text'],
    creatorHomeUrl: 'https://member.bilibili.com/',
    publishUrl: 'https://member.bilibili.com/platform/upload/video/frame',
    source: '发布页路径来自参考实现，本机未实测。',
    verifiedAt: '2026-11-15',
  },
  {
    id: 'zhihu',
    mediaKinds: ['article'],
    creatorHomeUrl: 'https://www.zhihu.com/creator',
    source: '只核实了创作中心首页；发布页待实测。',
    verifiedAt: '2026-11-15',
  },
  {
    id: 'wechat-mp',
    mediaKinds: ['image-text'],
    creatorHomeUrl: 'https://mp.weixin.qq.com/',
    source: '只核实了后台首页；发布页待实测。',
    verifiedAt: '2026-11-15',
  },
];

/** 取一个平台的发布规格。找不到就抛 —— 台账里的平台 id 写错时要炸，不要静默。 */
export function getSocialPlatformSpec(id: SocialPlatformId): SocialPlatformSpec {
  const found = SOCIAL_PLATFORM_SPECS.find((p) => p.id === id);
  if (!found) throw new Error(`No publish spec for social platform: ${id}`);
  return found;
}

/**
 * 一条素材能不能投这个平台。
 *
 * 判定只问形态 —— 不问账号有没有连上、不问有没有到点、不问限没限流。那些是发布
 * 线的事，这里只回答"格式上可不可行"，好让排期阶段就把不匹配的素材挡掉。
 */
export function canPublishTo(spec: SocialPlatformSpec, kind: SocialMediaKind): boolean {
  return spec.mediaKinds.includes(kind);
}

/**
 * 发布侧看到的平台全貌 —— 登录表和规格表合并后的**单一对象**。
 *
 * 合并的理由：agent 一次只需要一个事实来源。分成两张表，agent 得自己判断
 * 「这个平台能不能靠 URL 判登录」「没有登录墙标记该怎么办」——那两件事都会
 * 猜错，而猜错的方向是「在登录墙上点发布」。
 *
 * `loginProbe` 把那一步也替 agent 做了：
 * - `'url'` —— URL 判得出（6 个平台）。用 `browser state` 的 url 比对
 *   `loggedInUrl.includes` / `excludes`。
 * - `'text'` —— URL 判不出（只有抖音，扫码前后同一个 URL）。用 `browser read`
 *   的正文比对 `loginWallMarkers`，命中就算没登录。
 */
export interface SocialPlatformPublishProfile extends SocialPlatformSpec {
  /** 登录入口（人工扫码 / 密码登录时打开这个）。 */
  loginUrl: string;
  /** URL 判定规则。`loginProbe === 'text'` 时它不参与判定。 */
  loggedInUrl: { includes: string; excludes?: string[] };
  /** 登录后才出现的元素选择器。agent 目前没有选择器探针，所以它只是线索。 */
  loggedInSelector?: string;
  /** 登录墙元素选择器。同上。 */
  loggedOutSelector?: string;
  /** agent 该用哪种探针判登录。 */
  loginProbe: 'url' | 'text';
  /** 登录墙文字标记。永远有值 —— 缺了就得靠猜，猜错方向是「在登录墙上点发布」。 */
  loginWallMarkers: readonly string[];
}

/** 合并登录表和规格表。找不到就抛 —— 台账里的平台 id 写错时要炸，不要静默。 */
export function getSocialPlatformPublishProfile(id: SocialPlatformId): SocialPlatformPublishProfile {
  const def = getSocialPlatform(id);
  const spec = getSocialPlatformSpec(id);
  return {
    ...spec,
    loginUrl: def.loginUrl,
    loggedInUrl: def.loggedInUrl,
    loggedInSelector: def.loggedInSelector,
    loggedOutSelector: def.loggedOutSelector,
    // 抖音的 URL 扫码前后完全一样，所以 URL 探针对它无意义 —— 有选择器判据的
    // 平台一律走文本探针。
    loginProbe: def.loggedInSelector ? 'text' : 'url',
    loginWallMarkers: spec.loginWallMarkers ?? COMMON_LOGIN_WALL_MARKERS,
  };
}

/** 全部平台的发布侧全貌。 */
export function listSocialPlatformPublishProfiles(): SocialPlatformPublishProfile[] {
  return SOCIAL_PLATFORMS.map((def) => getSocialPlatformPublishProfile(def.id));
}

/**
 * 清登录态时要扫的 cookie 域（含父域），越宽越靠后。
 *
 * 「重新登录」不是「再打开一次登录页」：cookie 还在 jar 里，探针一命中就把
 * 人弹回面板 —— 用户以为自己在重登，实际什么都没发生。真正重登必须先清掉这
 * 个平台写下的 cookie。
 *
 * **为什么要带父域**：抖音的 `sessionid` 挂在 `.douyin.com` 上、登录页在
 * `creator.douyin.com`；只清精确 host 会留下那条 cookie，「重登」立刻秒判成功。
 *
 * 返回的是**域后缀**，调用方按 `cookie.domain` 做后缀匹配（与
 * `cmd_browser_cookie_names` 同一套 `cookie_domain_matches_host` 口径）。
 */
export function loginCookieDomains(platform: SocialPlatformDefinition): string[] {
  const host = hostOf(platform.loginUrl);
  if (!host) return [];
  const parts = host.split('.');
  // **只上探一级**：creator.douyin.com → douyin.com；channels.weixin.qq.com →
  // weixin.qq.com。再往上就是公共后缀（com / qq.com），清抖音顺手把人 QQ 登录
  // 也清了。`ponytail:` 不引公共后缀表 —— 七个平台的登录页都只有一级子域，
  // 真需要时再换 `tldts`。
  if (parts.length <= 2) return [host];
  return [host, parts.slice(1).join('.')];
}

/**
 * 清掉 `platform` 的登录态会连带退出的**其它平台**。
 *
 * 视频号和微信公众号都用 `weixin.qq.com` 的 cookie 域：清视频号时那条父域
 * cookie 一删，公众号也掉线。台账必须跟着改 —— 否则界面写着「已登录」，发布
 * 时却撞登录墙，那种不一致比多登一次号糟得多。
 *
 * 判定是**双向包含**：谁的扫域集合与谁相交，谁就受牵连。
 */
function platformsSharingLoginCookies(platform: SocialPlatformDefinition): SocialPlatformId[] {
  const mine = new Set(loginCookieDomains(platform));
  return SOCIAL_PLATFORMS.filter((other) => {
    if (other.id === platform.id) return false;
    return loginCookieDomains(other).some((domain) => mine.has(domain));
  }).map((other) => other.id);
}

/**
 * 「退出并重新登录」要动的那一组。
 *
 * `domains` 是要清空的 cookie 域 —— **自平台与受牵连平台域的合集**。合集不是
 * 多余：公众号的会话 cookie 挂在 host-only 的 `mp.weixin.qq.com` 上，只清
 * `weixin.qq.com` 那条共享 cookie 并不足以让它真的掉线；台账说它退出了、
 * 实际上还能用，又是另一种不一致。
 *
 * `siblings` 是受牵连的平台 id：它们的登录态一起没了，台账要跟着改。
 */
export interface LoginCookieGroup {
  /** 要清空的 cookie 域（含父域）。 */
  domains: string[];
  /** 受牵连的其它平台。 */
  siblings: SocialPlatformId[];
}

export function loginCookieGroup(platform: SocialPlatformDefinition): LoginCookieGroup {
  const siblings = platformsSharingLoginCookies(platform);
  const domains = new Set(loginCookieDomains(platform));
  for (const id of siblings) {
    for (const domain of loginCookieDomains(getSocialPlatform(id))) domains.add(domain);
  }
  return { domains: [...domains], siblings };
}

/** 从 URL 里取 host（小写，去掉协议、用户信息、端口、路径）。 */
function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  if (!match) return '';
  const authority = match[1];
  const at = authority.lastIndexOf('@');
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const colon = hostPort.lastIndexOf(':');
  return (colon >= 0 ? hostPort.slice(0, colon) : hostPort).toLowerCase();
}

/**
 * 平台允许发布的 host 集合。
 *
 * 来自规格里的**创作者后台**地址（首页 / 发布页 / 作品列表页），不是登录入口 ——
 * B 站在 `passport.bilibili.com` 登录、在 `member.bilibili.com` 发布，用登录域名
 * 判会把发布页判成"不在本平台"。
 *
 * 空集合 = 这个平台的后台地址还没核实（规格里只有形态没有地址）→ 发布一律
 * 拒绝。缺字段是"不知道"，不是"哪里都能发"。
 */
export function getSocialPlatformPublishHosts(id: SocialPlatformId): readonly string[] {
  const spec = getSocialPlatformSpec(id);
  const hosts = new Set<string>();
  for (const url of [spec.creatorHomeUrl, spec.publishUrl, spec.workListUrl]) {
    if (!url) continue;
    const host = hostOf(url);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/**
 * 当前 URL 是否落在该平台的创作者后台域内。
 *
 * 用来把"给某平台的无人值守发布授权"限定在那个平台的后台里。授权是按平台给的，
 * 不是一张"在哪个页面都能发"的空白支票 —— 否则 `--platform douyin` 只是个标签，
 * 授权也就名不副实。
 *
 * 精确匹配 host（不匹配子域）：`evil.creator.douyin.com` 不是抖音后台。
 */
export function isPlatformPublishHost(id: SocialPlatformId, url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return getSocialPlatformPublishHosts(id).includes(host);
}

/**
 * 一个社媒平台的**发布授权**。
 *
 * 这里只剩授权，不再装账号。账号（哪个号、叫什么、登录没登录）是**工作区级**
 * 的事，落在工作区台账 `ops/state.json` 的 `accounts` 里 —— 新建一个工作区
 * 就是一套新的账号体系，两个工作区的登录态互不可见。
 *
 * 授权反过来是**本机 + 平台级**的能力开关：用户在这台机器上允许某个平台被
 * 无人值守地发布，与哪个工作区的号无关，所以它留在设置里，全工作区共享一份。
 *
 * 登录态的权威是浏览器 cookie（各自的浏览器 profile），不在这里 —— 所以这个
 * 类型里一个登录态字段都没有。留着它们会造出第二份真相：全局一份写着
 * 「已登录」、工作区一份写着「未登录」，界面显示哪一份全看谁先被读到。
 */
export interface SocialAccount {
  /**
   * 用户显式授权的「无人值守发布」。
   *
   * **只有设置页能写。** `hamuna config set` 写不了 `socialAccounts`（admin-api
   * 的 protectedKeys 挡住了整个根键），agent 不能给自己发授权。
   *
   * 授权的含义 = 「在这个平台的创作者后台域内，发布不用再弹审批」。域内判定
   * 见 `isPlatformPublishHost` —— 授权按平台给，不是一张空白支票。
   */
  autoPublish?: boolean;
}

/**
 * 账号表里是否已经授权某平台无人值守发布。纯函数，便于单测。
 *
 * 参数收 `unknown` 是因为两边的读法不一样：renderer 拿的是
 * `AppConfig.socialAccounts`（有类型），Sidecar 拿的是 `AdminAppConfig` 的
 * 透传字段（无类型）。运行时形状不对就当没授权。
 *
 * 缺字段 = 没授权。方向永远偏向"没授权"：误判成"没授权"多问一次用户，误判成
 * "已授权"就会在用户不知情的情况下把内容发出去。
 */
export function isAutoPublishGranted(accounts: unknown, platformId: string): boolean {
  if (!accounts || typeof accounts !== 'object') return false;
  const account = (accounts as Record<string, unknown>)[platformId];
  if (!account || typeof account !== 'object') return false;
  return (account as { autoPublish?: unknown }).autoPublish === true;
}

export function getSocialPlatform(id: SocialPlatformId): SocialPlatformDefinition {
  const found = SOCIAL_PLATFORMS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown social platform: ${id}`);
  return found;
}

/** 平台 id 是否受支持。用来挡掉拼错的 id —— 错 id 会一路走到「查规格」那步才炸。 */
export function isSocialPlatformId(id: string): id is SocialPlatformId {
  return SOCIAL_PLATFORMS.some((p) => p.id === id);
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
 * 用探针结果裁定登录态。纯函数，便于单测。
 *
 * 判据按**权威性**排序：cookie → DOM → URL。
 *
 * cookie 命中就是登录成功，不再往下问 —— cookie 是登录态本身，DOM 只是它在
 * 页面上的投影。抖音这条尤其要紧：登录成功那刻页面在导航，DOM 探针正在被
 * 销毁的上下文里，读回来的 `false` 与「没登录」分不开（2026-11 实战：cookie
 * 早就有了，判定却永远不成立）。
 *
 * cookie 没命中**不等于**没登录（可能还没扫码，也可能 cookie 是刚种下的），
 * 所以继续用 DOM / URL 兜底。
 *
 * `loggedInSelector` 平台用「登录后元素可见 且 登录墙元素不可见」这对手性
 * 信号（Easel 同款）；其余平台回落到 URL 白名单。
 */
export function resolveLoginState(
  platform: SocialPlatformDefinition,
  probe: {
    url: string;
    loggedInVisible?: boolean;
    loggedOutVisible?: boolean;
    /** 平台声明的登录 cookie 里，是否有命中的（由 `cmd_browser_cookie_names` 给出）。 */
    loggedInCookie?: boolean;
  },
): boolean {
  if (platform.loggedInCookieNames?.length && probe.loggedInCookie) return true;
  if (platform.loggedInSelector) {
    if (!probe.loggedInVisible) return false;
    if (platform.loggedOutSelector && probe.loggedOutVisible) return false;
    return true;
  }
  return isLoggedInUrl(platform, probe.url);
}

/**
 * 把一次授权变更写进整张 `socialAccounts` 表。
 *
 * 存在的唯一理由：写盘时的合并必须是**按平台**的。`updateConfig({ socialAccounts })`
 * 在根上浅合并 —— 改一次小红书的授权会把抖音/快手的记录整条冲掉。这个函数把
 * 「按平台合并」这条不变量变成可断言的东西，而不是靠调用方记得写 spread。
 *
 * 平台条目是**整条替换**，不是逐字段合并：老配置里存过 `displayName` /
 * `lastLoginState` / `lastCheckedAt`（全局账号表时代留下的），那些字段已经
 * 搬到工作区台账去了。留着它们 = 全局与工作区各存一份登录态，两份迟早打架。
 */
export function withSocialAccount(
  previous: Record<string, SocialAccount> | undefined,
  platformId: SocialPlatformId,
  patch: Partial<SocialAccount>,
): Record<string, SocialAccount> {
  const base = { ...previous };
  const autoPublish = patch.autoPublish ?? base[platformId]?.autoPublish;
  base[platformId] = autoPublish === undefined ? {} : { autoPublish };
  return base;
}
