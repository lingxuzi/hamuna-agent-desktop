// worker-entry-file-explorer.ts — file-explorer worker thread bootstrap.
//
// Identical pattern to worker-entry-git-graph.ts; Phase 4.1 made this a
// 3-line shim around the kind def — install require shim, import the
// kind's methods, route parentPort messages.

import { parentPort, workerData } from 'node:worker_threads';

import { installRequireShim } from './require-shim';
import { FILE_EXPLORER_KIND } from './kinds/file-explorer';
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
// Absent scope = no access. `isPathAllowed` never matches an empty prefix list,
// so a spawn that forgot to resolve one yields a worker that reads nothing.
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
    const def = FILE_EXPLORER_KIND.methods.find((m) => m.name === msg.method);
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
