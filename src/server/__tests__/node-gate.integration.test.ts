// /api/miniapp/worker/spawn is a privilege GRANT: it hands the caller a live
// Node worker thread. The only shape allowed to proceed is an explicit
// `permissions.node.enabled === true` -- the same condition
// `checkAppPermission` applies to `call.call`
// (shared/miniapp/app-permissions.ts).
//
// Regression under test: the route used to test `enabled === false` only, so an
// app that declared NO `node` permission at all fell through it and got a
// worker, while the dispatch gate denied the very same app. Deleting one line
// from meta.json was therefore worth more than explicitly refusing.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_ID = 'node-gate-app';
let child: ChildProcess;
let baseUrl: string;
let sidecarOutput = '';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  return address.port;
}

async function waitForSidecar(base: string, deadlineMs = 60000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`sidecar exited early (code=${child.exitCode}):\n${sidecarOutput}`);
    }
    try {
      if ((await fetch(`${base}/health/ready`)).ok) return;
    } catch {
      // not listening yet
    }
    await delay(150);
  }
  throw new Error(`timed out waiting for sidecar:\n${sidecarOutput}`);
}

/** Writes a meta.json whose `permissions.node` is whatever `node` is. */
function writeApp(appId: string, node: unknown): void {
  const dir = join(home, '.hamuna', 'miniapps', appId);
  mkdirSync(dir, { recursive: true });
  const permissions: Record<string, unknown> = {
    fs: { read: ['{appdata}'], write: ['{appdata}'] },
  };
  // `undefined` means "the key is absent entirely", which is the shape the
  // old `=== false` test silently allowed.
  if (node !== undefined) permissions.node = node;
  writeFileSync(
    join(dir, 'meta.json'),
    // Fields below are NOT decoration: readDeclaredNode runs meta.json through
    // parseMiniAppMetadata FIRST, and that returns { ok:false } for anything
    // incomplete -- which readDeclaredNode collapses to `null`, which the gate
    // reads as "declared nothing". So a fixture missing `description`/`icon`
    // silently exercises the DENY path, and an `enabled: true` fixture looks
    // like a broken gate. Required here, mirroring bundled-miniapps/git-graph.
    JSON.stringify(
      {
        id: appId,
        name: appId,
        version: 1,
        min_host_version: '0.0.0',
        description: 'node permission gate fixture',
        icon: 'flask-conical',
        category: 'developer',
        entry: 'source/index.html',
        permissions,
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(join(dir, 'visible.txt'), 'VISIBLE-CONTENT', 'utf8');
}

let home = '';

async function spawnWorker(appId: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${baseUrl}/api/miniapp/worker/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, kind: 'file-explorer' }),
  });
  return { status: res.status, body: await res.json().catch(() => null) as Record<string, unknown> | null };
}

describe('/api/miniapp/worker/spawn node permission gate', () => {
  beforeAll(async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'miniapp-node-gate-'));
    home = join(scratch, 'home');
    const tmpDir = join(scratch, 'tmp');
    mkdirSync(home, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      ['--import', 'tsx/esm', resolve('src/server/index.ts'), '--agent-dir', join(home, '.hamuna', 'agent'), '--port', String(port)],
      {
        cwd: resolve('.'),
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          TMPDIR: tmpDir,
          TEMP: tmpDir,
          TMP: tmpDir,
          NO_PROXY: '127.0.0.1,localhost',
          no_proxy: '127.0.0.1,localhost',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout?.on('data', (c) => { sidecarOutput += c.toString(); });
    child.stderr?.on('data', (c) => { sidecarOutput += c.toString(); });
    await waitForSidecar(baseUrl);

    // Staged tsx runs resolve the worker entry next to the SOURCE dir, which
    // has no built artifact; copy the real one in so a permitted app can prove
    // it gets a *working* worker (otherwise every assertion below would pass
    // for the wrong reason).
    const kindsDir = resolve('src/server/miniapp-worker/kinds');
    const built = resolve('src-tauri/resources/worker-entry-file-explorer.js');
    if (existsSync(built)) {
      writeFileSync(join(kindsDir, 'worker-entry-file-explorer.js'), readFileSync(built));
    }
  }, 180_000);

  afterAll(() => {
    child?.kill();
    // Remove the artifact copy the gate test staged. Leaving a built
    // worker-entry-*.js beside the kinds would make every LATER spawn resolve
    // in dev too, hiding the "entry is missing" failure mode from whoever
    // debugs it next.
    try {
      rmSync(join(resolve('src/server/miniapp-worker/kinds'), 'worker-entry-file-explorer.js'), { force: true });
    } catch {
      // never copied (no built artifact present) -- nothing to undo
    }
  });

  it('every fixture shape validates, so the gate is what decides', async () => {
    // Isolates fixture shape from gate behaviour WITHOUT touching HOME.
    // readMiniAppNodePermission collapses a schema-invalid meta.json to `null`,
    // and `null` is indistinguishable from "no node permission" at the gate --
    // so a fixture missing `description`/`icon`/integer `version` makes every
    // deny test pass and the allow test fail, which reads like a broken gate.
    // (It was: this file failed three times before naming the real cause.)
    //
    // Deliberately does NOT call readMiniAppNodePermission: that runs in THIS
    // process, whose HOME is the real user home, not the child sidecar's
    // sandbox. Only the spawned sidecar sees `home`.
    const { parseMiniAppMetadata } = await import('../../shared/miniapp/meta-schema');

    const validate = (node: unknown): ReturnType<typeof parseMiniAppMetadata> => {
      const permissions: Record<string, unknown> = { fs: { read: ['{appdata}'], write: ['{appdata}'] } };
      if (node !== undefined) permissions.node = node;
      writeApp('fixture-shape', node);
      return parseMiniAppMetadata({
        id: 'fixture-shape',
        name: 'fixture-shape',
        version: 1,
        min_host_version: '0.0.0',
        description: 'node permission gate fixture',
        icon: 'flask-conical',
        category: 'developer',
        entry: 'source/index.html',
        permissions,
      });
    };

    for (const node of [undefined, { enabled: false }, { enabled: true }, { max_memory_mb: 128 }]) {
      const parsed = validate(node);
      expect(parsed.ok, `fixture ${JSON.stringify(node)} must validate`).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.permissions.node ?? null).toEqual(node ?? null);
      }
    }
  });

  it('refuses when permissions.node is not declared at all', async () => {
    writeApp('node-absent', undefined);
    const { status, body } = await spawnWorker('node-absent');
    expect(status).toBe(403);
    expect(body?.ok).toBe(false);
    expect(body?.workerId).toBeUndefined();
    expect(String(body?.error)).toContain('not declared');
  });

  it('refuses when permissions.node.enabled is false', async () => {
    writeApp('node-false', { enabled: false });
    const { status, body } = await spawnWorker('node-false');
    expect(status).toBe(403);
    expect(body?.ok).toBe(false);
    expect(body?.workerId).toBeUndefined();
    expect(String(body?.error)).toContain('enabled = false');
  });

  it('refuses when permissions.node exists but omits enabled', async () => {
    writeApp('node-no-flag', { max_memory_mb: 128 });
    const { status, body } = await spawnWorker('node-no-flag');
    expect(status).toBe(403);
    expect(body?.workerId).toBeUndefined();
  });

  it('refuses an unknown app that has no meta.json at all', async () => {
    const { status, body } = await spawnWorker('never-installed-app');
    expect(status).toBe(403);
    expect(body?.workerId).toBeUndefined();
  });

  it('spawns and serves a real call when enabled === true', async () => {
    writeApp(APP_ID, { enabled: true });
    const { status, body } = await spawnWorker(APP_ID);
    expect(status).toBe(200);
    expect(body?.ok).toBe(true);
    const workerId = body?.workerId as string | undefined;
    expect(typeof workerId).toBe('string');

    if (!workerId) return;
    try {
      // Proof it is a live worker, not just an id: it executes and returns
      // real file bytes from inside its fs scope.
      const res = await fetch(`${baseUrl}/api/miniapp/worker/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerId,
          method: 'file.read',
          params: { path: join(home, '.hamuna', 'miniapps', APP_ID, 'visible.txt') },
        }),
      });
      const callBody = await res.json().catch(() => null);
      expect(callBody?.ok).toBe(true);
      expect(JSON.stringify(callBody)).toContain('VISIBLE-CONTENT');
    } finally {
      await fetch(`${baseUrl}/api/miniapp/worker/terminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId }),
      });
    }
  });

  it('agrees with checkAppPermission, which already required enabled === true', async () => {
    // Pins the two gates together in one place: if this ever diverges again the
    // failure names both sides rather than leaving it to be rediscovered.
    const { checkAppPermission } = await import('../../shared/miniapp/app-permissions');
    const denied = checkAppPermission('call.call', {}, {} as never);
    expect(denied.allowed).toBe(false);
    const allowed = checkAppPermission('call.call', {}, { node: { enabled: true } } as never);
    expect(allowed.allowed).toBe(true);
  });
});