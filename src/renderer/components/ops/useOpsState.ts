// 运营台账的读取入口。
//
// 只读：写路径在 opsWrite.ts（cmd_ops_upsert / cmd_ops_delete）。
//
// 三条约束：
//  1. **不走 sidecar HTTP。** 工作区数据是 OS 文件，必须走 Tauri invoke ——
//     Launcher 没有 Sidecar，走 HTTP 会在那里死掉。
//  2. **`ops:changed` 是唯一的刷新信号。** 台账只有一个写者（Rust），它每次
//     写完自己 emit，前端不需要轮询，也不需要乐观地猜。
//  3. **事件按 workspace 过滤。** 事件是全局广播的，别的 Tab 的工作区写完也会
//     发一条；不过滤就会把 A 工作区的台账刷进 B 工作区的面板。

import { useCallback, useEffect, useState } from 'react';

import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';
import { workspacePathsEqual } from '../../../shared/workspacePath';

/**
 * 读一次台账。
 *
 * 独立于 hook：冷启动判据要在**面板还没打开**的时候就知道台账里有没有已登录
 * 账号 / 方向原话，那时候还没有 `useOpsState` 的实例可用。
 *
 * 不做 Tauri 环境判断 —— 浏览器开发模式下调用方会拿到异常，自己决定怎么办
 * （`useOpsState` 给空态，冷启动判据给「判不了」）。
 */
export async function readOpsState(workspace: string): Promise<OpsState> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<OpsState>('cmd_ops_read', { workspace });
}

export interface OpsStateResult {
  state: OpsState;
  /** 首次读取还没回来。空态与「还没读到」必须分开：混在一起会先闪一下空态。 */
  loading: boolean;
  /** 读取失败的原因；成功后清空。 */
  error: string | null;
  reload: () => void;
}

export function useOpsState(workspace: string | null): OpsStateResult {
  const [state, setState] = useState<OpsState>(emptyOpsState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!workspace) {
      setState(emptyOpsState());
      setLoading(false);
      return;
    }
    if (!isTauriEnvironment()) {
      // 浏览器开发模式下没有 Rust 层。给空态而不是报错：面板本身要能画出来，
      // 否则在 `./start_dev.sh` 里根本看不到这个视图。
      setState(emptyOpsState());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = await readOpsState(workspace);
        if (cancelled) return;
        setState(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspace, reloadToken]);

  useEffect(() => {
    if (!workspace || !isTauriEnvironment()) return;
    const ac = new AbortController();
    void listenWithCleanup<{ workspace?: string }>('ops:changed', (event) => {
      const changed = event.payload?.workspace;
      if (typeof changed !== 'string' || !workspacePathsEqual(changed, workspace)) return;
      reload();
    }, ac.signal);
    return () => ac.abort();
  }, [workspace, reload]);

  return { state, loading, error, reload };
}
