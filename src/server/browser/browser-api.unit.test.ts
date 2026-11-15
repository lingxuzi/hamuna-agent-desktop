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
vi.mock('../session-engine/selector', () => ({
  getSessionEngine: () => ({ getCurrentSessionContext: () => ({ sessionId: 'sess-1' }) }),
}));

vi.mock('../utils/embedded-browser-quota', () => ({
  recordEmbeddedBrowserOutcome: vi.fn(),
}));

const { handleBrowserUpload, handleBrowserAction, handleBrowserPublish } = await import('./browser-api');

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

describe('browser publish', () => {
  beforeEach(() => {
    managementApi.mockReset();
  });

  const onCreatorBackend = () => {
    managementApi.mockResolvedValueOnce({
      ok: true,
      data: { title: '抖音创作者中心', url: 'https://creator.douyin.com/creator-micro/content/upload', readyState: 'complete' },
    });
    managementApi.mockResolvedValueOnce({
      ok: true,
      data: { tag: 'button', label: '发布' },
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
});
