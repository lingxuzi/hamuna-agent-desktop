// `app.dialog.*` / `app.clipboard.*` 的**语义**护栏。
//
// 为什么这几个方法此前完全没有语义测试：它们在离开 renderer 之前就被就地消化
// （`dispatchNative`），所以 sidecar 侧那套"每个方法都要有决定"的路由扫只能看到
// 一句"renderer host，sidecar 够不到"。真正的实现——Tauri 原生对话框与剪贴板
// invoke——一行都没被断言过。路由测试看不见这一层，正如它看不见 fs 那边
// "方法接上了但接错了分支"一样。
//
// 具体能被静默接错的地方，每条对应一个变异：
//   - `readText` 与 `writeText` 互换：两边都返回 ok:true，作者那边读回来的是刚写
//     进去的内容，或者写进去的是刚读出来的内容 —— 症状是"剪贴板坏了"，不会指向
//     接线接反了。
//   - 用户取消 open/save 被当成错误：作者被迫 try/catch 吞掉一个本属正常的状态。
//   - `dialog.message` 的 confirm 走错原生 API：形状从 `{confirmed: boolean}` 变成
//     `{confirmed: null}`，作者的条件分支永远走不到。
//   - `defaultPath` 拼法没接上（文档教 camelCase，实现只读 snake_case）：对话框照常
//     打开，只是初始目录不对 —— 没有任何错误，只有"为什么每次都要重新选目录"。
//   - filter 里的非字符串 extensions 混进 IPC 载荷：Tauri 侧 schema 校验不严。
//
// 这些都在 renderer 里跑，且都要 Tauri，所以只能 mock 掉两个模块后单测；
// 真机上的原生对话框本身不在本文件的能力范围内。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppDispatcher } from './appHostDispatch';

const { apiPostJsonMock, proxyFetchMock } = vi.hoisted(() => ({
  apiPostJsonMock: vi.fn(),
  proxyFetchMock: vi.fn(),
}));

vi.mock('@/api/apiFetch', () => ({ apiPostJson: apiPostJsonMock }));
vi.mock('@/api/tauriClient', () => ({ proxyFetch: proxyFetchMock }));

const { dialogOpenMock, dialogSaveMock, dialogAskMock, dialogMessageMock, invokeMock } = vi.hoisted(
  () => ({
    dialogOpenMock: vi.fn(),
    dialogSaveMock: vi.fn(),
    dialogAskMock: vi.fn(),
    dialogMessageMock: vi.fn(),
    invokeMock: vi.fn(),
  }),
);

// `dispatchNative` 用的是动态 `await import(...)`，vitest 照样拦得住。
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: dialogOpenMock,
  save: dialogSaveMock,
  ask: dialogAskMock,
  message: dialogMessageMock,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const dispatch = createAppDispatcher('native-probe');

beforeEach(() => {
  apiPostJsonMock.mockReset();
  proxyFetchMock.mockReset();
  dialogOpenMock.mockReset();
  dialogSaveMock.mockReset();
  dialogAskMock.mockReset();
  dialogMessageMock.mockReset();
  invokeMock.mockReset();
});

describe('app.clipboard.* talks to the real clipboard commands, in the right direction', () => {
  it('writeText hands the text to the write command and reports nothing back', async () => {
    const res = await dispatch('clipboard.writeText', { text: 'copied from a MiniApp' });

    expect(res).toEqual({ ok: true, result: null });
    // 方向钉死：接成 read 会让"写"变成一次读，invoke 的命令名对不上但两边都 ok。
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('cmd_clipboard_write_text', {
      text: 'copied from a MiniApp',
    });
  });

  it('readText returns the string the read command produced', async () => {
    invokeMock.mockResolvedValueOnce('whatever was on the clipboard');

    const res = await dispatch('clipboard.readText', {});

    expect(res).toEqual({ ok: true, result: 'whatever was on the clipboard' });
    expect(invokeMock).toHaveBeenCalledWith('cmd_clipboard_read_text');
  });

  it('rejects a non-string text instead of writing the string "undefined"', async () => {
    // 少了这道闸，作者传个数字就会把 "undefined" 写进用户的剪贴板 —— 真实且难查。
    for (const bad of [{}, { text: 42 }, { text: null }, { text: { a: 1 } }, {}]) {
      const res = await dispatch('clipboard.writeText', bad);
      expect(res.ok, JSON.stringify(bad)).toBe(false);
      if (res.ok) throw new Error('expected a failure envelope');
      expect(res.error.code).toBe('INVALID_PARAMS');
    }
    // 拒绝必须没有副作用：一次 invoke 都不该发生。
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('turns a missing Tauri bridge into a readable error rather than a rejected promise', async () => {
    invokeMock.mockRejectedValueOnce(new Error('window.__TAURI_INTERNALS__ is not a function'));

    const res = await dispatch('clipboard.readText', {});

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a failure envelope');
    expect(res.error.code).toBe('HOST_ERROR');
    expect(res.error.message).toContain('native capability unavailable');
  });
});

describe('app.dialog.open / save pass a user cancel through as null, not as an error', () => {
  it('returns the picked path verbatim', async () => {
    dialogOpenMock.mockResolvedValueOnce('C:/Users/alice/notes.md');

    const res = await dispatch('dialog.open', {});

    expect(res).toEqual({ ok: true, result: 'C:/Users/alice/notes.md' });
  });

  it('returns an array for multiple selection instead of flattening it', async () => {
    dialogOpenMock.mockResolvedValueOnce(['a.md', 'b.md']);

    const res = await dispatch('dialog.open', { multiple: true });

    expect(res).toEqual({ ok: true, result: ['a.md', 'b.md'] });
    expect(dialogOpenMock).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
  });

  it('maps the reference default_path onto Tauri defaultPath', async () => {
    // 参考实现用 snake_case，Tauri 用 camelCase。漏掉映射时对话框照常打开，
    // 只是初始目录不对 —— 没有错误，只有"为什么每次都要重选一遍"。
    dialogOpenMock.mockResolvedValueOnce(null);

    await dispatch('dialog.open', { default_path: 'C:/Users/alice' });

    expect(dialogOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'C:/Users/alice' }),
    );
  });

  it('honours the camelCase defaultPath that SKILL.md actually teaches', async () => {
    // SKILL.md 的 dialog 示例写的是 `defaultPath`（与 Tauri 原生同名），而实现只读
    // snake_case —— 照文档写的作者每次都被丢在随机目录：对话框照常打开，没有错误，
    // 只有"为什么每次都要重选一遍"。open / save 两条调用路径都要认这个拼法。
    dialogOpenMock.mockResolvedValueOnce(null);
    dialogSaveMock.mockResolvedValueOnce(null);

    await dispatch('dialog.open', { defaultPath: 'C:/Users/alice' });
    await dispatch('dialog.save', { defaultPath: '~/out.txt' });

    expect(dialogOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'C:/Users/alice' }),
    );
    expect(dialogSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '~/out.txt' }),
    );
  });

  it('prefers the snake_case spelling so the already-working path is unchanged', async () => {
    // 两种拼法都在收，得钉死优先级：否则把 camelCase 加进来这个"修复"本身可能悄悄
    // 改变既有 snake_case 调用者的结果。
    dialogSaveMock.mockResolvedValueOnce(null);

    await dispatch('dialog.save', { default_path: 'a.txt', defaultPath: 'b.txt' });

    expect(dialogSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'a.txt' }),
    );
  });

  it('treats a cancel (null) as a normal result for both open and save', async () => {
    dialogOpenMock.mockResolvedValueOnce(null);
    dialogSaveMock.mockResolvedValueOnce(null);

    // 用户主动取消是正常状态。转成错误会逼作者写 try/catch 去吞一个不该吞的异常。
    expect(await dispatch('dialog.open', {})).toEqual({ ok: true, result: null });
    expect(await dispatch('dialog.save', {})).toEqual({ ok: true, result: null });
  });

  it('keeps only name/extensions in filters and drops malformed entries', async () => {
    dialogOpenMock.mockResolvedValueOnce(null);

    await dispatch('dialog.open', {
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 7, null] },
        { extensions: ['txt'] },
        { name: 42, extensions: ['x'] },
        null,
        'not-an-object',
      ],
    });

    expect(dialogOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      }),
    );
  });
});

describe('app.dialog.message picks the right native dialog and keeps its result shape', () => {
  it('confirm goes to ask() and reports the boolean', async () => {
    dialogAskMock.mockResolvedValueOnce(true);

    const res = await dispatch('dialog.message', { message: 'Delete it?', kind: 'confirm' });

    expect(res).toEqual({ ok: true, result: { confirmed: true } });
    expect(dialogAskMock).toHaveBeenCalledWith('Delete it?', expect.objectContaining({ kind: 'warning' }));
    // 走错原生 API 时症状是条件分支永远不成立，所以这条也要钉住"没调 message"。
    expect(dialogMessageMock).not.toHaveBeenCalled();
  });

  it('a non-confirm kind goes to message() and reports confirmed: null', async () => {
    dialogMessageMock.mockResolvedValueOnce(undefined);

    const res = await dispatch('dialog.message', { message: 'Saved.', kind: 'info' });

    expect(res).toEqual({ ok: true, result: { confirmed: null } });
    expect(dialogAskMock).not.toHaveBeenCalled();
  });

  it('falls back to info for an unknown kind rather than forwarding it to the OS', async () => {
    dialogMessageMock.mockResolvedValueOnce(undefined);

    await dispatch('dialog.message', { message: 'hm', kind: 'catastrophe' });

    expect(dialogMessageMock).toHaveBeenCalledWith('hm', expect.objectContaining({ kind: 'info' }));
  });

  it('rejects an empty message before opening anything', async () => {
    for (const bad of [{}, { message: '' }, { message: 42 }]) {
      const res = await dispatch('dialog.message', bad);
      expect(res.ok, JSON.stringify(bad)).toBe(false);
      if (res.ok) throw new Error('expected a failure envelope');
      expect(res.error.code).toBe('INVALID_PARAMS');
    }
    // 空对话框在某些平台上会弹一个没有正文的窗口，作者还以为点了没反应。
    expect(dialogMessageMock).not.toHaveBeenCalled();
    expect(dialogAskMock).not.toHaveBeenCalled();
  });
});
