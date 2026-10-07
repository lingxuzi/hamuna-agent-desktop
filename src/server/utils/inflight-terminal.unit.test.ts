import { describe, it, expect } from 'vitest';
import {
  decideInFlightActionOnResult,
  decideInFlightCancelSettlement,
  shouldDropInFlightAfterLateInterruptReceipt,
  terminalEventMatchesInFlight,
} from './inflight-terminal';

describe('decideInFlightActionOnResult (issue #289 — force-send must surface, not drop)', () => {
  it('FORCE-send (the bug): interrupting + forced + has meta → surface (show the bubble)', () => {
    // This is the regression for #289: force was dropping the in-flight item even though
    // the SDK processes it. It MUST surface now.
    expect(decideInFlightActionOnResult({ isInterrupting: true, forced: true, hasMeta: true })).toBe('surface');
  });

  it('plain STOP: preserve when the SDK receipt lists the queued uuid as a survivor', () => {
    // The receipt is authoritative — this message WILL run, so dropping it deletes
    // a message the runtime is about to answer. That is the "mid-turn message
    // vanishes on Stop" bug.
    expect(decideInFlightActionOnResult({
      isInterrupting: true, forced: false, hasMeta: true, survivedInterrupt: true,
    })).toBe('await-replay');
  });

  it('plain STOP: preserve when the CLI sent no receipt at all (older SDK)', () => {
    // Stop owns only the current turn; it must not invent a cancellation the
    // runtime never reported.
    expect(decideInFlightActionOnResult({
      isInterrupting: true, forced: false, hasMeta: true, survivedInterrupt: null,
    })).toBe('await-replay');
  });

  it('plain STOP: drop only when the receipt explicitly omits this uuid', () => {
    expect(decideInFlightActionOnResult({
      isInterrupting: true, forced: false, hasMeta: true, survivedInterrupt: false,
    })).toBe('drop');
  });

  it('plain STOP with no receipt argument at all still preserves (fail-safe)', () => {
    expect(decideInFlightActionOnResult({ isInterrupting: true, forced: false, hasMeta: true }))
      .toBe('await-replay');
  });

  it('natural completion: not interrupting + has meta → await replay (no false queue:started)', () => {
    expect(decideInFlightActionOnResult({ isInterrupting: false, forced: false, hasMeta: true })).toBe('await-replay');
  });

  it('force but no meta (cannot build a bubble) → noop (defensive)', () => {
    expect(decideInFlightActionOnResult({ isInterrupting: true, forced: true, hasMeta: false })).toBe('noop');
  });

  it('natural completion but no meta → await replay', () => {
    expect(decideInFlightActionOnResult({ isInterrupting: false, forced: false, hasMeta: false })).toBe('await-replay');
  });

  it('forced wins over the stop drop even if both flags are set (force is the explicit intent)', () => {
    // forced=true must NOT be dropped by the `isInterrupting && !forced` stop rule.
    expect(decideInFlightActionOnResult({ isInterrupting: true, forced: true, hasMeta: true })).not.toBe('drop');
  });
});

describe('decideInFlightCancelSettlement', () => {
  it('SDK cancelled=true is the only path that clears local in-flight state and removes the queue pill', () => {
    expect(decideInFlightCancelSettlement('cancelled')).toEqual({
      cancelled: true,
      removePendingRequest: true,
      clearSlot: true,
      broadcastCancelled: true,
      promoteNext: true,
    });
  });

  it.each(['not-cancelled', 'unavailable', 'error'] as const)(
    'SDK %s keeps the in-flight item waiting for replay or assistant-start confirmation',
    (result) => {
      expect(decideInFlightCancelSettlement(result)).toEqual({
        cancelled: false,
        removePendingRequest: false,
        clearSlot: false,
        broadcastCancelled: false,
        promoteNext: false,
      });
    },
  );
});

describe('terminalEventMatchesInFlight', () => {
  it('does not apply an interrupt terminal event to a newly promoted in-flight item', () => {
    expect(terminalEventMatchesInFlight({
      currentQueueId: 'queue-b',
      isInterrupting: true,
      interruptTargetQueueId: 'queue-a',
    })).toBe(false);
  });

  it('applies an interrupt terminal event to the item that was in-flight when interrupt started', () => {
    expect(terminalEventMatchesInFlight({
      currentQueueId: 'queue-a',
      isInterrupting: true,
      interruptTargetQueueId: 'queue-a',
    })).toBe(true);
  });

  it('applies non-interrupt terminal events to the current in-flight item', () => {
    expect(terminalEventMatchesInFlight({
      currentQueueId: 'queue-a',
      isInterrupting: false,
      interruptTargetQueueId: null,
    })).toBe(true);
  });
});

describe('shouldDropInFlightAfterLateInterruptReceipt', () => {
  const base = {
    postInterruptOutcome: 'result-claimed' as const,
    interruptTargetQueueId: 'queue-a',
    currentQueueId: 'queue-a',
    stillQueued: new Set<string>(),
  };

  it('drops a preserved pill when the late receipt excludes that exact uuid', () => {
    // Preserving while the receipt is unknown is only safe if the late receipt can
    // still retract it — otherwise a genuinely cancelled message strands forever.
    expect(shouldDropInFlightAfterLateInterruptReceipt(base)).toBe(true);
  });

  it('keeps the pill when the receipt lists the uuid as a survivor', () => {
    expect(shouldDropInFlightAfterLateInterruptReceipt({
      ...base, stillQueued: new Set(['queue-a']),
    })).toBe(false);
  });

  it('never touches an item that is not the interrupt target', () => {
    expect(shouldDropInFlightAfterLateInterruptReceipt({ ...base, currentQueueId: 'queue-b' })).toBe(false);
  });

  it('only reconciles once the result already claimed the terminal', () => {
    expect(shouldDropInFlightAfterLateInterruptReceipt({
      ...base, postInterruptOutcome: null,
    })).toBe(false);
    expect(shouldDropInFlightAfterLateInterruptReceipt({
      ...base, postInterruptOutcome: 'session-ended',
    })).toBe(false);
  });
});

describe('stop-means-stop vs force-send', () => {
  it('never cancels the item a force-send targeted — that one must run', () => {
    // The interrupt receipt may list it as a survivor; that is exactly what
    // force-send wants. Cancellation is only for a plain Stop.
    expect(decideInFlightActionOnResult({
      isInterrupting: true, forced: true, hasMeta: true, survivedInterrupt: true,
    })).toBe('surface');
  });

  it('a plain Stop preserves until the explicit cancel confirms, then drops', () => {
    // Step 1: receipt lists the uuid → the SDK kept it, so do not invent a drop.
    expect(decideInFlightActionOnResult({
      isInterrupting: true, forced: false, hasMeta: true, survivedInterrupt: true,
    })).toBe('await-replay');
    // Step 2: the follow-up cancel_async_message confirms → the item is dead and
    // the pill must go.
    expect(decideInFlightCancelSettlement('cancelled')).toMatchObject({
      clearSlot: true, broadcastCancelled: true, promoteNext: true,
    });
  });

  it('leaves the pill alone when the cancel was refused or unavailable', () => {
    for (const result of ['not-cancelled', 'unavailable', 'error'] as const) {
      expect(decideInFlightCancelSettlement(result).broadcastCancelled).toBe(false);
    }
  });
});
