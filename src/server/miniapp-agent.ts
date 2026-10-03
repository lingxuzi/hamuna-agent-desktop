/**
 * `app.agent.*` 执行层：MiniApp 拥有自己的**隐藏 Agent 会话**。
 *
 * 与 `app.ai.*` 的分工（这是本文件存在的全部理由）：
 *   - `ai.complete` —— 无状态一问一答，模型**无工具**，拿不到任何用户数据。
 *     适合翻译 / 分类 / 摘要这类纯文本处理。
 *   - `agent.run`   —— 有状态多轮，模型**有工具**、能读写工作区、能跑命令。
 *     适合"让 Agent 帮我把这个目录整理好"这类真活。
 *
 * 两者混用是 MiniApp 作者最常见的越权写法（"我用 ai.complete 就能读文件吧？"），
 * 所以权限判定上刻意分成两个独立开关（`ai.enabled` / `agent.enabled`），
 * 见 `shared/miniapp/types.ts::MiniAppPermissions.agent`。
 *
 * ## 为什么这里调 `getSessionEngine()` 而不是新开一条 agent 链路
 *
 * CLAUDE.md 规定：任何"注入 user 消息 / 等 turn 完成 / session 读操作"的新端点
 * MUST 走 `session-engine/` facade。手写 `shouldUseExternalRuntime()` 分支会让
 * builtin 去 resume 一个外部会话 —— 静默空转 + 假成功（#295 那类事故）。
 *
 * 关键前提：**本文件只会在 MiniApp 自己的 sidecar 进程里被加载**。Rust 的
 * `cmd_miniapp_ensure_session` 为每个 `miniapp_<appId>_<runId>` 起独立 Sidecar
 * （1:1），而 facade 的 adapter 是进程级单例、绑定本进程宿主的那一个 Session。
 * 所以从 MiniApp 自己的端口打过来的 `agent.run`，`getSessionEngine()` 拿到的
 * 正是它自己的会话 —— 不需要、也不能在这里按 sessionId 再选一次。
 */

import { APP_ERROR_CODES } from '../shared/miniapp/app-protocol';
import { getSessionEngine } from './session-engine/selector';

interface AgentOutcome {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

function ok(result: unknown): AgentOutcome {
  return { ok: true, result };
}
function fail(code: string, message: string): AgentOutcome {
  return { ok: false, error: { code, message } };
}

export interface MiniAppAgentRunParams {
  prompt: string;
  workspacePath: string;
  permissionMode?: string;
  model?: string;
  timeoutMs?: number;
  /** 稳定标识同一 run 的多次调用，让 facade 能定位 turn 身份并精确停止。 */
  runId: string;
  /**
   * 参考文档让作者把 `ensureSession()` 返回的 sessionId 回传给 `run`。
   *
   * 本项目**只有一个** Agent 会话（Rust 按 `miniapp_<appId>_<runId>` 起 1:1
   * Sidecar），所以这里不按 id 选会话 —— 但也不能静默忽略：作者传一个别的
   * MiniApp 的 sessionId，说明他理解错了会话边界，那应该报错而不是照跑。
   * id 由 (appId, runId) 决定、跨挂载稳定，所以"重新加载后拿到的还是同一个
   * id"这种正常情况不会误伤。
   */
  sessionId?: string;
}

/**
 * MiniApp 的 Agent turn 一律走 `acceptEdits`，不给 `bypassPermissions`。
 *
 * 理由：MiniApp 的 prompt 完全由第三方作者控制，而它拿到的是**有工具的模型**。
 * 若这里放开 bypassPermissions，一个恶意（或仅仅是被注入的）MiniApp 就能在
 * 用户机器上无确认地执行任意命令。`acceptEdits` 让文件编辑自动进行但**破坏性
 * 命令仍需用户点头** —— 这是第三方代码能拿到的上限。
 *
 * 注意这与 `app.ai.*` 的 `bypassPermissions` 不矛盾：那边 `tools: []`，模型
 * 根本没有可调用对象，权限模式是空谈。
 */
const MINIAPP_AGENT_PERMISSION_MODE = 'acceptEdits';

const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

export async function runMiniAppAgentTurn(p: MiniAppAgentRunParams): Promise<AgentOutcome> {
  if (!p.prompt.trim()) {
    return fail(APP_ERROR_CODES.INVALID_PARAMS, 'app.agent.run requires a non-empty prompt');
  }
  const engine = getSessionEngine();
  const sessionId = engine.getCurrentSessionContext().sessionId;
  if (!sessionId) {
    return fail(APP_ERROR_CODES.HOST_ERROR, 'no session is bound to this MiniApp agent sidecar');
  }
  // 传了就必须对得上。静默忽略会把"我以为在跟哪个会话说话"这个错误一直带到
  // 结果里 —— 作者拿到一段无法解释来源的输出，比当场报错难查得多。
  if (p.sessionId !== undefined && p.sessionId !== sessionId) {
    return fail(
      APP_ERROR_CODES.INVALID_PARAMS,
      `app.agent.run sessionId '${p.sessionId}' is not this MiniApp's agent session ('${sessionId}')`,
    );
  }

  const result = await engine.runInjectedTurn({
    prompt: p.prompt,
    sessionId,
    workspacePath: p.workspacePath,
    scenario: { type: 'desktop' },
    permissionMode: p.permissionMode ?? MINIAPP_AGENT_PERMISSION_MODE,
    model: p.model,
    timeoutMs: p.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
    pollMs: 500,
    // turnOwner 让 stopOwnedTurn 能精确命中这一个 turn，而不是把整个 session
    // 停掉 —— 否则一个 MiniApp 取消会连带打断同进程里的其它 turn。
    turnOwner: { kind: 'agent', id: `miniapp:${p.runId}` },
    // origin 记成 automation 而不是 desktop：MiniApp 的 turn 不是用户在聊天框
    // 里手动发的，埋点若混进桌面对话指标会污染产品侧的口径。
    analyticsOrigin: { kind: 'automation', surface: 'assistant' },
  });

  if (!result.success) {
    return fail(APP_ERROR_CODES.HOST_ERROR, result.error ?? 'agent turn failed');
  }
  // facade 的 success 不等于"真的有输出"：空转也要如实回报给 MiniApp，
  // 否则作者会以为 Agent 干了活。
  return ok({
    text: result.text ?? '',
    had_message: result.assistantMessagePresent === true,
  });
}

export async function stopMiniAppAgentTurn(runId: string): Promise<AgentOutcome> {
  const { stopOwnedTurn } = await import('./session-engine/selector');
  const stopped = await stopOwnedTurn({ kind: 'agent', id: `miniapp:${runId}` });
  return stopped.success
    ? ok({ stopped: true })
    : fail(APP_ERROR_CODES.HOST_ERROR, stopped.error ?? 'failed to stop agent turn');
}

/**
 * 事件订阅。
 *
 * 刻意**不**在这里开 SSE：MiniApp 的 iframe 已经在宿主 renderer 里，宿主可以
 * 直接把 `getSessionEngine().getLiveSessionOverlay(...)` 变化推给它；让 sidecar
 * 再开一条 SSE 会让 iframe 侧多一套连接生命周期要管。
 * 宿主侧用 `agent.onEvent` 注册，事件由 renderer 主动 push（见
 * `appRuntimeScript.ts` 的 `app.event` 通道）。
 */
export function describeMiniAppAgentStream(): AgentOutcome {
  const engine = getSessionEngine();
  const ctx = engine.getCurrentSessionContext();
  return ok({
    session_id: ctx.sessionId ?? null,
    engine: engine.kind,
    runtime: engine.getRuntimeIdentity().runtime,
  });
}
