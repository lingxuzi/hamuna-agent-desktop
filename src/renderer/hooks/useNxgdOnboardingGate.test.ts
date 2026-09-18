import { describe, expect, test } from 'vitest';

import { shouldShowNxgdOnboarding } from './useNxgdOnboardingGate';

const setupUnsetAuth = { status: 'registered' as const, registered: true, setup: false };
const setupDoneAuth = { status: 'registered' as const, registered: true, setup: true };

describe('shouldShowNxgdOnboarding', () => {
  test('returns false when auth not registered yet (avoid misleading empty state)', () => {
    expect(
      shouldShowNxgdOnboarding({
        auth: { status: 'registering', registered: false, setup: false },
      }),
    ).toBe(false);
  });

  test('returns true when auth registered and setup not done (first launch / after manual rm nxgd-auth.json)', () => {
    expect(
      shouldShowNxgdOnboarding({
        auth: setupUnsetAuth,
      }),
    ).toBe(true);
  });

  test('returns false when auth registered and setup done (wizard completed)', () => {
    expect(
      shouldShowNxgdOnboarding({
        auth: setupDoneAuth,
      }),
    ).toBe(false);
  });

  test('returns true after manual nxgd-auth.json reset (regression — server auto-recreates with setup:false)', () => {
    // 用户报告：rm nxgd-auth.json 后 wizard 不弹。
    // 根因（v1）：gate 读 providerVerifyStatus.sticky cache 短路。
    // 根因（v2）：verifyStatus 短路删了，但 dismissedAt 仍写盘。
    // v3 修法：单一权威 = nxgd-auth.json::setup；删 rm 文件 → server 重新注册 → setup:false → 弹。
    expect(
      shouldShowNxgdOnboarding({
        auth: setupUnsetAuth,
      }),
    ).toBe(true);
  });

  test('returns false when auth is null (still loading auth/state)', () => {
    expect(shouldShowNxgdOnboarding({ auth: null })).toBe(false);
  });
});