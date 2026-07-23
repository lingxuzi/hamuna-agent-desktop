import { describe, expect, it } from 'vitest';

import { HAMUNA_TOOL_CALL_TIMEOUT_MS } from './tool-call-policy';

describe('HAMUNA_TOOL_CALL_TIMEOUT_MS', () => {
  it('allows HamunaAgent-owned tools to run for five minutes', () => {
    expect(HAMUNA_TOOL_CALL_TIMEOUT_MS).toBe(300_000);
  });
});
