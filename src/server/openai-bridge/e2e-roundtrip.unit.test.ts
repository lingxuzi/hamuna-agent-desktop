/**
 * End-to-end round-trip test for OpenAI Responses API bridge path.
 *
 * Drives the REAL handler.ts code path:
 *   Anthropic SDK request  →  createBridgeHandler(handler).handle(Request)
 *   →  translateRequestToResponses  →  global.fetch (stubbed to capture wire
 *   shape)  →  translateResponsesResponse + handleResponsesStreamResponse
 *   →  Anthropic SDK events back to client
 *
 * Purpose: prove that after fixes #2/#3/#4 the round trip delivers:
 *   1. wire shape contract to upstream: every input message carries
 *      `type:'message'`, no `output_text`, no `effort:max`
 *   2. Anthropic SDK can consume the SSE response: message_start,
 *      content_block_*, message_delta (with usage), message_stop
 *
 * Without #1 upstream 400s (`untagged enum ResponseInput` — column shifts
 * session-to-session); without #2 SDK hangs or reports 0 usage (#277).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as undici from 'undici';
import { createBridgeHandler } from './handler';
import type { BridgeConfig, UpstreamConfig } from './types/bridge';
import type { AnthropicRequest } from './types/anthropic';

const MODEL = 'agnes-2.5-flash';

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
  bodyJson: unknown;
}

let capturedRequests: CapturedRequest[] = [];
let upstreamResponses: Response[] = [];
let originalUndiciFetch: typeof undici.fetch | undefined;

function installFetchStub() {
  capturedRequests = [];
  upstreamResponses = [];
  // handler.ts does `import { fetch } from 'undici'` — we must patch that exact binding
  // (not globalThis.fetch). Reach into the undici module and replace its `fetch` export.
  originalUndiciFetch = (undici as unknown as { fetch: typeof undici.fetch }).fetch;
  const stub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const bodyText = init?.body ? String(init.body) : '';
    capturedRequests.push({
      url: u,
      init: init ?? {},
      bodyJson: bodyText ? JSON.parse(bodyText) : null,
    });
    const next = upstreamResponses.shift();
    if (!next) {
      return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return next;
  });
  (undici as unknown as { fetch: unknown }).fetch = stub;
  return () => {
    (undici as unknown as { fetch: unknown }).fetch = originalUndiciFetch;
  };
}

function makeUpstream(overrides: Partial<UpstreamConfig> = {}): UpstreamConfig {
  return {
    baseUrl: 'http://127.0.0.1:1/v1', // loopback so test no-egress guard is happy
    apiKey: 'sk-test',
    model: MODEL,
    upstreamFormat: 'responses',
    providerId: 'test-agnes',
    ...overrides,
  };
}

function makeConfig(upstream: UpstreamConfig): BridgeConfig {
  return {
    logger: null,
    getUpstreamConfig: async () => upstream,
  };
}

interface SseReadResult {
  events: Array<{ type: string; [k: string]: unknown }>;
  reachedDone: boolean;
}

async function readSse(body: ReadableStream<Uint8Array>, timeoutMs = 2000): Promise<SseReadResult> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  let reachedDone = false;
  try {
    while (true) {
      const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs));
      const res = await Promise.race([reader.read(), timer]);
      if (res === 'timeout') break;
      const { done, value } = res;
      if (done) { reachedDone = true; break; }
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const p of parts) {
        const dataLine = p.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          events.push(JSON.parse(dataLine.slice('data:'.length).trim()));
        } catch { /* skip */ }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return { events, reachedDone };
}

describe('bridge e2e round-trip — Anthropic SDK ↔ Responses API', () => {
  let restoreFetch: () => void;
  beforeEach(() => {
    capturedRequests = [];
    upstreamResponses = [];
    restoreFetch = installFetchStub();
  });
  afterEach(() => {
    restoreFetch();
  });

  it('round-trips a multi-turn tool-use request: every input item carries type:"message" discriminator', async () => {
    // Mock upstream returns a complete Responses stream with text + tool_call
    const enc = new TextEncoder();
    upstreamResponses.push(new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(
            sseFrame({ type: 'response.created', response: { id: 'r1', model: MODEL } }) +
            sseFrame({ type: 'response.in_progress', response: { status: 'in_progress' } }) +
            sseFrame({
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'message', role: 'assistant', status: 'in_progress', content: [] },
            }) +
            sseFrame({
              type: 'response.content_part.added',
              output_index: 0,
              content_index: 0,
              part: { type: 'output_text', text: '' },
            }) +
            sseFrame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Looking up…' }) +
            sseFrame({ type: 'response.output_text.done', output_index: 0, content_index: 0, text: 'Looking up…' }) +
            sseFrame({ type: 'response.content_part.done', output_index: 0, content_index: 0, part: { type: 'output_text', text: 'Looking up…' } }) +
            sseFrame({
              type: 'response.output_item.done',
              output_index: 0,
              item: { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Looking up…' }] },
            }) +
            sseFrame({
              type: 'response.output_item.added',
              output_index: 1,
              item: { type: 'function_call', id: 'fc_1', call_id: 'tu_1', name: 'lookup', arguments: '', status: 'in_progress' },
            }) +
            sseFrame({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"q":"AAPL"}' }) +
            sseFrame({ type: 'response.function_call_arguments.done', output_index: 1, arguments: '{"q":"AAPL"}' }) +
            sseFrame({
              type: 'response.output_item.done',
              output_index: 1,
              item: { type: 'function_call', id: 'fc_1', call_id: 'tu_1', name: 'lookup', arguments: '{"q":"AAPL"}', status: 'completed' },
            }) +
            sseFrame({
              type: 'response.completed',
              response: {
                id: 'r1',
                status: 'completed',
                model: MODEL,
                usage: { input_tokens: 500, output_tokens: 12, total_tokens: 512 },
              },
            }),
          ));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    // Real Anthropic SDK request — includes tool definitions + multi-turn history
    // + Claude reasoning effort = 'max' (would have been fix #3's bug if not omitted)
    const anthropicReq: AnthropicRequest = {
      model: MODEL,
      max_tokens: 1024,
      stream: true,
      system: 'You are a helpful assistant.',
      tools: [
        {
          name: 'lookup',
          description: 'Look up a stock quote',
          input_schema: {
            type: 'object',
            properties: { q: { type: 'string' } },
            required: ['q'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Find AAPL price' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { q: 'TSLA' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: '$300' },
            { type: 'text', text: 'Now AAPL' },
          ],
        },
      ],
    };

    const handler = createBridgeHandler(makeConfig(makeUpstream({
      reasoningEffort: 'max', // fix #3 — should be omitted by translator
    })));
    const req = new Request('https://bridge.local/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'sk-test' },
      body: JSON.stringify(anthropicReq),
    });
    const resp = await handler(req);
    expect(resp.status).toBe(200);

    // === Verify request wire shape contract ===
    expect(capturedRequests).toHaveLength(1);
    const sent = capturedRequests[0];
    const body = sent.bodyJson as {
      model: string;
      input: Array<Record<string, unknown>>;
      reasoning?: { effort: string };
      tools?: Array<Record<string, unknown>>;
    };

    // Fix #4 — every input message item carries type:'message' discriminator
    for (const item of body.input) {
      if ('role' in item) {
        expect(item.type, `input message missing type:'message' — would 400 strict proxy`).toBe('message');
      } else if ('type' in item) {
        // sibling variants must NOT be re-tagged
        expect(['function_call', 'function_call_output']).toContain(item.type);
      }
    }

    // Fix #2 — no output_text / refusal on the input side
    const inputJson = JSON.stringify(body.input);
    expect(inputJson).not.toContain('output_text');
    expect(inputJson).not.toContain('"refusal"');

    // Fix #3 — reasoning.effort = 'max' omitted (strict Responses API enum)
    expect('reasoning' in body).toBe(false);

    // URLs the bridge hits
    expect(sent.url).toContain('/v1/responses');

    // === Verify response consumed by Anthropic SDK ===
    const { events, reachedDone } = await readSse(resp.body!);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');

    // text block + tool_use block both surface
    const blockStarts = events.filter((e) => e.type === 'content_block_start') as unknown as Array<{ content_block: { type: string } }>;
    expect(blockStarts.some((b) => b.content_block.type === 'text')).toBe(true);
    expect(blockStarts.some((b) => b.content_block.type === 'tool_use')).toBe(true);

    // Usage non-zero
    const msgDelta = events.find((e) => e.type === 'message_delta') as unknown as { usage?: { input_tokens?: number; output_tokens?: number } };
    expect(msgDelta?.usage?.input_tokens).toBe(500);
    expect(msgDelta?.usage?.output_tokens).toBe(12);

    // Stream really closed
    expect(reachedDone).toBe(true);
  });
});