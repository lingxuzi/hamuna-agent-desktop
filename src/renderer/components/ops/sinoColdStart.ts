// 「这个工作区还是不是冷启动」的判据，和「要不要自动弹向导」的裁决。
//
// 纯函数：判据要能被单测钉住，而判据的数据来自两处（台账 / 工作区里的画像
// 文件），采集那层在 Chat.tsx 里，不混进判据本身。

import type { OpsAccount, OpsDirection } from '../../../shared/ops';

export interface SinoColdStartSnapshot {
  /** 台账里的账号。 */
  accounts: OpsAccount[];
  /** 台账里的方向。 */
  directions: OpsDirection[];
  /** 账号画像（`03-USER.md`）里有没有填过东西。 */
  profileFilled: boolean;
}

/**
 * 冷启动 = 三件只有人能做的事，一件都没做。
 *
 * **为什么是「一件都没做」而不是「缺哪件都算」**：缺一件的账号已经在经营了
 * （登录过 / 说过方向 / 填过画像），这时候再弹一个从①开始的六步向导是在
 * 打断人，不是在帮忙。真正需要被拉进向导的，是一次都没开始过的工作区。
 *
 * **为什么看实际状态，而不只看 `sinoOnboardedAt`**：那个标记只说明「用户点过
 * 以后再说」。用户也可能没点过向导，却自己在运营台登录了账号、写了方向 ——
 * 那时候照样弹一次六步向导就是纯粹的骚扰。
 */
export function isSinoColdStart(snapshot: SinoColdStartSnapshot): boolean {
  const loggedIn = snapshot.accounts.some((account) => account.loginState === 'success');
  const hasDirection = snapshot.directions.some((direction) => direction.brief.trim().length > 0);
  return !loggedIn && !hasDirection && !snapshot.profileFilled;
}

export interface AutoOpenDecision {
  /** 这个 Tab 现在是不是用户正在看的那一个。 */
  isActive: boolean;
  /** 这个工作区是不是 sino（运营台只对 sino 有意义）。 */
  isSinoWorkspace: boolean;
  /** 用户说过「以后再说」或已经走完向导。 */
  onboarded: boolean;
  /** 冷启动判据的结果。`null` = 还没读到，判不了就不弹。 */
  coldStart: boolean | null;
  /** 本次 App 运行里已经弹过一次。 */
  alreadyOpened: boolean;
}

/**
 * 要不要现在就把冷启动向导弹出来。
 *
 * **必须在 Tab 可见时才弹**：后台 Tab 挂载就把面板打开，等于替用户按下一个他
 * 看不见的按钮。而且面板会被「切走就关」那条规则立刻关掉，一次性守卫却已经
 * 被消费掉 —— 切回来就再也弹不出来了。
 *
 * **判据没读到（`coldStart === null`）时不弹**：读不出来不等于冷启动。宁可
 * 少弹一次，也不要在读失败的时候替用户做决定。
 */
export function shouldAutoOpenSinoWizard(decision: AutoOpenDecision): boolean {
  if (!decision.isActive) return false;
  if (!decision.isSinoWorkspace) return false;
  if (decision.onboarded) return false;
  if (decision.coldStart !== true) return false;
  if (decision.alreadyOpened) return false;
  return true;
}
