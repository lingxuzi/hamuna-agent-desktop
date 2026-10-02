const OUTBOUND_PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;

export const MCP_LOCALHOST_NO_PROXY_VAL = 'localhost,localhost.localdomain,127.0.0.1,127.0.0.0/8,::1';

/**
 * npm/npx env applied to every stdio MCP subprocess.
 *
 * npx revalidates the packument against the registry on EVERY invocation,
 * even when the tarball is already in the npm cache — that round trip
 * dominated MCP enable/startup latency on slow links. These flags let a warm
 * cache satisfy the install outright:
 *
 *  - `prefer-offline` — use the cache when it has the package; only hit the
 *    network for something genuinely missing. Strictly better than `offline`,
 *    which would hard-fail the first install of a new package.
 *  - `audit`/`fund`/`update-notifier` — skip npm's post-install network calls.
 *    Pure latency, no behaviour a stdio MCP depends on.
 *
 * A per-server `env` block still wins: users can force `--offline` or point at
 * an air-gapped registry for a specific MCP without editing app config.
 */
const NPM_ENV_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  NPM_CONFIG_PREFER_OFFLINE: 'true',
  NPM_CONFIG_AUDIT: 'false',
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
});

/**
 * Registry mirror for npx-backed MCPs. NOT hardcoded to any mirror: absent an
 * explicit opt-in we leave npm's own resolution alone, so corporate proxies,
 * private registries, and existing user `~/.npmrc` keep working untouched.
 * Users in mainland China can opt in via `HAMUNA_NPM_REGISTRY`.
 */
function resolveNpmRegistry(
  parentEnv: NodeJS.ProcessEnv,
  serverEnv: Record<string, string> | undefined,
): string | undefined {
  return nonEmpty(serverEnv?.NPM_CONFIG_REGISTRY)
    ?? nonEmpty(serverEnv?.npm_config_registry)
    ?? nonEmpty(parentEnv.HAMUNA_NPM_REGISTRY)
    ?? nonEmpty(parentEnv.NPM_CONFIG_REGISTRY)
    ?? nonEmpty(parentEnv.npm_config_registry);
}

/** Merge the npm cache-friendly env into an already-assembled MCP env. */
export function applyNpmEnv(
  env: Record<string, string>,
  parentEnv: NodeJS.ProcessEnv,
  serverEnv: Record<string, string> | undefined,
): void {
  for (const [key, value] of Object.entries(NPM_ENV_DEFAULTS)) {
    if (env[key] === undefined) env[key] = value;
  }
  const registry = resolveNpmRegistry(parentEnv, serverEnv);
  if (registry) {
    env.NPM_CONFIG_REGISTRY = registry;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function mergeNoProxyWithLocalhost(value: string | undefined): string {
  const entries = [
    ...MCP_LOCALHOST_NO_PROXY_VAL.split(','),
    ...(value?.split(',') ?? []),
  ]
    .map(item => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of entries) {
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged.join(',');
}

export function buildMcpSubprocessEnv(
  parentEnv: NodeJS.ProcessEnv,
  serverEnv: Record<string, string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of OUTBOUND_PROXY_ENV_KEYS) {
    const value = parentEnv[key];
    if (value) {
      env[key] = value;
    }
  }

  const userNoProxy = nonEmpty(serverEnv?.NO_PROXY);
  const userNoProxyLower = nonEmpty(serverEnv?.no_proxy);
  const explicitNoProxy = userNoProxy ?? userNoProxyLower;

  env.NO_PROXY = mergeNoProxyWithLocalhost(explicitNoProxy);
  env.no_proxy = mergeNoProxyWithLocalhost(userNoProxyLower ?? explicitNoProxy);

  if (serverEnv && Object.keys(serverEnv).length > 0) {
    Object.assign(env, serverEnv);
  }

  // Seed PATH from the parent Sidecar's environment. MCP stdio subprocesses
  // need PATH to resolve bare `command` strings (e.g. `agnes-video-25-mcp`
  // shipped under `src-tauri/resources/hosted-mcps/agnes-video-25-mcp-<arch>/bin`,
  // or any system tool a server entry assumes is on PATH).
  //
  // Without this, every MCP subprocess would get `env.PATH = undefined` —
  // previously the policy only forwarded proxy + NO_PROXY (intentional:
  // MCP servers shouldn't inherit the full Sidecar env, since arbitrary
  // env vars like HAMUNA_PORT could leak into MCP child processes).
  //
  // PATH is safe to forward (read-only lookup; MCP server can't mutate the
  // parent). The macOS bundled Python + agnes injection in
  // `mcp-server-transform.ts` then prepends on top so bundled tools
  // resolve even when system PATH lacks them.
  if (parentEnv.PATH && env.PATH === undefined) {
    env.PATH = parentEnv.PATH;
  }

  if (explicitNoProxy !== undefined) {
    env.NO_PROXY = mergeNoProxyWithLocalhost(userNoProxy ?? explicitNoProxy);
    env.no_proxy = mergeNoProxyWithLocalhost(userNoProxyLower ?? explicitNoProxy);
  } else {
    env.NO_PROXY = MCP_LOCALHOST_NO_PROXY_VAL;
    env.no_proxy = MCP_LOCALHOST_NO_PROXY_VAL;
  }

  return env;
}
