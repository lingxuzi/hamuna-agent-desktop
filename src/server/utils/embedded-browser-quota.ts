// embedded-browser-quota.ts — how many times the embedded browser must fail
// before Playwright becomes available.
//
// WHY A SEPARATE MODULE
// ---------------------
// Three modules need this number and they sit on both sides of an existing
// import cycle: `browser-api.ts` increments it, `agent-session.ts` reads it in
// the PreToolUse hook, and neither may import the other (agent-session →
// session-engine/selector → agent-session is already a cycle). Keeping the
// state in a leaf module with no imports is what makes both legal.
//
// WHY MODULE-LEVEL, NOT PER-SESSION
// ---------------------------------
// A Sidecar owns exactly one Session (1:1), and the embedded browser is owned
// by that Session. So process-level state IS session-level state here. It
// survives a pre-warm / session-id upgrade, which is what we want: the same
// Chat tab keeps the same browser, and resetting the count on an id upgrade
// would hand Playwright back for free.
//
// WHAT COUNTS AS A FAILURE
// ------------------------
// Only `callBrowser`'s transport-level failure (`resp.ok !== true`). Argument
// validation ("a search query is required") happens before the call and never
// reaches here — a model typo must not spend the budget. A successful call of
// ANY kind resets to zero, so the rule is "three CONSECUTIVE failures".

/** How many consecutive embedded-browser failures unlock Playwright. */
export const PLAYWRIGHT_FALLBACK_THRESHOLD = 3;

let consecutiveFailures = 0;

/** Record one embedded-browser call outcome. Success resets the streak. */
export function recordEmbeddedBrowserOutcome(ok: boolean): void {
  consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
}

/** Current consecutive failure streak (0..n). */
export function getConsecutiveBrowserFailures(): number {
  return consecutiveFailures;
}

/** Has the streak reached the point where Playwright is sanctioned? */
export function isPlaywrightFallbackUnlocked(): boolean {
  return consecutiveFailures >= PLAYWRIGHT_FALLBACK_THRESHOLD;
}

/** Test / session-teardown hook. */
export function resetEmbeddedBrowserQuota(): void {
  consecutiveFailures = 0;
}
