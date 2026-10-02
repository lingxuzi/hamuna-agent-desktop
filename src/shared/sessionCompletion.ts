import type { SessionOrigin } from './session-origin';

export type SessionCompletionStatus = 'complete' | 'stopped' | 'error';

/**
 * Turn 的归属者，**单一真源**。
 *
 * 之前这个结构在 `shared/sessionCompletion.ts` 与 `server/session-core/turn-queue.ts`
 * 各写了一份内联字面量。加一个 `kind` 时 TS 只会在**其中一份**上报错，另一份
 * 静默保持旧联合类型 —— 那种"改了一半"的类型不匹配往往要到运行时才炸成难诊断
 * 的行为分叉。放在 `shared/` 是因为完成事件要跨进程（server → renderer）传递，
 * `shared` 才是两端都能 import 而不违反依赖边界的位置。
 */
export type TurnOwner = {
  /**
   * `agent` 是 MiniApp 隐藏会话的 owner（`app.agent.*`）。需要独立于 task/goal
   * 是因为**精确停止**：一个 MiniApp 取消自己的 turn 不能连带打断同进程里的其它
   * turn，而 `stopOwnedTurn` 靠 `(kind, id)` 配对定位。
   */
  kind: 'goal' | 'task' | 'agent';
  id: string;
};

export type SessionCompletionTerminal = Readonly<{
  sessionId: string;
  workspacePath: string;
  turnId: string;
  turnOwner?: Readonly<TurnOwner>;
  origin: SessionOrigin;
  status: SessionCompletionStatus;
}>;

export function withSessionCompletionTerminal(
  payload: unknown,
  completionTerminal: SessionCompletionTerminal | null,
): unknown {
  if (!completionTerminal) return payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...payload, completionTerminal };
  }
  if (typeof payload === 'string') {
    return { message: payload, completionTerminal };
  }
  return { completionTerminal };
}
