// marketplaceClient.unit.test.ts — MiniApp 打开/安装链路的 wire 契约。
//
// ## 为什么这层需要钉
//
// `marketplaceClient.ts` 之前**零测试**，而它是 MiniApp 最核心用户旅程的入口：
// Marketplace 列表 → 安装 → 卸载 → 打开（取 source + 两个路径根）。链路上任一
// 环节的字段名错位，症状是"点了没反应"或"打开了但作者一碰 fs 就被判越权"，
// 而这两者在 UI 上都不带任何指向这层的线索。
//
// ## 三条真正承重的断言
//
// 1. **字段名映射**：renderer 一律 camelCase（`appId` / `appdata_dir` →
//    `appDataDir`），snake_case 只存在于 sidecar 边界。这正是历史上真出过错
//    的那一类（`app_id` vs `appId`），所以连请求体和响应体一起钉。
//
// 2. **路径根缺失时回落空串，而不是 undefined**。这是安全相关的一条：
//    `appDataDir` 若回成 `undefined`，作者写 `app.appDataDir + '/x'` 拼出的
//    是字符串 `"undefined/x"`，而 `${workspace}` 展开时若拿到 null 作者还可能
//    拼出裸相对路径。两者都靠 `isPathAllowed` 判越权，但**空串让判定的输入
//    形状可预测**，回成 undefined 则把判断推给每个作者自己处理。回落成空串是
//    宿主侧的 fail-closed 选择，这里把它钉住，防止有人"顺手改成 undefined 更方便"。
//
// 3. **错误必须抛出且带服务端原文**。`ok:false` 静默返回会让 Marketplace 页面
//    停在"点了没反应"，因为调用方无法区分成功与失败。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiGetJson = vi.fn();
const apiPostJson = vi.fn();

vi.mock('@/api/apiFetch', () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiPostJson: (...args: unknown[]) => apiPostJson(...args),
}));

import {
  installMarketplace,
  listMarketplace,
  loadMiniAppSourceWithRoots,
  uninstallMarketplace,
} from './marketplaceClient';

beforeEach(() => {
  apiGetJson.mockReset();
  apiPostJson.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('marketplaceClient: the wire contract behind open / install / uninstall', () => {
  it('listMarketplace GETs the list route and returns the items array', async () => {
    apiGetJson.mockResolvedValue({ ok: true, items: [{ id: 'hello-miniapp' }] });
    const items = await listMarketplace();
    expect(apiGetJson).toHaveBeenCalledWith('/api/miniapp/list');
    expect(items).toEqual([{ id: 'hello-miniapp' }]);
  });

  it('listMarketplace throws on ok:false rather than returning an empty list', async () => {
    // 返回 [] 会让页面渲染成"商店是空的"，把失败伪装成内容缺失。
    apiGetJson.mockResolvedValue({ ok: false, error: 'management api down' });
    await expect(listMarketplace()).rejects.toThrow('management api down');
  });

  it('install/uninstall post camelCase appId, not snake_case app_id', async () => {
    apiPostJson.mockResolvedValue({ ok: true });
    await installMarketplace('hello-miniapp');
    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/install', { appId: 'hello-miniapp' });

    apiPostJson.mockReset();
    apiPostJson.mockResolvedValue({ ok: true });
    await uninstallMarketplace('hello-miniapp');
    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/uninstall', { appId: 'hello-miniapp' });
  });

  it('install surfaces the server error instead of failing silently', async () => {
    apiPostJson.mockResolvedValue({ ok: false, error: 'E_SCHEMA_INVALID: bad meta' });
    await expect(installMarketplace('broken-app')).rejects.toThrow('E_SCHEMA_INVALID: bad meta');
  });

  it('loadMiniAppSourceWithRoots maps snake_case roots to camelCase for the author', async () => {
    apiPostJson.mockResolvedValue({
      ok: true,
      source: '<html></html>',
      appdata_dir: '/home/u/.hamuna/miniapps/hello-miniapp',
      workspace_dir: '/work/proj',
    });
    const src = await loadMiniAppSourceWithRoots('hello-miniapp');
    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/source', { appId: 'hello-miniapp' });
    expect(src).toEqual({
      source: '<html></html>',
      appDataDir: '/home/u/.hamuna/miniapps/hello-miniapp',
      workspaceDir: '/work/proj',
    });
  });

  it('missing path roots degrade to empty strings, never undefined', async () => {
    // 承重断言：见文件头第 2 条。`workspace_dir` 为 null（sidecar 尚无工作区）
    // 是**正常**状态，不是错误 —— 所以这里既不能抛错，也不能回成 undefined。
    apiPostJson.mockResolvedValue({
      ok: true,
      source: '<html></html>',
      workspace_dir: null,
    });
    const src = await loadMiniAppSourceWithRoots('hello-miniapp');
    expect(src.appDataDir).toBe('');
    expect(src.workspaceDir).toBe('');
    // 作者最常见的拼法：空串参与拼接必须得到可预测的形状
    expect(`${src.appDataDir}/meta.json`).toBe('/meta.json');
  });

  it('a response with no source is a failure, not an empty app', async () => {
    apiPostJson.mockResolvedValue({ ok: true, error: 'installed but entry missing' });
    await expect(loadMiniAppSourceWithRoots('half-broken')).rejects.toThrow(
      'installed but entry missing',
    );
  });
});
