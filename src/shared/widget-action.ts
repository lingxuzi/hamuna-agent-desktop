// Widget action envelope — the round-trip channel from a sandboxed
// <generative-ui-widget> back into the conversation.
//
// Widgets are agent-authored HTML in an opaque-origin iframe with only
// `allow-scripts`. Until now they were read-only: a button inside one could not
// reach the agent at all. This module defines the one shape that may cross that
// boundary, and the validation both sides must apply.
//
// The envelope rides as a normal user message with WIDGET_ACTION_PREFIX, so it
// reuses the existing session-send path instead of adding an endpoint or a
// state machine. The prefix is how the model tells a UI gesture apart from
// something the person typed.

export const WIDGET_ACTION_PREFIX = '[Widget action] ';

/** Every `hamuna.emit()` call must use one of these. An open-ended action name
 *  would let sandboxed script mint arbitrary instructions for the model. */
export const WIDGET_ACTION_KINDS = ['select', 'submit'] as const;
export type WidgetActionKind = (typeof WIDGET_ACTION_KINDS)[number];

export const MAX_WIDGET_ID_LEN = 200;
export const MAX_ACTION_FIELDS = 12;
export const MAX_ACTION_VALUE_LEN = 500;

export type WidgetActionValue = string | number | boolean;

export interface WidgetActionEnvelope {
  widgetId: string;
  action: WidgetActionKind;
  payload: Record<string, WidgetActionValue>;
}

function isKind(value: unknown): value is WidgetActionKind {
  return typeof value === 'string' && (WIDGET_ACTION_KINDS as readonly string[]).includes(value);
}

/** Validates an already-parsed object. Returns null on any violation so callers
 *  fail closed — a malformed action must never reach the model. */
export function validateWidgetActionEnvelope(input: unknown): WidgetActionEnvelope | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  const widgetId = raw.widgetId;
  if (typeof widgetId !== 'string' || !widgetId || widgetId.length > MAX_WIDGET_ID_LEN) return null;

  if (!isKind(raw.action)) return null;

  const payload = raw.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length > MAX_ACTION_FIELDS) return null;

  const clean: Record<string, WidgetActionValue> = {};
  for (const [key, value] of entries) {
    // Key length is bounded by the same cap as values: a caller-controlled key
    // is just another string that ends up in the model's context.
    if (!key || key.length > 80) return null;
    if (typeof value === 'string') {
      if (value.length > MAX_ACTION_VALUE_LEN) return null;
      clean[key] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      clean[key] = value;
    } else if (typeof value === 'boolean') {
      clean[key] = value;
    } else {
      return null;
    }
  }

  return { widgetId, action: raw.action, payload: clean };
}

/** Serializes to the exact string a widget action becomes on the wire. */
export function encodeWidgetAction(envelope: WidgetActionEnvelope): string {
  return `${WIDGET_ACTION_PREFIX}${JSON.stringify(envelope)}`;
}

/** Parses a message body that may be a widget action. Returns null for ordinary
 *  user text, so the caller's normal path is untouched. */
export function parseWidgetAction(text: string): WidgetActionEnvelope | null {
  if (!text.startsWith(WIDGET_ACTION_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(WIDGET_ACTION_PREFIX.length));
  } catch {
    return null;
  }
  return validateWidgetActionEnvelope(parsed);
}

/** widgetId for the Nth widget inside a message. Stable across re-renders and
 *  derivable from the transcript alone, so the server can re-check it without
 *  parsing widget HTML. */
export function widgetIdFor(messageId: string, segmentIndex: number): string {
  return `${messageId}:${segmentIndex}`;
}

/** One-line human-readable form for UI surfaces (user bubble, queue pill).
 *  The wire form is JSON and must never be shown as the user's own words. */
export function describeWidgetAction(envelope: WidgetActionEnvelope): string {
  const fields = Object.entries(envelope.payload).map(([key, value]) => `${key}: ${String(value)}`);
  return fields.length > 0 ? `${envelope.action} · ${fields.join(', ')}` : envelope.action;
}
