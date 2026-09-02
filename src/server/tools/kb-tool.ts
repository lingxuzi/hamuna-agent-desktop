// Knowledge base (资料库) query tool — in-process MCP server.
//
// The model queries the workspace's mounted knowledge bases via `kb_query`.
// Query execution lives in the TypeGraph store (SQLite + FTS5) in the same
// sidecar process, lazy-loaded on first call — never imported from
// agent-session.ts, which is a forbidden dependency for tools.

// SDK + zod are loaded lazily inside createKbServer() via dynamic import, per
// the builtin-MCP lazy-loading rule.

interface KbConfig {
  workspace?: string;
}

let kbConfig: KbConfig = {};

export function configureKb(_env: Record<string, string>, ctx: { sessionId: string; workspace?: string }): void {
  kbConfig = { workspace: ctx.workspace };
}

export function getKbConfig(): KbConfig {
  return kbConfig;
}

export function clearKbConfig(): void {
  kbConfig = {};
}

type CallToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/** Query the mounted knowledge bases and render a plain-text answer. */
async function kbQueryHandler(args: { query: string }): Promise<CallToolResult> {
  const query = (args.query ?? '').trim();
  if (!query) {
    return { content: [{ type: 'text', text: '查询内容不能为空。' }], isError: true };
  }

  const workspace = kbConfig.workspace;
  if (!workspace) {
    return {
      content: [{ type: 'text', text: '当前会话没有绑定工作区，无法查询知识库。' }],
      isError: true,
    };
  }

  // Resolve the mounted KB ids + query in-process (lazy store import — the kb
  // modules stay out of cold start, matching the tools lazy-loading rule).
  const { mountsForWorkspace, query: kbQuery } = await import('../kb/kb-store');
  const kbIds = await mountsForWorkspace(workspace);
  if (kbIds.length === 0) {
    return {
      content: [{ type: 'text', text: '当前工作区未挂载任何知识库。请先在设置中挂载知识库。' }],
    };
  }

  const result = await kbQuery(kbIds, query);
  return { content: [{ type: 'text', text: formatKbResult(result as unknown as Record<string, unknown>) }] };
}

function formatKbResult(result: Record<string, unknown>): string {
  const entities = Array.isArray(result.entities) ? (result.entities as Array<Record<string, unknown>>) : [];
  const relations = Array.isArray(result.relations) ? (result.relations as Array<Record<string, unknown>>) : [];
  const snippets = Array.isArray(result.snippets) ? (result.snippets as string[]) : [];

  const lines: string[] = [];
  if (entities.length > 0) {
    lines.push('相关实体：');
    for (const e of entities.slice(0, 10)) {
      lines.push(`- ${String(e.label ?? e.id)}`);
    }
  }
  if (relations.length > 0) {
    lines.push('\n相关关系：');
    for (const r of relations.slice(0, 20)) {
      // kb-store.query returns camelCase `relationType` (KbRelationView).
      const relType = String((r.relationType as string | undefined) ?? (r.relation_type as string | undefined) ?? '→');
      lines.push(`- ${String(r.subject ?? '')} ${relType} ${String(r.object ?? '')}`);
    }
  }
  if (snippets.length > 0) {
    lines.push('\n来源片段：');
    for (const s of snippets.slice(0, 5)) {
      lines.push(`- ${s}`);
    }
  }
  if (lines.length === 0) {
    return '知识库中未找到相关内容。';
  }
  return lines.join('\n');
}

export async function createKbServer() {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  const { z } = await import('zod/v4');
  return createSdkMcpServer({
    name: 'kb',
    version: '1.0.0',
    tools: [
      tool(
        'kb_query',
        `Query the knowledge bases (资料库) mounted to the current workspace.

Use this tool when the user asks about information that may live in their
knowledge bases — reference material, past notes, saved documents, URLs they
added — rather than in the conversation or the workspace files.

The knowledge base is a graph (entities + typed relations) built from uploaded
text; this returns relevant entities, relations, and source snippets. Cite the
source snippet when you use a returned fact. If the workspace has no mounted
knowledge base, this returns a message saying so — do not retry.`,
        {
          query: z.string().describe('The question or search terms to query against the mounted knowledge bases.'),
        },
        kbQueryHandler
      ),
    ],
  });
}
