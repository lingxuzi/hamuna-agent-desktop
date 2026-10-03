/**
 * `window.app.*` sidecar 侧执行层（对齐 OpenBitFun `miniapp-dev` 设计）。
 *
 * 对应 OpenBitFun 的 `host_dispatch`：MiniApp 声明的框架原语（fs / shell /
 * net / os / storage / dialog / clipboard）由宿主直接执行，**不要求 MiniApp
 * 带 `worker.js`**。这是本次对齐的核心收益 —— `kind: 'iframe'` 的纯前端
 * MiniApp 也能用文件系统和 shell，不必升级成 worker kind。
 *
 * 安全模型（纵深防御，缺一层都不行）：
 *   1. renderer `appBridge.checkAppPermission` 按 `meta.json::permissions` 判一次
 *   2. 本层**重新读 meta.json** 判第二次 —— renderer 是 WebView，声明的权限
 *      不能作为唯一信任来源（XSS / 消息伪造都可能绕过 renderer 侧逻辑）
 *   3. fs 路径经 `path-safety` 二次校验 + 强制落在 appdata / workspace /
 *      user-selected 之内
 *   4. shell 走 `child_process.exec` 且命令名必须命中白名单
 *   5. net 强制 https + 域名白名单 + 禁私网/环回（SSRF 红线）
 *
 * 所有 Node 内置模块**按需 `await import()`**：sidecar 冷启动不该为没装
 * MiniApp 的用户付出这些模块的初始化税（对齐 CLAUDE.md「Builtin MCP 懒加载」
 * 的既有约定）。
 */

import { getConfigDir } from './utils/admin-config';
import { APP_ERROR_CODES } from '../shared/miniapp/app-protocol';
import { checkAppPermission, isPrivateHostname } from '../shared/miniapp/app-permissions';
import type { MiniAppMetadata, MiniAppPermissions } from '../shared/miniapp/types';

export interface DispatchOutcome {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

function ok(result: unknown): DispatchOutcome {
  return { ok: true, result };
}
function fail(code: string, message: string): DispatchOutcome {
  return { ok: false, error: { code, message } };
}
/**
 * MiniApp 根目录：`~/.hamuna/miniapps/<appId>`。
 *
 * 导出给 `/api/miniapp/source` 用：renderer 要把 `app.appDataDir` 下发给作者，
 * 而这个值同时是 `{appdata}` 权限前缀展开的基准 —— 路径模板只能有一处，两处各拼
 * 一次早晚漂移成"作者看到的目录"与"实际授权的目录"不是同一个。
 */
export function miniappAppRoot(appId: string): string {
  return `${getConfigDir()}/miniapps/${appId}`;
}

/** 读并解析 meta.json。读不到 = 拒绝（fail-closed）。 */
async function loadMeta(appId: string): Promise<MiniAppMetadata | null> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  try {
    const raw = await readFile(join(miniappAppRoot(appId), 'meta.json'), 'utf8');
    const meta = JSON.parse(raw) as MiniAppMetadata;
    // meta.id 必须与目录名一致，防目录穿越式冒名
    return meta.id === appId ? meta : null;
  } catch {
    return null;
  }
}

interface Resolved {
  appdata: string;
  workspaceDir: string | null;
  perms: MiniAppPermissions;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function requireString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * 把 `permissions.fs.*` 里的路径模板展开成绝对前缀，让 shared 的
 * `checkAppPermission` 能直接做前缀比较。
 *
 * 只有 `{appdata}` 与 `{workspace}` 在本层可解析；`{user-selected}` 依赖
 * dialog 记录的用户选择，Phase 2 再接，因此展开为空串 —— 空串在
 * `isPathAllowed` 里恒不匹配，即"声明了但当前不可用"，是安全的失败方向。
 */
function expandTemplates(
  raws: readonly string[] | undefined,
  ctx: { appdata: string; workspaceDir: string | null },
): string[] {
  if (!raws) return [];
  const out: string[] = [];
  for (const raw of raws) {
    if (raw.startsWith('{appdata}')) out.push(ctx.appdata + raw.slice('{appdata}'.length));
    else if (raw.startsWith('{workspace}') && ctx.workspaceDir) {
      out.push(ctx.workspaceDir + raw.slice('{workspace}'.length));
    } else out.push('');
  }
  return out;
}

/**
 * 执行一次 `app.*` 调用。
 *
 * 永不抛异常：所有失败都转成 `{ok:false,error}`，调用方直接回信给 iframe。
 */
export async function dispatchMiniAppApp(
  method: string,
  appId: string,
  rawParams: unknown,
  ctx: { workspaceDir?: string | null } = {},
): Promise<DispatchOutcome> {
  const meta = await loadMeta(appId);
  if (!meta) {
    return fail(APP_ERROR_CODES.PERMISSION_DENIED, `MiniApp '${appId}' has no readable meta.json`);
  }
  const resolved: Resolved = {
    appdata: miniappAppRoot(appId),
    workspaceDir: ctx.workspaceDir ?? null,
    perms: meta.permissions ?? {},
  };
  const params = asRecord(rawParams);
  const [group, name] = method.split('.');

  // 纵深防御的第二道闸门：renderer 是 WebView，它的判定可被绕过，这里必须
  // 独立复算。`resolvePolicyForSidecar` 把 meta.json 里的路径模板先展开成
  // 绝对前缀，再交给 shared 的同一份 `checkAppPermission` —— 与 renderer
  // 共用判定，避免两侧语义漂移。
  const policy: MiniAppPermissions = {
    ...resolved.perms,
    fs: {
      read: expandTemplates(resolved.perms.fs?.read, resolved),
      write: expandTemplates(resolved.perms.fs?.write, resolved),
    },
  };
  const decision = checkAppPermission(method, rawParams, policy);
  if (!decision.allowed) {
    return fail(decision.code ?? APP_ERROR_CODES.PERMISSION_DENIED, decision.reason ?? 'denied');
  }

  try {
    switch (group) {
      case 'fs':
        return await dispatchFs(name ?? '', params);
      case 'shell':
        return await dispatchShell(params, resolved);
      case 'net':
        return await dispatchNet(params);
      case 'os':
        return await dispatchOs();
      case 'storage':
        return await dispatchStorage(name ?? '', params, resolved);
      case 'ai':
        return await dispatchAi(name ?? '', params, appId, resolved);
      case 'agent':
        return await dispatchAgent(name ?? '', params, resolved);
      case 'dialog':
      case 'clipboard':
        // 这两组是 Tauri 原生能力，sidecar 进程永远够不到 OS 对话框 / 剪贴板。
        // 它们在**派发前**就被 renderer 的 `appHostDispatch.ts` 截走（走
        // `@tauri-apps/plugin-dialog` 与 `cmd_clipboard_*`），请求根本不会到达
        // 这里。保留显式失败而非静默 no-op：若哪天派发链断了，作者会立刻看到
        // "这个方法没接上"，而不是拿到一个假装成功的 undefined。
        return fail(
          APP_ERROR_CODES.HOST_ERROR,
          `app.${group} must be dispatched by the renderer host, not the sidecar`,
        );
      case 'call':
        return fail(
          APP_ERROR_CODES.PERMISSION_DENIED,
          'app.call requires meta.permissions.node.enabled = true; use the worker bridge',
        );
      default:
        return fail(APP_ERROR_CODES.UNKNOWN_METHOD, `Unknown method group '${group}'`);
    }
  } catch (e) {
    return fail(APP_ERROR_CODES.HOST_ERROR, e instanceof Error ? e.message : String(e));
  }
}

/**
 * `ai.complete(prompt)` 与 `ai.chat(messages)` 的入参归一。
 *
 * 参考文档给的就是这两种形态，而只有 `complete` 用字符串 —— 照文档写
 * `app.ai.chat([{role, content}], {...})` 的作者会在 `requireString` 处拿到
 * `INVALID_PARAMS`：文档里的标准写法直接跑不通。
 *
 * `messages` 被**拍平成一段对话文本**而不是当成真正的多轮：`app.ai` 是
 * `maxTurns: 1` + `tools: []` 的一次性补全，作者传回来的数组是他自己攒的历史，
 * 宿主并不维护会话（那是 `app.agent` 的事）。
 */
function normalizeAiPrompt(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const turns: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const role = typeof rec.role === 'string' ? rec.role.trim() : '';
    const content = typeof rec.content === 'string' ? rec.content.trim() : '';
    if (!role || !content) continue;
    turns.push(`${role}: ${content}`);
  }
  return turns.length > 0 ? turns.join('\n\n') : null;
}

/**
 * 数字型 opts 取值。参考文档用 camelCase（`maxTokens`），本项目一贯用
 * snake_case —— 两种都收，否则作者照文档写的那个键会被静默忽略，表现为
 * "我设了上限，模型照样超"。
 */
function numberOpt(opts: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = opts[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

async function dispatchAi(
  name: string,
  params: Record<string, unknown>,
  appId: string,
  ctx: Resolved,
): Promise<DispatchOutcome> {
  // 顶层 `checkAppPermission` 已验过 `ai.enabled` 与 `allowed_models`。
  const { runMiniAppAiComplete, listMiniAppAiModels, cancelMiniAppAiCall } = await import(
    './miniapp-ai'
  );
  if (name === 'getModels') return listMiniAppAiModels();
  if (name === 'cancel') {
    // 未命中返回 ok({cancelled:false}) 而不是错误：作者在请求已完成后再 cancel
    // 是网络往返的必然结果，不是异常。
    return ok(
      cancelMiniAppAiCall(
        appId,
        typeof params.run_id === 'string' && params.run_id ? params.run_id : 'default',
      ),
    );
  }
  if (name === 'complete' || name === 'chat') {
    const prompt = normalizeAiPrompt(params.prompt);
    if (!prompt) {
      return fail(
        APP_ERROR_CODES.INVALID_PARAMS,
        `ai.${name} requires a prompt string or a non-empty messages array`,
      );
    }
    const opts = asRecord(params.opts);
    return runMiniAppAiComplete({
      appId,
      prompt,
      // runId 是 cancel 的瞄准镜。不传时用 'default'：同一个 MiniApp 串行调用
      // 时能取消，并发调用时作者应显式传 run_id（文档已说明）。
      runId:
        typeof params.run_id === 'string' && params.run_id
          ? params.run_id
          : typeof opts.run_id === 'string' && opts.run_id
            ? opts.run_id
            : 'default',
      model: typeof params.model === 'string' ? params.model : undefined,
      // 作者给了就用作者的。默认 SYSTEM_PROMPT 只是段自我介绍，安全不靠它 ——
      // 真正的闸门是 `tools: []` + `mcpServers: {}`：模型没有任何可调用对象，
      // 换掉提示词也换不出工具来。
      systemPrompt: typeof opts.systemPrompt === 'string' ? opts.systemPrompt : undefined,
      maxTokens: numberOpt(opts, 'maxTokens', 'max_tokens'),
      timeoutMs: numberOpt(opts, 'timeoutMs', 'timeout_ms'),
      rateLimitPerMinute: ctx.perms.ai?.rate_limit_per_minute,
      maxTokensPerRequest: ctx.perms.ai?.max_tokens_per_request,
    });
  }
  return fail(APP_ERROR_CODES.UNKNOWN_METHOD, `Unknown ai method '${name}'`);
}

async function dispatchAgent(
  name: string,
  params: Record<string, unknown>,
  ctx: Resolved,
): Promise<DispatchOutcome> {
  const { runMiniAppAgentTurn, stopMiniAppAgentTurn, describeMiniAppAgentStream } = await import(
    './miniapp-agent'
  );
  if (name === 'ensureSession' || name === 'onEvent') {
    return describeMiniAppAgentStream();
  }
  if (name === 'run' || name === 'turnText') {
    const prompt = requireString(params.prompt);
    if (!prompt) return fail(APP_ERROR_CODES.INVALID_PARAMS, `agent.${name} requires a prompt`);
    // workspace 强制落在 MiniApp 自己的 appdata 下：Agent 有工具，能读写文件，
    // 让它写 MiniApp 目录之外就是完整的任意文件写。声明了 workspace_scope 也
    // 不放开 —— 那是给未来"用户显式授权某个目录"留的口子，现在没有可信的授权
    // 记录来源，空开等于没有。
    return runMiniAppAgentTurn({
      prompt,
      workspacePath: ctx.appdata,
      model: typeof params.model === 'string' ? params.model : undefined,
      timeoutMs: typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined,
      runId: typeof params.run_id === 'string' ? params.run_id : 'default',
    });
  }
  if (name === 'cancel') {
    return stopMiniAppAgentTurn(typeof params.run_id === 'string' ? params.run_id : 'default');
  }
  return fail(APP_ERROR_CODES.UNKNOWN_METHOD, `Unknown agent method '${name}'`);
}

/** stat / lstat 共用的归一化输出。`isSymbolicLink` 只在 lstat 下有判别力。 */
function describeStat(s: {
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mtimeMs: number;
  ctimeMs: number;
}): Record<string, unknown> {
  return {
    size: s.size,
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymbolicLink: s.isSymbolicLink(),
    mtime: s.mtimeMs,
    ctime: s.ctimeMs,
  };
}

async function dispatchFs(name: string, params: Record<string, unknown>): Promise<DispatchOutcome> {
  // Permission (including the path-prefix check) already passed above against
  // the expanded policy; this layer only executes.
  const { readFile, writeFile, appendFile, readdir, mkdir, rm, rmdir, stat, lstat, access, unlink, copyFile, rename } =
    await import('node:fs/promises');
  switch (name) {
    case 'readFile': {
      const enc = asRecord(params.opts).encoding === 'base64' ? 'base64' : 'utf8';
      return ok(await readFile(params.path as string, enc));
    }
    case 'writeFile': {
      const enc = asRecord(params.opts).encoding === 'base64' ? 'base64' : 'utf8';
      await writeFile(params.path as string, String(params.data ?? ''), enc);
      return ok(null);
    }
    case 'appendFile':
      await appendFile(params.path as string, String(params.data ?? ''));
      return ok(null);
    case 'readdir': {
      const withFileTypes = asRecord(params.opts).withFileTypes === true;
      // 两次调用分叉：withFileTypes 的返回类型是 Dirent[]，运行时才能确定，
      // TS 无法在同一个变量上同时收窄成 string[] | Dirent[]。
      if (withFileTypes) {
        const entries = await readdir(params.path as string, { withFileTypes: true });
        return ok(
          entries.map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() })),
        );
      }
      return ok(await readdir(params.path as string));
    }
    case 'mkdir':
      await mkdir(params.path as string, { recursive: asRecord(params.opts).recursive === true });
      return ok(null);
    case 'rm':
      await rm(params.path as string, {
        recursive: asRecord(params.opts).recursive === true,
        force: asRecord(params.opts).force === true,
      });
      return ok(null);
    case 'stat': {
      const s = await stat(params.path as string);
      return ok(describeStat(s));
    }
    case 'rmdir':
      await rmdir(params.path as string);
      return ok(null);
    case 'unlink':
      await unlink(params.path as string);
      return ok(null);
    case 'lstat': {
      // lstat 不跟随 symlink：MiniApp 用它判断"这是不是个链接"，
      // 跟随了就永远得到 false，链接检测会静默失效。
      const s = await lstat(params.path as string);
      return ok(describeStat(s));
    }
    case 'access': {
      // 只回传"能不能访问"，不回传 errno —— 作者要的是布尔判断，
      // 暴露 errno 只会诱使他去匹配平台相关的错误码。
      try {
        await access(params.path as string);
        return ok(true);
      } catch {
        return ok(false);
      }
    }
    case 'copyFile':
      await copyFile(params.from as string, params.to as string);
      return ok(null);
    case 'rename':
      await rename(params.from as string, params.to as string);
      return ok(null);
    default:
      return fail(APP_ERROR_CODES.UNKNOWN_METHOD, `Unknown fs method '${name}'`);
  }
}

async function dispatchShell(
  params: Record<string, unknown>,
  ctx: Resolved,
): Promise<DispatchOutcome> {
  // Authorization already passed in `dispatchMiniAppApp` (command-name
  // allow-list); this layer only executes.
  const command = requireString(params.command);
  if (!command) return fail(APP_ERROR_CODES.INVALID_PARAMS, 'shell.exec requires a command');
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(exec);
  const opts = asRecord(params.opts);
  // Never let a MiniApp-chosen cwd escape the workspace — a relative `..` in
  // opts.cwd would otherwise run commands anywhere on the user's disk.
  const cwd =
    typeof opts.cwd === 'string' && ctx.workspaceDir && opts.cwd.startsWith(ctx.workspaceDir)
      ? opts.cwd
      : ctx.workspaceDir ?? undefined;
  try {
    const { stdout, stderr } = await run(command, {
      cwd,
      timeout: typeof opts.timeout === 'number' ? opts.timeout : 30_000,
      // 不继承 shell 环境，避免读到宿主凭据
      env: { PATH: process.env.PATH ?? '' },
    });
    return ok({ stdout, stderr, exit_code: 0 });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number; message?: string };
    return ok({
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      exit_code: typeof err.code === 'number' ? err.code : 1,
    });
  }
}

async function dispatchNet(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const url = requireString(params.url);
  if (!url) return fail(APP_ERROR_CODES.INVALID_PARAMS, 'net.fetch requires a url');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(APP_ERROR_CODES.INVALID_PARAMS, 'url is not a valid URL');
  }
  // https-only + domain allow-list already passed in `dispatchMiniAppApp`.
  // The private-address check stays HERE and not in the shared policy: a
  // MiniApp's allow-list legitimately contains public hostnames, and only the
  // sidecar that is about to open the socket can weigh the SSRF risk of the
  // resolved target.
  if (isPrivateHostname(parsed.hostname)) {
    return fail(APP_ERROR_CODES.PERMISSION_DENIED, 'net.fetch target resolves to a private address');
  }
  // 有 AbortSignal：下游卡住不能把 tool turn 永久 hang 住
  // （CLAUDE.md §Pit-of-Success "工具裸 fetch 无 AbortSignal"）。
  const { cancellableFetch } = await import('./utils/cancellation');
  const opts = asRecord(params.opts);
  const timeoutMs = typeof opts.timeout_ms === 'number' ? opts.timeout_ms : 30_000;
  const res = await cancellableFetch(
    url,
    {
      method: typeof opts.method === 'string' ? opts.method : 'GET',
      headers: asRecord(opts.headers) as Record<string, string>,
      body: typeof opts.body === 'string' ? opts.body : undefined,
    },
    { timeoutMs },
  );
  return ok({ status: res.status, body: await res.text() });
}

async function dispatchOs(): Promise<DispatchOutcome> {
  const os = await import('node:os');
  return ok({
    platform: os.platform(),
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    hostname: os.hostname(),
  });
}

async function dispatchStorage(
  name: string,
  params: Record<string, unknown>,
  ctx: Resolved,
): Promise<DispatchOutcome> {
  const key = requireString(params.key);
  if (!key) return fail(APP_ERROR_CODES.INVALID_PARAMS, `storage.${name} requires a key`);
  const { readFile, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { withFileLock } = await import('./utils/file-lock');
  // 固定落在 appdata 下的 storage.json —— MiniApp 不能通过 key 越出该文件。
  const store = join(ctx.appdata, 'storage.json');
  // 整个读-改-写必须在锁内：`await readFile` 与 `await writeFile` 之间存在挂起
  // 窗口，两个并发 set 各自读到同一份旧快照，后写的把先写的整个覆盖掉，而两个
  // Promise 都会 resolve —— 作者那边完全看不出丢了一次写。同理 get 也要在锁内，
  // 否则可能读到写了一半的文件。
  // （CLAUDE.md Pit-of-Success「单写者文件裸 read-modify-write」）
  return withFileLock({ lockPath: `${store}.lock` }, async () => {
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await readFile(store, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      data = {};
    }
    if (name === 'get') return ok(data[key]);
    if (name === 'remove') {
      if (!(key in data)) return ok(false);
      delete data[key];
      await writeFile(store, JSON.stringify(data, null, 2), 'utf8');
      return ok(true);
    }
    if (name === 'set') {
      data[key] = params.value ?? null;
      await writeFile(store, JSON.stringify(data, null, 2), 'utf8');
      return ok(null);
    }
    return fail(APP_ERROR_CODES.UNKNOWN_METHOD, `Unknown storage method '${name}'`);
  });
}
