// kb-relations.ts — LLM knowledge extraction for the knowledge base graph.
//
// Rust ingests material and builds the deterministic skeleton (jieba entities +
// co-occurrence edges). This module consumes the pending queue, asks the LLM to
// extract REAL named entities + typed relations from each chunk text, and
// writes them back to Rust via the management API.
//
// It is best-effort and asynchronous: the `kb_query` tool already works off the
// skeleton edges, so a failure here (no model, timeout, bad JSON) never affects
// queries — it only leaves the graph without LLM enrichment.
//
// Why direct HTTP instead of the SDK `query()`? The SDK wrapper drops assistant
// text content for OpenAI-compatible providers that reply with `thinking`
// blocks (DeepSeek-style) — the raw /v1/messages endpoint returns the text
// fine. We call the provider's Anthropic-format API directly when a provider
// env is available, and fall back to the SDK for the subscription path.

import { homedir } from 'os';
import { join } from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { buildClaudeSessionEnv, resolveClaudeCodeCli, getSessionModel, type ProviderEnv } from './agent-session';
import { findEffectiveProvider, loadConfig, resolveProviderEnv } from './utils/admin-config';
import { cancellableFetch } from './utils/cancellation';
import { applyProviderContextWindowSuffix } from './utils/model-capabilities';
import { SUBSCRIPTION_PROVIDER_ID } from '../shared/config-types';

const POLL_INTERVAL_MS = 15_000;
const EXTRACTION_TIMEOUT_MS = 90_000;
const MAX_TASKS_PER_POLL = 10;
/// Provider output budget for one chunk extraction. The user wants complete
/// knowledge structures (entities + types + relations), so give the model room
/// beyond a bare answer. DeepSeek-style thinking stays disabled (it used to
/// swallow the whole budget); 16384 is the requested ceiling.
const MAX_OUTPUT_TOKENS = 16_384;

/**
 * Resolve the model (+ its provider env) for relation extraction.
 * 1. Live session model (chat sidecar) — matches what the user is running.
 * 2. First enabled agent's model (config.agents).
 * 3. Default provider's primaryModel / first model (availableProvidersJson).
 * Any of these can drive a headless SDK query, so KB relations get typed even
 * with only the global sidecar running.
 */
function resolveRelationModel(): { model: string; providerEnv?: ProviderEnv } | null {
  const config = loadConfig();

  const sessionModel = getSessionModel();
  if (sessionModel) {
    const agent = config.agents?.find((a) => a.model === sessionModel);
    const providerId = agent?.providerId ?? config.defaultProviderId;
    const providerEnv = providerId ? resolveProviderEnv(providerId, config) : undefined;
    return { model: sessionModel, providerEnv };
  }

  const agent = config.agents?.find((a) => a.model && a.enabled !== false);
  if (agent?.model) {
    const providerEnv = agent.providerId ? resolveProviderEnv(agent.providerId, config) : undefined;
    return { model: agent.model, providerEnv };
  }

  const providerId = config.defaultProviderId;
  if (providerId) {
    const provider = findEffectiveProvider(providerId, config);
    const model =
      (provider as { primaryModel?: string } | null)?.primaryModel ||
      (Array.isArray(provider?.models) && (provider.models[0] as { model?: string } | undefined)?.model);
    if (model) {
      const providerEnv = resolveProviderEnv(providerId, config);
      return { model, providerEnv };
    }
  }

  return null;
}

interface PendingRelationTask {
  // Rust serializes with #[serde(rename_all = "camelCase")] — the JSON field
  // is kbId, NOT kb_id (the snake_case name was undefined → write-back 422).
  kbId: string;
  chunkId: string;
  text: string;
  pairs: [string, string][];
}

interface TypedRelation {
  subject: string;
  object: string;
  relation_type: string;
  weight: number;
  typed: boolean;
  /**
   * Verbatim text span from the input chunk that supports this relation. Used
   * for source-grounding: a relation whose source_quote cannot be located in
   * the original text is treated as hallucinated and dropped.
   */
  sourceQuote?: string;
  /**
   * Character interval in the input chunk that supports this relation.
   * [charStart, charEnd) half-open. When present, the post-parse grounding
   * pass cross-checks `chunk.text.slice(charStart, charEnd) === sourceQuote`
   * for byte-for-byte consistency — a stricter check than substring search.
   */
  charStart?: number;
  charEnd?: number;
}

interface ExtractedEntity {
  id: string;
  label: string;
  entityType?: string;
  /**
   * Verbatim text span from the input chunk where this entity appears. The
   * post-parse grounding pass drops any entity whose source_quote cannot be
   * located in the original text (substring match, no normalization).
   */
  sourceQuote?: string;
  /**
   * Character interval in the input chunk where this entity appears.
   * [charStart, charEnd) half-open. When present, the grounding pass
   * cross-checks `chunk.text.slice(charStart, charEnd) === sourceQuote`
   * for byte-for-byte consistency — a stricter, position-anchored check
   * (LangExtract-style) that is not fooled by LLM quote transcription errors.
   */
  charStart?: number;
  charEnd?: number;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: TypedRelation[];
}

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

function buildUserPrompt(task: PendingRelationTask): string {
  // task.text is already a bounded, meaning-preserving chunk from the Rust
  // side (NO truncation of the original file — every character is in some
  // chunk). Send it in full.
  return `Text chunk:\n"""\n${task.text}\n"""\n\nExtract the complete knowledge graph from this text.`;
}

/**
 * Strip a leading/trailing markdown code fence from model output. Models
 * regularly wrap JSON in ```json ... ``` or ``` ... ``` even when the system
 * prompt forbids it; pre-stripping lets `extractBalancedJson` see the bare
 * object instead of fighting fence characters (the fence's `{`/`}` would
 * otherwise break brace counting — though our counter is string-aware, the
 * fence's trailing ``` is harmless; the issue is the model's prose BETWEEN
 * the fence opener and the JSON, which we want gone).
 */
export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  // Match ``` optional-language (json, JSON, or empty) on its own line, then
  // capture everything up to the closing ``` on its own line.
  const m = trimmed.match(/^```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : trimmed;
}

/**
 * Extract the first balanced `{...}` JSON object from arbitrary model output.
 * String-aware (counts braces inside `"..."` as data) and backslash-escape
 * aware (so `\"` inside a string does not toggle the string state).
 *
 * This replaces the old `indexOf('{')` + `lastIndexOf('}')` heuristic, which
 * broke whenever the model emitted explanatory prose containing a `}` (e.g.
 * "Example: {a: 1}.") — JSON.parse would then see a slice that runs past the
 * real object boundary.
 */
export function extractBalancedJson(text: string): string | null {
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

/** Parse the LLM's JSON object {entities, relations}. */
function parseExtraction(text: string): ExtractionResult {
  const jsonText = extractBalancedJson(stripMarkdownFence(text));
  if (!jsonText) return { entities: [], relations: [] };
  try {
    const parsed = JSON.parse(jsonText);
    const entities: ExtractedEntity[] = Array.isArray(parsed.entities)
      ? parsed.entities
          .filter((e: unknown) => e && typeof (e as { id?: unknown }).id === 'string')
          .map((e: { id?: string; label?: unknown; name?: unknown; type?: unknown; entity_type?: unknown; source_quote?: unknown; sourceQuote?: unknown; char_start?: unknown; charStart?: unknown; char_end?: unknown; charEnd?: unknown }) => {
            // Prefer the canonical name field; fall back to id when the model
            // emitted a bare index like "e1".
            const raw = (typeof e.label === 'string' && e.label.trim()) || (typeof e.name === 'string' && e.name.trim()) || String(e.id ?? '');
            const id = raw.trim();
            const t = typeof e.type === 'string' && e.type.trim() ? String(e.type).trim() : typeof e.entity_type === 'string' && e.entity_type.trim() ? String(e.entity_type).trim() : undefined;
            const sq = typeof e.source_quote === 'string' ? e.source_quote : typeof e.sourceQuote === 'string' ? e.sourceQuote : undefined;
            const csRaw = e.char_start ?? e.charStart;
            const ceRaw = e.char_end ?? e.charEnd;
            const cs = typeof csRaw === 'number' && Number.isInteger(csRaw) && csRaw >= 0 ? csRaw : undefined;
            const ce = typeof ceRaw === 'number' && Number.isInteger(ceRaw) && ceRaw >= 0 ? ceRaw : undefined;
            return {
              id,
              label: id,
              ...(t ? { entityType: t } : {}),
              ...(sq ? { sourceQuote: sq } : {}),
              ...(cs !== undefined && ce !== undefined ? { charStart: cs, charEnd: ce } : {}),
            };
          })
          .filter((e: { id: string }) => e.id.length > 0)
      : [];
    const relations: TypedRelation[] = Array.isArray(parsed.relations)
      ? parsed.relations
          .filter(
            (r: unknown) =>
              r && typeof (r as { subject?: unknown }).subject === 'string' && typeof (r as { object?: unknown }).object === 'string',
          )
          .map((r: { subject: string; object: string; relation_type?: unknown; weight?: unknown; source_quote?: unknown; sourceQuote?: unknown; char_start?: unknown; charStart?: unknown; char_end?: unknown; charEnd?: unknown }) => {
            const sq = typeof r.source_quote === 'string' ? r.source_quote : typeof r.sourceQuote === 'string' ? r.sourceQuote : undefined;
            const csRaw = r.char_start ?? r.charStart;
            const ceRaw = r.char_end ?? r.charEnd;
            const cs = typeof csRaw === 'number' && Number.isInteger(csRaw) && csRaw >= 0 ? csRaw : undefined;
            const ce = typeof ceRaw === 'number' && Number.isInteger(ceRaw) && ceRaw >= 0 ? ceRaw : undefined;
            return {
              subject: String(r.subject).trim(),
              object: String(r.object).trim(),
              relation_type:
                typeof r.relation_type === 'string' && r.relation_type.trim() ? String(r.relation_type).trim() : 'related_to',
              weight: typeof r.weight === 'number' ? r.weight : 1,
              typed: true,
              ...(sq ? { sourceQuote: sq } : {}),
              ...(cs !== undefined && ce !== undefined ? { charStart: cs, charEnd: ce } : {}),
            };
          })
          .filter((r: { subject: string; object: string }) => r.subject.length > 0 && r.object.length > 0 && r.subject !== r.object)
      : [];
    return { entities, relations };
  } catch {
    return { entities: [], relations: [] };
  }
}

/**
 * Source-grounding with two-tier verification:
 *
 *   1. **char_interval (preferred)** — when the model emitted `char_start` and
 *      `char_end`, we require `originalText.slice(charStart, charEnd)` to equal
 *      `sourceQuote` BYTE-FOR-BYTE. This is a position-anchored check that
 *      cannot be fooled by LLM quote transcription errors (the most common
 *      source_quote fabrication mode).
 *
 *   2. **substring search (fallback)** — when no char_interval is present, fall
 *      back to the old `originalText.includes(sourceQuote)` check. Weaker but
 *      still useful when the prompt is followed but positions are skipped.
 *
 * Items WITHOUT source_quote entirely are kept (defensive: better to retain a
 * possibly-correct entity than to drop it). The caller logs the drop count so
 * the operator can tell whether the prompt's grounding rule is taking effect.
 */
export function validateGrounding(
  originalText: string,
  result: ExtractionResult,
): { cleaned: ExtractionResult; droppedEntities: number; droppedRelations: number; charIntervalUsed: number } {
  const substringLocates = (q: string | undefined): boolean =>
    typeof q === 'string' && q.length > 0 && originalText.includes(q);

  const intervalLocates = (
    q: string | undefined,
    cs: number | undefined,
    ce: number | undefined,
  ): boolean => {
    if (cs === undefined || ce === undefined) return false;
    if (typeof q !== 'string' || q.length === 0) return false;
    if (cs >= ce || cs < 0 || ce > originalText.length) return false;
    return originalText.slice(cs, ce) === q;
  };

  const isLocated = (
    q: string | undefined,
    cs: number | undefined,
    ce: number | undefined,
  ): boolean => intervalLocates(q, cs, ce) || (!q ? true : substringLocates(q));

  let charIntervalUsed = 0;
  const keptEntities = result.entities.filter((e) => {
    if (e.charStart !== undefined && e.charEnd !== undefined && e.sourceQuote) charIntervalUsed++;
    return isLocated(e.sourceQuote, e.charStart, e.charEnd) || !e.sourceQuote;
  });
  const droppedEntities = result.entities.length - keptEntities.length;
  const entityIds = new Set(keptEntities.map((e) => e.id));

  const keptRelations = result.relations.filter((r) => {
    // Drop immediately if quote present but unlocated.
    if (r.sourceQuote && !isLocated(r.sourceQuote, r.charStart, r.charEnd)) return false;
    // Drop if endpoints were dropped from entities (orphan relation).
    return entityIds.has(r.subject) && entityIds.has(r.object);
  });
  const droppedRelations = result.relations.length - keptRelations.length;
  return { cleaned: { entities: keptEntities, relations: keptRelations }, droppedEntities, droppedRelations, charIntervalUsed };
}

/**
 * Call the provider's Anthropic-format /v1/messages API directly and return
 * the assistant text. Providers like DeepSeek stream SSE and reply with
 * `thinking` blocks first; we collect `text_delta` events only. This works
 * where the SDK wrapper surfaces an empty assistant message.
 */
/** Strip a trailing `/v1` (or anything after the host) so we can append the
 * protocol's own path segment without doubling it. Exported for unit tests. */
export function apiRoot(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  // Drop a trailing "/v1" (common in provider configs: ".../api/v1").
  return trimmed.replace(/\/v1$/, '');
}

/**
 * Call the provider and return the assistant text, speaking the provider's
 * own protocol:
 * - anthropic (or unlabelled): POST /v1/messages, collect anthropic SSE
 *   `text_delta` events.
 * - openai: POST /v1/chat/completions, collect OpenAI SSE `delta.content`.
 * A single-turn, tool-less request needs no bridge translation — both formats
 * carry the same system+user prompt.
 */
async function providerMessagesText(
  providerEnv: ProviderEnv,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const root = apiRoot(providerEnv.baseUrl ?? '');
  const isOpenai = providerEnv.apiProtocol === 'openai';
  const endpoint = isOpenai ? `${root}/v1/chat/completions` : `${root}/v1/messages`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(providerEnv.apiKey ? { Authorization: `Bearer ${providerEnv.apiKey}` } : {}),
  };
  let body: string;
  if (isOpenai) {
    body = JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
    });
  } else {
    headers['x-api-key'] = providerEnv.apiKey ?? '';
    headers['anthropic-version'] = '2023-06-01';
    body = JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // DeepSeek-style providers burn the whole token budget on `thinking`
      // blocks and hit `stop_reason: max_tokens` before emitting the JSON
      // answer. Disable extended thinking so the model answers directly.
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: user }],
    });
  }

  const resp = await cancellableFetch(endpoint, { method: 'POST', headers, body }, { timeoutMs: EXTRACTION_TIMEOUT_MS });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`provider ${resp.status}: ${errBody.slice(0, 200)}`);
  }
  const raw = await resp.text();
  // Non-streaming JSON responses (plain body) — parse by protocol.
  if (raw.trimStart().startsWith('{')) {
    if (isOpenai) {
      const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> };
      const c = data.choices?.[0]?.message?.content;
      return typeof c === 'string' ? c : '';
    }
    const data = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
    return (data.content ?? [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n');
  }
  // SSE stream.
  let text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string };
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      if (isOpenai) {
        const c = evt.choices?.[0]?.delta?.content;
        if (typeof c === 'string') text += c;
      } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        text += evt.delta.text ?? '';
      }
    } catch {
      /* partial SSE frame — ignore */
    }
  }
  return text;
}

const VERIFY_SYSTEM_PROMPT = `You are a strict auditor of an extraction. Given the original text and a list of extracted entities, verify each entity: its source_quote MUST appear verbatim in the original text, and the entity id MUST be a name that actually appears in (or is canonicalized from) the source_quote.

Note: you may be reviewing an extraction produced by your own prior turn. Do not trust your own output — re-locate every source_quote by direct substring match against the original text. Treat any source_quote that does not appear verbatim as fabricated.

Output: a single JSON object (NO markdown fences, NO prose):
{"keep":["<id1>","<id2>",...],"drop":["<id3>",...]}

Rules:
- For each entity: locate its source_quote in the original text by character-by-character search. If absent, add its id to "drop".
- If the id is not present in the source_quote (e.g. id="苹果公司" but quote="苹果"), still keep it (full canonical form is acceptable).
- Be conservative: only drop entries where you are confident the source_quote is fabricated.
- Output nothing but the JSON object.`;

function buildVerifyPrompt(task: PendingRelationTask, result: ExtractionResult): string {
  const slim = {
    text: task.text,
    entities: result.entities.map((e) => ({ id: e.id, source_quote: e.sourceQuote ?? '' })),
  };
  return `Original text:\n"""\n${task.text}\n"""\n\nExtraction to audit:\n${JSON.stringify(slim, null, 2)}\n\nReturn the JSON verdict.`;
}

/**
 * Self-verification pass: ask the LLM to audit which entities have fabricated
 * source_quotes. Costs one extra LLM call; opt-in via `verifyWithLlm`.
 *
 * On any failure (LLM error, unparseable response, timeout) returns the
 * input unchanged — the caller falls back to the mechanically-validated
 * result. We never let the verifier *delete* valid entities just because it
 * itself failed.
 */
async function verifyExtraction(
  task: PendingRelationTask,
  preliminary: ExtractionResult,
  model: string,
  providerEnv?: ProviderEnv,
): Promise<ExtractionResult> {
  if (preliminary.entities.length === 0) return preliminary;
  const useDirect = Boolean(providerEnv?.baseUrl && providerEnv.apiKey);
  try {
    const user = buildVerifyPrompt(task, preliminary);
    const text = useDirect
      ? await providerMessagesText(providerEnv as ProviderEnv, model, VERIFY_SYSTEM_PROMPT, user)
      : await sdkExtractText(model, VERIFY_SYSTEM_PROMPT, user);
    const jsonText = extractBalancedJson(text);
    if (!jsonText) return preliminary;
    const verdict = JSON.parse(jsonText) as { keep?: unknown; drop?: unknown };
    const dropSet = new Set(
      Array.isArray(verdict.drop) ? verdict.drop.filter((x): x is string => typeof x === 'string') : [],
    );
    if (dropSet.size === 0) return preliminary;
    const filtered = preliminary.entities.filter((e) => !dropSet.has(e.id));
    const entityIds = new Set(filtered.map((e) => e.id));
    return {
      entities: filtered,
      relations: preliminary.relations.filter((r) => entityIds.has(r.subject) && entityIds.has(r.object)),
    };
  } catch {
    return preliminary;
  }
}

/**
 * SDK-path raw text extractor used by verifyExtraction (sdkExtract above is
 * shaped around the kb-relations flow and strips to typed ExtractionResult).
 */
async function sdkExtractText(model: string, system: string, user: string): Promise<string> {
  const { randomUUID } = await import('crypto');
  const sessionId = randomUUID();
  const cliPath = resolveClaudeCodeCli();
  const cwd = join(homedir(), '.hamuna', 'projects');
  const env = buildClaudeSessionEnv(undefined, model, { providerId: SUBSCRIPTION_PROVIDER_ID });

  async function* promptStream() {
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content: user },
      parent_tool_use_id: null,
      session_id: sessionId,
    };
  }

  const q = query({
    prompt: promptStream(),
    options: {
      maxTurns: 1,
      sessionId,
      cwd,
      settingSources: ['project'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: cliPath,
      env,
      systemPrompt: system,
      thinking: { type: 'disabled' },
      effort: 'low',
      includePartialMessages: false,
      persistSession: false,
      mcpServers: {},
      tools: [],
      ...(model ? { model: applyProviderContextWindowSuffix(model, SUBSCRIPTION_PROVIDER_ID) } : {}),
    },
  });

  let text = '';
  const timeout = new Promise<string>((r) => setTimeout(() => r(text), EXTRACTION_TIMEOUT_MS));
  const run = (async (): Promise<string> => {
    for await (const message of q) {
      const blocks = (message as { content?: unknown }).content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
            text += String((block as { text?: string }).text ?? '');
          }
        }
      }
    }
    return text;
  })();
  return Promise.race([run, timeout]);
}

/**
 * Extract + ground knowledge from raw model text. Throws when the model
 * returned NO parseable JSON at all (blank / prose-only reply) — that is a
 * FAILURE and must retry, NOT a genuine "nothing found" result. A balanced
 * JSON object that simply has empty entities/relations IS a genuine empty
 * result and returns `[]`/`[]` (the poller dequeues it instead of burning an
 * LLM call every poll forever).
 */
function parseAndGroundOrThrow(task: PendingRelationTask, text: string, label: string): ExtractionResult {
  const json = extractBalancedJson(stripMarkdownFence(text));
  if (!json) {
    throw new Error(`${label} returned no parseable JSON (${text.length} chars)`);
  }
  const parsed = parseExtraction(text);
  const { cleaned, droppedEntities, droppedRelations, charIntervalUsed } = validateGrounding(task.text, parsed);
  console.log(
    `[kb-relations] ${label} parsed=${parsed.entities.length}e/${parsed.relations.length}r grounded=${cleaned.entities.length}e/${cleaned.relations.length}r dropped=${droppedEntities}e/${droppedRelations}r charIntervalUsed=${charIntervalUsed}`,
  );
  return cleaned;
}

async function extractKnowledge(
  task: PendingRelationTask,
  model: string,
  providerEnv?: ProviderEnv,
): Promise<ExtractionResult> {
  const useDirect = Boolean(providerEnv?.baseUrl && providerEnv.apiKey);
  console.log(
    `[kb-relations] extractKnowledge model=${model} path=${useDirect ? 'direct-http' : 'sdk-fallback'} baseUrl=${providerEnv?.baseUrl ?? 'none'}`,
  );
  // First successful parse wins; genuine empty (balanced JSON, nothing found)
  // returns [] — only a NO-JSON failure throws through to retry.
  const attemptDirect = async (): Promise<ExtractionResult> => {
    if (!useDirect) throw new Error('no direct provider env');
    const text = await providerMessagesText(providerEnv as ProviderEnv, model, SYSTEM_PROMPT, buildUserPrompt(task));
    console.log(`[kb-relations] direct-http returned ${text.length} chars: ${text.slice(0, 150)}`);
    return parseAndGroundOrThrow(task, text, 'direct-http');
  };
  const attemptSdk = async (label: string): Promise<ExtractionResult> =>
    parseAndGroundOrThrow(task, await sdkExtractRawText(task, model), label);

  let preliminary: ExtractionResult;
  try {
    preliminary = await attemptDirect();
  } catch (err) {
    console.warn('[kb-relations] direct-http failed, retrying with SDK:', err instanceof Error ? err.message : err);
    preliminary = await attemptSdk('sdk-fallback');
  }
  if (preliminary.entities.length === 0 && preliminary.relations.length === 0) return preliminary;

  // Self-verification is an EXTRA LLM call per chunk — gate it to the cases
  // where it pays: big extractions (wide hallucination surface) or any kept
  // entity WITHOUT a located quote (grounding let it through on the lenient
  // no-quote path, so an LLM audit is the only guard). Most chunks skip it.
  const needsVerify =
    preliminary.entities.length >= 25
    || preliminary.entities.some((e) => !e.sourceQuote && e.charStart === undefined);
  if (!needsVerify) {
    console.log('[kb-relations] verify skipped (small + fully grounded result)');
    return preliminary;
  }
  const verified = await verifyExtraction(task, preliminary, model, providerEnv);
  const removedByVerify = preliminary.entities.length - verified.entities.length;
  if (removedByVerify > 0) {
    console.log(`[kb-relations] self-verify dropped ${removedByVerify} additional entities`);
  }
  return verified;
}

/** Like sdkExtract but returns raw text (parseExtraction is applied later). */
async function sdkExtractRawText(task: PendingRelationTask, model: string): Promise<string> {
  const { randomUUID } = await import('crypto');
  const sessionId = randomUUID();
  const cliPath = resolveClaudeCodeCli();
  const cwd = join(homedir(), '.hamuna', 'projects');
  const env = buildClaudeSessionEnv(undefined, model, { providerId: SUBSCRIPTION_PROVIDER_ID });

  async function* promptStream() {
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content: buildUserPrompt(task) },
      parent_tool_use_id: null,
      session_id: sessionId,
    };
  }

  const q = query({
    prompt: promptStream(),
    options: {
      maxTurns: 1,
      sessionId,
      cwd,
      settingSources: ['project'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: cliPath,
      env,
      systemPrompt: SYSTEM_PROMPT,
      thinking: { type: 'disabled' },
      effort: 'low',
      includePartialMessages: false,
      persistSession: false,
      mcpServers: {},
      tools: [],
      ...(model ? { model: applyProviderContextWindowSuffix(model, SUBSCRIPTION_PROVIDER_ID) } : {}),
    },
  });

  let text = '';
  const timeout = new Promise<string>((r) => setTimeout(() => r(text), EXTRACTION_TIMEOUT_MS));
  const run = (async (): Promise<string> => {
    for await (const message of q) {
      const blocks = (message as { content?: unknown }).content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
            text += String((block as { text?: string }).text ?? '');
          }
        }
      }
    }
    return text;
  })();
  return Promise.race([run, timeout]);
}

let inFlight = false;

/** Poll once for pending relation tasks and process them (best-effort). */
async function processPendingOnce(): Promise<void> {
  if (inFlight) return;
  // Resolve a model even without a live session (global sidecar): fall back to
  // the first enabled agent's model so KB relations get typed regardless.
  const resolved = resolveRelationModel();
  if (!resolved) {
    console.log('[kb-relations] no resolvable model — skipping poll');
    return;
  }

  inFlight = true;
  try {
    // In-process TypeGraph store (lazy — the kb modules stay out of the
    // top-level import chain so cold start is unaffected).
    const { takePendingAll, saveRelations, removePending } = await import('./kb/kb-store');
    const tasks = await takePendingAll(MAX_TASKS_PER_POLL);
    if (tasks.length === 0) {
      console.debug('[kb-relations] no pending tasks');
      return;
    }
    console.log(`[kb-relations] processing ${tasks.length} pending task(s)`);

    for (const task of tasks) {
      try {
        const result = await extractKnowledge(task, resolved.model, resolved.providerEnv);
        if (result.entities.length === 0 && result.relations.length === 0) {
          // Genuine empty extraction (balanced JSON, nothing found): dequeue
          // so this chunk isn't re-LLM'd every poll forever. extractKnowledge
          // throws on no-JSON failures, so reaching here means the model DID
          // answer — there is simply nothing to save.
          await removePending(task.kbId, [task.chunkId]);
          console.log('[kb-relations] empty extraction — dequeued chunk');
          continue;
        }
        // The LLM may not return every entity it references — make sure any
        // subject/object used by a relation is present as an entity too.
        const entityIds = new Set(result.entities.map((e) => e.id));
        for (const r of result.relations) {
          if (!entityIds.has(r.subject)) {
            result.entities.push({ id: r.subject, label: r.subject });
            entityIds.add(r.subject);
          }
          if (!entityIds.has(r.object)) {
            result.entities.push({ id: r.object, label: r.object });
            entityIds.add(r.object);
          }
        }
        await saveRelations(
          task.kbId,
          result.entities.map((e) => ({
            id: e.id,
            label: e.label,
            ...(e.entityType ? { entityType: e.entityType } : {}),
            sources: [],
          })),
          result.relations.map((r) => ({
            subject: r.subject,
            object: r.object,
            relationType: r.relation_type,
            weight: r.weight,
            typed: r.typed,
          })),
        );
        // Only a SUCCESSFUL write-back leaves the queue — failed extractions
        // stay pending so they retry and the UI progress stays accurate.
        await removePending(task.kbId, [task.chunkId]);
        console.log(
          `[kb-relations] write-back ok (entities=${result.entities.length}, relations=${result.relations.length})`,
        );
      } catch (err) {
        console.warn('[kb-relations] relation extraction failed:', err);
      }
    }
  } catch (err) {
    console.warn('[kb-relations] poll failed:', err);
  } finally {
    inFlight = false;
  }
}

/**
 * Start the periodic relation-typing processor. Called once at sidecar boot
 * from index.ts. Safe to call multiple times (idempotent — clears the previous
 * interval).
 */
let timer: ReturnType<typeof setInterval> | null = null;
export function startKbRelationProcessor(): void {
  if (timer) clearInterval(timer);
  // Boot-time diagnostic: what model + provider does the poller resolve here?
  try {
    const resolved = resolveRelationModel();
    console.log(
      `[kb-relations] boot: model=${resolved?.model ?? 'NONE'} providerEnv=${resolved?.providerEnv?.baseUrl ?? 'none'} hasKey=${resolved?.providerEnv ? Boolean(resolved.providerEnv.apiKey) : false} verify=conditional (only large / ungrounded extractions get the audit LLM call)`,
    );
  } catch (err) {
    console.warn('[kb-relations] boot model resolution failed:', err instanceof Error ? err.message : err);
  }
  void processPendingOnce();
  timer = setInterval(() => {
    void processPendingOnce();
  }, POLL_INTERVAL_MS);
}

export function stopKbRelationProcessor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
