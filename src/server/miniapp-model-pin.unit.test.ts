// `resolveMiniAppModelPin` —— MiniApp 用哪个 provider 的判定。
//
// 这个函数存在的理由是一个具体的 bug：`app.ai` 跑在**全局** sidecar 里，读到的
// `getSessionProviderEnv()` 是进程级全局，只有 Rust IM router 会写它；而用户在聊天
// 框里选的 provider 是 renderer 的 per-tab state，只作为 `builtinSelection` 逐条
// 消息下发。结果 MiniApp 用的供应商与"对话中指定的"对不上，而用户无从纠正。
//
// 所以这里钉住的是**优先级本身**，那才是回归点：
//   - 有配置 pin → 用 pin，哪怕会话当前是另一个 provider（这正是修复）；
//   - 无配置 pin → 回落会话 provider（不配置的人感知不到任何变化）；
//   - pin 指向一个解析不出 env 的 provider → **不**回落，报成一条可执行的错误
//     （静默回落会退回用户正想逃离的那个行为）。
//
// `./utils/admin-config` 被整体 mock：它会去读 `~/.hamuna` 下的真实 provider 文件，
// 那既不是本仓库要断言的东西，也会让一个纯逻辑测试依赖用户磁盘。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveProviderEnv = vi.fn();
const findEffectiveProvider = vi.fn();

vi.mock('./utils/admin-config', () => ({
  resolveProviderEnv: (id: string, config: unknown) => resolveProviderEnv(id, config),
  findEffectiveProvider: (id: string, config: unknown) => findEffectiveProvider(id, config),
}));

const { describeMiniAppPinProblem, resolveMiniAppModelPin } = await import('./miniapp-model-pin');

const PINNED_ENV = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'k' };
const SESSION_ENV = { providerId: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'k2' };

describe('resolveMiniAppModelPin', () => {
  beforeEach(() => {
    resolveProviderEnv.mockReset();
    findEffectiveProvider.mockReset();
  });

  it('uses the pinned provider instead of the session provider', () => {
    // The regression: session says openai, the user pinned deepseek for MiniApps.
    resolveProviderEnv.mockImplementation((id: string) =>
      id === 'deepseek' ? PINNED_ENV : SESSION_ENV,
    );

    const pin = resolveMiniAppModelPin({ miniappProviderId: 'deepseek' }, 'openai');

    expect(pin.providerId).toBe('deepseek');
    expect(pin.providerEnv).toEqual(PINNED_ENV);
    expect(resolveProviderEnv).toHaveBeenCalledWith('deepseek', { miniappProviderId: 'deepseek' });
  });

  it('falls back to the session provider when nothing is pinned', () => {
    resolveProviderEnv.mockReturnValue(SESSION_ENV);

    const pin = resolveMiniAppModelPin({}, 'openai');

    expect(pin.providerId).toBe('openai');
    expect(pin.providerEnv).toEqual(SESSION_ENV);
  });

  it('falls back to the subscription provider when there is no session provider either', () => {
    resolveProviderEnv.mockReturnValue(undefined);

    expect(resolveMiniAppModelPin({}).providerId).toBe('anthropic-sub');
  });

  it('treats a blank pin as unpinned rather than resolving provider ""', () => {
    // An empty string reaches config.json when the user clicks "Follow
    // conversation" — updateConfig writes undefined, but hand-edited config and
    // older writes both produce "". Falling through to resolveProviderEnv('')
    // would return undefined and silently downgrade to the subscription provider.
    resolveProviderEnv.mockReturnValue(SESSION_ENV);

    const pin = resolveMiniAppModelPin({ miniappProviderId: '   ' }, 'openai');

    expect(pin.providerId).toBe('openai');
  });

  it('carries the pinned model alongside the pinned provider', () => {
    resolveProviderEnv.mockReturnValue(PINNED_ENV);

    const pin = resolveMiniAppModelPin({
      miniappProviderId: 'deepseek',
      miniappModel: 'deepseek-chat',
    });

    expect(pin.providerId).toBe('deepseek');
    expect(pin.model).toBe('deepseek-chat');
  });

  it('ignores a model configured without a provider pin', () => {
    // A hand-edited config can hold `miniappModel` with no `miniappProviderId`.
    // Honouring it would send provider B's upstream a model id from provider A —
    // the id only means something relative to its own provider.
    resolveProviderEnv.mockReturnValue(SESSION_ENV);

    expect(resolveMiniAppModelPin({ miniappModel: 'deepseek-chat' }, 'openai').model)
      .toBeUndefined();
  });

  it('does not fall back to the session provider when the pin cannot be resolved', () => {
    // Pinned provider has no API key → providerEnv undefined. The id must still
    // be the pinned one so the caller can report a concrete error; quietly
    // inheriting the session provider here is the bug being fixed.
    resolveProviderEnv.mockReturnValue(undefined);

    const pin = resolveMiniAppModelPin({ miniappProviderId: 'deepseek' }, 'openai');

    expect(pin.providerId).toBe('deepseek');
    expect(pin.providerEnv).toBeUndefined();
  });
});

describe('describeMiniAppPinProblem', () => {
  beforeEach(() => {
    resolveProviderEnv.mockReset();
    findEffectiveProvider.mockReset();
  });

  it('has nothing to say when no pin is configured', () => {
    expect(describeMiniAppPinProblem({})).toBeNull();
  });

  it('says nothing when the pinned provider resolves', () => {
    findEffectiveProvider.mockReturnValue({ id: 'deepseek', name: 'DeepSeek' });
    resolveProviderEnv.mockReturnValue(PINNED_ENV);

    expect(describeMiniAppPinProblem({ miniappProviderId: 'deepseek' })).toBeNull();
  });

  it('names the provider when it no longer exists', () => {
    findEffectiveProvider.mockReturnValue(null);

    expect(describeMiniAppPinProblem({ miniappProviderId: 'gone' }))
      .toMatch(/'gone' no longer exists/);
  });

  it('points at the API key when the pinned provider has no credential', () => {
    findEffectiveProvider.mockReturnValue({ id: 'deepseek', name: 'DeepSeek' });
    resolveProviderEnv.mockReturnValue(undefined);

    expect(describeMiniAppPinProblem({ miniappProviderId: 'deepseek' }))
      .toMatch(/'DeepSeek' has no usable credential/);
  });
});