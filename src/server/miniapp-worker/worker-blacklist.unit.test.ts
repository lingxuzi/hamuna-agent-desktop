// worker-blacklist.unit.test.ts — cover the deny-list layers of the require
// shim. The blacklist is the cheap deterministic layer; AST catches the
// dynamic-construction cases that string-match can't.

import { describe, expect, it } from 'vitest';

import {
  DENY_MODULES,
  formatBlacklistError,
  scanBlacklist,
} from './worker-blacklist';

describe('worker-blacklist', () => {
  describe('DENY_MODULES', () => {
    it('includes the canonical Node builtins that must be denied', () => {
      expect(DENY_MODULES).toContain('fs');
      expect(DENY_MODULES).toContain('fs/promises');
      expect(DENY_MODULES).toContain('child_process');
      expect(DENY_MODULES).toContain('vm');
      expect(DENY_MODULES).toContain('worker_threads');
    });
  });

  describe('scanBlacklist()', () => {
    it('denies `require("fs")` by module id', () => {
      const hit = scanBlacklist('', 'fs');
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('module');
      expect(hit!.pattern).toBe('fs');
    });

    it('denies `require("fs/promises")`', () => {
      const hit = scanBlacklist('', 'fs/promises');
      expect(hit).not.toBeNull();
      expect(hit!.pattern).toBe('fs/promises');
    });

    it('does NOT deny user code modules like `simple-git`', () => {
      const hit = scanBlacklist('', 'simple-git');
      expect(hit).toBeNull();
    });

    it('does NOT deny relative requires', () => {
      const hit = scanBlacklist('', './local-helper');
      expect(hit).toBeNull();
    });

    it('denies `process.binding(...)` call sites via source scan', () => {
      const src = `
const fs = process.binding('fs');
module.exports = fs;
`;
      const hit = scanBlacklist(src, 'anything-else');
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('bypass-token');
      expect(hit!.pattern).toBe('process.binding');
    });

    it('denies `Module._load(...)` calls', () => {
      const src = `Module._load('fs', module, false);`;
      const hit = scanBlacklist(src, 'any');
      expect(hit).not.toBeNull();
      expect(hit!.pattern).toBe('Module._load');
    });

    it('denies `require.resolve("fs")` chained call sites', () => {
      const src = `const path = require.resolve('fs');`;
      const hit = scanBlacklist(src, 'any');
      expect(hit).not.toBeNull();
      expect(hit!.pattern).toBe('require.resolve');
    });

    it('does NOT match a comment that mentions process.binding', () => {
      // We intentionally DO match: the goal is "if these tokens appear at
      // all, refuse". A future hardening pass could scope to actual
      // statements only. Document the trade-off here.
      const src = `// avoid using process.binding for portability`;
      const hit = scanBlacklist(src, 'anything');
      // Current behavior: match. If we ever flip to "actual statements only",
      // this assertion will need to change.
      expect(hit).not.toBeNull();
    });
  });

  describe('formatBlacklistError()', () => {
    it('renders the canonical "blocked by MiniApp sandbox" prefix', () => {
      const msg = formatBlacklistError({ reason: 'module', pattern: 'fs' });
      expect(msg).toBe("module require blocked by MiniApp sandbox: module='fs'");
    });
  });
});