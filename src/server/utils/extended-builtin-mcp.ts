// Extended Builtin MCP Loader — reads bundled `extended_buildin_mcp/mcp.json`
// at Sidecar startup and turns each entry into an McpServerDefinition that
// buildSdkMcpServers() will spawn alongside the user's MCPs.
//
// Scope (PRD intent): external stdio / sse / http MCP servers declared in a
// build-time config so system administrators can ship extra builtins without
// rebuilding the JS bundle. In-process (createSdkMcpServer) extensions are
// intentionally NOT supported here — that path requires a Node loader and a
// sandbox and is out of scope for this file.
//
// Failure semantics: malformed entries are logged + skipped, never thrown.
// A poisoned bundle config must not prevent the Sidecar from starting —
// regular user MCPs are still honoured.

import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type {
  McpServerDefinition,
  McpServerType,
} from '../../shared/config-types';
import { getBundledResourcePath, getScriptDir } from './runtime';

const BUNDLE_DIR = 'extended_buildin_mcp';
const BUNDLE_FILE = 'mcp.json';

/** Only version 1 is understood. Bump on incompatible schema changes. */
export const SUPPORTED_VERSION = 1;

/** Defensive caps — bundle config is shipped read-only with the app, but if a
 *  corrupted build ships a megabyte of JSON we don't want it slowing startup
 *  or being interpreted as an attack surface. */
export const MAX_FILE_BYTES = 256 * 1024; // 256 KiB
export const MAX_SERVERS = 32;
export const MAX_ENV_BYTES_PER_SERVER = 8 * 1024;

/** `${env:NAME}` placeholder → process.env.NAME */
const ENV_PLACEHOLDER_RE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * `${bundled:REL_PATH}` placeholder → absolute path of a Tauri-bundled
 * resource directory (see `tauri.conf.json > bundle.resources`). Lets an
 * MCP entry reference a sibling package without hardcoding an absolute path
 * that breaks across machines / install prefixes.
 *
 * Resolution falls through `getBundledResourcePath` which handles both the
 * production layout (resource sits next to server-dist.js) and the dev
 * layout (walks up to src-tauri/resources/REL_PATH). When the resource is
 * missing (e.g. older build pre-bundling, or dev repo without the file),
 * the placeholder is left as-is and a warning is logged — same fail-soft
 * policy as `${env:NAME}` so a poisoned bundle never prevents Sidecar start.
 */
const BUNDLED_PLACEHOLDER_RE = /\$\{bundled:([^}]+)\}/g;

interface RawExtendedConfig {
  version?: unknown;
  servers?: unknown;
}

interface RawExtendedServer {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  description?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
  enabled?: unknown;
}

function resolveEnvPlaceholders(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = v.replace(ENV_PLACEHOLDER_RE, (_match, name) => {
      const val = process.env[name];
      if (val === undefined) {
        console.warn(
          `[extended-builtin-mcp] env placeholder \${env:${name}} not set in process.env, leaving literal`,
        );
      }
      return val ?? '';
    });
  }
  return out;
}

/**
 * Resolve `${bundled:REL_PATH}` placeholders inside an MCP arg vector to
 * absolute paths via `getBundledResourcePath`. Args without placeholders
 * are returned unchanged. Multi-placeholder strings are all resolved in
 * one pass; an unresolved placeholder is left as a literal so the spawn
 * layer's existing `command_not_found` UX surfaces the actual problem.
 */
function resolveBundledPlaceholdersInArgs(args: readonly string[]): string[] {
  return args.map((arg) =>
    arg.replace(BUNDLED_PLACEHOLDER_RE, (_match, relPath: string) => {
      const resolved = getBundledResourcePath(relPath);
      if (!resolved) {
        console.warn(
          `[extended-builtin-mcp] bundled placeholder \${bundled:${relPath}} not found, leaving literal`,
        );
        return `\${bundled:${relPath}}`;
      }
      return resolved;
    }),
  );
}

/**
 * Pure parse entry point — exported so unit tests can drive it without a
 * filesystem. Takes the JSON text, returns validated McpServerDefinition[].
 * Always returns a (possibly empty) array, never throws; details are logged
 * via console.warn.
 */
export function parseExtendedBuiltinMcpConfig(raw: string): McpServerDefinition[] {
  let parsed: RawExtendedConfig;
  try {
    parsed = JSON.parse(raw) as RawExtendedConfig;
  } catch (err) {
    console.warn(
      `[extended-builtin-mcp] config is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn(`[extended-builtin-mcp] config root must be an object`);
    return [];
  }

  if (parsed.version !== SUPPORTED_VERSION) {
    console.warn(
      `[extended-builtin-mcp] unsupported version ${JSON.stringify(parsed.version)} (expected ${SUPPORTED_VERSION}), skipping`,
    );
    return [];
  }

  if (!Array.isArray(parsed.servers)) {
    console.warn(`[extended-builtin-mcp] 'servers' must be an array, skipping`);
    return [];
  }

  if (parsed.servers.length > MAX_SERVERS) {
    console.warn(
      `[extended-builtin-mcp] too many servers (${parsed.servers.length} > ${MAX_SERVERS}), truncating`,
    );
    parsed.servers = (parsed.servers as unknown[]).slice(0, MAX_SERVERS) as unknown;
  }

  const result: McpServerDefinition[] = [];
  const seenIds = new Set<string>();
  const rawServers = parsed.servers as unknown[];
  rawServers.forEach((rawServer, index) => {
    if (!rawServer || typeof rawServer !== 'object' || Array.isArray(rawServer)) {
      console.warn(`[extended-builtin-mcp] entry #${index} skipped: not an object`);
      return;
    }
    const obj = rawServer as RawExtendedServer;
    if (obj.enabled === false) {
      return;
    }
    const server = coerceServer(obj, index);
    if (!server) return;
    if (seenIds.has(server.id)) {
      console.warn(`[extended-builtin-mcp] duplicate id '${server.id}' skipped`);
      return;
    }
    seenIds.add(server.id);
    result.push(server);
  });
  return result;
}

function coerceServer(raw: RawExtendedServer, index: number): McpServerDefinition | null {
  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    console.warn(`[extended-builtin-mcp] entry #${index} skipped: missing id`);
    return null;
  }
  const id = raw.id.trim();

  const type: McpServerType =
    raw.type === 'stdio' || raw.type === 'sse' || raw.type === 'http' ? raw.type : 'stdio';

  if (type === 'stdio') {
    if (typeof raw.command !== 'string' || raw.command.trim() === '') {
      console.warn(`[extended-builtin-mcp] '${id}' skipped: stdio requires command`);
      return null;
    }
  } else {
    if (typeof raw.url !== 'string' || raw.url.trim() === '') {
      console.warn(`[extended-builtin-mcp] '${id}' skipped: ${type} requires url`);
      return null;
    }
  }

  const args = Array.isArray(raw.args)
    ? raw.args.filter((a): a is string => typeof a === 'string')
    : undefined;

  const env =
    raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? Object.fromEntries(
          Object.entries(raw.env as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined;

  const headers =
    raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)
      ? Object.fromEntries(
          Object.entries(raw.headers as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined;

  // isBuiltin is required by McpServerDefinition; an "extended builtin" is
  // morally equivalent to a preset from the perspective of permission gating
  // and user override semantics.
  const server: McpServerDefinition = {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : id,
    type,
    description:
      typeof raw.description === 'string' ? raw.description : undefined,
    command: typeof raw.command === 'string' ? raw.command : undefined,
    args,
    env,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    headers,
    isBuiltin: true,
  };

  if (server.env) {
    const envSize = Object.values(server.env).reduce((n, v) => n + v.length, 0);
    if (envSize > MAX_ENV_BYTES_PER_SERVER) {
      console.warn(
        `[extended-builtin-mcp] '${id}' skipped: env block too large (${envSize} > ${MAX_ENV_BYTES_PER_SERVER} bytes)`,
      );
      return null;
    }
    server.env = resolveEnvPlaceholders(server.env);
  }

  if (server.args) {
    server.args = resolveBundledPlaceholdersInArgs(server.args);
  }

  return server;
}

/**
 * Read the bundled extended builtin MCP config and return it as a list of
 * McpServerDefinition. The list is appended to `currentMcpServers` by
 * buildSdkMcpServers(); reserved-name filtering and the rest of the spawn
 * pipeline is reused unchanged.
 *
 * Always returns a (possibly empty) array — never throws.
 */
export function loadExtendedBuiltinMcpServers(): McpServerDefinition[] {
  const filePath = getExtendedBuiltinMcpBundlePath();
  if (!filePath) {
    return [];
  }

  let raw: string;
  try {
    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      console.warn(
        `[extended-builtin-mcp] ${filePath} skipped: file too large (${stat.size} > ${MAX_FILE_BYTES} bytes)`,
      );
      return [];
    }
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(
      `[extended-builtin-mcp] failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const parsed = parseExtendedBuiltinMcpConfig(raw);

  console.log(
    `[extended-builtin-mcp] loaded ${parsed.length} extended MCP server(s) from ${filePath}${
      parsed.length > 0 ? ': ' + parsed.map((s) => s.id).join(', ') : ''
    }`,
  );
  return parsed;
}

/** Resolve the on-disk bundle directory for diagnostics / Settings UI.
 *
 * Search order:
 *   1. Bundled resource directory (prod + standard dev via getBundledResourcePath)
 *   2. Walk up from scriptDir to find `extended_buildin_mcp/mcp.json` at the
 *      repo root — used by `npm run tauri:dev` where the config lives at
 *      `<repo>/extended_buildin_mcp/mcp.json` but isn't mirrored into
 *      `src-tauri/resources/` (Tauri's bundling step only runs at `tauri build`).
 */
export function getExtendedBuiltinMcpBundlePath(): string | null {
  const dir = getBundledResourcePath(BUNDLE_DIR);
  if (dir) {
    const candidate = join(dir, BUNDLE_FILE);
    if (existsSync(candidate)) return candidate;
  }
  let d = getScriptDir();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(d, BUNDLE_DIR, BUNDLE_FILE);
    if (existsSync(candidate)) return candidate;
    d = dirname(d);
  }
  return null;
}