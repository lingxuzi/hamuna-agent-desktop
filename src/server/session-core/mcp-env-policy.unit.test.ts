import { describe, expect, it } from 'vitest';

import {
  MCP_LOCALHOST_NO_PROXY_VAL,
  applyNpmEnv,
  buildMcpSubprocessEnv,
} from './mcp-env-policy';

describe('mcp-env-policy', () => {
  it('injects localhost NO_PROXY protection when the MCP has no explicit override', () => {
    const env = buildMcpSubprocessEnv({
      HTTPS_PROXY: 'http://proxy.local:7890',
      NO_PROXY: 'dirty-system-value',
      no_proxy: 'dirty-system-value',
    }, undefined);

    expect(env.HTTPS_PROXY).toBe('http://proxy.local:7890');
    expect(env.NO_PROXY).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
    expect(env.no_proxy).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
  });

  it('merges per-server NO_PROXY with mandatory localhost protection and mirrors the other casing', () => {
    const env = buildMcpSubprocessEnv({
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1',
    }, {
      NO_PROXY: '.corp.local',
    });

    expect(env.NO_PROXY).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
    expect(env.no_proxy).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
  });

  it('preserves explicit per-server values for both casings while keeping localhost protection', () => {
    const env = buildMcpSubprocessEnv({}, {
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1,.corp.local',
      MINERU_API_TOKEN: 'token',
    });

    expect(env.NO_PROXY).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
    expect(env.no_proxy).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
    expect(env.MINERU_API_TOKEN).toBe('token');
  });

  it('mirrors a lowercase-only per-server no_proxy override to uppercase', () => {
    const env = buildMcpSubprocessEnv({}, {
      no_proxy: '.corp.local',
    });

    expect(env.NO_PROXY).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
    expect(env.no_proxy).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
  });

  it('treats empty per-server NO_PROXY values as absent to keep localhost protection', () => {
    const env = buildMcpSubprocessEnv({}, {
      NO_PROXY: '',
      no_proxy: '   ',
    });

    expect(env.NO_PROXY).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
    expect(env.no_proxy).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
  });
});

describe('applyNpmEnv', () => {
  it('sets prefer-offline and silences npm post-install network calls', () => {
    const env: Record<string, string> = {};
    applyNpmEnv(env, {}, undefined);

    // npx revalidates the packument on every run even with a warm cache;
    // prefer-offline is what lets the cache answer instead.
    expect(env.NPM_CONFIG_PREFER_OFFLINE).toBe('true');
    expect(env.NPM_CONFIG_AUDIT).toBe('false');
    expect(env.NPM_CONFIG_FUND).toBe('false');
    expect(env.NPM_CONFIG_UPDATE_NOTIFIER).toBe('false');
  });

  it('does not force a registry — npm default resolution stays untouched', () => {
    const env: Record<string, string> = {};
    applyNpmEnv(env, {}, undefined);

    // No hardcoded mirror: private/corporate registries keep working.
    expect(env.NPM_CONFIG_REGISTRY).toBeUndefined();
  });

  it('honours an explicit HAMUNA_NPM_REGISTRY opt-in', () => {
    const env: Record<string, string> = {};
    applyNpmEnv(env, { HAMUNA_NPM_REGISTRY: 'https://registry.npmmirror.com' }, undefined);

    expect(env.NPM_CONFIG_REGISTRY).toBe('https://registry.npmmirror.com');
  });

  it('lets a per-server registry override the app-level one', () => {
    const env: Record<string, string> = {};
    applyNpmEnv(
      env,
      { HAMUNA_NPM_REGISTRY: 'https://registry.npmmirror.com' },
      { NPM_CONFIG_REGISTRY: 'https://npm.internal.corp' },
    );

    expect(env.NPM_CONFIG_REGISTRY).toBe('https://npm.internal.corp');
  });

  it('never overrides a value the server env already set', () => {
    const env: Record<string, string> = { NPM_CONFIG_PREFER_OFFLINE: 'false' };
    applyNpmEnv(env, {}, undefined);

    // A user pinning strict offline behaviour for one MCP keeps it.
    expect(env.NPM_CONFIG_PREFER_OFFLINE).toBe('false');
  });
});
