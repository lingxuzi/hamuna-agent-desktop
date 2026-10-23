import { describe, expect, it } from 'vitest';

import type { SessionMetadata } from '@/api/sessionClient';
import type { Project } from '@/config/types';
import { groupSessionsByProject } from './sidebarWorkspaceTree';

function project(id: string, path: string): Project {
  return { id, name: id, path } as Project;
}

function session(id: string, agentDir: string, lastActiveAt = '2026-01-01T00:00:00.000Z'): SessionMetadata {
  return { id, agentDir, title: id, lastActiveAt } as SessionMetadata;
}

describe('groupSessionsByProject', () => {
  it('buckets sessions by owning project and keeps recency order', () => {
    const projects = [project('p1', '/w/one'), project('p2', '/w/two')];
    const sessions = [
      session('a', '/w/one', '2026-01-03T00:00:00.000Z'),
      session('b', '/w/two', '2026-01-02T00:00:00.000Z'),
      session('c', '/w/one', '2026-01-01T00:00:00.000Z'),
    ];

    const groups = groupSessionsByProject(sessions, projects);

    expect(groups.get('p1')?.map(s => s.id)).toEqual(['a', 'c']);
    expect(groups.get('p2')?.map(s => s.id)).toEqual(['b']);
  });

  it('drops sessions whose workspace is not in the project list', () => {
    const groups = groupSessionsByProject([session('orphan', '/w/gone')], [project('p1', '/w/one')]);
    expect(groups.size).toBe(0);
  });

  it('matches Windows-style paths regardless of separator (#320)', () => {
    const groups = groupSessionsByProject(
      [session('a', 'C:\\Users\\me\\proj')],
      [project('p1', 'C:/Users/me/proj')],
    );
    expect(groups.get('p1')?.map(s => s.id)).toEqual(['a']);
  });
});
