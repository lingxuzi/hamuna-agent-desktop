import { describe, expect, it } from 'vitest';

import {
  KNOWN_TEMPLATES,
  validatePathTemplatePrefix,
  APPDATA_TEMPLATE,
  WORKSPACE_TEMPLATE,
} from './path-templates';

// This module validates prefixes only. Resolution lives in
// `src/server/miniapp-app-dispatch.ts::expandAuthorPath`, which is covered by
// miniapp-fs-path-template.integration.test.ts against the real sidecar. The
// tests that used to sit here exercised a second, caller-less resolver -- one
// whose `{user-selected}` branch made a capability look supported that the
// runtime cannot perform.
describe('path-templates', () => {
  describe('KNOWN_TEMPLATES', () => {
    it('lists exactly the templates the sidecar can expand', () => {
      expect([...KNOWN_TEMPLATES]).toEqual([APPDATA_TEMPLATE, WORKSPACE_TEMPLATE]);
    });

    it('does not advertise {user-selected}, which no resolver implements', () => {
      // Guards the specific trap: `expandAuthorPath` returns null for it, so
      // listing it here would let meta.json validate a declaration that every
      // app.fs.* call then rejects with a confusing path-shaped error.
      expect(KNOWN_TEMPLATES).not.toContain('{user-selected}');
      expect(validatePathTemplatePrefix('{user-selected}/**')).toContain(
        'must start with one of',
      );
    });
  });

  describe('validatePathTemplatePrefix', () => {
    it('accepts both known template prefixes', () => {
      expect(validatePathTemplatePrefix('{appdata}/**')).toBe(null);
      expect(validatePathTemplatePrefix('{workspace}/**')).toBe(null);
      // Bare token with no suffix is still a valid prefix.
      expect(validatePathTemplatePrefix('{appdata}')).toBe(null);
    });

    it('rejects a hard path', () => {
      const err = validatePathTemplatePrefix('~/Desktop/**');
      expect(err).toContain('must start with one of');
    });

    it('rejects a template that is not at the start', () => {
      // Prefix means prefix: a template in the middle is a literal string that
      // happens to contain braces, and must not be mistaken for an expandable
      // declaration.
      expect(validatePathTemplatePrefix('/abs/{appdata}/**')).toContain(
        'must start with one of',
      );
    });

    it('names every supported template in the error', () => {
      const err = validatePathTemplatePrefix('/etc/**') ?? '';
      expect(err).toContain(APPDATA_TEMPLATE);
      expect(err).toContain(WORKSPACE_TEMPLATE);
    });
  });
});