/**
 * Unit tests for the Launcher/TaskCenter → Chat launch-field builder.
 *
 * The D1 invariant (non-empty sessionId + explicit disposition) is the
 * contract buildChatFlipPatch enforces downstream; buildLaunchFields is where
 * the `pending-<tabId>` placeholder is minted for a new session vs a real
 * history sessionId for resume. Purely tested — no sidecar, no hook mount.
 */
import { describe, expect, it } from 'vitest';

import { createNewTab } from '@/types/tab';
import type { Project } from '../../shared/config-types';
import { buildLaunchFields } from './useChatLaunchV2';

const tab = createNewTab();

/** Minimal Project — buildLaunchFields only reads project.path. */
function project(path: string): Project {
  return { path, name: 'alpha', id: 'p1', providerId: 'builtin', permissionMode: 'default' } as unknown as Project;
}

describe('buildLaunchFields', () => {
  it('mints a pending-<tabId> placeholder for a new-session launch', () => {
    const fields = buildLaunchFields(tab, {
      project: project('/work/alpha'),
    });
    expect(fields.sessionId).toBe(`pending-${tab.id}`);
    expect(fields.sidecarConfigDisposition).toBe('pending');
    expect(fields.agentDir).toBe('/work/alpha');
    expect(fields.title).toBe('alpha');
    expect(fields.initialMessage).toBeUndefined();
  });

  it('preserves a real sessionId for resume', () => {
    const fields = buildLaunchFields(tab, {
      project: project('/work/alpha'),
      sessionId: 'sess_real_123',
    });
    expect(fields.sessionId).toBe('sess_real_123');
  });

  it('passes through the initialMessage from a launcher launch', () => {
    const fields = buildLaunchFields(tab, {
      project: project('/work/alpha'),
      initialMessage: { text: 'build the login page' },
    });
    expect(fields.initialMessage?.text).toBe('build the login page');
  });

  it('uses workspaceId as agentDir for a discuss launch and drops tags', () => {
    const fields = buildLaunchFields(tab, {
      thoughtId: 't1',
      content: 'refactor x',
      tags: ['refactor', 'backend'],
      workspaceId: '/work/omega',
    });
    expect(fields.agentDir).toBe('/work/omega');
    expect(fields.title).toBe('omega');
    // tags are thought metadata, not an InitialMessage field — only text goes.
    expect(fields.initialMessage?.text).toBe('refactor x');
    expect(fields.initialMessage && 'tags' in fields.initialMessage).toBe(false);
    expect(fields.sessionId).toBe(`pending-${tab.id}`);
  });
});
