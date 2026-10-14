// Locks the priority registration of structural SSE events.
//
// SSE_EVENT_PRIORITIES is frozen plain data with no compile-time link to the
// events callers actually broadcast: an unregistered event silently falls back
// to DEFAULT_PRIORITY ('critical') and only surfaces as a runtime warning in the
// unified log, so a missing entry is invisible to typecheck, lint and tests.
// This guard is what makes that failure mode loud.

import { describe, expect, it } from 'vitest';
import { SSE_EVENT_PRIORITIES } from '../sse';

// Events that post-turn/structural side-effects broadcast. Kept explicit (not
// derived) — deriving it from the broadcast call sites is exactly the coupling
// this test is meant to replace.
const STRUCTURAL_EVENTS = [
  'chat:knowledge-updated',
  'chat:context-usage',
  'chat:agent-plan-update',
  'chat:message-complete',
  'chat:session-title-changed',
] as const;

describe('SSE_EVENT_PRIORITIES', () => {
  it.each(STRUCTURAL_EVENTS)('registers %s', event => {
    expect(SSE_EVENT_PRIORITIES[event]).toBeDefined();
  });

  it('keeps the knowledge dashboard snapshot latest-wins under backpressure', () => {
    // The renderer does setKnowledgeGraph/setKnowledgeExtracting on every event,
    // so an older queued graph must collapse to the newest rather than pile up.
    expect(SSE_EVENT_PRIORITIES['chat:knowledge-updated']).toBe('coalescible');
  });
});
