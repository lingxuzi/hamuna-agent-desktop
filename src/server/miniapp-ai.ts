/**
 * `app.ai.*` 执行层：让 MiniApp 复用宿主的 Provider / Model，**无需自带 Key**。
 *
 * 为什么不开新的 Provider 通道：宿主已经有 `loadAppConfig()` 的 Provider 配置、
 * `title-generator` 的一次性 `query()` 样板、以及 OpenAI 协议的 one-shot bridge。
 * 再写一套就是第三份"怎么调模型"的实现，三处会各自漂移。这里照抄
 * `title-generator::generateTitleInner` 的安全参数集，而不是自己发明。
 *
 * 安全参数集（与 title-generator 同源，理由见该文件注释）：
 *   - `tools: []` + `mcpServers: {}` —— MiniApp 的 prompt 是**攻击者可控**的
 *     （作者可以写任何 prompt），若带着内置工具跑在 `bypassPermissions` 下，
 *     一次间接注入就能让模型在用户机器上执行 Bash。`tools: []` 之后模型只能
 *     产出文本，没有任何可调用对象，bypassPermissions 自然失效。
 *   - `thinking: {type:'disabled'}` + `effort:'low'` —— 补全类请求要的是快，
 *     不是让模型把预算花在隐藏推理上。
 *   - `persistSession: false` + `maxTurns: 1` —— 无状态，不污染任何会话历史。
 *   - `applyProviderContextWindowSuffix` —— CLAUDE.md Pit-of-Success：model id
 *     进 SDK ingress 必须过这个 helper，否则 >200K 窗口模型退回 200K fallback。
 *
 * 速率限制（`permissions.ai.rate_limit_per_minute`）是**有状态**的，因此不在
 * `shared/app-permissions.ts` 的纯判定层里，而在下方 —— 纯判定函数必须保持无副作用
 * 才能被 renderer 与 sidecar 共用。
 */

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { APP_ERROR_CODES } from '../shared/miniapp/app-protocol';
import {
  buildClaudeSessionEnv,
  getSessionProviderEnv,
  resolveClaudeCodeCli,
  startOneShotBridge,
} from './agent-session';
import { ensureDirSync } from './utils/fs-utils';
import { applyProviderContextWindowSuffix } from './utils/model-capabilities';
import { SUBSCRIPTION_PROVIDER_ID } from '../shared/config-types';
import { registerCall, releaseCall } from './miniapp-ai-abort';

const SYSTEM_PROMPT =
  'You are a built-in assistant for a desktop MiniApp. Answer concisely. ' +
  'You have no tools and cannot access the filesystem or the network.';

const DEFAULT_TIMEOUT_MS = 60_000;

interface AiOutcome {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

function ok(result: unknown): AiOutcome {
  return { ok: true, result };
}
function fail(code: string, message: string): AiOutcome {
  return { ok: false, error: { code, message } };
}

/** 从 SDK 流式消息里抽出 assistant 纯文本（与 title-generator 同构）。 */
type CompletionOutcome =
  | { kind: 'text'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'timeout' };

export type { CompletionOutcome };

/**
 * 判定一条 SDK 消息是"补全结果"、"错误"还是"还不是结果"。
 *
 * 关键在于**错误也会长得像结果**。SDK 在认证失败或 API 报错时，会发一条
 * `type: 'assistant'` 消息，`content` 里是一句人话（实测无凭据时是
 * `"Not logged in · Please run /login"`），同时带 `is_api_error_message: true`
 * 与 `error: 'authentication_failed'`，`message.model` 是 `<synthetic>`。
 *
 * 早期实现只读 `content`，于是把那句错误文案当成补全交给作者，返回
 * `ok: true`。作者侧看到的是"AI 回答：请先登录"——一个**假成功**，比直接
 * 报错难查得多。对齐 `miniapp-agent.ts` 那条"facade 的 success 不等于真的有
 * 输出"的判断。
 *
 * `result` 消息同样要看：SDK 文档说它是 turn-complete 信号，`subtype: 'success'`
 * 才带最终文本，`is_error: true` 时带的是错误文本。
 */
export function classifySdkMessage(message: unknown): CompletionOutcome {
  if (!message || typeof message !== 'object') return { kind: 'empty' };
  const rec = message as Record<string, unknown>;

  if (rec.type === 'result') {
    const isError = rec.is_error === true;
    const subtype = typeof rec.subtype === 'string' ? rec.subtype : '';
    const text = typeof rec.result === 'string' ? rec.result.trim() : '';
    if (isError || (subtype && subtype !== 'success')) {
      return { kind: 'error', message: text || `app.ai turn failed (${subtype || 'unknown'})` };
    }
    return text ? { kind: 'text', text } : { kind: 'empty' };
  }

  if (rec.type !== 'assistant') return { kind: 'empty' };

  // 先判错误，再判文本 —— 顺序反了就会把错误文案当补全。
  if (rec.is_api_error_message === true || (typeof rec.error === 'string' && rec.error)) {
    const text = joinTextBlocks(rec.message) ?? '';
    const code = typeof rec.error === 'string' ? rec.error : 'api_error';
    return { kind: 'error', message: text ? `${text} (${code})` : `app.ai failed: ${code}` };
  }

  const text = joinTextBlocks(rec.message);
  return text ? { kind: 'text', text } : { kind: 'empty' };
}

/** 拼一条 assistant 消息里所有 `text` 块；没有就返回 null。 */
function joinTextBlocks(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.length > 0 ? parts.join('') : null;
}

// ── 速率限制（每 appId 独立令牌桶） ────────────────────────────────────────
// 刻意是模块级 Map 而不是落盘：MiniApp 被删除后残留的桶只会占一点内存，
// 而落盘会引入"用户手工删状态文件"这种新的失败模式。

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * 固定窗口计数。`limit <= 0` 视为"不限制"——作者写了 0 多半是想表达
 * "我用 meta 声明我有这个权限"，此时按拒绝处理会让 MiniApp 直接不可用。
 */
function rateLimited(appId: string, limit: number | undefined): boolean {
  if (!limit || limit <= 0) return false;
  const now = Date.now();
  const bucket = buckets.get(appId);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(appId, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

export function resetMiniAppAiRateLimits(): void {
  buckets.clear();
}

// ── 中止注册表 ──────────────────────────────────────────────────────────────
//
// 实现在 `miniapp-ai-abort.ts`：注册表是**有状态的生命周期管理**，与"怎么发起
// 一次补全"（I/O + SDK）是两个关注点。拆开后寻址逻辑可以纯逻辑单测，不必
// mock 掉整个 SDK 才能验证"cancel 打中了正确的那个 run"。

export {
  cancelCall as cancelMiniAppAiCall,
  resetAll as resetMiniAppAiInflight,
} from './miniapp-ai-abort';

/**
 * 补全固定走宿主已配置的那条通路。
 *
 * 刻意**不接受** MiniApp 传 providerEnv / apiKey：它没有 Key，也不该有能力把
 * 请求指向一个未在宿主配置里登记过的上游。`model` 缺省时留 undefined，由 SDK
 * 按宿主当前配置自选 —— 这比在 sidecar 侧重新解析一遍宿主 config 更可靠，
 * 因为 config 的权威在 Rust / 磁盘，sidecar 读到的可能已是陈旧快照。
 */
function resolveHostModel(requested: string | undefined): string | undefined {
  return requested?.trim() || undefined;
}

export interface MiniAppAiParams {
  appId: string;
  prompt: string;
  /**
   * 作者自带的 system prompt。缺省才用 `SYSTEM_PROMPT`。
   *
   * 允许整体替换而不只是追加，是因为安全性不依赖这句话：真正的闸门是
   * `tools: []` + `mcpServers: {}` + `maxTurns: 1`，模型手上没有任何可调用
   * 对象，把提示词整段换掉也换不出工具来。
   */
  systemPrompt?: string;
  /** 中止用的稳定标识；`app.ai.cancel({run_id})` 靠它命中在途请求。 */
  runId: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  rateLimitPerMinute?: number;
  maxTokensPerRequest?: number;
}

export async function runMiniAppAiComplete(p: MiniAppAiParams): Promise<AiOutcome> {
  if (!p.prompt.trim()) {
    return fail(APP_ERROR_CODES.INVALID_PARAMS, 'app.ai requires a non-empty prompt');
  }
  if (rateLimited(p.appId, p.rateLimitPerMinute)) {
    return fail(
      APP_ERROR_CODES.PERMISSION_DENIED,
      'app.ai rate limit exceeded for this minute (permissions.ai.rate_limit_per_minute)',
    );
  }

  // meta 声明的 max_tokens_per_request 是**上限**，作者可请求更小但不能更大。
  //
  // 已知边界（不要误读成"已强制"）：这个上限当前**只做校验，不下发给模型**。
  // `@anthropic-ai/claude-agent-sdk` 的 `query()` Options 没有按请求限制输出
  // token 的选项 —— 只有 `maxBudgetUsd`（美元预算）与 alpha 的 `taskBudget`
  //（软提示）。`maxOutputTokens` 属于 provider 级配置，作用于该 provider 的
  // 全部请求，不适合按 MiniApp 逐次覆盖。所以作者写的 `maxTokens` 会被校验、
  // 然后丢弃。
  //
  // 保留校验而不是删掉：它确实拒绝"声明了 8192 却要 100000"这种越权请求，
  // 是一条真实的策略断言。要真正按 token 封顶，需要先给 provider env 增加
  // 按次覆盖的口子 —— 那条路要动 provider 配置解析，且真实模型调用属于
  // `credentialed` 池，本机无法验证，不在能盲改的范围里。
  const requested = p.maxTokens ?? p.maxTokensPerRequest;
  if (requested !== undefined && p.maxTokensPerRequest !== undefined && requested > p.maxTokensPerRequest) {
    return fail(
      APP_ERROR_CODES.PERMISSION_DENIED,
      `max_tokens ${requested} exceeds permissions.ai.max_tokens_per_request ${p.maxTokensPerRequest}`,
    );
  }

  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const model = resolveHostModel(p.model);
  // 补全永远走宿主已配置的那条通路，MiniApp 不注入 providerEnv —— 它没有 Key，
  // 也不该有能力把请求指向一个未在宿主配置里登记过的上游。传 `undefined` 在
  // `buildClaudeSessionEnv` 里读作"沿用会话当前 provider"，正是这里要的安全性质。
  const providerEnv = undefined;

  // 上面那句"沿用当前 provider"是有代价的：调用方**必须自己**把这个 provider
  // 配套的两样东西补齐。之前这里硬传 `providerId: SUBSCRIPTION_PROVIDER_ID`，
  // 而真正决定走直连还是 bridge 的是 `effectiveProviderEnv`（即 configState 里
  // 那个真实 provider）—— 两者一旦对不上，OpenAI 协议的上游会同时命中
  // "按订阅处理"（providerId）和"需要 bridge token"（apiProtocol === 'openai'）
  // 两条规则，而 token 从来没人注册，`buildClaudeSessionEnv` 当场抛。
  // 后果是 app.ai 对**任何**跑在 OpenAI 兼容 provider 上的用户都是坏的，
  // 而自定义 provider 里这类占多数（实测：宿主默认 provider 正是 apiProtocol
  // 'openai'，一次真实补全直接抛 "requires a bridgeToken"）。
  const activeProvider = getSessionProviderEnv();
  const providerId = activeProvider?.providerId ?? SUBSCRIPTION_PROVIDER_ID;

  // bridge 是 per-subprocess 的，不能复用活动会话那个 token —— 两个子进程共享
  // 一条路由时，上游切换与中止会互相干扰。与 title-generator 同款处理。
  const bridge =
    activeProvider?.apiProtocol === 'openai'
      ? startOneShotBridge(activeProvider, model, 'miniapp-ai')
      : null;

  // 注册到中止表，让 app.ai.cancel 有一个真实的中止点。
  const controller = registerCall(p.appId, p.runId);

  const timeoutMs = p.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // 中止与超时的结论只在这里成型。收尾有两条路径 —— iterator 正常收尾，以及
  // SDK 因 abort 直接抛出（实测是后者）—— 它们共用同一个判断，才不会各说各话。
  //
  // 刻意留在 try **外面**：`const` 的作用域是块级，声明在 try 块里的常量在
  // catch / finally 里根本不可见，而下面两处收尾都要用它。
  const terminalFailure = () =>
    controller.signal.aborted
      ? fail(APP_ERROR_CODES.HOST_ERROR, 'app.ai was cancelled')
      : fail(APP_ERROR_CODES.HOST_ERROR, `app.ai timed out after ${timeoutMs}ms`);

  // try 从这里就开始，而不是从下面的 race 开始：`buildClaudeSessionEnv` 是在
  // `query({...})` 的实参里求值的，它抛错时**根本走不到**后面的 finally，
  // bridge token 就会留在 bridge-registry 里按调用次数单调增长。曾经的
  // "requires a bridgeToken" 正是这样一个同步抛出。
  try {
    const cliQuery = query({
      prompt: (async function* () {
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: p.prompt },
          parent_tool_use_id: null,
          session_id: randomUUID(),
        };
      })(),
      options: {
        maxTurns: 1,
        sessionId: randomUUID(),
        cwd: appAiCwd(),
        settingSources: ['project'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: resolveClaudeCodeCli(),
        env: buildClaudeSessionEnv(providerEnv, model, {
          bridgeToken: bridge?.token,
          providerId,
        }),
        systemPrompt: p.systemPrompt?.trim() || SYSTEM_PROMPT,
        thinking: { type: 'disabled' },
        effort: 'low',
        includePartialMessages: false,
        persistSession: false,
        mcpServers: {},
        tools: [],
        abortController: controller,
        ...(model
          ? { model: applyProviderContextWindowSuffix(model, providerId) }
          : {}),
      },
    });

    const outcome = await Promise.race([
      (async (): Promise<CompletionOutcome> => {
        for await (const message of cliQuery) {
          const verdict = classifySdkMessage(message);
          // 错误优先于文本：SDK 把认证 / API 失败也塞进一条 assistant 消息的
          // content 里（`is_api_error_message: true`）。先判文本会把
          // "Not logged in · Please run /login" 当成补全结果交给作者。
          if (verdict.kind === 'error') return verdict;
          if (verdict.kind === 'text') return verdict;
        }
        return { kind: 'empty' };
      })(),
      new Promise<CompletionOutcome>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs),
      ),
    ]);
    if (outcome.kind === 'error') {
      try {
        cliQuery.return(undefined as never);
      } catch {
        /* ignore */
      }
      return fail(APP_ERROR_CODES.HOST_ERROR, outcome.message);
    }
    if (outcome.kind === 'text') return ok({ text: outcome.text });
    // `empty` 与 `timeout` 共用这一段，与旧实现一致（旧的 `null` 同时覆盖这两种）。
    // 无论超时还是被取消，都要显式终止 iterator，否则 SDK 子进程会泄漏
    // （对齐 title-generator 的同款处理）。
    try {
      cliQuery.return(undefined as never);
    } catch {
      /* ignore */
    }
    // 取消与超时必须给出**不同**的结论：作者看到 "timed out" 会去调大
    // timeout，而真实原因是他自己 300ms 前刚点了取消按钮。
    return terminalFailure();
  } catch (e) {
    // 同样先问"是不是我们自己中止的"。这个 catch 原本无条件回 `e.message`，
    // 而 abort 恰恰是**抛**出来的（`for await` 循环整个 reject），于是上面那句
    // 注释防的事原样发生：作者拿到 SDK 的 "Operation aborted"，MiniApp 自己
    // 定的消息从来没到过作者眼前。
    //
    // 但也不能无脑换成 terminalFailure：401、端点不可达同样落在这里，谎称
    // "timed out" 会把人带进沟里 —— 他只会去调大 timeout。abort 归 abort，
    // 其余照旧原样上报。
    if (controller.signal.aborted) return terminalFailure();
    return fail(APP_ERROR_CODES.HOST_ERROR, e instanceof Error ? e.message : String(e));
  } finally {
    // 正常完成 / 超时 / 抛错都要摘除。bridge token 漏摘会留在 bridge-registry
    // 里按调用次数单调增长，和 abort 注册表是同一类泄漏。
    bridge?.release();
    // cancel 已经摘过一次，重复 release 是幂等的。
    releaseCall(p.appId, p.runId);
  }
}

function appAiCwd(): string {
  const cwd = join(homedir(), '.hamuna', 'projects');
  ensureDirSync(cwd);
  return cwd;
}

/**
 * `app.ai.getModels` —— 列出宿主当前可用的 model。
 *
 * 复用 `provider-verify.ts::fetchSdkSupportedModels`（`index.ts` 的 model 下拉
 * 已经在用它），而不是自己读 config 或遍历 LiteLLM 目录：那份列表已经处理了
 * 订阅态 OAuth、第三方 provider 与 bridge 的差异，第二份实现必然漂移。
 */
export async function listMiniAppAiModels(): Promise<AiOutcome> {
  try {
    const { fetchSdkSupportedModels } = await import('./provider-verify');
    const models = await fetchSdkSupportedModels();
    return ok({
      models: models.map((m) => m.value),
      display: models.map((m) => ({ value: m.value, displayName: m.displayName })),
    });
  } catch (e) {
    return fail(APP_ERROR_CODES.HOST_ERROR, e instanceof Error ? e.message : String(e));
  }
}
