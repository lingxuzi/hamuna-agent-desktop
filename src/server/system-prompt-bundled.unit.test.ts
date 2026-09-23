import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/runtime')>();
  return {
    ...actual,
    getBundledResourcePath: vi.fn(),
  };
});

import { buildSystemPromptAppend, type InteractionScenario, type SystemPromptOptions } from './system-prompt';
import { getBundledResourcePath } from './utils/runtime';

const desktopScenario: InteractionScenario = { type: 'desktop' };
const floatingBallScenario: InteractionScenario = { type: 'desktop', surface: 'floating-ball' };
const imScenario: InteractionScenario = { type: 'im', platform: 'feishu', sourceType: 'private' };
const registeredAgentScenario: InteractionScenario = {
  type: 'registeredAgent',
  platform: 'space',
  spaceId: 'space-42',
  registeredAgentId: 'agent-7',
};

const baseOptions: SystemPromptOptions = { runtime: 'builtin', cliToolsEnabled: true };

describe('buildSystemPromptAppend with bundled global.md', () => {
  let mockFilePath: string | null = null;

  beforeEach(() => {
    vi.mocked(getBundledResourcePath).mockReset();
    mockFilePath = null;
  });

  afterEach(() => {
    rmSync(join(tmpdir(), 'hamuna-bundled-prompt-'), { recursive: true, force: true });
  });

  function mockBundledFile(content: string): void {
    const dir = mkdtempSync(join(tmpdir(), 'hamuna-bundled-prompt-'));
    const file = join(dir, 'global.md');
    writeFileSync(file, content);
    mockFilePath = file;
    vi.mocked(getBundledResourcePath).mockReturnValue(file);
  }

  it('returns rendered bundled content when the file is present', async () => {
    mockBundledFile('# HamunaAgent 全局\nRuntime: {{runtimeName}}\n');
    const prompt = await buildSystemPromptAppend(desktopScenario, baseOptions);
    expect(prompt).toContain('HamunaAgent 全局');
    expect(prompt).toContain('Runtime: HamunaAgent 内置 Claude Agent SDK');
  });

  it('falls back to inline templates when bundled resource path is missing', async () => {
    vi.mocked(getBundledResourcePath).mockReturnValue(null);
    const prompt = await buildSystemPromptAppend(desktopScenario, baseOptions);
    expect(prompt).toContain('<hamuna-identity>');
    expect(prompt).toContain('HamunaAgent 内置 Claude Agent SDK');
  });

  it('falls back to inline templates when bundled file is empty', async () => {
    mockBundledFile('   \n\n');
    const prompt = await buildSystemPromptAppend(desktopScenario, baseOptions);
    expect(prompt).toContain('<hamuna-identity>');
    expect(prompt).not.toContain('HamunaAgent 全局');
  });

  it('renders IM channel template when scenario is im (fallback path)', async () => {
    vi.mocked(getBundledResourcePath).mockReturnValue(null);
    const prompt = await buildSystemPromptAppend(imScenario, baseOptions);
    expect(prompt).toContain('<hamuna-interaction-channel>');
    expect(prompt).toContain('飞书');
    expect(prompt).toContain('私聊模式');
    expect(prompt).toContain('<hamuna-heartbeat-instructions>');
  });

  it('renders registeredAgent identity with space + agent ids (fallback path)', async () => {
    vi.mocked(getBundledResourcePath).mockReturnValue(null);
    const prompt = await buildSystemPromptAppend(registeredAgentScenario, baseOptions);
    expect(prompt).toContain('space-id="space-42" registered-agent-id="agent-7"');
    expect(prompt).toContain('<registered-agent-instruction>');
  });

  it('renders floating-ball template only for floating surface (fallback path)', async () => {
    vi.mocked(getBundledResourcePath).mockReturnValue(null);
    const chatPrompt = await buildSystemPromptAppend({ type: 'desktop' }, baseOptions);
    expect(chatPrompt).not.toContain('<hamuna-floating-ball-instructions>');

    const ballPrompt = await buildSystemPromptAppend(floatingBallScenario, baseOptions);
    expect(ballPrompt).toContain('<hamuna-floating-ball-instructions>');
    expect(ballPrompt).toContain('HamunaAgent desktop floating window');
  });

  it('reads bundled file fresh on every call (no cache)', async () => {
    mockBundledFile('version-1\n');
    const first = await buildSystemPromptAppend(desktopScenario, baseOptions);
    expect(first).toContain('version-1');

    // Simulate developer editing the bundled file between queries.
    writeFileSync(mockFilePath!, 'version-2\n');
    const second = await buildSystemPromptAppend(desktopScenario, baseOptions);
    expect(second).toContain('version-2');
    expect(second).not.toContain('version-1');
  });

  // Suppress unused-var noise: the var is held by mockBundledFile for the
  // second test to mutate.
  void mockFilePath;
});