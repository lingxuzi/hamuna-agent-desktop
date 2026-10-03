import { renderHook } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';

import { useMiniAppClaimAdoption } from './useMiniAppClaimAdoption';
import type { SimpleChatInputHandle } from '@/components/chat-input/types';
import type { MiniAppClaimIntent } from '@/types/tab';

/**
 * 合成器只暴露三个被用到的方法，其余用 cast 补掉——这里要验的是"草稿有没有
 * 正确落进合成器"，不是 ref 的类型完整性。
 */
function makeInput(initial: string) {
  let value = initial;
  return {
    getCurrentValue: () => value,
    setValue: vi.fn((v: string) => {
      value = v;
    }),
    focus: vi.fn(),
  };
}

const CLAIM: MiniAppClaimIntent = { id: 'claim-1', appId: 'todo-app', draft: '把待办清单做出来' };

function run(pending: MiniAppClaimIntent | undefined, input: ReturnType<typeof makeInput> | null) {
  const success = vi.fn();
  const onConsumed = vi.fn();
  renderHook(() =>
    useMiniAppClaimAdoption({
      pendingMiniAppClaim: pending,
      chatInputRef: { current: input } as unknown as MutableRefObject<SimpleChatInputHandle | null>,
      toastRef: { current: { success } },
      t: ((key: string, opts?: { appId: string }) => `${key}#${opts?.appId ?? ''}`) as unknown as TFunction,
      onMiniAppClaimConsumed: onConsumed,
    }),
  );
  return { success, onConsumed, input };
}

describe('Bubble Claim 采纳：草稿必须落进合成器', () => {
  it('空合成器 → 正好是草稿本身，前面不留空行', () => {
    const input = makeInput('');
    run(CLAIM, input);
    expect(input.setValue).toHaveBeenCalledWith('把待办清单做出来');
  });

  it('已有内容 → 原内容在前、换行、草稿在后（原内容一个字符都不能丢）', () => {
    const input = makeInput('我先问一句');
    run(CLAIM, input);
    expect(input.setValue).toHaveBeenCalledWith('我先问一句\n把待办清单做出来');
  });

  it('只有空白 → 当成空合成器，否则用户会先看到一个空行再看到草稿', () => {
    const input = makeInput('   \n  ');
    run(CLAIM, input);
    expect(input.setValue).toHaveBeenCalledWith('把待办清单做出来');
  });

  it('草稿自带换行要原样保留，不能被压成一行', () => {
    const input = makeInput('');
    const multi = { ...CLAIM, draft: '第一行\n第二行' };
    run(multi, input);
    expect(input.setValue).toHaveBeenCalledWith('第一行\n第二行');
  });

  it('只提议不代发：聚焦合成器、提示用户，然后才回报已消费', () => {
    const input = makeInput('');
    const { success, onConsumed } = run(CLAIM, input);
    expect(input.focus).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('shell.toasts.miniappClaimReceived#todo-app');
    expect(onConsumed).toHaveBeenCalledWith('claim-1');
  });

  it('合成器没挂载 → 整条链路一步都不走（intent 留在 tab 上等下一次激活）', () => {
    const { success, onConsumed } = run(CLAIM, null);
    expect(success).not.toHaveBeenCalled();
    expect(onConsumed).not.toHaveBeenCalled();
  });

  it('没有待处理的 claim → 什么都不做', () => {
    const input = makeInput('');
    const { success, onConsumed } = run(undefined, input);
    expect(input.setValue).not.toHaveBeenCalled();
    expect(input.focus).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(onConsumed).not.toHaveBeenCalled();
  });

  it('附件不在这里落地：skill 教作者传 attachments，但采纳它等于替 MiniApp 打开投递通道', () => {
    const input = makeInput('');
    const withAttachments: MiniAppClaimIntent = {
      ...CLAIM,
      attachments: [{ kind: 'file', path: '/etc/passwd', label: 'x' }],
    };
    run(withAttachments, input);
    // 草稿照常落地；附件既不被写进合成器，也不会静默混进别的地方。
    expect(input.setValue).toHaveBeenCalledWith('把待办清单做出来');
    expect(input.setValue).toHaveBeenCalledTimes(1);
  });
});
