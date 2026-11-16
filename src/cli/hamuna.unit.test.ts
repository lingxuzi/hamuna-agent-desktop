import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

import {
  formatCronInstantForDisplay,
  formatCronTaskScheduleForDisplay,
  buildRequestBody,
  buildRoute,
  buildClaimCancelBody,
  buildSpaceCompleteOperationKey,
  TOP_HELP,
  normalizeScheduleFlag,
  parseArgs,
  parseDispatchAtValue,
  printGoalResult,
  printResult,
  readWorkspaceTextFile,
  rejectUnsupportedSpaceDryRun,
} from './hamuna';

describe('hamuna CLI Space issue contracts', () => {
  it('advertises the modern Space Issue entry without the stale legacy issue alias', () => {
    expect(TOP_HELP).toContain('space     Discover Cloud Goals and manage Space Issues/attachments');
    expect(TOP_HELP).toContain('hamuna space issue view <issueId> --space <slug> --comments --json');
    expect(TOP_HELP).not.toContain('issue     Legacy read-only alias for Space issue view');
  });

  it('routes Goal discovery and builds scoped Goal/update request bodies', () => {
    expect(buildRoute('space', 'goal', ['list'])).toBe('space/goal-list');
    expect(buildRequestBody('space', 'goal', ['list'], {
      space: 'official',
      workspacePath: '/workspace',
      includeArchived: true,
    })).toMatchObject({
      spaceSlug: 'official',
      workspacePath: '/workspace',
      includeArchived: true,
    });

    expect(buildRoute('space', 'issue', ['update', 'iss_1'])).toBe('space/issue-update');
    expect(buildRequestBody('space', 'issue', ['update', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
      title: 'Updated title',
      goal: 'goal_cli',
      humanOnly: 'false',
    })).toMatchObject({
      spaceSlug: 'official',
      issueId: 'iss_1',
      title: 'Updated title',
      goalUpdate: { action: 'set', goalId: 'goal_cli' },
      humanOnly: false,
    });
    expect(buildRequestBody('space', 'issue', ['update', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
      clearGoal: true,
    })).toMatchObject({
      issueId: 'iss_1',
      goalUpdate: { action: 'clear' },
    });
    const titleOnly = buildRequestBody('space', 'issue', ['update', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
      title: 'No Goal change',
    });
    expect(titleOnly).not.toHaveProperty('goalUpdate');
  });

  it('parses presence flags and explicit human-only booleans without swallowing later flags', () => {
    expect(parseArgs([
      'space', 'goal', 'list', '--space', 'official', '--include-archived', '--json',
    ])).toMatchObject({
      positional: ['space', 'goal', 'list'],
      flags: { space: 'official', includeArchived: true, json: true },
    });
    expect(parseArgs([
      'space', 'issue', 'update', 'iss_1', '--clear-goal', '--json', '--human-only', 'false',
    ])).toMatchObject({
      positional: ['space', 'issue', 'update', 'iss_1'],
      flags: { clearGoal: true, json: true, humanOnly: 'false' },
    });
    expect(parseArgs(['--human-only'])).toMatchObject({ flags: { humanOnly: true } });
    expect(parseArgs(['--human-only=true'])).toMatchObject({ flags: { humanOnly: 'true' } });
    expect(parseArgs(['--human-only=false'])).toMatchObject({ flags: { humanOnly: 'false' } });
    expect(parseArgs(['--human-only', 'maybe', '--json'])).toMatchObject({
      positional: ['maybe'],
      flags: { humanOnly: true, humanOnlyInvalidValue: 'maybe', json: true },
    });
  });

  it('accepts the existing goalId alias and each single body source for update', () => {
    expect(buildRequestBody('space', 'issue', ['update', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
      goalId: 'goal_legacy_alias',
    })).toMatchObject({
      issueId: 'iss_1',
      goalUpdate: { action: 'set', goalId: 'goal_legacy_alias' },
    });
    expect(buildRequestBody('space', 'issue', ['update', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
      body: 'replacement body',
    })).toMatchObject({ issueId: 'iss_1', body: 'replacement body' });

    const dir = mkdtempSync(join(process.cwd(), '.space-update-body-test-'));
    try {
      const bodyPath = join(dir, 'issue.md');
      writeFileSync(bodyPath, 'body from file', 'utf8');
      expect(buildRequestBody('space', 'issue', ['update', 'iss_1'], {
        space: 'official',
        workspacePath: dir,
        bodyFile: bodyPath,
      })).toMatchObject({ issueId: 'iss_1', body: 'body from file' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes advertised Issue list booleans before Rust deserialization', () => {
    expect(buildRequestBody('space', 'issue', ['list'], {
      space: 'official',
      workspacePath: '/workspace',
      includeSubtree: 'false',
      humanOnly: 'true',
    })).toMatchObject({ includeSubtree: false, humanOnly: true });
    expect(buildRequestBody('space', 'issue', ['list'], {
      space: 'official',
      workspacePath: '/workspace',
      includeSubtree: 'true',
      humanOnly: 'false',
    })).toMatchObject({ includeSubtree: true, humanOnly: false });
  });

  it('keeps bare human-only compatible before a positional Issue id', () => {
    const { positional, flags } = parseArgs([
      'space', 'issue', 'update', '--human-only', 'iss_1', '--space', 'official',
    ]);
    expect(buildRequestBody(positional[0], positional[1], positional.slice(2), {
      ...flags,
      workspacePath: '/workspace',
    })).toMatchObject({ issueId: 'iss_1', humanOnly: true });
  });

  it('returns one structured local error for update conflicts, invalid booleans, and empty updates', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ json: true, space: 'official', goal: 'goal_1', clearGoal: true }, 'GOAL_SELECTION_CONFLICT'],
        [{ json: true, space: 'official', body: 'body', bodyFile: 'issue.md' }, 'BODY_SOURCE_CONFLICT'],
        [{ json: true, space: 'official', body: 'body', stdin: true }, 'BODY_SOURCE_CONFLICT'],
        [{ json: true, space: 'official', humanOnly: 'maybe' }, 'BOOLEAN_VALUE_INVALID'],
        [{ json: true, space: 'official', goal: true }, 'FLAG_VALUE_REQUIRED'],
        [{ json: true, space: 'official' }, 'ISSUE_UPDATE_EMPTY'],
      ];
      for (const [flags, code] of cases) {
        expect(() => buildRequestBody('space', 'issue', ['update', 'iss_1'], {
          workspacePath: '/workspace',
          ...flags,
        })).toThrow('process.exit(2)');
        expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
          success: false,
          code,
          suggestion: expect.any(String),
        });
      }
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it('rejects explicit empty Goal values on create instead of silently creating Inbox', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      for (const goalFlags of [{ goal: '' }, { goalId: '' }, { goal: true }]) {
        expect(() => buildRequestBody('space', 'issue', ['create'], {
          json: true,
          space: 'official',
          title: 'Must not publish',
          body: 'Explicit empty Goal is invalid.',
          ...goalFlags,
        })).toThrow('process.exit(2)');
        expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
          success: false,
          code: 'FLAG_VALUE_REQUIRED',
        });
      }
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it('validates the update identity before metadata fields', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      expect(() => buildRequestBody('space', 'issue', ['update'], {
        json: true,
        space: 'official',
        title: 'x',
      })).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ code: 'ARGUMENT_REQUIRED' });

      expect(() => buildRequestBody('space', 'issue', ['update', 'iss_1'], {
        json: true,
        title: 'x',
      })).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ code: 'SPACE_REQUIRED' });
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it('rejects non-metadata update flags instead of partially applying a patch', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      for (const forbidden of [
        { state: 'done' },
        { assignee: 'agent:other' },
        { attachment: 'result.png' },
        { deliveryId: 'delivery_1' },
        { rollback: true },
        { expectedNotificationVersion: '4' },
        { localTaskId: 'task_1' },
      ]) {
        expect(() => buildRequestBody('space', 'issue', ['update', 'iss_1'], {
          json: true,
          space: 'official',
          title: 'partial update must not happen',
          ...forbidden,
        })).toThrow('process.exit(2)');
        expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
          success: false,
          code: 'UPDATE_FIELD_UNSUPPORTED',
        });
      }
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it('requires an explicit include-subtree boolean and rejects malformed list booleans', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      const cases: Array<[string[], string]> = [
        [['--include-subtree', '--json'], 'FLAG_VALUE_REQUIRED'],
        [['--include-subtree', 'maybe', '--json'], 'BOOLEAN_VALUE_INVALID'],
      ];
      for (const [args, code] of cases) {
        const { flags } = parseArgs(['--space', 'official', ...args]);
        expect(() => buildRequestBody('space', 'issue', ['list'], {
          ...flags,
          workspacePath: '/workspace',
        })).toThrow('process.exit(2)');
        expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ code });
      }
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it('does not confuse a repeated Issue id with bare human-only syntax', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      const { positional, flags } = parseArgs([
        'space', 'issue', 'update', 'iss_1', '--human-only', 'iss_1', '--space', 'official', '--json',
      ]);
      expect(() => buildRequestBody(positional[0], positional[1], positional.slice(2), {
        ...flags,
        workspacePath: '/workspace',
      })).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        code: 'BOOLEAN_VALUE_INVALID',
      });
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it('keeps executable recovery commands visible with human suggestions', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      printResult('space', 'issue', {
        success: false,
        error: 'Goal is archived.',
        suggestion: 'List active Goals and retry.',
        suggestedCommand: 'hamuna space goal list --space official --json',
      }, false);
      expect(error.mock.calls.map(call => String(call[0]))).toEqual([
        'Error: Goal is archived.',
        'Suggestion: List active Goals and retry.',
        '  \u2192 Run: hamuna space goal list --space official --json',
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it('rejects unsupported Space mutation dry-runs before any HTTP call', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const mutations = [
        ['space', 'issue', 'create'],
        ['space', 'issue', 'update', 'iss_1'],
        ['space', 'issue', 'comment', 'iss_1'],
        ['space', 'issue', 'status', 'iss_1'],
        ['space', 'issue', 'claim', 'iss_1'],
        ['space', 'issue', 'attachment', 'add', 'iss_1'],
        ['space', 'issue', 'close', 'iss_1'],
        ['space', 'issue', 'complete', 'iss_1'],
        ['space', 'issue', 'cancel-claim', 'iss_1'],
        ['space', 'claim', 'local-task', 'iss_1'],
        ['space', 'attachment', 'add', 'iss_1'],
        ['space', 'attachment', 'download', 'att_1'],
      ];
      for (const positional of mutations) {
        expect(() => rejectUnsupportedSpaceDryRun(
          positional,
          { json: true, dryRun: true, space: 'official' },
        ), positional.join(' ')).toThrow('process.exit(2)');
        const nestedIssueLeaf = positional[1] === 'issue'
          && positional[2] === 'attachment';
        const expectedCommand = positional.slice(0, nestedIssueLeaf ? 4 : 3).join(' ');
        expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
          suggestion: expect.stringContaining(`Read hamuna ${expectedCommand} --help`),
        });
      }
      expect(() => rejectUnsupportedSpaceDryRun(
        ['space', 'issue', 'update'],
        { json: true, dryRun: true, space: 'official', issueId: 'iss_alias' },
      )).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        success: false,
        code: 'DRY_RUN_UNSUPPORTED',
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(() => rejectUnsupportedSpaceDryRun(
        ['space', 'goal', 'list'],
        { json: true, dryRun: true, space: 'official' },
      )).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it('routes and builds exact comment lookup by issue and comment id', () => {
    expect(buildRoute('space', 'issue', ['comment', 'get', 'iss_1', 'comment_1']))
      .toBe('space/issue-comment-get');
    expect(buildRequestBody('space', 'issue', ['comment', 'get', 'iss_1', 'comment_1'], {
      space: 'official',
      workspacePath: '/workspace',
      agentId: 'rag_1',
    })).toEqual({
      issueId: 'iss_1',
      commentId: 'comment_1',
      spaceSlug: 'official',
      sessionId: undefined,
      workspaceId: undefined,
      agentId: 'rag_1',
      workspacePath: '/workspace',
    });
  });

  it('keeps the Issue detail default comment window at five', () => {
    expect(buildRequestBody('space', 'issue', ['view', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
    })).toMatchObject({
      issueId: 'iss_1',
      commentsLimit: undefined,
      commentsCursor: undefined,
    });
    expect(buildRoute('space', 'issue', ['comments', 'iss_1']))
      .toBe('space/issue-comments');
    expect(buildRequestBody('space', 'issue', ['comments', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
      cursor: 'opaque-cursor',
    })).toMatchObject({
      issueId: 'iss_1',
      cursor: 'opaque-cursor',
      limit: 20,
    });
  });

  it('uses claim origin to constrain attached-task rollback', () => {
    const claimBody = { issueId: 'iss_1', agentId: 'rag_1', workspacePath: '/workspace' };
    expect(buildClaimCancelBody(claimBody, {
      data: { claim: { id: 'claim_1', origin: 'self_claim' }, notificationVersion: 7 },
    })).toMatchObject({ rollback: true, expectedNotificationVersion: 7 });
    expect(buildClaimCancelBody(claimBody, {
      data: { claim: { id: 'claim_2', origin: 'assignment_confirmation' }, notificationVersion: 9 },
    })).toEqual({
      ...claimBody,
      rollback: true,
    });
  });

  it('generates a stable completion operation key bound to Issue, Task, and result', () => {
    const input = { issueId: 'iss_1', taskOrSessionId: 'task_1', resultComment: 'done' };
    expect(buildSpaceCompleteOperationKey(input)).toBe(buildSpaceCompleteOperationKey(input));
    expect(buildSpaceCompleteOperationKey(input)).not.toBe(
      buildSpaceCompleteOperationKey({ ...input, resultComment: 'different result' }),
    );
  });

  it('builds scoped atomic create/comment requests and the top-level attachment route', () => {
    expect(buildRequestBody('space', 'issue', ['create'], {
      space: 'official',
      workspacePath: '/workspace',
      title: 'A new issue',
      body: 'Details',
      assignee: 'agent:regagent_1',
      attachment: ['one.png'],
      file: ['two.log'],
    })).toMatchObject({
      spaceSlug: 'official',
      title: 'A new issue',
      body: 'Details',
      assigneeId: 'agent:regagent_1',
      filePaths: ['one.png', 'two.log'],
    });

    expect(buildRequestBody('space', 'issue', ['comment', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
      attachment: ['evidence.zip'],
    })).toMatchObject({
      issueId: 'iss_1',
      body: '',
      filePaths: ['evidence.zip'],
    });

    expect(buildRoute('space', 'issue', ['attachment', 'add', 'iss_1']))
      .toBe('space/attachment-add');
    expect(buildRequestBody('space', 'issue', ['attachment', 'add', 'iss_1'], {
      space: 'official',
      workspacePath: '/workspace',
      file: ['report.pdf'],
    })).toMatchObject({ issueId: 'iss_1', filePaths: ['report.pdf'] });
  });

  it('collects both repeatable attachment flag spellings', () => {
    expect(parseArgs([
      'space', 'issue', 'comment', 'iss_1',
      '--space', 'official',
      '--attachment', 'a.png',
      '--attachment=b.log',
      '--file', 'c.zip',
    ])).toMatchObject({
      flags: {
        space: 'official',
        attachment: ['a.png', 'b.log'],
        file: ['c.zip'],
      },
    });
  });

  it('does not let a missing attachment value consume the following JSON flag', () => {
    expect(parseArgs([
      'space', 'issue', 'create',
      '--space', 'official',
      '--title', 'Title',
      '--body', 'Body',
      '--attachment',
      '--json',
    ])).toMatchObject({
      flags: {
        json: true,
        attachment: [],
        attachmentValueMissing: true,
      },
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      const { flags } = parseArgs([
        '--space', 'official',
        '--title', 'Title',
        '--body', 'Body',
        '--file',
        '--json',
      ]);
      expect(() => buildRequestBody('space', 'issue', ['create'], flags)).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        success: false,
        code: 'FLAG_VALUE_REQUIRED',
        suggestion: expect.any(String),
      });
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it('emits a structured recovery contract when a Space slug is missing in JSON mode', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      expect(() => buildRequestBody('space', 'issue', ['view', 'iss_1'], {
        json: true,
        workspacePath: '/workspace',
      })).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
        success: false,
        code: 'SPACE_REQUIRED',
        error: 'This command requires --space <slug>.',
        suggestion: 'Run `hamuna space list --json`, then retry with one returned slug.',
        suggestedCommand: 'hamuna space list --json',
      });
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it('keeps local Space validation machine-readable in JSON mode', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      expect(() => buildRequestBody('space', 'issue', ['create'], {
        json: true,
        space: 'official',
        workspacePath: '/workspace',
        title: 'Missing body',
        body: '   ',
      })).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        success: false,
        code: 'ISSUE_BODY_REQUIRED',
        suggestion: expect.any(String),
      });

      expect(() => buildRequestBody('space', 'issue', ['attachment', 'add', 'iss_1'], {
        json: true,
        space: 'official',
        workspacePath: '/workspace',
      })).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        success: false,
        code: 'ATTACHMENT_REQUIRED',
        suggestion: expect.any(String),
      });

      expect(() => buildRequestBody('space', 'issue', ['create'], {
        json: true,
        space: 'official',
        workspacePath: '/workspace',
        title: true,
        body: 'A title flag without a value must not throw a TypeError.',
      })).toThrow('process.exit(2)');
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        success: false,
        code: 'ARGUMENT_REQUIRED',
        suggestion: expect.any(String),
      });

      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });
});

describe('hamuna CLI Goal file inputs', () => {
  it('reads shell-sensitive objective and reason text from local files', () => {
    const dir = mkdtempSync(join(process.cwd(), '.goal-cli-test-'));
    try {
      const objectivePath = join(dir, 'objective.txt');
      const reasonPath = join(dir, 'reason.txt');
      const objective = 'finish $(touch should-not-run) with `literal` and "quotes"';
      const reason = 'verified $HOME without shell expansion';
      writeFileSync(objectivePath, objective, 'utf8');
      writeFileSync(reasonPath, reason, 'utf8');

      expect(buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
      })).toEqual({ objective });
      expect(buildRequestBody('goal', 'update', [], {
        status: 'complete',
        reasonFile: reasonPath,
      })).toEqual({ status: 'complete', reason });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts Goal objective and reason files outside the current workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hamuna-goal-cli-external-'));
    try {
      const objectivePath = join(dir, 'objective.txt');
      const reasonPath = join(dir, 'reason.txt');
      writeFileSync(objectivePath, 'objective from system temp', 'utf8');
      writeFileSync(reasonPath, 'reason from system temp', 'utf8');

      expect(buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
      })).toEqual({ objective: 'objective from system temp' });
      expect(buildRequestBody('goal', 'update', [], {
        status: 'blocked',
        reasonFile: reasonPath,
      })).toEqual({ status: 'blocked', reason: 'reason from system temp' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds existing Goal end conditions without changing the default payload', () => {
    const dir = mkdtempSync(join(process.cwd(), '.goal-cli-end-conditions-test-'));
    try {
      const objectivePath = join(dir, 'objective.txt');
      writeFileSync(objectivePath, 'finish the release', 'utf8');

      expect(buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
      })).toEqual({ objective: 'finish the release' });
      expect(buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
        deadline: '2026-07-22T09:00:00+08:00',
        maxExecutions: '5',
        aiCanExit: 'false',
      })).toEqual({
        objective: 'finish the release',
        endConditions: {
          deadline: '2026-07-22T01:00:00.000Z',
          maxExecutions: 5,
          aiCanExit: false,
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects ambiguous or invalid Goal end conditions at the CLI boundary', () => {
    const dir = mkdtempSync(join(process.cwd(), '.goal-cli-invalid-end-conditions-test-'));
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const objectivePath = join(dir, 'objective.txt');
      writeFileSync(objectivePath, 'finish the release', 'utf8');

      expect(() => buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
        deadline: '2026-07-22T09:00:00',
      })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
        deadline: '2026-02-30T09:00:00+08:00',
      })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
        maxExecutions: '0',
      })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
        maxExecutions: '1.5',
      })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
        aiCanExit: 'sometimes',
      })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('goal', 'create', [], {
        objectiveFile: objectivePath,
        aiCanExit: true,
      })).toThrow('process.exit(2)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('shows settled and current Goal turns separately with effective end conditions', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      printGoalResult('get', {
        goal: {
          id: 'goal-1',
          status: 'active',
          turnCount: 3,
          isExecuting: true,
          executionNumber: 4,
          endConditions: {
            deadline: '2026-07-22T01:00:00.000Z',
            maxExecutions: 5,
            aiCanExit: false,
          },
        },
      });

      const output = log.mock.calls.map(call => String(call[0])).join('\n');
      expect(output).toContain('settled turns: 3');
      expect(output).toContain('current turn:  4 (executing)');
      expect(output).toContain('max executions: 5');
      expect(output).toContain('AI can exit:    no');
      expect(output).toContain('[UTC 2026-07-22T01:00:00.000Z]');
      expect(output).not.toContain('  turns:');
    } finally {
      log.mockRestore();
    }
  });

  it('keeps workspace-scoped readers bounded and rejects unsafe file shapes', () => {
    const root = mkdtempSync(join(process.cwd(), '.goal-cli-safety-test-'));
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    try {
      const outside = join(root, 'outside.txt');
      writeFileSync(outside, 'outside', 'utf8');
      expect(() => readWorkspaceTextFile(outside, workspace)).toThrow(/inside workspace/);

      const target = join(workspace, 'target.txt');
      const link = join(workspace, 'link.txt');
      writeFileSync(target, 'target', 'utf8');
      symlinkSync(target, link);
      expect(() => readWorkspaceTextFile(link, workspace)).toThrow(/symlink/);

      const oversized = join(workspace, 'oversized.txt');
      writeFileSync(oversized, 'x'.repeat(1024 * 1024 + 1), 'utf8');
      expect(() => readWorkspaceTextFile(oversized, workspace)).toThrow(/exceeds/);

      const nul = join(workspace, 'nul.txt');
      writeFileSync(nul, 'before\0after', 'utf8');
      expect(() => readWorkspaceTextFile(nul, workspace)).toThrow(/NUL/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects inline and positional Goal text before building an API request', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('goal', 'create', [], {
        objective: '$(touch should-not-run)',
      })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('goal', 'create', ['positional objective'], {}))
        .toThrow('process.exit(2)');
      expect(() => buildRequestBody('goal', 'update', [], {
        status: 'complete',
        reason: '`touch should-not-run`',
      })).toThrow('process.exit(2)');
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});

describe('hamuna CLI parseArgs', () => {
  it('normalizes file-only Goal flags to camelCase', () => {
    expect(parseArgs([
      'goal',
      'create',
      '--objective-file',
      'hamuna_files/objective.txt',
      '--deadline',
      '2026-07-22T09:00:00+08:00',
      '--max-executions',
      '5',
      '--ai-can-exit',
      'false',
    ])).toMatchObject({
      positional: ['goal', 'create'],
      flags: {
        objectiveFile: 'hamuna_files/objective.txt',
        deadline: '2026-07-22T09:00:00+08:00',
        maxExecutions: '5',
        aiCanExit: 'false',
      },
    });
  });

  it('collects consecutive values for repeatable flags', () => {
    expect(parseArgs([
      'model',
      'add',
      '--models',
      'sensenova-6.7-flash-lite',
      'deepseek-v4-flash',
      'glm-5.2',
      '--primary-model',
      'sensenova-6.7-flash-lite',
    ])).toMatchObject({
      positional: ['model', 'add'],
      flags: {
        models: ['sensenova-6.7-flash-lite', 'deepseek-v4-flash', 'glm-5.2'],
        primaryModel: 'sensenova-6.7-flash-lite',
      },
    });
  });

  it('appends repeated repeatable flags instead of overwriting them', () => {
    expect(parseArgs([
      'model',
      'add',
      '--models',
      'A',
      '--models',
      'B',
      '--models=C',
    ])).toMatchObject({
      flags: { models: ['A', 'B', 'C'] },
    });
  });

  it('keeps model names aligned when both model lists use consecutive values', () => {
    expect(parseArgs([
      'model',
      'add',
      '--models',
      'A',
      'B',
      '--model-names',
      'Model A',
      'Model B',
    ])).toMatchObject({
      flags: {
        models: ['A', 'B'],
        modelNames: ['Model A', 'Model B'],
      },
    });
  });

  it('still accepts dash-prefixed values as the first repeatable value', () => {
    expect(parseArgs([
      'mcp',
      'add',
      '--args',
      '--stdio',
      'server.js',
      '--env',
      'TOKEN=secret',
    ])).toMatchObject({
      flags: {
        args: ['--stdio', 'server.js'],
        env: ['TOKEN=secret'],
      },
    });
  });
});

describe('hamuna CLI cron time handling', () => {
  it('adds a default IANA timezone to bare cron schedules on create paths', () => {
    expect(normalizeScheduleFlag('0 9 * * *', {
      fillMissingCronTimezone: true,
      defaultTimezone: 'Asia/Shanghai',
    })).toEqual({
      kind: 'cron',
      expr: '0 9 * * *',
      tz: 'Asia/Shanghai',
    });
  });

  it('leaves bare cron schedules timezone-free for update inheritance', () => {
    expect(normalizeScheduleFlag('0 9 * * *')).toEqual({
      kind: 'cron',
      expr: '0 9 * * *',
    });
  });

  it('fills missing JSON cron timezone on create but preserves explicit UTC', () => {
    expect(normalizeScheduleFlag('{"kind":"cron","expr":"0 9 * * *"}', {
      fillMissingCronTimezone: true,
      defaultTimezone: 'Asia/Shanghai',
    })).toMatchObject({
      kind: 'cron',
      expr: '0 9 * * *',
      tz: 'Asia/Shanghai',
    });

    expect(normalizeScheduleFlag('{"kind":"cron","expr":"0 9 * * *","tz":"UTC"}', {
      fillMissingCronTimezone: true,
      defaultTimezone: 'Asia/Shanghai',
    })).toMatchObject({
      kind: 'cron',
      expr: '0 9 * * *',
      tz: 'UTC',
    });
  });

  it('rejects retired loop schedules from ordinary cron commands', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => normalizeScheduleFlag('{"kind":"loop"}')).toThrow('process.exit(2)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Goal Mode'));
      expect(error).toHaveBeenCalledWith(expect.stringContaining('hamuna goal create --objective-file'));
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('requires explicit offset or Z for one-shot dispatchAt strings', () => {
    expect(parseDispatchAtValue('2026-06-01T09:00:00+08:00')).toBe(Date.parse('2026-06-01T09:00:00+08:00'));
    expect(parseDispatchAtValue('2026-06-01T01:00:00Z')).toBe(Date.parse('2026-06-01T01:00:00Z'));
    expect(() => parseDispatchAtValue('2026-06-01T09:00:00')).toThrow(/explicit timezone offset or Z/);
  });

  it('marks legacy cron schedules without tz as UTC by default in display text', () => {
    expect(formatCronTaskScheduleForDisplay({
      schedule: { kind: 'cron', expr: '0 9 * * *' },
    }, 'long')).toBe('0 9 * * * @ UTC(default)');
  });

  it('formats instants with timezone name and offset for human output', () => {
    expect(formatCronInstantForDisplay('2026-07-09T01:00:00Z', 'Asia/Shanghai', 'long'))
      .toBe('2026-07-09 09:00 Asia/Shanghai (UTC+08:00)');
  });
});

describe('hamuna CLI browser search', () => {
  it('routes browser search to the browser/search admin route', () => {
    expect(buildRoute('browser', 'search', ['tauri webview'])).toBe('browser/search');
  });

  it('takes the query positionally or from --query', () => {
    expect(buildRequestBody('browser', 'search', ['tauri webview'], {})).toMatchObject({
      query: 'tauri webview',
    });
    expect(buildRequestBody('browser', 'search', [], { query: 'tauri webview' })).toMatchObject({
      query: 'tauri webview',
    });
  });

  it('forwards the engine only when one was given', () => {
    expect(buildRequestBody('browser', 'search', ['q'], { engine: 'bing' })).toMatchObject({
      query: 'q',
      engine: 'bing',
    });
    expect(buildRequestBody('browser', 'search', ['q'], {}).engine).toBeUndefined();
  });

  it('keeps the session id when one is passed', () => {
    expect(buildRequestBody('browser', 'search', ['q'], { session: 'sess-1' })).toMatchObject({
      sessionId: 'sess-1',
    });
  });

  it('rejects a search with no query', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('browser', 'search', [], {})).toThrow('process.exit(2)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('browser search requires a query'));
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('advertises the search command in the top help', () => {
    expect(TOP_HELP).toContain('hamuna browser search "tauri webview"');
  });
});

describe('hamuna CLI browser scroll', () => {
  const withExitSpy = (fn: () => void) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fn();
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  };

  it('routes scroll to its own admin route', () => {
    expect(buildRoute('browser', 'scroll', [])).toBe('browser/scroll');
  });

  it('turns wheel notches into pixels and keeps the direction', () => {
    // A mouse wheel is discrete: one notch = 100px, the same figure Chrome
    // uses. A trackpad is continuous, so it speaks in pixels directly.
    expect(buildRequestBody('browser', 'scroll', [], { down: '3' })).toMatchObject({ delta: 300 });
    expect(buildRequestBody('browser', 'scroll', [], { up: '2' })).toMatchObject({ delta: -200 });
    expect(buildRequestBody('browser', 'scroll', [], { delta: '800' })).toMatchObject({ delta: 800 });
    expect(buildRequestBody('browser', 'scroll', [], { delta: '-450' })).toMatchObject({ delta: -450 });
  });

  it('jumps to an edge and brings a target into view', () => {
    expect(buildRequestBody('browser', 'scroll', [], { to: 'bottom' })).toMatchObject({ to: 'bottom' });
    expect(buildRequestBody('browser', 'scroll', [], { to: 'top' })).toMatchObject({ to: 'top' });
    expect(buildRequestBody('browser', 'scroll', [], { selector: '#feed' })).toMatchObject({ selector: '#feed' });
    expect(buildRequestBody('browser', 'scroll', [], { text: '发布设置' })).toMatchObject({ text: '发布设置' });
  });

  it('keeps the session id when one is passed', () => {
    expect(buildRequestBody('browser', 'scroll', [], { session: 'sess-1', down: '1' })).toMatchObject({
      sessionId: 'sess-1',
      delta: 100,
    });
  });

  it('takes exactly one instruction — two would be silently ambiguous', () => {
    withExitSpy(() => {
      expect(() => buildRequestBody('browser', 'scroll', [], {})).toThrow('process.exit(2)');
      expect(() => buildRequestBody('browser', 'scroll', [], { down: '3', to: 'bottom' })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('browser', 'scroll', [], { delta: '800', selector: '#x' })).toThrow('process.exit(2)');
    });
  });

  it('rejects a scroll that could not possibly move anything', () => {
    withExitSpy(() => {
      expect(() => buildRequestBody('browser', 'scroll', [], { delta: '0' })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('browser', 'scroll', [], { delta: '12.5' })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('browser', 'scroll', [], { to: 'middle' })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('browser', 'scroll', [], { down: '0' })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('browser', 'scroll', [], { up: '-1' })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('browser', 'scroll', [], { down: 'abc' })).toThrow('process.exit(2)');
    });
  });

  it('advertises the scroll command in the top help', () => {
    expect(TOP_HELP).toContain('hamuna browser scroll --down 3');
    expect(TOP_HELP).toContain('hamuna browser scroll --delta 800');
    expect(TOP_HELP).toContain('hamuna browser scroll --to bottom');
  });
});

describe('hamuna CLI browser login surface', () => {
  it('sends no credentials for images', () => {
    expect(buildRequestBody('browser', 'images', [], {})).toEqual({});
    expect(buildRequestBody('browser', 'images', [], { session: 's1' })).toEqual({ sessionId: 's1' });
  });

  it('takes the image index from --index or positionally', () => {
    expect(buildRequestBody('browser', 'image-data', [], { index: '2' })).toMatchObject({ index: 2 });
    expect(buildRequestBody('browser', 'image-data', ['3'], {})).toMatchObject({ index: 3 });
  });

  it('rejects an image-data call with no usable index', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('browser', 'image-data', [], {})).toThrow('process.exit(2)');
      expect(() => buildRequestBody('browser', 'image-data', [], { index: '-1' })).toThrow('process.exit(2)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('browser image-data requires --index'));
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('rejects a login with no --user before reading stdin', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('browser', 'login', [], {})).toThrow('process.exit(2)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('browser login requires --user'));
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});

describe('hamuna CLI browser multi-tab surface', () => {
  it('routes the tab verbs to their own admin routes', () => {
    expect(buildRoute('browser', 'tabs', [])).toBe('browser/tabs');
    expect(buildRoute('browser', 'select', [])).toBe('browser/select');
  });

  it('asks for the tab list without any extra payload', () => {
    expect(buildRequestBody('browser', 'tabs', [], {})).toEqual({});
    expect(buildRequestBody('browser', 'tabs', [], { session: 's1' })).toEqual({ sessionId: 's1' });
  });

  it('takes the tab index from --tab as a number', () => {
    expect(buildRequestBody('browser', 'select', [], { tab: '2' })).toMatchObject({ tab: 2 });
  });

  it('rejects a select with no tab index', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('browser', 'select', [], {})).toThrow('process.exit(2)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('browser select requires --tab'));
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('opens in an extra tab only when --new-tab is given', () => {
    expect(buildRequestBody('browser', 'open', ['https://example.com'], {})).toMatchObject({
      url: 'https://example.com',
    });
    expect(buildRequestBody('browser', 'open', ['https://example.com'], {}).newTab).toBeUndefined();
    expect(buildRequestBody('browser', 'open', ['https://example.com'], { newTab: true })).toMatchObject({
      url: 'https://example.com',
      newTab: true,
    });
  });

  it('advertises the multi-tab commands in the top help', () => {
    expect(TOP_HELP).toContain('hamuna browser tabs');
    expect(TOP_HELP).toContain('hamuna browser select');
  });
});

describe('hamuna CLI operations ledger', () => {
  it('routes every verb to the store route that matches it', () => {
    expect(buildRoute('ops', 'list', [])).toBe('ops/read');
    expect(buildRoute('ops', 'add', ['topic'])).toBe('ops/upsert');
    expect(buildRoute('ops', 'update', ['topic'])).toBe('ops/upsert');
    expect(buildRoute('ops', 'remove', ['topic'])).toBe('ops/delete');
    // Kind-first order resolves to the same routes.
    expect(buildRoute('ops', 'topic', ['add'])).toBe('ops/upsert');
    expect(buildRoute('ops', 'topic', ['remove'])).toBe('ops/delete');
  });

  it('sends only the fields the caller changed', () => {
    const body = buildRequestBody('ops', 'update', ['topic'], {
      id: 'topic-1',
      status: 'produced',
    }) as { item: Record<string, unknown> };

    expect(body.item).toEqual({ kind: 'topic', status: 'produced', id: 'topic-1' });
    expect(body.item.title).toBeUndefined();
    expect(body.item.tags).toBeUndefined();
  });

  it('builds a create payload from the required fields and the repeatable ones', () => {
    const body = buildRequestBody('ops', 'add', ['topic'], {
      title: '一条选题',
      platform: 'douyin',
      tag: ['热点', '对比'],
      ref: 'https://example.com/hot',
    }) as { item: Record<string, unknown> };

    expect(body.item).toEqual({
      kind: 'topic',
      title: '一条选题',
      platform: 'douyin',
      tags: ['热点', '对比'],
      sourceRefs: ['https://example.com/hot'],
    });
  });

  it('keeps review metrics nested so a partial update keeps the other counters', () => {
    const body = buildRequestBody('ops', 'update', ['review'], {
      id: 'review-1',
      views: 900,
    }) as { item: Record<string, unknown> };

    expect(body.item.metrics).toEqual({ views: 900 });
  });

  it('lets the agent rename an account but never declare it logged in', () => {
    // 登录态的权威是浏览器 cookie。CLI 的字段白名单里没有 loginState →
    // 调用方传了也进不了载荷。Agent 自己说「已登录」会让界面显示「已登录」
    // 而实际没登录，然后照着这个假状态去自动发布。
    const body = buildRequestBody('ops', 'update', ['account'], {
      platform: 'douyin',
      displayName: '露营装备小王',
      loginState: 'success',
      lastCheckedAt: '2026-11-15T10:00:00.000Z',
    }) as { item: Record<string, unknown> };

    expect(body.item).toEqual({
      kind: 'account',
      platform: 'douyin',
      displayName: '露营装备小王',
    });
  });

  it('requires a platform when creating an account', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('ops', 'add', ['account'], { displayName: '无名号' })).toThrow('process.exit(2)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('--platform'));
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('carries the product / cta / platform-work-id fields through to the ledger', () => {
    // These three are the fields the publish lane writes back through; if a
    // flag is missing from OPS_FIELDS it is silently dropped here, and the
    // only symptom is a ledger that quietly forgets what it was promoting.
    const body = buildRequestBody('ops', 'update', ['asset'], {
      id: 'asset-1',
      product: '露营折叠桌',
      cta: '进店看新款',
      platformWorkId: '7493...',
    }) as { item: Record<string, unknown> };

    expect(body.item).toMatchObject({
      kind: 'asset',
      id: 'asset-1',
      product: '露营折叠桌',
      cta: '进店看新款',
      platformWorkId: '7493...',
    });
  });

  it('carries the source-ref through so intake can point back at the raw material', () => {
    // sourceRef is the only pointer from a ledger entry back to the batch of
    // raw files the human dropped in. If it gets dropped here, the produce
    // step has nothing to read the selling points from and starts guessing.
    const body = buildRequestBody('ops', 'add', ['asset'], {
      title: '露营折叠桌',
      platform: 'douyin',
      sourceRef: 'ops/assets/imported/2026-11-15/折叠桌',
    }) as { item: Record<string, unknown> };

    expect(body.item).toMatchObject({
      kind: 'asset',
      sourceRef: 'ops/assets/imported/2026-11-15/折叠桌',
    });
  });

  it('omits the workspace unless one was named', () => {
    expect(buildRequestBody('ops', 'list', [], {})).toEqual({});
    expect(buildRequestBody('ops', 'list', [], { workspace: '/tmp/ws' })).toEqual({ workspace: '/tmp/ws' });
  });

  it('refuses a create without the fields the store requires', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('ops', 'add', ['topic'], { title: '无平台' })).toThrow('process.exit(2)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('--platform'));
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('requires an id for update and remove', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('ops', 'update', ['topic'], { status: 'planned' })).toThrow('process.exit(2)');
      expect(() => buildRequestBody('ops', 'remove', ['topic'], {})).toThrow('process.exit(2)');
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('collects the repeatable ledger flags', () => {
    const { flags } = parseArgs([
      'ops', 'add', 'asset', '--tag', 'a', 'b', '--shot', '{"no":1}', '--shot', '{"no":2}',
    ]);
    expect(flags.tag).toEqual(['a', 'b']);
    expect(flags.shot).toEqual(['{"no":1}', '{"no":2}']);
  });

  it('narrows a JSON read to the requested kind', () => {
    // The store always answers with the whole ledger. A skill asking for
    // "the rules" must not have to filter the JSON itself.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      printResult('ops', 'list', {
        success: true,
        data: {
          state: {
            topics: [{ id: 'topic-1', title: '一条选题' }],
            assets: [{ id: 'asset-1', title: '一条素材' }],
            reviews: [{ id: 'review-1' }],
            rules: [{ id: 'rule-1', name: '一条规则' }],
          },
        },
      }, true, {}, ['rule']);
      const printed = JSON.parse(log.mock.calls.flat().join('\n')) as {
        data: { state: Record<string, unknown[]> };
      };
      expect(printed.data.state.rules).toHaveLength(1);
      expect(printed.data.state.topics).toEqual([]);
      expect(printed.data.state.assets).toEqual([]);
      expect(printed.data.state.reviews).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it('prints the ledger and the written record id', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      printResult('ops', 'list', {
        success: true,
        data: { state: { topics: [{ id: 'topic-1', title: '一条选题', platform: 'douyin', status: 'idea' }] } },
      }, false);
      expect(log.mock.calls.flat().join('\n')).toContain('topic-1');

      log.mockClear();
      printResult('ops', 'add', {
        success: true,
        data: { id: 'topic-9', state: { topics: [{ id: 'topic-9', title: '新选题' }] } },
      }, false, {}, ['topic']);
      const written = log.mock.calls.flat().join('\n');
      expect(written).toContain('topic-9');
      expect(written).toContain('hamuna ops update topic --id topic-9');
    } finally {
      log.mockRestore();
    }
  });
});

describe('hamuna platforms', () => {
  it('列表和单个平台走同一个 route —— 平台 id 是 body 里的筛选条件，不是路由段', () => {
    expect(buildRoute('platforms', 'list', [])).toBe('platforms/list');
    expect(buildRoute('platforms', 'douyin', [])).toBe('platforms/list');
    expect(buildRequestBody('platforms', 'list', [], {})).toEqual({});
    expect(buildRequestBody('platforms', 'douyin', ['douyin'], {})).toEqual({ id: 'douyin' });
  });

  it('帮助里写得出这个命令', () => {
    expect(TOP_HELP).toContain('hamuna platforms');
  });

  it('单平台输出带形态和上限，列表输出每个平台一行', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      printResult('platforms', 'douyin', {
        success: true,
        data: {
          id: 'douyin',
          mediaKinds: ['image-text'],
          creatorHomeUrl: 'https://creator.douyin.com/',
          publishUrl: 'https://creator.douyin.com/creator-micro/content/upload',
          limits: { maxTitleLength: 30, maxImages: 12 },
        },
      }, false);
      const detail = log.mock.calls.flat().join('\n');
      expect(detail).toContain('image-text');
      expect(detail).toContain('maxTitleLength=30');

      log.mockClear();
      printResult('platforms', 'list', {
        success: true,
        data: [
          { id: 'douyin', mediaKinds: ['image-text'], publishUrl: 'https://creator.douyin.com/x' },
          { id: 'kuaishou', mediaKinds: ['image-text'] },
        ],
      }, false);
      const list = log.mock.calls.flat().join('\n');
      expect(list).toContain('douyin');
      // 没核实过的平台不编 URL —— 显示成「未核实」而不是留白或瞎填。
      expect(list).toContain('(not verified)');
    } finally {
      log.mockRestore();
    }
  });
});

describe('hamuna browser publish', () => {
  it('平台 id 和目标一起进 body', () => {
    expect(buildRoute('browser', 'publish', [])).toBe('browser/publish');
    expect(buildRequestBody('browser', 'publish', [], {
      platform: 'douyin',
      text: '发布',
    })).toEqual({ platform: 'douyin', text: '发布' });
    expect(buildRequestBody('browser', 'publish', [], {
      platform: 'douyin',
      selector: '#publish-btn',
    })).toEqual({ platform: 'douyin', selector: '#publish-btn' });
  });

  it('没有平台就是用法错误（发布必须指名道姓）', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      expect(() => buildRequestBody('browser', 'publish', [], { text: '发布' }))
        .toThrow('process.exit(2)');
    } finally {
      exit.mockRestore();
    }
  });

  it('没有目标也是用法错误', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    try {
      expect(() => buildRequestBody('browser', 'publish', [], { platform: 'douyin' }))
        .toThrow('process.exit(2)');
    } finally {
      exit.mockRestore();
    }
  });

  it('帮助里写得出这个命令', () => {
    expect(TOP_HELP).toContain('hamuna browser publish --platform douyin');
  });
});

describe('hamuna browser fill --value-file', () => {
  const exitWith = () => vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit);

  it('从文件读值——多行文案不该走 argv（换行会让 fill 掉出自动放行）', () => {
    const root = mkdtempSync(join(process.cwd(), '.fill-value-file-test-'));
    try {
      const draft = join(root, 'publish.txt');
      writeFileSync(draft, '标题\n正文第一行\n#话题', 'utf8');
      const body = buildRequestBody('browser', 'fill', [], {
        selector: '#desc',
        valueFile: draft,
      });
      expect(body).toEqual({ selector: '#desc', value: '标题\n正文第一行\n#话题' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('--value 和 --value-file 同时给是用法错误（静默取一个会让另一个看起来生效了）', () => {
    const exit = exitWith();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('browser', 'fill', [], {
        selector: '#desc',
        value: 'a',
        valueFile: 'b.txt',
      })).toThrow('process.exit(2)');
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it('文件读不出来就报错退出，不静默填空字符串', () => {
    const exit = exitWith();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => buildRequestBody('browser', 'fill', [], {
        selector: '#desc',
        valueFile: 'definitely-missing.txt',
      })).toThrow('process.exit(1)');
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });
});
