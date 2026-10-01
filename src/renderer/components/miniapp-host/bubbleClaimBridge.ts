// bubbleClaimBridge.ts — Phase 2 (PRD v0.4 §B.3) MiniApp ↔ Chat trust boundary.
//
// Pure helpers for verifying postMessage events from the MiniApp iframe.
// The renderer-side `MiniAppRunner` is the integration site; this file is
// pure logic so the trust rules are exercised in unit tests without a live
// iframe.
//
// Trust rules (CLAUDE.md §Pit-of-Success postMessage 红线):
//   1. event.source === iframe.contentWindow (strict equality — no iframe
//      proxy object, no null, no React internals)
//   2. event.data.nonce must equal the session-bound nonce minted at iframe
//      creation (defends against a sibling MiniApp tab reusing the listener)
//   3. event.data.kind must match an allow-list (forward-compat with future
//      Bubble Claim variants; today only `chat.claimComposer` is recognized)
//
// The `BubbleClaimMessage` envelope is the single shape the renderer
// accepts. Anything else is dropped silently — MiniApp authors do not get
// to extend the envelope without a host bump.

export type BubbleClaimMessageKind = 'chat.claimComposer';

export interface BubbleClaimComposerPayload {
  /** Plain-text draft the MiniApp wants the Chat composer to adopt. */
  draft: string;
  /**
   * Optional attachments the MiniApp wants to attach to the composer.
   * Schema mirrors `src/shared/toolAttachment.ts` so renderer can re-use the
   * existing attachment pipeline (PRD v0.3 §4.2).
   */
  attachments?: Array<{
    kind: 'image' | 'file';
    path: string;
    label?: string;
  }>;
  /**
   * Stable MiniApp id; the renderer echoes it in the claim UI so the user
   * sees which MiniApp triggered the claim.
   */
  appId: string;
}

export interface BubbleClaimMessage {
  kind: BubbleClaimMessageKind;
  nonce: string;
  payload: BubbleClaimComposerPayload;
}

/** Allow-list of accepted message kinds. Adding a kind requires a host bump. */
export const BUBBLE_CLAIM_KINDS: readonly BubbleClaimMessageKind[] = [
  'chat.claimComposer',
];

export interface PostMessageEnvelope {
  source: MessageEvent['source'];
  origin: string;
  data: unknown;
}

/**
 * Pure decision: is this a valid Bubble Claim message from the bound iframe?
 * Returns the parsed envelope on success, or null on any rule violation
 * (caller logs + drops).
 */
export function verifyBubbleClaim(
  envelope: PostMessageEnvelope,
  iframeContentWindow: HTMLIFrameElement['contentWindow'] | null,
  expectedNonce: string,
  boundAppId: string,
): BubbleClaimMessage | null {
  // Rule 1: strict equality on the source
  if (!iframeContentWindow || envelope.source !== iframeContentWindow) {
    return null;
  }
  // Rule 2: nonce must match the session-bound nonce minted at iframe
  // creation. A stale or replayed nonce from a sibling MiniApp is rejected.
  const parsed = parseEnvelope(envelope.data);
  if (!parsed) return null;
  if (parsed.nonce !== expectedNonce) return null;
  // Rule 3: kind allow-list + appId must match the iframe's bound appId
  // (defends against a MiniApp that hot-swaps its meta tag to impersonate a
  // sibling).
  if (!BUBBLE_CLAIM_KINDS.includes(parsed.kind)) return null;
  if (parsed.payload.appId !== boundAppId) return null;
  return parsed;
}

function parseEnvelope(data: unknown): BubbleClaimMessage | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  if (
    typeof rec.kind !== 'string' ||
    typeof rec.nonce !== 'string' ||
    !rec.payload ||
    typeof rec.payload !== 'object'
  ) {
    return null;
  }
  const payload = rec.payload as Record<string, unknown>;
  if (typeof payload.appId !== 'string' || typeof payload.draft !== 'string') {
    return null;
  }
  if (rec.kind !== 'chat.claimComposer') return null;
  // Attachments are optional but must conform when given.
  if (payload.attachments !== undefined) {
    if (!Array.isArray(payload.attachments)) return null;
    for (const att of payload.attachments) {
      if (!att || typeof att !== 'object') return null;
      const a = att as Record<string, unknown>;
      if (
        typeof a.path !== 'string' ||
        (a.kind !== 'image' && a.kind !== 'file')
      ) {
        return null;
      }
    }
  }
  return {
    kind: 'chat.claimComposer',
    nonce: rec.nonce,
    payload: {
      draft: payload.draft,
      ...(payload.attachments !== undefined
        ? { attachments: payload.attachments as BubbleClaimComposerPayload['attachments'] }
        : {}),
      appId: payload.appId,
    },
  };
}

/**
 * Mint a session-bound nonce. Per iframe session, not per appId — closing
 * the MiniApp tab invalidates any in-flight claim. Uses `crypto.randomUUID`
 * to avoid needing a token-bucket.
 */
export function mintBubbleClaimNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Non-browser fallback (tests, SSR). Not cryptographically strong but
  // sufficient for "don't replay across tabs in the same renderer".
  return `nonce-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}