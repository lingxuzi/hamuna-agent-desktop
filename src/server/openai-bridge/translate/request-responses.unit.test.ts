/**
 * Regression tests for Responses API wire-shape bugs surfaced against
 * agnes-2.5-flash (Rust serde strict proxy):
 *
 *   - Bug A (unified-2026-09-01.log:8732-8747): assistant text replay pushed
 *     `{type:'output_text'}` on the input side; Responses API rejects with
 *     `400 "data did not match any variant of untagged enum ResponseInput"`.
 *
 *   - Bug B (unified-2026-09-01.log:11407): every `EasyInputMessage` was
 *     emitted without the `type:'message'` discriminator, so the same proxy
 *     could not dispatch `EasyInputMessage` from sibling variants
 *     (`FunctionCallOutput`, etc.) and rejected the whole input.
 *
 *   - Bug C (unified-2026-09-01.log:10493): `reasoning.effort: max` (Claude
 *     vocabulary) was forwarded as-is; Responses API's documented strict
 *     4-value effort enum (`minimal/low/medium/high`) rejects `max` with
 *     `400 effort: unknown variant`.
 *
 *   - Bug D (unified-2026-09-01.log:14109, column 30555): each function tool
 *     in the `tools` array was emitted without `strict`, but OpenAI's
 *     FunctionToolParam schema marks `strict: Required[Optional[bool]]` —
 *     strict proxies refuse to dispatch the FunctionToolParam variant when
 *     this field is absent. Column 30555 falls inside the tools array (not
 *     input) — same outer error string, but the failing deserializer is
 *     `untagged enum ToolParam`.
 *
 * Each test asserts the wire shape directly, not the internal accumulator.
 */
import { describe, it, expect } from 'vitest';

import { translateRequestToResponses, stripSchemaDescriptions } from './request-responses';
import type { AnthropicRequest, AnthropicMessage } from '../types/anthropic';
import type { ResponsesInputItem, ResponsesInputMessage } from '../types/openai-responses';

const baseReq: AnthropicRequest = {
  model: 'agnes-2.5-flash',
  messages: [],
  max_tokens: 1024,
};

function asInputMessages(items: ResponsesInputItem[]): ResponsesInputMessage[] {
  return items.filter((it): it is ResponsesInputMessage => 'role' in it);
}

describe('translateRequestToResponses — assistant text replay', () => {
  it('emits assistant text as input_text, never output_text (Bug A)', () => {
    const req: AnthropicRequest = {
      ...baseReq,
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello there.' }],
        },
      ],
    };
    const out = translateRequestToResponses(req, {});
    const assistantMessages = asInputMessages(out.input).filter((m) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    const content = assistantMessages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as Array<{ type: string }>)[0].type).toBe('input_text');
    for (const item of out.input) {
      const c = (item as ResponsesInputMessage).content;
      if (Array.isArray(c)) {
        for (const part of c) {
          expect((part as { type: string }).type).not.toBe('output_text');
          expect((part as { type: string }).type).not.toBe('refusal');
        }
      }
    }
  });

  it('splits mixed assistant text + tool_use into one assistant message + separate function_call', () => {
    const req: AnthropicRequest = {
      ...baseReq,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Looking up...' },
            { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { q: 'AAPL' } },
          ],
        },
      ],
    };
    const out = translateRequestToResponses(req, {});
    const assistantMessages = asInputMessages(out.input).filter((m) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    const parts = assistantMessages[0].content as Array<{ type: string; text?: string }>;
    expect(parts.map((p) => p.type)).toEqual(['input_text']);
    expect(parts[0].text).toBe('Looking up...');
    const functionCalls = out.input.filter((it) => 'type' in it && it.type === 'function_call');
    expect(functionCalls).toHaveLength(1);
    expect(functionCalls[0]).toMatchObject({
      type: 'function_call',
      call_id: 'tu_1',
      name: 'lookup',
      arguments: JSON.stringify({ q: 'AAPL' }),
    });
  });

  it('emits empty assistant placeholder when neither text nor tool_use is present', () => {
    const req: AnthropicRequest = {
      ...baseReq,
      messages: [{ role: 'assistant', content: [] }],
    };
    const out = translateRequestToResponses(req, {});
    expect(out.input).toEqual([{ type: 'message', role: 'assistant', content: '' }]);
  });

  it('handles string-content assistant messages without wrapping in parts', () => {
    const req: AnthropicRequest = {
      ...baseReq,
      messages: [{ role: 'assistant', content: 'ok' }],
    };
    const out = translateRequestToResponses(req, {});
    expect(out.input).toEqual([{ type: 'message', role: 'assistant', content: 'ok' }]);
  });

  it('does not regress under long conversation history (100 turns)', () => {
    const messages: AnthropicMessage[] = [];
    for (let i = 0; i < 100; i++) {
      const filler = 'x'.repeat(2000);
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: `Turn ${i}: ${filler}` },
          { type: 'tool_use', id: `tu_${i}`, name: 'noop', input: { i } },
        ],
      });
    }
    const out = translateRequestToResponses({ ...baseReq, messages }, {});

    expect(out.input).toHaveLength(200);

    const assistantMessages = asInputMessages(out.input).filter((m) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(100);
    for (const m of assistantMessages) {
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          expect((part as { type: string }).type).toBe('input_text');
        }
      }
    }
  });

  it('user-side text is also input_text and carries the message discriminator', () => {
    const req: AnthropicRequest = {
      ...baseReq,
      messages: [{ role: 'user', content: 'hi' }],
    };
    const out = translateRequestToResponses(req, {});
    expect(out.input).toEqual([{ type: 'message', role: 'user', content: 'hi' }]);
  });
});

/**
 * Bug B regression: `EasyInputMessage` must carry `type:'message'` so the
 * Rust serde untagged enum proxy (agnes) can dispatch it from sibling variants
 * (FunctionCallOutput / etc.). OpenAI's official schema marks `type` as
 * Optional but lenient clients send it; strict proxies require it.
 */
describe('translateRequestToResponses — EasyInputMessage discriminator (Bug B)', () => {
  it('always sets type:"message" on user-side string content', () => {
    const out = translateRequestToResponses(
      { ...baseReq, messages: [{ role: 'user', content: 'hi' }] },
      {},
    );
    expect(out.input[0]).toMatchObject({ type: 'message', role: 'user' });
  });

  it('always sets type:"message" on assistant-side string content', () => {
    const out = translateRequestToResponses(
      { ...baseReq, messages: [{ role: 'assistant', content: 'ok' }] },
      {},
    );
    expect(out.input[0]).toMatchObject({ type: 'message', role: 'assistant' });
  });

  it('always sets type:"message" on user-side parts array (text + image)', () => {
    const out = translateRequestToResponses(
      {
        ...baseReq,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'see this' },
              {
                type: 'image',
                source: { type: 'url', url: 'https://example.com/a.png' },
              },
            ],
          },
        ],
      },
      {},
    );
    expect(out.input[0]).toMatchObject({ type: 'message', role: 'user' });
    expect(Array.isArray((out.input[0] as ResponsesInputMessage).content)).toBe(true);
  });

  it('does not stamp type:"message" on function_call / function_call_output (their discriminators differ)', () => {
    const out = translateRequestToResponses(
      {
        ...baseReq,
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tu_1', name: 'noop', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }],
          },
        ],
      },
      {},
    );
    expect(out.input[0]).toMatchObject({ type: 'function_call' });
    expect(out.input[1]).toMatchObject({ type: 'function_call_output' });
  });

  it('every message item in a multi-turn replay carries type:"message"', () => {
    const messages: AnthropicMessage[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: `Turn ${i}` },
          { type: 'tool_use', id: `tu_${i}`, name: 'noop', input: { i } },
        ],
      });
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: `r${i}` }],
      });
    }
    messages.push({ role: 'user', content: 'final' });
    const out = translateRequestToResponses({ ...baseReq, messages }, {});
    const messageItems = asInputMessages(out.input);
    for (const m of messageItems) {
      expect(m.type).toBe('message');
    }
  });
});

/**
 * Reasoning effort vocabulary clamp for Responses API (regression for
 * agnes-2.5-flash "unknown variant `max`" 400 surfaced after the
 * output_text fix unblocked earlier parsing). The Responses API spec
 * defines a strict 4-value effort enum; Claude-only tiers (`max`) and
 * OpenAI extensions outside the set are silently omitted rather than
 * remapped.
 */
describe('translateRequestToResponses — reasoning effort vocabulary', () => {
  const req: AnthropicRequest = { ...baseReq, messages: [] };

  it('omits reasoning.effort entirely when not configured', () => {
    const out = translateRequestToResponses(req, {});
    expect('reasoning' in out).toBe(false);
  });

  it('forwards each documented Responses-API effort value', () => {
    for (const effort of ['minimal', 'low', 'medium', 'high'] as const) {
      const out = translateRequestToResponses(req, { reasoningEffort: effort });
      expect(out.reasoning, `effort=${effort}`).toEqual({ effort });
    }
  });

  it('omits Claude-only `max` instead of forwarding it (the bug)', () => {
    const out = translateRequestToResponses(req, { reasoningEffort: 'max' });
    expect('reasoning' in out).toBe(false);
  });

  it('omits `xhigh` (not in the strict Responses set used by current strict proxies)', () => {
    const out = translateRequestToResponses(req, { reasoningEffort: 'xhigh' });
    expect('reasoning' in out).toBe(false);
  });
});

/**
 * Bug D regression: each function tool in the `tools` array must carry
 * `strict: false` so strict proxies (Rust serde — agnes) dispatch
 * FunctionToolParam. OpenAI's FunctionToolParam schema marks
 * `strict: Required[Optional[bool]]` — strictly optional value but REQUIRED
 * to be present. Without it, the body fails to deserialize at column 30555+
 * (inside tools array, despite outer error string claiming "untagged enum
 * ResponseInput").
 *
 * Bug F regression (2026-09-20): function-tool fields must be nested under
 * `function:` to match OpenAI's documented FunctionToolParam shape and
 * `tools.ts::translateToolDefinitions` (chat-completions path). Strict
 * untagged-enum deserializers (Rust serde — agnes) reject the flat shape
 * with `Function tool must have a function definition` and then give up
 * inside a long tool description string with `untagged enum ResponseInput
 * at line 1 column 63453` (column fell inside EnterPlanMode.description in
 * a 213KB request body with 26 tools). Lenient providers accept either
 * shape; nested is the documented one.
 */
describe('translateRequestToResponses — function tool strict flag (Bug D) + nested shape (Bug F)', () => {
  const tools = [
    { name: 't1', description: 'first tool', input_schema: { type: 'object' } },
    { name: 't2', description: 'second tool', input_schema: { type: 'object' } },
  ];

  it('emits strict:false on every tool when req.tools is provided', () => {
    const out = translateRequestToResponses({ ...baseReq, tools });
    expect(out.tools).toBeDefined();
    expect(out.tools).toHaveLength(2);
    for (const t of out.tools!) {
      expect(t.function.strict).toBe(false);
      expect(t.type).toBe('function');
    }
  });

  it('omits tools entirely when req.tools is missing', () => {
    const out = translateRequestToResponses({ ...baseReq });
    expect('tools' in out).toBe(false);
  });

  it('preserves name / description / parameters alongside strict', () => {
    const out = translateRequestToResponses({ ...baseReq, tools });
    expect(out.tools![0]).toMatchObject({
      type: 'function',
      function: {
        name: 't1',
        description: 'first tool',
        parameters: { type: 'object' },
        strict: false,
      },
    });
  });

  it('does NOT emit name/description/parameters/strict at the top level of the tool object (Bug F)', () => {
    // Regression guard: a previous shape had `name`/`description`/`parameters`/
    // `strict` flat on the tool object. Strict untagged-enum deserializers
    // (Rust serde — agnes) reject that with `Function tool must have a
    // function definition`; lenient providers silently accept it but it's
    // not the documented OpenAI shape. Pin the nested invariant.
    const out = translateRequestToResponses({ ...baseReq, tools });
    for (const t of out.tools!) {
      expect(t).not.toHaveProperty('name');
      expect(t).not.toHaveProperty('description');
      expect(t).not.toHaveProperty('parameters');
      expect(t).not.toHaveProperty('strict');
      expect(t.function).toBeDefined();
      expect(typeof t.function).toBe('object');
    }
  });
});

/**
 * Bug E regression: strict proxies (Rust serde — agnes) reject the
 * `instructions` field in EVERY form we tried:
 *   - bare string: untagged enum ResponseInput at line 1 col N (mid-string)
 *   - array of ResponseInput: same error, +30 bytes shift
 * agnes's ResponsesRequest schema appears to have `instructions: Never` (or
 * a narrower type we can't satisfy). Workaround: fold the Anthropic
 * `system` block into `input[0]` as a role:'system' ResponseInputMessage.
 *
 * OpenAI Responses API accepts this — `input[0]` can be any
 * ResponseInputItem, and role:'system' is valid per EasyInputMessageParam.
 */
describe('translateRequestToResponses — system prompt as input[0] (Bug E)', () => {
  it('folds string-form system into input[0] as a role:"system" message', () => {
    const out = translateRequestToResponses(
      {
        ...baseReq,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'hi' }],
      },
      {},
    );
    expect(out.input[0]).toEqual({
      type: 'message',
      role: 'system',
      content: 'You are a helpful assistant.',
    });
  });

  it('joins AnthropicSystemBlock[] with double newline before folding', () => {
    const out = translateRequestToResponses(
      {
        ...baseReq,
        system: [{ type: 'text', text: 'Part A.' }, { type: 'text', text: 'Part B.' }],
        messages: [{ role: 'user', content: 'hi' }],
      },
      {},
    );
    expect((out.input[0] as { content: string }).content).toBe('Part A.\n\nPart B.');
  });

  it('does not emit the instructions field at all', () => {
    const out = translateRequestToResponses(
      { ...baseReq, system: 'x', messages: [{ role: 'user', content: 'y' }] },
      {},
    );
    expect('instructions' in out).toBe(false);
  });

  it('does not prepend a system message when system is absent', () => {
    const out = translateRequestToResponses(
      { ...baseReq, messages: [{ role: 'user', content: 'hi' }] },
      {},
    );
    expect(out.input).toEqual([{ type: 'message', role: 'user', content: 'hi' }]);
  });

  it('preserves order: system first, then user history', () => {
    const out = translateRequestToResponses(
      {
        ...baseReq,
        system: 'sys',
        messages: [
          { role: 'user', content: 'first user' },
          { role: 'assistant', content: 'first assistant' },
          { role: 'user', content: 'second user' },
        ],
      },
      {},
    );
    expect(out.input).toHaveLength(4);
    expect((out.input[0] as { role: string }).role).toBe('system');
    expect((out.input[1] as { role: string }).role).toBe('user');
    expect((out.input[2] as { role: string }).role).toBe('assistant');
    expect((out.input[3] as { role: string }).role).toBe('user');
  });

  it('the prepended system message carries type:"message" discriminator (Bug B invariant)', () => {
    const out = translateRequestToResponses(
      { ...baseReq, system: 'x', messages: [{ role: 'user', content: 'y' }] },
      {},
    );
    expect((out.input[0] as { type?: string }).type).toBe('message');
  });
});

/**
 * Bug F regression (#325 column 45371): tool schema `description` strings
 * trip strict proxies (Rust serde untagged enum — agnes), which walk every
 * long string in the body searching for ResponseInput variants and report
 * `untagged enum ResponseInput at line 1 column N` mid-string. The translator
 * strips property-level `description` fields via `stripSchemaDescriptions`;
 * the tests below lock the function's contract so a future "save the
 * descriptions" optimization can't silently re-introduce the bug.
 */
describe('stripSchemaDescriptions', () => {
  it('returns undefined for undefined input', () => {
    expect(stripSchemaDescriptions(undefined)).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(stripSchemaDescriptions(null)).toBeUndefined();
  });

  it('drops top-level description but keeps sibling fields', () => {
    expect(
      stripSchemaDescriptions({ type: 'object', description: 'top', properties: {} }),
    ).toEqual({ type: 'object', properties: {} });
  });

  it('recursively drops description inside nested object properties', () => {
    expect(
      stripSchemaDescriptions({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'the name' },
          nested: {
            type: 'object',
            description: 'inner',
            properties: { x: { type: 'number', description: 'x val' } },
          },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        nested: {
          type: 'object',
          properties: { x: { type: 'number' } },
        },
      },
    });
  });

  it('drops description inside array items', () => {
    expect(
      stripSchemaDescriptions({
        type: 'array',
        items: { type: 'string', description: 'one entry' },
      }),
    ).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('preserves oneOf / anyOf / allOf branches and their inner shapes', () => {
    expect(
      stripSchemaDescriptions({
        oneOf: [
          { type: 'string', description: 'a' },
          { type: 'number', description: 'b' },
        ],
      }),
    ).toEqual({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('preserves enum / required / additionalProperties / type', () => {
    expect(
      stripSchemaDescriptions({
        type: 'object',
        required: ['a'],
        additionalProperties: false,
        description: 'strip me',
        properties: { a: { type: 'string', enum: ['x', 'y'], description: 'keep enum' } },
      }),
    ).toEqual({
      type: 'object',
      required: ['a'],
      additionalProperties: false,
      properties: { a: { type: 'string', enum: ['x', 'y'] } },
    });
  });

  it('drops description fields even when the value is empty string', () => {
    expect(stripSchemaDescriptions({ description: '', type: 'string' })).toEqual({
      type: 'string',
    });
  });

  it('drops only keys literally named "description" — does not match substrings', () => {
    expect(
      stripSchemaDescriptions({
        type: 'object',
        properties: {
          short_description: { type: 'string', description: 'drop this' },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: { short_description: { type: 'string' } },
    });
  });

  it('passes through scalar leaves unchanged', () => {
    expect(stripSchemaDescriptions(42)).toBe(42);
    expect(stripSchemaDescriptions('hello')).toBe('hello');
    expect(stripSchemaDescriptions(true)).toBe(true);
  });

  // Regression #325-AskUserQuestion: a `description` KEY whose VALUE is an
  // object (i.e. `description` is the *name of an argument being defined as
  // a string`) MUST be preserved — only string-valued `description` is a
  // schema annotation we can safely drop. Surfaced in production as agnes
  // 400 `untagged enum ResponseInput at column 45371` when AskUserQuestion's
  // `options[].description` property definition was dropped wholesale by
  // the original "skip any description key" rule. See unified log
  // ~/.hamuna/logs/unified-2026-09-02.log around 11:00:28.702 for the
  // original DIAG dump; this test pins the fix at the unit level.
  it('preserves a `description` key whose value is an object property definition', () => {
    const before = {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Display text (1-5 words).' },
              // The property name is literally `description` — the value
              // is the schema for a string-typed argument. Naive "drop
              // every `description` key" deletes the whole definition,
              // which is what regressed in production.
              description: {
                type: 'string',
                description: 'Explanation of what this option means or what will happen if chosen.',
              },
              preview: {
                type: 'string',
                description: 'Optional preview content rendered when this option is focused.',
              },
            },
          },
        },
      },
    };
    const after = stripSchemaDescriptions(before) as Record<string, unknown>;
    const propsAfter = (after.properties as Record<string, unknown>).options as Record<string, unknown>;
    const itemsProps = (propsAfter.items as Record<string, unknown>).properties as Record<string, unknown>;

    // Object-valued description property definition kept (the bug fix).
    expect(itemsProps.description).toEqual({ type: 'string' });
    // Sibling string-valued description annotations still dropped.
    expect(itemsProps.label).toEqual({ type: 'string' });
    expect(itemsProps.preview).toEqual({ type: 'string' });
  });

  it('preserves AskUserQuestion-shaped schemas end-to-end through the translator', () => {
    // Same shape that regressed in production; this pins the wire output.
    const wire = translateRequestToResponses(
      {
        model: 'agnes-2.5-flash',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'ask' }],
        tools: [
          {
            name: 'AskUserQuestion',
            description: 'Use this tool when you need to ask the user clarifying questions.',
            input_schema: {
              type: 'object',
              properties: {
                questions: {
                  type: 'array',
                  description: 'Questions to ask the user (1-4 questions)',
                  items: {
                    type: 'object',
                    properties: {
                      options: {
                        type: 'array',
                        description: 'The available choices for this question.',
                        items: {
                          type: 'object',
                          properties: {
                            label: { type: 'string', description: 'Display text (1-5 words).' },
                            description: {
                              type: 'string',
                              description: 'Explanation of what this option means or what will happen if chosen.',
                            },
                            preview: {
                              type: 'string',
                              description: 'Optional preview content rendered when this option is focused.',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
      { modelOverride: 'agnes-2.5-flash' },
    );
    const params = wire.tools![0].function.parameters as Record<string, unknown>;
    const descProp = (
      (((params.properties as Record<string, unknown>).questions as Record<string, unknown>)
        .items as Record<string, unknown>).properties as Record<string, unknown>
    ).options as Record<string, unknown>;
    const itemsProps = (descProp.items as Record<string, unknown>).properties as Record<string, unknown>;

    // Object-valued description property definition must survive.
    expect(itemsProps.description).toEqual({ type: 'string' });
    // Top-level tool description is the LLM-facing annotation — kept.
    expect(wire.tools![0].function.description).toBe('Use this tool when you need to ask the user clarifying questions.');
    // None of the dropped string descriptions leak to the wire.
    const wireStr = JSON.stringify(wire);
    expect(wireStr).not.toContain('Display text (1-5 words).');
    expect(wireStr).not.toContain('Explanation of what this option means');
    expect(wireStr).not.toContain('Optional preview content rendered');
  });
});

/**
 * Bug F regression at the translator level: ensure the tool-emit path
 * actually invokes `stripSchemaDescriptions` on the input_schema before
 * sending. Without this, schema descriptions could re-introduce the
 * column-45371 400 error in production even though the helper itself
 * works.
 */
describe('translateRequestToResponses — tool schemas strip descriptions (Bug F)', () => {
  const schemaWithDescriptions = {
    type: 'object',
    description: 'top-level tool param description',
    properties: {
      question: {
        type: 'string',
        description: 'A long user-authored prompt whose text would otherwise trigger column 45371',
      },
      options: {
        type: 'array',
        items: { type: 'string', description: 'an option label' },
      },
    },
    required: ['question'],
  };

  it('strips description fields from emitted tool parameters', () => {
    const out = translateRequestToResponses({
      ...baseReq,
      tools: [{ name: 't', description: 'tool-level description kept', input_schema: schemaWithDescriptions }],
    });
    const params = out.tools![0].function.parameters as Record<string, unknown>;
    expect('description' in params).toBe(false);
    const props = params.properties as Record<string, Record<string, unknown>>;
    expect('description' in props.question).toBe(false);
    const items = props.options.items as Record<string, unknown>;
    expect('description' in items).toBe(false);
  });

  it('keeps the tool-level description field untouched (function description ≠ schema description)', () => {
    const out = translateRequestToResponses({
      ...baseReq,
      tools: [{ name: 't', description: 'kept verbatim', input_schema: { type: 'object' } }],
    });
    expect(out.tools![0].function.description).toBe('kept verbatim');
  });

  it('emits an empty parameters object when input_schema is {} (user-authored "no parameters" tool)', () => {
    const out = translateRequestToResponses({
      ...baseReq,
      tools: [{ name: 't', input_schema: {} }],
    });
    expect(out.tools![0].function.parameters).toEqual({});
  });

  // #189 — server-side tools (web_search / web_fetch / code_execution / …)
  // ship from SDK 0.3.201 with `input_schema` undefined. Wire payload MUST
  // still carry `parameters` or strict upstream deserializers (Rust serde
  // untagged enum — agnes) reject with 400 `missing field 'parameters'`.
  // Regression: req=4ca8e7bc 2026-09-23.
  it('falls back to {type:"object",properties:{}} when input_schema is undefined (server tool, #189)', () => {
    const out = translateRequestToResponses({
      ...baseReq,
      tools: [{ name: 'web_search' } as never],
    });
    expect(out.tools![0].function.name).toBe('web_search');
    expect(out.tools![0].function.parameters).toEqual({ type: 'object', properties: {} });
    // JSON-round-trip invariant: `parameters` is present in the wire body.
    const wire = JSON.stringify({ tools: out.tools });
    expect(wire).toContain('"parameters"');
  });
});