import { describe, expect, it } from 'vitest';
import { levelEnabledAt, parseLogLevel } from './logLevel';

describe('parseLogLevel', () => {
  it('accepts every level name Rust can emit', () => {
    expect(parseLogLevel('debug')).toBe('debug');
    expect(parseLogLevel('info')).toBe('info');
    expect(parseLogLevel('warn')).toBe('warn');
    expect(parseLogLevel('error')).toBe('error');
  });

  it('tolerates case and surrounding whitespace', () => {
    expect(parseLogLevel('  WARN ')).toBe('warn');
    expect(parseLogLevel('Error')).toBe('error');
    expect(parseLogLevel('warning')).toBe('warn');
  });

  it('returns null for unset or unrecognised values', () => {
    // null means "no floor". An unrecognised value must not silently become
    // the strictest or the loosest setting — the caller decides the default.
    expect(parseLogLevel(undefined)).toBeNull();
    expect(parseLogLevel('')).toBeNull();
    expect(parseLogLevel('verbose')).toBeNull();
    expect(parseLogLevel('1')).toBeNull();
  });
});

describe('levelEnabledAt', () => {
  it('admits everything when there is no floor', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(levelEnabledAt(level, null)).toBe(true);
    }
  });

  it('with an error floor admits only errors', () => {
    // This is the release-build contract: the file the user's install writes
    // contains errors and nothing else.
    expect(levelEnabledAt('error', 'error')).toBe(true);
    expect(levelEnabledAt('warn', 'error')).toBe(false);
    expect(levelEnabledAt('info', 'error')).toBe(false);
    expect(levelEnabledAt('debug', 'error')).toBe(false);
  });

  it('with a warn floor keeps warnings and errors', () => {
    expect(levelEnabledAt('warn', 'warn')).toBe(true);
    expect(levelEnabledAt('error', 'warn')).toBe(true);
    expect(levelEnabledAt('info', 'warn')).toBe(false);
  });
});
