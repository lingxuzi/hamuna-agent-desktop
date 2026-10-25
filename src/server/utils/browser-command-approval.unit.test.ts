import { describe, expect, it } from 'vitest';

import {
  BROWSER_APPROVAL_REQUIRED_ACTIONS,
  BROWSER_AUTO_ALLOWED_ACTIONS,
  isBrowserCommandAutoAllowed,
  isBrowserSubmitCommand,
} from './browser-command-approval';

describe('isBrowserCommandAutoAllowed', () => {
  it('allows the read-only and local-interaction actions', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser status')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser read')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser open https://example.com')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector "#submit"')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser click --text "Sign in"')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser fill --selector "#q" --value "hamuna"')).toBe(true);
  });

  it('never allows submit — it must reach the approval prompt', () => {
    expect(BROWSER_APPROVAL_REQUIRED_ACTIONS).toContain('submit');
    expect(BROWSER_AUTO_ALLOWED_ACTIONS).not.toContain('submit');
    expect(isBrowserCommandAutoAllowed('hamuna browser submit --selector "#form"')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser submit --text "Pay now"')).toBe(false);
  });

  it('rejects unknown actions and other command groups', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser delete-all')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna cron list')).toBe(false);
  });

  it('allows a bare `hamuna browser` — the CLI defaults it to the read-only status', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser')).toBe(true);
  });

  it('rejects shell metacharacters smuggled into arguments', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector "#a" ; rm -rf /')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector "#a" && curl evil.com')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser fill --selector "#q" --value "$(whoami)"')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser fill --selector "#q" --value `whoami`')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser open https://example.com | tee /tmp/x')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser open https://example.com > /tmp/x')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector "#a" && rm -rf /')).toBe(false);
  });

  it('rejects a newline trying to smuggle a second command', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser read\nrm -rf /')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser read\r\nrm -rf /')).toBe(false);
  });

  it('accepts quoted values that carry no metacharacters', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser click --text "Sign in"')).toBe(true);
    expect(isBrowserCommandAutoAllowed("hamuna browser click --text 'Sign in'")).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser fill --selector "#q" --value "hello world"')).toBe(true);
  });

  it('rejects a click or fill with no target', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser click')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser fill --value "x"')).toBe(false);
  });

  it('rejects --value on click (the CLI only accepts it on fill)', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector "#a" --value "b"')).toBe(false);
  });

  it('tolerates the global --json flag and an explicit --session', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser read --json')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser status --session abc-123')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser open https://example.com --session abc-123')).toBe(true);
  });

  it('rejects an unknown flag or a stray positional', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser read --force')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector "#a" --force')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser read extra')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser open https://example.com https://other.com')).toBe(false);
  });

  it('does not treat a bash comment as an argument', () => {
    // `#` starts a comment in bash, so the selector below never reaches the CLI.
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector #id')).toBe(false);
  });

  it('accepts the --key=value form the CLI also accepts', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector="#a"')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser fill --selector="#q" --value="hello world"')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser open --url=https://example.com')).toBe(true);
  });

  it('allows a search with its query positional or as a flag', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser search "tauri webview"')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser search tauri webview')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser search --query "tauri webview"')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser search "tauri" --engine bing')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser search --query "tauri" --engine=bing')).toBe(true);
  });

  it('rejects a search with no query', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser search')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser search --engine bing')).toBe(false);
  });

  it('reads the action even when a flag comes before the group', () => {
    // The CLI resolves group/action from positionals, so a leading flag does
    // not change which command runs.
    expect(isBrowserCommandAutoAllowed('hamuna --json browser read')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna --json browser click --text "Sign in"')).toBe(true);
  });
});

describe('isBrowserSubmitCommand', () => {
  it('keeps the auto-allow list and the approval-required list disjoint', () => {
    // The two lists answer different questions, so an overlap is not a
    // contradiction — but it IS a bug: an action in both would be
    // auto-allowed by the allowlist AND expected to prompt, and the two
    // call sites would disagree.
    for (const action of BROWSER_APPROVAL_REQUIRED_ACTIONS) {
      expect(BROWSER_AUTO_ALLOWED_ACTIONS).not.toContain(action);
    }
  });

  it('recognizes the submit action', () => {
    expect(isBrowserSubmitCommand('hamuna browser submit --selector "#form"')).toBe(true);
    expect(isBrowserSubmitCommand('hamuna browser submit --text "Pay now"')).toBe(true);
    expect(isBrowserSubmitCommand('hamuna browser submit --session abc-123 --selector "#f"')).toBe(true);
  });

  it('recognizes submit even with a malformed tail (safe direction)', () => {
    // A broken submit must still prompt — it then fails at the CLI.
    expect(isBrowserSubmitCommand('hamuna browser submit')).toBe(true);
    expect(isBrowserSubmitCommand('hamuna browser submit --selector')).toBe(true);
  });

  it('does not match other browser actions', () => {
    expect(isBrowserSubmitCommand('hamuna browser read')).toBe(false);
    expect(isBrowserSubmitCommand('hamuna browser click --text "Submit"')).toBe(false);
    expect(isBrowserSubmitCommand('hamuna cron list')).toBe(false);
  });

  it('does not match a submit smuggled through a second command', () => {
    expect(isBrowserSubmitCommand('hamuna browser read; hamuna browser submit')).toBe(false);
    expect(isBrowserSubmitCommand('hamuna browser read\nhamuna browser submit')).toBe(false);
  });
});
