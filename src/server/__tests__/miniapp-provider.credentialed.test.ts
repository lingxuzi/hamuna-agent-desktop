/**
 * `app.ai.*` 对**真实 Provider** 的端到端（credentialed 池）。
 *
 * ## 为什么需要这个文件
 *
 * `app.ai` 此前所有的"端到端"证据都停在 loopback mock 上（见
 * `miniapp-ai-wire.integration.test.ts`）。那条链能证明 spawn / 权限 / 取消 /
 * 速率限制都接线正确，但 mock 对**任何**请求体都回 200，而真实上游会因请求形状
 * 不合法直接 4xx。于是有一类故障整套 loopback 证据都看不见：真实 Provider 拒绝
 * 我们发出的请求。
 *
 * 仓库里已有的 4 个 credentialed 文件（provider-anthropic / provider-moonshot /
 * sdk-smoke / mcp-readiness）**没有一个走 MiniApp 路径** —— 它们直接调 SDK。所以
 * 即使把它们全部跑绿，能证明的也只是"SDK + Provider 能通"，不是"MiniApp 的
 * `app.ai` 能通"。这两件事之间隔着 `runMiniAppAiComplete` 的参数拼装、
 * `permissions.ai` 闸门和 `appAiCwd()`，正是最该验的一段。
 *
 * ## 与已有 harness 的一个关键差别：env 怎么进去
 *
 * `runTestQuery` 把 `buildTestEnv(provider)` 当作 `env` **显式传给** `query()`。
 * 但 `runMiniAppAiComplete` 刻意**不传** `providerEnv`（`miniapp-ai.ts:231`，理由
 * 是 MiniApp 没有 Key、不该能把请求指向未登记的上游）—— 它靠 SDK 子进程继承
 * sidecar 的 `process.env`。
 *
 * 所以这里必须改 `process.env`，而不是走 `runTestQuery`。这不是绕开 harness，
 * 而是**忠实复现生产**：生产里正是 Rust 配置 sidecar 进程 env、MiniApp 的调用
 * 继承它。用 `runTestQuery` 反而会验错一条产品上不存在的路径。
 *
 * ## 没覆盖什么
 *
 * `app.agent.*` 不在这里。它要 `cmd_miniapp_ensure_session`（Rust）把 session 按
 * `miniapp_<appId>_<runId>` 1:1 建起来才能跑，属于 sidecar 进程编排而不是本池的
 * 职责；它对 loopback mock 的真实回合证据在 `miniapp-agent-wire.integration.test.ts`。
 * 要把 agent 也钉到真实上游，需要一个能起真 sidecar 的 credentialed 脚本。
 *
 * ## 跑法
 *
 *   npm run test:credentialed
 *
 * 无凭据时**自动 skip**，不报错、不联网。`PROVIDERS` 读的是 `~/.hamuna/config.json`
 * 与 `~/.claude.json`，与 MiniApp 生产路径同源。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROVIDERS, SIMPLE_PROMPT, TEST_TIMEOUT, TIMEOUT_BUFFER } from './fixtures/test-env';
import { buildTestEnv } from './setup';

const APP_ID = 'provider-probe';

/** 逐字回显的哨兵：模型只要照做，断言就不依赖具体措辞。 */
const ECHO = 'MINIAPP_AI_ECHO_MARKER';

let sandboxHome = '';
let envBackup: NodeJS.ProcessEnv | undefined;

// getConfigDir 只决定 MiniApp 自己的 appdata 落点。凭据**不走这里** ——
// buildTestEnv 读的是真实 ~/.hamuna/config.json，再写进 process.env，
// 与生产里"凭据在宿主、appdata 在沙箱"的分工一致。
vi.mock('../utils/admin-config', () => ({
  getConfigDir: () => sandboxHome,
}));

const { dispatchMiniAppApp } = await import('../miniapp-app-dispatch');

/** 任一 provider 有凭据就跑。跑哪条由环境决定，不在测试里硬指定。 */
function availableProvider(): { name: string; model: string } | null {
  for (const p of [PROVIDERS.anthropic, PROVIDERS.moonshot]) {
    if (p.available) return { name: p.config.name, model: p.config.model };
  }
  return null;
}
const PROVIDER = availableProvider();
const SKIP = !PROVIDER;

function writeMeta(permissions: unknown): void {
  const dir = join(sandboxHome, 'miniapps', APP_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      id: APP_ID,
      name: 'Provider Probe',
      description: 'credentialed MiniApp ai fixture',
      icon: 'p',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions,
    }),
    'utf8',
  );
}

beforeAll(() => {
  if (SKIP) return;
  // 见文件头：MiniApp 路径靠继承 process.env，所以这里改环境而不是给 query 传 env。
  envBackup = { ...process.env };
  Object.assign(process.env, buildTestEnv(PROVIDERS.anthropic.available
    ? PROVIDERS.anthropic.config
    : PROVIDERS.moonshot.config));
  console.log(`[miniapp-provider] using ${PROVIDER!.name} / ${PROVIDER!.model}`);
});

afterAll(() => {
  if (envBackup) {
    process.env = envBackup;
    envBackup = undefined;
  }
});

beforeEach(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'miniapp-provider-'));
});

afterEach(() => {
  try {
    rmSync(sandboxHome, { recursive: true, force: true });
  } catch {
    // Windows 上句柄可能尚未释放；清理失败不影响断言结论
  }
});

describe('app.ai against a real provider', () => {
  it.skipIf(SKIP)('completes a real request and returns the model text', async () => {
    writeMeta({ ai: { enabled: true } });
    const res = await dispatchMiniAppApp('ai.chat', APP_ID, { prompt: `Reply with exactly "${ECHO}" and nothing else.` });

    // 只断言 ok:true 是不够的：facade 的成功不等于真的有输出（见 miniapp-ai.ts
    // 对 had_message 的注释）。空转 + 假成功是这条路径最典型的静默故障。
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    const result = res.result as { text?: unknown; had_message?: unknown } | undefined;
    expect(result?.had_message, 'the provider produced no assistant message').toBe(true);
    expect(typeof result?.text).toBe('string');
    expect(String(result?.text)).toContain(ECHO);
  }, TEST_TIMEOUT + TIMEOUT_BUFFER);

  it.skipIf(SKIP)('accepts the documented messages-array form', async () => {
    // 参考文档给 ai.chat 的是 messages 数组，本项目两种形态都收。这条保证
    // 拍平成对话文本的那条路在真实上游下同样通。
    writeMeta({ ai: { enabled: true } });
    const res = await dispatchMiniAppApp('ai.chat', APP_ID, {
      prompt: [
        { role: 'user', content: `Reply with exactly "${ECHO}" and nothing else.` },
      ],
    });
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    expect(String((res.result as { text?: unknown } | undefined)?.text)).toContain(ECHO);
  }, TEST_TIMEOUT + TIMEOUT_BUFFER);

  it.skipIf(SKIP)('still enforces permissions.ai.allowed_models against the real host', async () => {
    // 闸门必须在真上游下依然生效：声明里没有的模型要被拒，**且不能发出请求**。
    // 拒绝发生在本地，所以这条不该依赖网络成功。
    writeMeta({ ai: { enabled: true, allowed_models: [`${ECHO}-only-model`] } });
    const res = await dispatchMiniAppApp('ai.chat', APP_ID, { prompt: SIMPLE_PROMPT });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  }, TEST_TIMEOUT + TIMEOUT_BUFFER);

  it.skipIf(SKIP)('a MiniApp with no ai grant is refused before any request', async () => {
    // 免声明 = 全禁。这条在 loopback 池里已经验过，这里再钉一次是为了确认
    // 真实 provider 存在时也不会漏过闸门。
    writeMeta({});
    const res = await dispatchMiniAppApp('ai.chat', APP_ID, { prompt: SIMPLE_PROMPT });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  }, TEST_TIMEOUT + TIMEOUT_BUFFER);
});
