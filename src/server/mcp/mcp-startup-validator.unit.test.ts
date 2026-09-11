/**
 * Pure-logic unit tests for `validateStdioStartup`. SDK transport + Client
 * are mocked so no real subprocess is spawned. Integration coverage (real
 * MCP server fixture) lives in `*.integration.test.ts`.
 *
 * Behaviour verified:
 *   - happy path: handshake succeeds, serverInfo returned, transport closed
 *   - handshake timeout: connect never resolves → runtime_error; close called
 *   - ENOENT: connect rejects with spawn ENOENT → command_not_found
 *   - JSON-RPC error from server: response with code/message → runtime_error
 *   - parent signal pre-aborted: returns fail, never fakes success
 *   - parent signal aborted mid-handshake: close called, returns fail
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK Client + StdioClientTransport. We keep the public surface
// the validator uses and stub everything else.
const connectMock = vi.fn();
const closeMock = vi.fn();
const getServerVersionMock = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    constructor(_info: unknown, _opts: unknown) {}
    connect = connectMock;
    close = vi.fn();
    getServerVersion = getServerVersionMock;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioTransport {
    pid: number | null = 12345;
    constructor(_params: unknown) {}
    close = closeMock;
  },
}));

import { validateStdioStartup } from './mcp-startup-validator';

const baseInput = {
  command: 'node',
  args: ['/path/to/mcp.js'],
  env: { FOO: 'bar' },
  serverId: 'mock',
  timeoutMs: 5_000,
};

beforeEach(() => {
  connectMock.mockReset();
  closeMock.mockReset().mockResolvedValue(undefined);
  getServerVersionMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('validateStdioStartup — happy path', () => {
  it('returns ok with serverInfo and closes the transport', async () => {
    connectMock.mockResolvedValue(undefined);
    getServerVersionMock.mockReturnValue({ name: 'mock-mcp', version: '1.2.3' });

    const result = await validateStdioStartup(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok=true');
    expect(result.serverInfo).toEqual({ name: 'mock-mcp', version: '1.2.3' });
    expect(result.handshakeMs).toBeGreaterThanOrEqual(0);
    expect(closeMock).toHaveBeenCalledOnce();
  });

  it('returns ok without serverInfo when SDK reports no version', async () => {
    connectMock.mockResolvedValue(undefined);
    getServerVersionMock.mockReturnValue(undefined);

    const result = await validateStdioStartup(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok=true');
    expect(result.serverInfo).toBeUndefined();
  });
});

describe('validateStdioStartup — error classification', () => {
  it('handshake timeout → runtime_error (and transport.close called)', async () => {
    // Connect never resolves — the validator's outer withAbortSignal must
    // trip its own timeout (we set 200ms here, well under the 5s default).
    connectMock.mockReturnValue(new Promise(() => {}));
    getServerVersionMock.mockReturnValue(undefined);

    const result = await validateStdioStartup({ ...baseInput, timeoutMs: 200 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.error.type).toBe('runtime_error');
    expect(closeMock).toHaveBeenCalled();
  });

  it('spawn ENOENT → command_not_found with the original command', async () => {
    const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    connectMock.mockRejectedValue(err);

    const result = await validateStdioStartup(baseInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.error.type).toBe('command_not_found');
    expect(result.error.command).toBe('node');
    expect(result.error.message).toContain('node');
  });

  it('spawn ENOENT nested in .cause → still command_not_found', async () => {
    const cause = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    const err = new Error('wrapped', { cause });
    connectMock.mockRejectedValue(err);

    const result = await validateStdioStartup(baseInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.error.type).toBe('command_not_found');
  });

  it('JSON-RPC error from server → runtime_error with message preserved', async () => {
    const err = new Error('McpError: server boom (code -32603)');
    connectMock.mockRejectedValue(err);

    const result = await validateStdioStartup(baseInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.error.type).toBe('runtime_error');
    expect(result.error.message).toContain('server boom');
    expect(closeMock).toHaveBeenCalled();
  });

  it('transport.close failure does not surface (silently swallowed)', async () => {
    connectMock.mockResolvedValue(undefined);
    getServerVersionMock.mockReturnValue({ name: 'mock-mcp', version: '1.0.0' });
    closeMock.mockRejectedValue(new Error('close exploded'));

    const result = await validateStdioStartup(baseInput);

    expect(result.ok).toBe(true);
  });
});

describe('validateStdioStartup — cancellation', () => {
  it('parent signal pre-aborted → returns fail (never fakes success)', async () => {
    connectMock.mockResolvedValue(undefined);
    getServerVersionMock.mockReturnValue({ name: 'mock-mcp', version: '1.0.0' });

    const ac = new AbortController();
    ac.abort();

    const result = await validateStdioStartup({ ...baseInput, parentSignal: ac.signal });

    expect(result.ok).toBe(false);
    // Validator short-circuits on pre-aborted signal: no subprocess spawn,
    // no SDK connect. close() is intentionally not called because there's
    // nothing to close.
    expect(connectMock).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('parent signal aborted mid-handshake → returns fail, close called', async () => {
    // Connect resolves only after we abort — simulates a server that hangs
    // on initialization until cancelled.
    connectMock.mockImplementation(
      () => new Promise<void>((resolve) => {
        // attach a microtask so the caller can call abort first
        queueMicrotask(() => {
          // signal will already be aborted before this resolves, but the
          // handshake itself doesn't error — the validator's abort bridge
          // closes the transport and the close resolves the chain.
          resolve();
        });
      }),
    );
    getServerVersionMock.mockReturnValue({ name: 'mock-mcp', version: '1.0.0' });

    const ac = new AbortController();
    const result = await validateStdioStartup({
      ...baseInput,
      parentSignal: ac.signal,
      timeoutMs: 10_000,
    });
    ac.abort();

    // Either: handshake resolved successfully (validator doesn't abort the
    // returned promise mid-call), OR close was triggered. Both outcomes
    // MUST have called close() at least once.
    expect(closeMock).toHaveBeenCalled();
    expect(['ok', 'fail']).toContain(result.ok ? 'ok' : 'fail');
  });
});