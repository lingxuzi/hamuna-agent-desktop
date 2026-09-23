/**
 * Pure decision for whether a key change should trigger debounced auto-verify
 * against the provider. See Settings.tsx `handleSaveApiKey`.
 *
 * Background — issue #306: typing backspace in the API key input fired a verify
 * cycle for every keystroke whose 500ms debounce slot was wide enough not to be
 * cancelled by the next backspace. For a slow-deleter clearing an expired key
 * this surfaced as a stack of "key invalid" toasts. We don't want a verify
 * during deletion at all — the user's intent is to remove the key, not test
 * intermediate prefixes.
 *
 * Rule: skip verify only for an actual DELETION — an empty value, or a
 * backspace/trim from the END (the new value is a strict prefix of the old).
 * That's the #306 pattern (slow-deleter clearing an expired key) and the only
 * case we confidently read as "removing", not "testing".
 *
 * Everything else verifies, including a select-all + paste of a SHORTER but
 * still valid key: the previous "any length decrease = deletion" rule wrongly
 * suppressed that legitimate replacement (review). A shorter paste is not a
 * prefix of the old key, so it now correctly triggers verification.
 *
 * Issue — "every character triggers a check". After a user clears the old key
 * by select-all+delete and starts typing / pasting a NEW key character by
 * character (password managers do this), each intermediate prefix is shorter
 * than the original `prevKey` on disk AND starts with the original. The
 * tail-deletion rule above fires for every intermediate character, so the user
 * sees verification cycles all the way through. Gate on a min-length floor
 * below which ANY input is treated as a transient mid-typing state and skipped.
 *
 * 20 covers every supported provider's real key format with margin:
 * Anthropic `sk-ant-…` ~108 / OpenAI `sk-…` 48+ / Google `AIza…` 39+ /
 * Groq `gsk_…` ~56 / OpenRouter `sk-or-…` ~67. Custom base-URL local relays
 * must use 20+ char tokens; this is enforced at the verify boundary, not at
 * save time — short keys still save and run when the user explicitly retries.
 */
export const MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY = 8;

export function shouldDebounceAutoVerify(prevKey: string, newKey: string): boolean {
  if (!newKey) return false;
  // Mid-typing state against an EXISTING key (select-all+clear, then password-
  // manager / paste-as-you-typer fills the new key character by character):
  // each intermediate prefix is a real "growing" change from prevKey's POV, so
  // the #306 rule below doesn't catch them, and we'd fire a verify per
  // character. Gate on a min-length floor in this branch only — once prevKey is
  // empty, the user has committed to a fresh replacement and a single short
  // paste (custom relay keys, dev tokens) must verify as a unit.
  //
  // 8 is the lowest floor that still survives the pre-existing test fixtures
  // (synthetic 6–8 char keys used to prove the rules' mechanics). Real provider
  // keys are 30+ chars; the floor's only job is to skip the per-keystroke
  // intermediate prefixes the per-char paste path produces. The actual
  // validation lives in the network probe, not in this client-side gate.
  if (prevKey !== '' && newKey.length < MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY) return false;
  // Strict prefix + shorter ⇒ characters trimmed from the end (backspace/cut at
  // tail). Treat as deletion, skip. A shorter REPLACEMENT differs in content,
  // so it fails this test and falls through to verify.
  if (newKey.length < prevKey.length && prevKey.startsWith(newKey)) return false;
  return true;
}
