/**
 * Real stdio MCP startup validation. Used by `/api/mcp/enable` to verify
 * that an MCP server actually speaks the MCP protocol before we mark it
 * enabled — replaces the old `which <command>` / `npx --help` preflight
 * that passed broken servers through to first chat turn.
 *
 * ponytail: validates only `initialize` handshake (NOT `tools/list`, NOT
 * actual tool invocation). If users report "enabled but tools missing"
 * failures, the upgrade path is to chain a `client.listTools()` here and
 * report per-tool registration errors.
 *
 * Validation flow:
 *   1. withAbortSignal parent + 15s timeout (Node-side, not SDK's
 *      RequestOptions.timeout — that one wraps a single request and doesn't
 *      kill the subprocess)
 *   2. StdioClientTransport spawns the command
 *   3. Client.connect(transport) auto-runs the initialize JSON-RPC handshake
 *   4. On success: read getServerVersion() → serverInfo
 *   5. On any failure: classify into McpEnableError (command_not_found |
 *      runtime_error); always close transport in finally
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { McpEnableError } from '../../shared/config-types';
import { withAbortSignal, withBoundedTimeout } from '../utils/cancellation';

// Cold npx + Windows path resolve + cold `initialize` handshake can easily
// run past 15s on a clean cache. 30s is the practical floor that covers
// preset MCPs (playwright / mobile-control) without leaving users stuck in
// a request that times out before the protocol exchange settles.
const DEFAULT_TIMEOUT_MS = 30_000;
// Bounded close: SDK subprocess can ignore SIGTERM forever (v0.2.x实战);
// cap close() wait so the request thread doesn't block the HTTP loop.
const CLOSE_TIMEOUT_MS = 2_000;

export interface StdioStartupInput {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Used only for log lines / error context. */
  serverId?: string;
  /** Cancellation source — typically the HTTP request's AbortSignal. */
  parentSignal?: AbortSignal;
  /** Hard cap on the handshake. Defaults to 15s. */
  timeoutMs?: number;
}

export type StdioStartupResult =
  | {
      ok: true;
      serverInfo?: { name: string; version?: string };
      handshakeMs: number;
    }
  | {
      ok: false;
      error: McpEnableError;
      handshakeMs: number;
    };

/**
 * Spawn the stdio MCP, run a real `initialize` handshake, classify the
 * outcome. NEVER throws — returns a discriminated union so callers can
 * surface structured UX without try/catch noise.
 *
 * Subprocess is always killed (in finally) whether the handshake succeeds,
 * fails, or is aborted — caller never inherits an orphan process.
 */
export async function validateStdioStartup(
  input: StdioStartupInput,
): Promise<StdioStartupResult> {
  const start = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logTag = `[mcp-validate:${input.serverId ?? input.command}]`;

  let transport: StdioClientTransport | null = null;
  let closeStarted = false;
  // Bounded tail buffer of MCP subprocess stderr — populated by the data
  // listener attached right after transport construction. Read in the
  // failure path so /api/mcp/enable errors include the real reason
  // (npm 404 / ENOTDIR / proxy error) instead of just `-32000`.
  let stderrTail: string[] = [];
  // `closePromise` is only assigned once transport exists and start has been
  // called. Until then we have nothing to close. Typed loosely because
  // withBoundedTimeout returns `Promise<T | undefined>` and TS narrows
  // `null` checks strangely on the assigned result.
  let closePromise: Promise<void> | null = null;

  const startClose = (): void => {
    if (closeStarted || !transport) return;
    closeStarted = true;
    const p = transport.close().catch(() => undefined);
    // withBoundedTimeout never rejects and never throws; on timeout we drop
    // the result and log; the underlying close keeps running (the process
    // is dying on SIGKILL).
    closePromise = withBoundedTimeout(p, CLOSE_TIMEOUT_MS, () => {
      console.warn(`${logTag} transport.close did not settle within ${CLOSE_TIMEOUT_MS}ms`);
    }) as Promise<void>;
  };

  try {
    return await withAbortSignal(
      input.parentSignal,
      (signal) => {
        // Short-circuit: if the signal was already aborted when we entered
        // (parentSignal pre-aborted), don't even spawn a subprocess. The
        // outer withAbortSignal aborts its inner controller immediately
        // for pre-aborted parents, but our transport + connect would still
        // run synchronously here and possibly return ok=true via the
        // mock — defeating the cancellation contract.
        if (signal.aborted) {
          throw makeAbortError(signal);
        }

        // Bridge: on parent/timeout abort, kick off close() to kill the
        // subprocess AND race the connect() promise against abort so the
        // chain can settle promptly (rather than waiting on the SDK
        // transport's internal read loop to notice the dead process).
        const onAbort = (): void => {
          if (!closeStarted) {
            console.warn(`${logTag} aborted, killing subprocess`);
            startClose();
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });

        transport = new StdioClientTransport({
          command: input.command,
          args: input.args,
          env: input.env,
          stderr: 'pipe',
          cwd: process.cwd(),
        });

        // Drain MCP subprocess stderr to prevent pipe backpressure. The SDK
        // routes `stderr: 'pipe'` through a PassThrough that nobody reads by
        // default — once npx (or any preset) writes past the OS pipe buffer
        // (~4KB on Windows, 64KB on POSIX), the child blocks on its next
        // stderr write, the `initialize` handshake never completes, and the
        // SDK surfaces "ConnectionClosed (-32000)" instead of the real failure
        // (ENOTDIR / EPERM / cache miss). Attach before client.connect() so
        // any stderr emitted during spawn is captured. Bounded buffer + log
        // gives diagnostics without unbounded growth.
        //
        // The SDK's TS type declares `stderr: Stream | null`, but in pipe
        // mode it always returns the PassThrough constructed in start()
        // (stdio.js:60-62). Mock transports (e.g. unit tests) may not
        // implement this getter; guard before subscribing.
        const stderrStream = transport.stderr;
        if (stderrStream) {
          stderrStream.on('data', (chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            stderrTail.push(text);
            // Cap memory: keep only the tail. 32 lines covers most real
            // failures (npm 404, ENOTDIR stack, proxy errors).
            if (stderrTail.length > 32) stderrTail.shift();
          });
        }

        const client = new Client(
          { name: 'HamunaAgent', version: '0.1.29' },
          { capabilities: {} },
        );

        // Race the SDK connect() against the abort signal: if the
        // subprocess is killed (or parent aborts) before the handshake
        // settles, reject the chain with an AbortError so the .then(...)
        // failure arm runs and we surface a runtime_error instead of
        // hanging on a never-resolving connect.
        const connectPromise = client.connect(transport);
        let abortReject: ((reason: unknown) => void) | undefined;
        const abortPromise = new Promise<never>((_, reject) => {
          abortReject = reject;
        });
        const onAbortRace = (): void => {
          abortReject?.(makeAbortError(signal));
        };
        signal.addEventListener('abort', onAbortRace, { once: true });

        return Promise.race([connectPromise, abortPromise]).finally(() => {
          signal.removeEventListener('abort', onAbort);
          signal.removeEventListener('abort', onAbortRace);
        }).then(
          () => {
            const info = client.getServerVersion();
            const result: StdioStartupResult = {
              ok: true,
              handshakeMs: Date.now() - start,
            };
            if (info) {
              result.serverInfo = {
                name: info.name,
                ...(info.version !== undefined ? { version: info.version } : {}),
              };
            }
            return result;
          },
          (err: unknown) => {
            const error = classifyError(err, input.command);
            // Append captured stderr tail (≤32 lines) so the toast surfaces
            // the real failure (npm 404 / ENOTDIR / proxy error) rather than
            // a bare -32000. Capped to keep the message UI-friendly.
            const stderr = stderrTail.join('').trim();
            if (stderr) {
              const tail = stderr.length > 800 ? `${stderr.slice(-800)}…` : stderr;
              error.message = `${error.message}\n\n${tail}`;
            }
            return {
              ok: false as const,
              error,
              handshakeMs: Date.now() - start,
            };
          },
        );
      },
      { timeoutMs },
    );
  } catch (err) {
    // withAbortSignal wraps synchronous op() throws as Promise rejections,
    // but defensive belt-and-suspenders for any path that escapes the
    // client's .then(..., classifyError) arm (e.g. a future refactor
    // that throws before constructing the Client).
    return {
      ok: false,
      error: classifyError(err, input.command),
      handshakeMs: Date.now() - start,
    };
  } finally {
    startClose();
    // closePromise is wired through transport.close().catch(...) inside
    // startClose, so rejection is already suppressed there. The
    // `void` here just keeps the linter quiet about an unused reference.
    void closePromise;
  }
}

/**
 * Map a thrown error from the MCP SDK / transport into the existing
 * McpEnableError union. Two categories today:
 *   - command_not_found: spawn ENOENT (binary truly absent on PATH)
 *   - runtime_error: everything else (handshake timeout, JSON-RPC error,
 *     unexpected EOF, protocol violation, process crashed during init)
 *
 * Caller-side download hints (`getCommandDownloadInfo`) are NOT applied
 * here — that lives in the HTTP handler so the error message can match
 * the user's command, not the resolved inner command.
 */
function classifyError(err: unknown, command: string): McpEnableError {
  const message = errorMessage(err);
  const code = (err as { code?: string | number } | null)?.code;

  // Node child_process failures on spawn: 'ENOENT' for missing binary.
  // Some wrappers nest under `cause.code`.
  const causeCode =
    (err as { cause?: { code?: string | number } } | null)?.cause?.code ?? code;
  if (causeCode === 'ENOENT') {
    return {
      type: 'command_not_found',
      command,
      message: `命令 "${command}" 未找到 (spawn ENOENT)`,
    };
  }

  return {
    type: 'runtime_error',
    command,
    message,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // McpError.toString often reads "McpError: <message>" — the message
    // field alone is usually more useful for the toast.
    return err.message || err.name || 'MCP handshake failed';
  }
  if (typeof err === 'string') return err;
  return 'MCP handshake failed';
}

/** Shape an AbortError compatible with what Node's fetch / AbortSignal
 *  raise. Prefer the signal's reason if it's already an Error (Node 18+). */
function makeAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error(typeof reason === 'string' ? reason : 'aborted');
  err.name = 'AbortError';
  return err;
}
