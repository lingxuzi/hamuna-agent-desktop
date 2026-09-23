import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/runtime')>();
  return {
    ...actual,
    getBundledResourcePath: vi.fn(),
  };
});

import { buildSystemPromptAppend } from './system-prompt';
import { getBundledResourcePath } from './utils/runtime';

describe('buildSystemPromptAppend floating-ball surface (fallback)', () => {
  beforeEach(() => {
    vi.mocked(getBundledResourcePath).mockReset().mockReturnValue(null);
  });

  it('adds floating-ball instructions only for the floating desktop surface', async () => {
    expect(await buildSystemPromptAppend({ type: 'desktop' })).not.toContain('<hamuna-floating-ball-instructions>');

    const prompt = await buildSystemPromptAppend({ type: 'desktop', surface: 'floating-ball' });
    expect(prompt).toContain('<hamuna-floating-ball-instructions>');
    expect(prompt).toContain('HamunaAgent desktop floating window');
    expect(prompt).toContain('Keep responses concise');
  });
});

describe('buildSystemPromptAppend registered Agent events (fallback)', () => {
  beforeEach(() => {
    vi.mocked(getBundledResourcePath).mockReset().mockReturnValue(null);
  });

  it('keeps action semantics open while binding the exact execution identity', async () => {
    const prompt = await buildSystemPromptAppend({
      type: 'registeredAgent',
      platform: 'space',
      spaceId: 'space-1',
      registeredAgentId: 'agent-1',
    });
    expect(prompt).toContain('space-id="space-1" registered-agent-id="agent-1"');
    expect(prompt).toContain('<registered-agent-instruction>');
    expect(prompt).toContain('<operating-guidance>');
    expect(prompt).toContain('不再行动、只评论或更新、claim 责任');
    expect(prompt).toContain('不存在由你调用的 ignore、handled 或 acknowledge 动作');
    expect(prompt).not.toContain('<cloud-issue-instruction>');
  });
});
