/**
 * Unified system prompt assembly for HamunaAgent.
 *
 * Source of truth: bundled-prompts/global.md (developer-editable, Tauri-bundled
 * resource). The Sidecar locates it via `getBundledResourcePath(...)` which
 * handles both production (shipped inside the app bundle next to server-dist.js)
 * and dev (walked up from scriptDir to find src-tauri/resources/) layouts.
 *
 * Behaviour:
 *   - Read on every call (no cache) so developers can edit bundled-prompts/global.md
 *     and the next session query reflects the change without restarting the Sidecar.
 *   - Template syntax `{{varName}}` and `{{#if varName}}...{{else}}...{{/if}}`
 *     is rendered in-file by `renderTemplate` against a vars dict derived from
 *     the InteractionScenario + SystemPromptOptions.
 *   - If the bundled file is missing or empty, logs a warning at first call and
 *     falls back to the inline L1-L4 templates — production stays alive while the
 *     missing-resource bug is observable. This path only fires when the Tauri
 *     bundle step dropped the resource.
 */

import { readFile } from 'fs/promises';

import type { RuntimeType } from '../shared/types/runtime';
import type { OfficialToolId } from '../shared/official-tools';
import type { HostInteractionCapability } from '../shared/types/hostInteraction';
import { getBundledResourcePath } from './utils/runtime';
import { buildCliToolsAppend, buildWidgetSection, buildSessionInboxSection } from './system-prompt-cli-tools';

// ===== Scenario types =====

export type InteractionScenario =
  | { type: 'desktop'; surface?: 'chat' | 'floating-ball' }
  | { type: 'im'; platform: 'telegram' | 'feishu'; sourceType: 'private' | 'group'; botName?: string; hostInteraction?: HostInteractionCapability }
  | { type: 'agent-channel'; platform: string; sourceType: 'private' | 'group'; botName?: string; agentName?: string; hostInteraction?: HostInteractionCapability }
  | { type: 'cron'; taskId: string; intervalMinutes: number; aiCanExit: boolean }
  | {
      type: 'registeredAgent';
      platform: 'space';
      spaceId: string;
      registeredAgentId: string;
      sourceType?: 'issue-delivery';
    };

// ===== Runtime display name =====
function getRuntimeDisplayName(runtime: RuntimeType | undefined): string {
  switch (runtime) {
    case 'claude-code': return 'Anthropic Claude Code CLI';
    case 'codex':       return 'OpenAI Codex CLI';
    case 'gemini':      return 'Google Gemini CLI';
    case 'builtin':
    default:
      return 'HamunaAgent 内置 Claude Agent SDK';
  }
}

// ===== Inline fallback templates (only used when bundled file missing) =====

const FALLBACK_BASE_IDENTITY = `<hamuna-identity>
你正运行在 HamunaAgent —— 一款通用的桌面端 AI Agent 应用中。用户通过 HamunaAgent 调用你,
HamunaAgent 负责会话管理、工具权限、定时任务、IM Bot 集成、工作区文件访问等能力,
你则负责理解和执行用户的请求。

当前执行 Runtime: {{runtimeName}}

用户全局配置目录: ~/.hamuna
当对话涉及日期、时间或星期时,先用 Bash 执行 \`date\` 获取准确的当前时间再作判断——系统信息中的日期可能已过期。
</hamuna-identity>`;

const FALLBACK_CHANNEL_DESKTOP = `<hamuna-interaction-channel>
用户正通过 HamunaAgent 桌面客户端与你对话。
</hamuna-interaction-channel>`;

const FALLBACK_CHANNEL_IM = `<hamuna-interaction-channel>
你正通过 {{platformLabel}} 作为 IM 聊天机器人与用户对话，{{sourceTypeLabel}}。{{#if botName}}你的昵称为「{{botName}}」。{{/if}}
</hamuna-interaction-channel>`;

const FALLBACK_CRON_TASK = `<hamuna-cron-task-instructions>
你正处于心跳循环任务模式 (Task ID: {{taskId}})。每隔 {{intervalText}} 系统触发唤醒你一次。{{#if aiCanExit}}

如果任务目标已完全达成、或继续执行无意义/有害，请按下方 \`<hamuna-cli-cron-exit>\` 段落给出的 \`hamuna cron exit\` 命令结束任务。{{/if}}
</hamuna-cron-task-instructions>`;

const FALLBACK_HEARTBEAT = `<hamuna-heartbeat-instructions>
You will periodically receive heartbeat messages (a user message wrapped in tags like \`<HEARTBEAT>\nThis is a heartbeat from the system.\n……\n</HEARTBEAT>\`).
When you receive one, follow its instructions.
</hamuna-heartbeat-instructions>`;

const FALLBACK_REGISTERED_AGENT = `<hamuna-registered-agent-instructions space-id="{{spaceId}}" registered-agent-id="{{registeredAgentId}}">
你正作为绑定到当前 Session 的 HamunaAgent Registered Agent 处理 Space Issue 事件。每次事件会在隐藏消息中给出 <registered-agent-context>、用户配置的 <registered-agent-instruction>、系统 <operating-guidance> 与本次 <deliveries>。

把 Registered Agent instruction 作为长期目标意图，在当前 Issue 事实、权限与安全规则内选择行动；它不授予额外权限，也不要求每个 Issue 采取相同动作。可用结果包括不再行动、只评论或更新、claim 责任、继续已有工作，以及在真正完成后 complete。Delivery 运输确认由 HamunaAgent 自动完成，不存在由你调用的 ignore、handled 或 acknowledge 动作。

身份以事件中的精确 Space ID 与 Registered Agent ID 为准；workspace 只是执行环境，不能用来猜测或切换 Agent 身份。行动前通过 hamuna CLI 读取当前 Issue；本次 Delivery 元数据只解释唤醒原因，不是当前状态的第二真相源。
</hamuna-registered-agent-instructions>`;

const FALLBACK_FLOATING_BALL = `<hamuna-floating-ball-instructions>
You are talking with the user through the HamunaAgent desktop floating window.

This is a lightweight, immediate, desktop-adjacent entry point. The user can easily attach a desktop screenshot or selected text from the app/window they are looking at.

Keep responses concise and directly useful for this small-window interaction.
</hamuna-floating-ball-instructions>`;

const FALLBACK_BROWSER_STORAGE_STATE = `<hamuna-browser-storage-instructions>
当你在浏览器中执行了登录操作或用户帮你完成了登录（输入账号密码、OAuth 授权、扫码登录等），必须在登录成功后**立即**调用 browser_storage_state 工具将登录状态保存到 ~/.hamuna/browser-storage-state.json，然后再继续执行后续任务。这样即使后续任务中断或会话异常终止，登录态也不会丢失，后续对话可以复用。
</hamuna-browser-storage-instructions>`;

// ===== Variable replacement =====

function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  result = result.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (_, key, ifBlock, elseBlock) => vars[key] ? ifBlock : (elseBlock ?? '')
  );
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  return result;
}

// ===== Bundled resource loader =====

const BUNDLED_PROMPT_PATH = 'bundled-prompts/global.md';

// Warn-once guard so the fallback path doesn't spam the log on every query.
let warnedMissing = false;
async function loadBundledPrompt(): Promise<string | null> {
  const filePath = getBundledResourcePath(BUNDLED_PROMPT_PATH);
  if (!filePath) {
    if (!warnedMissing) {
      console.warn(`[system-prompt] bundled resource missing: ${BUNDLED_PROMPT_PATH}; falling back to inline templates`);
      warnedMissing = true;
    }
    return null;
  }
  try {
    const content = await readFile(filePath, 'utf-8');
    if (!content.trim()) {
      if (!warnedMissing) {
        console.warn(`[system-prompt] bundled prompt is empty at ${filePath}; falling back to inline templates`);
        warnedMissing = true;
      }
      return null;
    }
    return content;
  } catch (err) {
    if (!warnedMissing) {
      console.warn(`[system-prompt] failed to read bundled prompt at ${filePath}:`, err);
      warnedMissing = true;
    }
    return null;
  }
}

// ===== Main entry =====

export interface SystemPromptOptions {
  playwrightStorageEnabled?: boolean;
  runtime?: RuntimeType;
  cliToolsEnabled?: boolean;
  userCliToolsEnabled?: boolean;
  enabledOfficialToolIds?: readonly OfficialToolId[];
}

export async function buildSystemPromptAppend(scenario: InteractionScenario, options?: SystemPromptOptions): Promise<string> {
  const parts: string[] = [];
  const bundledContent = await loadBundledPrompt();

  const platformMap: Record<string, string> = { feishu: '飞书', telegram: 'Telegram', dingtalk: '钉钉' };
  const isIm = scenario.type === 'im' || scenario.type === 'agent-channel';
  const isFloatingBall = scenario.type === 'desktop' && scenario.surface === 'floating-ball';
  const isRegisteredAgent = scenario.type === 'registeredAgent';

  const platformLabel = isIm ? (platformMap[scenario.platform] ?? scenario.platform) : '';
  const sourceTypeLabel = isIm ? (scenario.sourceType === 'private' ? '私聊模式' : '群聊模式') : '';
  const intervalText = scenario.type === 'cron'
    ? (scenario.intervalMinutes >= 60
      ? `${Math.floor(scenario.intervalMinutes / 60)} 小时${scenario.intervalMinutes % 60 > 0 ? ` ${scenario.intervalMinutes % 60} 分钟` : ''}`
      : `${scenario.intervalMinutes} 分钟`)
    : '';
  const aiCanExit = scenario.type === 'cron' && scenario.aiCanExit ? 'true' : '';

  if (bundledContent) {
    // Bundled file is the developer-editable source of truth. Template vars
    // gate every scenario branch through the same vars the inline fallback uses.
    const vars: Record<string, string> = {
      runtimeName: getRuntimeDisplayName(options?.runtime),
      platformLabel,
      sourceTypeLabel,
      botName: isIm ? (scenario.botName ?? '') : '',
      taskId: scenario.type === 'cron' ? scenario.taskId : '',
      intervalText,
      aiCanExit,
      heartbeatHint: isIm ? '1' : '',
      floatingBallHint: isFloatingBall ? '1' : '',
      spaceId: isRegisteredAgent ? scenario.spaceId : '',
      registeredAgentId: isRegisteredAgent ? scenario.registeredAgentId : '',
      registeredAgentSpaceId: isRegisteredAgent ? scenario.spaceId : '',
    };
    parts.push(renderTemplate(bundledContent, vars));
  } else {
    // Fallback path: inline L1-L4 templates. Same surface area as pre-#193.
    parts.push(renderTemplate(FALLBACK_BASE_IDENTITY, {
      runtimeName: getRuntimeDisplayName(options?.runtime),
    }));
    if (isIm) {
      parts.push(renderTemplate(FALLBACK_CHANNEL_IM, {
        botName: scenario.botName ?? '',
        platformLabel,
        sourceTypeLabel,
      }));
    } else {
      parts.push(FALLBACK_CHANNEL_DESKTOP);
    }
    if (scenario.type === 'cron') {
      parts.push(renderTemplate(FALLBACK_CRON_TASK, {
        taskId: scenario.taskId,
        intervalText,
        aiCanExit,
      }));
    }
    if (isRegisteredAgent) {
      parts.push(renderTemplate(FALLBACK_REGISTERED_AGENT, {
        spaceId: scenario.spaceId,
        registeredAgentId: scenario.registeredAgentId,
      }));
    }
    if (isIm) parts.push(FALLBACK_HEARTBEAT);
    if (isFloatingBall) parts.push(FALLBACK_FLOATING_BALL);
    if (options?.playwrightStorageEnabled) parts.push(FALLBACK_BROWSER_STORAGE_STATE);
  }

  // Universal CLI capability hints + widget guidance always append — short
  // capability sections the AI should notice without loading the skill doc.
  const widgetSection = buildWidgetSection(scenario);
  if (widgetSection) parts.push(widgetSection);

  const sessionInboxSection = buildSessionInboxSection(scenario);
  if (sessionInboxSection) parts.push(sessionInboxSection);

  if (options?.cliToolsEnabled) {
    const cliTools = buildCliToolsAppend(scenario, {
      includeUserTools: options.userCliToolsEnabled === true,
      enabledOfficialToolIds: options.enabledOfficialToolIds,
    });
    if (cliTools) parts.push(cliTools);
  }

  return parts.join('\n\n');
}