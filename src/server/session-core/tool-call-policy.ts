/**
 * Hard wall-clock budget for tool calls whose execution lifetime is owned by
 * HamunaAgent. Runtime-native tool configurations keep their own timeout
 * authority until they explicitly adopt this policy.
 */
export const HAMUNA_TOOL_CALL_TIMEOUT_MS = 300_000;
