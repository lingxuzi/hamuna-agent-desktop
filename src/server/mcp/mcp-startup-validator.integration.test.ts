/**
 * Integration tests for `validateStdioStartup` against the real
 * `delayed-mcp-server.mjs` fixture — exercises the full spawn →
 * initialize handshake → close lifecycle.
 *
 * Why this lives in `integration` (not `unit`): spawns a real Node
 * subprocess with a real `@modelcontextprotocol/sdk` server. The
 * validator's transport.start() opens an actual stdio pipe and the
 * MCP `initialize` JSON-RPC handshake goes through. No real network.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateStdioStartup } from './mcp-startup-validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, '../__tests__/fixtures/delayed-mcp-server.mjs');

describe('validateStdioStartup — integration', () => {
  it('fast happy path: handshake succeeds and reports fixture serverInfo', async () => {
    const result = await validateStdioStartup({
      command: process.execPath,
      args: [fixturePath],
      env: { HAMUNA_TEST_MCP_DELAY_MS: '0' },
      serverId: 'fast-happy',
      timeoutMs: 10_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected ok=true, got error: ${JSON.stringify(result.error)}`);
    expect(result.serverInfo?.name).toBe('hamuna-delayed-readiness-fixture');
    expect(result.serverInfo?.version).toBe('1.0.0');
    expect(result.handshakeMs).toBeGreaterThan(0);
  });

  it('handshake timeout: slow fixture trips the 2s cap → runtime_error', async () => {
    const result = await validateStdioStartup({
      command: process.execPath,
      args: [fixturePath],
      env: { HAMUNA_TEST_MCP_DELAY_MS: '20000' },
      serverId: 'slow-timeout',
      timeoutMs: 2_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.error.type).toBe('runtime_error');
    expect(result.handshakeMs).toBeGreaterThanOrEqual(1_900);
    // handshakeMs should NOT exceed the timeout by much — validator closes
    // transport on timeout and stops counting.
    expect(result.handshakeMs).toBeLessThan(5_000);
  });

  it('missing binary: non-existent command → command_not_found', async () => {
    const result = await validateStdioStartup({
      command: 'definitely-not-a-real-binary-xyz-12345',
      args: [],
      env: {},
      serverId: 'missing-binary',
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.error.type).toBe('command_not_found');
    expect(result.error.message).toContain('definitely-not-a-real-binary-xyz-12345');
  });
});
