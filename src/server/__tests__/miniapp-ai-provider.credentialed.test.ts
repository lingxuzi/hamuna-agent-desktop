/**
 * `app.ai` 打到**真实上游**的那一段（credentialed 池，显式本地跑）。
 *
 * ## 它补的是哪块洞
 *
 * `miniapp-ai-wire.integration.test.ts` 已经证明整条链路是通的：iframe 侧的形状、
 * 权限闸门、真实 Sidecar 进程、真实 SDK 子进程、真实 `POST /v1/messages`、真实 SSE
 * 解析。它唯一没证明的是「真实端点是否接受这个请求形状」。
 *
 * 本文件把那最后一段也补上：推一个**真 provider**（从 `~/.hamuna/config.json` 读用户
 * 自己配好的那条），让 `ai.complete` 真跑一次，断言拿到的是真文本而不是错误信封。
 *
 * ## 为什么形状必须照抄 ai-wire 那份，而不是自己写
 *
 * 已踩过的坑，写在这里免得重犯：
 *
 *  1. **只设进程环境变量里的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` 无效。**
 *     `app.ai` 传的是 `providerEnv: undefined`，而 `buildClaudeSessionEnv` 里
 *     `effectiveProviderEnv = providerEnv ?? configState.currentProviderEnv` —— 也就是
 *     「沿用会话当前 provider」。必须走 `POST /api/provider/set` 把 provider 推进去。
 *     （`providerId: SUBSCRIPTION_PROVIDER_ID` 那个标签不决定分支；真正决定分支的是
 *     `effectiveProviderEnv?.baseUrl` 有没有值。）
 *  2. 推完 provider 会触发一次 session 重启，要等它落定再打第一次补全，否则两个
 *     请求抢同一个 SDK 子进程。
 *  3. 推的是 `apiProtocol: 'openai'` 的 provider 时，sidecar 走的是 bridge 分支 ——
 *     它需要 `startStreamingSession` 注册 bridge token。这条同样由 `/api/provider/set`
 *     触发，所以**不要**手写 `bridgeToken`，照常推 provider 即可。
 *
 * ## 凭据从哪来、会不会外泄
 *
 * 凭据由**测试进程**从真实 `~/.hamuna/config.json` 读出来，然后通过 HTTP 推进那个
 * 用 scratch HOME 起的 sidecar。sidecar 全程看不到用户真实的 config 目录，推送完成
 * 后进程即销毁。测试失败时不会把 key 打进断言消息 —— 只报 provider 的 `id`。
 *
 * 没有可用凭据时**整体跳过**，不是失败：CI 与别人机器上跑 `npm test` 不该红。
 *
 * 花钱：一次补全，prompt 是几个 token。这是有意为之的最小额度。
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const APP_ID = "ai-provider-probe";

interface Envelope {
  ok: boolean;
  result?: { text?: string };
  error?: { code: string; message: string };
}

interface RealProvider {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  apiProtocol?: string;
  model: string;
}

/**
 * 读用户自己配好的默认 provider。
 *
 * 只取「够发一次请求」的最小集：baseUrl + key + 协议 + 一个模型名。读不到就返回
 * null，让整个 describe 跳过 —— 不猜、不用环境变量兜底，因为环境变量那条路本来
 * 就对 `app.ai` 无效（见文件头第 1 条）。
 */
function readRealProvider(): RealProvider | null {
  let raw: string;
  try {
    raw = readFileSync(join(homedir(), ".hamuna", "config.json"), "utf8");
  } catch {
    return null;
  }

  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const providerId =
    typeof cfg.defaultProviderId === "string" ? cfg.defaultProviderId : "";
  if (!providerId) return null;

  // provider 本体在 availableProvidersJson（一个 JSON 字符串），key 在 providerApiKeys。
  let entries: Record<string, unknown>[] = [];
  if (typeof cfg.availableProvidersJson === "string") {
    try {
      const parsed = JSON.parse(cfg.availableProvidersJson) as unknown;
      if (Array.isArray(parsed)) entries = parsed as Record<string, unknown>[];
    } catch {
      entries = [];
    }
  }
  const entry = entries.find((e) => e.id === providerId);
  if (!entry) return null;

  const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl : "";
  const apiKeys = (cfg.providerApiKeys ?? {}) as Record<string, unknown>;
  const fromKeys =
    typeof apiKeys[providerId] === "string"
      ? (apiKeys[providerId] as string)
      : "";
  const fromEntry =
    typeof entry.apiKey === "string" ? (entry.apiKey as string) : "";
  const apiKey = fromKeys || fromEntry;
  if (!baseUrl || !apiKey) return null;

  const primaryModels = (cfg.providerPrimaryModels ?? {}) as Record<
    string,
    unknown
  >;
  const model =
    (typeof primaryModels[providerId] === "string"
      ? (primaryModels[providerId] as string)
      : "") ||
    (typeof entry.primaryModel === "string"
      ? (entry.primaryModel as string)
      : "");

  return {
    providerId,
    baseUrl,
    apiKey,
    apiProtocol:
      typeof entry.apiProtocol === "string" ? entry.apiProtocol : undefined,
    model,
  };
}

const provider = readRealProvider();
const skipReason = provider
  ? null
  : "no usable provider in ~/.hamuna/config.json (needs defaultProviderId + baseUrl + key)";

let baseUrl = "";
let scratch = "";
let child: ChildProcess | undefined;
let sidecarOutput = "";

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((res, rej) =>
    server.close((e) => (e ? rej(e) : res())),
  );
  return port;
}

/**
 * 等端口真的能连上，而不是等日志里出现某个字样。
 *
 * 原先 `waitForReady` 靠匹配 sidecar 输出里的 `listening` / `ready` 判定就绪。
 * 那个字样可能在 HTTP server 真正 bind 之前就打出来，于是随后的
 * `fetch(/api/provider/set)` 撞 ECONNREFUSED，beforeAll 抛错、整份文件的用例
 * 全被标成 skipped —— 表现是"测试自己跳过了"，而不是"sidecar 没起来"。
 * 这里直接探端口，把这件事从日志猜测变成可验证的事实。
 */
async function waitForListening(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(
        `sidecar exited early (${child.exitCode}):\n${sidecarOutput.slice(-4000)}`,
      );
    }
    try {
      await fetch(`${baseUrl}/health/live`);
      return;
    } catch (e) {
      lastError = e;
    }
    await delay(250);
  }
  throw new Error(
    `sidecar never accepted a connection on ${baseUrl}: ${String(lastError)}\n` +
      `--- sidecar output ---\n${sidecarOutput.slice(-4000)}`,
  );
}

beforeAll(async () => {
  if (!provider) return;

  scratch = mkdtempSync(join(tmpdir(), "miniapp-ai-provider-"));
  const home = join(scratch, "home");
  const workspace = join(scratch, "workspace");
  const tmp = join(scratch, "tmp");
  for (const dir of [home, workspace, tmp]) mkdirSync(dir, { recursive: true });

  // appId 目录名与 meta.id 必须一致，否则 sidecar 会拒绝服务（见 appHostDispatch）。
  const appDir = join(home, ".hamuna", "miniapps", APP_ID);
  mkdirSync(join(appDir, "source"), { recursive: true });
  writeFileSync(
    join(appDir, "source", "index.html"),
    "<!doctype html><p>probe</p>",
    "utf8",
  );
  writeFileSync(
    join(appDir, "meta.json"),
    JSON.stringify({
      id: APP_ID,
      name: "AI Provider Probe",
      description: "real-provider credentialed fixture",
      icon: "p",
      category: "other",
      version: 1,
      min_host_version: "0.0.1",
      permissions: { ai: { enabled: true } },
    }),
    "utf8",
  );

  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(
    process.execPath,
    [
      "--import",
      "tsx/esm",
      resolve("src/server/index.ts"),
      "--agent-dir",
      workspace,
      "--port",
      String(port),
      "--no-pre-warm",
      "--sidecar-role",
      "global",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: tmp,
        TEMP: tmp,
        TMP: tmp,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (c) => {
    sidecarOutput += c.toString();
  });
  child.stderr?.on("data", (c) => {
    sidecarOutput += c.toString();
  });

  await waitForListening();

  // 推真实 provider。apiProtocol 决定 sidecar 走直连还是 bridge 分支。
  const setRes = await fetch(`${baseUrl}/api/provider/set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerEnv: {
        providerId: provider.providerId,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        authType: "api_key",
        ...(provider.apiProtocol ? { apiProtocol: provider.apiProtocol } : {}),
      },
    }),
  });
  if (!setRes.ok) {
    throw new Error(
      `provider/set failed (HTTP ${setRes.status}) for ${provider.providerId}`,
    );
  }
  // 推完触发一次 session 重启（bridge token 在这一轮注册），等它落定。
  await delay(2_000);
}, 120_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((r) => {
      const timer = setTimeout(r, 3_000);
      child?.once("exit", () => {
        clearTimeout(timer);
        r();
      });
    });
  }
  try {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* Windows 上句柄可能尚未释放；清理失败不影响断言结论 */
  }
});

async function call(method: string, params: unknown): Promise<Envelope> {
  const res = await fetch(`${baseUrl}/api/miniapp/app/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId: APP_ID, params }),
  });
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!body || typeof body.ok !== "boolean") {
    throw new Error(
      `${method} returned a non-envelope body (HTTP ${res.status})`,
    );
  }
  return body;
}

describe.skipIf(!provider)(
  "app.ai against the user-configured real provider",
  () => {
    it("completes a real prompt through the real upstream", async () => {
      // 显式带上该 provider 配好的主模型。
      //
      // 不带 model 时 `resolveHostModel` 返回 undefined，SDK 用的是**它自己的**
      // 默认模型（这里解析成 claude-opus-5），而不是宿主给这个 provider 配的主模型
      // —— 一个新建的 Global sidecar `configState.currentModel` 是空的，于是
      // `ANTHROPIC_DEFAULT_*_MODEL` 也不会被写进子进程 env，上游直接回
      // 503 model_not_found。真实会话里用户选过模型就不会撞上，所以这是**测试装置**
      // 的边界而不是产品缺陷；显式传模型也正是 MiniApp 作者该做的写法。
      const res = await call("ai.complete", {
        prompt: "Reply with the single word: PONG",
        ...(provider?.model ? { model: provider.model } : {}),
      });

      // 失败时把 sidecar 日志带出来定位，但**不含** key：sidecar 只打印 baseUrl。
      expect(
        res.ok,
        `provider=${provider?.providerId}\n${res.error?.message}\n${sidecarOutput.slice(-2000)}`,
      ).toBe(true);

      const text = res.result?.text;
      // 关键断言：拿到的是一段真文本 —— 不是空串、不是 undefined、也不是被当成
      // 补全结果交出来的 SDK 错误文案（`classifySdkMessage` 已挡 API 错误，这里
      // 再从作者视角钉一道）。
      expect(typeof text, "result.text must be a string").toBe("string");
      expect((text ?? "").trim().length).toBeGreaterThan(0);
      expect(text).not.toMatch(
        /not logged in|api[_ -]?error|authentication_failed/i,
      );
      // 让这次真实调用在日志里留痕，便于日后回看上游返回了什么。
      console.log(
        `[miniapp-ai-provider] real completion via ${provider?.providerId}: ${JSON.stringify(text)}`,
      );
    }, 120_000);
  },
);

describe("credentialed prerequisites", () => {
  it.skipIf(!!provider)(
    "reports why it was skipped when no provider is configured",
    () => {
      expect(skipReason).toMatch(/config\.json/);
    },
  );
});
