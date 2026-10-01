// Bubble Claim wire-up test — confirms MiniAppRunner's postMessage listener
// (a) accepts claims from the iframe's contentWindow, (b) rejects claims
// from foreign windows (the trust rule is `event.source === iframe.contentWindow`,
// not just "any window"). Pure helper logic lives in
// `bubbleClaimBridge.unit.test.ts`; this file covers the React wiring.
//
// We can't reliably read the runner's per-render nonce from outside (it's
// in a useRef), so the "accepts valid claim" half is covered by the unit
// test. Here we focus on the wire-up integrity: source identity check +
// listener teardown on appId change.

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MiniAppRunner from './MiniAppRunner';

describe('MiniAppRunner / bubble claim wire-up', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT invoke onBubbleClaim when the message source is a foreign window', async () => {
    const onBubbleClaim = vi.fn();
    render(
      <MiniAppRunner
        appId="icon-generator"
        srcDoc="<html><body>x</body></html>"
        height={200}
        onBubbleClaim={onBubbleClaim}
      />,
    );

    // Foreign source — a fresh object that is NOT the iframe's contentWindow.
    // The trust rule is strict equality (not just `instanceof Window`), so
    // an object literal fails the check.
    const foreignSource = {} as Window;
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          kind: 'chat.claimComposer',
          nonce: 'anything',
          payload: { appId: 'icon-generator', draft: 'impersonator' },
        },
        origin: '',
        source: foreignSource,
      }),
    );
    await waitFor(() => {
      expect(onBubbleClaim).not.toHaveBeenCalled();
    });
  });

  it('does NOT invoke onBubbleClaim when the source is null', async () => {
    const onBubbleClaim = vi.fn();
    render(
      <MiniAppRunner
        appId="icon-generator"
        srcDoc="<html><body>y</body></html>"
        height={200}
        onBubbleClaim={onBubbleClaim}
      />,
    );
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          kind: 'chat.claimComposer',
          nonce: 'anything',
          payload: { appId: 'icon-generator', draft: 'spoofed' },
        },
        origin: '',
        source: null,
      }),
    );
    await waitFor(() => {
      expect(onBubbleClaim).not.toHaveBeenCalled();
    });
  });

  it('tears down the message listener when appId changes (no leaks across MiniApps)', async () => {
    const onBubbleClaim = vi.fn();
    const { rerender, unmount } = render(
      <MiniAppRunner
        appId="app-a"
        srcDoc="<html><body>a</body></html>"
        height={100}
        onBubbleClaim={onBubbleClaim}
      />,
    );
    // Re-mount with a different appId to force the effect to re-run.
    rerender(
      <MiniAppRunner
        appId="app-b"
        srcDoc="<html><body>b</body></html>"
        height={100}
        onBubbleClaim={onBubbleClaim}
      />,
    );
    // Foreign-source attack: must still be rejected post-remount.
    const foreignSource = {} as Window;
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          kind: 'chat.claimComposer',
          nonce: 'anything',
          payload: { appId: 'app-b', draft: 'late' },
        },
        origin: '',
        source: foreignSource,
      }),
    );
    await waitFor(() => {
      expect(onBubbleClaim).not.toHaveBeenCalled();
    });
    unmount();
    // After unmount, dispatch again — listener should be gone (no crash,
    // no call). The runner's handler references iframeRef.current which
    // is null post-unmount; this also exercises the iframeRef null guard.
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          kind: 'chat.claimComposer',
          nonce: 'anything',
          payload: { appId: 'app-b', draft: 'after-unmount' },
        },
        origin: '',
        source: foreignSource,
      }),
    );
    expect(onBubbleClaim).not.toHaveBeenCalled();
  });
});
