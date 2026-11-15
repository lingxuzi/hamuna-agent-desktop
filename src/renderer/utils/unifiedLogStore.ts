/**
 * 统一日志列表的单一权威数据源。
 *
 * **为什么不能是一份 React state**：日志有三个源头——renderer 的 `console.*`、
 * Rust 事件、SSE 的 `chat:log`——其中 `console.*` 是**副作用**触发的：React
 * 自己在渲染过程中报重复 key、报渲染期更新，都会打一条 `console.error`。如果
 * 这份列表住在包住整个聊天界面的 Provider 里，链条就成了
 * 「日志 → 界面重渲染 → 又产生一条日志 → 界面再重渲染 → …」，
 * 主线程被钉死，界面彻底卡住（v0.2.35「点方向整个 app 卡死」）。
 *
 * 所以分工是：**数据归 store，显示归叶子组件**。日志面板自己订阅 store，
 * 一条日志最多让日志面板重渲染一次，碰不到产生它的那块界面。
 *
 * 通知走微任务而不是同步：`console.*` 可能在别人的渲染过程中被调用，同步
 * 通知会让订阅者在渲染中途 setState（React 会报 "Cannot update a component
 * while rendering a different component"）。微任务保序——先改的先到叶子。
 */

import type { LogEntry } from '@/types/log';

/** 内存里最多留多少条。超出丢最旧的。 */
const MAX_ENTRIES = 3000;

let entries: LogEntry[] = [];

type UnifiedLogListener = () => void;

const listeners = new Set<UnifiedLogListener>();

/**
 * 追加一条日志。
 *
 * `tabId` 只在条目自己没带归属时生效：SSE 的 `chat:log` 是「这个 tab 的
 * sidecar 报上来的」，得归到这个 tab；Rust 与全局的 console 日志没有归属，
 * 保持无 tabId，于是每个 tab 的面板都能看到（与旧实现一致）。
 */
export function appendUnifiedLog(entry: LogEntry, tabId?: string): void {
    const stamped: LogEntry = entry.tabId || !tabId ? entry : { ...entry, tabId };
    entries = entries.length >= MAX_ENTRIES
        ? [...entries.slice(-(MAX_ENTRIES - 1)), stamped]
        : [...entries, stamped];
    notifyAll();
}

function notifyAll(): void {
    queueMicrotask(() => {
        for (const listener of listeners) {
            try {
                listener();
            } catch {
                /* 订阅者出错不能影响其他订阅者 */
            }
        }
    });
}

/** 清空整份列表（日志面板上的「清空」）。 */
export function clearUnifiedLogs(): void {
    entries = [];
    notifyAll();
}

/**
 * 只清这个 tab 自己的条目，别的 tab 的与全局的留着（会话重置时用）。
 *
 * 不复用 `clearUnifiedLogs(tabId?)` 那种可选参数式双语义：调用点读到参数
 * 是变量时猜不出走的是哪一条。
 */
export function clearUnifiedLogsForTab(tabId: string): void {
    entries = entries.filter((e) => e.tabId !== tabId);
    notifyAll();
}

/** 当前列表的副本。订阅者只读，不该拿到内部数组本身。 */
export function snapshotUnifiedLogs(): LogEntry[] {
    return entries.slice();
}

/**
 * 订阅列表变化。返回退订函数。
 *
 * 通知是异步的（微任务），所以订阅者自己要在订阅时先取一次快照——否则
 * 「渲染时产生的那条日志」会落在「订阅建立」之前，被漏掉。
 */
export function subscribeUnifiedLogs(listener: UnifiedLogListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
