import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCodexFileChangeResultContent,
  buildCodexCompletedFileChangeInput,
  buildCodexAppServerArgs,
  buildCodexAppServerLaunchConfig,
  buildCodexInitializeParams,
  buildCodexSandboxPolicy,
  buildCodexTurnStartParams,
  buildCodexStartedFileChangeInput,
  CodexRuntime,
  codexModelCacheKey,
  configureCodexSkillExtraRoots,
  createCodexMcpStartupBarrier,
  initializeCodexRpc,
  isCodexNoActiveTurnSteerRejection,
  JsonRpcClient,
  KNOWN_CODEX_SERVER_REQUEST_METHODS,
  mapCodexTurnCompletedNotification,
  mapCodexTurnPlanUpdatedNotification,
  resolveCodexSkillExtraRoots,
  serializeCodexPermissionResponse,
  type PendingCodexRequest,
} from '../runtimes/codex';
import { RuntimeSteerUnavailableError } from '../runtimes/types';

describe('Codex app-server protocol helpers', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempWorkspace(): string {
    const dir = join(tmpdir(), `hamuna-codex-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    tempRoots.push(dir);
    return dir;
  }

  it('uses v2 initialize capabilities and sends initialized notification', async () => {
    const rpc = {
      call: vi.fn().mockResolvedValue({}),
      notify: vi.fn(),
    };

    await initializeCodexRpc(rpc, 1234);

    expect(rpc.call).toHaveBeenCalledWith('initialize', buildCodexInitializeParams(), 1234);
    expect(rpc.notify).toHaveBeenCalledWith('initialized');
    expect(buildCodexInitializeParams()).toMatchObject({
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    });
  });

  it('keeps the known Codex server request allowlist in sync with app-server schema', () => {
    expect(KNOWN_CODEX_SERVER_REQUEST_METHODS).toEqual([
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/tool/requestUserInput',
      'mcpServer/elicitation/request',
      'item/permissions/requestApproval',
      'item/tool/call',
      'account/chatgptAuthTokens/refresh',
      'attestation/generate',
      'currentTime/read',
      'applyPatchApproval',
      'execCommandApproval',
    ]);
  });

  it('invalidates managed model discovery when the installed runtime pointer changes', () => {
    const oldKey = codexModelCacheKey('managed-provider', {
      source: 'managed-provider',
      commandPath: '/runtime/0.142.2/codex',
      env: {},
      version: '0.142.2',
    });
    const newKey = codexModelCacheKey('managed-provider', {
      source: 'managed-provider',
      commandPath: '/runtime/0.144.1/codex',
      env: {},
      version: '0.144.1',
    });

    expect(newKey).not.toBe(oldKey);
  });

  it('keeps system-cli Codex app-server startup free of managed provider MCP config', () => {
    const env: Record<string, string | undefined> = {};
    expect(buildCodexAppServerArgs({
      commandPath: '/usr/local/bin/codex',
      runtimeSource: 'system-cli',
      codexEnv: env,
      mcpServers: [{
        id: 'fs',
        name: 'Filesystem',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { FS_TOKEN: 'secret-token' },
        isBuiltin: false,
      }],
    })).toEqual([
      '/usr/local/bin/codex',
      '-c',
      'project_doc_fallback_filenames=["CLAUDE.md"]',
      'app-server',
    ]);
    expect(env.FS_TOKEN).toBeUndefined();
  });

  it('does not enable Codex default-mode request_user_input at app-server startup', () => {
    const env: Record<string, string | undefined> = {};
    expect(buildCodexAppServerArgs({
      commandPath: '/usr/local/bin/codex',
      runtimeSource: 'managed-provider',
      codexEnv: env,
    })).toEqual([
      '/usr/local/bin/codex',
      '-c',
      'project_doc_fallback_filenames=["CLAUDE.md"]',
      '-c',
      'cli_auth_credentials_store="file"',
      'app-server',
    ]);

    expect(buildCodexAppServerArgs({
      commandPath: '/usr/local/bin/codex',
      runtimeSource: 'system-cli',
      codexEnv: env,
    })).toEqual([
      '/usr/local/bin/codex',
      '-c',
      'project_doc_fallback_filenames=["CLAUDE.md"]',
      'app-server',
    ]);
  });

  it('injects managed Codex MCP servers through app-server config args without argv secrets', () => {
    const env: Record<string, string | undefined> = { HTTPS_PROXY: 'http://127.0.0.1:7890' };
    const args = buildCodexAppServerArgs({
      commandPath: '/managed/codex',
      runtimeSource: 'managed-provider',
      codexEnv: env,
      mcpServers: [
        {
          id: 'fs.tool',
          name: 'Filesystem',
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { FS_TOKEN: 'secret-token' },
          isBuiltin: false,
        },
        {
          id: 'remote-http',
          name: 'Remote',
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer {{REMOTE_TOKEN}}' },
          env: { REMOTE_TOKEN: 'remote-secret' },
          isBuiltin: false,
        },
      ],
    });

    expect(args).toContain('cli_auth_credentials_store="file"');
    expect(args).toContain('mcp_servers.fs_tool.command="node"');
    expect(args).toContain('mcp_servers.fs_tool.args=["server.js"]');
    expect(args).toContain('mcp_servers.fs_tool.env_vars=["FS_TOKEN","HTTPS_PROXY","NO_PROXY","no_proxy"]');
    // Generous per-server connect budget, deliberately NOT the 10s prewarm
    // grace: a stdio server that installs itself on first spawn (uvx / uv
    // tool run) needs far longer than 10s to finish and connect.
    expect(args).toContain('mcp_servers.fs_tool.startup_timeout_sec=60');
    expect(args).toContain('mcp_servers.remote-http.url="https://example.com/mcp"');
    expect(args).toContain('mcp_servers.remote-http.env_http_headers={Authorization="HAMUNA_MCP_REMOTE_HTTP_AUTHORIZATION"}');
    expect(args).toContain('mcp_servers.remote-http.startup_timeout_sec=60');
    expect(args.join('\n')).not.toContain('secret-token');
    expect(args.join('\n')).not.toContain('remote-secret');
    expect(env.FS_TOKEN).toBe('secret-token');
    expect(env.HAMUNA_MCP_REMOTE_HTTP_AUTHORIZATION).toBe('Bearer remote-secret');
    expect(env.REMOTE_TOKEN).toBeUndefined();
    expect(env.NO_PROXY).toContain('127.0.0.1');
  });

  it('normalizes legacy preset npx MCP commands before managed Codex startup', () => {
    const env: Record<string, string | undefined> = {};
    const launch = buildCodexAppServerLaunchConfig({
      commandPath: '/managed/codex',
      runtimeSource: 'managed-provider',
      codexEnv: env,
      mcpServers: [{
        id: 'playwright',
        name: 'Playwright',
        type: 'stdio',
        command: 'npx',
        args: ['@playwright/mcp@latest', '--isolated'],
        isBuiltin: true,
      }],
    });

    const commandArg = launch.args.find((arg) => arg.startsWith('mcp_servers.playwright.command='));
    const mcpArgs = launch.args.find((arg) => arg.startsWith('mcp_servers.playwright.args='));
    expect(commandArg).toBeDefined();
    expect(commandArg).not.toBe('mcp_servers.playwright.command="npx"');
    expect(mcpArgs).toContain('@playwright/mcp@0.0.68');
    expect(mcpArgs).not.toContain('@latest');
    expect(mcpArgs).toContain('"-y"');
    expect(launch.mcpServerNames).toEqual(['playwright']);
  });

  it('settles managed Codex MCP readiness only after every injected server is terminal', async () => {
    const barrier = createCodexMcpStartupBarrier(['playwright', 'remote-http']);
    barrier.arm();
    let settled = false;
    const ready = barrier.wait().then((result) => {
      settled = true;
      return result;
    });

    barrier.observe({
      threadId: null,
      name: 'playwright',
      status: 'starting',
      error: null,
      failureReason: null,
    });
    barrier.observe({
      threadId: null,
      name: 'unrelated-user-config',
      status: 'ready',
      error: null,
      failureReason: null,
    });
    barrier.observe({
      threadId: null,
      name: 'playwright',
      status: 'ready',
      error: null,
      failureReason: null,
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    barrier.observe({
      threadId: null,
      name: 'remote-http',
      status: 'failed',
      error: 'connection refused',
      failureReason: null,
    });

    await expect(ready).resolves.toEqual({
      outcome: 'degraded',
      reason: 'terminal_status',
      states: {
        playwright: 'ready',
        'remote-http': 'failed',
      },
      pendingNames: [],
      elapsedMs: expect.any(Number),
    });
  });

  it('soft-degrades when injected MCP startup never reaches a terminal state', async () => {
    vi.useFakeTimers();
    const barrier = createCodexMcpStartupBarrier(['playwright']);
    barrier.arm();
    barrier.observe({
      threadId: null,
      name: 'playwright',
      status: 'starting',
      error: null,
      failureReason: null,
    });

    const startup = barrier.wait();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(startup).resolves.toEqual({
      outcome: 'degraded',
      reason: 'timeout',
      states: { playwright: 'starting' },
      pendingNames: ['playwright'],
      elapsedMs: 10_000,
    });
  });

  it('releases the startup wait as a failure when the Codex process exits', async () => {
    const barrier = createCodexMcpStartupBarrier(['playwright']);
    barrier.arm();
    const startup = barrier.wait();

    barrier.fail(new Error('Codex process exited during MCP startup with code 1'));

    await expect(startup).rejects.toThrow('Codex process exited during MCP startup with code 1');
  });

  it('does not charge process initialization time to the native MCP startup window', async () => {
    vi.useFakeTimers();
    const barrier = createCodexMcpStartupBarrier(['playwright']);

    await vi.advanceTimersByTimeAsync(8_000);
    barrier.arm();
    const startup = barrier.wait();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(startup).resolves.toMatchObject({
      outcome: 'degraded',
      reason: 'timeout',
      elapsedMs: 10_000,
    });
  });

  it('returns ready when every injected MCP reaches ready inside the armed window', async () => {
    const barrier = createCodexMcpStartupBarrier(['playwright']);
    barrier.arm();
    barrier.observe({
      threadId: null,
      name: 'playwright',
      status: 'ready',
      error: null,
      failureReason: null,
    });

    await expect(barrier.wait()).resolves.toMatchObject({
      outcome: 'ready',
      pendingNames: [],
      states: { playwright: 'ready' },
    });
  });

  it('skips managed Codex MCP entries that cannot be represented safely', () => {
    const env: Record<string, string | undefined> = {};
    const args = buildCodexAppServerArgs({
      commandPath: '/managed/codex',
      runtimeSource: 'managed-provider',
      codexEnv: env,
      mcpServers: [
        {
          id: 'builtin-image',
          name: 'Builtin image',
          type: 'stdio',
          command: '__builtin__',
          args: [],
          isBuiltin: true,
        },
        {
          id: 'arg-secret',
          name: 'Arg Secret',
          type: 'stdio',
          command: 'node',
          args: ['server.js', '--api-key', 'sk-test-secret-value'],
          isBuiltin: false,
        },
        {
          id: 'env-openai',
          name: 'OpenAI env',
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { OPENAI_API_KEY: 'must-not-leak' },
          isBuiltin: false,
        },
        {
          id: 'url-secret',
          name: 'URL Secret',
          type: 'http',
          url: 'https://example.com/mcp?key={{TOKEN}}',
          env: { TOKEN: 'secret-token' },
          isBuiltin: false,
        },
        {
          id: 'legacy-sse',
          name: 'Legacy SSE',
          type: 'sse',
          url: 'https://example.com/sse',
          isBuiltin: false,
        },
        {
          id: 'url-query',
          name: 'URL Query',
          type: 'http',
          url: 'https://example.com/mcp?transport=streamable',
          isBuiltin: false,
        },
      ],
    });

    expect(args).toEqual([
      '/managed/codex',
      '-c',
      'project_doc_fallback_filenames=["CLAUDE.md"]',
      '-c',
      'cli_auth_credentials_store="file"',
      'app-server',
    ]);
    expect(env.TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(args.join('\n')).not.toContain('sk-test-secret-value');
    expect(args.join('\n')).not.toContain('must-not-leak');
  });

  it('injects project .claude/skills as Codex app-server extra skill roots', async () => {
    const workspace = tempWorkspace();
    const projectSkillsDir = join(workspace, '.claude', 'skills');
    mkdirSync(projectSkillsDir, { recursive: true });
    const rpc = { call: vi.fn().mockResolvedValue({}) };

    await expect(configureCodexSkillExtraRoots(rpc, workspace, 1234)).resolves.toEqual([projectSkillsDir]);

    expect(resolveCodexSkillExtraRoots(workspace)).toEqual([projectSkillsDir]);
    expect(rpc.call).toHaveBeenCalledWith(
      'skills/extraRoots/set',
      { extraRoots: [projectSkillsDir] },
      1234,
    );
  });

  it('skips Codex skill extra roots when project .claude/skills is absent', async () => {
    const workspace = tempWorkspace();
    const rpc = { call: vi.fn().mockResolvedValue({}) };

    await expect(configureCodexSkillExtraRoots(rpc, workspace)).resolves.toEqual([]);

    expect(existsSync(join(workspace, '.claude', 'skills'))).toBe(false);
    expect(resolveCodexSkillExtraRoots(workspace)).toEqual([]);
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('does not fail Codex startup when extraRoots RPC is unavailable', async () => {
    const workspace = tempWorkspace();
    const projectSkillsDir = join(workspace, '.claude', 'skills');
    mkdirSync(projectSkillsDir, { recursive: true });
    const rpc = {
      call: vi.fn().mockRejectedValue(new Error('Method not found: skills/extraRoots/set')),
    };

    await expect(configureCodexSkillExtraRoots(rpc, workspace)).resolves.toEqual([]);

    expect(rpc.call).toHaveBeenCalledWith(
      'skills/extraRoots/set',
      { extraRoots: [projectSkillsDir] },
      5000,
    );
  });

  it('passes cwd, approvalPolicy, sandboxPolicy, model, and summary to turn/start', () => {
    expect(buildCodexSandboxPolicy('danger-full-access', '/tmp/ws')).toEqual({ type: 'dangerFullAccess' });
    expect(buildCodexTurnStartParams({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'hi' }],
      cwd: '/tmp/ws',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      model: 'gpt-5.2-codex',
    })).toEqual({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'hi' }],
      cwd: '/tmp/ws',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: 'gpt-5.2-codex',
      summary: 'concise',
    });
  });

  // #324 — turn/start.effort: included only when the user picked a non-default
  // level; default/null OMITS the key (conservative shape older codex builds
  // also accept — an explicit null is "no override" per schema but adds noise).
  it('includes effort in turn/start only when set', () => {
    const base = {
      threadId: 'thread-1',
      input: [],
      cwd: '/tmp/ws',
      approvalPolicy: 'never' as const,
      sandbox: 'danger-full-access' as const,
      model: null,
    };
    expect(buildCodexTurnStartParams({ ...base, reasoningEffort: 'xhigh' }).effort).toBe('xhigh');
    expect('effort' in buildCodexTurnStartParams({ ...base, reasoningEffort: null })).toBe(false);
    expect('effort' in buildCodexTurnStartParams(base)).toBe(false);
  });

  it('records Codex config changes as next-turn process state', async () => {
    const runtime = new CodexRuntime();
    const proc = {
      exited: false,
      model: 'gpt-5.1-codex',
      permissionMode: 'full-auto',
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      reasoningEffort: '',
      defaultPermissionMode: 'full-auto',
    } as unknown as import('../runtimes/types').RuntimeProcess;

    await runtime.setModel(proc, 'gpt-5.2-codex');
    await runtime.setPermissionMode(proc, 'no-restrictions');
    await runtime.setReasoningEffort(proc, 'xhigh');

    const state = proc as unknown as {
      model: string;
      permissionMode: string;
      approvalPolicy: 'never';
      sandbox: 'danger-full-access';
      reasoningEffort: string;
    };
    expect(state.model).toBe('gpt-5.2-codex');
    expect(state.permissionMode).toBe('no-restrictions');
    expect(state.approvalPolicy).toBe('never');
    expect(state.sandbox).toBe('danger-full-access');
    expect(buildCodexTurnStartParams({
      threadId: 'thread-1',
      input: [],
      cwd: '/tmp/ws',
      approvalPolicy: state.approvalPolicy,
      sandbox: state.sandbox,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
    })).toMatchObject({
      model: 'gpt-5.2-codex',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
      effort: 'xhigh',
    });
  });

  it('preserves Codex turn/completed status instead of treating interrupts as success', () => {
    expect(mapCodexTurnCompletedNotification({ status: 'completed' })).toEqual({
      kind: 'turn_complete',
      status: 'completed',
    });

    expect(mapCodexTurnCompletedNotification({ status: 'interrupted' })).toEqual({
      kind: 'turn_complete',
      status: 'interrupted',
      result: 'Turn ended with status interrupted',
    });

    expect(mapCodexTurnCompletedNotification({
      status: 'failed',
      error: { message: 'websocket failed' },
    })).toEqual({
      kind: 'turn_complete',
      status: 'failed',
      error: 'websocket failed',
      result: 'websocket failed',
    });
  });

  it('maps Codex turn/plan/updated into an AgentStatusPanel todo snapshot', () => {
    expect(mapCodexTurnPlanUpdatedNotification({
      plan: [
        { step: 'Inspect status flow', status: 'completed' },
        { step: 'Wire plan updates', status: 'inProgress' },
        { step: 'Run tests', status: 'pending' },
        { step: '   ', status: 'pending' },
      ],
    })).toEqual({
      kind: 'agent_plan_update',
      todos: [
        {
          key: 'codex-plan-0',
          content: 'Inspect status flow',
          activeForm: 'Inspect status flow',
          status: 'completed',
        },
        {
          key: 'codex-plan-1',
          content: 'Wire plan updates',
          activeForm: 'Wire plan updates',
          status: 'in_progress',
        },
        {
          key: 'codex-plan-2',
          content: 'Run tests',
          activeForm: 'Run tests',
          status: 'pending',
        },
      ],
    });
  });

  it('formats fileChange object kinds without leaking [object Object]', () => {
    expect(buildCodexFileChangeResultContent([
      {
        path: '/tmp/a.md',
        kind: { type: 'update', move_path: null },
        diff: '@@ -1 +1 @@\n-old\n+new',
      },
      {
        path: '/tmp/new.md',
        kind: { type: 'add' },
        diff: 'hello',
      },
    ])).toBe('update: /tmp/a.md\n@@ -1 +1 @@\n-old\n+new\n\nadd: /tmp/new.md\nhello');
    expect(buildCodexFileChangeResultContent([
      {
        path: '/tmp/old.md',
        kind: { type: 'move', move_path: '/tmp/new.md' },
      },
    ])).toBe('move: /tmp/old.md -> /tmp/new.md');
    expect(buildCodexFileChangeResultContent([])).toBe('File changed');
  });

  it('keeps started fileChange lightweight and promotes the completed patch as final input', () => {
    const startedChanges = [{
      path: '/workspace/a.ts',
      kind: { type: 'update', move_path: null },
      diff: '@@ -1 +1 @@\n-old started\n+new started',
    }];
    const completedChanges = [{
      path: '/workspace/a.ts',
      kind: { type: 'update', move_path: null },
      diff: '@@ -1 +1 @@\n-old applied\n+new applied',
    }];

    expect(buildCodexStartedFileChangeInput(startedChanges, '/workspace')).toEqual({
      file_path: '/workspace/a.ts',
      cwd: '/workspace',
    });
    expect(buildCodexCompletedFileChangeInput(completedChanges, '/workspace')).toEqual({
      file_path: '/workspace/a.ts',
      cwd: '/workspace',
      changes: completedChanges,
    });
  });

  it('ignores malformed fileChange entries before formatting result text', () => {
    expect(buildCodexFileChangeResultContent([
      null,
      'not-a-change',
      {
        path: '/tmp/old.md',
        kind: { type: 'move', move_path: '/tmp/new.md' },
      },
    ])).toBe('move: /tmp/old.md -> /tmp/new.md');

    expect(buildCodexFileChangeResultContent([null, 'not-a-change'])).toBe('File changed');
  });

  it('serializes command/file approvals with session scope when always allowed', () => {
    const pending: PendingCodexRequest = {
      kind: 'command_approval',
      rpcId: 7,
      method: 'item/commandExecution/requestApproval',
      params: { itemId: 'item-1' },
    };
    expect(serializeCodexPermissionResponse(pending, 'always_allow')).toEqual({
      type: 'result',
      result: { decision: 'acceptForSession' },
    });
    expect(serializeCodexPermissionResponse(pending, 'deny', undefined, true)).toEqual({
      type: 'result',
      result: { decision: 'cancel' },
    });
  });

  it('serializes Codex tool user input answers by native question id without comma-splitting free text', () => {
    const pending: PendingCodexRequest = {
      kind: 'tool_user_input',
      rpcId: 8,
      method: 'item/tool/requestUserInput',
      params: {
        questions: [
          { id: 'choice', question: 'Pick', options: [] },
          { id: 'notes', question: 'Notes', options: [] },
        ],
      },
    };

    expect(serializeCodexPermissionResponse(pending, 'allow_once', {
      answers: { choice: 'A,B', notes: 'custom text, with comma' },
    })).toEqual({
      type: 'result',
      result: {
        answers: {
          choice: { answers: ['A,B'] },
          notes: { answers: ['custom text, with comma'] },
        },
      },
    });
  });

  it('serializes unsupported Codex structured input as non-pending denial results', () => {
    const toolInput: PendingCodexRequest = {
      kind: 'tool_user_input',
      rpcId: 8,
      method: 'item/tool/requestUserInput',
      params: { questions: [{ id: 'choice', question: 'Pick', options: ['A', 'B'] }] },
    };
    expect(serializeCodexPermissionResponse(toolInput, 'deny', undefined, true)).toEqual({
      type: 'result',
      result: { answers: {} },
    });

    const form: PendingCodexRequest = {
      kind: 'mcp_elicitation',
      rpcId: 9,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'form',
        requestedSchema: {
          properties: { token: { type: 'string', format: 'password' } },
          required: ['token'],
        },
      },
    };
    expect(serializeCodexPermissionResponse(form, 'deny', undefined, true)).toEqual({
      type: 'result',
      result: { action: 'cancel', content: null, _meta: null },
    });
  });

  it('does not track managed Codex request_user_input as pending even on native-card channels', () => {
    const runtime = new CodexRuntime();
    const pendingRequests = new Map<string, PendingCodexRequest>();
    const respond = vi.fn();
    const respondError = vi.fn();
    const codexProc = {
      pendingRequests,
      scenario: {
        type: 'agent-channel',
        platform: 'feishu',
        sourceType: 'private',
        hostInteraction: { askUserQuestion: 'native-card' },
      },
      runtimeSource: 'managed-provider',
      rpc: { respond, respondError },
    };
    const onEvent = vi.fn();

    (runtime as unknown as {
      handleServerRequest(
        proc: typeof codexProc,
        rpcId: number,
        method: string,
        params: unknown,
        onEvent: (event: unknown) => void,
      ): void;
    }).handleServerRequest(
      codexProc,
      24,
      'item/tool/requestUserInput',
      { questions: [{ id: 'choice', question: 'Pick', options: ['A', 'B'] }] },
      onEvent,
    );

    expect(pendingRequests.size).toBe(0);
    expect(onEvent).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(24, { answers: {} });
    expect(respondError).not.toHaveBeenCalled();
  });

  it('does not track unsupported channel MCP form elicitation as pending', () => {
    const runtime = new CodexRuntime();
    const pendingRequests = new Map<string, PendingCodexRequest>();
    const respond = vi.fn();
    const respondError = vi.fn();
    const codexProc = {
      pendingRequests,
      scenario: { type: 'im', hostInteraction: { askUserQuestion: 'none' } },
      rpc: { respond, respondError },
    };
    const onEvent = vi.fn();

    (runtime as unknown as {
      handleServerRequest(
        proc: typeof codexProc,
        rpcId: number,
        method: string,
        params: unknown,
        onEvent: (event: unknown) => void,
      ): void;
    }).handleServerRequest(
      codexProc,
      42,
      'mcpServer/elicitation/request',
      {
        mode: 'form',
        requestedSchema: {
          properties: { token: { type: 'string', format: 'password' } },
          required: ['token'],
        },
      },
      onEvent,
    );

    expect(pendingRequests.size).toBe(0);
    expect(onEvent).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(42, { action: 'cancel', content: null, _meta: null });
    expect(respondError).not.toHaveBeenCalled();
  });

  it('serializes MCP elicitations and permission profile requests', () => {
    const elicitation: PendingCodexRequest = {
      kind: 'mcp_elicitation',
      rpcId: 9,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'form',
        requestedSchema: {
          properties: {
            branch: { type: 'string' },
            publish: { type: 'boolean', default: false },
            optionalNote: { type: 'string' },
          },
          required: ['branch'],
        },
      },
    };
    expect(serializeCodexPermissionResponse(elicitation, 'allow_once', {
      answers: { branch: 'main', publish: 'true' },
    })).toEqual({
      type: 'result',
      result: {
        action: 'accept',
        content: { branch: 'main', publish: true },
        _meta: null,
      },
    });
    expect(serializeCodexPermissionResponse(elicitation, 'allow_once', {
      answers: { publish: 'true' },
    })).toEqual({
      type: 'error',
      code: -32000,
      message: 'Missing required MCP elicitation answers',
    });

    expect(serializeCodexPermissionResponse({
      ...elicitation,
      params: {
        ...elicitation.params,
        mode: 'openai/form',
      },
    }, 'allow_once', {
      answers: { branch: 'dev/0.2.44' },
    })).toEqual({
      type: 'result',
      result: {
        action: 'accept',
        content: { branch: 'dev/0.2.44', publish: false },
        _meta: null,
      },
    });

    const permissions: PendingCodexRequest = {
      kind: 'permissions_approval',
      rpcId: 10,
      method: 'item/permissions/requestApproval',
      params: {
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
    };
    expect(serializeCodexPermissionResponse(permissions, 'always_allow')).toEqual({
      type: 'result',
      result: {
        permissions: { network: { enabled: true } },
        scope: 'session',
      },
    });
    expect(serializeCodexPermissionResponse(permissions, 'deny')).toMatchObject({
      type: 'error',
      code: -32000,
    });
  });
});

/**
 * Regression for the stale-steer race: a send that landed just after the
 * runtime retired the turn used to be offered to a dead turn, come back as a
 * generic RPC error, and get retracted — the user's message silently vanished.
 * The session layer demotes to the turn queue only when the runtime reports a
 * *definitive* refusal, so that discrimination is what this pins.
 */
describe('Codex realtime steer eligibility', () => {
  type FakeProc = {
    exited: boolean;
    threadId: string;
    currentTurnId: string;
    activeSteerTurnId: string;
    rpc: { call: ReturnType<typeof vi.fn> };
  };

  function fakeProc(call: ReturnType<typeof vi.fn>): FakeProc {
    return {
      exited: false,
      threadId: 'thread-1',
      currentTurnId: '',
      activeSteerTurnId: '',
      rpc: { call },
    };
  }

  function asProcess(proc: FakeProc): import('../runtimes/types').RuntimeProcess {
    return proc as unknown as import('../runtimes/types').RuntimeProcess;
  }

  it('does not offer a turn that only survives as a correlation id', async () => {
    const runtime = new CodexRuntime();
    const call = vi.fn();
    // Exactly the post-turn/completed shape: currentTurnId is retained for
    // correlation, the steer target is gone.
    const proc = fakeProc(call);
    proc.currentTurnId = 'turn-1';
    proc.activeSteerTurnId = '';

    expect(runtime.canSteerMessage(asProcess(proc))).toBe(false);
    await expect(runtime.steerMessage(asProcess(proc), 'hi')).rejects.toBeInstanceOf(
      RuntimeSteerUnavailableError,
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('reports a no-active-turn refusal as steer-unavailable and retires the target', async () => {
    const runtime = new CodexRuntime();
    const call = vi.fn().mockRejectedValue(
      Object.assign(new Error('RPC error -32600: no active turn to steer'), { code: -32600 }),
    );
    const proc = fakeProc(call);
    proc.currentTurnId = 'turn-1';
    proc.activeSteerTurnId = 'turn-1';

    expect(runtime.canSteerMessage(asProcess(proc))).toBe(true);
    await expect(runtime.steerMessage(asProcess(proc), 'hi')).rejects.toBeInstanceOf(
      RuntimeSteerUnavailableError,
    );
    // Retiring the target keeps the *next* send local instead of repeating the
    // same doomed round-trip.
    expect(runtime.canSteerMessage(asProcess(proc))).toBe(false);
  });

  it('leaves an unknown RPC failure alone so it is never silently replayed', async () => {
    const runtime = new CodexRuntime();
    const failure = Object.assign(new Error('RPC error -32603: Internal error'), { code: -32603 });
    const proc = fakeProc(vi.fn().mockRejectedValue(failure));
    proc.currentTurnId = 'turn-1';
    proc.activeSteerTurnId = 'turn-1';

    await expect(runtime.steerMessage(asProcess(proc), 'hi')).rejects.toBe(failure);
    expect(runtime.canSteerMessage(asProcess(proc))).toBe(true);
  });

  it('only reads the refusal off the RPC code, not any error mentioning a turn', () => {
    expect(isCodexNoActiveTurnSteerRejection(
      Object.assign(new Error('no active turn to steer'), { code: -32600 }),
    )).toBe(true);
    expect(isCodexNoActiveTurnSteerRejection(
      Object.assign(new Error('no active turn to steer'), { code: -32603 }),
    )).toBe(false);
    expect(isCodexNoActiveTurnSteerRejection(new Error('connection reset'))).toBe(false);
  });

  it('keeps the numeric RPC code on the rejection the client produces', async () => {
    const client = new JsonRpcClient({ stdin: { write: vi.fn().mockResolvedValue(undefined) } } as never);
    const pending = client.call('turn/steer', {}, 5_000);
    // Drive the client the way app-server stdout would, then assert the code
    // survives — stringifying it into the message is what hid the refusal.
    (client as unknown as { handleLine: (line: string) => void }).handleLine(JSON.stringify({
      id: 1,
      error: { code: -32600, message: 'no active turn to steer' },
    }));

    await expect(pending).rejects.toMatchObject({ code: -32600 });
    await expect(pending).rejects.toSatisfy(isCodexNoActiveTurnSteerRejection);
  });
});
