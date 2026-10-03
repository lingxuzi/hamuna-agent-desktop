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
 * MiniApp 自报 `timeout_ms` 的归一化。
 *
 * 同一个 MiniApp 边界上，`shell.exec` 与 `net.fetch` 的 timeout 都已经夹过
 * （`miniapp-app-dispatch.ts::resolveMiniAppTimeoutMs`），这里是第三个兄弟。
 * 危害形状也一样：`runInjectedTurn` 把它算成 `deadline`，再喂给三处
 * `setTimeout`（builtin / external adapter 的 `waitForDeadline`），而
 * `timeoutMs <= 0` 在那里是"立即超时"、不是"不限时"，所以真正危险的又是上界 ——
 * `timeout_ms: 2147483647` 就是一个 24.8 天的定时器，turn 永远不 settle，
 * 一个 sidecar + SDK 子进程跟着挂住。
 *
 * ## 为什么上限是 1h 而不是 5min
 *
 * 不能直接复用 `resolveMiniAppTimeoutMs` 的 5min：那道闸是为"一次命令 / 一次
 * HTTP 请求"定的，而 agent turn 是**带工具的 LLM 回合**，跑满 5 分钟是正常的，
 * 按 5min 夹会直接打断合法长回合。1h 取自本仓已有的回合上限
 * （`runtimes/external-watchdog-policy.ts::CODEX_LONG_CONTEXT_MAX_TIMEOUT_MS`
 * —— 目前给最长回合用的就是 60 分钟），所以这不是一个新发明的数字，而是与
 * 仓库既有策略对齐。代价要说清：作者仍然**可以**把自己写进一个跑不完的 turn，
 * 出口是 `app.agent.cancel(run_id)`，而这条路径和 timeout 一样是作者可控的。
 *
 * 夹取放在这里（MiniApp 边界）而不是 adapter 里：`runInjectedTurn` 还服务 cron /
 * goal / IM，那些调用方有各自的预算语义，动 adapter 会波及它们。
 */
const MINIAPP_AGENT_TIMEOUT_MIN_MS = 1_000;
const MINIAPP_AGENT_TIMEOUT_MAX_MS = 60 * 60 * 1000;
const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

export function resolveMiniAppAgentTimeoutMs(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_AGENT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(raw), MINIAPP_AGENT_TIMEOUT_MIN_MS), MINIAPP_AGENT_TIMEOUT_MAX_MS);
}

/**
 * MiniApp 的 Agent turn 走 `plan`：读得到自己的 appdata，写一律被硬拒。
 *
 * ## 为什么不是 acceptEdits
 *
 * 之前这里是 `acceptEdits`，理由写的是"文件编辑自动进行、破坏性命令仍需用户
 * 点头"。**这个前提是错的，而且被实跑证伪了**：acceptEdits 下模型请求 `Write`
 * 同样会进 `canUseTool` → `checkToolPermission` → 向用户弹批准。MiniApp 这条
 * 链上没有任何 UI 能回答它，于是每一次工具调用都挂到整轮 5 分钟超时，以
 * `terminal_reason: aborted_tools` / `is_error: true` 收场。
 *
 * 也就是说 acceptEdits **既没买到它声称的"编辑自动进行"，也没买到"破坏性命令
 * 要人点头"** —— 它只买到了一个挂死。模型一次工具都用不了，而 SKILL.md 恰恰
 * 把"有完整工具"写成 app.agent 区别于 app.ai 的唯一卖点。
 *
 * ## 为什么不是 fullAgency
 *
 * 本仓库其它无人值守回合（cron / agent-channel / memory-update）都用
 * fullAgency，那条 `canUseTool` 快路径放行除交互类工具以外的一切。MiniApp 不
 * 适用：那些回合的任务是**用户自己写**的，而 MiniApp 的 prompt 由**第三方
 * 作者**控制。fullAgency 含 `Bash`，等于把市场里的任意 MiniApp 变成用户机器
 * 上的无确认命令执行，完全越出 agent-dir 这层沙箱。
 *
 * ## plan 为什么够用、且不会重蹈挂死
 *
 * 写侧由 `plan-mode-gate.ts` 的 PreToolUse 硬闸兜底（跑在原生解析器之前，deny
 * 无条件采纳），因此不依赖 SDK 哪条路径调不调 canUseTool。读侧仍然可用 ——
 * SKILL.md 给的示例 `app.agent.run('总结这个目录的结构')` 正是纯读。
 *
 * 若将来要让 MiniApp agent 写文件，正确的做法不是改回 acceptEdits，而是显式
 * 定义"沙箱内可写"的白名单（含路径闸门），并单独决定 Bash 是否放行。
 */
const MINIAPP_AGENT_PERMISSION_MODE = 'plan';

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
    timeoutMs: resolveMiniAppAgentTimeoutMs(p.timeoutMs),
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
