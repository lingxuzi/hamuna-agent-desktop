import { describe, expect, it } from 'vitest';

import {
  resolvePathTemplate,
  resolvePathList,
  validatePathTemplatePrefix,
  WORKSPACE_TEMPLATE,
  USER_SELECTED_TEMPLATE,
} from './path-templates';

describe('path-templates', () => {
  describe('resolvePathTemplate', () => {
    it('resolves {appdata} to the app data dir', () => {
      const ctx = { appdataDir: '/home/u/.hamuna/miniapps/git-graph' };
      expect(resolvePathTemplate('{appdata}/data.db', ctx).resolved).toBe(
        '/home/u/.hamuna/miniapps/git-graph/data.db',
      );
    });

    it('resolves {workspace} when workspaceDir provided', () => {
      const ctx = {
        appdataDir: '/home/u/.hamuna/miniapps/x',
        workspaceDir: '/home/u/proj',
      };
      expect(resolvePathTemplate('{workspace}/src/**', ctx).resolved).toBe('/home/u/proj/src/**');
    });

    it('throws when {workspace} used without workspaceDir', () => {
      const ctx = { appdataDir: '/home/u/.hamuna/miniapps/x' };
      expect(() => resolvePathTemplate('{workspace}/**', ctx)).toThrow(WORKSPACE_TEMPLATE);
    });

    it('resolves {user-selected} to first user-selected dir', () => {
      const ctx = {
        appdataDir: '/home/u/.hamuna/miniapps/x',
        userSelectedDirs: ['/tmp/downloads', '/tmp/docs'],
      };
      expect(resolvePathTemplate('{user-selected}/photos/**', ctx).resolved).toBe(
        '/tmp/downloads/photos/**',
      );
    });

    it('throws when {user-selected} used without user-selected dirs', () => {
      const ctx = { appdataDir: '/home/u/.hamuna/miniapps/x' };
      expect(() => resolvePathTemplate('{user-selected}/**', ctx)).toThrow(USER_SELECTED_TEMPLATE);
    });

    it('passes literal paths through with template=null', () => {
      const ctx = { appdataDir: '/home/u/.hamuna/miniapps/x' };
      const r = resolvePathTemplate('/etc/passwd', ctx);
      expect(r.resolved).toBe('/etc/passwd');
      expect(r.template).toBe(null);
    });
  });

  describe('resolvePathList', () => {
    it('returns empty array for undefined', () => {
      expect(resolvePathList(undefined, { appdataDir: '/a' })).toEqual([]);
    });

    it('maps every entry', () => {
      const ctx = {
        appdataDir: '/app',
        workspaceDir: '/ws',
      };
      const out = resolvePathList(['{appdata}/**', '{workspace}/**'], ctx);
      expect(out.map((r) => r.resolved)).toEqual(['/app/**', '/ws/**']);
    });
  });

  describe('validatePathTemplatePrefix', () => {
    it('returns null for known template prefix', () => {
      expect(validatePathTemplatePrefix('{appdata}/**')).toBe(null);
    });

    it('returns error for hard path', () => {
      const err = validatePathTemplatePrefix('~/Desktop/**');
      expect(err).toContain('must start with one of');
    });
  });
});