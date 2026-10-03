import { useEffect, type MutableRefObject } from 'react';
import type { TFunction } from 'i18next';
import type { SimpleChatInputHandle } from '@/components/chat-input/types';
import type { MiniAppClaimIntent } from '@/types/tab';

/**
 * Bubble Claim 的最后一段链路：MiniApp iframe → SceneTab → App → **这里** → 合成器。
 *
 * 单独抽成 hook 不是为了好看，而是因为这是整条链路上唯一没有测试的一环：
 * `Chat.tsx` 有六千多行且从来没有被渲染过，iframe→SceneTab→App 那一段也已经有
 * dom 覆盖，缺的正好是"草稿真的落进合成器、并且只落一次"这条不变量。
 * 合成器是一��� ref，正文里塞了 `getCurrentValue` / `setValue` / `focus` /
 * toast / 通知父组件五个副作用，直接渲染宿主测不动。
 *
 * 信任规则与 Bubble Claim 本身一致：MiniApp **只能提议**，采纳与否由用户决定，
 * 所以这里只往合成器里放文本、聚焦、提示，绝不自动发送。
 *
 * `attachments` 不在这里消费：类型上它存在（`MiniAppClaimIntent`），skill 文档
 * 也教作者传，但采纳它等于替 MiniApp 打开一条往 Chat 投递文件的通道，信任边界
 * 尚未定；先保持原样，等边界决定后再动。
 */
export function useMiniAppClaimAdoption(params: {
  pendingMiniAppClaim: MiniAppClaimIntent | undefined;
  chatInputRef: MutableRefObject<SimpleChatInputHandle | null>;
  toastRef: MutableRefObject<{ success: (message: string) => void } | undefined>;
  t: TFunction;
  onMiniAppClaimConsumed?: (intentId: string) => void;
}): void {
  const { pendingMiniAppClaim, chatInputRef, toastRef, t, onMiniAppClaimConsumed } = params;

  useEffect(() => {
    if (!pendingMiniAppClaim) return;
    const intent = pendingMiniAppClaim;
    const input = chatInputRef.current;
    if (!input) {
      // The composer isn't mounted. Don't consume — the intent stays on the
      // tab, so a later activation can still pick it up.
      console.warn('[Chat] MiniApp claim arrived before the composer mounted; deferring.');
      return;
    }
    // Adopt the MiniApp's draft rather than sending it: the MiniApp may only
    // ever propose, the user decides. Same trust rule as Bubble Claim itself.
    const existing = input.getCurrentValue();
    input.setValue(existing.trim() ? `${existing}\n${intent.draft}` : intent.draft);
    input.focus();
    toastRef.current?.success(t('shell.toasts.miniappClaimReceived', { appId: intent.appId }));
    onMiniAppClaimConsumed?.(intent.id);
  }, [pendingMiniAppClaim, chatInputRef, toastRef, t, onMiniAppClaimConsumed]);
}
