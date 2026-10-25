// browser-search-gate.ts — "search with the embedded browser" policy
//
// In a Chat the Agent must not reach for the SDK's WebSearch / WebFetch
// tools: they hit the web from the Sidecar's network path, which misses
// everything the user's own browser session can see (region gating,
// bot challenges, anything behind a login). The app ships an embedded
// browser the Agent can drive through `hamuna browser …`; a search there
// runs in the user's real window.
//
// The gate is scoped to the Chat scenario on purpose. A cron job, an IM
// bot, or a registered Agent has no user window to drive — denying
// WebSearch there would leave it with no way to look anything up at all.

import type { InteractionScenario } from '../system-prompt';

/** The SDK tools that would bypass the embedded browser. */
export const BROWSER_SEARCH_GATED_TOOLS = ['WebSearch', 'WebFetch'] as const;

export type BrowserSearchGatedTool = typeof BROWSER_SEARCH_GATED_TOOLS[number];

/**
 * Does this scenario drive the user's embedded browser?
 *
 * Only the Chat does: `surface: 'chat'` is the Chat's own browser panel,
 * which the user can see. `cron` / `im` / `agent-channel` / `registeredAgent`
 * have no browser window to drive, and the desktop family has two more
 * surfaces that aren't the Chat:
 *
 * - `surface: 'floating-ball'` — the companion window. It is a desktop
 *   surface, but the browser panel belongs to the Chat tab, not to it.
 * - `surface: undefined` — every desktop turn that isn't a Chat turn:
 *   the MiniApp agent, the memory update, and the Goal continuation all
 *   report a bare `{ type: 'desktop' }`, and none of them can open the
 *   Chat's browser panel. Gating them would deny WebSearch to an agent
 *   that has no way to reach the embedded browser at all.
 *
 * The `surface: 'chat'` producer is `desktopScenarioForAnalyticsSource` in
 * server/index.ts, which every Chat `/chat/send` goes through.
 */
export function isBrowserSearchGatedScenario(scenario: InteractionScenario): boolean {
  return scenario.type === 'desktop' && scenario.surface === 'chat';
}

/**
 * Should `toolName` be denied in this scenario?
 *
 * Returns false for every non-Chat scenario and for every tool that is not
 * one of the two gated tools.
 */
export function shouldDenyForBrowserSearch(
  toolName: string,
  scenario: InteractionScenario,
): boolean {
  if (!isBrowserSearchGatedScenario(scenario)) return false;
  return (BROWSER_SEARCH_GATED_TOOLS as readonly string[]).includes(toolName);
}

/**
 * The message the model sees when the gate denies a tool.
 *
 * It has to name the replacement command — a deny without a next step just
 * makes the model retry the same call or fall back to guessing.
 */
export function browserSearchDenyReason(toolName: string): string {
  const command = toolName === 'WebSearch'
    ? 'hamuna browser search "<query>"'
    : 'hamuna browser open <url> 然后 hamuna browser read';
  return `Chat 场景下请使用内置浏览器查询，不要使用 ${toolName} 工具。改用 ${command}——它在你用户可见的那个浏览器窗口里跑，能拿到用户登录态和需要 JS 渲染的页面。`;
}
