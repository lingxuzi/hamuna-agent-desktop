// 运营台账的写入入口（renderer 侧）。
//
// 与读取（useOpsState）共用同一条纪律：只走 Tauri invoke，不碰 sidecar HTTP
// —— Launcher 没有 Sidecar，走 HTTP 会在那里死掉。
//
// **不做乐观更新。** Rust 写成功后 emit `ops:changed`，面板经 useOpsState 重读
// 权威快照。写者本地再养一份 state 就是两套真相，「保存成功后数字对不上」正是
// Phase 6 计划里点名的坑。`cmd_ops_upsert` 返回的最新快照在这里丢弃：刷新由
// 事件驱动，调用方不需要拿返回值去 setState。

import type { OpsItemKind, OpsState, OpsUpsertPayload } from '../../../shared/ops';

export interface OpsUpsertOutcome {
  state: OpsState;
  id: string;
}

export async function opsUpsert(
  workspace: string,
  payload: OpsUpsertPayload,
): Promise<OpsUpsertOutcome> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { kind, ...fields } = payload;
  // Rust 侧 `OpsUpsert` 是 `kind` + `#[serde(flatten)] fields`，所以平铺传。
  return invoke<OpsUpsertOutcome>('cmd_ops_upsert', {
    workspace,
    item: { kind, ...fields },
  });
}

export async function opsDelete(workspace: string, kind: OpsItemKind, id: string): Promise<OpsState> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<OpsState>('cmd_ops_delete', { workspace, kind, id });
}

/** 把 invoke 抛出的任意值规整成可展示的字符串（toast / 状态行共用）。 */
export function opsErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
