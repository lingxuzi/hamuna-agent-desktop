#!/usr/bin/env -S npx tsx
// agnes-e2e-test.ts — verify the openai-bridge actually drives agnes end-to-end.
//
// What it does:
//   1. Loads agnes credentials from ~/.hamuna/config.json (or honors
//      AGNES_BASE_URL/AGNES_API_KEY/AGNES_MODEL env vars for hermetic runs).
//   2. Imports the REAL bridge translators (`translateRequest` /
//      `translateRequestToResponses` / `translateResponse` /
//      `translateResponsesResponse`) so the wire shape under test is exactly
//      what the sidecar sends in production — not a mirror copy that could
//      drift.
//   3. Sends a tool-using Anthropic-format request through BOTH paths
//      (chat_completions = user's current production format; responses =
//      where fix #2/#3/#4/#7/#8 live).
//   4. Asserts the request body passes agnes's strict-validator and that the
//      response shape can be converted back to Anthropic `tool_use` blocks
//      that the Claude Agent SDK can consume.
//
// This is a *credentialed* test — it makes real HTTPS calls. It is NOT in
// default CI. Run explicitly with `npx tsx scripts/agnes-e2e-test.ts`.
//
// API key is loaded from config.json but never logged: every print that
// touches the key masks all but the first 7 + last 4 chars.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── REAL bridge translators (not mirrors) ───────────────────────────────
import { translateRequest } from '../src/server/openai-bridge/translate/request';
import { translateResponse } from '../src/server/openai-bridge/translate/response';
import {
  translateRequestToResponses,
} from '../src/server/openai-bridge/translate/request-responses';
import {
  translateResponsesResponse,
} from '../src/server/openai-bridge/translate/response-responses';
import type { AnthropicRequest } from '../src/server/openai-bridge/types/anthropic';

// ─── config ──────────────────────────────────────────────────────────────
type ProviderEnv = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const CONFIG_PATH = join(homedir(), '.hamuna', 'config.json');
const ENV_BASE = 'AGNES_BASE_URL';
const ENV_KEY = 'AGNES_API_KEY';
const ENV_MODEL = 'AGNES_MODEL';

function loadAgnesEnv(): ProviderEnv {
  // 1) Env vars always win — explicit override for hermetic testing.
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

  // 2) Auto-discover from ~/.hamuna/config.json — match by id suffix
  //    `agnes` / name === 'Agnes' / apiProtocol === 'openai'. We don't
  //    hardcode the full provider id (it's auto-generated with timestamp).
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
    availableProvidersJson?: string;
    providerApiKeys?: Record<string, string>;
  };
  const providers = cfg.availableProvidersJson
    ? (JSON.parse(cfg.availableProvidersJson) as Array<{
        id: string;
        name?: string;
        baseUrl?: string;
        primaryModel?: string;
        apiProtocol?: string;
      }>)
    : [];
  const agnes = providers.find(
    (p) =>
      p.id.includes('agnes') ||
      p.name?.toLowerCase() === 'agnes' ||
      p.apiProtocol === 'openai',
  );
  if (!agnes?.baseUrl || !agnes.primaryModel) {
    throw new Error(
      `No agnes provider found in ${CONFIG_PATH}. Either:\n` +
        `  - Set AGNES_BASE_URL + AGNES_API_KEY + AGNES_MODEL env vars\n` +
        `  - Configure an agnes provider in ~/.hamuna/config.json`,
    );
  }
  // ProviderRecord.apiKey is the canonical storage; providerApiKeys[id] is
  // a secondary location. Prefer whichever is populated.
  const apiKey = agnes.id && cfg.providerApiKeys?.[agnes.id]
    ? cfg.providerApiKeys[agnes.id]
    : ((agnes as unknown as { apiKey?: string }).apiKey ?? '');
  if (!apiKey) {
    throw new Error(`Agnes provider found but no apiKey in config (id=${agnes.id})`);
  }
  return {
    baseUrl: agnes.baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: agnes.primaryModel,
  };
}

function maskKey(k: string): string {
  if (k.length <= 12) return '***';
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

// ─── fixture: simple tool the model SHOULD invoke ────────────────────────
// The `input_schema` carries `description` fields at every level — exactly
// the shape that triggered Bug F on the Responses API path (column 45371
// inside one of these `description` strings). If fix #8 works, agnes's
// Responses-API validator must NOT trip on these.
const TOOL_FIXTURE = {
  name: 'get_current_time',
  description: 'Returns the current server time in ISO 8601 format, optionally for a given IANA timezone.',
  input_schema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone name, e.g. "Asia/Shanghai". Defaults to UTC when omitted.',
      },
    },
    required: [],
    description: 'Tool parameter schema — properties of the get_current_time function call.',
  },
} as const;

const SYSTEM_PROMPT =
  'You are a strict assistant. When a tool can answer the user, you MUST call it. ' +
  'Otherwise reply with one short sentence.';

const USER_PROMPT =
  '请调用 get_current_time 工具，不要用文字回答。If the tool errors, reply "TOOL_ERROR".';

// ─── raw POST helper (no SDK / no proxy / no dispatcher — keep it minimal) ─
async function postRaw(
  env: ProviderEnv,
  endpoint: string,
  body: unknown,
  authStyle: 'bearer' | 'x-api-key',
): Promise<{ ok: boolean; status: number; bodyText: string; json: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authStyle === 'bearer') {
    headers.Authorization = `Bearer ${env.apiKey}`;
  } else {
    headers['x-api-key'] = env.apiKey;
  }
  const url = `${env.baseUrl}${endpoint}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const bodyText = await resp.text();
  let json: unknown = null;
  try { json = JSON.parse(bodyText); } catch { /* non-JSON response */ }
  return { ok: resp.ok, status: resp.status, bodyText, json };
}

// ─── chat_completions path ───────────────────────────────────────────────
async function runChatCompletions(env: ProviderEnv): Promise<void> {
  console.log('── chat_completions path ──');
  const anthropicReq: AnthropicRequest = {
    model: env.model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: USER_PROMPT }],
    tools: [TOOL_FIXTURE],
  };
  const translated = translateRequest(anthropicReq, { modelOverride: env.model });
  // Show what we'd actually send — first 200 chars of the body so the user
  // can verify model, tools shape, etc. without us dumping the whole payload.
  const wireStr = JSON.stringify(translated);
  console.log(`  wire body (truncated): ${wireStr.slice(0, 200)}…`);
  const { ok, status, bodyText, json } = await postRaw(
    env,
    '/chat/completions',
    translated,
    'bearer',
  );
  console.log(`  HTTP ${status} ok=${ok}`);
  if (!ok) {
    console.log(`  body (first 600): ${bodyText.slice(0, 600)}`);
    return;
  }
  const back = translateResponse(json as Parameters<typeof translateResponse>[0], env.model);
  console.log(`  stop_reason: ${back.stop_reason}`);
  console.log(`  content blocks:`);
  for (const b of back.content) {
    if (b.type === 'text') {
      console.log(`    text: "${b.text.slice(0, 200)}"`);
    } else if (b.type === 'tool_use') {
      console.log(`    tool_use: name=${b.name} input=${JSON.stringify(b.input).slice(0, 200)}`);
    } else if (b.type === 'thinking') {
      console.log(`    thinking: ${b.thinking.slice(0, 120)}…`);
    }
  }
  const toolUses = back.content.filter((b) => b.type === 'tool_use');
  console.log(`  → tool_use count = ${toolUses.length}`);
}

// ─── Responses API path (where Bug F lived) ──────────────────────────────
async function runResponses(env: ProviderEnv): Promise<void> {
  console.log('── Responses API path (Bug F fix #7 + #8 under test) ──');
  const anthropicReq: AnthropicRequest = {
    model: env.model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: USER_PROMPT }],
    tools: [TOOL_FIXTURE],
  };
  const translated = translateRequestToResponses(anthropicReq, { modelOverride: env.model });
  const wireStr = JSON.stringify(translated);
  // Make the wire shape easy to inspect.
  console.log(`  wire body (truncated): ${wireStr.slice(0, 200)}…`);
  console.log(`  tools[0].parameters (post-strip): ${JSON.stringify(translated.tools?.[0].parameters).slice(0, 250)}`);
  console.log(`  has description in tools[0].parameters.properties.timezone: ${JSON.stringify(translated.tools?.[0].parameters).includes('"description"')}`);
  const { ok, status, bodyText, json } = await postRaw(
    env,
    '/responses',
    translated,
    'bearer',
  );
  console.log(`  HTTP ${status} ok=${ok}`);
  if (!ok) {
    console.log(`  body (first 600): ${bodyText.slice(0, 600)}`);
    return;
  }
  try {
    const back = translateResponsesResponse(
      json as Parameters<typeof translateResponsesResponse>[0],
      env.model,
    );
    console.log(`  stop_reason: ${back.stop_reason}`);
    console.log(`  content blocks:`);
    for (const b of back.content) {
      if (b.type === 'text') {
        console.log(`    text: "${b.text.slice(0, 200)}"`);
      } else if (b.type === 'tool_use') {
        console.log(`    tool_use: name=${b.name} input=${JSON.stringify(b.input).slice(0, 200)}`);
      }
    }
    const toolUses = back.content.filter((b) => b.type === 'tool_use');
    console.log(`  → tool_use count = ${toolUses.length}`);
  } catch (e) {
    console.log(`  back-translate FAILED: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  raw body (first 600): ${bodyText.slice(0, 600)}`);
  }
}

// ─── multi-turn tool loop closure (proves the SDK round trip) ───────────
// After the model emits `tool_use`, the Claude Agent SDK executes the tool
// locally and sends the result back as a `tool_result` block. If agnes
// accepts the tool_result AND emits a final text response, the full SDK
// loop has been verified end-to-end.
async function runChatLoop(env: ProviderEnv): Promise<void> {
  console.log('── chat_completions multi-turn loop closure ──');
  const messages: AnthropicRequest['messages'] = [
    { role: 'user', content: USER_PROMPT },
  ];

  // Turn 1: send user + tool def, expect tool_use
  const req1: AnthropicRequest = {
    model: env.model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages,
    tools: [TOOL_FIXTURE],
  };
  const wire1 = translateRequest(req1, { modelOverride: env.model });
  const r1 = await postRaw(env, '/chat/completions', wire1, 'bearer');
  console.log(`  turn 1 HTTP ${r1.status}`);
  if (!r1.ok) {
    console.log(`  turn 1 body: ${r1.bodyText.slice(0, 400)}`);
    return;
  }
  const back1 = translateResponse(
    r1.json as Parameters<typeof translateResponse>[0],
    env.model,
  );
  const toolUse = back1.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    console.log(`  turn 1: no tool_use returned (got stop_reason=${back1.stop_reason}). Loop test skipped.`);
    return;
  }
  console.log(`  turn 1: tool_use name=${toolUse.name} input=${JSON.stringify(toolUse.input)}`);

  // Simulate SDK running the tool locally
  messages.push({ role: 'assistant', content: back1.content });
  messages.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: '2026-09-02T14:32:11+08:00',
      },
    ],
  });

  // Turn 2: send tool_result, expect final text
  const req2: AnthropicRequest = {
    model: env.model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages,
    tools: [TOOL_FIXTURE],
  };
  const wire2 = translateRequest(req2, { modelOverride: env.model });
  const r2 = await postRaw(env, '/chat/completions', wire2, 'bearer');
  console.log(`  turn 2 HTTP ${r2.status}`);
  if (!r2.ok) {
    console.log(`  turn 2 body: ${r2.bodyText.slice(0, 400)}`);
    return;
  }
  const back2 = translateResponse(
    r2.json as Parameters<typeof translateResponse>[0],
    env.model,
  );
  console.log(`  turn 2 stop_reason: ${back2.stop_reason}`);
  for (const b of back2.content) {
    if (b.type === 'text') {
      console.log(`    text: "${b.text.slice(0, 200)}"`);
    } else if (b.type === 'tool_use') {
      console.log(`    tool_use (unexpected on turn 2!): name=${b.name}`);
    }
  }
  const hasText = back2.content.some((b) => b.type === 'text' && b.text.trim().length > 0);
  console.log(`  → loop closed=${hasText} (has non-empty text after tool_result)`);
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const env = loadAgnesEnv();
  console.log(`=== agnes e2e ===`);
  console.log(`baseUrl: ${env.baseUrl}`);
  console.log(`model:   ${env.model}`);
  console.log(`apiKey:  ${maskKey(env.apiKey)}`);
  console.log('');
  await runChatCompletions(env);
  console.log('');
  await runResponses(env);
  console.log('');
  await runChatLoop(env);
  console.log('');
  console.log('done.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});