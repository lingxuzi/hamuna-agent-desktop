// Behavioral tests for the sandbox's widget → host action API.
//
// This API is the ONLY channel a sandboxed widget has back into the app, so its
// limits are a security boundary, not cosmetics: an unclamped or unthrottled
// emit lets model-authored HTML push arbitrary text into the conversation
// context. Evaluating the exported source against a stub window tests the real
// logic; asserting on substrings of the template would pass even if it broke.
import { describe, expect, it } from 'vitest';

import { WIDGET_ACTION_API_SRC, buildSandboxHtml } from './widgetSandboxHtml';

interface StubEnv {
  emit: (action: unknown, payload?: unknown) => boolean;
  posted: Array<{ type: string; action: string; payload: Record<string, unknown> }>;
}

function runApi(now = () => 1_000_000): StubEnv {
  const posted: StubEnv['posted'] = [];
  const window = {
    parent: { postMessage: (msg: unknown) => posted.push(msg as StubEnv['posted'][number]) },
  };
  const fn = new Function('window', 'Date', `${WIDGET_ACTION_API_SRC}\nreturn window.hamuna.emit;`);
  const emit = fn(window, { now }) as StubEnv['emit'];
  return { emit, posted };
}

describe('widget action API', () => {
  it('is injected into the sandbox HTML', () => {
    expect(buildSandboxHtml(':root{--x:1}')).toContain('window.hamuna = { emit: emit }');
  });

  it('forwards a whitelisted action with its payload', () => {
    const { emit, posted } = runApi();
    expect(emit('select', { optionId: 'a', n: 2, ok: true })).toBe(true);
    expect(posted).toEqual([
      { type: 'widget:action', action: 'select', payload: { optionId: 'a', n: 2, ok: true } },
    ]);
  });

  it('refuses actions outside the whitelist', () => {
    const { emit, posted } = runApi();
    expect(emit('delete_account', {})).toBe(false);
    expect(emit('', {})).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it('drops non-primitive payload values instead of forwarding them', () => {
    const { emit, posted } = runApi();
    emit('submit', { good: 'x', bad: { nested: 1 }, arr: [1], nan: NaN });
    expect(posted[0].payload).toEqual({ good: 'x' });
  });

  it('clamps an oversized string value', () => {
    const { emit, posted } = runApi();
    emit('submit', { note: 'x'.repeat(2000) });
    expect(String(posted[0].payload.note)).toHaveLength(500);
  });

  it('caps the number of fields', () => {
    const { emit, posted } = runApi();
    const payload = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    emit('submit', payload);
    expect(Object.keys(posted[0].payload)).toHaveLength(12);
  });

  it('ignores inherited payload properties', () => {
    const { emit, posted } = runApi();
    const payload = Object.create({ inherited: 'no' });
    payload.own = 'yes';
    emit('select', payload);
    expect(posted[0].payload).toEqual({ own: 'yes' });
  });

  it('rate limits to 10 actions per rolling minute', () => {
    // Without this a widget whose script loops on click would flood the model
    // context with hundreds of turns.
    let t = 1_000_000;
    const { emit, posted } = runApi(() => t);
    for (let i = 0; i < 15; i++) emit('select', { i });
    expect(posted).toHaveLength(10);
    expect(emit('select', { i: 99 })).toBe(false);

    t += 60_001;
    expect(emit('select', { after: 'window' })).toBe(true);
    expect(posted).toHaveLength(11);
  });

  it('does not throw when the parent postMessage fails', () => {
    const window = {
      parent: {
        postMessage: () => {
          throw new Error('detached');
        },
      },
    };
    const fn = new Function(
      'window',
      'Date',
      `${WIDGET_ACTION_API_SRC}\nreturn window.hamuna.emit;`,
    );
    const emit = fn(window, { now: () => 1 }) as StubEnv['emit'];
    expect(emit('select', {})).toBe(false);
  });

  it('treats a non-object payload as empty rather than crashing', () => {
    const { emit, posted } = runApi();
    expect(emit('select', 'not-an-object')).toBe(true);
    expect(posted[0].payload).toEqual({});
  });

  it('survives a null payload', () => {
    const { emit, posted } = runApi();
    expect(emit('submit', null)).toBe(true);
    expect(posted[0].payload).toEqual({});
  });
});
