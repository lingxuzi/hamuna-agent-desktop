import { describe, expect, it } from 'vitest';

import { shouldDebounceAutoVerify, MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY } from './apiKeyAutoVerify';

describe('shouldDebounceAutoVerify', () => {
  it('empty new key never verifies', () => {
    expect(shouldDebounceAutoVerify('abcdef', '')).toBe(false);
    expect(shouldDebounceAutoVerify('', '')).toBe(false);
  });

  describe('issue #306: backspacing an expired key', () => {
    it('skips verify on every backspace as length shrinks', () => {
      const original = 'sk-expired-xxxxx';
      let cur = original;
      const decisions: boolean[] = [];
      while (cur.length > 0) {
        const next = cur.slice(0, -1);
        decisions.push(shouldDebounceAutoVerify(cur, next));
        cur = next;
      }
      // Every single backspace must be a "skip" so no verify cycle fires.
      expect(decisions.every(d => d === false)).toBe(true);
    });
  });

  describe('growing the key (paste / typing forward)', () => {
    it('paste from empty triggers verify', () => {
      expect(shouldDebounceAutoVerify('', 'sk-new-key-pasted-in')).toBe(true);
    });
    it('character append triggers verify', () => {
      expect(shouldDebounceAutoVerify('sk-1234', 'sk-12345')).toBe(true);
    });
  });

  describe('equal-length replacement (select-all + paste)', () => {
    it('still triggers verify — user explicitly replaced the key', () => {
      expect(shouldDebounceAutoVerify('aaaaaaaa', 'bbbbbbbb')).toBe(true);
    });
  });

  describe('shorter replacement (review): select-all + paste of a shorter valid key', () => {
    it('triggers verify — shorter but content differs (not a tail deletion)', () => {
      // The old "any length decrease = deletion" rule wrongly suppressed this.
      expect(shouldDebounceAutoVerify('sk-old-longer-key-aaaa', 'sk-new-short')).toBe(true);
    });
    it('mid-string edit shrinking the key still verifies (not a prefix of old)', () => {
      expect(shouldDebounceAutoVerify('abcdefghij', 'abXYefXY')).toBe(true);
    });
    it('still skips a genuine tail trim (prefix of old, shorter)', () => {
      expect(shouldDebounceAutoVerify('sk-12345', 'sk-123')).toBe(false);
    });
  });

  describe('issue "every character triggers a check" (select-all+paste prefix flood)', () => {
    // User clears the old key with select-all+delete, then password-manager /
    // paste-as-you-typer fires one input event per character. The intermediate
    // prefixes are "growing" changes against a non-empty prevKey, so the #306
    // rule below doesn't catch them. The min-length floor (gated on prevKey
    // being non-empty) treats every intermediate prefix as mid-typing and skips
    // verify until the user has typed/pasted enough to cross the floor.
    it('skips every keystroke while growing a new key against a non-empty prevKey', () => {
      let cur = 'sk-exit-non-empty-prev-key-aaaaaaa';
      const decisions: boolean[] = [];
      // Simulate per-character paste / pwmgr fill of a 25-char key after the
      // user clears by select-all+delete (but in this branch we test against an
      // existing prevKey; the rule explicitly fires here).
      const target = 'sk-new-1234567890abcde';
      for (let i = 1; i <= target.length; i++) {
        const next = target.slice(0, i);
        decisions.push(shouldDebounceAutoVerify(cur, next));
        cur = next;
      }
      // First MIN-1 keystrokes must all be skips (mid-typing); crossing the
      // floor flips to verify.
      const beforeFloor = decisions.slice(0, MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY - 1);
      expect(beforeFloor.every(d => d === false)).toBe(true);
      expect(decisions[MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY - 1]).toBe(true);
    });

    it('skips verify for any new key shorter than the floor WHEN prevKey is non-empty', () => {
      expect(shouldDebounceAutoVerify('sk-old-key-aaaaaaaaa', 's')).toBe(false);
      expect(shouldDebounceAutoVerify('sk-old-key-aaaaaaaaa', 'sk-')).toBe(false);
      expect(shouldDebounceAutoVerify('sk-old-key-aaaaaaaaa', '1234567')).toBe(false); // floor-1
    });

    it('still verifies a single paste from empty even if shorter than the floor (custom relay keys)', () => {
      // User cleared by select-all+delete (prevKey="" after the clear), then
      // pasted a complete short key as a single input event. The whole-key
      // paste must verify, not be silently suppressed by the floor.
      expect(shouldDebounceAutoVerify('', 's')).toBe(true);
      expect(shouldDebounceAutoVerify('', 'sk-')).toBe(true);
      expect(shouldDebounceAutoVerify('', '1234567')).toBe(true); // floor-1, still verifies from empty
    });

    it('still verifies a single paste ≥ min-length from empty (whole-key paste)', () => {
      expect(shouldDebounceAutoVerify('', 'sk-pasted-key-1234567890abcdef')).toBe(true);
    });

    it('floor boundary with prevKey non-empty: 7 chars → skip; 8 chars → verify', () => {
      const below = 'x'.repeat(MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY - 1);
      const at = 'x'.repeat(MIN_API_KEY_LENGTH_FOR_AUTO_VERIFY);
      const prev = 'sk-old-existing-key-aaaaaaaaaaaa';
      expect(shouldDebounceAutoVerify(prev, below)).toBe(false);
      expect(shouldDebounceAutoVerify(prev, at)).toBe(true);
    });
  });
});
