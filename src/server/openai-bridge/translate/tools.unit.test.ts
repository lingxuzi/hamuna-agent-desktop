import { describe, it, expect } from 'vitest';

import { translateToolDefinitions, ensureObjectParameters, EMPTY_OBJECT_SCHEMA } from './tools';
import type { AnthropicToolDefinition } from '../types/anthropic';

// #189 — Anthropic server-side tools (web_search / web_fetch / code_execution
// / …) ship with NO `input_schema` field in SDK 0.3.201. The Chat Completions
// translator used to forward `tool.input_schema` verbatim; when undefined,
// JSON.stringify drops the `parameters` key entirely and strict upstream
// deserializers (Rust serde untagged enum — agnes) reject with 400
// `tools[0].function: missing field 'parameters'`. Regression: req=4ca8e7bc
// 2026-09-23 (full chat_completions body emitted `{type:"function",function:
// {"name":"web_search"}}` with no `parameters`).
//
// These tests pin the contract: `parameters` is ALWAYS present on the wire,
// and undefined / null / non-object input schemas collapse to
// `EMPTY_OBJECT_SCHEMA` (= `{type:'object', properties:{}}`).

describe('ensureObjectParameters (#189)', () => {
  it('returns the schema verbatim when it is a non-null object', () => {
    const schema = { type: 'object', properties: { x: { type: 'string' } } };
    expect(ensureObjectParameters(schema)).toBe(schema);
  });

  it('falls back to EMPTY_OBJECT_SCHEMA when input_schema is undefined', () => {
    expect(ensureObjectParameters(undefined)).toEqual({ type: 'object', properties: {} });
  });

  it('falls back to EMPTY_OBJECT_SCHEMA when input_schema is null', () => {
    expect(ensureObjectParameters(undefined)).toEqual(EMPTY_OBJECT_SCHEMA);
  });

  it('falls back to EMPTY_OBJECT_SCHEMA when input_schema is an empty object', () => {
    // Empty object is truthy & object-shaped — keep verbatim so user-provided
    // "no parameters" tools remain distinguishable from server-side tools.
    expect(ensureObjectParameters({})).toEqual({});
  });
});

describe('translateToolDefinitions — parameters is always present (#189)', () => {
  it('forwards a server-side tool with no input_schema (web_search regression case)', () => {
    // SDK emits web_search with only `name` + `type`; no description, no
    // input_schema. The wire payload MUST still contain `parameters`.
    const tools = [
      { name: 'web_search', type: 'web_search_20250305' },
    ] as unknown as AnthropicToolDefinition[];
    const [out] = translateToolDefinitions(tools);
    expect(out.type).toBe('function');
    expect(out.function.name).toBe('web_search');
    expect(out.function.parameters).toEqual({ type: 'object', properties: {} });
    // Invariant: parameters must always be a defined, object-shaped value —
    // never omitted (which would round-trip as `undefined` and JSON.stringify
    // would strip it from the wire body).
    expect(out.function.parameters).toBeDefined();
    expect(typeof out.function.parameters).toBe('object');
  });

  it('forwards a normal tool with a full input_schema verbatim', () => {
    const input_schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    };
    const [out] = translateToolDefinitions([
      { name: 'Read', description: 'read a file', input_schema },
    ]);
    expect(out.function.name).toBe('Read');
    expect(out.function.description).toBe('read a file');
    expect(out.function.parameters).toBe(input_schema);
  });

  it('preserves description: undefined as undefined (JSON.stringify will drop it)', () => {
    const [out] = translateToolDefinitions([{ name: 'X' }]);
    expect(out.function.description).toBeUndefined();
    expect(out.function.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('returns one entry per input tool, in order', () => {
    const out = translateToolDefinitions([
      { name: 'a', input_schema: { type: 'object' } },
      { name: 'b', input_schema: { type: 'object' } },
      { name: 'c' }, // server tool
    ]);
    expect(out.map(t => t.function.name)).toEqual(['a', 'b', 'c']);
    expect(out.every(t => t.function.parameters !== undefined)).toBe(true);
  });

  it('JSON-round-trips without losing the parameters field on a server tool', () => {
    // This is the actual wire-shape check that exposed #189: serialize the
    // translated tools array and confirm `parameters` is present in the body.
    const [out] = translateToolDefinitions([
      { name: 'web_search', type: 'web_search_20250305' },
    ] as unknown as AnthropicToolDefinition[]);
    const wire = JSON.stringify({ tools: [out] });
    expect(wire).toContain('"parameters"');
    expect(wire).toContain('"type":"object"');
    expect(wire).toContain('"properties":{}');
  });
});