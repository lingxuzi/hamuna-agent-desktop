// worker-entry-git-graph.ts — git-graph worker thread bootstrap.
//
// Spawned by `MiniAppWorkerPool` when a MiniApp declares `kind: 'worker'` +
// `worker_kind: 'git-graph'`. Three jobs:
//   1. Install the require shim FIRST (worker_threads shares V8 isolate with
//      the Sidecar; a runaway `process.exit` would kill the whole Sidecar).
//   2. Read the bound kind def from `kinds/git-graph.ts` (handlers are
//      already wired by the kind module — no rebinding here).
//   3. Start the JSON-RPC router: `parentPort.on('message', dispatch)`.
//
// ponytail: handler = `simple-git` (read + checkout only). Phase 3 demo
// scope-out: `git.commit/push` are NOT exposed. Phase 4 will generalize the
// entry pattern via the kinds/ registry; this file is git-graph-specific.

import { parentPort, workerData } from 'node:worker_threads';

import { installRequireShim } from './require-shim';
import { GIT_GRAPH_KIND } from './kinds/git-graph';
import type {
  WorkerInbound,
  WorkerOutbound,
} from './worker-rpc';

installRequireShim();

interface WorkerBootstrapData {
  appId: string;
  kind: string;
  init?: Record<string, unknown>;
  fsScope?: { read: string[]; write: string[] };
}

const { appId, fsScope } = workerData as WorkerBootstrapData;
// Absent scope = no access; see worker-entry-file-explorer.ts for why.
const scope = fsScope ?? { read: [], write: [] };

function send(msg: WorkerOutbound): void {
  parentPort?.postMessage(msg);
}

parentPort?.on('message', async (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as WorkerInbound;

  if (msg.type === 'shutdown') {
    send({ type: 'event', event: 'shutdown-ack' });
    return;
  }

  if (msg.type === 'call') {
    const def = GIT_GRAPH_KIND.methods.find((m) => m.name === msg.method);
    if (!def) {
      send({
        type: 'response',
        id: msg.id,
        ok: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: `method '${msg.method}' not registered`,
        },
      });
      return;
    }

    const parsed = def.schema.safeParse(msg.params);
    if (!parsed.success) {
      send({
        type: 'response',
        id: msg.id,
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: `params failed schema: ${parsed.error.message}`,
        },
      });
      return;
    }

    try {
      const result = await def.handler(parsed.data, { appId, fsScope: scope });
      send({ type: 'response', id: msg.id, ok: true, result });
    } catch (e) {
      const err = e as Error;
      send({
        type: 'response',
        id: msg.id,
        ok: false,
        error: { code: 'HANDLER_ERROR', message: err.message },
      });
    }
    return;
  }
});