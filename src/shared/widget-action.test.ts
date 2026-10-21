import { describe, expect, it } from 'vitest';
import {
  MAX_ACTION_FIELDS,
  MAX_ACTION_VALUE_LEN,
  WIDGET_ACTION_PREFIX,
  describeWidgetAction,
  encodeWidgetAction,
  parseWidgetAction,
  validateWidgetActionEnvelope,
  widgetIdFor,
} from './widget-action';

describe('validateWidgetActionEnvelope', () => {
  const valid = {
    widgetId: 'msg-1:0',
    action: 'select',
    payload: { optionId: 'a' },
  };

  it('accepts a well-formed envelope', () => {
    expect(validateWidgetActionEnvelope(valid)).toEqual(valid);
  });

  it('accepts every whitelisted action kind', () => {
    for (const action of ['select', 'submit']) {
      expect(validateWidgetActionEnvelope({ ...valid, action })).not.toBeNull();
    }
  });

  it('rejects an action outside the whitelist', () => {
    // The whole point of the whitelist: sandboxed script must not be able to
    // mint arbitrary action names that the model would then act on.
    expect(validateWidgetActionEnvelope({ ...valid, action: 'delete_account' })).toBeNull();
    expect(validateWidgetActionEnvelope({ ...valid, action: '' })).toBeNull();
    expect(validateWidgetActionEnvelope({ ...valid, action: 42 })).toBeNull();
  });

  it('rejects a missing or oversized widgetId', () => {
    expect(validateWidgetActionEnvelope({ ...valid, widgetId: '' })).toBeNull();
    expect(validateWidgetActionEnvelope({ ...valid, widgetId: 'x'.repeat(201) })).toBeNull();
    expect(validateWidgetActionEnvelope({ ...valid, widgetId: 7 })).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(validateWidgetActionEnvelope({ ...valid, payload: 'hi' })).toBeNull();
    expect(validateWidgetActionEnvelope({ ...valid, payload: [] })).toBeNull();
    expect(validateWidgetActionEnvelope({ ...valid, payload: null })).toBeNull();
  });

  it('rejects too many fields', () => {
    const payload = Object.fromEntries(
      Array.from({ length: MAX_ACTION_FIELDS + 1 }, (_, i) => [`k${i}`, i]),
    );
    expect(validateWidgetActionEnvelope({ ...valid, payload })).toBeNull();
  });

  it('rejects an oversized string value', () => {
    expect(
      validateWidgetActionEnvelope({
        ...valid,
        payload: { note: 'x'.repeat(MAX_ACTION_VALUE_LEN + 1) },
      }),
    ).toBeNull();
  });

  it('rejects nested objects and arrays in payload values', () => {
    expect(validateWidgetActionEnvelope({ ...valid, payload: { a: { b: 1 } } })).toBeNull();
    expect(validateWidgetActionEnvelope({ ...valid, payload: { a: [1, 2] } })).toBeNull();
  });

  it('rejects non-finite numbers', () => {
    expect(validateWidgetActionEnvelope({ ...valid, payload: { n: NaN } })).toBeNull();
    expect(validateWidgetActionEnvelope({ ...valid, payload: { n: Infinity } })).toBeNull();
  });

  it('accepts primitive payload values', () => {
    const payload = { s: 'text', n: 3.5, b: true };
    expect(validateWidgetActionEnvelope({ ...valid, payload })?.payload).toEqual(payload);
  });
});

describe('encodeWidgetAction / parseWidgetAction', () => {
  it('round-trips through the wire format', () => {
    const envelope = { widgetId: 'msg-9:2', action: 'submit', payload: { ok: true } } as const;
    const encoded = encodeWidgetAction(envelope);
    expect(encoded.startsWith(WIDGET_ACTION_PREFIX)).toBe(true);
    expect(parseWidgetAction(encoded)).toEqual(envelope);
  });

  it('returns null for ordinary user text', () => {
    // Callers branch on this to keep the normal send path untouched.
    expect(parseWidgetAction('hello world')).toBeNull();
    expect(parseWidgetAction('')).toBeNull();
  });

  it('returns null for a prefixed but malformed body', () => {
    expect(parseWidgetAction(`${WIDGET_ACTION_PREFIX}{not json`)).toBeNull();
    expect(parseWidgetAction(`${WIDGET_ACTION_PREFIX}{"widgetId":"a"}`)).toBeNull();
  });
});

describe('describeWidgetAction', () => {
  it('renders the gesture readably instead of the wire JSON', () => {
    expect(
      describeWidgetAction({ widgetId: 'm:0', action: 'select', payload: { optionId: 'b' } }),
    ).toBe('select · optionId: b');
  });

  it('falls back to the bare action when the payload is empty', () => {
    expect(describeWidgetAction({ widgetId: 'm:0', action: 'submit', payload: {} })).toBe('submit');
  });
});

describe('widgetIdFor', () => {
  it('is stable and addressable per segment', () => {
    expect(widgetIdFor('msg-1', 0)).toBe('msg-1:0');
    expect(widgetIdFor('msg-1', 2)).toBe('msg-1:2');
    expect(widgetIdFor('msg-1', 0)).toBe(widgetIdFor('msg-1', 0));
  });
});
