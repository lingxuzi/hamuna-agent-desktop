/**
 * `classifySdkMessage` —— 判定一条 SDK 消息是补全、错误还是还不是结果。
 *
 * 这里钉的是一个**已经发生过的假成功**：无凭据时 SDK 会发一条
 * `type: 'assistant'` 消息，`content` 里是 `"Not logged in · Please run
 * /login"`，同时带 `is_api_error_message: true` 与 `error:
 * 'authentication_failed'`，`message.model` 是 `<synthetic>`。
 *
 * 旧实现只读 `content`，把那句话当成补全返回 `ok: true`，作者侧看到的是
 * "AI 回答：请先登录"。真实消息形状是在本机实跑一次 Sidecar 打出来的
 * （无凭据的临时 HOME），不是照文档编的 —— 下面的 fixture 就是那次实跑的
 * 原文裁剪。
 */

import { describe, it, expect } from 'vitest';
import { classifySdkMessage } from '../miniapp-ai';

/** 实跑捕获到的认证失败消息。 */
const AUTH_FAILED_MESSAGE = {
  type: 'assistant',
  message: {
    id: 'afa6acb2-6598-4323-ae48-78929f5da887',
    model: '<synthetic>',
    role: 'assistant',
    stop_reason: 'stop_sequence',
    content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
  },
  error: 'authentication_failed',
  is_api_error_message: true,
};

/** 正常补全消息。 */
const NORMAL_MESSAGE = {
  type: 'assistant',
  message: {
    id: 'msg_ok',
    model: 'claude-sonnet-5',
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
  },
};

describe('classifySdkMessage', () => {
  describe('errors must never read as completions', () => {
    it('rejects the captured authentication failure instead of returning its text', () => {
      // 这条就是回归本体：改成读 content 就会返回
      // { kind: 'text', text: 'Not logged in …' }，作者拿到假成功。
      const out = classifySdkMessage(AUTH_FAILED_MESSAGE);

      expect(out.kind).toBe('error');
      if (out.kind !== 'error') throw new Error('expected an error outcome');
      expect(out.message).toContain('authentication_failed');
      // 错误文案本身也要带出去：只给一个 code，作者无法判断该提示登录还是换模型。
      expect(out.message).toContain('Not logged in');
    });

    it('treats is_api_error_message alone as an error, even without an error code', () => {
      const out = classifySdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'upstream exploded' }] },
        is_api_error_message: true,
      });

      expect(out.kind).toBe('error');
    });

    it('treats a bare error string as an error', () => {
      const out = classifySdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'rate limited' }] },
        error: 'rate_limit_error',
      });

      expect(out.kind).toBe('error');
      if (out.kind !== 'error') throw new Error('expected an error outcome');
      expect(out.message).toContain('rate_limit_error');
    });

    it('surfaces an error result message rather than its result text', () => {
      const out = classifySdkMessage({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: 'something broke mid-turn',
      });

      expect(out.kind).toBe('error');
      if (out.kind !== 'error') throw new Error('expected an error outcome');
      expect(out.message).toContain('something broke mid-turn');
    });

    it('falls back to the subtype when an error result carries no text', () => {
      const out = classifySdkMessage({ type: 'result', subtype: 'error_max_turns', is_error: true });

      expect(out.kind).toBe('error');
      if (out.kind !== 'error') throw new Error('expected an error outcome');
      expect(out.message).toContain('error_max_turns');
    });
  });

  describe('completions', () => {
    it('returns the assistant text of a normal message', () => {
      expect(classifySdkMessage(NORMAL_MESSAGE)).toEqual({ kind: 'text', text: 'hello' });
    });

    it('joins multiple text blocks', () => {
      const out = classifySdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      });

      expect(out).toEqual({ kind: 'text', text: 'ab' });
    });

    it('ignores non-text blocks rather than stringifying them', () => {
      const out = classifySdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'ok' }] },
      });

      expect(out).toEqual({ kind: 'text', text: 'ok' });
    });

    it('uses the result field as the authoritative text on a success result', () => {
      expect(classifySdkMessage({ type: 'result', subtype: 'success', is_error: false, result: 'done' }))
        .toEqual({ kind: 'text', text: 'done' });
    });
  });

  describe('not a result yet', () => {
    it.each([
      ['system init', { type: 'system', subtype: 'init' }],
      ['a stream event', { type: 'stream_event', event: { type: 'delta' } }],
      ['an assistant message with no text', { type: 'assistant', message: { content: [] } }],
      ['null', null],
      ['a string', 'nope'],
    ])('reports %s as empty', (_label, message) => {
      expect(classifySdkMessage(message)).toEqual({ kind: 'empty' });
    });
  });
});
