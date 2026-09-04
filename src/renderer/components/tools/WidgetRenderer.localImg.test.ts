import { describe, expect, test, vi } from 'vitest';

import { resolveLocalImgSrcs } from './widgetLocalImg';

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

describe('resolveLocalImgSrcs (widget local-image → data: URL)', () => {
  test('rewrites a local absolute <img src> to a data: URL', async () => {
    const svc = makeService({ '/home/u/a.png': { mimeType: 'image/png', data: 'QUFB' } });
    const out = await resolveLocalImgSrcs('<img src="/home/u/a.png" alt="总览">', svc as never);
    expect(out).toBe('<img src="data:image/png;base64,QUFB" alt="总览">');
    expect(svc.readPathsAsBase64).toHaveBeenCalledWith({ paths: ['/home/u/a.png'] });
  });

  test('dedupes repeated paths into one read call', async () => {
    const svc = makeService({ '/home/u/a.png': { data: 'A' } });
    const html = '<img src="/home/u/a.png"><img src="/home/u/a.png">';
    await resolveLocalImgSrcs(html, svc as never);
    expect(svc.readPathsAsBase64).toHaveBeenCalledWith({ paths: ['/home/u/a.png'] });
  });

  test('leaves https/data/relative srcs untouched and skips the read', async () => {
    const svc = makeService({});
    const html = '<img src="https://x.com/a.png"><img src="data:image/png;base64,QQ=="><img src="out/a.png">';
    expect(await resolveLocalImgSrcs(html, svc as never)).toBe(html);
    expect(svc.readPathsAsBase64).not.toHaveBeenCalled();
  });

  test('returns the original HTML when the read fails', async () => {
    const svc = { readPathsAsBase64: vi.fn(async () => { throw new Error('boom'); }) };
    const html = '<img src="/tmp/a.png">';
    expect(await resolveLocalImgSrcs(html, svc as never)).toBe(html);
  });

  test('skips files that report an error', async () => {
    const svc = makeService({ '/tmp/bad.png': { error: 'missing' } });
    const html = '<img src="/tmp/bad.png">';
    expect(await resolveLocalImgSrcs(html, svc as never)).toBe(html);
  });

  test('returns the original HTML for a null service', async () => {
    const html = '<img src="/tmp/a.png">';
    expect(await resolveLocalImgSrcs(html, null)).toBe(html);
  });

  test('handles a Windows drive path', async () => {
    const svc = makeService({ 'C:\\Users\\u\\a.png': { mimeType: 'image/jpeg', data: 'Qk' } });
    const out = await resolveLocalImgSrcs('<img src="C:\\Users\\u\\a.png">', svc as never);
    expect(out).toBe('<img src="data:image/jpeg;base64,Qk">');
  });
});
