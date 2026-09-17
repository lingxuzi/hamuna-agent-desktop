import { join } from 'node:path';

/**
 * Playwright-via-Bash background gate (PreToolUse hook payload).
 *
 * WHY THIS EXISTS
 * ---------------
 * Settings → Toolbox → Playwright writes `playwrightSettings.browser` (and
 * headless / device / userDataDir / extraArgs / caps) into the @playwright/mcp
 * MCP server's argv. That configuration ONLY reaches the MCP server. When the
 * model bypasses MCP and writes a Bash command like
 * `node /tmp/probe.cjs 2>&1` whose script internally calls
 * `chromium.launchPersistentContext(..., { channel: 'msedge' })`, the model
 * hardcodes the browser — the user's chosen default is silently ignored, AND
 * the spawned browser cannot inherit the MCP server's persistent user-data-dir
 * / device emulation / caps. See user report 2026-08-18: "Probe Xueqiu homepage
 * hot tab structure" command was `NODE_PATH=... node probe_home.cjs 2>&1`;
 * the model picked `headless: false, channel: 'msedge'`, ignoring Settings →
 * Toolbox. Worse: the script ended up hanging because headed Chromium spawned
 * from the SDK Bash tool in desktop's detached console waits forever for a TTY /
 * display server — see "FIX EVOLUTION" below.
 *
 * The fix is to force such commands to run in the SDK's background mode
 * (`run_in_background: true` + short `timeout`). The SDK already supports
 * this (BashInput.run_in_background, BashInput.timeout, BashOutput.backgroundTaskId,
 * BashOutput.timedOutAfterMs, BashOutput.interrupted) and the renderer
 * already renders the resulting backgroundTaskId (BashTool.tsx + bashTranscript.ts).
 * The only thing missing is a hook that auto-applies this for the
 * never-return-shaped patterns below. We use SDK 0.3.234's
 * `PreToolUseHookSpecificOutput.updatedInput` to inject the background shape
 * transparently and `additionalContext` to teach the model that long
 * shell-invoked Playwright / Chromium / browser-binary commands MUST set
 * `run_in_background: true`.
 *
 * FIX EVOLUTION
 * -------------
 * v1 (deny-only): The hook called `permissionDecision: 'deny'` and returned
 *                 a redirect message. Returning control to the model made
 *                 it re-emit the same sync command the next turn — it
 *                 learned nothing and the user still hung.
 * v2 (this module): The hook calls `updatedInput: { ...original,
 *                  run_in_background: true, timeout: 30000 }` and
 *                  `additionalContext` so the command actually runs in
 *                  background. The model also sees why its next attempt
 *                  should keep the flag set, so the pattern propagates.
 *
 * LIMITATION (deliberate, documented)
 * ----------------------------------
 * The hook sees only the Bash command string. A command like
 * `node /tmp/probe.cjs` whose cjs source internally calls
 * `chromium.launchPersistentContext` is INVISIBLE to the shell-level matcher —
 * we see no `playwright` / `chromium` token in the command line. The async
 * {@link decideScriptFileBashTransform} path closes exactly this gap: it
 * extracts the `node <script>` argument from the command, reads the file
 * (bounded, fail-open), and applies the same background transform when the
 * source references Playwright / Puppeteer / chromium.launch. Commands whose
 * script cannot be read (relative path without a `cd`, missing file, >256KB)
 * still fall through — fail-open, never a false positive that breaks a plain
 * `node build.js`.
 */

export interface PlaywrightBashTransformInput {
  toolName: string;
  /**
   * Original BashInput fields verbatim. We must merge over this so we don't
   * drop fields the model already set (command, description). Hook layer reads
   * this from `PreToolUseHookInput.tool_input`.
   */
  originalInput: Record<string, unknown>;
}

export interface PlaywrightBashTransformDecision {
  shouldTransform: boolean;
  reason: PlaywrightBashTransformReason | null;
  /**
   * New BashInput merged over `originalInput`. Null when `shouldTransform` is
   * false. The hook layer reads this and writes it to
   * `PreToolUseHookSpecificOutput.updatedInput`.
   */
  updatedInput: Record<string, unknown> | null;
  /**
   * additionalContext delivered to the model (rendered via
   * PreToolUseHookSpecificOutput.additionalContext). Null when
   * `shouldTransform` is false.
   */
  additionalContext: string | null;
}

export type PlaywrightBashTransformReason =
  | 'npx-playwright-invocation'
  | 'playwright-cli-subcommand'
  | 'chromium-binary-invocation'
  | 'chrome-exe-invocation'
  | 'msedge-exe-invocation'
  | 'script-file-playwright-usage';

/**
 * Background-mode cap. SDK 0.3.234 BashInput.timeout is bounded at 600000
 * (10 min). 30s is enough to detect a hung headed-Chromium on first try;
 * the SDK will auto-background and surface `BashOutput.timedOutAfterMs` if the
 * command is still running.
 */
const AUTO_BACKGROUND_TIMEOUT_MS = 30_000;

const ADDITIONAL_CONTEXT_PREFIX =
  '[hamuna:auto-background] SDK Bash tool force-backgrounded this call to avoid hanging the desktop session';

/**
 * Shared background-transform builder for every reason. Preserves whatever
 * fields the model set (command, description, etc.) and overrides only the two
 * background-mode knobs. The additionalContext string is intentionally the
 * same for all reasons — see the "single canonical additionalContext" test.
 */
function buildBackgroundTransform(originalInput: Record<string, unknown>): {
  updatedInput: Record<string, unknown>;
  additionalContext: string;
} {
  const updatedInput: Record<string, unknown> = {
    ...originalInput,
    run_in_background: true,
    timeout: AUTO_BACKGROUND_TIMEOUT_MS,
  };
  const additionalContext =
    `${ADDITIONAL_CONTEXT_PREFIX}. ` +
    `Bash tool commands that drive Playwright / Chromium — including \`npx playwright\`, ` +
    `\`playwright test\`, and direct \`chrome.exe\` / \`msedge.exe\` / \`chromium\` invocations — ` +
    `must set \`run_in_background: true\` (and a sane \`timeout\`) so the desktop UI never blocks ` +
    `on a hanging browser process. The configured \`mcp__playwright__*\` MCP tools already pick ` +
    `up the user's chosen default browser, persistent profile, and device presets from Settings → ` +
    `Toolbox; prefer them over spawning your own chromium binary. Result will arrive as a ` +
    `backgroundTaskId in BashOutput; \`cat /tmp/<taskId>.output\` or wait for \`task-notification\` ` +
    `to stream output back.`;
  return { updatedInput, additionalContext };
}

/**
 * Decide whether to force-background a Bash tool call. Returns a Hook-shaped
 * decision: when `shouldTransform` is true, the hook layer mirrors the
 * `updatedInput` / `additionalContext` fields directly into
 * `PreToolUseHookSpecificOutput`.
 */
export function decidePlaywrightBashTransform(
  input: PlaywrightBashTransformInput,
): PlaywrightBashTransformDecision {
  if (input.toolName !== 'Bash') {
    return { shouldTransform: false, reason: null, updatedInput: null, additionalContext: null };
  }
  const cmd = input.originalInput.command;
  if (typeof cmd !== 'string' || cmd.length === 0) {
    return { shouldTransform: false, reason: null, updatedInput: null, additionalContext: null };
  }
  const reason = matchPlaywrightRedirectReason(cmd);
  if (!reason) {
    return { shouldTransform: false, reason: null, updatedInput: null, additionalContext: null };
  }
  const { updatedInput, additionalContext } = buildBackgroundTransform(input.originalInput);
  return {
    shouldTransform: true,
    reason,
    updatedInput,
    additionalContext,
  };
}

/**
 * Pure-pattern match: returns the redirect reason if the bash command string
 * is a known shell-level Playwright / Chromium invocation. Split out from
 * {@link decidePlaywrightBashTransform} so unit tests can pin the regex
 * semantics independently of the surrounding merge / message logic.
 */
function matchPlaywrightRedirectReason(cmd: string): PlaywrightBashTransformReason | null {
  // npx playwright / pnpm playwright / yarn playwright / node ./.../playwright/...
  if (/\b(?:npx|pnpm(?:\s+\w+)?|yarn(?:\s+\w+)?)\s+[^|;&\n]*\bplaywright\b/i.test(cmd)) {
    return 'npx-playwright-invocation';
  }
  // `playwright test`, `playwright install`, `playwright codegen`, etc.
  if (/\bplaywright\s+(?:test|install|codegen|show-trace|init|debug|run-server|open)\b/i.test(cmd)) {
    return 'playwright-cli-subcommand';
  }
  // Browser-binary invocations, anchored so `chromium-snapshots/` etc. don't match.
  if (/(?:^|[\s/\\])chromium(?:-browser)?(?:\s|$)/i.test(cmd)) {
    return 'chromium-binary-invocation';
  }
  if (/\bchrome\.exe\b/i.test(cmd)) {
    return 'chrome-exe-invocation';
  }
  if (/\bmsedge\.exe\b/i.test(cmd)) {
    return 'msedge-exe-invocation';
  }
  return null;
}

// ── Script-file scan (async extension of the shell-level matcher) ──────────
// Closes the documented LIMITATION: `node /tmp/probe.cjs` whose source calls
// `chromium.launchPersistentContext` shows no playwright token in argv. We
// read the referenced script and apply the same background transform when it
// uses Playwright / Puppeteer / Chromium. Fail-open on every edge (no script
// arg, unreadable, >scan cap, no match) so plain `node build.js` is never
// touched.

const MAX_SCRIPT_SCAN_BYTES = 256 * 1024;

export type ReadFileFn = (path: string) => Promise<string>;

const defaultReadFile: ReadFileFn = async (path) => {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
};

const NO_TRANSFORM: PlaywrightBashTransformDecision = {
  shouldTransform: false,
  reason: null,
  updatedInput: null,
  additionalContext: null,
};

/**
 * Extract `node <script>` file arguments (.cjs / .mjs / .js) from a Bash
 * command line. Skips paths inside `node_modules` (the `NODE_PATH=` env prefix
 * and `node_modules/...` dirs are the exact false-positive shape). Pure —
 * pinned by unit tests.
 */
export function extractNodeScriptPaths(command: string): string[] {
  const paths: string[] = [];
  const re = /\bnode\s+(?:--[a-z-]+(?:\s*=\s*\S+)?\s+)*("(?:[^"]+\.(?:cjs|mjs|js))"|'(?:[^']+\.(?:cjs|mjs|js))'|([^\s"'&;|]+\.(?:cjs|mjs|js)))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    const p = raw.trim().replace(/^["']|["']$/g, '');
    if (!p || p.includes('node_modules')) continue;
    paths.push(p);
  }
  return paths;
}

/** True when the script source references Playwright / Puppeteer / Chromium. Pure. */
export function scanScriptForPlaywrightUsage(content: string): boolean {
  return /playwright|puppeteer|launchPersistentContext|chromium\s*\.\s*launch/i.test(content);
}

/** MSYS `/c/...` → `C:\...`; Windows paths pass through; relative → null unless a `cd` prefix gives a base. */
function normalizeScriptPath(p: string, command: string): string | null {
  const msys = /^\/([a-zA-Z])\//.exec(p);
  if (msys) return `${msys[1].toUpperCase()}:${p.slice(2).replace(/\//g, '\\')}`;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return p;
  const cd = /(?:^|[;&|]\s*)cd\s+"?([^"&\n;]+?)"?\s*(?:&&|;|$)/.exec(command);
  if (cd) {
    const base = normalizeScriptPath(cd[1].trim(), '') ?? cd[1].trim();
    return join(base, p);
  }
  return null;
}

/**
 * Async decision core: shell-level miss → scan the referenced script file.
 * Returns the same background transform shape when the script source uses
 * Playwright / Puppeteer / Chromium, otherwise no-transform (fail-open).
 */
export async function decideScriptFileBashTransform(
  input: PlaywrightBashTransformInput,
  readFileFn: ReadFileFn = defaultReadFile,
): Promise<PlaywrightBashTransformDecision> {
  if (input.toolName !== 'Bash') return NO_TRANSFORM;
  const cmd = input.originalInput.command;
  if (typeof cmd !== 'string' || cmd.length === 0) return NO_TRANSFORM;
  for (const p of extractNodeScriptPaths(cmd)) {
    const resolved = normalizeScriptPath(p, cmd);
    if (!resolved) continue;
    let content: string;
    try {
      content = (await readFileFn(resolved)).slice(0, MAX_SCRIPT_SCAN_BYTES);
    } catch {
      continue; // unreadable → fail open
    }
    if (scanScriptForPlaywrightUsage(content)) {
      const { updatedInput, additionalContext } = buildBackgroundTransform(input.originalInput);
      return {
        shouldTransform: true,
        reason: 'script-file-playwright-usage' as const,
        updatedInput,
        additionalContext,
      };
    }
  }
  return NO_TRANSFORM;
}
