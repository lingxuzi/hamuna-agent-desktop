/**
 * MiniApp `window.app.*` 宿主派发层（对齐 OpenBitFun `miniapp-dev` 设计）。
 *
 * 与 `workerCallBridge.ts` 的分工：那个文件负责"这条消息可信吗"（`verifyAppCall`），
 * 本文件负责"可信的调用该不该做"。
 *
 * 判定逻辑本身在 `@/shared/miniapp/app-permissions` —— renderer 与 sidecar 必须
 * 共用同一份，否则"renderer 放行 / sidecar 判定不同"的偏差会让纵深防御失效。
 * 本文件只做 renderer 侧的接线与 re-export。
 */

export {
  checkAppPermission,
  commandAllowed,
  hostAllowed,
  isPathAllowed,
  isPrivateHostname,
  runAppCall,
  type AppCallOutcome,
  type PermissionDecision,
} from '../../../shared/miniapp/app-permissions';
