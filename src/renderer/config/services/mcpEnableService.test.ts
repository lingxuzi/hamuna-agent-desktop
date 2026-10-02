import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpServerDefinition } from '../types';

const mocks = vi.hoisted(() => ({
  apiPostJson: vi.fn(),
  getMcpServerEnv: vi.fn(),
  getMcpServerArgs: vi.fn(),
  saveMcpServerArgs: vi.fn(),
  homeDir: vi.fn(),
  join: vi.fn(),
}));

vi.mock('@/api/apiFetch', () => ({ apiPostJson: mocks.apiPostJson }));
vi.mock('./mcpService', () => ({
  getMcpServerEnv: mocks.getMcpServerEnv,
  getMcpServerArgs: mocks.getMcpServerArgs,
  saveMcpServerArgs: mocks.saveMcpServerArgs,
}));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: mocks.homeDir,
  join: mocks.join,
}));

import { enableMcpServer, findMissingMcpConfigKeys } from './mcpEnableService';

function server(overrides: Partial<McpServerDefinition> = {}): McpServerDefinition {
  return {
    id: 'probe',
    name: 'Probe',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'probe-mcp'],
    ...overrides,
  } as McpServerDefinition;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMcpServerEnv.mockResolvedValue({});
  mocks.getMcpServerArgs.mockResolvedValue([]);
  mocks.homeDir.mockResolvedValue('/home/tester');
  mocks.join.mockImplementation((...parts: string[]) => parts.join('/'));
});

describe('findMissingMcpConfigKeys', () => {
  it('returns [] for a server that requires no config', async () => {
    await expect(findMissingMcpConfigKeys(server())).resolves.toEqual([]);
  });

  it('lists required keys that have no saved value', async () => {
    mocks.getMcpServerEnv.mockResolvedValue({ TOKEN: 'abc' });

    await expect(
      findMissingMcpConfigKeys(server({ requiresConfig: ['TOKEN', 'BASE_URL'] })),
    ).resolves.toEqual(['BASE_URL']);
  });

  it('treats whitespace-only values as missing', async () => {
    // A env var set to " " is indistinguishable from unset once it reaches the
    // spawned process, so it must not count as configured.
    mocks.getMcpServerEnv.mockResolvedValue({ TOKEN: '   ' });

    await expect(
      findMissingMcpConfigKeys(server({ requiresConfig: ['TOKEN'] })),
    ).resolves.toEqual(['TOKEN']);
  });
});

describe('enableMcpServer', () => {
  it('short-circuits before the handshake when required config is missing', async () => {
    mocks.getMcpServerEnv.mockResolvedValue({});

    const result = await enableMcpServer(server({ requiresConfig: ['API_KEY'] }));

    expect(result).toEqual({ ok: false, kind: 'missing-config', missingKeys: ['API_KEY'] });
    // The whole point: a server that cannot work must not cost a cold npx spawn.
    expect(mocks.apiPostJson).not.toHaveBeenCalled();
  });

  it('runs the handshake and reports success', async () => {
    mocks.apiPostJson.mockResolvedValue({ success: true });

    const result = await enableMcpServer(server());

    expect(result).toEqual({ ok: true, playwrightArgsInitialized: false });
    expect(mocks.apiPostJson).toHaveBeenCalledWith('/api/mcp/enable', { server: server() });
  });

  it('classifies a missing runtime separately so Settings can offer a download', async () => {
    mocks.apiPostJson.mockResolvedValue({
      success: false,
      error: {
        type: 'command_not_found',
        message: 'uvx not found',
        command: 'uvx',
        runtimeName: 'uv',
        downloadUrl: 'https://example.com/uv',
      },
    });

    const result = await enableMcpServer(server());

    expect(result).toEqual({
      ok: false,
      kind: 'runtime-missing',
      runtimeName: 'uv',
      downloadUrl: 'https://example.com/uv',
      command: 'uvx',
    });
  });

  it('keeps command_not_found without a downloadUrl out of the download branch', async () => {
    // Settings only opens the dialog when there is a URL to offer; a bare
    // command_not_found must fall through to the generic failure toast.
    mocks.apiPostJson.mockResolvedValue({
      success: false,
      error: { type: 'command_not_found', message: 'not found', command: 'uvx' },
    });

    const result = await enableMcpServer(server());

    expect(result).toEqual({ ok: false, kind: 'runtime-missing', command: 'uvx' });
  });

  it('surfaces the server message for other error types', async () => {
    mocks.apiPostJson.mockResolvedValue({
      success: false,
      error: { type: 'runtime_error', message: 'handshake timed out' },
    });

    const result = await enableMcpServer(server());

    expect(result).toEqual({ ok: false, kind: 'failed', message: 'handshake timed out' });
  });

  it('turns a thrown request into a failed outcome rather than propagating', async () => {
    mocks.apiPostJson.mockRejectedValue(new Error('network down'));

    const result = await enableMcpServer(server());

    // Callers stay free of try/catch — every failure is a discriminated variant.
    expect(result).toEqual({ ok: false, kind: 'failed', message: 'network down' });
  });

  it('seeds Playwright default args on first enable and reports it', async () => {
    mocks.apiPostJson.mockResolvedValue({ success: true });
    mocks.getMcpServerArgs.mockResolvedValue(undefined); // never configured

    const result = await enableMcpServer(server({ id: 'playwright', name: 'Playwright' }));

    expect(result).toEqual({ ok: true, playwrightArgsInitialized: true });
    expect(mocks.saveMcpServerArgs).toHaveBeenCalledWith('playwright', [
      '--user-data-dir=/home/tester/.playwright-mcp-profile',
    ]);
  });

  it('leaves Playwright args the user already set alone', async () => {
    mocks.apiPostJson.mockResolvedValue({ success: true });
    // [] means "user deliberately cleared these", which is NOT the same as unset.
    mocks.getMcpServerArgs.mockResolvedValue([]);

    const result = await enableMcpServer(server({ id: 'playwright' }));

    expect(result).toEqual({ ok: true, playwrightArgsInitialized: false });
    expect(mocks.saveMcpServerArgs).not.toHaveBeenCalled();
  });

  it('still enables Playwright when seeding its default args fails', async () => {
    mocks.apiPostJson.mockResolvedValue({ success: true });
    mocks.getMcpServerArgs.mockResolvedValue(undefined);
    mocks.saveMcpServerArgs.mockRejectedValue(new Error('disk full'));

    const result = await enableMcpServer(server({ id: 'playwright' }));

    // The handshake already passed; a cosmetic default must not undo the enable.
    expect(result).toEqual({ ok: true, playwrightArgsInitialized: false });
  });
});
