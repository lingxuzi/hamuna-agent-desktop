#!/usr/bin/env -S npx tsx
// kb-recall-test.ts — precision/recall benchmark for the KB relations extractor.
//
// What it does:
//   1. Loads the user's default provider env from ~/.hamuna/config.json
//      (or honors KB_RECALL_BASE_URL/KB_RECALL_API_KEY/KB_RECALL_MODEL env
//      vars so the test is hermetic — does not pollute production config).
//   2. Runs each fixture's text through the SAME system prompt + mechanical
//      grounding pipeline as production `src/server/kb-relations.ts`.
//   3. Scores the output against hand-crafted gold-standard entity/relation
//      sets (set-based TP / FP / FN → precision / recall / F1).
//   4. Prints per-fixture breakdown + overall summary.
//
// Why a self-contained copy of the parse/ground functions instead of an
// import from `src/server/kb-relations.ts`? `kb-relations.ts` has a heavy
// top-level import graph (Claude Agent SDK, session-engine facade,
// admin-config). Pulling that into a one-off script would either drag in
// cold-start cost or require esbuild bundling. The pure helpers
// (stripMarkdownFence / extractBalancedJson / parseExtraction /
// validateGrounding) are ~120 lines — we mirror them here and mark with
// `MIRROR:` so the next person who touches kb-relations.ts knows to update
// both places.
//
// Usage:
//   npx tsx scripts/kb-recall-test.ts
//   npx tsx scripts/kb-recall-test.ts --model claude-sonnet-4-5
//   npx tsx scripts/kb-recall-test.ts --fixtures 1,3
//   npx tsx scripts/kb-recall-test.ts --json     # machine-readable output

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── config ──────────────────────────────────────────────────────────────
// ProviderEnv.mode:
//   'direct' — direct HTTP /v1/messages (provider has baseUrl)
//   'sdk'    — Claude Agent SDK query() (subscription auth, default Anthropic endpoint)
//   'env'    — KB_RECALL_BASE_URL/KB_RECALL_API/KB_RECALL_MODEL override
type ProviderEnv = {
  mode: 'direct' | 'sdk' | 'env';
  baseUrl?: string;
  apiKey?: string;
  model: string;
};

const CONFIG_PATH = join(homedir(), '.hamuna', 'config.json');
const ENV_BASE = 'KB_RECALL_BASE_URL';
const ENV_KEY = 'KB_RECALL_API_KEY';
const ENV_MODEL = 'KB_RECALL_MODEL';

type ConfigShape = {
  defaultProviderId?: string;
  providerApiKeys?: Record<string, string>;
  availableProvidersJson?: string;
  agents?: Array<{ model?: string; providerId?: string; enabled?: boolean }>;
};

type ProviderRecord = {
  id: string;
  primaryModel?: string;
  config?: { baseUrl?: string };
};

function loadProviderEnv(overrideModel?: string): ProviderEnv {
  // 1) Env vars always win — explicit override for hermetic testing.
  const envBase = process.env[ENV_BASE];
  const envKey = process.env[ENV_KEY];
  const envModel = process.env[ENV_MODEL];
  if (envBase && envKey) {
    return {
      mode: 'env',
      baseUrl: envBase,
      apiKey: envKey,
      model: envModel ?? overrideModel ?? 'claude-sonnet-4-5',
    };
  }

  // 2) Auto-discover from ~/.hamuna/config.json — mirror the same resolution
  //    chain that production `src/server/kb-relations.ts::resolveRelationModel`
  //    uses (session → first enabled agent → default provider's primaryModel).
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ConfigShape;
  const providers = cfg.availableProvidersJson
    ? (JSON.parse(cfg.availableProvidersJson) as ProviderRecord[])
    : [];

  // Model resolution: pick the same model production would.
  const enabledAgent = cfg.agents?.find((a) => a.model && a.enabled !== false);
  const defaultProv = providers.find((p) => p.id === cfg.defaultProviderId);
  const resolvedModel =
    overrideModel ??
    envModel ??
    enabledAgent?.model ??
    defaultProv?.primaryModel ??
    'claude-sonnet-4-5';

  // Prefer direct HTTP when ANY provider has baseUrl + apiKey — that's the
  // deterministic path used in production's "direct-http" branch.
  for (const p of providers) {
    const baseUrl = p.config?.baseUrl;
    const apiKey = cfg.providerApiKeys?.[p.id];
    if (baseUrl && apiKey) {
      return { mode: 'direct', baseUrl, apiKey, model: resolvedModel };
    }
  }

  // Otherwise fall back to SDK path (mirrors production's "sdk-fallback").
  // This is the path used when only subscription auth is configured.
  for (const p of providers) {
    const apiKey = cfg.providerApiKeys?.[p.id];
    if (apiKey) {
      return { mode: 'sdk', apiKey, model: resolvedModel };
    }
  }

  throw new Error(
    `No usable LLM endpoint discovered. Either:\n` +
    `  - Configure a provider with baseUrl + apiKey in ~/.hamuna/config.json\n` +
    `  - Or set KB_RECALL_BASE_URL + KB_RECALL_API_KEY + KB_RECALL_MODEL env vars`,
  );
}

// ─── args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let modelOverride: string | undefined;
let fixtureFilter: Set<number> | undefined;
let jsonOutput = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--model' && args[i + 1]) { modelOverride = args[i + 1]; i++; }
  else if (a === '--fixtures' && args[i + 1]) {
    fixtureFilter = new Set(args[i + 1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)));
    i++;
  } else if (a === '--json') jsonOutput = true;
  else if (a === '--help' || a === '-h') {
    console.log('Usage: npx tsx scripts/kb-recall-test.ts [--model M] [--fixtures 1,3] [--json]');
    process.exit(0);
  }
}

// ─── fixtures ────────────────────────────────────────────────────────────
// Each fixture's gold is a SET of canonical entity ids. Set-based scoring is
// lenient on graph shape (no judgment on TYPE / source_quote accuracy beyond
// what the production grounding pass enforces).
type Fixture = {
  id: number;
  name: string;
  text: string;
  goldEntityIds: string[];
  /** Whether gold relation triples must match exactly; relations are scored
   *  by (subject, object) pair (relation_type is ignored — type quality is
   *  a separate signal we can grade later). */
  goldRelationPairs: Array<[string, string]>;
};

const FIXTURES: Fixture[] = [
  {
    id: 1,
    name: '中文金融（Kb-relations prompt example）',
    text: '江苏索普化工股份有限公司（股票代码600746）成立于1996年，总部位于江苏省镇江市。任正非先生曾在公开场合提到该公司是国内醋酸行业的领军企业。',
    goldEntityIds: [
      '江苏索普化工股份有限公司',
      '600746',
      '1996年',
      '江苏省镇江市',
      '任正非',
      '醋酸行业',
    ],
    goldRelationPairs: [
      ['江苏索普化工股份有限公司', '600746'],
      ['江苏索普化工股份有限公司', '1996年'],
      ['江苏索普化工股份有限公司', '江苏省镇江市'],
      ['江苏索普化工股份有限公司', '醋酸行业'],
      ['任正非', '江苏索普化工股份有限公司'],
    ],
  },
  {
    id: 2,
    name: 'English tech biography',
    text: 'Apple Inc., founded by Steve Jobs in 1976 in Cupertino, California, is a multinational technology company. Tim Cook is the current CEO.',
    goldEntityIds: [
      'Apple Inc.',
      'Steve Jobs',
      '1976',
      'Cupertino',
      'California',
      'Tim Cook',
    ],
    goldRelationPairs: [
      ['Apple Inc.', 'Steve Jobs'],
      ['Apple Inc.', '1976'],
      ['Apple Inc.', 'Cupertino'],
      ['Apple Inc.', 'California'],
      ['Apple Inc.', 'Tim Cook'],
    ],
  },
  {
    id: 3,
    name: '中英混合 / 公司治理',
    text: '微软公司(Microsoft)总部位于美国华盛顿州雷德蒙德，由比尔·盖茨和保罗·艾伦于1975年创立。现任CEO是萨蒂亚·纳德拉。',
    goldEntityIds: [
      '微软公司',
      'Microsoft',
      '美国',
      '华盛顿州',
      '雷德蒙德',
      '比尔·盖茨',
      '保罗·艾伦',
      '1975年',
      '萨蒂亚·纳德拉',
    ],
    goldRelationPairs: [
      ['微软公司', '美国'],
      ['微软公司', '华盛顿州'],
      ['微软公司', '雷德蒙德'],
      ['微软公司', '比尔·盖茨'],
      ['微软公司', '保罗·艾伦'],
      ['微软公司', '1975年'],
      ['微软公司', '萨蒂亚·纳德拉'],
    ],
  },
  {
    id: 4,
    name: 'Sparse / low-entity',
    text: '今天是2024年3月15日，天气晴。',
    goldEntityIds: ['2024年3月15日'],
    goldRelationPairs: [],
  },
];

// ─── MIRROR of src/server/kb-relations.ts pure helpers ──────────────────
// MIRROR: keep in sync. If you change `parseExtraction` or `validateGrounding`
// in `src/server/kb-relations.ts`, you MUST mirror the change here AND add a
// `kb-relations.unit.test.ts` case for it. The script is intentionally
// self-contained so it does not drag in the sidecar import graph.

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : trimmed;
}

function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

type ExtractedEntity = { id: string; sourceQuote?: string; charStart?: number; charEnd?: number };
type TypedRelation = { subject: string; object: string; relation_type: string; sourceQuote?: string; charStart?: number; charEnd?: number };
type ExtractionResult = { entities: ExtractedEntity[]; relations: TypedRelation[] };

function parseExtraction(text: string): ExtractionResult {
  const jsonText = extractBalancedJson(stripMarkdownFence(text));
  if (!jsonText) return { entities: [], relations: [] };
  try {
    const parsed = JSON.parse(jsonText) as {
      entities?: Array<Record<string, unknown>>;
      relations?: Array<Record<string, unknown>>;
    };
    const entities: ExtractedEntity[] = Array.isArray(parsed.entities)
      ? parsed.entities
          .filter((e): e is Record<string, unknown> => !!e && typeof e.id === 'string')
          .map((e) => {
            const sq = typeof e.source_quote === 'string' ? e.source_quote : typeof e.sourceQuote === 'string' ? e.sourceQuote : undefined;
            const csRaw = (e.char_start ?? e.charStart) as unknown;
            const ceRaw = (e.char_end ?? e.charEnd) as unknown;
            const cs = typeof csRaw === 'number' && Number.isInteger(csRaw) && csRaw >= 0 ? csRaw : undefined;
            const ce = typeof ceRaw === 'number' && Number.isInteger(ceRaw) && ceRaw >= 0 ? ceRaw : undefined;
            return {
              id: String(e.id).trim(),
              ...(sq ? { sourceQuote: sq } : {}),
              ...(cs !== undefined && ce !== undefined ? { charStart: cs, charEnd: ce } : {}),
            };
          })
          .filter((e) => e.id.length > 0)
      : [];
    const relations: TypedRelation[] = Array.isArray(parsed.relations)
      ? parsed.relations
          .filter((r): r is Record<string, unknown> => !!r && typeof r.subject === 'string' && typeof r.object === 'string')
          .map((r) => {
            const sq = typeof r.source_quote === 'string' ? r.source_quote : typeof r.sourceQuote === 'string' ? r.sourceQuote : undefined;
            const csRaw = (r.char_start ?? r.charStart) as unknown;
            const ceRaw = (r.char_end ?? r.charEnd) as unknown;
            const cs = typeof csRaw === 'number' && Number.isInteger(csRaw) && csRaw >= 0 ? csRaw : undefined;
            const ce = typeof ceRaw === 'number' && Number.isInteger(ceRaw) && ceRaw >= 0 ? ceRaw : undefined;
            return {
              subject: String(r.subject).trim(),
              object: String(r.object).trim(),
              relation_type: typeof r.relation_type === 'string' && r.relation_type.trim() ? r.relation_type : 'related_to',
              ...(sq ? { sourceQuote: sq } : {}),
              ...(cs !== undefined && ce !== undefined ? { charStart: cs, charEnd: ce } : {}),
            };
          })
          .filter((r) => r.subject.length > 0 && r.object.length > 0 && r.subject !== r.object)
      : [];
    return { entities, relations };
  } catch {
    return { entities: [], relations: [] };
  }
}

function validateGrounding(
  originalText: string,
  result: ExtractionResult,
): { cleaned: ExtractionResult; droppedEntities: number; droppedRelations: number; charIntervalUsed: number } {
  const substringLocates = (q: string | undefined): boolean =>
    typeof q === 'string' && q.length > 0 && originalText.includes(q);
  const intervalLocates = (q: string | undefined, cs: number | undefined, ce: number | undefined): boolean => {
    if (cs === undefined || ce === undefined) return false;
    if (typeof q !== 'string' || q.length === 0) return false;
    if (cs >= ce || cs < 0 || ce > originalText.length) return false;
    return originalText.slice(cs, ce) === q;
  };
  const isLocated = (q: string | undefined, cs: number | undefined, ce: number | undefined): boolean =>
    intervalLocates(q, cs, ce) || (!q ? true : substringLocates(q));

  let charIntervalUsed = 0;
  const cleanedEntities = result.entities.filter((e) => {
    const ok = isLocated(e.sourceQuote, e.charStart, e.charEnd);
    if (e.charStart !== undefined && e.charEnd !== undefined) charIntervalUsed++;
    return ok;
  });
  const entityIds = new Set(cleanedEntities.map((e) => e.id));
  const cleanedRelations = result.relations.filter((r) => {
    if (!entityIds.has(r.subject) || !entityIds.has(r.object)) return false;
    if (!r.sourceQuote) return true;
    return isLocated(r.sourceQuote, r.charStart, r.charEnd);
  });
  return {
    cleaned: { entities: cleanedEntities, relations: cleanedRelations },
    droppedEntities: result.entities.length - cleanedEntities.length,
    droppedRelations: result.relations.length - cleanedRelations.length,
    charIntervalUsed,
  };
}

// ─── SYSTEM_PROMPT — verbatim copy from src/server/kb-relations.ts ──────
const SYSTEM_PROMPT = `You extract a COMPLETE knowledge graph from a text chunk: every real named entity (companies, people, products, places, dates, codes, documents, concepts) with its TYPE, and every confident TYPED relation between them.

For EACH entity AND EACH relation, you MUST also output BOTH:
  (a) a \`source_quote\` field — the EXACT VERBATIM contiguous text span from the input chunk where that entity appears or that supports the relation, AND
  (b) a \`char_start\` + \`char_end\` pair — the [start, end) half-open character offsets of the same span in the input text (count code units; first character is 0, end is exclusive).
Self-verify before output: (i) the source_quote MUST be a byte-for-byte substring of the input, AND (ii) \`input.slice(char_start, char_end)\` MUST equal source_quote exactly. If you cannot find an entity's verbatim text, DO NOT output the entity.

Output: a single JSON object (NO markdown fences, NO prose):
{"entities":[{"id":"<canonical name>","label":"<canonical name>","type":"<ORG|PERSON|PLACE|PRODUCT|DATE|CODE|DOCUMENT|CONCEPT|...>","source_quote":"<verbatim text span, exact match>","char_start":<int>,"char_end":<int>}],"relations":[{"subject":"<entity id>","object":"<entity id>","relation_type":"<snake_case verb phrase>","weight":<0..1 confidence>","source_quote":"<verbatim text span supporting this relation>","char_start":<int>,"char_end":<int>}]}

Rules:
- Entities: EXHAUSTIVE — extract ALL proper nouns and key concepts in the chunk, no matter how many. The "id" MUST be the full canonical name itself (e.g. "江苏索普化工股份有限公司", "600746", "任正非"), never "e1" or an index. "label" equals "id". "type" is the entity kind (ORG/PERSON/PLACE/PRODUCT/DATE/CODE/DOCUMENT/CONCEPT).
- Relations: extract EVERY confident relation between entities (e.g. "founded_by", "listed_as", "part_of", "located_in", "acquired_by", "produces", "publishes", "employs", "succeeded_by"). subject and object MUST be entity ids from your entities list.
- Granularity: be fine-grained — capture the full knowledge structure. Do NOT cap counts; extract everything meaningful in the chunk.
- Output nothing but the JSON object.

EXAMPLE INPUT:
"""
江苏索普化工股份有限公司（股票代码600746）成立于1996年，总部位于江苏省镇江市。任正非先生曾在公开场合提到该公司是国内醋酸行业的领军企业。
"""

EXAMPLE OUTPUT:
{"entities":[{"id":"江苏索普化工股份有限公司","label":"江苏索普化工股份有限公司","type":"ORG","source_quote":"江苏索普化工股份有限公司","char_start":0,"char_end":12},{"id":"600746","label":"600746","type":"CODE","source_quote":"股票代码600746","char_start":13,"char_end":23},{"id":"1996年","label":"1996年","type":"DATE","source_quote":"成立于1996年","char_start":24,"char_end":32},{"id":"江苏省镇江市","label":"江苏省镇江市","type":"PLACE","source_quote":"江苏省镇江市","char_start":37,"char_end":43},{"id":"任正非","label":"任正非","type":"PERSON","source_quote":"任正非先生","char_start":44,"char_end":49},{"id":"醋酸行业","label":"醋酸行业","type":"CONCEPT","source_quote":"醋酸行业","char_start":63,"char_end":67}],"relations":[{"subject":"江苏索普化工股份有限公司","object":"600746","relation_type":"listed_as","weight":0.99,"source_quote":"股票代码600746","char_start":13,"char_end":23},{"subject":"江苏索普化工股份有限公司","object":"1996年","relation_type":"founded_in","weight":0.95,"source_quote":"成立于1996年","char_start":24,"char_end":32},{"subject":"江苏索普化工股份有限公司","object":"江苏省镇江市","relation_type":"located_in","weight":0.95,"source_quote":"总部位于江苏省镇江市","char_start":28,"char_end":40},{"subject":"江苏索普化工股份有限公司","object":"醋酸行业","relation_type":"operates_in","weight":0.9,"source_quote":"国内醋酸行业的领军企业","char_start":61,"char_end":72},{"subject":"任正非","object":"江苏索普化工股份有限公司","relation_type":"mentions","weight":0.7,"source_quote":"提到该公司","char_start":55,"char_end":60}]}`;

function buildUserPrompt(text: string): string {
  return `Text chunk:\n"""\n${text}\n"""\n\nExtract the complete knowledge graph from this text.`;
}

// ─── provider HTTP call (mirror of providerMessagesText in kb-relations.ts) ─

async function providerMessagesText(env: ProviderEnv, system: string, user: string): Promise<string> {
  const baseUrl = (env.baseUrl ?? '').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/messages`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      ...(env.apiKey ? { Authorization: `Bearer ${env.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: env.model,
      max_tokens: 8192,
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`provider ${resp.status}: ${body.slice(0, 300)}`);
  }
  const raw = await resp.text();
  if (raw.trimStart().startsWith('{')) {
    const data = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
    return (data.content ?? []).filter((b) => b.type === 'text' && b.text).map((b) => b.text as string).join('\n');
  }
  let text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } };
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') text += evt.delta.text ?? '';
    } catch { /* partial SSE */ }
  }
  return text;
}

// ─── SDK fallback call (mirror of sdkExtractRawText in kb-relations.ts) ──
//
// When the configured provider has only an apiKey (no baseUrl) — typical for
// subscription auth or default Anthropic — production falls back to the
// Claude Agent SDK's `query()`. The SDK bundles its own CLI binary and reads
// `ANTHROPIC_API_KEY` from env. We mirror the minimal call shape here.
async function providerSdkText(env: ProviderEnv, system: string, user: string): Promise<string> {
  const { randomUUID } = await import('node:crypto');
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const sessionId = randomUUID();

  async function* promptStream(): AsyncIterable<{
    type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null; session_id: string;
  }> {
    yield {
      type: 'user',
      message: { role: 'user', content: user },
      parent_tool_use_id: null,
      session_id: sessionId,
    };
  }

  // Inject apiKey as ANTHROPIC_API_KEY for this process so the SDK / its bundled
  // CLI pick it up. Only mutate env if we're the script that needs it — once
  // we've recorded the original value we restore it after the call.
  const envKey = 'ANTHROPIC_API_KEY';
  const original = process.env[envKey];
  if (env.apiKey) process.env[envKey] = env.apiKey;
  try {
    const q = query({
      prompt: promptStream(),
      options: {
        maxTurns: 1,
        sessionId,
        cwd: join(homedir(), '.hamuna', 'projects'),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        systemPrompt: system,
        thinking: { type: 'disabled' },
        effort: 'low',
        includePartialMessages: false,
        persistSession: false,
        mcpServers: {},
        ...(env.model ? { model: env.model } : {}),
      },
    });
    let text = '';
    for await (const message of q) {
      const blocks = (message as { content?: unknown }).content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
            text += String((block as { text?: unknown }).text ?? '');
          }
        }
      }
    }
    return text;
  } finally {
    if (original === undefined) delete process.env[envKey];
    else process.env[envKey] = original;
  }
}

// ─── unified dispatch ────────────────────────────────────────────────────

async function callProvider(env: ProviderEnv, system: string, user: string): Promise<string> {
  if (env.mode === 'sdk') return providerSdkText(env, system, user);
  return providerMessagesText(env, system, user);
}

// ─── scoring ─────────────────────────────────────────────────────────────

/** A predicted id matches a gold id if they are equal OR if either is a
 *  substring of the other (e.g., gold "华盛顿州" matches predicted "美国华盛顿州雷德蒙德";
 *  gold "微软公司" matches predicted "Microsoft" only if we ALSO add "Microsoft"
 *  to gold — handled by fixture design). */
function matchesGold(predictedId: string, goldId: string): boolean {
  return predictedId === goldId || predictedId.includes(goldId) || goldId.includes(predictedId);
}

type Metrics = { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number };

function scoreEntities(predictedIds: string[], goldIds: string[]): { metrics: Metrics; matched: Array<{ gold: string; predicted: string }>; missed: string[]; hallucinated: string[] } {
  const matched: Array<{ gold: string; predicted: string }> = [];
  const consumedPredicted = new Set<number>();
  const consumedGold = new Set<number>();
  for (let gi = 0; gi < goldIds.length; gi++) {
    for (let pi = 0; pi < predictedIds.length; pi++) {
      if (consumedPredicted.has(pi)) continue;
      if (matchesGold(predictedIds[pi], goldIds[gi])) {
        matched.push({ gold: goldIds[gi], predicted: predictedIds[pi] });
        consumedPredicted.add(pi);
        consumedGold.add(gi);
        break;
      }
    }
  }
  const missed = goldIds.filter((_, i) => !consumedGold.has(i));
  const hallucinated = predictedIds.filter((_, i) => !consumedPredicted.has(i));
  const tp = matched.length;
  const fp = hallucinated.length;
  const fn = missed.length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { metrics: { tp, fp, fn, precision, recall, f1 }, matched, missed, hallucinated };
}

function scoreRelations(predictedPairs: Array<[string, string]>, goldPairs: Array<[string, string]>): Metrics {
  const pairMatches = (a: [string, string], b: [string, string]): boolean => {
    const [a1, a2] = a;
    const [b1, b2] = b;
    return (matchesGold(a1, b1) && matchesGold(a2, b2)) || (matchesGold(a1, b2) && matchesGold(a2, b1));
  };
  const matched = new Set<number>();
  const consumedGold = new Set<number>();
  for (let gi = 0; gi < goldPairs.length; gi++) {
    for (let pi = 0; pi < predictedPairs.length; pi++) {
      if (matched.has(pi)) continue;
      if (pairMatches(predictedPairs[pi], goldPairs[gi])) {
        matched.add(pi);
        consumedGold.add(gi);
        break;
      }
    }
  }
  const tp = consumedGold.size;
  const fp = predictedPairs.length - matched.size;
  const fn = goldPairs.length - consumedGold.size;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

// ─── main ────────────────────────────────────────────────────────────────

async function runFixture(env: ProviderEnv, fix: Fixture) {
  const user = buildUserPrompt(fix.text);
  const raw = await callProvider(env, SYSTEM_PROMPT, user);
  const parsed = parseExtraction(raw);
  const { cleaned, droppedEntities, droppedRelations, charIntervalUsed } = validateGrounding(fix.text, parsed);
  const predictedEntityIds = cleaned.entities.map((e) => e.id);
  const predictedPairs: Array<[string, string]> = cleaned.relations.map((r) => [r.subject, r.object]);

  const entityScore = scoreEntities(predictedEntityIds, fix.goldEntityIds);
  const relationScore = scoreRelations(predictedPairs, fix.goldRelationPairs);

  return {
    fixture: fix,
    raw_len: raw.length,
    raw_first_120: raw.slice(0, 120),
    parsed_preliminary: parsed,
    dropped_entities_by_grounding: droppedEntities,
    dropped_relations_by_grounding: droppedRelations,
    char_interval_used: charIntervalUsed,
    cleaned,
    entity_score: entityScore,
    relation_score: relationScore,
  };
}

async function main() {
  const env = loadProviderEnv(modelOverride);
  if (!jsonOutput) {
    console.log(`=== KB recall benchmark ===`);
    console.log(`provider: mode=${env.mode} baseUrl=${env.baseUrl ?? '(sdk)'} model=${env.model}`);
    console.log(`fixtures: ${FIXTURES.length} hand-crafted`);
    console.log('');
  }
  const fixturesToRun = fixtureFilter ? FIXTURES.filter((f) => fixtureFilter.has(f.id)) : FIXTURES;
  const results = [] as Awaited<ReturnType<typeof runFixture>>[];
  let totalCalls = 0;
  for (const fix of fixturesToRun) {
    if (!jsonOutput) process.stderr.write(`running fixture ${fix.id} (${fix.name}) ... `);
    totalCalls++;
    try {
      const r = await runFixture(env, fix);
      results.push(r);
      if (!jsonOutput) process.stderr.write('ok\n');
    } catch (e) {
      if (!jsonOutput) process.stderr.write(`FAIL: ${e instanceof Error ? e.message : String(e)}\n`);
      throw e;
    }
  }
  if (jsonOutput) {
    console.log(JSON.stringify({ provider: env, results: results }, null, 2));
    return;
  }
  // Per-fixture report
  for (const r of results) {
    const { fixture, parsed_preliminary, dropped_entities_by_grounding, dropped_relations_by_grounding, char_interval_used, cleaned, entity_score, relation_score, raw_len, raw_first_120 } = r;
    console.log('');
    console.log(`── Fixture ${fixture.id}: ${fixture.name} ──`);
    console.log(`  text len: ${fixture.text.length} chars`);
    console.log(`  LLM raw:  ${raw_len} chars (preview: ${raw_first_120.replace(/\s+/g, ' ').slice(0, 80)}…)`);
    console.log(`  parsed:   ${parsed_preliminary.entities.length} entities / ${parsed_preliminary.relations.length} relations (preliminary)`);
    console.log(`  grounded: ${cleaned.entities.length} entities / ${cleaned.relations.length} relations (after mechanical check)`);
    console.log(`  dropped:  ${dropped_entities_by_grounding} entities / ${dropped_relations_by_grounding} relations`);
    console.log(`  char_interval_used: ${char_interval_used}/${parsed_preliminary.entities.length}`);
    console.log('');
    console.log(`  ENTITIES  P=${entity_score.metrics.precision.toFixed(3)} R=${entity_score.metrics.recall.toFixed(3)} F1=${entity_score.metrics.f1.toFixed(3)}  (TP=${entity_score.metrics.tp} FP=${entity_score.metrics.fp} FN=${entity_score.metrics.fn})`);
    console.log(`    matched:      ${entity_score.matched.map((m) => `${m.predicted} ✓ (gold: ${m.gold})`).join('  ')}`);
    if (entity_score.missed.length > 0) console.log(`    MISSED:       ${entity_score.missed.join('  ')}`);
    if (entity_score.hallucinated.length > 0) console.log(`    HALLUCINATED: ${entity_score.hallucinated.join('  ')}`);
    console.log('');
    console.log(`  RELATIONS P=${relation_score.precision.toFixed(3)} R=${relation_score.recall.toFixed(3)} F1=${relation_score.f1.toFixed(3)}  (TP=${relation_score.tp} FP=${relation_score.fp} FN=${relation_score.fn})`);
  }
  // Aggregate
  console.log('');
  console.log('=== Aggregate ===');
  let sumEp = 0, sumEr = 0, sumEf = 0;
  let sumRp = 0, sumRr = 0, sumRf = 0;
  for (const r of results) {
    sumEp += r.entity_score.metrics.precision;
    sumEr += r.entity_score.metrics.recall;
    sumEf += r.entity_score.metrics.f1;
    sumRp += r.relation_score.precision;
    sumRr += r.relation_score.recall;
    sumRf += r.relation_score.f1;
  }
  const n = results.length || 1;
  console.log(`  entities  macro P=${(sumEp / n).toFixed(3)} R=${(sumEr / n).toFixed(3)} F1=${(sumEf / n).toFixed(3)}`);
  console.log(`  relations macro P=${(sumRp / n).toFixed(3)} R=${(sumRr / n).toFixed(3)} F1=${(sumRf / n).toFixed(3)}`);
  console.log(`  total LLM calls: ${totalCalls}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});