#!/usr/bin/env -S npx tsx
// agnes-real-e2e.ts — REAL end-to-end: agnes → openai-bridge → Claude Agent SDK → real tool execution → loop closure.
//
// No mocks. No mirrored translators. The full pipeline:
//
//   SDK query()
//     ↓ (HTTP POST Anthropic-format)
//   local bridge server (createBridgeHandler)
//     ↓ (HTTP POST OpenAI Responses/chat-completions)
//   https://api.agnes-ai.cn/v1
//     ↓
//   agnes-2.5-flash
//     ↓ (OpenAI response)
//   bridge handler (translateResponsesResponse / translateResponse)
//     ↓ (Anthropic-format SSE)
//   SDK
//     ↓ (if tool_use: real tool execution via MCP JSON-RPC)
//   tool handler returns real data
//     ↓ (tool_result sent back through bridge → agnes → final text)
//
// This is what production does. Run with:
//   npx tsx scripts/agnes-real-e2e.ts

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { z } from 'zod';

import { createBridgeHandler } from '../src/server/openai-bridge/handler';
import type { BridgeConfig, UpstreamConfig } from '../src/server/openai-bridge/types/bridge';

// SDK + MCP tool hosting — REAL Claude Agent SDK, REAL tool execution
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

// ─── config (real agnes creds) ───────────────────────────────────────────
type ProviderEnv = { baseUrl: string; apiKey: string; model: string };

const CONFIG_PATH = join(homedir(), '.hamuna', 'config.json');
const ENV_BASE = 'AGNES_BASE_URL';
const ENV_KEY = 'AGNES_API_KEY';
const ENV_MODEL = 'AGNES_MODEL';

function loadAgnesEnv(): ProviderEnv {
  const envBase = process.env[ENV_BASE];
  const envKey = process.env[ENV_KEY];
  const envModel = process.env[ENV_MODEL];
  if (envBase && envKey) {
    return {
      baseUrl: envBase.replace(/\/+$/, ''),
      apiKey: envKey,
      model: envModel ?? 'agnes-2.5-flash',
    };
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
    availableProvidersJson?: string;
    providerApiKeys?: Record<string, string>;
  };
  const providers = cfg.availableProvidersJson
    ? (JSON.parse(cfg.availableProvidersJson) as Array<{
        id: string; name?: string; baseUrl?: string; primaryModel?: string; apiProtocol?: string;
      }>)
    : [];
  const agnes = providers.find(
    (p) => p.id.includes('agnes') || p.name?.toLowerCase() === 'agnes' || p.apiProtocol === 'openai',
  );
  if (!agnes?.baseUrl || !agnes.primaryModel) {
    throw new Error(`No agnes provider found. Set AGNES_* env vars or configure ~/.hamuna/config.json.`);
  }
  const apiKey = agnes.id && cfg.providerApiKeys?.[agnes.id]
    ? cfg.providerApiKeys[agnes.id]
    : ((agnes as unknown as { apiKey?: string }).apiKey ?? '');
  if (!apiKey) throw new Error(`Agnes provider found but no apiKey (id=${agnes.id})`);
  return {
    baseUrl: agnes.baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: agnes.primaryModel,
  };
}

function maskKey(k: string): string {
  return k.length <= 12 ? '***' : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

// ─── local HTTP server hosting the bridge ────────────────────────────────
//
// The SDK posts Anthropic-format requests to ANTHROPIC_BASE_URL. We host the
// bridge there. The bridge then forwards to agnes (real network call).
//
// Production pattern: the SDK CLI rejects non-Claude model names BEFORE the
// HTTP request even leaves. So the sidecar passes a Claude-shaped model id
// (`claude-sonnet-4-5` etc) to the SDK CLI; the bridge rewrites it to
// `agnes-2.5-flash` via `upstream.model` (the `modelOverride` slot).
// The `sdkModel` parameter here mirrors that contract — pass a Claude-shaped
// id; the bridge translates.
async function startBridgeServer(
  env: ProviderEnv,
  upstreamFormat: 'chat_completions' | 'responses',
): Promise<{ url: string; close: () => Promise<void>; bridgeCalls: { path: string; bodyLen: number }[] }> {
  const upstream: UpstreamConfig = {
    providerId: 'agnes-e2e',
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    // model = what we want agnes to receive. CLI never sees this — only sdkModel.
    model: env.model,
    upstreamFormat,
  };
  const config: BridgeConfig = {
    logger: null,
    getUpstreamConfig: async () => upstream,
  };
  const handler = createBridgeHandler(config);

  const bridgeCalls: { path: string; bodyLen: number }[] = [];
  const server = createServer(async (req, res) => {
    try {
      console.log(`    [bridge server] ← ${req.method} ${req.url}`);
      // The Claude Code CLI probes upstream to validate the model id before
      // forwarding any /v1/messages request. Without a /v1/models endpoint
      // responding "model exists", the CLI rejects the model and exits before
      // any POST hits our bridge. We answer the probe synthetically: tell the
      // CLI every model id it asks about exists. (The bridge then forwards
      // messages to agnes unchanged — agnes still has the final say on
      // whether the model exists.)
      if (req.method === 'GET' && req.url) {
        // Accept anything under /v1/models — list-style or single-item.
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          object: 'list',
          data: [{
            id: env.model,
            object: 'model',
            created: 0,
            owned_by: 'third-party',
          }],
        }));
        return;
      }

      // Collect body
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const bodyText = Buffer.concat(chunks).toString('utf8');
      bridgeCalls.push({ path: req.url ?? '/', bodyLen: bodyText.length });

      // Construct WHATWG Request — Node 24 has global Request (undici 7).
      const url = `http://127.0.0.1${req.url}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) headers[k] = v.join(', ');
        else if (v !== undefined) headers[k] = String(v);
      }
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? bodyText : undefined,
      });
      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (response.body) {
        const reader = response.body.getReader();
        const pump = async (): Promise<void> => {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(Buffer.from(value));
        };
        await pump();
        // For streaming, drain the rest
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
        res.end();
      } else {
        res.end();
      }
    } catch (e) {
      console.error('[bridge server] error:', e);
      res.statusCode = 500;
      res.end(`bridge error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to get server address');
  const url = `http://127.0.0.1:${addr.port}`;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close, bridgeCalls };
}

// ─── REAL tool — not a mock. SDK spawns MCP server, calls our handler ───
async function runOneScenario(
  env: ProviderEnv,
  upstreamFormat: 'chat_completions' | 'responses',
): Promise<{ toolWasCalled: boolean; finalText: string; bridgeCalls: number; errorMsg?: string }> {
  console.log(`\n── scenario: upstreamFormat=${upstreamFormat} ──`);

  // Production pattern: SDK CLI only accepts built-in Claude model ids.
// We pass a CLI-accepted id (e.g. `claude-haiku-4-5-20251001`); the bridge's
// `modelOverride` (upstream.model) rewrites it to agnes's id when forwarding
// — this matches what agent-session.ts does in production.
  // Use the same model name the user's shell already exposes to Claude Code
// (`ANTHROPIC_DEFAULT_FABLE_MODEL=hamuna-coding`). The CLI's static model
// validator only blocks names it has never seen; this name is in the user's
// session history and has been registered as a valid alias.
const cliAcceptedModel = 'hamuna-coding';

  // Start bridge server (local HTTP listener) — REAL HTTP, REAL handler.
  const server = await startBridgeServer(env, upstreamFormat);
  console.log(`  bridge listening on ${server.url}`);
  console.log(`  SDK CLI gets: ${cliAcceptedModel}`);
  console.log(`  bridge rewrites → agnes model=${env.model} format=${upstreamFormat}`);

  // Real MCP server with a real tool that does real work (Intl.DateTimeFormat).
  // The SDK will spawn this MCP server as a subprocess, discover the tool,
  // and invoke our handler when the model calls get_current_time.
  const realMcp = createSdkMcpServer({
    name: 'real-tools',
    version: '1.0.0',
    tools: [
      tool(
        'get_current_time',
        'Returns the current server time in ISO 8601 format, optionally for a given IANA timezone. ' +
          'Use this whenever the user asks about the current time.',
        {
          timezone: z.string().optional().describe('IANA timezone name, e.g. "Asia/Shanghai". Defaults to UTC when omitted.'),
        },
        async (args) => {
          // REAL work — no mock.
          const tz = args.timezone ?? 'UTC';
          try {
            const fmt = new Intl.DateTimeFormat('sv-SE', {
              timeZone: tz,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
              hour12: false,
            });
            const iso = fmt.format(new Date()).replace(' ', 'T') + (tz === 'UTC' ? 'Z' : '');
            console.log(`    [REAL tool execution] timezone=${tz} → ${iso}`);
            return { content: [{ type: 'text', text: `Current time in ${tz}: ${iso}` }] };
          } catch (e) {
            return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
          }
        },
      ),
    ],
  });

  // Drive SDK at our local bridge. The SDK bundles its own CLI; we don't
  // need to spawn anything ourselves.
  //
  // Env delivery — CRITICAL (discovered reading sdk.mjs):
  //   The SDK reads ANTHROPIC_BASE_URL via `Ae=(e)=>process.env[e]?.trim()`
  //   for its IN-PROCESS Anthropic client (wt class). This is the client
  //   that POSTs /v1/messages — the one we want to hit our bridge.
  //
  //   Separately, the SDK spawns the CLI subprocess with `env = options.env
  //   ?? { ...process.env }`. When options.env is set, ONLY its keys are
  //   forwarded — parent shell ANTHROPIC_* vars are NOT inherited. The CLI
  //   uses env to validate the model name (ANTHROPIC_DEFAULT_*, CUSTOM_*).
  //
  //   So we need to set BOTH:
  //     - process.env.ANTHROPIC_BASE_URL  → SDK's wt client reads this
  //     - options.env.ANTHROPIC_BASE_URL  → CLI subprocess reads this
  //
  //   Without both, even with options.env the SDK's in-process client may
  //   still POST to the parent's value (or the default Anthropic endpoint).
  //
  // Run with `env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY ...` so the
  // parent's stale values don't sneak into our tsx process env. Then we
  // override process.env below with our own bridge URL.
  const envBackup: Record<string, string | undefined> = {
    base: process.env.ANTHROPIC_BASE_URL,
    key: process.env.ANTHROPIC_API_KEY,
    fable: process.env.ANTHROPIC_DEFAULT_FABLE_MODEL,
    sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    custom: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION,
    customName: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME,
    customDesc: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION,
  };

  // 1) Override process.env so SDK's in-process wt client POSTs to OUR bridge.
  process.env.ANTHROPIC_BASE_URL = server.url;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-bridge-placeholder';
  // 2) The CLI rejects any model name not in its known set unless we tell it
  //    via ANTHROPIC_DEFAULT_*_MODEL (built-in aliases) or ANTHROPIC_CUSTOM_*
  //    (arbitrary custom models). We set both for belt-and-suspenders.
  process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = env.model;
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = env.model;
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = env.model;
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = env.model;
  process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = env.model;
  process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = env.model;
  process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = `Custom third-party model: ${env.model}`;

  // Same values as options.env — when set, the SDK uses ONLY these for the
  // CLI subprocess env (does NOT inherit parent). So we must mirror everything.
  const sdkEnv: Record<string, string> = {
    ANTHROPIC_BASE_URL: server.url,
    ANTHROPIC_API_KEY: 'sk-ant-bridge-placeholder',
    ANTHROPIC_DEFAULT_FABLE_MODEL: env.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: env.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: env.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: env.model,
    ANTHROPIC_CUSTOM_MODEL_OPTION: env.model,
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: env.model,
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: `Custom third-party model: ${env.model}`,
  };

  let toolWasCalled = false;
  let finalText = '';
  let errorMsg: string | undefined;
  let msgCount = 0;
  try {
    const q = query({
      prompt: '请用 get_current_time 工具告诉我现在几点（UTC），然后用中文一句话回答。Use the tool, then answer briefly in one sentence.',
      options: {
        maxTurns: 4,
        model: cliAcceptedModel,
        cwd: process.cwd(),
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'real-tools': realMcp },
        env: sdkEnv,
        spawnClaudeCodeProcess: (opts) => {
          // SDK's default local spawn reads `env = options.env ?? { ...process.env }`.
          // To be absolutely sure CLI env has our overrides (and nothing else),
          // we wrap it ourselves and re-spawn with `env = sdkEnv` ONLY.
          //
          // ALSO: Claude Code CLI reads ~/.claude/settings.json and merges its
          // `env` block into the process env. The user's settings.json pins
          // ANTHROPIC_BASE_URL to their own running sidecar (127.0.0.1:20128),
          // which overrides anything we put in spawn env. Override it via
          // `--settings <json>` — the CLI accepts inline JSON to override the
          // user-level env block.
          const cliSettingsJson = JSON.stringify({ env: sdkEnv });
          const argsWithSettings = [...opts.args, '--settings', cliSettingsJson];
          const child = spawn(opts.command, argsWithSettings, {
            cwd: opts.cwd,
            env: sdkEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
            signal: opts.signal,
            windowsHide: true,
          });
          // Tap stderr — surfaces model-validation warnings and other CLI
          // diagnostics. Without this tap, a failed CLI would silently look
          // like a successful SDK loop in our logs.
          child.stderr?.on('data', (d: Buffer) => {
            process.stderr.write(`    [cli stderr] ${d.toString()}`);
          });
          return child;
        },
      },
    });

    for await (const message of q) {
      msgCount++;
      // Heuristic: any tool_use block named get_current_time ⇒ our real tool ran.
      const blocks = (message as { message?: { content?: unknown[] }; content?: unknown[] }).message?.content
        ?? (message as { content?: unknown[] }).content
        ?? [];
      const toolUseBlocks = (Array.isArray(blocks) ? blocks : []).filter(
        (b): b is { type: 'tool_use'; name: string; id: string } =>
          !!b && typeof b === 'object' && (b as { type?: string }).type === 'tool_use',
      );
      if (toolUseBlocks.some((b) => b.name === 'get_current_time' || b.name.endsWith('__get_current_time'))) toolWasCalled = true;

      // Capture final assistant text
      const text = extractText(message);
      if (text) finalText = text;

      // Compact one-line summary of each SDK message
      const summary = summarizeMessage(message);
      if (summary) console.log(`    [sdk msg #${msgCount}] ${summary}`);
    }
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
    console.error(`  SDK error: ${errorMsg}`);
  } finally {
    // Restore process.env so this script's env mutations don't leak to
    // other tests in the same shell. The CLI subprocess is gone by now.
    const restore = (key: string, original: string | undefined) => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    };
    restore('ANTHROPIC_BASE_URL', envBackup.base);
    restore('ANTHROPIC_API_KEY', envBackup.key);
    restore('ANTHROPIC_DEFAULT_FABLE_MODEL', envBackup.fable);
    restore('ANTHROPIC_DEFAULT_SONNET_MODEL', envBackup.sonnet);
    restore('ANTHROPIC_DEFAULT_OPUS_MODEL', envBackup.opus);
    restore('ANTHROPIC_DEFAULT_HAIKU_MODEL', envBackup.haiku);
    restore('ANTHROPIC_CUSTOM_MODEL_OPTION', envBackup.custom);
    restore('ANTHROPIC_CUSTOM_MODEL_OPTION_NAME', envBackup.customName);
    restore('ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION', envBackup.customDesc);
    await server.close();
  }

  return {
    toolWasCalled,
    finalText,
    bridgeCalls: server.bridgeCalls.length,
    errorMsg,
  };
}

function extractText(message: unknown): string {
  const blocks = (message as { message?: { content?: unknown[] }; content?: unknown[] }).message?.content
    ?? (message as { content?: unknown[] }).content
    ?? [];
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((b): b is { type: 'text'; text: string } =>
      !!b && typeof b === 'object' && (b as { type?: string }).type === 'text',
    )
    .map((b) => b.text)
    .join('\n');
}

function summarizeMessage(message: unknown): string {
  const m = message as { type?: string; subtype?: string };
  const blocks = (message as { message?: { content?: unknown[] }; content?: unknown[] }).message?.content
    ?? (message as { content?: unknown[] }).content
    ?? [];
  if (m.type === 'assistant' || m.type === 'user') {
    if (Array.isArray(blocks)) {
      const counts: Record<string, number> = {};
      for (const b of blocks) {
        if (b && typeof b === 'object') {
          const t = (b as { type?: string }).type ?? 'unknown';
          counts[t] = (counts[t] ?? 0) + 1;
        }
      }
      const desc = Object.entries(counts).map(([t, n]) => `${t}:${n}`).join(',');
      return `type=${m.type} blocks={${desc}}`;
    }
  }
  if (m.type === 'result') {
    const r = m as { subtype?: string; is_error?: boolean };
    return `type=result subtype=${r.subtype ?? '?'} is_error=${r.is_error ?? false}`;
  }
  if (m.type === 'system') {
    return `type=system subtype=${m.subtype ?? '?'}`;
  }
  return `type=${m.type ?? '?'}`;
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const env = loadAgnesEnv();
  console.log(`=== agnes REAL e2e (SDK + bridge + agnes + real tool) ===`);
  console.log(`baseUrl: ${env.baseUrl}`);
  console.log(`model:   ${env.model}`);
  console.log(`apiKey:  ${maskKey(env.apiKey)}`);
  console.log(`SDK:     @anthropic-ai/claude-agent-sdk`);

  // We test chat_completions first (user's current production path).
  // If that works, we don't need to test responses API here — that's
  // already covered by scripts/agnes-e2e-test.ts for the wire-shape question.
  const chat = await runOneScenario(env, 'chat_completions');

  console.log(`\n=== verdict ===`);
  console.log(`chat_completions:`);
  console.log(`  tool executed (real):    ${chat.toolWasCalled}`);
  console.log(`  bridge calls (HTTP):     ${chat.bridgeCalls}`);
  console.log(`  final text:              ${chat.finalText ? `"${chat.finalText.slice(0, 200)}"` : '(none)'}`);
  if (chat.errorMsg) console.log(`  error:                   ${chat.errorMsg}`);

  const passed = chat.toolWasCalled && chat.finalText.length > 0 && !chat.errorMsg;
  console.log(`\n  ${passed ? '✓ PASS' : '✗ FAIL'} — openai-bridge drives Claude Agent SDK via agnes: ${passed}`);
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});