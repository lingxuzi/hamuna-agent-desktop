import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LogEntry } from '@/types/log';
import {
  appendUnifiedLog,
  clearUnifiedLogs,
  clearUnifiedLogsForTab,
  snapshotUnifiedLogs,
  subscribeUnifiedLogs,
} from './unifiedLogStore';

function entry(message: string, tabId?: string): LogEntry {
  return { source: 'react', level: 'error', message, timestamp: '2026-11-15T10:00:00', tabId };
}

describe('unifiedLogStore', () => {
  beforeEach(() => {
    clearUnifiedLogs();
  });

  it('通知是异步的：console 在渲染期触发也不会让订阅者渲染中途 setState', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUnifiedLogs(listener);

    appendUnifiedLog(entry('Encountered two children with the same key'));

    // 同步返回时订阅者还没被叫醒——这一条是整套修复的支点：
    // React 在渲染过程中打的 console.error 不会同步回流成 setState。
    expect(listener).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('列表本身是同步可见的：异步只推迟通知，不推迟数据', () => {
    appendUnifiedLog(entry('a'));
    expect(snapshotUnifiedLogs()).toHaveLength(1);
  });

  it('超出上限丢最旧的，不无限长', () => {
    for (let i = 0; i < 3005; i++) appendUnifiedLog(entry(`line-${i}`));
    const all = snapshotUnifiedLogs();
    expect(all).toHaveLength(3000);
    expect(all[all.length - 1].message).toBe('line-3004');
    expect(all[0].message).toBe('line-5');
  });

  it('reset 只清本 tab 的条目，全局与别 tab 的留着', () => {
    appendUnifiedLog(entry('mine', 'tab-a'));
    appendUnifiedLog(entry('theirs', 'tab-b'));
    appendUnifiedLog(entry('global'));

    clearUnifiedLogsForTab('tab-a');

    expect(snapshotUnifiedLogs().map((e) => e.message)).toEqual(['theirs', 'global']);
  });

  it('面板上的清空清掉全部', () => {
    appendUnifiedLog(entry('mine', 'tab-a'));
    appendUnifiedLog(entry('global'));

    clearUnifiedLogs();

    expect(snapshotUnifiedLogs()).toEqual([]);
  });

  it('条目自己带 tabId 时不被覆盖', () => {
    appendUnifiedLog(entry('stamped', 'tab-b'), 'tab-a');
    expect(snapshotUnifiedLogs()[0].tabId).toBe('tab-b');
  });

  it('条目没带 tabId 时补上调用方的 tabId', () => {
    appendUnifiedLog(entry('unstamped'), 'tab-a');
    expect(snapshotUnifiedLogs()[0].tabId).toBe('tab-a');
  });

  it('退订后不再收到通知', async () => {
    const listener = vi.fn();
    subscribeUnifiedLogs(listener)();

    appendUnifiedLog(entry('after-unsubscribe'));
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });

  it('快照是副本：订阅者改它不影响 store', () => {
    appendUnifiedLog(entry('a'));
    const copy = snapshotUnifiedLogs();
    copy.length = 0;
    expect(snapshotUnifiedLogs()).toHaveLength(1);
  });
});
