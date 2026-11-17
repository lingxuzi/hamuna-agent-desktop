import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 对话区「发消息」只有一个入口：`dispatchSend`。
 *
 * 这条护栏钉的是一类已经踩过的 bug：运营台点「问 Agent」时直接调了
 * `sendMessage(text)`。`sendMessage` 的 model / permissionMode / providerEnv
 * 全是**可选参数**，省略不等于「保持现状」——
 *
 *   - `permissionMode ?? 'auto'`        → 丢掉用户选的权限模式
 *   - `providerEnv ?? 'subscription'`   → 切回 Anthropic 官方订阅
 *   - `model` 保持 undefined            → 会话里已选的模型不参与本轮
 *
 * 而 `'subscription'` 在 agent-session 的 providerEnv 三态判定里是「显式切回
 * 订阅」，不是「不要改」。所以用户选了第三方 provider 的模型时，运营台一提问
 * 就把会话重启到订阅 provider，模型跟着掉回默认 —— 用户看到的现象就是
 * 「运营面板调用 agent 没有使用当前对话区选择的模型」。
 *
 * 顺带跳过的还有 dispatchSend 里的余额守卫、跨 runtime 守卫、provider 不可用
 * 守卫和队列上限。这些守卫每一个都对应过一次真实事故，绕过去就是静默出错。
 *
 * Chat.tsx 有几百个 hook / Tauri 依赖，jsdom 里挂不起来，所以这条不变量用
 * 源码扫描守住：Chat.tsx 里任何 `sendMessage(` 调用都必须带上模型参数。
 */
describe('Chat 的发送路径', () => {
  const source = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8');

  /** 抓出所有 `sendMessage(` 的实际调用（跳过定义与注释行）。 */
  function sendMessageCalls(): string[] {
    const calls: string[] = [];
    const re = /\bsendMessage\(/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      // 定义处是 `const sendMessage = useCallback(async (\n` —— 它由 TabProvider
      // 提供，不在本文件里；本文件只可能有调用。
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const line = source.slice(lineStart, source.indexOf('\n', match.index));
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      // 取到本次调用的实参全貌（跨行）。
      const args = balancedArgs(source, match.index + 'sendMessage('.length);
      calls.push(args);
    }
    return calls;
  }

  /** 从 `(` 之后开始，按括号配对取实参文本。 */
  function balancedArgs(text: string, start: number): string {
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    return text.slice(start, i - 1);
  }

  it('每次 sendMessage 都显式带上模型，不会退回订阅 provider', () => {
    const calls = sendMessageCalls();
    // 至少要有对话区发送 + /compact 两条（数量变化本身不失败，只做提示用）。
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      // 第二段实参就是 model（sendMessage(text, images, permission, model, …)）。
      // 直接断言「实参里出现 effectiveModel 或 runtimeModel」—— 这两种是
      // 唯一合法的模型来源（内置 / 外部 runtime）。
      expect(args).toMatch(/effectiveModel|runtimeModel/);
    }
  });

  it('运营台「问 Agent」走 dispatchSend，不直连 sendMessage', () => {
    // 运营台那段回调必须调 dispatchSend —— 它是唯一同时带 model /
    // providerRoute / providerEnv 的入口，也是所有发送前守卫的所在。
    const opsBlock = source.slice(source.indexOf('onSendToAgent={(text) => {'));
    const tillEnd = opsBlock.slice(0, opsBlock.indexOf('}}'));
    expect(tillEnd).toContain('dispatchSend(');
    expect(tillEnd).not.toMatch(/sendMessage\(/);
  });

  it('向导里的交接不关运营面板 —— 产出就长在面板里', () => {
    // 向导第 ⑤⑥ 步把活交给 Agent，产出是对标候选 / 选题列表，长在面板里。
    // 关掉面板，人就得自己记走到第几步、回来从哪儿点。
    //
    // 普通的交接（onSendToAgent）**要**关面板：不然用户看到自己的话被面板
    // 盖住，不知道发出去没有。两条路径必须分开，不能是同一个函数。
    const block = source.slice(source.indexOf('const sendToAgentKeepOpsOpen'));
    const body = block.slice(0, block.indexOf(');'));
    expect(body).toContain('dispatchSend(');
    expect(body).not.toContain('setOpsOpen(false)');
  });
});
