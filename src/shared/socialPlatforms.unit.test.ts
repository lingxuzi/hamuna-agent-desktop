import { describe, expect, it } from 'vitest';
import {
  SOCIAL_PLATFORMS,
  getSocialPlatform,
  isLoggedInUrl,
  needsSelectorProbe,
  resolveLoginState,
  withSocialAccount,
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

describe('withSocialAccount', () => {
  it('写一个平台不丢其他平台的记录（浅合并会丢，这是它存在的理由）', () => {
    const before = {
      xiaohongshu: { lastLoginState: 'success' as const, displayName: '主号' },
      douyin: { lastLoginState: 'expired' as const },
    };
    const after = withSocialAccount(before, 'zhihu', { lastLoginState: 'success' });
    expect(after.douyin).toEqual({ lastLoginState: 'expired' });
    expect(after.xiaohongshu).toEqual({ lastLoginState: 'success', displayName: '主号' });
    expect(after.zhihu.lastLoginState).toBe('success');
  });

  it('patch 合并进既有记录而不是整条替换', () => {
    const before = { xiaohongshu: { lastLoginState: 'success' as const, displayName: '主号' } };
    const after = withSocialAccount(before, 'xiaohongshu', { lastLoginState: 'expired' });
    expect(after.xiaohongshu).toEqual({ lastLoginState: 'expired', displayName: '主号' });
  });

  it('没有历史记录时给出 unknown 兜底', () => {
    expect(withSocialAccount(undefined, 'bilibili', {}).bilibili).toEqual({ lastLoginState: 'unknown' });
  });
});
