import { beforeEach, describe, expect, it, vi } from 'vitest';

// `browser-api` forwards to the Rust Management API. Mock that transport so
// the test asserts the wiring (route, method, body shape) without a live
// desktop app.
const managementApi = vi.hoisted(() => vi.fn());

vi.mock('../utils/management-api-client', () => ({
  managementApi,
}));

// The browser is owned by a Chat session; the handler resolves the id from the
// session engine. Stub it so the tests do not need a Sidecar.
const sessionContext = vi.hoisted(() => ({
  current: { sessionId: 'sess-1', workspacePath: null as string | null },
}));

vi.mock('../session-engine/selector', () => ({
  getSessionEngine: () => ({ getCurrentSessionContext: () => sessionContext.current }),
}));

vi.mock('../utils/embedded-browser-quota', () => ({
  recordEmbeddedBrowserOutcome: vi.fn(),
}));

const {
  handleBrowserUpload,
  handleBrowserAction,
  handleBrowserClick,
  handleBrowserPublish,
  handleBrowserScroll,
} = await import('./browser-api');

describe('browser workspace plumbing', () => {
  beforeEach(() => {
    managementApi.mockReset();
    managementApi.mockResolvedValue({ ok: true, data: { url: 'https://example.com' }, opened: false });
    sessionContext.current = { sessionId: 'sess-1', workspacePath: '/home/me/sino' };
  });

  // Without the workspace the hidden-collector path in Rust refuses to create
  // anything — deliberately, because the alternative is a browser in the
  // shared profile that is logged out of every platform the user signed into.
  // So the field has to actually make it across the Sidecar hop.
  it('把会话工作区带进 POST body，Rust 才能用对 profile 建采集器', async () => {
    await handleBrowserAction('navigate', { url: 'https://example.com' });
    const [path, method, body] = managementApi.mock.calls[0];
    expect(path).toBe('/api/browser/navigate');
    expect(method).toBe('POST');
    expect(body.workspace).toBe('/home/me/sino');
  });

  it('显式 --workspace 压过会话工作区', async () => {
    await handleBrowserAction('navigate', {
      url: 'https://example.com',
      workspace: '/home/me/other',
    });
    expect(managementApi.mock.calls[0][2].workspace).toBe('/home/me/other');
  });

  // 工作区是本地路径：进 query string 就留在 Rust 的请求日志里了。
  it('GET 路径不带 workspace', async () => {
    await handleBrowserAction('state', {});
    const [path, method] = managementApi.mock.calls[0];
    expect(method).toBe('GET');
    expect(String(path)).not.toContain('workspace');
  });
});

describe('browser upload', () => {
  beforeEach(() => {
    managementApi.mockReset();
    managementApi.mockResolvedValue({
      ok: true,
      data: { selector: 'input[type=file]', name: 'cover.png', size: 2048, inputCount: 1 },
    });
  });

  it('没有目标就报错，不去碰浏览器', async () => {
    const res = await handleBrowserUpload({ file: '/tmp/cover.png' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('--selector');
    expect(managementApi).not.toHaveBeenCalled();
  });

  it('没有文件路径就报错', async () => {
    const res = await handleBrowserUpload({ selector: 'input[type=file]' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('--file');
    expect(managementApi).not.toHaveBeenCalled();
  });

  it('文件路径走 POST body，不进 query string', async () => {
    // Rust 把请求 URL 记进日志，路径进 query 就留在日志里了。
    const res = await handleBrowserUpload({
      selector: 'input[type=file]',
      file: '/workspace/ops/assets/cover.png',
    });
    expect(res.success).toBe(true);
    expect(managementApi).toHaveBeenCalledTimes(1);
    const [path, method, body] = managementApi.mock.calls[0];
    expect(path).toBe('/api/browser/upload');
    expect(method).toBe('POST');
    expect(body.file).toBe('/workspace/ops/assets/cover.png');
    expect(body.selector).toBe('input[type=file]');
    expect(body.session_id).toBe('sess-1');
    expect(res.data).toMatchObject({ uploaded: true, name: 'cover.png', size: 2048 });
  });

  it('dispatch 认识 upload —— CLI 的 browser/upload 路由必须落到这里', async () => {
    // 之前 dispatch 里没有 upload 分支，`hamuna browser upload` 走到 Sidecar
    // 只会得到 "Unknown browser action: upload"，素材永远传不上发布页。
    const res = await handleBrowserAction('upload', {
      selector: 'input[type=file]',
      file: '/workspace/ops/assets/cover.png',
    });
    expect(res.success).toBe(true);
    expect(managementApi.mock.calls[0][0]).toBe('/api/browser/upload');
  });
});

describe('browser scroll', () => {
  beforeEach(() => {
    managementApi.mockReset();
    managementApi.mockResolvedValue({
      ok: true,
      data: {
        mode: 'delta',
        target: 'div.feed',
        offset: 1240,
        moved: 300,
        atTop: false,
        atBottom: false,
        scrollable: true,
      },
    });
  });

  it('没有指令就报错，不去碰浏览器', async () => {
    // 滚动没有默认动作 —— 无参滚动要么是「滚到哪」，要么是根本没想清楚。
    // 静默滚一屏会让 agent 以为自己看过了整页。
    const res = await handleBrowserScroll({});
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('scroll target is required');
    expect(managementApi).not.toHaveBeenCalled();
  });

  it('像素距离走 POST body，且必须是数字', async () => {
    const res = await handleBrowserScroll({ delta: 300 });
    expect(res.success).toBe(true);
    const [path, method, body] = managementApi.mock.calls[0];
    expect(path).toBe('/api/browser/scroll');
    expect(method).toBe('POST');
    // delta 是数字 —— 字符串会在 Rust 侧反序列化失败。
    expect(body.delta).toBe(300);
    expect(typeof body.delta).toBe('number');
    expect(body.session_id).toBe('sess-1');
  });

  it('目的地是字符串，走 body 不进 query string', async () => {
    await handleBrowserScroll({ to: 'bottom' });
    const [path, method, body] = managementApi.mock.calls[0];
    expect(path).toBe('/api/browser/scroll');
    expect(method).toBe('POST');
    expect(body.to).toBe('bottom');
  });

  it('不认识的destination 就地报错，不发请求', async () => {
    const res = await handleBrowserScroll({ to: 'middle' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('middle');
    expect(managementApi).not.toHaveBeenCalled();
  });

  it('把页面反馈的滚动结果带回来', async () => {
    // agent 要靠 atBottom 分辨「已经到 feed 末尾」和「这个页面压根不能滚」。
    const res = await handleBrowserScroll({ delta: 300 });
    expect(res.data).toMatchObject({
      scrolled: true,
      moved: 300,
      offset: 1240,
      atBottom: false,
      scrollable: true,
    });
  });

  it('dispatch 认识 scroll —— CLI 的 browser/scroll 路由必须落到这里', async () => {
    const res = await handleBrowserAction('scroll', { delta: 300 });
    expect(res.success).toBe(true);
    expect(managementApi.mock.calls[0][0]).toBe('/api/browser/scroll');
  });
});

describe('browser click', () => {
  beforeEach(() => {
    managementApi.mockReset();
  });

  it('把「点完有没有变化」带回来 —— 这是 agent 停止乱点的唯一依据', async () => {
    // 以前 click 只回 {clicked:true,tag,label}，点中一个盖在遮罩下面的按钮
    // 和点中真按钮长得一模一样，agent 只能一直重试。
    managementApi.mockResolvedValue({
      ok: true,
      data: {
        tag: 'button',
        label: '发布',
        selector: 'div.editor > button:nth-of-type(2)',
        changed: false,
        urlChanged: false,
        fromUrl: 'https://creator.douyin.com/creator-micro/publish/image',
        page: { url: 'https://creator.douyin.com/creator-micro/publish/image', title: '发布图文' },
      },
    });
    const res = await handleBrowserClick({ text: '发布' });
    expect(res.data).toMatchObject({
      clicked: true,
      changed: false,
      urlChanged: false,
      selector: 'div.editor > button:nth-of-type(2)',
    });
  });

  it('测不到就说 null，不能塌成 false —— 那会让 agent 放弃一次没观测过的点击', async () => {
    managementApi.mockResolvedValue({
      ok: true,
      data: { tag: 'button', label: '发布', changed: null },
    });
    const res = await handleBrowserClick({ text: '发布' });
    expect((res.data as Record<string, unknown>)?.changed).toBeNull();
  });

  it('文本命中多个控件时把候选带回来，单个命中时不带', async () => {
    managementApi.mockResolvedValue({
      ok: true,
      data: {
        tag: 'button',
        label: '发布',
        changed: true,
        matches: [
          { tag: 'button', label: '发布', selector: 'button.publish', score: 1120 },
          { tag: 'div', label: '发布图文 支持常用', selector: 'div.toolbar', score: 460 },
        ],
      },
    });
    const many = await handleBrowserClick({ text: '发布' });
    expect((many.data as Record<string, unknown>)?.matches).toHaveLength(2);

    managementApi.mockResolvedValue({
      ok: true,
      data: { tag: 'button', label: '发布', changed: true, matches: [{ tag: 'button', label: '发布' }] },
    });
    const one = await handleBrowserClick({ text: '发布' });
    expect((one.data as Record<string, unknown>)?.matches).toBeUndefined();
  });
});

describe('browser publish', () => {
  beforeEach(() => {
    managementApi.mockReset();
  });

  const onCreatorBackend = (changed = true) => {
    managementApi.mockResolvedValueOnce({
      ok: true,
      data: { title: '抖音创作者中心', url: 'https://creator.douyin.com/creator-micro/content/upload', readyState: 'complete' },
    });
    managementApi.mockResolvedValueOnce({
      ok: true,
      data: {
        tag: 'button',
        label: '发布',
        changed,
        urlChanged: false,
        page: { url: 'https://creator.douyin.com/creator-micro/content/upload' },
      },
    });
  };

  it('没有平台就报错，不去碰浏览器', async () => {
    const res = await handleBrowserPublish({ text: '发布' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('--platform');
    expect(managementApi).not.toHaveBeenCalled();
  });

  it('平台 id 不认识就报错（错 id 不能一路走到查规格才炸）', async () => {
    const res = await handleBrowserPublish({ platform: 'tiktok', text: '发布' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('tiktok');
    expect(managementApi).not.toHaveBeenCalled();
  });

  it('当前页面不在该平台后台域内就拒绝发布', async () => {
    // 授权是按平台给的 —— 抖音的授权不是"在哪都能发"的空白支票。
    managementApi.mockResolvedValueOnce({
      ok: true,
      data: { title: '别的站', url: 'https://example.com/post', readyState: 'complete' },
    });
    const res = await handleBrowserPublish({ platform: 'douyin', text: '发布' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('creator backend');
    // 拒绝时不能已经点下去了
    expect(managementApi).toHaveBeenCalledTimes(1);
  });

  it('在后台域内才点发布，并把平台和页面带回来', async () => {
    onCreatorBackend();
    const res = await handleBrowserPublish({ platform: 'douyin', text: '发布' });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      published: true,
      platform: 'douyin',
      url: 'https://creator.douyin.com/creator-micro/content/upload',
    });
    const [statePath, stateMethod] = managementApi.mock.calls[0];
    const [clickPath, clickMethod, clickBody] = managementApi.mock.calls[1];
    // 范围检查只带 session：发布目标的文字不进 query string（Rust 记 URL 进日志）。
    expect(statePath).toBe('/api/browser/state?session_id=sess-1');
    expect(stateMethod).toBe('GET');
    expect(clickPath).toBe('/api/browser/click');
    expect(clickMethod).toBe('POST');
    // 平台 id 只用于判定范围，不该原样发给 Rust。
    expect(clickBody.platform).toBeUndefined();
    expect(clickBody.text).toBe('发布');
  });

  it('dispatch 认识 publish —— CLI 的 browser/publish 路由必须落到这里', async () => {
    onCreatorBackend();
    const res = await handleBrowserAction('publish', { platform: 'douyin', text: '发布' });
    expect(res.success).toBe(true);
    expect(managementApi.mock.calls[1][0]).toBe('/api/browser/click');
  });

  it('点击没让页面变化时不许报 published —— 那是把死点击说成发帖', async () => {
    onCreatorBackend(false);
    const res = await handleBrowserPublish({ platform: 'douyin', text: '发布' });
    // 请求本身成功（点击确实发出去了），但效果判定是「没变化」。
    expect(res.success).toBe(true);
    expect((res.data as Record<string, unknown>)?.published).toBe(false);
  });

  // 隐藏采集器上发布 = 一条没人看见的帖子。审批链之所以有意义，就是用户
  // 能看着那个点击落地；把发布留在采集器里，等于给定时任务开了一个用户
  // 从没授予过的发布权限。
  it('采集器上拒绝发布，连点击都不发', async () => {
    managementApi.mockResolvedValueOnce({
      ok: true,
      data: {
        title: '抖音创作者中心',
        url: 'https://creator.douyin.com/creator-micro/content/upload',
        readyState: 'complete',
        headless: true,
      },
    });
    const res = await handleBrowserPublish({ platform: 'douyin', text: '发布' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('visible browser panel');
    // Only the state probe — the click must never happen.
    expect(managementApi).toHaveBeenCalledTimes(1);
    expect(managementApi.mock.calls[0][0]).toBe('/api/browser/state?session_id=sess-1');
  });
});
