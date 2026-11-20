import { describe, expect, it } from 'vitest';
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_SPECS,
  canPublishTo,
  getSocialPlatform,
  getSocialPlatformPublishProfile,
  getSocialPlatformPublishHosts,
  getSocialPlatformSpec,
  isAutoPublishGranted,
  isLoggedInUrl,
  isPlatformPublishHost,
  isSocialPlatformId,
  listSocialPlatformPublishProfiles,
  loginCookieDomains,
  loginCookieGroup,
  needsSelectorProbe,
  resolveLoginState,
  withSocialAccount,
  type SocialAccount,
} from './socialPlatforms';

const check = (id: Parameters<typeof getSocialPlatform>[0], url: string) =>
  isLoggedInUrl(getSocialPlatform(id), url);

describe('isLoggedInUrl', () => {
  it('小红书：登录页不算登录，工作台算', () => {
    expect(check('xiaohongshu', 'https://creator.xiaohongshu.com/login')).toBe(false);
    expect(check('xiaohongshu', 'https://creator.xiaohongshu.com/new/home')).toBe(true);
    // SPA 路由里的 login 字样不能被误判成已登录，也不能把工作台误判成登录页
    expect(check('xiaohongshu', 'https://creator.xiaohongshu.com/new/note-manager')).toBe(true);
  });

  it('抖音：URL 不参与判定（扫码前后同一个 URL），走选择器', () => {
    // 真机日志里 `creator-micro` 从未出现过 —— 曾经写它当判据导致永远判不出登录。
    const douyin = getSocialPlatform('douyin');
    expect(needsSelectorProbe(douyin)).toBe(true);
    expect(douyin.loggedInSelector).toContain('douyin-creator-master-button');
    expect(douyin.loggedOutSelector).toContain('qrcode');
  });

  it('抖音：cookie 判据是 sessionid（登录态的权威）', () => {
    // 2026-11 实战：扫码成功了，判定却永远不成立 —— cookie 早就写进 jar
    // （`sessionid`，HttpOnly，域 `.douyin.com`），DOM 探针在登录那刻的导航里
    // 读不到东西。cookie 判据是补这条的。
    const douyin = getSocialPlatform('douyin');
    expect(douyin.loggedInCookieNames).toContain('sessionid');
  });

  it('快手：passport 不算登录，创作者中心算', () => {
    // 快手未登录时 cp.kuaishou.com 停在营销落地页，URL 上与已登录分不开——
    // 所以入口直接给 passport 登录页，判定只认 cp 域。从 passport 出发的用户
    // 到达 cp 域必然是登录后的跳转（已登录则 passport 自己就 redirect 过去）。
    expect(check('kuaishou', 'https://passport.kuaishou.com/pc/account/login/')).toBe(false);
    expect(check('kuaishou', 'https://cp.kuaishou.com/article/manage/video')).toBe(true);
  });

  it('非 http(s) 一律不算登录（data: 空页、about:blank）', () => {
    expect(check('zhihu', 'data:text/html,<html></html>')).toBe(false);
    expect(check('zhihu', 'about:blank')).toBe(false);
  });

  it('知乎：signin 页不算，主页算', () => {
    expect(check('zhihu', 'https://www.zhihu.com/signin')).toBe(false);
    expect(check('zhihu', 'https://www.zhihu.com/')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(check('bilibili', 'https://MEMBER.BILIBILI.COM/home')).toBe(true);
  });

  it('B站：passport 不算登录，登录后落 member 或 www 都算', () => {
    expect(check('bilibili', 'https://passport.bilibili.com/login')).toBe(false);
    expect(check('bilibili', 'https://www.bilibili.com/')).toBe(true);
  });

  it('公众号：首页不算登录，登录后进 cgi-bin/home', () => {
    expect(check('wechat-mp', 'https://mp.weixin.qq.com/')).toBe(false);
    expect(check('wechat-mp', 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index')).toBe(true);
  });

  it('注册表 id 唯一且都有登录入口', () => {
    const ids = SOCIAL_PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SOCIAL_PLATFORMS) expect(p.loginUrl).toMatch(/^https:/);
  });
});

describe('resolveLoginState', () => {
  const douyin = getSocialPlatform('douyin');
  const zhihu = getSocialPlatform('zhihu');

  it('抖音：高清发布按钮可见且二维码不在 → 已登录', () => {
    expect(
      resolveLoginState(douyin, {
        url: 'https://creator.douyin.com/',
        loggedInVisible: true,
        loggedOutVisible: false,
      }),
    ).toBe(true);
  });

  it('抖音：登录墙还在 → 未登录，哪怕后台外壳按钮已挂进 DOM', () => {
    expect(
      resolveLoginState(douyin, {
        url: 'https://creator.douyin.com/',
        loggedInVisible: true,
        loggedOutVisible: true,
      }),
    ).toBe(false);
  });

  it('抖音：按钮还没渲染出来 → 未登录（URL 域名为真也不能放行）', () => {
    expect(
      resolveLoginState(douyin, {
        url: 'https://creator.douyin.com/',
        loggedInVisible: false,
        loggedOutVisible: false,
      }),
    ).toBe(false);
  });

  it('抖音：cookie 命中 = 已登录，哪怕 DOM 探针什么都读不到', () => {
    // 这是 2026-11 那次事故的正脸：登录成功那一刻页面导航（`/` →
    // `/creator-micro/home`），DOM 探针在正被销毁的上下文里抛 / 读回 false。
    // cookie 命中就是登录成功 —— 它是登录态本身，不是它的投影。
    expect(
      resolveLoginState(douyin, {
        url: 'https://creator.douyin.com/',
        loggedInCookie: true,
        loggedInVisible: false,
        loggedOutVisible: true,
      }),
    ).toBe(true);
  });

  it('抖音：cookie 没命中不直接判未登录（cookie 可能刚种下）', () => {
    // 保守方向：cookie 是权威，但没有 cookie 不代表没登录，DOM / URL 继续兜底。
    expect(
      resolveLoginState(douyin, {
        url: 'https://creator.douyin.com/',
        loggedInCookie: false,
        loggedInVisible: true,
        loggedOutVisible: false,
      }),
    ).toBe(true);
  });

  it('没声明 cookie 判据的平台不理会 cookie 探针', () => {
    // 免得以后哪个平台随手传个 cookie 标记就把 URL 判定整个盖掉。
    const zhihu = getSocialPlatform('zhihu');
    expect(zhihu.loggedInCookieNames).toBeUndefined();
    expect(
      resolveLoginState(zhihu, {
        url: 'https://www.zhihu.com/signin',
        loggedInCookie: true,
      }),
    ).toBe(false);
  });

  it('URL 判定的平台不理会选择器字段', () => {
    expect(needsSelectorProbe(zhihu)).toBe(false);
    expect(resolveLoginState(zhihu, { url: 'https://www.zhihu.com/' })).toBe(true);
    expect(resolveLoginState(zhihu, { url: 'https://www.zhihu.com/signin' })).toBe(false);
  });

  it('只有抖音需要选择器探针', () => {
    const probing = SOCIAL_PLATFORMS.filter(needsSelectorProbe).map((p) => p.id);
    expect(probing).toEqual(['douyin']);
  });
});

describe('发布规格层', () => {
  it('每个登录平台都有规格，规格 id 唯一', () => {
    // 规格表和登录表是两张表，但必须覆盖同一批平台 —— 少一个就意味着
    // 「登录得上却没法发」。
    const specIds = SOCIAL_PLATFORM_SPECS.map((s) => s.id);
    expect(new Set(specIds).size).toBe(specIds.length);
    for (const p of SOCIAL_PLATFORMS) {
      expect(specIds).toContain(p.id);
    }
  });

  it('规格里的 URL 都是 https', () => {
    for (const spec of SOCIAL_PLATFORM_SPECS) {
      expect(spec.creatorHomeUrl).toMatch(/^https:/);
      for (const url of [spec.publishUrl, spec.workListUrl, spec.analyticsUrl]) {
        if (url) expect(url).toMatch(/^https:/);
      }
    }
  });

  it('抖音：图文和视频都可投（视频走分片上传通道）', () => {
    const douyin = getSocialPlatformSpec('douyin');
    expect(canPublishTo(douyin, 'image-text')).toBe(true);
    // 视频走 chunked upload：文件切片内联进页面，页面自己拼成 File。
    expect(canPublishTo(douyin, 'video')).toBe(true);
  });

  it('抖音的限制值是平台侧的硬限制，不受传输通道影响', () => {
    const douyin = getSocialPlatformSpec('douyin');
    expect(douyin.limits?.maxTitleLength).toBe(30);
    expect(douyin.limits?.maxImages).toBe(12);
    expect(douyin.limits?.topicMaxCount).toBe(5);
  });

  it('没核实的 URL 宁可缺着也不给猜的地址', () => {
    // 缺字段 = 「现场探测」，给错地址 = 发布线拿着错 URL 跑一圈再失败。
    for (const spec of SOCIAL_PLATFORM_SPECS) {
      for (const url of [spec.publishUrl, spec.workListUrl, spec.analyticsUrl]) {
        if (url) expect(url).not.toContain(' ');
      }
    }
    expect(getSocialPlatformSpec('kuaishou').publishUrl).toBeUndefined();
  });

  it('未知平台 id 直接炸，不静默返回空规格', () => {
    expect(() => getSocialPlatformSpec('not-a-platform' as never)).toThrow();
  });

  it('抖音的对标入口是实测的搜索页筛选面板，不是猜出来的地址', () => {
    // 抖音没有独立的达人榜页 —— 「对标账号」是搜索页筛选面板里的一个维度
    // （实测 2026-09-15）。这一格以前是空的，冷启动的采集线每次都要现场摸索。
    const entry = getSocialPlatformSpec('douyin').benchmarkEntry;
    expect(entry).toBeDefined();
    expect(entry).toContain('douyin.com/search/');
    expect(entry).toContain('对标账号');
  });
});

describe('发布侧平台全貌（登录表 + 规格表合并）', () => {
  it('抖音走文本探针 —— 扫码前后 URL 一样，URL 判不出登录', () => {
    const douyin = getSocialPlatformPublishProfile('douyin');
    expect(douyin.loginProbe).toBe('text');
    expect(douyin.loginWallMarkers.length).toBeGreaterThan(0);
  });

  it('其余平台走 URL 探针，且登录墙标记永远有值', () => {
    for (const profile of listSocialPlatformPublishProfiles()) {
      if (profile.id === 'douyin') continue;
      expect(profile.loginProbe).toBe('url');
      // 缺了标记就得靠猜，猜错的方向是「在登录墙上点发布」。
      expect(profile.loginWallMarkers.length).toBeGreaterThan(0);
    }
  });

  it('每个平台都带得上登录入口', () => {
    for (const profile of listSocialPlatformPublishProfiles()) {
      expect(profile.loginUrl).toMatch(/^https:/);
    }
  });
});

describe('withSocialAccount', () => {
  it('写一个平台不丢其他平台的记录（浅合并会丢，这是它存在的理由）', () => {
    const before = {
      xiaohongshu: { autoPublish: true },
      douyin: { autoPublish: false },
    };
    const after = withSocialAccount(before, 'zhihu', { autoPublish: true });
    expect(after.douyin).toEqual({ autoPublish: false });
    expect(after.xiaohongshu).toEqual({ autoPublish: true });
    expect(after.zhihu.autoPublish).toBe(true);
  });

  it('整条替换：老配置里的全局账号字段（displayName / lastLoginState）不留在授权条目里', () => {
    // 全局账号表已经搬到工作区台账。留着旧字段 = 全局一份登录态、工作区一份
    // 登录态，两份迟早打架（老的那份还写着「已登录」）。
    const before = {
      xiaohongshu: {
        displayName: '主号',
        lastLoginState: 'success',
        lastCheckedAt: 1760000000,
        autoPublish: true,
      },
    } as unknown as Record<string, SocialAccount>;
    const after = withSocialAccount(before, 'xiaohongshu', { autoPublish: false });
    expect(after.xiaohongshu).toEqual({ autoPublish: false });
  });

  it('没带 autoPublish 的补丁保留原有授权', () => {
    const before = { xiaohongshu: { autoPublish: true } };
    expect(withSocialAccount(before, 'xiaohongshu', {}).xiaohongshu).toEqual({ autoPublish: true });
  });

  it('没有历史记录时不凭空造出授权', () => {
    expect(withSocialAccount(undefined, 'bilibili', {}).bilibili).toEqual({});
  });
});

describe('发布范围（授权能覆盖哪些域名）', () => {
  it('抖音的发布页在授权范围内，其它域不在', () => {
    expect(isPlatformPublishHost('douyin', 'https://creator.douyin.com/creator-micro/content/upload')).toBe(true);
    expect(isPlatformPublishHost('douyin', 'https://creator.douyin.com/')).toBe(true);
    expect(isPlatformPublishHost('douyin', 'https://www.douyin.com/')).toBe(false);
    expect(isPlatformPublishHost('douyin', 'https://evil.creator.douyin.com.attacker.test/')).toBe(false);
  });

  it('用创作者后台域名而不是登录域名判定（B 站在 passport 登录、member 发布）', () => {
    expect(isPlatformPublishHost('bilibili', 'https://member.bilibili.com/platform/upload/video/frame')).toBe(true);
    expect(isPlatformPublishHost('bilibili', 'https://passport.bilibili.com/login')).toBe(false);
  });

  it('每个平台都至少有一个可发布域名（否则发布永远被拒）', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      expect(getSocialPlatformPublishHosts(platform.id).length).toBeGreaterThan(0);
    }
  });

  it('非 http(s) 的页面一律不在范围内', () => {
    expect(isPlatformPublishHost('douyin', 'about:blank')).toBe(false);
    expect(isPlatformPublishHost('douyin', '')).toBe(false);
  });
});

describe('无人值守发布授权', () => {
  it('只有显式开启才算授权', () => {
    expect(isAutoPublishGranted({ douyin: {} }, 'douyin')).toBe(false);
    expect(isAutoPublishGranted({ douyin: { autoPublish: true } }, 'douyin')).toBe(true);
  });

  it('授权只对它自己的平台生效', () => {
    const accounts = { douyin: { autoPublish: true } };
    expect(isAutoPublishGranted(accounts, 'douyin')).toBe(true);
    expect(isAutoPublishGranted(accounts, 'xiaohongshu')).toBe(false);
  });

  it('账号表形状不对时按没授权处理', () => {
    expect(isAutoPublishGranted(undefined, 'douyin')).toBe(false);
    expect(isAutoPublishGranted('nonsense', 'douyin')).toBe(false);
    expect(isAutoPublishGranted({ douyin: 'nonsense' }, 'douyin')).toBe(false);
  });
});

describe('平台 id 校验', () => {
  it('只认注册过的 id', () => {
    expect(isSocialPlatformId('douyin')).toBe(true);
    expect(isSocialPlatformId('Douyin')).toBe(false);
    expect(isSocialPlatformId('tiktok')).toBe(false);
  });
});

describe('退出登录要清的 cookie 域', () => {
  it('带一级父域：抖音的 sessionid 挂在 .douyin.com 上', () => {
    // 只清 creator.douyin.com 会留下那条 sessionid，「重新登录」立刻秒判成功。
    expect(loginCookieDomains(getSocialPlatform('douyin'))).toEqual([
      'creator.douyin.com',
      'douyin.com',
    ]);
  });

  it('只上探一级，不当公共后缀的锤子', () => {
    // 再往上就是 com —— 清抖音顺手把人 QQ 登录也清了。
    for (const platform of SOCIAL_PLATFORMS) {
      for (const domain of loginCookieDomains(platform)) {
        expect(domain.includes('.')).toBe(true);
      }
    }
  });

  it('视频号与公众号共用 weixin.qq.com，互为兄弟', () => {
    const channels = loginCookieGroup(getSocialPlatform('weixin-channels'));
    expect(channels.siblings).toEqual(['wechat-mp']);
    // 合集里两个平台的域都在：公众号的会话 cookie 挂在它自己的 host 上，
    // 只清那条共享父域不足以让它真的掉线。
    expect(channels.domains).toEqual(
      expect.arrayContaining(['channels.weixin.qq.com', 'mp.weixin.qq.com', 'weixin.qq.com']),
    );

    expect(loginCookieGroup(getSocialPlatform('wechat-mp')).siblings).toEqual(['weixin-channels']);
  });

  it('没有共用域的平台上没有兄弟，也不多清别的域', () => {
    const group = loginCookieGroup(getSocialPlatform('douyin'));
    expect(group.siblings).toEqual([]);
    expect(group.domains).toEqual(['creator.douyin.com', 'douyin.com']);
  });
});
