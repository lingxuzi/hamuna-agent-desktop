/**
 * Unified-log level floor for the Node side.
 *
 * The GUI decides the floor (`logger.rs::min_level`) because it is the only
 * process that knows the build mode: release keeps `error` and nothing else,
 * debug builds keep everything. Node cannot read `debug_assertions`, so Rust
 * hands the answer over as `HAMUNA_LOG_LEVEL` when it spawns the Sidecar —
 * and the same value is what the user can set by hand to get a verbose run
 * out of an installed build.
 *
 * Unset ⇒ no filtering. That only happens when Node runs detached from the
 * GUI (`npm run server`, tests), where a full log is what the operator wants.
 */

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

const SEVERITY: Record<LogLevelName, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function parseLogLevel(raw: string | undefined): LogLevelName | null {
  switch (raw?.trim().toLowerCase()) {
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'warn':
    case 'warning':
      return 'warn';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

/** The floor in force for this process, or `null` when nothing is filtered. */
export const LOG_LEVEL_FLOOR: LogLevelName | null = parseLogLevel(process.env.HAMUNA_LOG_LEVEL);

export function levelEnabledAt(level: LogLevelName, floor: LogLevelName | null): boolean {
  return floor === null || SEVERITY[level] >= SEVERITY[floor];
}

export function isLevelEnabled(level: LogLevelName): boolean {
  return levelEnabledAt(level, LOG_LEVEL_FLOOR);
}
