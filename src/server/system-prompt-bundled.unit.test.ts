import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/runtime')>();
  return {
    ...actual,
    getBundledTopLevelResourcePath: vi.fn(),
  };
});

import { buildSystemPromptAppend, type InteractionScenario, type SystemPromptOptions } from './system-prompt';
import { getBundledTopLevelResourcePath } from './utils/runtime';

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
    vi.mocked(getBundledTopLevelResourcePath).mockReset();
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
    vi.mocked(getBundledTopLevelResourcePath).mockReturnValue(file);
  }

  it('returns rendered bundled content when the file is present', async () => {
    mockBundledFile('# HamunaAgent 全局\nRuntime: {{runtimeName}}\n');
    const prompt = await buildSystemPromptAppend(desktopScenario, baseOptions);
    expect(prompt).toContain('HamunaAgent 全局');
    expect(prompt).toContain('Runtime: HamunaAgent 内置 Claude Agent SDK');
  });

  it('falls back to inline templates when bundled resource path is missing', async () => {
    vi.mocked(getBundledTopLevelResourcePath).mockReturnValue(null);
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
    vi.mocked(getBundledTopLevelResourcePath).mockReturnValue(null);
    const prompt = await buildSystemPromptAppend(imScenario, baseOptions);
    expect(prompt).toContain('<hamuna-interaction-channel>');
    expect(prompt).toContain('飞书');
    expect(prompt).toContain('私聊模式');
    expect(prompt).toContain('<hamuna-heartbeat-instructions>');
  });

  it('renders registeredAgent identity with space + agent ids (fallback path)', async () => {
    vi.mocked(getBundledTopLevelResourcePath).mockReturnValue(null);
    const prompt = await buildSystemPromptAppend(registeredAgentScenario, baseOptions);
    expect(prompt).toContain('space-id="space-42" registered-agent-id="agent-7"');
    expect(prompt).toContain('<registered-agent-instruction>');
  });

  it('renders floating-ball template only for floating surface (fallback path)', async () => {
    vi.mocked(getBundledTopLevelResourcePath).mockReturnValue(null);
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

  // ===== Nested {{#if}} =====
  //
  // bundled-prompts/global.md nests blocks: `botName` inside `platformLabel`,
  // `aiCanExit` inside `intervalText`. The original non-greedy regex matched
  // the INNER `{{/if}}` as the outer's, so every IM / cron prompt shipped
  // template syntax to the model — an orphaned `{{/if}}`, plus an unclosed
  // `{{#if botName}}` when the inner var was set. Silent: nothing threw, and
  // the flat (desktop-only) assertions all passed.

  const NESTED_IM = [
    '{{#if platformLabel}}',
    'via {{platformLabel}} in {{sourceTypeLabel}}.{{#if botName}} You are {{botName}}.{{/if}}',
    '{{else}}',
    'via desktop.',
    '{{/if}}',
  ].join('\n');

  it('resolves a nested if whose inner var is set (no leaked tags)', async () => {
    mockBundledFile(NESTED_IM);
    const prompt = await buildSystemPromptAppend(
      { type: 'im', platform: 'telegram', sourceType: 'private', botName: 'Ham' },
      baseOptions,
    );
    expect(prompt).toContain('via Telegram in 私聊模式. You are Ham.');
    expect(prompt).not.toContain('{{#if');
    expect(prompt).not.toContain('{{/if}}');
  });

  it('drops the nested branch when its inner var is unset', async () => {
    mockBundledFile(NESTED_IM);
    const prompt = await buildSystemPromptAppend(
      { type: 'im', platform: 'telegram', sourceType: 'private' },
      baseOptions,
    );
    expect(prompt).toContain('via Telegram in 私聊模式.');
    expect(prompt).not.toContain('{{#if');
    expect(prompt).not.toContain('{{/if}}');
  });

  it('resolves a nested if inside the else branch', async () => {
    mockBundledFile([
      '{{#if platformLabel}}IM path{{else}}',
      '{{#if floatingBallHint}}ball path{{else}}chat path{{/if}}',
      '{{/if}}',
    ].join('\n'));
    // desktop has no platformLabel, so the OUTER block takes its else branch —
    // which is where the nested block lives.
    const prompt = await buildSystemPromptAppend(desktopScenario, baseOptions);
    expect(prompt).toContain('chat path');
    expect(prompt).not.toContain('{{#if');
    expect(prompt).not.toContain('{{/if}}');
  });

  it('keeps the nested else-branch when its own var is set', async () => {
    mockBundledFile([
      '{{#if platformLabel}}IM path{{else}}',
      '{{#if floatingBallHint}}ball path{{else}}chat path{{/if}}',
      '{{/if}}',
    ].join('\n'));
    const prompt = await buildSystemPromptAppend(floatingBallScenario, baseOptions);
    expect(prompt).toContain('ball path');
    expect(prompt).not.toContain('chat path');
    expect(prompt).not.toContain('{{#if');
    expect(prompt).not.toContain('{{/if}}');
  });

  it('does not re-scan a substituted value as a template', async () => {
    // A scenario value that itself contains template syntax must survive
    // verbatim — vars are substituted once, after block resolution.
    mockBundledFile('bot={{botName}}\n');
    const prompt = await buildSystemPromptAppend(
      { type: 'im', platform: 'telegram', sourceType: 'private', botName: '{{#if runtimeName}}x{{/if}}' },
      baseOptions,
    );
    expect(prompt).toContain('bot={{#if runtimeName}}x{{/if}}');
  });

  it('leaves an unbalanced block verbatim instead of looping or throwing', async () => {
    mockBundledFile('head\n{{#if botName}}\nunclosed body\n');
    const prompt = await buildSystemPromptAppend(
      { type: 'im', platform: 'telegram', sourceType: 'private', botName: 'Ham' },
      baseOptions,
    );
    // Developer typo surfaces as-is rather than silently eating the prompt.
    expect(prompt).toContain('{{#if botName}}');
    expect(prompt).toContain('unclosed body');
  });

  // Suppress unused-var noise: the var is held by mockBundledFile for the
  // second test to mutate.
  void mockFilePath;
});

describe('getBundledTopLevelResourcePath (real dev layout)', () => {
  it('finds bundled-prompts/ at the repository root in dev mode', () => {
    // Re-import the real runtime module (not the one mocked above) by clearing
    // the mock and re-reading from the module cache.
    vi.doUnmock('./utils/runtime');
    // Re-import fresh: this gives us the real implementation.
    return import('./utils/runtime').then((realRuntime) => {
      const realPath = realRuntime.getBundledTopLevelResourcePath('bundled-prompts/global.md');
      expect(realPath).not.toBeNull();
      expect(realPath).toMatch(/bundled-prompts[\\/]global\.md$/);
    });
  });
});