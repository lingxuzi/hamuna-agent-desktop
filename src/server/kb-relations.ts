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
}

interface ExtractedEntity {
  id: string;
  label: string;
  entityType?: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: TypedRelation[];
}

const SYSTEM_PROMPT = `You extract a COMPLETE knowledge graph from a text chunk: every real named entity (companies, people, products, places, dates, codes, documents, concepts) with its TYPE, and every confident TYPED relation between them.

Output: a single JSON object (NO markdown fences, NO prose):
{"entities":[{"id":"<canonical name>","label":"<canonical name>","type":"<ORG|PERSON|PLACE|PRODUCT|DATE|CODE|DOCUMENT|CONCEPT|..."}],"relations":[{"subject":"<entity id>","object":"<entity id>","relation_type":"<snake_case verb phrase>","weight":<0..1 confidence>}]}

Rules:
- Entities: EXHAUSTIVE — extract ALL proper nouns and key concepts in the chunk, no matter how many. The "id" MUST be the full canonical name itself (e.g. "江苏索普化工股份有限公司", "600746", "任正非"), never "e1" or an index. "label" equals "id". "type" is the entity kind (ORG/PERSON/PLACE/PRODUCT/DATE/CODE/DOCUMENT/CONCEPT).
- Relations: extract EVERY confident relation between entities (e.g. "founded_by", "listed_as", "part_of", "located_in", "acquired_by", "produces", "publishes", "employs", "succeeded_by"). subject and object MUST be entity ids from your entities list.
- Granularity: be fine-grained — capture the full knowledge structure. Do NOT cap counts; extract everything meaningful in the chunk.
- Output nothing but the JSON object.`;

function buildUserPrompt(task: PendingRelationTask): string {
  // task.text is already a bounded, meaning-preserving chunk from the Rust
  // side (NO truncation of the original file — every character is in some
  // chunk). Send it in full.
  return `Text chunk:\n"""\n${task.text}\n"""\n\nExtract the complete knowledge graph from this text.`;
}

/** Parse the LLM's JSON object {entities, relations}. */
function parseExtraction(text: string): ExtractionResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { entities: [], relations: [] };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const entities: ExtractedEntity[] = Array.isArray(parsed.entities)
      ? parsed.entities
          .filter((e: unknown) => e && typeof (e as { id?: unknown }).id === 'string')
          .map((e: { id?: string; label?: unknown; name?: unknown; type?: unknown; entity_type?: unknown }) => {
            // Prefer the canonical name field; fall back to id when the model
            // emitted a bare index like "e1".
            const raw = (typeof e.label === 'string' && e.label.trim()) || (typeof e.name === 'string' && e.name.trim()) || String(e.id ?? '');
            const id = raw.trim();
            const t = typeof e.type === 'string' && e.type.trim() ? String(e.type).trim() : typeof e.entity_type === 'string' && e.entity_type.trim() ? String(e.entity_type).trim() : undefined;
            return { id, label: id, ...(t ? { entityType: t } : {}) };
          })
          .filter((e: { id: string }) => e.id.length > 0)
      : [];
    const relations: TypedRelation[] = Array.isArray(parsed.relations)
      ? parsed.relations
          .filter(
            (r: unknown) =>
              r && typeof (r as { subject?: unknown }).subject === 'string' && typeof (r as { object?: unknown }).object === 'string',
          )
          .map((r: { subject: string; object: string; relation_type?: unknown; weight?: unknown }) => ({
            subject: String(r.subject).trim(),
            object: String(r.object).trim(),
            relation_type:
              typeof r.relation_type === 'string' && r.relation_type.trim() ? String(r.relation_type).trim() : 'related_to',
            weight: typeof r.weight === 'number' ? r.weight : 1,
            typed: true,
          }))
          .filter((r: { subject: string; object: string }) => r.subject.length > 0 && r.object.length > 0 && r.subject !== r.object)
      : [];
    return { entities, relations };
  } catch {
    return { entities: [], relations: [] };
  }
}

/**
 * Call the provider's Anthropic-format /v1/messages API directly and return
 * the assistant text. Providers like DeepSeek stream SSE and reply with
 * `thinking` blocks first; we collect `text_delta` events only. This works
 * where the SDK wrapper surfaces an empty assistant message.
 */
async function providerMessagesText(
  providerEnv: ProviderEnv,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const baseUrl = (providerEnv.baseUrl ?? '').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/messages`;
  const resp = await cancellableFetch(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': providerEnv.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        ...(providerEnv.apiKey ? { Authorization: `Bearer ${providerEnv.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // DeepSeek-style providers burn the whole token budget on `thinking`
        // blocks and hit `stop_reason: max_tokens` before emitting the JSON
        // answer. Disable extended thinking so the model answers directly.
        thinking: { type: 'disabled' },
        system,
        messages: [{ role: 'user', content: user }],
      }),
    },
    { timeoutMs: EXTRACTION_TIMEOUT_MS },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`provider ${resp.status}: ${body.slice(0, 200)}`);
  }
  const raw = await resp.text();
  // SSE stream: collect text_delta payloads from `data:` lines. Also handles
  // non-streaming JSON responses (plain {"content":[...]}) as a fallback.
  if (raw.trimStart().startsWith('{')) {
    const data = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
    return (data.content ?? [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n');
  }
  let text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } };
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        text += evt.delta.text ?? '';
      }
    } catch {
      /* partial SSE frame — ignore */
    }
  }
  return text;
}

/** SDK fallback for the subscription path (no providerEnv). */
async function sdkExtract(task: PendingRelationTask, model: string): Promise<ExtractionResult> {
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

  const relationQuery = query({
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

  const timeout = new Promise<ExtractionResult>((resolve) => {
    setTimeout(() => resolve({ entities: [], relations: [] }), EXTRACTION_TIMEOUT_MS);
  });

  const run = (async (): Promise<ExtractionResult> => {
    let text = '';
    for await (const message of relationQuery) {
      const blocks = (message as { content?: unknown }).content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
            text += String((block as { text?: string }).text ?? '');
          }
        }
      }
    }
    return parseExtraction(text);
  })();

  return Promise.race([run, timeout]);
}

async function extractKnowledge(
  task: PendingRelationTask,
  model: string,
  providerEnv?: ProviderEnv,
): Promise<ExtractionResult> {
  const useDirect = Boolean(providerEnv?.baseUrl && providerEnv.apiKey);
  console.warn(
    `[kb-relations] extractKnowledge model=${model} path=${useDirect ? 'direct-http' : 'sdk-fallback'} baseUrl=${providerEnv?.baseUrl ?? 'none'}`,
  );
  try {
    if (useDirect) {
      const text = await providerMessagesText(providerEnv as ProviderEnv, model, SYSTEM_PROMPT, buildUserPrompt(task));
      console.warn(`[kb-relations] direct-http returned ${text.length} chars: ${text.slice(0, 150)}`);
      const result = parseExtraction(text);
      console.warn(`[kb-relations] parsed ${result.entities.length} entities, ${result.relations.length} relations`);
      return result;
    }
    const result = await sdkExtract(task, model);
    console.warn(`[kb-relations] sdk-fallback parsed ${result.entities.length} entities, ${result.relations.length} relations`);
    return result;
  } catch (err) {
    console.warn('[kb-relations] extraction failed, retrying with SDK:', err instanceof Error ? err.message : err);
    // Fall back to the SDK path on any provider-API error.
    try {
      return await sdkExtract(task, model);
    } catch {
      return { entities: [], relations: [] };
    }
  }
}

let inFlight = false;

/** Poll once for pending relation tasks and process them (best-effort). */
async function processPendingOnce(): Promise<void> {
  if (inFlight) return;
  // Resolve a model even without a live session (global sidecar): fall back to
  // the first enabled agent's model so KB relations get typed regardless.
  const resolved = resolveRelationModel();
  if (!resolved) {
    console.warn('[kb-relations] no resolvable model — skipping poll');
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
    console.warn(`[kb-relations] processing ${tasks.length} pending task(s)`);

    for (const task of tasks) {
      try {
        const result = await extractKnowledge(task, resolved.model, resolved.providerEnv);
        if (result.entities.length === 0 && result.relations.length === 0) continue;
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
        console.warn(
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
    console.warn(
      `[kb-relations] boot: model=${resolved?.model ?? 'NONE'} providerEnv=${resolved?.providerEnv?.baseUrl ?? 'none'} hasKey=${resolved?.providerEnv ? Boolean(resolved.providerEnv.apiKey) : false}`,
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
