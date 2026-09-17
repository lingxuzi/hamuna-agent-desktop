/**
 * Pure decision core unit tests for the Playwright-via-Bash auto-background
 * gate. The hook shape returns `updatedInput` + `additionalContext` (not a
 * `deny`) so the renderer immediately renders BashOutput.backgroundTaskId
 * instead of waiting forever on a never-returning headed chromium.
 *
 * Two layers: the sync shell-level matcher (`decidePlaywrightBashTransform`)
 * and the async script-file scan (`decideScriptFileBashTransform`) that closes
 * the LIMITATION case — `node /tmp/probe.cjs` whose source internally uses
 * chromium. See playwright-bash-redirect.ts LIMITATION block.
 */
import { describe, it, expect } from 'vitest';

import {
  decidePlaywrightBashTransform,
  decideScriptFileBashTransform,
  extractNodeScriptPaths,
  scanScriptForPlaywrightUsage,
} from './playwright-bash-redirect';

const NO_TRANSFORM = {
  shouldTransform: false,
  reason: null,
  updatedInput: null,
  additionalContext: null,
};

describe('decidePlaywrightBashTransform', () => {
  describe('non-Bash tools always fall through', () => {
    it.each(['Read', 'Edit', 'Write', 'WebSearch', 'mcp__playwright__browser_navigate'])(
      'returns shouldTransform=false for %s',
      (toolName) => {
        const decision = decidePlaywrightBashTransform({
          toolName,
          originalInput: { command: 'npx playwright test' },
        });
        expect(decision).toEqual(NO_TRANSFORM);
      },
    );
  });

  describe('missing / non-string command', () => {
    it('returns no-transform for empty originalInput', () => {
      expect(decidePlaywrightBashTransform({ toolName: 'Bash', originalInput: {} })).toEqual(
        NO_TRANSFORM,
      );
    });

    it('returns no-transform for non-string command', () => {
      expect(
        decidePlaywrightBashTransform({
          toolName: 'Bash',
          originalInput: { command: 12345 },
        }).shouldTransform,
      ).toBe(false);
    });
  });

  describe('shell-level playwright invocations trigger transform', () => {
    it('transforms `npx playwright test`', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'npx playwright test', description: 'Run e2e tests' },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('npx-playwright-invocation');
      expect(d.updatedInput).toEqual({
        command: 'npx playwright test',
        description: 'Run e2e tests',
        run_in_background: true,
        timeout: 30_000,
      });
      expect(d.additionalContext).toMatch(/\[hamuna:auto-background\]/);
      expect(d.additionalContext).toMatch(/run_in_background/);
    });

    it('transforms `pnpm playwright install`', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'pnpm playwright install' },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('npx-playwright-invocation');
      expect(d.updatedInput).toMatchObject({ run_in_background: true, timeout: 30_000 });
    });

    it('transforms `npx -y playwright@latest codegen`', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'npx -y playwright@latest codegen https://example.com' },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('npx-playwright-invocation');
    });

    it('transforms `playwright test --headed` (bare CLI subcommand)', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'playwright test --headed' },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('playwright-cli-subcommand');
    });

    it('transforms `playwright install chromium`', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'playwright install chromium' },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('playwright-cli-subcommand');
    });
  });

  describe('shell-level browser-binary invocations trigger transform', () => {
    it('transforms direct chrome.exe invocation', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: {
          command: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless',
        },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('chrome-exe-invocation');
      expect(d.updatedInput).toMatchObject({ run_in_background: true, timeout: 30_000 });
    });

    it('transforms direct msedge.exe invocation', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: {
          command: '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
        },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('msedge-exe-invocation');
    });

    it('transforms `chromium --no-sandbox`', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'chromium --no-sandbox' },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('chromium-binary-invocation');
    });

    it('transforms `chromium-browser --headless`', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'chromium-browser --headless --disable-gpu' },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.reason).toBe('chromium-binary-invocation');
    });
  });

  describe('field preservation', () => {
    it('preserves description and command verbatim while overriding only background knobs', () => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: {
          command: 'npx playwright test --grep "login"',
          description: 'Run login-flow e2e',
          run_in_background: false, // model thought sync was OK
          timeout: 999_999_999, // unrealistic
        },
      });
      expect(d.shouldTransform).toBe(true);
      expect(d.updatedInput).toEqual({
        command: 'npx playwright test --grep "login"',
        description: 'Run login-flow e2e',
        run_in_background: true,
        timeout: 30_000,
      });
      // run_in_background flipped from false → true; timeout clamped to 30s.
      // The hook wins; the model's earlier values are overridden.
    });
  });

  describe('legitimate Bash commands MUST NOT be transformed', () => {
    it('does not transform `node /tmp/probe_home.cjs`', () => {
      // LIMITATION case: the cjs source internally uses chromium but the
      // command line shows nothing. We assert no-transform — by design.
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: {
          command:
            'NODE_PATH=/d/Coding/hamuna-agent-desktop/node_modules node /tmp/probe_home.cjs 2>&1',
          description: 'Probe Xueqiu homepage',
        },
      });
      expect(d).toEqual(NO_TRANSFORM);
    });

    it('does not transform `cat log | grep playwright-mcp`', () => {
      // "playwright-mcp" contains the substring "playwright"; the regex
      // must not match it because that is the very thing we redirect TO.
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'cat /tmp/log.txt | grep playwright-mcp | head -60' },
      });
      expect(d).toEqual(NO_TRANSFORM);
    });

    it('does not transform `ls /opt/chromium-snapshots/`', () => {
      // Path containing "chromium" — must NOT match chromium-binary pattern.
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command: 'ls /opt/chromium-snapshots/ && echo done' },
      });
      expect(d).toEqual(NO_TRANSFORM);
    });

    it.each([
      'rm -rf node_modules',
      'git status',
      'cargo test --release',
      'npm install',
      'echo hello',
      'curl -sS https://api.example.com/v1/health',
    ])('does not transform %s', (command) => {
      const d = decidePlaywrightBashTransform({
        toolName: 'Bash',
        originalInput: { command },
      });
      expect(d.shouldTransform, `should not transform: ${command}`).toBe(false);
    });
  });

  describe('additionalContext is a stable string keyed by `reason`', () => {
    it('uses a single canonical additionalContext string across all reasons', () => {
      const commands = [
        'npx playwright test',
        'playwright codegen https://example.com',
        '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
        'chromium-browser --headless',
        '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
      ];
      const messages = new Set<string>();
      for (const command of commands) {
        const d = decidePlaywrightBashTransform({
          toolName: 'Bash',
          originalInput: { command },
        });
        expect(d.shouldTransform).toBe(true);
        messages.add(d.additionalContext ?? '<null>');
      }
      expect(messages.size).toBe(1);
      // Forward-looking marker so a future reviewer can decide whether to
      // introduce per-reason copy or keep the single canonical message.
      expect([...messages][0]).toMatch(/tools already pick/i);
    });
  });
});

describe('decideScriptFileBashTransform — script-file scan (LIMITATION case)', () => {
  const fakeReadFile = (contents: Record<string, string>, rejectPaths: string[] = []) =>
    async (p: string): Promise<string> => {
      if (rejectPaths.includes(p)) throw new Error(`ENOENT: ${p}`);
      const c = contents[p];
      if (c === undefined) throw new Error(`ENOENT: ${p}`);
      return c;
    };

  it('transforms `NODE_PATH=... node "C:\\...\\probe.cjs"` when the script uses Playwright/Chromium', async () => {
    const readFile = fakeReadFile({
      'C:\\Users\\Cai\\probe_home.cjs':
        "const { chromium } = require('playwright');\nchromium.launchPersistentContext('C:\\\\Users\\\\Cai\\.playwright-mcp-profile', { headless: false });",
    });
    const d = await decideScriptFileBashTransform(
      {
        toolName: 'Bash',
        originalInput: {
          command:
            'NODE_PATH="/d/Coding/hamuna-agent-desktop/node_modules" node "C:\\Users\\Cai\\probe_home.cjs" 2>&1',
          description: 'Probe Xueqiu homepage',
        },
      },
      readFile,
    );
    expect(d).toMatchObject({
      shouldTransform: true,
      reason: 'script-file-playwright-usage',
      updatedInput: { run_in_background: true, timeout: 30_000 },
    });
    expect(d.additionalContext).toMatch(/\[hamuna:auto-background\]/);
  });

  it('normalizes MSYS paths (`/d/...` → `D:\\...`) before reading', async () => {
    const seen: string[] = [];
    const readFile = async (p: string): Promise<string> => {
      seen.push(p);
      return 'const { chromium } = require("playwright"); chromium.launch();';
    };
    const d = await decideScriptFileBashTransform(
      { toolName: 'Bash', originalInput: { command: 'node /d/Coding/hamuna/probe.cjs' } },
      readFile,
    );
    expect(seen).toEqual(['D:\\Coding\\hamuna\\probe.cjs']);
    expect(d.shouldTransform).toBe(true);
  });

  it('resolves relative scripts against a leading `cd <dir> &&`', async () => {
    const seen: string[] = [];
    const readFile = async (p: string): Promise<string> => {
      seen.push(p);
      return 'require("playwright");';
    };
    const d = await decideScriptFileBashTransform(
      {
        toolName: 'Bash',
        originalInput: { command: 'cd /d/Coding/hamuna && node probe.cjs' },
      },
      readFile,
    );
    expect(seen).toEqual(['D:\\Coding\\hamuna\\probe.cjs']);
    expect(d.shouldTransform).toBe(true);
  });

  it('fails open when the script does not reference a browser', async () => {
    const readFile = fakeReadFile({
      'D:\\work\\build.cjs': 'console.log("plain build"); fs.copyFileSync(a, b);',
    });
    const d = await decideScriptFileBashTransform(
      { toolName: 'Bash', originalInput: { command: 'node "D:\\work\\build.cjs"' } },
      readFile,
    );
    expect(d).toEqual({
      shouldTransform: false,
      reason: null,
      updatedInput: null,
      additionalContext: null,
    });
  });

  it('fails open when the script file cannot be read', async () => {
    const d = await decideScriptFileBashTransform(
      { toolName: 'Bash', originalInput: { command: 'node missing_probe.cjs' } },
      fakeReadFile({}, ['C:\\missing_probe.cjs']),
    );
    expect(d.shouldTransform).toBe(false);
  });

  it('fails open for non-Bash tools and non-string commands', async () => {
    const readFile = fakeReadFile({ 'x.cjs': 'playwright' });
    const nonBash = await decideScriptFileBashTransform(
      { toolName: 'Read', originalInput: { command: 'node x.cjs' } },
      readFile,
    );
    expect(nonBash.shouldTransform).toBe(false);
    const nonString = await decideScriptFileBashTransform(
      { toolName: 'Bash', originalInput: { command: 42 } },
      readFile,
    );
    expect(nonString.shouldTransform).toBe(false);
  });

  describe('extractNodeScriptPaths', () => {
    it('extracts the script arg and skips node_modules false positives', () => {
      const cmd =
        'NODE_PATH="/d/Coding/hamuna/node_modules" node "C:\\Users\\Cai\\probe_home.cjs" 2>&1';
      expect(extractNodeScriptPaths(cmd)).toEqual(['C:\\Users\\Cai\\probe_home.cjs']);
    });

    it('extracts bare unquoted paths and last-in-chain', () => {
      expect(extractNodeScriptPaths('node probe.cjs && node /d/x/y.mjs')).toEqual([
        'probe.cjs',
        '/d/x/y.mjs',
      ]);
    });

    it('ignores commands without a node file argument', () => {
      expect(extractNodeScriptPaths('npm test && ls -la')).toEqual([]);
      expect(extractNodeScriptPaths('node -e "console.log(1)"')).toEqual([]);
    });
  });

  describe('scanScriptForPlaywrightUsage', () => {
    it.each([
      ['require("playwright")'],
      ["const { chromium } = require('playwright')"],
      ['chromium.launchPersistentContext(profile, opts)'],
      ['chromium.launch({ headless: false })'],
      ['const puppeteer = require("puppeteer")'],
    ])('matches %s', (content) => {
      expect(scanScriptForPlaywrightUsage(content)).toBe(true);
    });

    it.each([
      ['console.log("hello")'],
      ['fs.writeFileSync("a", "b")'],
      ['const res = await fetch("https://example.com/api/data")'],
    ])('does not match plain script %s', (content) => {
      expect(scanScriptForPlaywrightUsage(content)).toBe(false);
    });
  });
});
