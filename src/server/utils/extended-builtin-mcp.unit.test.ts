import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseExtendedBuiltinMcpConfig } from './extended-builtin-mcp';
import { MAX_SERVERS, MAX_ENV_BYTES_PER_SERVER } from './extended-builtin-mcp';
import { getBundledResourcePath } from './runtime';

// Hoist a vi.fn wrapper around the real getBundledResourcePath so the
// ${bundled:REL_PATH} placeholder tests can override behavior per case.
// By default the wrapper delegates to the real function (which returns
// null in the vitest env because no Tauri resources are bundled); tests
// without the placeholder are unaffected.
vi.mock('./runtime', async () => {
  const actual = await vi.importActual<typeof import('./runtime')>('./runtime');
  return {
    ...actual,
    getBundledResourcePath: vi.fn(actual.getBundledResourcePath),
  };
});

describe('parseExtendedBuiltinMcpConfig', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('returns empty array for valid JSON with empty servers', () => {
    const result = parseExtendedBuiltinMcpConfig(JSON.stringify({ version: 1, servers: [] }));
    expect(result).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('parses a stdio server entry with all fields', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'playwright',
            name: 'PW',
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@playwright/mcp'],
            env: { FOO: 'bar' },
            description: 'browser automation',
            enabled: true,
          },
        ],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'playwright',
      name: 'PW',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
      env: { FOO: 'bar' },
      description: 'browser automation',
      isBuiltin: true,
    });
  });

  it('defaults type to stdio when missing', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [{ id: 'x', command: 'echo' }],
      }),
    );
    expect(result[0].type).toBe('stdio');
  });

  it('defaults name to id when missing', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [{ id: 'my-tool', command: 'echo' }],
      }),
    );
    expect(result[0].name).toBe('my-tool');
  });

  it('skips entry with enabled:false', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          { id: 'on', command: 'echo' },
          { id: 'off', command: 'echo', enabled: false },
        ],
      }),
    );
    expect(result.map((s) => s.id)).toEqual(['on']);
  });

  it('rejects stdio entry without command', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({ version: 1, servers: [{ id: 'bad', type: 'stdio' }] }),
    );
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'bad' skipped: stdio requires command"));
  });

  it('rejects sse entry without url', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({ version: 1, servers: [{ id: 'bad', type: 'sse' }] }),
    );
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'bad' skipped: sse requires url"));
  });

  it('accepts http entry with url and headers', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [{ id: 'remote', type: 'http', url: 'https://example.com/mcp', headers: { Auth: 'token' } }],
      }),
    );
    expect(result[0]).toMatchObject({
      id: 'remote',
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Auth: 'token' },
    });
  });

  it('skips duplicate ids', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          { id: 'dup', command: 'echo' },
          { id: 'dup', command: 'echo2' },
        ],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('echo');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("duplicate id 'dup'"));
  });

  it('skips entry with missing id', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({ version: 1, servers: [{ command: 'echo' }] }),
    );
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing id'));
  });

  it('skips entry that is not an object', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({ version: 1, servers: ['not-an-object', 42, null] }),
    );
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not an object'));
  });

  it('rejects unsupported version', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({ version: 999, servers: [{ id: 'x', command: 'echo' }] }),
    );
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported version 999'));
  });

  it('rejects malformed JSON', () => {
    const result = parseExtendedBuiltinMcpConfig('{ not valid json');
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
  });

  it('rejects non-object root', () => {
    expect(parseExtendedBuiltinMcpConfig('[]')).toEqual([]);
    expect(parseExtendedBuiltinMcpConfig('"hi"')).toEqual([]);
    expect(parseExtendedBuiltinMcpConfig('null')).toEqual([]);
  });

  it('rejects when servers field is not an array', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({ version: 1, servers: 'not-an-array' }),
    );
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'servers' must be an array"));
  });

  it('truncates server list beyond MAX_SERVERS', async () => {
    const servers = Array.from({ length: MAX_SERVERS + 5 }, (_, i) => ({
      id: `s${i}`,
      command: 'echo',
    }));
    const result = parseExtendedBuiltinMcpConfig(JSON.stringify({ version: 1, servers }));
    expect(result).toHaveLength(MAX_SERVERS);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncating'));
  });

  it('expands ${env:NAME} placeholders to process.env values', () => {
    vi.stubEnv('MY_TOKEN', 'secret-123');
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [{ id: 'x', command: 'echo', env: { TOKEN: '${env:MY_TOKEN}' } }],
      }),
    );
    expect(result[0].env).toEqual({ TOKEN: 'secret-123' });
  });

  it('leaves literal text when env placeholder is unset', () => {
    vi.stubEnv('MISSING_VAR', '');
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [{ id: 'x', command: 'echo', env: { TOKEN: '${env:MISSING_VAR}' } }],
      }),
    );
    expect(result[0].env).toEqual({ TOKEN: '' });
  });

  it('rejects env block exceeding MAX_ENV_BYTES_PER_SERVER', async () => {
    const hugeValue = 'x'.repeat(MAX_ENV_BYTES_PER_SERVER + 1);
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [{ id: 'huge', command: 'echo', env: { KEY: hugeValue } }],
      }),
    );
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('env block too large'));
  });

  it('filters non-string args entries', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [{ id: 'x', command: 'echo', args: ['ok', 42, true, 'also-ok'] }],
      }),
    );
    expect(result[0].args).toEqual(['ok', 'also-ok']);
  });
});

describe('parseExtendedBuiltinMcpConfig — hidesDefaultArgs', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('parses hidesDefaultArgs: true and exposes it on the server', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'multimedia-creator',
            type: 'stdio',
            command: 'uvx',
            args: ['--from', 'pkg', 'cmd'],
            hidesDefaultArgs: true,
          },
        ],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].hidesDefaultArgs).toBe(true);
  });

  it('defaults hidesDefaultArgs to false when the field is absent', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [{ id: 'plain', command: 'echo' }],
      }),
    );
    expect(result[0].hidesDefaultArgs).toBe(false);
  });

  it('coerces non-boolean truthy values to false (poisoned-bundle guard)', () => {
    // Anything that isn't strictly `true` falls through to false. This is
    // a display-time filter; we never want a stray "1" or "yes" string to
    // silently turn on a hide that the UI then has to special-case.
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          { id: 'a', command: 'echo', hidesDefaultArgs: 1 },
          { id: 'b', command: 'echo', hidesDefaultArgs: 'true' },
          { id: 'c', command: 'echo', hidesDefaultArgs: 'yes' },
          { id: 'd', command: 'echo', hidesDefaultArgs: {} },
          { id: 'e', command: 'echo', hidesDefaultArgs: null },
        ],
      }),
    );
    for (const s of result) {
      expect(s.hidesDefaultArgs).toBe(false);
    }
  });

  it('preserves hidesDefaultArgs for http/sse entries (not stdio-only)', () => {
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'remote',
            type: 'http',
            url: 'https://example.com/mcp',
            hidesDefaultArgs: true,
          },
        ],
      }),
    );
    expect(result[0].hidesDefaultArgs).toBe(true);
  });
});

describe('parseExtendedBuiltinMcpConfig — ${bundled:REL_PATH} placeholder', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.mocked(getBundledResourcePath).mockReset();
  });

  it('resolves ${bundled:REL_PATH} in args to absolute path via getBundledResourcePath', () => {
    vi.mocked(getBundledResourcePath).mockImplementation(
      (rel: string) => `/abs/install/resources/${rel}`,
    );
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'agnes',
            type: 'stdio',
            command: 'uvx',
            args: ['--from', '${bundled:hosted_mcps/agnes-video-25}', 'agnes-video-25-mcp'],
          },
        ],
      }),
    );
    expect(result[0].args).toEqual([
      '--from',
      '/abs/install/resources/hosted_mcps/agnes-video-25',
      'agnes-video-25-mcp',
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('leaves literal placeholder and warns when getBundledResourcePath returns null', () => {
    vi.mocked(getBundledResourcePath).mockReturnValue(null);
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'agnes',
            type: 'stdio',
            command: 'uvx',
            args: ['--from', '${bundled:hosted_mcps/missing}', 'tool'],
          },
        ],
      }),
    );
    expect(result[0].args).toEqual(['--from', '${bundled:hosted_mcps/missing}', 'tool']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('${bundled:hosted_mcps/missing} not found'),
    );
  });

  it('resolves multiple placeholders within a single arg string', () => {
    vi.mocked(getBundledResourcePath).mockImplementation(
      (rel: string) => `/abs/install/resources/${rel}`,
    );
    const result = parseExtendedBuiltinMcpConfig(
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'multi',
            type: 'stdio',
            command: 'cp',
            args: ['${bundled:a}/${bundled:b}'],
          },
        ],
      }),
    );
    expect(result[0].args).toEqual(['/abs/install/resources/a//abs/install/resources/b']);
  });
});