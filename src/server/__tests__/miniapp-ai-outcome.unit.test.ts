/**
 * `classifySdkMessage` —— 判定一条 SDK 消息是补全、错误还是还不是结果。
 *
 * 这里钉的是一个**已经发生过的假成功**：无凭据时 SDK 会发一条
 * `type: 'assistant'` 消息，`content` 里是 `"Not logged in · Please run
 * /login"`，同时带 `is_api_error_message: true` 与 `error:
 * 'authentication_failed'`，`message.model` 是 `<synthetic>`。
 *
 * 旧实现只读 `content`，把那句话当成补全返回 `ok: true`，作者侧看到的是
 * "AI 回答：请先登录"。真实消息形状是在本机实跑一次 Sidecar 打出来的
 * （无凭据的临时 HOME），不是照文档编的 —— 下面的 fixture 就是那次实跑的
 * 原文裁剪。
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  classifySdkMessage,
  resolveAiTimeoutMs,
  resetMiniAppAiRateLimits,
  runMiniAppAiComplete,
} from '../miniapp-ai';

/** 实跑捕获到的认证失败消息。 */
const AUTH_FAILED_MESSAGE = {
  type: 'assistant',
  message: {
    id: 'afa6acb2-6598-4323-ae48-78929f5da887',
    model: '<synthetic>',
    role: 'assistant',
    stop_reason: 'stop_sequence',
    content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
  },
  error: 'authentication_failed',
  is_api_error_message: true,
};

/** 正常补全消息。 */
const NORMAL_MESSAGE = {
  type: 'assistant',
  message: {
    id: 'msg_ok',
    model: 'claude-sonnet-5',
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
  },
};

describe('classifySdkMessage', () => {
  describe('errors must never read as completions', () => {
    it('rejects the captured authentication failure instead of returning its text', () => {
      // 这条就是回归本体：改成读 content 就会返回
      // { kind: 'text', text: 'Not logged in …' }，作者拿到假成功。
      const out = classifySdkMessage(AUTH_FAILED_MESSAGE);

      expect(out.kind).toBe('error');
      if (out.kind !== 'error') throw new Error('expected an error outcome');
      expect(out.message).toContain('authentication_failed');
      // 错误文案本身也要带出去：只给一个 code，作者无法判断该提示登录还是换模型。
      expect(out.message).toContain('Not logged in');
    });

    it('treats is_api_error_message alone as an error, even without an error code', () => {
      const out = classifySdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'upstream exploded' }] },
        is_api_error_message: true,
      });

      expect(out.kind).toBe('error');
    });

    it('treats a bare error string as an error', () => {
      const out = classifySdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'rate limited' }] },
        error: 'rate_limit_error',
      });

      expect(out.kind).toBe('error');
      if (out.kind !== 'error') throw new Error('expected an error outcome');
      expect(out.message).toContain('rate_limit_error');
    });

    it('surfaces an error result message rather than its result text', () => {
      const out = classifySdkMessage({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: 'something broke mid-turn',
      });

      expect(out.kind).toBe('error');
      if (out.kind !== 'error') throw new Error('expected an error outcome');
      expect(out.message).toContain('something broke mid-turn');
    });

    it('falls back to the subtype when an error result carries no text', () => {
      const out = classifySdkMessage({ type: 'result', subtype: 'error_max_turns', is_error: true });

      expect(out.kind).toBe('error');
      if (out.kind !== 'error') throw new Error('expected an error outcome');
      expect(out.message).toContain('error_max_turns');
    });
  });

  describe('completions', () => {
    it('returns the assistant text of a normal message', () => {
      expect(classifySdkMessage(NORMAL_MESSAGE)).toEqual({ kind: 'text', text: 'hello' });
    });

    it('joins multiple text blocks', () => {
      const out = classifySdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      });

      expect(out).toEqual({ kind: 'text', text: 'ab' });
    });

    it('ignores non-text blocks rather than stringifying them', () => {
      const out = classifySdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'ok' }] },
      });

      expect(out).toEqual({ kind: 'text', text: 'ok' });
    });

    it('uses the result field as the authoritative text on a success result', () => {
      expect(classifySdkMessage({ type: 'result', subtype: 'success', is_error: false, result: 'done' }))
        .toEqual({ kind: 'text', text: 'done' });
    });
  });

  describe('not a result yet', () => {
    it.each([
      ['system init', { type: 'system', subtype: 'init' }],
      ['a stream event', { type: 'stream_event', event: { type: 'delta' } }],
      ['an assistant message with no text', { type: 'assistant', message: { content: [] } }],
      ['null', null],
      ['a string', 'nope'],
    ])('reports %s as empty', (_label, message) => {
      expect(classifySdkMessage(message)).toEqual({ kind: 'empty' });
    });
  });
});

/**
 * 作者自报 `timeout_ms` 的夹取。
 *
 * `opts.timeout_ms` 经 `numberOpt(opts, ...)` 原样进 `runMiniAppAiComplete`，
 * 在 `Promise.race` 里变成 `setTimeout(..., timeoutMs)`。Node 接受 2^31-1 以内
 * 的任何值，所以 `86400000` 会挂满一天。
 *
 * 与 `resolveMiniAppTimeoutMs`（shell / net）只共用上界这一个数字，默认值不同：
 * 补全是 60s，那两个是 30s。共用函数会把没传值的作者从 60s 悄悄降到 30s。
 */
describe('resolveAiTimeoutMs', () => {
  it('keeps the 60s default when the author says nothing', () => {
    // 与 shell/net 的 30s 默认**故意不同**，不要顺手"统一"成 30s。
    expect(resolveAiTimeoutMs(undefined)).toBe(60_000);
    expect(resolveAiTimeoutMs(null)).toBe(60_000);
    expect(resolveAiTimeoutMs('5000')).toBe(60_000);
    expect(resolveAiTimeoutMs(Number.NaN)).toBe(60_000);
  });

  it('clamps a one-day request to the 5min ceiling', () => {
    // 86400000 远在 2^31-1 以内，Node 原样接受 —— 只测"超大数字"会误以为安全。
    expect(resolveAiTimeoutMs(86_400_000)).toBe(5 * 60 * 1000);
    expect(resolveAiTimeoutMs(2 ** 31 - 1)).toBe(5 * 60 * 1000);
  });

  it('lifts 0 and negatives off the floor instead of passing them to setTimeout', () => {
    expect(resolveAiTimeoutMs(0)).toBe(1_000);
    expect(resolveAiTimeoutMs(-5_000)).toBe(1_000);
  });

  it('still lets the author ask for longer than the default, but not unbounded', () => {
    expect(resolveAiTimeoutMs(120_000)).toBe(120_000);
    expect(resolveAiTimeoutMs(1_500.9)).toBe(1_500);
  });
});

/**
 * 调用点本身的结构闸。
 *
 * ## 为什么这里是**扫源码**而不是跑一遍
 *
 * 上面那组纯函数测试有个已实测确认的漏洞：把调用点改回
 * `p.timeoutMs ?? DEFAULT_TIMEOUT_MS`，它们照样 18 个全绿 —— 它们不知道
 * `p.timeoutMs` 有没有被接进 `resolveAiTimeoutMs`。
 *
 * 本来打算用假定时器驱动一次真实 `runMiniAppAiComplete`、断言作者可见的
 * `app.ai timed out after Nms` 来钉住它（那是最强的断言面）。但实测那条路
 * **跑不起来**：`runMiniAppAiComplete` 走 `await import(SDK)` + 一串
 * agent-session 环境助手，配上假定时器后整个文件挂死 5 分钟无输出。
 * `miniapp-ai-abort.unit.test.ts` 开头的注释早就记了这件事（"那组 mock 在本
 * 仓库的 vitest 配置下拿不到干净的隔离，容易退化成看起来在测、其实在等真实
 * 超时的假测试"）—— 撞过一遍之后选择尊重那条既有结论，而不是交付一个会挂的
 * 或名不副实的测试。
 *
 * 所以退到扫源码。这是**比行为断言弱**的仪器：它不知道 clamp 的语义，只知道
 * 那行还在。留着它是因为它能挡住唯一现实的回归形态（有人顺手把调用点改回
 * 直通），而这正是上面那组测不到的。用 `expect` 写死字符串是为了重构时能立刻
 * 看到它在报什么，而不是静默失效。
 *
 * 哪天有人把 `runMiniAppAiComplete` 的依赖拆干净、假定时器能跑通了，就把这条
 * 换成真的行为断言 —— 那时它才配得上和 net / agent 那两条调用点测试并列。
 */
describe('the ai timeout call site stays wired to the clamp', () => {
  const source = readFileSync(new URL('../miniapp-ai.ts', import.meta.url), 'utf8');

  it('routes the author-supplied timeout through the clamp', () => {
    expect(source).toContain('resolveAiTimeoutMs(p.timeoutMs)');
  });

  it('never lets p.timeoutMs reach the race as a bare default fallback', () => {
    // 这一条才是真正的断言：第一条只证明 clamp 存在，这条证明它被用上了。
    expect(source).not.toMatch(/p\.timeoutMs\s*\?\?/);
  });
});

/**
 * `permissions.ai.rate_limit_per_minute` 的固定窗口限流。
 *
 * ## 为什么这一组能跑真实行为断言，而上面那组只能扫源码
 *
 * 上面说 `runMiniAppAiComplete` 配上假定时器会把整个文件挂死 5 分钟：它会走到
 * `await import(SDK)` 和一串 agent-session 环境助手。那条路到这里为止都碰不到。
 *
 * 这里用一个**故意的越权 maxTokens** 当探针：`runMiniAppAiComplete` 的顺序是
 * 空 prompt 检查 → 限流 → max_tokens 上界 → **才**是 SDK import。所以只要
 * `maxTokens` 大于 `maxTokensPerRequest`，函数就在第 248 行返回，根本走不到
 * 255 行的动态 import。既能真的驱动一次限流判定，又不碰 SDK、不需要 mock。
 *
 * 返回的两种错误信封因此就是这套断言的观测面：
 *   - `max_tokens ... exceeds ...` → 限流**放行**了，请求死在下一道闸
 *   - `rate limit exceeded ...`    → 限流**拦截**了
 */
describe('app.ai rate limiting', () => {
  const MAX_TOKENS_ERROR = /max_tokens .* exceeds/;
  const RATE_LIMIT_ERROR = /rate limit exceeded/;

  /** 走一次限流判定，并故意死在 max_tokens 闸上（不碰 SDK）。 */
  function probe(appId: string, rateLimitPerMinute: number) {
    return runMiniAppAiComplete({
      appId,
      prompt: 'hi',
      runId: 'run-1',
      rateLimitPerMinute,
      maxTokens: 999_999,
      maxTokensPerRequest: 1,
    });
  }

  beforeEach(() => {
    resetMiniAppAiRateLimits();
  });

  it('allows exactly `limit` calls in the window, then denies the next', async () => {
    const first = await probe('app-two-per-min', 2);
    const second = await probe('app-two-per-min', 2);
    const third = await probe('app-two-per-min', 2);

    expect(first.ok).toBe(false);
    expect(first.error?.message).toMatch(MAX_TOKENS_ERROR);
    expect(second.error?.message).toMatch(MAX_TOKENS_ERROR);
    // 第三次越界 —— 前两次都被放行，正说明配额是 2 而不是 1 或 3。
    expect(third.error?.message).toMatch(RATE_LIMIT_ERROR);
  });

  it('treats a limit of 0 (or a missing one) as unlimited, not as a denial', async () => {
    // 作者写 0 多半是想说"我有这个权限"，按拒绝处理会让 MiniApp 直接不可用。
    for (let i = 0; i < 5; i += 1) {
      const outcome = await probe('app-zero-limit', 0);
      expect(outcome.error?.message).toMatch(MAX_TOKENS_ERROR);
    }
    const unlimited = await runMiniAppAiComplete({
      appId: 'app-undefined-limit',
      prompt: 'hi',
      runId: 'run-1',
      maxTokens: 999_999,
      maxTokensPerRequest: 1,
    });
    expect(unlimited.error?.message).toMatch(MAX_TOKENS_ERROR);
  });

  it('gives each appId its own bucket', async () => {
    await probe('app-noisy', 1);
    await probe('app-noisy', 1); // 第二个被限流
    // 隔壁 app 不该被连坐。
    const other = await probe('app-quiet', 1);
    expect(other.error?.message).toMatch(MAX_TOKENS_ERROR);
  });

  it('reopens the window once the fixed 60s has elapsed', async () => {
    // 只假 Date，不假 setTimeout：本文件已经记过一次"假定时器挂死 5 分钟"，
    // 而这里根本走不到 setTimeout，没必要冒那个险。
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await probe('app-window', 1);
      const blocked = await probe('app-window', 1);
      expect(blocked.error?.message).toMatch(RATE_LIMIT_ERROR);

      // 窗口边界：59s 仍然限流。
      vi.setSystemTime(new Date('2026-01-01T00:00:59.999Z'));
      const stillBlocked = await probe('app-window', 1);
      expect(stillBlocked.error?.message).toMatch(RATE_LIMIT_ERROR);

      vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
      const reopened = await probe('app-window', 1);
      expect(reopened.error?.message).toMatch(MAX_TOKENS_ERROR);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resetMiniAppAiRateLimits clears a spent window', async () => {
    await probe('app-reset', 1);
    expect((await probe('app-reset', 1)).error?.message).toMatch(RATE_LIMIT_ERROR);
    resetMiniAppAiRateLimits();
    expect((await probe('app-reset', 1)).error?.message).toMatch(MAX_TOKENS_ERROR);
  });
});
