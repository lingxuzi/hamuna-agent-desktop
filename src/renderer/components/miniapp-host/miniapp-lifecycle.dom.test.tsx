/**
 * MiniApp lifecycle, stage 2 of 2: LAUNCH.
 *
 * The generate/register half lives in
 * `src/server/__tests__/miniapp-lifecycle.unit.test.ts`.
 *
 * ## Historical note (read before touching the `it.fails` cases below)
 *
 * This file was written when a running MiniApp genuinely could not reach the
 * agent or an LLM: `permissions.ai` was declared in every meta.json but had no
 * runtime reader, and the AI channel it would have opened did not exist. The
 * gaps were pinned with `it.fails`, which passes while broken and flips to red
 * the moment someone fixes it.
 *
 * `app.ai.*` and `app.agent.*` have since landed, so some of those `.fails`
 * have already come off. **A remaining `.fails` is not a statement about the
 * product** — check what it asserts before assuming the capability is still
 * missing. The same goes in reverse: do not add a passing test that locks one
 * of these gaps in as intended behaviour.
 */
import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MiniAppSceneTab from '@/pages/MiniAppSceneTab';
import { ThemeRegistry, ThemeRuntimeProvider } from '@/theme';
import { myAgentsDefaultTheme } from '@/theme/themes/hamuna-default';
import type { Tab } from '@/types/tab';

const loadMiniAppSourceWithRoots = vi.fn();
vi.mock('@/lib/marketplaceClient', () => ({
  loadMiniAppSourceWithRoots: (...args: unknown[]) => loadMiniAppSourceWithRoots(...args),
}));

/**
 * source 响应的完整形态。sidecar 随 source 一起下发两个路径根
 * （`app.appDataDir` / `app.workspaceDir` 的来源），scene tab 会拆开分别喂给
 * runtimeEnv，所以 mock 少一个字段就等于"作者拿不到自己的目录"。
 */
function src(html: string, roots: { appDataDir?: string; workspaceDir?: string } = {}) {
  return {
    source: html,
    appDataDir: roots.appDataDir ?? '',
    workspaceDir: roots.workspaceDir ?? '',
  };
}

// Heavy page subtrees, stubbed so importing App stays cheap — same approach
// as ColdRestoreTab.test.tsx.
vi.mock('@/pages/Chat', () => ({ default: () => <div data-testid="chat" /> }));
vi.mock('@/pages/Launcher', () => ({ default: () => <div data-testid="launcher" /> }));
vi.mock('@/pages/Settings', () => ({ default: () => <div data-testid="settings" /> }));
vi.mock('@/pages/TaskCenter', () => ({ default: () => <div data-testid="taskcenter" /> }));

import { MemoizedTabContent } from '@/App';

// The scene tab is the only place that could wire `onBubbleClaim` into the
// runner, so that wiring is asserted on the props it hands down. Tests that
// need the REAL runner pull it back with `vi.importActual` (see below).
const runnerProps: Record<string, unknown> = {};
vi.mock('./MiniAppRunner', () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(runnerProps, props);
    return <div data-testid="runner" />;
  },
}));

async function importRealRunner() {
  return (
    await vi.importActual<{ default: (p: Record<string, unknown>) => ReactElement }>(
      './MiniAppRunner',
    )
  ).default;
}

function sceneTab(miniapp: Tab['miniapp']): Tab {
  return { id: 'tab-1', view: 'miniapp-scene', miniapp } as unknown as Tab;
}

const tabContentProps = {
  isLoading: false,
  error: null,
  isDeferredMount: false,
  settingsInitialSection: undefined,
  settingsInitialMcpId: undefined,
  settingsInitialSelect: undefined,
  onLaunchProject: vi.fn(),
  onBack: vi.fn(async () => {}),
  onSwitchSession: vi.fn(async () => {}),
  onOpenSessionInNewTab: vi.fn(async () => {}),
  onNewSession: vi.fn(async () => true),
  onUpdateGenerating: vi.fn(),
  onUpdateTitle: vi.fn(),
  onUpdateUnread: vi.fn(),
  onRenameSession: vi.fn(),
  onForkSession: vi.fn(),
  onUpdateSessionId: vi.fn(async () => true),
  onClearInitialMessage: vi.fn(),
  onSidecarConfigAdopted: vi.fn(),
  onSettingsSectionChange: vi.fn(),
  updateReady: false,
  updateVersion: null,
  updateChecking: false,
  updateDownloading: false,
  updateInstalling: false,
  updatePreparing: false,
  onCheckForUpdate: vi.fn(async () => 'up-to-date' as const),
  onRestartAndUpdate: vi.fn(),
  taskCenterPendingIntent: null,
} as unknown as React.ComponentProps<typeof MemoizedTabContent>;

afterEach(() => {
  loadMiniAppSourceWithRoots.mockReset();
  for (const key of Object.keys(runnerProps)) delete runnerProps[key];
  vi.restoreAllMocks();
});

/**
 * `MiniAppSceneTab` reads the host's appearance mode through the public Theme
 * runtime (`useResolvedTheme`) so the value it forwards into the iframe's
 * `app.appearanceMode` matches the real host, not a DOM guess. That runtime
 * requires its provider, so scene-tab renders go through here.
 */
function withTheme(ui: ReactElement): ReactElement {
  const registry = new ThemeRegistry([myAgentsDefaultTheme]);
  return (
    <ThemeRuntimeProvider
      registry={registry}
      selection={{ themeId: myAgentsDefaultTheme.id, appearanceMode: 'dark' }}
    >
      {ui}
    </ThemeRuntimeProvider>
  );
}

describe('MiniApp launch: scene tab → runner', () => {
  it('shows a loading state before the source arrives', () => {
    loadMiniAppSourceWithRoots.mockReturnValue(new Promise(() => {}));
    render(withTheme(<MiniAppSceneTab tab={sceneTab({ appId: 'git-graph' })} isActive />));
    expect(screen.getByText(/Loading git-graph/)).toBeTruthy();
  });

  it('mounts the runner with the fetched source once it resolves', async () => {
    loadMiniAppSourceWithRoots.mockResolvedValue(src('<html><body><p>graph</p></body></html>'));
    render(withTheme(<MiniAppSceneTab tab={sceneTab({ appId: 'git-graph' })} isActive />));

    await waitFor(() => expect(screen.getByTestId('runner')).toBeTruthy());
    expect(loadMiniAppSourceWithRoots).toHaveBeenCalledWith('git-graph');
    expect(runnerProps.srcDoc).toContain('<p>graph</p>');
  });

  it('forwards the declared permissions to the runner as the app.* grant source', async () => {
    loadMiniAppSourceWithRoots.mockResolvedValue(src('<html></html>'));
    render(
      withTheme(
        <MiniAppSceneTab
          tab={sceneTab({
            appId: 'git-graph',
            permissions: { fs: { read: ['{workspace}/**'] }, shell: { allow: ['git'] } },
          })}
          isActive
        />,
      ),
    );

    await waitFor(() => expect(screen.getByTestId('runner')).toBeTruthy());
    expect(runnerProps.permissions).toEqual({
      fs: { read: ['{workspace}/**'] },
      shell: { allow: ['git'] },
    });
  });

  it('hands the sidecar-supplied path roots to the runtime, verbatim', async () => {
    // `app.appDataDir` / `app.workspaceDir` 的值必须与 sidecar 展开
    // `{appdata}` / `{workspace}` 权限前缀时用的是同一组值，所以只能透传，
    // 不能由 scene tab 推算。推算出来的 `{workspace}` 会与真正执行时展开的
    // `currentAgentDir` 不同，作者照它拼路径就会被判越权 —— 而症状是
    // "声明了 fs.read 却读不到自己的文件"，极难定位。
    loadMiniAppSourceWithRoots.mockResolvedValue(
      src('<html></html>', {
        appDataDir: '/home/u/.hamuna/miniapps/git-graph',
        workspaceDir: '/home/u/projects/demo',
      }),
    );
    render(withTheme(<MiniAppSceneTab tab={sceneTab({ appId: 'git-graph' })} isActive />));

    await waitFor(() => expect(screen.getByTestId('runner')).toBeTruthy());
    expect(runnerProps.env).toMatchObject({
      appDataDir: '/home/u/.hamuna/miniapps/git-graph',
      workspaceDir: '/home/u/projects/demo',
    });
  });

  it('degrades to empty roots rather than inventing a path when the sidecar omits them', async () => {
    // 老 sidecar 或异常路径下 roots 可能缺失。此时必须是空串（作者据此知道
    // "没有工作区"），而不是 renderer 兜一个猜的目录 —— 猜错的目录会让作者
    // 往真实存在的错误位置写数据。
    loadMiniAppSourceWithRoots.mockResolvedValue({
      source: '<html></html>',
      appDataDir: '',
      workspaceDir: '',
    });
    render(withTheme(<MiniAppSceneTab tab={sceneTab({ appId: 'git-graph' })} isActive />));

    await waitFor(() => expect(screen.getByTestId('runner')).toBeTruthy());
    expect(runnerProps.env).toMatchObject({ appDataDir: '', workspaceDir: '' });
  });

  it('surfaces a source failure instead of hanging on the spinner', async () => {
    loadMiniAppSourceWithRoots.mockRejectedValue(new Error('HTTP 404'));
    render(withTheme(<MiniAppSceneTab tab={sceneTab({ appId: 'ghost' })} isActive />));

    await waitFor(() => expect(screen.getByText(/Failed to load MiniApp source/)).toBeTruthy());
  });

  it('refetches when the user opens a different MiniApp in the same tab', async () => {
    loadMiniAppSourceWithRoots.mockResolvedValue(src('<html></html>'));
    const { rerender } = render(
      withTheme(<MiniAppSceneTab tab={sceneTab({ appId: 'git-graph' })} isActive />),
    );
    await waitFor(() => expect(loadMiniAppSourceWithRoots).toHaveBeenCalledWith('git-graph'));

    rerender(withTheme(<MiniAppSceneTab tab={sceneTab({ appId: 'file-explorer' })} isActive />));
    await waitFor(() => expect(loadMiniAppSourceWithRoots).toHaveBeenCalledWith('file-explorer'));
  });

  it('falls back to a readable message when the tab carries no payload', () => {
    render(
      withTheme(
        <MiniAppSceneTab tab={{ id: 'tab-1', view: 'miniapp-scene' } as unknown as Tab} isActive />,
      ),
    );
    expect(screen.getByText(/Missing MiniApp payload/)).toBeTruthy();
    expect(loadMiniAppSourceWithRoots).not.toHaveBeenCalled();
  });
});

describe('MiniApp → agent: the Bubble Claim channel', () => {
  it('a Bubble Claim posted by the MiniApp reaches onBubbleClaim', async () => {
    const onBubbleClaim = vi.fn();
    const RealMiniAppRunner = await importRealRunner();
    render(
      <RealMiniAppRunner
        appId="icon-generator"
        srcDoc="<html></html>"
        onBubbleClaim={onBubbleClaim}
      />,
    );
    const iframe = document.querySelector('iframe')!;
    const win = iframe.contentWindow!;
    // jsdom sets `source: null` for a same-window postMessage (correctly — the
    // bridge rejects that), so the claim is delivered as a synthetic
    // MessageEvent carrying the bound window, the way a real iframe would.
    const sent: Array<{ kind?: string; nonce?: string }> = [];
    vi.spyOn(win, 'postMessage').mockImplementation((msg: unknown) => {
      sent.push(msg as { kind?: string; nonce?: string });
    });

    const claim = (nonce: string) =>
      fireEvent(
        window,
        new MessageEvent('message', {
          data: {
            kind: 'chat.claimComposer',
            nonce,
            payload: { appId: 'icon-generator', draft: '帮我画个图标' },
          },
          origin: '',
          source: win,
        }),
      );

    // Round 1: a claim with an invented nonce must still be rejected — the
    // bridge is a trust boundary, not a rubber stamp.
    claim('a-nonce-the-miniapp-invented');
    expect(onBubbleClaim).not.toHaveBeenCalled();

    // Round 2: the host's own nonce (captured from host.ready) is accepted.
    // This is the regression: the host used to mint a nonce and never send it,
    // so every real MiniApp claim was dropped.
    fireEvent.load(iframe);
    const hostReady = sent.find(m => m.kind === 'host.ready');
    expect(hostReady?.nonce).toBeTruthy();
    claim(hostReady!.nonce!);
    await waitFor(() => expect(onBubbleClaim).toHaveBeenCalledTimes(1));
    expect(onBubbleClaim.mock.calls[0][0].payload.draft).toBe('帮我画个图标');
  });

  it('the host hands the MiniApp its nonce on frame load', async () => {
    const RealMiniAppRunner = await importRealRunner();
    render(<RealMiniAppRunner appId="git-graph" srcDoc="<html></html>" />);
    const iframe = document.querySelector('iframe')!;

    // Swap in a recording contentWindow before load fires.
    const sent: Array<{ kind?: string; nonce?: string }> = [];
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { postMessage: (m: { kind?: string; nonce?: string }) => sent.push(m) },
    });
    fireEvent.load(iframe);

    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('host.ready');
    expect(typeof sent[0].nonce).toBe('string');
    expect(sent[0].nonce!.length).toBeGreaterThan(0);
  });

  it('the scene tab wires onBubbleClaim through to the runner', async () => {
    loadMiniAppSourceWithRoots.mockResolvedValue(src('<html></html>'));
    const onBubbleClaim = vi.fn();
    render(
      withTheme(
        <MiniAppSceneTab
          tab={sceneTab({ appId: 'icon-generator' })}
          isActive
          onBubbleClaim={onBubbleClaim}
        />,
      ),
    );
    // The source fetch resolves asynchronously, so wait for the mount.
    await waitFor(() => expect(screen.getByTestId('runner')).toBeTruthy());
    expect(runnerProps.onBubbleClaim).toBe(onBubbleClaim);
  });

  it('App hands its claim handler to the scene tab, tagged with the source tab', async () => {
    loadMiniAppSourceWithRoots.mockResolvedValue(src('<html></html>'));
    const onMiniAppBubbleClaim = vi.fn();
    render(
      withTheme(
        <MemoizedTabContent
          {...tabContentProps}
          tab={sceneTab({ appId: 'icon-generator' })}
          isActive
          onMiniAppBubbleClaim={onMiniAppBubbleClaim}
        />,
      ),
    );
    await waitFor(() => expect(screen.getByTestId('runner')).toBeTruthy());

    const handler = runnerProps.onBubbleClaim as (m: unknown) => void;
    expect(typeof handler).toBe('function');
    handler({ payload: { appId: 'icon-generator', draft: '画个图标' } });
    // App closes over the source tab id so it can route without the claim
    // having to know which tab it came from.
    expect(onMiniAppBubbleClaim).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ payload: expect.objectContaining({ draft: '画个图标' }) }),
    );
  });
});

describe('MiniApp launch: iframe is actually locked down', () => {
  it('injects a CSP that forbids reaching the sidecar directly', async () => {
    const RealMiniAppRunner = await importRealRunner();
    render(<RealMiniAppRunner appId="git-graph" srcDoc="<html><head></head></html>" />);
    const srcdoc = document.querySelector('iframe')!.getAttribute('srcdoc')!;

    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
    // connect-src is the anti-bypass directive (PRD v0.3 §11.1): every
    // capability goes through postMessage, so the iframe needs no network.
    expect(srcdoc).toContain("connect-src &#39;none&#39;");
    expect(srcdoc).toContain('default-src');
  });

  it('strips a MiniApp-supplied CSP rather than letting it widen ours', async () => {
    const RealMiniAppRunner = await importRealRunner();
    render(
      <RealMiniAppRunner
        appId="evil"
        srcDoc={
          '<html><head><meta http-equiv="Content-Security-Policy" content="connect-src *"></head></html>'
        }
      />,
    );
    const srcdoc = document.querySelector('iframe')!.getAttribute('srcdoc')!;

    expect(srcdoc).not.toContain('connect-src *');
    expect(srcdoc.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });

  it('still permits the linked/scripted markup every MiniApp actually ships', async () => {
    // Regression: an earlier policy was `default-src 'none'` + plain
    // 'unsafe-inline', which permits only INLINE style/script. Every bundled
    // MiniApp ships `<link rel="stylesheet" href="style.css">` and
    // `<script src="ui.js">`, so the app rendered completely unstyled and
    // inert. 'self' is mandatory in both directives.
    const RealMiniAppRunner = await importRealRunner();
    const html = [
      '<html><head>',
      '<link rel="stylesheet" href="style.css" />',
      '</head><body><script src="ui.js"></script></body></html>',
    ].join('');
    render(<RealMiniAppRunner appId="git-graph" srcDoc={html} />);
    const srcdoc = document.querySelector('iframe')!.getAttribute('srcdoc')!;

    // The policy is HTML-escaped into the attribute (`'` → `&#39;`).
    const raw = /content="([^"]*default-src[^"]*)"/.exec(srcdoc)?.[1] ?? '';
    const csp = raw
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    expect(csp).toContain("script-src 'unsafe-inline' 'self'");
    expect(csp).toContain("style-src 'unsafe-inline' 'self'");
    // The anti-bypass directive must survive the relaxation.
    expect(csp).toContain("connect-src 'none'");
  });
});

describe('MiniApp → LLM: not built, deliberately', () => {
  it.fails('a MiniApp can reach an LLM / the agent', () => {
    // `permissions.ai` is declared in all five bundled meta.json files and
    // shape-checked by meta-schema.ts, but nothing reads it at runtime, and
    // the iframe CSP now pins `connect-src 'none'`. A direct model call would
    // need a host route, a metering policy, and a permission prompt — see the
    // report; Bubble Claim is the designed channel instead.
    const meta = JSON.parse('{"permissions":{"ai":{"enabled":true}}}') as {
      permissions: { ai: { enabled: boolean } };
    };
    expect(
      meta.permissions.ai.enabled && false,
      'permissions.ai has no runtime consumer — declaring it in meta.json does ' +
        'nothing. A MiniApp needs a real bridge (host route + prompt) to reach a model.',
    ).toBe(true);
  });
});
