/**
 * `app.agent.*` 的 `appDataWorkspace` 解析（`miniapp-app-dispatch.ts::dispatchAgent`
 * → `resolveAgentWorkspace`）。
 *
 * ## 为什么单独一个文件
 *
 * `miniapp-app-dispatch.integration.test.ts` 明确把 `agent.*` 挡在执行之外：它们会
 * 派生真实 Sidecar 进程，慢且不确定。但这不代表 workspace 这段逻辑该没人管 ——
 * 它恰恰是这条命令链上**唯一**把作者输入拼成文件系统路径的地方：
 *
 *   `appDataWorkspace` → `normalizeAppDataWorkspace`（纯字符串，shared 层）
 *   → `join(appdata, segment)` → 词法复核 → `mkdir`
 *   → `runMiniAppAgentTurn({ workspacePath })`
 *
 * Agent 有工具、能读写文件，`workspacePath` 拼错一次就是一次任意目录写。所以这里
 * 把 `miniapp-agent` 整个 mock 掉（不起真 Sidecar），只让**路径解析**这段真跑：
 * 真实临时目录、真实 mkdir、真实的 `existsSync` 断言。
 *
 * ## 归一规则本身不重复测
 *
 * `normalizeAppDataWorkspace` 的拒绝表（分隔符 / 控制字符 / 尾随点 / Windows 保留
 * 设备名 …）是 shared 层的纯函数，由 `app-data-workspace` 自己的单测负责。本文件
 * 只钉**接线**：sidecar 真的把 segment 拼到了 appdata 之下、真的建了目录、非法值
 * 真的在起 turn **之前**被拒。
 *
 * 顺带说明为什么 `resolveAgentWorkspace` 里那行 `dirname(resolve(target)) !==
 * resolve(appdata)` 不会被触发到：上游 `normalizeAppDataWorkspace` 已经把
 * `.`/`..`/分隔符/前后点全部拒了，它按构造就不可达。它是纵深防御，不是行为分支。
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sandboxHome = '';

// 与 miniapp-app-dispatch 的其它测试同一手法：绝不能写用户真实 HOME。
vi.mock('./utils/admin-config', () => ({
  getConfigDir: () => sandboxHome,
}));

const { describeStream, runTurn, stopTurn } = vi.hoisted(() => ({
  describeStream: vi.fn(),
  runTurn: vi.fn(),
  stopTurn: vi.fn(),
}));

// 只 stub 真 Sidecar 那一层；路径解析、权限闸、归一全部走生产代码。
vi.mock('./miniapp-agent', () => ({
  describeMiniAppAgentStream: describeStream,
  runMiniAppAgentTurn: runTurn,
  stopMiniAppAgentTurn: stopTurn,
  resolveMiniAppAgentTimeoutMs: () => 60_000,
}));

const { dispatchMiniAppApp, miniappAppRoot } = await import('./miniapp-app-dispatch');

const APP_ID = 'agent-ws-probe';

function appDir(): string {
  return join(sandboxHome, 'miniapps', APP_ID);
}

/** readdirSync 的返回顺序在两平台上不一致（文件系统决定），所以一律排序后再断言。 */
function appEntries(): string[] {
  return readdirSync(miniappAppRoot(APP_ID)).sort();
}
function writeMeta(agentEnabled: boolean): void {
  mkdirSync(appDir(), { recursive: true });
  writeFileSync(
    join(appDir(), 'meta.json'),
    JSON.stringify({
      id: APP_ID,
      name: 'Agent WS Probe',
      description: 'unit fixture',
      kind: 'iframe',
      entry: 'index.html',
      permissions: { agent: { enabled: agentEnabled } },
    }),
  );
}

beforeEach(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'hamuna-agent-ws-'));
  describeStream.mockReset();
  runTurn.mockReset();
  stopTurn.mockReset();
  describeStream.mockReturnValue({
    ok: true,
    result: { session_id: 'miniapp_agent-ws-probe_default', engine: 'builtin', runtime: 'claude' },
  });
  runTurn.mockResolvedValue({ ok: true, result: { text: 'stub reply' } });
  stopTurn.mockResolvedValue({ ok: true, result: { stopped: true } });
  writeMeta(true);
});

afterEach(() => {
  rmSync(sandboxHome, { recursive: true, force: true });
});

describe('app.agent.ensureSession: the workspace really lands under appdata', () => {
  it('creates the named subdirectory inside this MiniApp\'s appdata', async () => {
    const res = await dispatchMiniAppApp('agent.ensureSession', APP_ID, {
      appDataWorkspace: 'notes',
    });

    expect(res.ok).toBe(true);
    // 归一后的名字要回显给作者：传了个非法值应该当场看到，而不是被静默忽略、
    // 让他以为自己挑了子目录（见 dispatchAgent 476-483 的注释）。
    expect((res.result as { app_data_workspace: string | null }).app_data_workspace).toBe('notes');

    const created = join(miniappAppRoot(APP_ID), 'notes');
    expect(existsSync(created)).toBe(true);
    // 反向护栏：只准在 appdata **之下**建，且只能建作者点名的这一个。
    expect(appEntries()).toEqual(['meta.json', 'notes']);
  });

  it('trims the name and uses the trimmed one on disk', async () => {
    // Win32 会静默剥掉尾随空格，于是 " notes" 与 "notes" 指向同一个目录 —— 两平台
    // 必须拿到同一个名字，否则作者在 Windows 上建的目录 Linux 找不到。
    const res = await dispatchMiniAppApp('agent.ensureSession', APP_ID, {
      appDataWorkspace: '  notes  ',
    });

    expect(res.ok).toBe(true);
    expect((res.result as { app_data_workspace: string }).app_data_workspace).toBe('notes');
    expect(existsSync(join(miniappAppRoot(APP_ID), 'notes'))).toBe(true);
  });

  it('no workspace means the appdata root itself, and creates nothing', async () => {
    const res = await dispatchMiniAppApp('agent.ensureSession', APP_ID, {});

    expect(res.ok).toBe(true);
    expect((res.result as { app_data_workspace: string | null }).app_data_workspace).toBeNull();
    expect(appEntries()).toEqual(['meta.json']);
  });

  it('rejects a segment containing a path separator before creating anything', async () => {
    const res = await dispatchMiniAppApp('agent.ensureSession', APP_ID, {
      appDataWorkspace: '../escape',
    });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
    // 最强的一条：越权输入不许在磁盘上留下任何痕迹。
    expect(appEntries()).toEqual(['meta.json']);
  });

  it('rejects a Windows reserved device name', async () => {
    const res = await dispatchMiniAppApp('agent.ensureSession', APP_ID, {
      appDataWorkspace: 'CON',
    });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
    expect(appEntries()).toEqual(['meta.json']);
  });
});

describe('app.agent.run: workspacePath is derived, never taken from the author', () => {
  it('hands the resolved appdata subdirectory to the turn', async () => {
    const res = await dispatchMiniAppApp('agent.run', APP_ID, {
      prompt: 'hi',
      appDataWorkspace: 'notes',
    });

    expect(res.ok).toBe(true);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn.mock.calls[0][0]).toMatchObject({
      prompt: 'hi',
      workspacePath: join(miniappAppRoot(APP_ID), 'notes'),
      runId: 'default',
    });
  });

  it('defaults the workspace to the appdata root when none is named', async () => {
    await dispatchMiniAppApp('agent.run', APP_ID, { prompt: 'hi' });

    expect(runTurn.mock.calls[0][0].workspacePath).toBe(miniappAppRoot(APP_ID));
  });

  it('turnText is the same route as run', async () => {
    await dispatchMiniAppApp('agent.turnText', APP_ID, { prompt: 'hi', run_id: 'r1' });

    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn.mock.calls[0][0]).toMatchObject({ prompt: 'hi', runId: 'r1' });
  });

  it('carries the run_id through so cancel can target the same turn', async () => {
    await dispatchMiniAppApp('agent.run', APP_ID, { prompt: 'hi', run_id: 'r-7' });
    await dispatchMiniAppApp('agent.cancel', APP_ID, { run_id: 'r-7' });

    expect(runTurn.mock.calls[0][0].runId).toBe('r-7');
    expect(stopTurn).toHaveBeenCalledWith('r-7');
  });

  it('cancel falls back to the default run id', async () => {
    await dispatchMiniAppApp('agent.cancel', APP_ID, {});

    expect(stopTurn).toHaveBeenCalledWith('default');
  });

  it('a missing prompt is rejected before the workspace is even resolved', async () => {
    const res = await dispatchMiniAppApp('agent.run', APP_ID, { appDataWorkspace: 'notes' });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('an escaping workspace never reaches the turn', async () => {
    const res = await dispatchMiniAppApp('agent.run', APP_ID, {
      prompt: 'hi',
      appDataWorkspace: 'a/../../b',
    });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
    expect(runTurn).not.toHaveBeenCalled();
  });
});

describe('app.agent.* method surface', () => {
  it('an unknown agent method fails loudly instead of silently doing nothing', async () => {
    // checkAgent 只要求 agent.enabled，不做方法白名单，所以拼错的方法名会一路走到
    // dispatchAgent 的末尾。必须显式报 UNKNOWN_METHOD —— 作者拼错 "turn" 之后拿到
    // 一个 undefined，会以为 Agent 挂了。
    const res = await dispatchMiniAppApp('agent.turn', APP_ID, { prompt: 'hi' });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('UNKNOWN_METHOD');
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('is still gated on agent.enabled, before any dispatch', async () => {
    writeMeta(false);

    const res = await dispatchMiniAppApp('agent.ensureSession', APP_ID, {});

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
    expect(describeStream).not.toHaveBeenCalled();
  });
});
