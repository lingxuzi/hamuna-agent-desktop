/**
 * End-to-end streaming smoke test: mock an OpenAI Responses API upstream SSE
 * stream, drive the REAL bridge handler, and assert the full Anthropic-SDK
 * event sequence the renderer would consume.
 *
 * Purpose: prove that after fixes #2/#3/#4 (output_text → input_text,
 * reasoning.effort vocabulary, EasyInputMessage type:'message') the response
 * side still emits well-formed Anthropic events with non-zero usage and a
 * terminal `message_stop`. Without this, fix #4 could silently regress the
 * streaming parser (different code path from request translate).
 *
 * Pattern mirrors usage-streaming.unit.test.ts (#277) — same `sseFrame` and
 * `readAnthropicEvents` helpers, plus `accumulateUsage` so we verify both
 * the bridge's wire format and the SDK's expected accumulation.
 */
import { describe, it, expect } from 'vitest';
import { handleResponsesStreamResponse } from '../handler';
import type { AnthropicStreamEvent, AnthropicUsage } from '../types/anthropic';

const MODEL = 'agnes-2.5-flash';

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function readAnthropicEvents(
  body: ReadableStream<Uint8Array>,
  perReadTimeoutMs = 2000,
): Promise<StreamReadResult> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: AnthropicStreamEvent[] = [];
  let reachedDone = false;
  try {
    for (;;) {
      const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), perReadTimeoutMs));
      const res = await Promise.race([reader.read(), timer]);
      if (res === 'timeout') break;
      const { done, value } = res;
      if (done) { reachedDone = true; break; }
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          events.push(JSON.parse(dataLine.slice('data:'.length).trim()) as AnthropicStreamEvent);
        } catch { /* skip */ }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return { events, reachedDone };
}

interface StreamReadResult {
  events: AnthropicStreamEvent[];
  reachedDone: boolean;
}

/** Mirror @anthropic-ai/sdk MessageStream.accumulateMessage's usage logic. */
function accumulateUsage(events: AnthropicStreamEvent[]): AnthropicUsage {
  let usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 };
  for (const ev of events) {
    if (ev.type === 'message_start') {
      usage = { ...ev.message.usage };
    } else if (ev.type === 'message_delta') {
      usage.output_tokens = ev.usage.output_tokens;
      if (ev.usage.input_tokens != null) usage.input_tokens = ev.usage.input_tokens;
      if (ev.usage.cache_read_input_tokens != null) usage.cache_read_input_tokens = ev.usage.cache_read_input_tokens;
    }
  }
  return usage;
}

describe('streaming smoke — Responses upstream → Anthropic SDK events', () => {
  it('text-only turn: emits full Anthropic event sequence with non-zero usage', async () => {
    const enc = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(
          sseFrame({
            type: 'response.created',
            response: { id: 'resp_1', object: 'response', model: MODEL, status: 'in_progress' },
          }) +
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
          sseFrame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Hello' }) +
          sseFrame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: ', world' }) +
          sseFrame({
            type: 'response.output_text.done',
            output_index: 0,
            content_index: 0,
            text: 'Hello, world',
          }) +
          sseFrame({
            type: 'response.content_part.done',
            output_index: 0,
            content_index: 0,
            part: { type: 'output_text', text: 'Hello, world' },
          }) +
          sseFrame({
            type: 'response.output_item.done',
            output_index: 0,
            item: { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hello, world' }] },
          }) +
          sseFrame({
            type: 'response.completed',
            response: {
              id: 'resp_1',
              object: 'response',
              status: 'completed',
              model: MODEL,
              usage: {
                input_tokens: 1234,
                output_tokens: 4,
                total_tokens: 1238,
                input_tokens_details: { cached_tokens: 128 },
              },
            },
          }),
        ));
        c.close();
      },
    });

    const out = handleResponsesStreamResponse(
      new Response(upstreamBody, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      MODEL,
      () => {},
      new AbortController(),
      undefined,
      () => {},
    );

    const { events, reachedDone } = await readAnthropicEvents(out.body!);
    // console.log('events =', JSON.stringify(events, null, 2));

    // Required lifecycle: start → content_block_start → deltas → block_stop → delta(usage) → stop
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types[types.length - 1]).toBe('message_stop');

    // Deltas concatenate to the upstream text
    const textDeltas: string[] = [];
    for (const e of events) {
      if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
        textDeltas.push(e.delta.text);
      }
    }
    expect(textDeltas.join('')).toBe('Hello, world');

    // stop_reason survives the round trip
    const msgDelta = events.find((e) => e.type === 'message_delta');
    expect(msgDelta && msgDelta.type === 'message_delta' && msgDelta.delta.stop_reason).toBeTruthy();

    // Usage is non-zero and matches the upstream payload (#277 regression guard)
    const usage = accumulateUsage(events);
    expect(usage.input_tokens).toBe(1234);
    expect(usage.output_tokens).toBe(4);
    expect(usage.cache_read_input_tokens).toBe(128);

    // Stream actually closed (no hanging body — would hang the SDK forever)
    expect(reachedDone).toBe(true);
  });

  it('tool-use turn: Responses function_call becomes Anthropic tool_use', async () => {
    const enc = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(
          sseFrame({ type: 'response.created', response: { id: 'resp_2', model: MODEL } }) +
          sseFrame({
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'function_call', id: 'fc_1', call_id: 'call_x1', name: 'lookup', arguments: '', status: 'in_progress' },
          }) +
          sseFrame({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"q"' }) +
          sseFrame({ type: 'response.function_call_arguments.delta', output_index: 0, delta: ':"AAPL"}' }) +
          sseFrame({
            type: 'response.function_call_arguments.done',
            output_index: 0,
            arguments: '{"q":"AAPL"}',
          }) +
          sseFrame({
            type: 'response.output_item.done',
            output_index: 0,
            item: { type: 'function_call', id: 'fc_1', call_id: 'call_x1', name: 'lookup', arguments: '{"q":"AAPL"}', status: 'completed' },
          }) +
          sseFrame({
            type: 'response.completed',
            response: {
              id: 'resp_2',
              status: 'completed',
              model: MODEL,
              usage: { input_tokens: 50, output_tokens: 12, total_tokens: 62 },
            },
          }),
        ));
        c.close();
      },
    });

    const out = handleResponsesStreamResponse(
      new Response(upstreamBody, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      MODEL,
      () => {},
      new AbortController(),
      undefined,
      () => {},
    );

    const { events, reachedDone } = await readAnthropicEvents(out.body!);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types[types.length - 1]).toBe('message_stop');

    // The content_block_start must advertise a tool_use block
    const blockStart = events.find(
      (e): e is Extract<AnthropicStreamEvent, { type: 'content_block_start' }> => e.type === 'content_block_start',
    );
    expect(blockStart && blockStart.content_block.type).toBe('tool_use');

    // Argument deltas concatenate to the full JSON
    const inputDeltas: string[] = [];
    for (const e of events) {
      if (e.type === 'content_block_delta' && e.delta.type === 'input_json_delta') {
        inputDeltas.push(e.delta.partial_json);
      }
    }
    expect(inputDeltas.join('')).toBe('{"q":"AAPL"}');

    // stop_reason reflects tool_use
    const msgDelta = events.find((e) => e.type === 'message_delta');
    expect(msgDelta && msgDelta.type === 'message_delta' && msgDelta.delta.stop_reason).toBe('tool_use');

    const usage = accumulateUsage(events);
    expect(usage.input_tokens).toBe(50);
    expect(usage.output_tokens).toBe(12);

    expect(reachedDone).toBe(true);
  });
});