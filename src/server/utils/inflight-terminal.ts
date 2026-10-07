/**
 * Issue #289 — what to do with the in-flight mid-turn queued item when the SDK's
 * `result` (turn-end) arrives during/after an interrupt.
 *
 * Background: a message sent mid-turn is yielded to the SDK ("in-flight to CLI") and
 * waits in the SDK commandQueue until the SDK either replays/dequeues it or the host
 * cancels it via cancel_async_message. A graceful interrupt still routes a `result`
 * through handleMessageComplete, but natural completion alone is not a consumption
 * acknowledgement. So whether the item should be SURFACED (shown as a user bubble),
 * DROPPED, or kept waiting depends on the terminal reason and user intent:
 *
 *  - Plain STOP: the interrupt receipt decides whether the queued item survived.
 *    Preserve it until replay when the receipt lists it, or when an older CLI omits
 *    the receipt; drop it only when the receipt explicitly omits its UUID.
 *  - FORCE ("立即发送"): the user explicitly asked for THIS item to run now. force
 *    interrupts the current turn precisely so the SDK drains + processes the queued
 *    command — so it MUST be surfaced as a user bubble (the AI's reply renders under it).
 *    Dropping it is the #289 bug: "message vanishes from UI but the AI processed it".
 *  - Natural completion (not interrupting): keep waiting for SDK replay or the next
 *    assistant-turn signal. Do not surface merely because the previous turn ended.
 *
 * Pure decision core (Functional Core / Imperative Shell): the shell passes the live
 * flags; the caller performs the broadcast. This is ONLY for the result/complete handler.
 * The stop/error handlers fire when the item was lost with a force-closed subprocess
 * (rescuePendingToQueue does NOT rescue the in-flight item), so those always drop and
 * do not use this.
 */
export type InFlightTerminalAction = 'drop' | 'surface' | 'await-replay' | 'noop';

export type InFlightAsyncCancelResult = 'cancelled' | 'not-cancelled' | 'unavailable' | 'error';

export type InFlightCancelSettlement = {
  cancelled: boolean;
  removePendingRequest: boolean;
  clearSlot: boolean;
  broadcastCancelled: boolean;
  promoteNext: boolean;
};

export function decideInFlightActionOnResult(opts: {
  /** An interrupt (stop or force) is in progress for this terminal result. */
  isInterrupting: boolean;
  /** This interrupt was a force-execute targeting THIS in-flight item (#289). */
  forced: boolean;
  /** inFlightMetadata is available to build the user bubble. */
  hasMeta: boolean;
  /** true/false from a public receipt; null/undefined when the CLI omitted it. */
  survivedInterrupt?: boolean | null;
}): InFlightTerminalAction {
  // The SDK's interrupt receipt is authoritative: a listed survivor WILL run, so
  // dropping it would delete a message the runtime is about to answer. Older CLIs
  // omit the receipt — preserve then too, because Stop owns only the current turn
  // and must never invent a cancellation the runtime did not report.
  if (opts.isInterrupting && !opts.forced && opts.survivedInterrupt !== false) return 'await-replay';
  // The receipt explicitly says this in-flight UUID did not survive the interrupt.
  if (opts.isInterrupting && !opts.forced) return 'drop';
  // Force-send: explicit user intent to interrupt and process this item now.
  if (opts.forced) return opts.hasMeta ? 'surface' : 'noop';
  // Natural completion is not an SDK consumption ack. Keep the pill queued until
  // SDKUserMessageReplay or a later assistant-turn signal confirms consumption.
  return 'await-replay';
}

export function decideInFlightCancelSettlement(result: InFlightAsyncCancelResult): InFlightCancelSettlement {
  const cancelled = result === 'cancelled';
  return {
    cancelled,
    removePendingRequest: cancelled,
    clearSlot: cancelled,
    broadcastCancelled: cancelled,
    promoteNext: cancelled,
  };
}

export function terminalEventMatchesInFlight(opts: {
  currentQueueId: string | null;
  isInterrupting: boolean;
  interruptTargetQueueId: string | null;
}): boolean {
  if (!opts.currentQueueId) return false;
  if (!opts.isInterrupting) return true;
  return opts.interruptTargetQueueId === opts.currentQueueId;
}

/** `interrupt_receipt_v1` payload — the UUIDs that survived this interrupt. */
export type InterruptReceipt = { still_queued?: readonly string[] };

/**
 * Reconcile the narrow result-before-interrupt-receipt race.
 *
 * `decideInFlightActionOnResult` preserves the item while the receipt is still
 * unknown. If the receipt then arrives and explicitly omits that exact UUID, the
 * preserved pill must be cancelled at the queue owner — otherwise the
 * conservative preserve above would strand it forever.
 */
export function shouldDropInFlightAfterLateInterruptReceipt(opts: {
  /** Did this interrupt's `result` already claim the terminal before the receipt landed? */
  postInterruptOutcome: 'result-claimed' | 'session-ended' | null;
  interruptTargetQueueId: string | null;
  currentQueueId: string | null;
  stillQueued: ReadonlySet<string>;
}): boolean {
  return opts.postInterruptOutcome === 'result-claimed'
    && opts.interruptTargetQueueId !== null
    && opts.currentQueueId === opts.interruptTargetQueueId
    && !opts.stillQueued.has(opts.interruptTargetQueueId);
}
