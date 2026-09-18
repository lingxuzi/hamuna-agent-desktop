import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLAUDE_TRANSCRIPT_CLEANUP_PERIOD_DAYS,
  DEFAULT_CONFIG,
  CODEX_SUBSCRIPTION_PROVIDER_ID,
  MANAGED_CODEX_PROVIDER,
  MANAGED_CODEX_REQUIRED_RUNTIME,
  NXGD_PROVIDER_ID,
  PRESET_PROVIDERS,
  SUBSCRIPTION_PROVIDER_ID,
  XAI_SUBSCRIPTION_PROVIDER_ID,
  applyManagedCodexProviderReadiness,
  applyProviderEnablementAndOrder,
  getEffectiveModelAliases,
  getManagedCodexProviderReadiness,
  isManagedCodexRequiredRuntimeInstalled,
  isManagedCodexProviderGateEnabled,
  isManagedCodexRuntimeUsable,
  isManagedCodexSubscriptionAuthValid,
  mergePresetModelWithCustomEntry,
  normalizeChatQueueResponseMode,
  normalizeClaudeTranscriptCleanupPeriodDays,
  normalizeProviderOrder,
  shouldAutoUpdateManagedCodexRuntime,
  splitProviderModelInput,
  withManagedCodexRuntimeModels,
  withManagedCodexProviderCatalog,
  withNxgdDiscoveredModels,
} from './config-types';
import managedCodexRuntimeLock from './managed-codex-runtime.json';

// normalizeProviderOrder reconciles a persisted provider order against the set
// of providers that actually exist now: honor the saved order, drop stale/
// unknown ids, dedupe, then append any known providers the order didn't mention
// (newly added). Drift here scrambles or drops providers from the picker.
describe('normalizeProviderOrder', () => {
  it('honors the saved order, then appends known providers missing from it', () => {
    expect(normalizeProviderOrder(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b']);
  });

  it('places newly introduced Codex subscription after Anthropic subscription when the saved order is missing it', () => {
    expect(normalizeProviderOrder(
      [SUBSCRIPTION_PROVIDER_ID, CODEX_SUBSCRIPTION_PROVIDER_ID, 'anthropic-api', 'deepseek'],
      [SUBSCRIPTION_PROVIDER_ID, 'anthropic-api', 'deepseek'],
    )).toEqual([
      SUBSCRIPTION_PROVIDER_ID,
      CODEX_SUBSCRIPTION_PROVIDER_ID,
      'anthropic-api',
      'deepseek',
    ]);
  });

  it('honors an explicit saved Codex subscription position', () => {
    expect(normalizeProviderOrder(
      [SUBSCRIPTION_PROVIDER_ID, CODEX_SUBSCRIPTION_PROVIDER_ID, 'anthropic-api', 'deepseek'],
      ['deepseek', CODEX_SUBSCRIPTION_PROVIDER_ID, SUBSCRIPTION_PROVIDER_ID],
    )).toEqual([
      'deepseek',
      CODEX_SUBSCRIPTION_PROVIDER_ID,
      SUBSCRIPTION_PROVIDER_ID,
      'anthropic-api',
    ]);
  });

  it('places Grok after Codex when present and after Anthropic otherwise', () => {
    expect(normalizeProviderOrder(
      [SUBSCRIPTION_PROVIDER_ID, CODEX_SUBSCRIPTION_PROVIDER_ID, XAI_SUBSCRIPTION_PROVIDER_ID, 'anthropic-api'],
      [SUBSCRIPTION_PROVIDER_ID, 'anthropic-api'],
    )).toEqual([
      SUBSCRIPTION_PROVIDER_ID,
      CODEX_SUBSCRIPTION_PROVIDER_ID,
      XAI_SUBSCRIPTION_PROVIDER_ID,
      'anthropic-api',
    ]);
    expect(normalizeProviderOrder(
      [SUBSCRIPTION_PROVIDER_ID, XAI_SUBSCRIPTION_PROVIDER_ID, 'anthropic-api'],
      [SUBSCRIPTION_PROVIDER_ID, 'anthropic-api'],
    )).toEqual([
      SUBSCRIPTION_PROVIDER_ID,
      XAI_SUBSCRIPTION_PROVIDER_ID,
      'anthropic-api',
    ]);
  });

  it('drops ids in the order that are no longer known', () => {
    expect(normalizeProviderOrder(['a', 'b'], ['stale', 'a'])).toEqual(['a', 'b']);
  });

  it('dedupes repeated ids in the saved order', () => {
    expect(normalizeProviderOrder(['a', 'b'], ['a', 'a', 'b', 'b'])).toEqual(['a', 'b']);
  });

  it('falls back to the known order when no saved order is given', () => {
    expect(normalizeProviderOrder(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(normalizeProviderOrder(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns empty for no known providers', () => {
    expect(normalizeProviderOrder([], ['a', 'b'])).toEqual([]);
  });
});

describe('Grok subscription preset', () => {
  it('bundles only the two core models and leaves the remaining catalog to discovery', () => {
    const grok = PRESET_PROVIDERS.find(provider => provider.id === XAI_SUBSCRIPTION_PROVIDER_ID);
    expect(grok?.primaryModel).toBe('grok-4.5');
    expect(grok?.models.map(model => model.model)).toEqual([
      'grok-4.5',
      'grok-composer-2.5-fast',
    ]);
  });
});

describe('mergePresetModelWithCustomEntry', () => {
  const preset = {
    model: 'claude-fable-5',
    modelName: 'Claude Fable 5',
    modelSeries: 'claude',
    contextLength: 200_000,
    inputModalities: ['text'],
    source: 'preset' as const,
  };

  it('lets manual custom entries override bundled preset fields', () => {
    expect(mergePresetModelWithCustomEntry(preset, {
      model: 'claude-fable-5',
      modelName: 'Fable via proxy',
      modelSeries: 'claude',
      contextLength: 1_000_000,
      inputModalities: ['text', 'image'],
      source: 'manual',
    })).toMatchObject({
      modelName: 'Fable via proxy',
      contextLength: 1_000_000,
      inputModalities: ['text', 'image'],
    });
  });

  it('treats legacy source-less custom entries as user-authored overrides', () => {
    expect(mergePresetModelWithCustomEntry(preset, {
      model: 'claude-fable-5',
      modelName: 'Legacy override',
      modelSeries: 'claude',
      contextLength: 512_000,
    })).toMatchObject({
      modelName: 'Legacy override',
      contextLength: 512_000,
    });
  });

  it('uses discovered entries only to fill fields missing from the preset', () => {
    expect(mergePresetModelWithCustomEntry(preset, {
      model: 'claude-fable-5',
      modelName: 'Discovered name',
      modelSeries: 'claude',
      contextLength: 1_000_000,
      inputModalities: ['text', 'image'],
      source: 'discovered',
    })).toMatchObject({
      modelName: 'Claude Fable 5',
      contextLength: 200_000,
      inputModalities: ['text'],
    });
  });

  it('fills discovered metadata when the bundled preset leaves a field empty', () => {
    expect(mergePresetModelWithCustomEntry(
      { ...preset, contextLength: undefined, inputModalities: undefined },
      {
        model: 'claude-fable-5',
        modelName: 'Discovered name',
        modelSeries: 'claude',
        contextLength: 1_000_000,
        inputModalities: ['text', 'image'],
        source: 'discovered',
      },
    )).toMatchObject({
      modelName: 'Claude Fable 5',
      contextLength: 1_000_000,
      inputModalities: ['text', 'image'],
    });
  });
});

describe('splitProviderModelInput', () => {
  it('preserves a single model id when no comma separator is present', () => {
    expect(splitProviderModelInput(' sensenova-6.7-flash-lite ')).toEqual(['sensenova-6.7-flash-lite']);
  });

  it('splits ASCII and Chinese comma-separated model ids and trims whitespace', () => {
    expect(splitProviderModelInput('m1, m2， m3')).toEqual(['m1', 'm2', 'm3']);
  });

  it('drops empty segments created by extra separators', () => {
    expect(splitProviderModelInput(' m1, ,，m2，')).toEqual(['m1', 'm2']);
  });
});

describe('normalizeClaudeTranscriptCleanupPeriodDays', () => {
  it('uses a one-year default for missing or invalid values', () => {
    expect(DEFAULT_CONFIG.claudeTranscriptCleanupPeriodDays).toBe(DEFAULT_CLAUDE_TRANSCRIPT_CLEANUP_PERIOD_DAYS);
    expect(DEFAULT_CLAUDE_TRANSCRIPT_CLEANUP_PERIOD_DAYS).toBe(365);
    expect(normalizeClaudeTranscriptCleanupPeriodDays(undefined)).toBe(365);
    expect(normalizeClaudeTranscriptCleanupPeriodDays(Number.NaN)).toBe(365);
    expect(normalizeClaudeTranscriptCleanupPeriodDays('bad')).toBe(365);
  });

  it('passes a positive integer day count to the SDK settings layer', () => {
    expect(normalizeClaudeTranscriptCleanupPeriodDays(30)).toBe(30);
    expect(normalizeClaudeTranscriptCleanupPeriodDays('180')).toBe(180);
    expect(normalizeClaudeTranscriptCleanupPeriodDays(30.9)).toBe(30);
    expect(normalizeClaudeTranscriptCleanupPeriodDays(0)).toBe(1);
    expect(normalizeClaudeTranscriptCleanupPeriodDays(-12)).toBe(1);
  });
});

describe('normalizeChatQueueResponseMode', () => {
  it('defaults to realtime and accepts only the turn override', () => {
    expect(DEFAULT_CONFIG.chatQueueResponseMode).toBe('realtime');
    expect(normalizeChatQueueResponseMode(undefined)).toBe('realtime');
    expect(normalizeChatQueueResponseMode('realtime')).toBe('realtime');
    expect(normalizeChatQueueResponseMode('turn')).toBe('turn');
    expect(normalizeChatQueueResponseMode('invalid')).toBe('realtime');
  });
});

describe('Zhipu preset models', () => {
  it('ships GLM-5.2 in both Coding Plan and API presets with official 1M window metadata', () => {
    for (const providerId of ['zhipu', 'zhipu-ai']) {
      const provider = PRESET_PROVIDERS.find(p => p.id === providerId);
      const model = provider?.models.find(m => m.model === 'glm-5.2');

      expect(model).toMatchObject({
        modelName: 'GLM 5.2',
        modelSeries: 'zhipu',
        contextLength: 1_000_000,
        maxOutputTokens: 131_072,
        inputModalities: ['text'],
      });
      expect(provider?.modelAliases).toEqual({
        opus: 'glm-5.2',
        sonnet: 'glm-5.1',
        haiku: 'glm-5.1',
      });
    }
  });
});

describe('Anthropic preset models', () => {
  it('ships the current Agent SDK model family and pins current default aliases', () => {
    const provider = PRESET_PROVIDERS.find(p => p.id === SUBSCRIPTION_PROVIDER_ID);
    expect(provider?.primaryModel).toBe('claude-sonnet-5');
    expect(provider?.modelAliases).toEqual({
      fable: 'claude-fable-5',
      opus: 'claude-opus-4-8',
      sonnet: 'claude-sonnet-5',
      haiku: 'claude-haiku-4-5',
    });

    const models = new Map(provider?.models.map(model => [model.model, model]));
    expect(models.get('claude-fable-5')).toMatchObject({
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      inputModalities: ['text', 'image'],
    });
    expect(models.get('claude-sonnet-5')).toMatchObject({
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      inputModalities: ['text', 'image'],
    });
    expect(models.get('claude-haiku-4-5')).toMatchObject({
      contextLength: 200_000,
      maxOutputTokens: 64_000,
    });
  });
});

describe('model aliases', () => {
  it('backfills fable from opus for third-party preset aliases', () => {
    const provider = PRESET_PROVIDERS.find(p => p.id === 'zhipu');
    expect(provider).toBeTruthy();
    expect(getEffectiveModelAliases(provider!)).toEqual({
      fable: 'glm-5.2',
      opus: 'glm-5.2',
      sonnet: 'glm-5.1',
      haiku: 'glm-5.1',
    });
  });
});

describe('desktop pet defaults', () => {
  it('shows the desktop pet tab by default but keeps the floating ball off', () => {
    expect(DEFAULT_CONFIG.floatingBallDevGate).toBe(true);
    expect(DEFAULT_CONFIG.floatingBallEnabled).toBe(false);
  });

  it('keeps hover peek enabled for existing desktop pet behavior', () => {
    expect(DEFAULT_CONFIG.floatingBallHoverPeekEnabled).toBe(true);
  });
});

describe('CLI tool registry defaults', () => {
  it('keeps the experimental registry off by default', () => {
    expect(DEFAULT_CONFIG.cliToolRegistryEnabled).toBe(false);
  });
});

describe('Managed Codex provider readiness', () => {
  it('derives every shared runtime identity field from the single lock', () => {
    expect(MANAGED_CODEX_REQUIRED_RUNTIME.version).toBe(managedCodexRuntimeLock.version);
    expect(MANAGED_CODEX_REQUIRED_RUNTIME.runtimeSet).toBe(`codex-${managedCodexRuntimeLock.version}`);
    expect(MANAGED_CODEX_REQUIRED_RUNTIME.manifestBaseUrl).toBe(
      `https://download.hamuna.io/runtimes/codex/sets/codex-${managedCodexRuntimeLock.version}`,
    );
  });

  it('auto-updates stale installs and retries a failed upgrade on the next App launch', () => {
    const staleInstall = {
      installedVersion: '0.0.0-previous',
      requiredVersion: MANAGED_CODEX_REQUIRED_RUNTIME.version,
    };

    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: { status: 'installed', ...staleInstall },
    })).toBe(true);
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: { status: 'update-required', ...staleInstall },
    })).toBe(true);
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: { status: 'error', ...staleInstall },
    })).toBe(true);
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: {
        status: 'error',
        installedVersion: MANAGED_CODEX_REQUIRED_RUNTIME.version,
      },
    })).toBe(true);
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: { status: 'downloading', ...staleInstall },
    })).toBe(true);
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: { status: 'checking', ...staleInstall },
    })).toBe(true);
  });

  it('keeps a verified stale runtime usable while its replacement downloads or retries', () => {
    const staleVersion = '0.0.0-previous';
    expect(isManagedCodexRuntimeUsable({
      status: 'downloading',
      usable: true,
      installedVersion: staleVersion,
    })).toBe(true);
    expect(isManagedCodexRuntimeUsable({
      status: 'error',
      usable: true,
      installedVersion: staleVersion,
    })).toBe(true);
    expect(isManagedCodexRuntimeUsable({
      status: 'update-required',
      installedVersion: staleVersion,
    })).toBe(false);
    expect(isManagedCodexRuntimeUsable({
      status: 'update-required',
      usable: false,
      installedVersion: staleVersion,
    })).toBe(false);
  });

  it('does not auto-download for new users or retry a failed first install', () => {
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
    })).toBe(false);
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: { status: 'not-installed' },
    })).toBe(false);
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: { status: 'error' },
    })).toBe(false);
    expect(shouldAutoUpdateManagedCodexRuntime({
      managedCodexProviderDevGate: false,
      managedCodexRuntimeInstall: {
        status: 'update-required',
        installedVersion: '0.0.0-previous',
      },
    })).toBe(false);
  });

  it('defaults the developer gate on but still honors explicit disablement', () => {
    expect(DEFAULT_CONFIG.managedCodexProviderDevGate).toBe(true);
    expect(isManagedCodexProviderGateEnabled({})).toBe(false);
    expect(isManagedCodexProviderGateEnabled({ managedCodexProviderDevGate: true })).toBe(true);
    expect(isManagedCodexProviderGateEnabled({ managedCodexProviderDevGate: false })).toBe(false);
  });

  it('keeps the provider out of the catalogue while the developer gate is explicitly off', () => {
    expect(withManagedCodexProviderCatalog([MANAGED_CODEX_PROVIDER], {
      managedCodexProviderDevGate: false,
    }).some(provider => provider.id === CODEX_SUBSCRIPTION_PROVIDER_ID)).toBe(false);
  });

  it('inserts the provider after Anthropic subscription in the default catalogue', () => {
    const catalog = withManagedCodexProviderCatalog(PRESET_PROVIDERS, DEFAULT_CONFIG);

    expect(catalog.slice(0, 4).map(provider => provider.id)).toEqual([
      'nxgd',
      SUBSCRIPTION_PROVIDER_ID,
      CODEX_SUBSCRIPTION_PROVIDER_ID,
      XAI_SUBSCRIPTION_PROVIDER_ID,
    ]);
  });

  it('shows the provider card by default but keeps it unselectable until ready', () => {
    const catalog = withManagedCodexProviderCatalog([], DEFAULT_CONFIG);
    const providers = applyManagedCodexProviderReadiness(catalog, DEFAULT_CONFIG);

    expect(catalog.map(provider => provider.id)).toEqual([CODEX_SUBSCRIPTION_PROVIDER_ID]);
    expect(providers[0].enabled).toBeUndefined();
    expect(providers[0].runtimeReady).toBe(false);
    expect(getManagedCodexProviderReadiness(DEFAULT_CONFIG).reason).toBe('runtime-not-installed');
  });

  it('derives Codex subscription models from the managed runtime model list', () => {
    const provider = withManagedCodexRuntimeModels(MANAGED_CODEX_PROVIDER, [
      { value: 'gpt-5.1', displayName: 'GPT-5.1' },
      { value: 'gpt-5', displayName: 'GPT-5', isDefault: true },
      { value: '', displayName: '默认', isDefault: true },
      { value: 'gpt-5', displayName: 'duplicate' },
    ]);

    expect(MANAGED_CODEX_PROVIDER.models).toEqual([]);
    expect(provider.primaryModel).toBe('gpt-5');
    expect(provider.models.map(model => model.model)).toEqual(['gpt-5.1', 'gpt-5']);
    expect(provider.models[0]).toMatchObject({
      modelName: 'GPT-5.1',
      modelSeries: 'codex',
      source: 'discovered',
    });
  });

  it('requires exact runtime version, subscription auth, and no explicit disablement', () => {
    const runtime = {
      status: 'installed' as const,
      usable: true,
      installedVersion: MANAGED_CODEX_REQUIRED_RUNTIME.version,
      requiredVersion: MANAGED_CODEX_REQUIRED_RUNTIME.version,
    };
    const auth = {
      status: 'valid' as const,
      authMethod: 'chatgpt' as const,
    };

    expect(isManagedCodexRequiredRuntimeInstalled(runtime)).toBe(true);
    expect(isManagedCodexSubscriptionAuthValid(auth)).toBe(true);
    expect(getManagedCodexProviderReadiness({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: runtime,
      managedCodexAuth: auth,
    })).toMatchObject({
      visible: true,
      selectable: true,
      reason: 'ready',
    });
  });

  it('keeps a verified stale runtime selectable while the required version updates', () => {
    expect(getManagedCodexProviderReadiness({
      managedCodexProviderDevGate: true,
      managedCodexRuntimeInstall: {
        status: 'downloading',
        usable: true,
        installedVersion: '0.0.0-previous',
        requiredVersion: MANAGED_CODEX_REQUIRED_RUNTIME.version,
      },
      managedCodexAuth: {
        status: 'valid',
        authMethod: 'chatgpt',
      },
    })).toMatchObject({
      visible: true,
      selectable: true,
      reason: 'ready',
    });
  });

  it('does not treat Codex API-key auth as subscription readiness', () => {
    expect(isManagedCodexSubscriptionAuthValid({
      status: 'valid',
      authMethod: 'api-key',
    })).toBe(false);
  });

  it('preserves explicit provider disablement even after readiness succeeds', () => {
    const providers = applyManagedCodexProviderReadiness([
      { ...MANAGED_CODEX_PROVIDER, enabled: false },
    ], {
      managedCodexProviderDevGate: true,
      disabledProviderIds: [CODEX_SUBSCRIPTION_PROVIDER_ID],
      managedCodexRuntimeInstall: {
        status: 'installed',
        usable: true,
        installedVersion: MANAGED_CODEX_REQUIRED_RUNTIME.version,
      },
      managedCodexAuth: {
        status: 'valid',
        authMethod: 'chatgpt',
      },
    });

    expect(providers[0].enabled).toBe(false);
    expect(providers[0].runtimeReady).toBe(true);
  });
});

// withNxgdDiscoveredModels — overlays runtime-discovered model entities onto
// the built-in nxgd (中国广电) provider so the Chat UI's model selector
// populates without the user having to open Settings → Manage Models first.
// Locks in: (a) dedup by model id, (b) primaryModel pinning when the preset
// primary is not in the discovered list, (c) passthrough when no discovered
// models arrive (so the user-customized empty list is preserved).
describe('nxgd preset', () => {
  const nxgdProvider = PRESET_PROVIDERS.find(provider => provider.id === 'nxgd')!;

  it('collapses modelAliases to the upstream-real model id (not Claude ids)', () => {
    // All 4 aliases must point at the same upstream-real id. If split,
    // resolveSessionModelAliases() preserves the table verbatim and SDK
    // subagents end up dispatching `claude-fable-5` etc. to nxgd upstream,
    // which only serves `deepseek-v4-flash-0731` → 404.
    expect(nxgdProvider.modelAliases).toEqual({
      fable: 'deepseek-v4-flash-0731',
      opus: 'deepseek-v4-flash-0731',
      sonnet: 'deepseek-v4-flash-0731',
      haiku: 'deepseek-v4-flash-0731',
    });
  });
});

describe('withNxgdDiscoveredModels', () => {
  const nxgdProvider = PRESET_PROVIDERS.find(provider => provider.id === 'nxgd')!;

  it('fills the preset nxgd provider with discovered models', () => {
    const providers = withNxgdDiscoveredModels(PRESET_PROVIDERS, [
      { model: 'deepseek-v4-flash-0731', modelName: 'DeepSeek V4 Flash', modelSeries: 'claude', source: 'discovered' },
    ]);

    const after = providers.find(provider => provider.id === 'nxgd')!;
    expect(after.models.map(m => m.model)).toEqual(['deepseek-v4-flash-0731']);
    expect(after.primaryModel).toBe('deepseek-v4-flash-0731');
  });

  it('pins the preset primaryModel when it is in the discovered list', () => {
    const providers = withNxgdDiscoveredModels([{ ...nxgdProvider, primaryModel: 'deepseek-v4-flash-0731' }], [
      { model: 'deepseek-v4-flash-0731', modelName: 'DeepSeek V4 Flash', modelSeries: 'claude', source: 'discovered' },
      { model: 'qwen3-max', modelName: 'Qwen3 Max', modelSeries: 'claude', source: 'discovered' },
    ]);

    expect(providers[0].primaryModel).toBe('deepseek-v4-flash-0731');
    expect(providers[0].models.map(m => m.model)).toEqual(['deepseek-v4-flash-0731', 'qwen3-max']);
  });

  it('dedupes by model id when preset and discovered lists overlap', () => {
    const providers = withNxgdDiscoveredModels([
      {
        ...nxgdProvider,
        models: [{ model: 'shared', modelName: 'Preset', modelSeries: 'claude', source: 'preset' }],
      },
    ], [
      { model: 'shared', modelName: 'Discovered', modelSeries: 'claude', source: 'discovered' },
      { model: 'fresh', modelName: 'Fresh', modelSeries: 'claude', source: 'discovered' },
    ]);

    // Preset entry wins (added first, dedup keeps the first occurrence).
    expect(providers[0].models).toHaveLength(2);
    expect(providers[0].models.map(m => m.model)).toEqual(['shared', 'fresh']);
    expect(providers[0].models[0].source).toBe('preset');
  });

  it('leaves the provider untouched when no discovered models arrive', () => {
    const providers = withNxgdDiscoveredModels(PRESET_PROVIDERS, undefined);
    const after = providers.find(provider => provider.id === 'nxgd')!;
    expect(after).toBe(nxgdProvider); // same reference
    expect(after.models).toEqual(nxgdProvider.models);
  });

  it('does not touch non-nxgd providers', () => {
    const anthropicSub = PRESET_PROVIDERS.find(provider => provider.id === SUBSCRIPTION_PROVIDER_ID)!;
    const providers = withNxgdDiscoveredModels(PRESET_PROVIDERS, [
      { model: 'deepseek-v4-flash-0731', modelName: 'DeepSeek', modelSeries: 'claude', source: 'discovered' },
    ]);

    const after = providers.find(provider => provider.id === SUBSCRIPTION_PROVIDER_ID)!;
    expect(after).toBe(anthropicSub); // same reference — untouched
  });
});

// 新装默认仅启用 nxgd；其余 18 个预设 provider 标记 disabled，由用户在 Settings → 启用和排序对话框手动启用。
// 单一真相源 = disabledProviderIds；PRESET_PROVIDERS 字面量保持不变，applyProviderEnablementAndOrder 派生 enabled。
describe('default provider enablement', () => {
  it('DEFAULT_CONFIG.disabledProviderIds 包含所有非 nxgd 预设 id，长度 = PRESET_PROVIDERS - 1', () => {
    const nonNxgdPresetIds = PRESET_PROVIDERS
      .map(provider => provider.id)
      .filter(id => id !== NXGD_PROVIDER_ID);
    expect(DEFAULT_CONFIG.disabledProviderIds).toEqual(nonNxgdPresetIds);
    expect(DEFAULT_CONFIG.disabledProviderIds).toHaveLength(PRESET_PROVIDERS.length - 1);
  });

  it('DEFAULT_CONFIG.disabledProviderIds 不包含 nxgd', () => {
    expect(DEFAULT_CONFIG.disabledProviderIds).not.toContain(NXGD_PROVIDER_ID);
  });

  it('applyProviderEnablementAndOrder 用 DEFAULT_CONFIG 派生 → 18 个非 nxgd disabled + nxgd enabled', () => {
    const derived = applyProviderEnablementAndOrder(
      PRESET_PROVIDERS,
      { providerOrder: [], disabledProviderIds: DEFAULT_CONFIG.disabledProviderIds },
    );
    const byId = new Map(derived.map(provider => [provider.id, provider]));
    for (const provider of derived) {
      if (provider.id === NXGD_PROVIDER_ID) {
        expect(provider.enabled).not.toBe(false); // 启用
      } else {
        expect(provider.enabled).toBe(false); // 停用
      }
    }
    expect(byId.get(NXGD_PROVIDER_ID)).toBeDefined();
  });

  it('老用户路径：磁盘 disabledProviderIds:[] 覆盖默认 → 全部 enabled', () => {
    const derived = applyProviderEnablementAndOrder(
      PRESET_PROVIDERS,
      { providerOrder: [], disabledProviderIds: [] },
    );
    const disabledCount = derived.filter(provider => provider.enabled === false).length;
    expect(disabledCount).toBe(0);
  });

  it('老用户显式部分禁用：disabledProviderIds:[anthropic-sub] → 仅 anthropic-sub disabled + 其余全 enabled', () => {
    const somePresetId = PRESET_PROVIDERS
      .map(provider => provider.id)
      .find(id => id !== NXGD_PROVIDER_ID)!;
    const derived = applyProviderEnablementAndOrder(
      PRESET_PROVIDERS,
      { providerOrder: [], disabledProviderIds: [somePresetId] },
    );
    const target = derived.find(provider => provider.id === somePresetId);
    expect(target?.enabled).toBe(false);
    const others = derived.filter(provider => provider.id !== somePresetId);
    for (const provider of others) {
      expect(provider.enabled).not.toBe(false);
    }
  });
});
