/**
 * `hamuna browser …` command approval policy — pure decision core.
 *
 * WHY THIS EXISTS
 * ---------------
 * The `hamuna browser` family drives the user's own embedded browser panel
 * (the window in front of them, not a headless browser). Read-only actions
 * (`status` / `open` / `read`) and local interactions (`click`, `fill`) are
 * cheap and reversible enough to run unattended — otherwise every "查一下这个
 * 网页" turn burns a permission modal and the user stops trusting the feature.
 *
 * `submit` is different: it fires a form's `requestSubmit()`, which can place
 * an order, publish a post, or send a message to another person. That is an
 * externally-visible side effect, so it MUST reach the normal `canUseTool`
 * approval prompt — the user sees the command and decides.
 *
 * `publish` is the same kind of action with one addition: it names the target
 * platform (`--platform <id>`). That lets the gate honour a standing grant the
 * user set per platform in Settings — "post to Douyin without asking me every
 * time" — while every other platform still prompts. The grant is written by the
 * Settings UI only; `hamuna config set` cannot grant it, so an agent cannot
 * authorize itself.
 *
 * TWO INDEPENDENT QUESTIONS, TWO FUNCTIONS
 * ----------------------------------------
 * "May this run unattended?" (`isBrowserCommandAutoAllowed`) and "must this
 * reach the approval prompt?" (`isBrowserSubmitCommand`) are NOT the same
 * claim, and deriving one from the other is a trap:
 *
 * The user can grant Bash a session-wide "always allow" from the permission
 * card, and that grant is keyed by TOOL NAME — so a submit that merely falls
 * out of the allowlist would still be swallowed by the session grant. The
 * submit check therefore lives in its own function and is evaluated at a point
 * where the session grant cannot reach it.
 *
 * Known ceiling (product decision, not an oversight): `click` is auto-allowed,
 * so a click on a page whose button submits a form is technically a side
 * effect too. The product decision is "prompt only for the explicit submit
 * verb"; tightening it to "prompt for any click that could submit" would need
 * DOM-level knowledge of the target, which the CLI layer does not have.
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * The allowlist in agent-session.ts is a wall of inline regexes. Each entry
 * encodes a security boundary ("this may run unattended"), so it needs to be
 * reviewable and unit-testable on its own. This module is the pure decision
 * core (no I/O → fast `unit` pool); agent-session.ts keeps only the
 * imperative shell (the log line + the allow return).
 */

/**
 * Browser sub-commands that may run without an approval prompt.
 *
 * `submit` and `publish` are intentionally absent — see the module doc.
 */
export const BROWSER_AUTO_ALLOWED_ACTIONS = ['status', 'state', 'list', 'open', 'navigate', 'read', 'search', 'click', 'scroll', 'fill', 'upload', 'fields'] as const;

/**
 * The browser actions that need the user's explicit approval.
 *
 * Kept as an exported constant (not just a comment) so the skill doc, the CLI
 * help, and this policy can be checked against each other.
 *
 * This list is the SOURCE of truth for the approval gate —
 * `isBrowserApprovalRequiredCommand` consults it, so adding an action here
 * immediately makes it prompt even when it is also in
 * `BROWSER_AUTO_ALLOWED_ACTIONS`.
 *
 * `publish` sits here next to `submit` because it is the same kind of action:
 * an externally-visible post on a platform's creator backend. The difference is
 * that `publish` carries a platform id, so the gate can honour a standing
 * per-platform grant the user set in Settings (unattended publishing for the
 * platforms the user explicitly opted into) instead of prompting every time.
 */
export const BROWSER_APPROVAL_REQUIRED_ACTIONS = ['submit', 'publish'] as const;

/** 需要审批的 browser 动作名。 */
export type BrowserApprovalRequiredAction = (typeof BROWSER_APPROVAL_REQUIRED_ACTIONS)[number];

function isBrowserApprovalRequiredAction(action: string): action is BrowserApprovalRequiredAction {
  return (BROWSER_APPROVAL_REQUIRED_ACTIONS as readonly string[]).includes(action);
}

/** A parsed argv token. */
interface CmdToken {
  value: string;
}

/**
 * Shell metacharacters. Unquoted, they change what bash runs; the tokenizer
 * refuses to accept a bare token containing any of them.
 */
const SHELL_METACHARS = new Set([';', '|', '&', '>', '<', '(', ')', '$', '`', '\\', '"', "'"]);

/**
 * Split a command into argv the way bash would, or `null` when the command
 * contains something we can't prove is inert.
 *
 * Accepted:
 *   - bare tokens of non-space, non-metachar characters,
 *   - single-quoted strings (bash expands nothing inside — safe verbatim),
 *   - double-quoted strings WITHOUT `$`, backtick or `\` (those still expand
 *     inside double quotes, so they are refused).
 *
 * Quotes are REMOVED from the resulting token, matching bash's quote
 * removal: `--selector="#a"` and `--selector #a` produce the same argv.
 *
 * A `#` at the start of a word starts a bash comment, so everything from there
 * on is dropped — modelling that keeps the structural check honest (a
 * `hamuna browser click --selector #id` would otherwise look like it has a
 * value while bash actually truncates the line).
 *
 * Newlines always fail: `hamuna browser read\nrm -rf /` would run the second
 * line as an unrelated command while the allowlist only ever saw the first.
 */
function tokenize(command: string): CmdToken[] | null {
  const tokens: CmdToken[] = [];
  let i = 0;

  while (i < command.length) {
    const ch = command[i];
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') return null;
    if (ch === '#') break; // comment to end of line

    let value = '';

    while (i < command.length) {
      const c = command[i];
      if (c === ' ' || c === '\t') break;
      if (c === '\n' || c === '\r') return null;

      if (c === '"' || c === "'") {
        // Quoted section inside a bare token — bash strips the quotes and
        // keeps the content verbatim (no expansion inside single quotes).
        const quote = c;
        i += 1;
        let quoted = '';
        let quoteClosed = false;
        while (i < command.length) {
          const q = command[i];
          if (q === '\n' || q === '\r') return null;
          if (q === quote) {
            i += 1;
            quoteClosed = true;
            break;
          }
          if (quote === '"' && (q === '$' || q === '`' || q === '\\')) return null;
          quoted += q;
          i += 1;
        }
        if (!quoteClosed) return null;
        value += quoted;
        continue;
      }

      if (SHELL_METACHARS.has(c)) return null;
      value += c;
      i += 1;
    }
    tokens.push({ value });
  }

  return tokens;
}

/** The CLI's `parseArgs` output shape: positionals + a flag map. */
interface CliArgs {
  positional: string[];
  /** Flag value is `true` when the flag arrived without one (CLI: "missing value"). */
  flags: Map<string, string | true>;
}

/**
 * Split argv into positionals and flags, mirroring the CLI's own `parseArgs`.
 *
 * The CLI reads `group = positional[0]` and `action = positional[1]`, so a
 * flag appearing BEFORE the group (`hamuna --json browser read`) still resolves
 * to the `browser read` command. Replicating the split here keeps the
 * approval policy in step with what the CLI actually executes — the whole
 * point of the check is to describe the command that will run.
 */
function splitCliArgs(tokens: CmdToken[]): CliArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i].value;
    if (!token.startsWith('--')) {
      positional.push(token);
      i += 1;
      continue;
    }

    const raw = token.slice(2);
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      flags.set(raw.slice(0, eq), raw.slice(eq + 1));
      i += 1;
      continue;
    }

    // `--json` is a presence-only flag in the CLI.
    if (raw === 'json') {
      flags.set(raw, true);
      i += 1;
      continue;
    }

    // Key-value flags consume the next token unless it is another flag.
    const next = tokens[i + 1];
    if (next === undefined || next.value.startsWith('--')) {
      flags.set(raw, true);
      i += 1;
      continue;
    }
    flags.set(raw, next.value);
    i += 2;
  }

  return { positional, flags };
}

/**
 * Flags accepted on EVERY browser command, carrying no action semantics.
 *
 * `--json` selects the output format; `--session` scopes which browser
 * session the command targets. Neither changes what the command does, so
 * they are stripped before the action-specific shape check.
 */
const GLOBAL_FLAGS = new Set(['json', 'session']);

/** Drop the global flags, leaving only the action-specific ones. */
function actionFlags(flags: Map<string, string | true>): Map<string, string | true> {
  const out = new Map(flags);
  for (const key of GLOBAL_FLAGS) out.delete(key);
  return out;
}

/**
 * Parse the flag tail of a `click` / `fill` / `submit` command.
 *
 * Returns the collected selector / text / value, or `null` when the tail is
 * not a shape we recognise (unknown flag, missing value, stray positional).
 */
function parseTargetFlags(
  flags: Map<string, string | true>,
  allowValue: boolean,
): { selector?: string; text?: string; value?: string; valueFile?: string } | null {
  const out: { selector?: string; text?: string; value?: string; valueFile?: string } = {};

  for (const [key, value] of flags) {
    if (typeof value !== 'string') return null; // flag arrived without a value
    if (key === 'selector') {
      if (out.selector !== undefined) return null;
      out.selector = value;
    } else if (key === 'text') {
      if (out.text !== undefined) return null;
      out.text = value;
    } else if (key === 'value') {
      if (!allowValue) return null;
      if (out.value !== undefined) return null;
      out.value = value;
    } else if (key === 'value-file') {
      // `--value-file` is fill-only, same as `--value`. It carries a workspace
      // path the CLI reads and inlines, so it is as inert as `--file` on
      // upload: no external side effect until `submit` / `publish`.
      if (!allowValue) return null;
      if (out.valueFile !== undefined) return null;
      out.valueFile = value;
    } else {
      return null; // unknown flag
    }
  }

  // At least one target is required — the CLI exits 2 otherwise.
  if (out.selector === undefined && out.text === undefined) return null;
  return out;
}

/**
 * Match the flag tail of a `scroll` command.
 *
 * Exactly one instruction per call — a distance, an edge, or a target. Two at
 * once would be ambiguous: the CLI drops the loser, and a scroll that quietly
 * did something else looks like a broken page.
 *
 * Returns `false` for any shape the CLI would reject, so the auto-allow check
 * never lets through a command that then fails at the CLI.
 */
function isScrollShape(flags: Map<string, string | true>): boolean {
  const keys = [...flags.keys()];
  if (keys.length !== 1) return false;
  const key = keys[0]!;
  const value = flags.get(key);
  if (typeof value !== 'string') return false; // flag arrived without a value

  if (key === 'selector' || key === 'text') return value.trim().length > 0;
  if (key === 'to') return value === 'top' || value === 'bottom';
  if (key === 'down' || key === 'up') {
    const notches = Number(value.trim());
    return Number.isInteger(notches) && notches > 0;
  }
  if (key === 'delta') {
    const pixels = Number(value.trim());
    return Number.isInteger(pixels) && pixels !== 0;
  }
  return false;
}

/**
 * Split `hamuna browser <action> …` into its action, its remaining
 * positionals, and its flags.
 *
 * Returns `null` when the command is not a `hamuna browser …` invocation, or
 * when its shape contains something we can't parse inertly (newline, unquoted
 * metacharacter, unterminated quote).
 */
function parseBrowserCommand(command: string): { action: string; rest: string[]; flags: Map<string, string | true> } | null {
  const tokens = tokenize(command.trim());
  if (!tokens) return null;

  const args = splitCliArgs(tokens);
  if (args.positional.length < 2) return null;
  if (args.positional[0] !== 'hamuna') return null;
  if (args.positional[1] !== 'browser') return null;

  // The CLI defaults a missing action to 'list' (which routes to
  // `browser/status` — a read-only page-state report).
  const action = args.positional[2] ?? 'list';
  const rest = args.positional.slice(3);
  return { action, rest, flags: actionFlags(args.flags) };
}

/**
 * Match `hamuna browser <action> …` and report whether it may run unattended.
 *
 * Returns `true` only for the auto-allowed actions, with the command
 * structure constrained to the shapes the CLI actually accepts. Anything else —
 * `submit`, an unknown action, an unknown flag, a stray positional, a command
 * containing a newline or an unquoted metacharacter — returns `false` and is
 * handled by the normal permission prompt.
 */
export function isBrowserCommandAutoAllowed(command: string): boolean {
  const parsed = parseBrowserCommand(command);
  if (!parsed) return false;

  const { action, rest, flags } = parsed;
  if (!(BROWSER_AUTO_ALLOWED_ACTIONS as readonly string[]).includes(action)) {
    return false;
  }

  switch (action) {
    case 'status':
    case 'state':
    case 'list':
    case 'read':
    case 'fields':
      return rest.length === 0 && flags.size === 0;

    case 'open':
    case 'navigate': {
      // The URL is positional or `--url <url>`; exactly one of them.
      if (rest.length === 1 && flags.size === 0) return true;
      if (rest.length === 0 && flags.size === 1 && flags.has('url')) {
        return typeof flags.get('url') === 'string';
      }
      return false;
    }

    case 'click':
      return rest.length === 0 && parseTargetFlags(flags, false) !== null;

    case 'scroll':
      // Scrolling moves what the user sees but reaches nothing outside the
      // page — same class as `click` / `fill`: cheap, reversible, no
      // externally-visible effect. It must not burn a permission modal on
      // every "look further down the feed" step.
      return rest.length === 0 && isScrollShape(flags);

    case 'fill':
      return rest.length === 0 && parseTargetFlags(flags, true) !== null;

    case 'upload': {
      // A target plus exactly one `--file <path>`. The file argument is what
      // makes this different from `fill`: it reads bytes off disk and hands
      // them to the page. It stays auto-allowed because the read is bounded
      // by the same path blacklist as every other workspace read (`~/.ssh`,
      // credentials dirs are rejected server-side) and selecting a file in a
      // file input has no external side effect — only `submit` sends it
      // anywhere.
      const file = flags.get('file');
      if (typeof file !== 'string' || file.length === 0) return false;
      const targetFlags = new Map(flags);
      targetFlags.delete('file');
      return rest.length === 0 && parseTargetFlags(targetFlags, false) !== null;
    }

    case 'search': {
      // The query is positional or `--query <text>`; `--engine <name>` may
      // accompany either form. Exactly one source may carry the query —
      // giving both is ambiguous, and the CLI's own precedence (flag wins)
      // would silently drop the positional half.
      const engineOk = !flags.has('engine') || typeof flags.get('engine') === 'string';
      if (!engineOk) return false;
      const queryFlag = flags.get('query');
      const hasQueryFlag = queryFlag !== undefined && typeof queryFlag === 'string';
      const hasPositionalQuery = rest.length >= 1;
      if (hasQueryFlag && hasPositionalQuery) return false;
      if (!hasQueryFlag && !hasPositionalQuery) return false;
      // The only remaining flag may be `--engine`.
      const otherFlags = [...flags.keys()].filter((key) => key !== 'query' && key !== 'engine');
      if (otherFlags.length > 0) return false;
      return true;
    }

    default:
      return false;
  }
}

/**
 * Match `hamuna browser submit …` / `hamuna browser publish …` — the browser
 * actions that need the user's explicit approval.
 *
 * This exists SEPARATELY from `isBrowserCommandAutoAllowed` because "not
 * auto-allowed" and "must prompt" are different claims. The user can grant
 * Bash a session-wide "always allow" from the permission card, and that grant
 * is keyed by TOOL NAME — so a blanket "not in the allowlist" would let a
 * session-level Bash grant silently swallow `submit` too. The gate has to be
 * checked at a point where the session grant cannot reach it.
 *
 * The command shape is matched loosely here on purpose: the point is to
 * recognize "this is a gated action", not to validate it. A malformed one
 * still prompts (and then fails at the CLI), which is the safe direction.
 */
export function isBrowserApprovalRequiredCommand(command: string): boolean {
  return parseBrowserGatedCommand(command) !== null;
}

/** 一个需要审批的 browser 动作。 */
export interface BrowserGatedCommand {
  action: BrowserApprovalRequiredAction;
  /**
   * 发布目标平台。
   *
   * `submit` 没有平台；畸形的 `publish`（`--platform` 缺失或没带值）也没有 ——
   * 这两种情况都照样弹审批，方向是安全的那一侧。
   */
  platform: string | null;
}

/**
 * 解析一条需要审批的 browser 命令。
 *
 * 不是 `hamuna browser …`、或者动作不在 `BROWSER_APPROVAL_REQUIRED_ACTIONS`
 * 里 → 返回 null（这条命令不受本模块管）。
 */
export function parseBrowserGatedCommand(command: string): BrowserGatedCommand | null {
  const parsed = parseBrowserCommand(command);
  if (!parsed) return null;
  if (!isBrowserApprovalRequiredAction(parsed.action)) return null;

  const platform = parsed.action === 'publish' ? parsed.flags.get('platform') : undefined;
  return {
    action: parsed.action,
    platform: typeof platform === 'string' && platform.trim() ? platform.trim() : null,
  };
}
