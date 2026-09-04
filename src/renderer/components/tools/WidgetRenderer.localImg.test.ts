import { beforeEach, describe, expect, test, vi } from 'vitest';

import { resolveLocalMediaSrcs } from './widgetLocalImg';

// Toggle for the Tauri-vs-dev resolution path. isTauriEnvironment() reads
// window globals, which don't exist in the node env — mock it to control
// which branch resolveLocalMediaSrcs takes per describe block.
const env = vi.hoisted(() => ({ isTauri: false }));
vi.mock('@/utils/browserMock', () => ({
  isTauriEnvironment: () => env.isTauri,
}));
vi.mock('@/utils/hamunaProtocol', () => ({
  // Node env has no navigator → isWindowsPlatform() false → hamuna:// scheme.
  resolveHamunaAgentProtocolUrl: (pathname: string) => `hamuna://${pathname.replace(/^\//, '')}`,
}));

function makeService(files: Record<string, { mimeType?: string; data?: string; error?: string | null }>) {
  const readPathsAsBase64 = vi.fn(async ({ paths }: { paths: string[] }) => ({
    success: true,
    files: paths.map((p) => ({
      path: p,
      name: p.split('/').pop() ?? p,
      mimeType: files[p]?.mimeType ?? 'image/png',
      data: files[p]?.data ?? '',
      error: files[p]?.error ?? null,
    })),
  }));
  return { readPathsAsBase64 };
}

describe('resolveLocalMediaSrcs (widget local media → data: URL, dev mode)', () => {
  beforeEach(() => { env.isTauri = false; });

  test('rewrites a local absolute <img src> to a data: URL', async () => {
    const svc = makeService({ '/home/u/a.png': { mimeType: 'image/png', data: 'QUFB' } });
    const out = await resolveLocalMediaSrcs('<img src="/home/u/a.png" alt="总览">', svc as never);
    expect(out).toBe('<img src="data:image/png;base64,QUFB" alt="总览">');
    expect(svc.readPathsAsBase64).toHaveBeenCalledWith({ paths: ['/home/u/a.png'] });
  });

  test('rewrites a local absolute <video src> to a data: URL', async () => {
    const svc = makeService({ '/home/u/v.mp4': { mimeType: 'video/mp4', data: 'QUJD' } });
    const out = await resolveLocalMediaSrcs(
      '<video controls autoplay loop muted playsinline src="/home/u/v.mp4">',
      svc as never,
    );
    expect(out).toBe(
      '<video controls autoplay loop muted playsinline src="data:video/mp4;base64,QUJD">',
    );
    expect(svc.readPathsAsBase64).toHaveBeenCalledWith({ paths: ['/home/u/v.mp4'] });
  });

  test('rewrites both <img> and <video> in one HTML', async () => {
    const svc = makeService({
      '/home/u/a.png': { data: 'QUFB' },
      '/home/u/v.mp4': { mimeType: 'video/mp4', data: 'QUJD' },
    });
    const html = '<img src="/home/u/a.png"><video src="/home/u/v.mp4"></video>';
    const out = await resolveLocalMediaSrcs(html, svc as never);
    expect(out).toBe(
      '<img src="data:image/png;base64,QUFB"><video src="data:video/mp4;base64,QUJD"></video>',
    );
  });

  test('dedupes repeated paths into one read call', async () => {
    const svc = makeService({ '/home/u/a.png': { data: 'A' } });
    const html = '<img src="/home/u/a.png"><img src="/home/u/a.png">';
    await resolveLocalMediaSrcs(html, svc as never);
    expect(svc.readPathsAsBase64).toHaveBeenCalledWith({ paths: ['/home/u/a.png'] });
  });

  test('leaves https/data/relative srcs untouched and skips the read', async () => {
    const svc = makeService({});
    const html = '<img src="https://x.com/a.png"><img src="data:image/png;base64,QQ=="><img src="out/a.png"><video src="https://x.com/v.mp4">';
    expect(await resolveLocalMediaSrcs(html, svc as never)).toBe(html);
    expect(svc.readPathsAsBase64).not.toHaveBeenCalled();
  });

  test('returns the original HTML when the read fails', async () => {
    const svc = { readPathsAsBase64: vi.fn(async () => { throw new Error('boom'); }) };
    const html = '<img src="/tmp/a.png">';
    expect(await resolveLocalMediaSrcs(html, svc as never)).toBe(html);
  });

  test('skips files that report an error', async () => {
    const svc = makeService({ '/tmp/bad.png': { error: 'missing' } });
    const html = '<img src="/tmp/bad.png">';
    expect(await resolveLocalMediaSrcs(html, svc as never)).toBe(html);
  });

  test('returns the original HTML for a null service', async () => {
    const html = '<img src="/tmp/a.png">';
    expect(await resolveLocalMediaSrcs(html, null)).toBe(html);
  });

  test('handles a Windows drive path', async () => {
    const svc = makeService({ 'C:\\Users\\u\\a.png': { mimeType: 'image/jpeg', data: 'Qk' } });
    const out = await resolveLocalMediaSrcs('<img src="C:\\Users\\u\\a.png">', svc as never);
    expect(out).toBe('<img src="data:image/jpeg;base64,Qk">');
  });
});

describe('resolveLocalMediaSrcs (widget local media → hamuna:// stream URL, Tauri mode)', () => {
  beforeEach(() => { env.isTauri = true; });

  test('rewrites a local <video src> to a streamable hamuna:// URL without reading', async () => {
    const svc = makeService({ '/home/u/v.mp4': { data: 'UNUSED' } });
    const out = await resolveLocalMediaSrcs(
      '<video controls src="/home/u/v.mp4">',
      svc as never,
    );
    expect(out).toBe('<video controls src="hamuna://widget-media/%2Fhome%2Fu%2Fv.mp4">');
    // Streaming: no base64 read, no data: bloat in the widget HTML.
    expect(svc.readPathsAsBase64).not.toHaveBeenCalled();
  });

  test('rewrites <img> too and leaves https/data/relative srcs untouched', async () => {
    const svc = makeService({});
    const html =
      '<img src="/home/u/a.png"><img src="https://x.com/a.png">'
      + '<img src="data:image/png;base64,QQ=="><img src="out/a.png">';
    const out = await resolveLocalMediaSrcs(html, svc as never);
    expect(out).toBe(
      '<img src="hamuna://widget-media/%2Fhome%2Fu%2Fa.png">'
      + '<img src="https://x.com/a.png">'
      + '<img src="data:image/png;base64,QQ=="><img src="out/a.png">',
    );
    expect(svc.readPathsAsBase64).not.toHaveBeenCalled();
  });
});
