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
import { buildClaudeSessionEnv, resolveClaudeCodeCli } from './agent-session';
import { ensureDirSync } from './utils/fs-utils';
import { applyProviderContextWindowSuffix } from './utils/model-capabilities';
import { SUBSCRIPTION_PROVIDER_ID } from '../shared/config-types';

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
function extractText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const rec = message as Record<string, unknown>;
  if (rec.type !== 'assistant' && rec.type !== 'result') return null;
  const message_ = rec.message as Record<string, unknown> | undefined;
  const content = (message_?.content ?? rec.content) as unknown;
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
  // 也不该有能力把请求指向一个未在宿主配置里登记过的上游。
  const providerEnv = undefined;
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
        providerId: SUBSCRIPTION_PROVIDER_ID,
      }),
      systemPrompt: SYSTEM_PROMPT,
      thinking: { type: 'disabled' },
      effort: 'low',
      includePartialMessages: false,
      persistSession: false,
      mcpServers: {},
      tools: [],
      ...(model
        ? { model: applyProviderContextWindowSuffix(model, SUBSCRIPTION_PROVIDER_ID) }
        : {}),
    },
  });

  const timeoutMs = p.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const text = await Promise.race([
      (async () => {
        for await (const message of cliQuery) {
          const t = extractText(message);
          if (t) return t;
        }
        return null;
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (text === null) {
      // 超时赢了 race：显式终止 iterator，否则 SDK 子进程会泄漏
      // （对齐 title-generator 的同款处理）。
      try {
        cliQuery.return(undefined as never);
      } catch {
        /* ignore */
      }
      return fail(APP_ERROR_CODES.HOST_ERROR, `app.ai timed out after ${timeoutMs}ms`);
    }
    return ok({ text });
  } catch (e) {
    return fail(APP_ERROR_CODES.HOST_ERROR, e instanceof Error ? e.message : String(e));
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
