// kb-service.ts — KB HTTP dispatcher + handler shim.
//
// The knowledge base (资料库) backend now lives in this sidecar (TypeGraph +
// SQLite, jieba pre-tokenization). The HTTP surface preserves the old Rust
// `/api/kb/*` contract (`{ ok, ... }`) so callers that used to hit Rust over
// HTTP can either keep doing that (HTTP routes here) or call the in-process
// handlers directly (e.g. the kb-relations poller / kb-tool / kb-ingest).
//
// Lazy imports throughout — this module is only loaded when a KB route is
// actually hit, keeping cold start untouched.

import {
  addText,
  createKb,
  deleteKb,
  graphData,
  graphSummary,
  listDocs,
  listKbs,
  listMounts,
  mountsForWorkspace,
  peekPending,
  query as kbQuery,
  rebuild,
  removePending,
  renameKb,
  saveRelations,
  setMounts,
  takePendingAll,
} from './kb-store';

// ── HTTP error shape (shared) ──────────────────────────────────────────────

function fail(err: unknown): Record<string, unknown> {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Wrap a `{ ok, ... }` handler response. Logical failures (`ok === false`)
 * become HTTP 400 so the renderer's `apiFetch` helpers throw — matching the
 * rejection semantics of the old `invoke('cmd_kb_*')` calls they replace.
 * Unknown / unexpected throws become HTTP 500.
 */
function respond(payload: Record<string, unknown>, fallbackStatus: number): Response {
  const status = payload.ok === true ? 200 : payload.ok === false ? 400 : fallbackStatus;
  return jsonResponse(payload, status);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── HTTP dispatcher (raw `handleRequest` calls this for /api/admin/kb/*) ───

/**
 * Dispatch a /api/admin/kb/* request. Lazy-loaded from index.ts so the kb
 * modules stay out of cold start. Returns the same `{ ok, ... }` shape the
 * Rust management API used — callers can keep checking `result.ok !== true`.
 *
 * NOTE: /api/admin/kb/ingest is NOT matched here (it keeps flowing through
 * routeAdminApi's existing kb/ingest branch, which lazily calls
 * `ingestKbMaterial` for the heavy parsing libs).
 */
export async function handleKbAdminRequest(request: Request, pathname: string): Promise<Response> {
  const method = request.method;
  const url = new URL(request.url);

  try {
    // GET routes ────────────────────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/admin/kb/list') {
      return respond(await handleKbList(), 200);
    }
    if (method === 'GET' && pathname === '/api/admin/kb/mounts') {
      return respond(await handleKbMountList(), 200);
    }
    if (method === 'GET' && pathname === '/api/admin/kb/graph-data') {
      return respond(await handleKbGraphData({ kbId: url.searchParams.get('kbId') ?? '' }), 200);
    }
    if (method === 'GET' && pathname === '/api/admin/kb/graph-summary') {
      return respond(await handleKbGraphSummary({ kbId: url.searchParams.get('kbId') ?? '' }), 200);
    }
    if (method === 'GET' && pathname === '/api/admin/kb/docs') {
      return respond(await handleKbDocs({ kbId: url.searchParams.get('kbId') ?? '' }), 200);
    }
    if (method === 'GET' && pathname === '/api/admin/kb/pending-relations') {
      const limit = Number(url.searchParams.get('limit')) || 10;
      return respond(await handleKbPending(url.searchParams.get('kbId') ?? '', limit), 200);
    }
    if (method === 'GET' && pathname === '/api/admin/kb/pending-relations/all') {
      const limit = Number(url.searchParams.get('limit')) || 10;
      return respond(await handleKbPendingAll(limit), 200);
    }

    // POST/PUT/DELETE routes — share a body parser. ─────────────────────────
    const payload = await readJson(request);

    if (pathname === '/api/admin/kb/create') {
      return respond(await handleKbCreate({ name: String(payload.name ?? '') }), 200);
    }
    if (pathname === '/api/admin/kb/rename') {
      return respond(await handleKbRename({ kbId: String(payload.kbId ?? ''), name: String(payload.name ?? '') }), 200);
    }
    if (pathname === '/api/admin/kb/delete') {
      return respond(await handleKbDelete({ kbId: String(payload.kbId ?? '') }), 200);
    }
    if (pathname === '/api/admin/kb/add-text') {
      return respond(await handleKbAddText({
        kbId: String(payload.kbId ?? ''),
        title: String(payload.title ?? ''),
        text: String(payload.text ?? ''),
      }), 200);
    }
    if (pathname === '/api/admin/kb/rebuild') {
      return respond(await handleKbRebuild({ kbId: String(payload.kbId ?? '') }), 200);
    }
    if (pathname === '/api/admin/kb/mounts') {
      return respond(await handleKbMountSet({
        workspace: String(payload.workspace ?? ''),
        kbIds: Array.isArray(payload.kbIds) ? (payload.kbIds as string[]) : [],
      }), 200);
    }
    if (pathname === '/api/admin/kb/query') {
      return respond(await handleKbQuery({
        kbIds: Array.isArray(payload.kbIds) ? (payload.kbIds as string[]) : [],
        query: String(payload.query ?? ''),
        ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
      }), 200);
    }
    if (pathname === '/api/admin/kb/relations') {
      return respond(await handleKbRelations({
        kbId: String(payload.kbId ?? ''),
        entities: Array.isArray(payload.entities) ? (payload.entities as Parameters<typeof handleKbRelations>[0]['entities']) : [],
        relations: Array.isArray(payload.relations) ? (payload.relations as Parameters<typeof handleKbRelations>[0]['relations']) : [],
      }), 200);
    }
    if (pathname === '/api/admin/kb/pending-relations/done') {
      return respond(await handleKbPendingDone({
        kbId: String(payload.kbId ?? ''),
        chunkIds: Array.isArray(payload.chunkIds) ? (payload.chunkIds as string[]) : [],
      }), 200);
    }

    return jsonResponse({ ok: false, error: `Unknown KB route: ${method} ${pathname}` }, 404);
  } catch (err) {
    console.error('[kb-api] error:', err);
    return jsonResponse(fail(err), 500);
  }
}

// ── Handler shim functions (used by HTTP routes + in-process callers) ─────

export async function handleKbList(): Promise<Record<string, unknown>> {
  try {
    return { ok: true, kbs: await listKbs() };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbCreate(payload: { name: string }): Promise<Record<string, unknown>> {
  try {
    return { ok: true, kb: await createKb(payload.name) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbRename(payload: { kbId: string; name: string }): Promise<Record<string, unknown>> {
  try {
    await renameKb(payload.kbId, payload.name);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbDelete(payload: { kbId: string }): Promise<Record<string, unknown>> {
  try {
    await deleteKb(payload.kbId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbAddText(payload: { kbId: string; title: string; text: string }): Promise<Record<string, unknown>> {
  try {
    return { ok: true, summary: await addText(payload.kbId, payload.title, payload.text) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbDocs(payload: { kbId: string }): Promise<Record<string, unknown>> {
  try {
    return { ok: true, docs: await listDocs(payload.kbId) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbRebuild(payload: { kbId: string }): Promise<Record<string, unknown>> {
  try {
    return { ok: true, summary: await rebuild(payload.kbId) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbGraphData(payload: { kbId: string }): Promise<Record<string, unknown>> {
  try {
    return { ok: true, ...(await graphData(payload.kbId)) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbGraphSummary(payload: { kbId: string }): Promise<Record<string, unknown>> {
  try {
    return { ok: true, ...(await graphSummary(payload.kbId)) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbMountList(): Promise<Record<string, unknown>> {
  try {
    return { ok: true, mounts: await listMounts() };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbMountSet(payload: { workspace: string; kbIds: string[] }): Promise<Record<string, unknown>> {
  try {
    await setMounts(payload.workspace, payload.kbIds);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbQuery(payload: {
  kbIds: string[];
  query: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  try {
    return { ok: true, ...(await kbQuery(payload.kbIds, payload.query, payload.limit)) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbPending(kbId: string, limit: number): Promise<Record<string, unknown>> {
  try {
    return { ok: true, tasks: await peekPending(kbId, limit) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbPendingAll(limit: number): Promise<Record<string, unknown>> {
  try {
    return { ok: true, tasks: await takePendingAll(limit) };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbPendingDone(payload: { kbId: string; chunkIds: string[] }): Promise<Record<string, unknown>> {
  try {
    await removePending(payload.kbId, payload.chunkIds);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function handleKbRelations(payload: {
  kbId: string;
  entities: Array<{ id: string; label: string; entityType?: string; sources?: string[] }>;
  relations: Array<{ subject: string; object: string; relationType: string; weight: number; typed: boolean }>;
}): Promise<Record<string, unknown>> {
  try {
    await saveRelations(
      payload.kbId,
      payload.entities.map((e) => ({ id: e.id, label: e.label, ...(e.entityType !== undefined ? { entityType: e.entityType } : {}), sources: e.sources ?? [] })),
      payload.relations.map((r) => ({ subject: r.subject, object: r.object, relationType: r.relationType, weight: r.weight, typed: r.typed })),
    );
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// Also exported for direct in-process callers (kb-tool, kb-relations, kb-ingest
// already call kb-store directly; these helpers exist for symmetry / future
// use and any HTTP-style consumer).
export { mountsForWorkspace };