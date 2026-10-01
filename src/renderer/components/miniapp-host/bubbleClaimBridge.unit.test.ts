import { describe, expect, it } from 'vitest';

import {
  BUBBLE_CLAIM_KINDS,
  mintBubbleClaimNonce,
  verifyBubbleClaim,
  type PostMessageEnvelope,
} from './bubbleClaimBridge';

// Minimal Window stand-in. jsdom provides HTMLIFrameElement.contentWindow
// as a real Window, but we only need a stable identity for `===` checks,
// so any unique object works.
function fakeWindow(): Window {
  // Cast through unknown: the bridge only ever compares identity, never
  // touches Window-specific methods.
  return {} as unknown as Window;
}

function makeEnvelope(
  source: PostMessageEnvelope['source'],
  data: unknown,
  origin = '',
): PostMessageEnvelope {
  return { source, origin, data };
}

describe('bubbleClaimBridge / verifyBubbleClaim', () => {
  const appId = 'icon-generator';
  const nonce = mintBubbleClaimNonce();
  const iframeWin = fakeWindow();

  it('accepts a well-formed claim from the bound iframe window', () => {
    const result = verifyBubbleClaim(
      makeEnvelope(iframeWin, {
        kind: 'chat.claimComposer',
        nonce,
        payload: { appId, draft: 'continue editing the icon' },
      }),
      iframeWin,
      nonce,
      appId,
    );
    expect(result?.kind).toBe('chat.claimComposer');
    expect(result?.payload.draft).toBe('continue editing the icon');
  });

  it('rejects when source is not the bound iframe window', () => {
    const result = verifyBubbleClaim(
      makeEnvelope(fakeWindow(), {
        kind: 'chat.claimComposer',
        nonce,
        payload: { appId, draft: 'x' },
      }),
      iframeWin,
      nonce,
      appId,
    );
    expect(result).toBeNull();
  });

  it('rejects when source is null (defends against window.opener spoofing)', () => {
    const result = verifyBubbleClaim(
      makeEnvelope(null, {
        kind: 'chat.claimComposer',
        nonce,
        payload: { appId, draft: 'x' },
      }),
      iframeWin,
      nonce,
      appId,
    );
    expect(result).toBeNull();
  });

  it('rejects when iframeContentWindow arg is null (closed iframe)', () => {
    const result = verifyBubbleClaim(
      makeEnvelope(fakeWindow(), {
        kind: 'chat.claimComposer',
        nonce,
        payload: { appId, draft: 'x' },
      }),
      null,
      nonce,
      appId,
    );
    expect(result).toBeNull();
  });

  it('rejects when nonce does not match the session-bound nonce', () => {
    const result = verifyBubbleClaim(
      makeEnvelope(iframeWin, {
        kind: 'chat.claimComposer',
        nonce: 'replayed-nonce',
        payload: { appId, draft: 'x' },
      }),
      iframeWin,
      nonce,
      appId,
    );
    expect(result).toBeNull();
  });

  it('rejects unknown kind even when source + nonce are correct', () => {
    const result = verifyBubbleClaim(
      makeEnvelope(iframeWin, {
        kind: 'shell.exec',
        nonce,
        payload: { appId, draft: 'x' },
      }),
      iframeWin,
      nonce,
      appId,
    );
    expect(result).toBeNull();
  });

  it('rejects when payload.appId differs from the bound appId (impersonation)', () => {
    const result = verifyBubbleClaim(
      makeEnvelope(iframeWin, {
        kind: 'chat.claimComposer',
        nonce,
        payload: { appId: 'some-other-app', draft: 'x' },
      }),
      iframeWin,
      nonce,
      appId,
    );
    expect(result).toBeNull();
  });

  it('rejects when data is not an object', () => {
    expect(
      verifyBubbleClaim(
        makeEnvelope(iframeWin, 'just a string'),
        iframeWin,
        nonce,
        appId,
      ),
    ).toBeNull();
    expect(
      verifyBubbleClaim(makeEnvelope(iframeWin, null), iframeWin, nonce, appId),
    ).toBeNull();
  });

  it('rejects when payload is missing draft or appId', () => {
    expect(
      verifyBubbleClaim(
        makeEnvelope(iframeWin, {
          kind: 'chat.claimComposer',
          nonce,
          payload: { appId },
        }),
        iframeWin,
        nonce,
        appId,
      ),
    ).toBeNull();
    expect(
      verifyBubbleClaim(
        makeEnvelope(iframeWin, {
          kind: 'chat.claimComposer',
          nonce,
          payload: { draft: 'x' },
        }),
        iframeWin,
        nonce,
        appId,
      ),
    ).toBeNull();
  });

  it('rejects when attachments are present but malformed', () => {
    expect(
      verifyBubbleClaim(
        makeEnvelope(iframeWin, {
          kind: 'chat.claimComposer',
          nonce,
          payload: { appId, draft: 'x', attachments: 'not-an-array' },
        }),
        iframeWin,
        nonce,
        appId,
      ),
    ).toBeNull();
    expect(
      verifyBubbleClaim(
        makeEnvelope(iframeWin, {
          kind: 'chat.claimComposer',
          nonce,
          payload: {
            appId,
            draft: 'x',
            attachments: [{ kind: 'audio', path: '/x' }],
          },
        }),
        iframeWin,
        nonce,
        appId,
      ),
    ).toBeNull();
  });

  it('preserves well-formed attachments in the returned envelope', () => {
    const result = verifyBubbleClaim(
      makeEnvelope(iframeWin, {
        kind: 'chat.claimComposer',
        nonce,
        payload: {
          appId,
          draft: 'edit this',
          attachments: [
            { kind: 'image', path: '/tmp/ref.png', label: 'reference' },
          ],
        },
      }),
      iframeWin,
      nonce,
      appId,
    );
    expect(result?.payload.attachments).toEqual([
      { kind: 'image', path: '/tmp/ref.png', label: 'reference' },
    ]);
  });
});

describe('bubbleClaimBridge / kind allow-list', () => {
  it('currently exposes exactly one kind', () => {
    expect(BUBBLE_CLAIM_KINDS).toEqual(['chat.claimComposer']);
  });
});

describe('bubbleClaimBridge / mintBubbleClaimNonce', () => {
  it('produces distinct nonces across calls', () => {
    const a = mintBubbleClaimNonce();
    const b = mintBubbleClaimNonce();
    expect(a).not.toBe(b);
  });
});
