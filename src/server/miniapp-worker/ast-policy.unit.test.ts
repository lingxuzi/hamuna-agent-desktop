// ast-policy.unit.test.ts — cover the AST-based fallback layer.
//
// String-match blacklist covers:
//   require('fs')
//   process.binding(...)
//
// AST fallback must catch dynamic string construction + dynamic import:
//   require('fs' + '/promises')
//   require(['fs', '/promises'].join(''))
//   import('fs' + '/promises')
//   new Function('return require')()('fs')
//   process["binding"]('fs')   (computed property — string-match misses)

import { describe, expect, it } from 'vitest';

import { formatAstError, scanAst } from './ast-policy';

describe('ast-policy', () => {
  describe('scanAst() — bypass-pattern coverage', () => {
    it('catches `require("fs" + "/promises")` (the PRD §13.8 canonical case)', () => {
      const src = `const fs = require('fs' + '/promises');`;
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('dynamic-require');
    });

    it('catches `require(["fs", "/promises"].join(""))`', () => {
      const src = `const fs = require(['fs', '/promises'].join(''));`;
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('dynamic-require');
    });

    it('catches `require(someVar)` (bare identifier)', () => {
      const src = `const fs = require(someVar);`;
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('dynamic-require');
    });

    it('catches dynamic import `import("fs" + "/promises")`', () => {
      const src = `const fs = await import('fs' + '/promises');`;
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('dynamic-import');
    });

    it('catches bare `import(someVar)` dynamic import', () => {
      const src = `const fs = await import(someVar);`;
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('dynamic-import');
    });

    it('catches `new Function("return require")()("fs")`', () => {
      const src = `
const fn = new Function('return require')();
const fs = fn('fs');
`;
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('function-constructor');
    });

    it('catches `process["binding"]("fs")` (computed property bypass)', () => {
      const src = `const fs = process['binding']('fs');`;
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('bypass-token-ast');
      expect(hit!.pattern).toBe('process.binding');
    });

    it('catches `Module._load("fs")` (computed)', () => {
      const src = `const fs = Module['_load']('fs');`;
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('bypass-token-ast');
      expect(hit!.pattern).toBe('Module._load');
    });

    it('does NOT flag legitimate code', () => {
      const src = `
import simpleGit from 'simple-git';
const sg = simpleGit('/tmp/repo');
export async function readLog(maxCount) {
  const log = await sg.log({ maxCount });
  return log.all.map((e) => e.hash);
}
`;
      expect(scanAst(src)).toBeNull();
    });

    it('does NOT flag dynamic-require when arg is a static template literal', () => {
      const src = "const x = require(`fs`);"; // no expressions
      expect(scanAst(src)).toBeNull();
    });

    it('fail-closed on parse error', () => {
      const src = `function {{`; // intentionally broken
      const hit = scanAst(src);
      expect(hit).not.toBeNull();
      expect(hit!.reason).toBe('parse-error');
    });
  });

  describe('formatAstError()', () => {
    it('renders the canonical prefix', () => {
      expect(formatAstError({ reason: 'dynamic-require', pattern: 'loc:1-30' })).toBe(
        'module require blocked by MiniApp sandbox: dynamic-require',
      );
    });
  });
});