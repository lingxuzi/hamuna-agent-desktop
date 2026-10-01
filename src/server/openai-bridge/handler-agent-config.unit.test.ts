import { describe, expect, it } from 'vitest';
import { createBridgeHandler } from './handler';

/**
 * Default-Agent config sanity test (#195).
 *
 * Background: bridge connect_ms was 5-76s in production (vs 0.6s curl baseline)
 * because undici's default keepAliveTimeout=5s drops idle sockets between
 * user turns. The fix lives in handler.ts createBridgeHandler — `new Agent({
 * connectTimeout, headersTimeout, keepAliveTimeout, keepAliveMaxTimeout })`.
 * If anyone reverts/breaks those numeric literals, the regression surfaces
 * as 20-40s connect_ms on every chat tab idle > 5s. We pin the live config
 * values here so the regression gets caught before it ships.
 */
describe('OpenAI bridge default-Agent config (#195)', () => {
  it('emits build_proof marker naming the active keepAlive/connect caps', () => {
    const logs: string[] = [];
    createBridgeHandler({
      getUpstreamConfig: async () => {
        throw new Error('not used in this test');
      },
      logger: (msg) => { logs.push(msg); },
    });
    // The handler constructor logs exactly one build_proof line. Match the
    // marker prefix + the new v2 contract: keepAlive30s is the regression
    // guard — anyone dropping keepAliveTimeout back to undici 5s default
    // changes this marker and breaks this test.
    const marker = logs.find(l => l.includes('build_proof ttft_diag_v2'));
    expect(marker, 'expected ttft_diag_v2 build_proof marker').toBeDefined();
    expect(marker).toContain('defaultAgent=8s_connect keepAlive30s');
  });
});
