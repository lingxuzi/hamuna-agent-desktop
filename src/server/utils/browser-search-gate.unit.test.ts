import { describe, expect, it } from 'vitest';

import {
  BROWSER_SEARCH_GATED_TOOLS,
  browserSearchDenyReason,
  isBrowserSearchGatedScenario,
  shouldDenyForBrowserSearch,
} from './browser-search-gate';
import type { InteractionScenario } from '../system-prompt';

// The Chat declares itself with `surface: 'chat'` — that is the ONLY surface
// that owns the browser panel the user can see.
const chat: InteractionScenario = { type: 'desktop', surface: 'chat' };
const floatingBall: InteractionScenario = { type: 'desktop', surface: 'floating-ball' };
// A bare `{ type: 'desktop' }` is what every NON-Chat desktop turn reports
// (MiniApp agent, memory update, Goal continuation) — it has no browser panel.
const bareDesktop: InteractionScenario = { type: 'desktop' };
const cron: InteractionScenario = { type: 'cron', taskId: 't1', intervalMinutes: 5, aiCanExit: false };
const im: InteractionScenario = { type: 'im', platform: 'feishu', sourceType: 'private' };
const registeredAgent: InteractionScenario = {
  type: 'registeredAgent',
  platform: 'space',
  spaceId: 's1',
  registeredAgentId: 'a1',
};
const agentChannel: InteractionScenario = { type: 'agent-channel', platform: 'wechat', sourceType: 'group' };

describe('browser search gate', () => {
  it('denies WebSearch and WebFetch in the Chat', () => {
    expect(shouldDenyForBrowserSearch('WebSearch', chat)).toBe(true);
    expect(shouldDenyForBrowserSearch('WebFetch', chat)).toBe(true);
  });

  it('leaves every other tool alone in the Chat', () => {
    expect(shouldDenyForBrowserSearch('Bash', chat)).toBe(false);
    expect(shouldDenyForBrowserSearch('Read', chat)).toBe(false);
  });

  it('does not gate the desktop surfaces that are not the Chat', () => {
    // The floating ball is a desktop surface, but the browser panel belongs to
    // the Chat tab — the floating ball cannot open it.
    expect(isBrowserSearchGatedScenario(floatingBall)).toBe(false);
    expect(shouldDenyForBrowserSearch('WebSearch', floatingBall)).toBe(false);
    expect(shouldDenyForBrowserSearch('WebFetch', floatingBall)).toBe(false);

    // A bare desktop scenario is a MiniApp / memory-update / Goal turn. Denying
    // WebSearch there would leave the agent with no lookup path at all.
    expect(isBrowserSearchGatedScenario(bareDesktop)).toBe(false);
    expect(shouldDenyForBrowserSearch('WebSearch', bareDesktop)).toBe(false);
    expect(shouldDenyForBrowserSearch('WebFetch', bareDesktop)).toBe(false);
  });

  it('does not gate the non-Chat scenarios — they have no browser window to drive', () => {
    for (const scenario of [cron, im, registeredAgent, agentChannel]) {
      expect(isBrowserSearchGatedScenario(scenario)).toBe(false);
      expect(shouldDenyForBrowserSearch('WebSearch', scenario)).toBe(false);
      expect(shouldDenyForBrowserSearch('WebFetch', scenario)).toBe(false);
    }
  });

  it('names the replacement command in the deny reason', () => {
    expect(browserSearchDenyReason('WebSearch')).toContain('hamuna browser search');
    expect(browserSearchDenyReason('WebFetch')).toContain('hamuna browser open');
    expect(browserSearchDenyReason('WebSearch')).toContain('WebSearch');
  });

  it('keeps the gated-tool list and the deny behaviour in step', () => {
    for (const tool of BROWSER_SEARCH_GATED_TOOLS) {
      expect(shouldDenyForBrowserSearch(tool, chat)).toBe(true);
    }
  });
});
