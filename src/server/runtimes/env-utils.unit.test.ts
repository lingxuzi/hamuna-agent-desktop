/**
 * `augmentedProcessEnv` is the single env builder every runtime subprocess
 * goes through (Claude CLI, Codex app-server, `claude --version` probes), so
 * anything asserted here is asserted for the whole runtime fleet.
 *
 * The case that matters today: Claude Code's own MCP connect deadline is short
 * enough to kill a stdio server that is still installing its package on first
 * spawn (`uvx <pkg>` / `uv tool run --from <pkg>`), leaving the tool
 * permanently unopenable. We raise it via MCP_CONNECT_TIMEOUT_MS.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getShellEnv: vi.fn((): Record<string, string> => ({ PATH: '/usr/bin' })),
  getShellPath: vi.fn(() => '/usr/bin'),
  getDetectedTerminalProxyEnv: vi.fn((): Record<string, string> | null => null),
}));

vi.mock('../utils/shell', () => ({
  getShellEnv: mocks.getShellEnv,
  getShellPath: mocks.getShellPath,
  getDetectedTerminalProxyEnv: mocks.getDetectedTerminalProxyEnv,
}));

import { augmentedProcessEnv } from './env-utils';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getShellEnv.mockReturnValue({ PATH: '/usr/bin' });
  mocks.getDetectedTerminalProxyEnv.mockReturnValue(null);
});

describe('augmentedProcessEnv — MCP connect budget', () => {
  it('gives the Claude CLI room to finish a cold install before giving up', () => {
    const env = augmentedProcessEnv();

    expect(env.MCP_CONNECT_TIMEOUT_MS).toBe('60000');
  });

  it('does not clobber a value the environment already set', () => {
    mocks.getShellEnv.mockReturnValue({
      PATH: '/usr/bin',
      MCP_CONNECT_TIMEOUT_MS: '90000',
    });

    const env = augmentedProcessEnv();

    // Operator / build-time override wins over our default.
    expect(env.MCP_CONNECT_TIMEOUT_MS).toBe('90000');
  });

  it('applies under the terminal proxy policy too', () => {
    // 'terminal' strips proxy vars and re-derives them; the MCP budget is
    // unrelated to proxy handling and must survive that path.
    const env = augmentedProcessEnv({ proxy: 'terminal' });

    expect(env.MCP_CONNECT_TIMEOUT_MS).toBe('60000');
  });
});
