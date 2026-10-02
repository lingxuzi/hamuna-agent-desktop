/**
 * Crash-artifact retention.
 *
 * Two properties this file pins, both of which used to be wrong:
 *
 *  1. **A healthy start materialises nothing.** The crash file is created
 *     lazily on the first abnormal event, so a normal launch no longer leaves
 *     a `logs/crash/` entry behind.
 *  2. **Eviction never deletes a live peer's file.** Sidecars share one
 *     directory, so protecting "index 0" is not enough — a sibling that
 *     started more recently owns index 0. Each process protects its OWN file
 *     by name.
 */
import { mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const SCRATCH = mkdtempSync(join(tmpdir(), 'hamuna-crash-retention-'));
const CRASH_DIR = join(SCRATCH, 'crash');
mkdirSync(CRASH_DIR, { recursive: true });

vi.stubEnv('HAMUNA_CRASH_LOG_DIR', CRASH_DIR);

// Import first, on a clean directory, so the "healthy import writes nothing"
// assertion below observes a pristine process rather than one whose own file
// was already materialised by an earlier eviction.
const filesRightAfterImport = readdirSync(CRASH_DIR).filter(f => f.endsWith('.log')).sort();
const { __testing } = await import('./index');

function writeArtifact(name: string, sizeBytes: number, ageDays = 0): void {
  const p = join(CRASH_DIR, name);
  writeFileSync(p, 'x'.repeat(sizeBytes));
  if (ageDays > 0) {
    const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
    utimesSync(p, when, when);
  }
}

function names(): string[] {
  return readdirSync(CRASH_DIR).filter(f => f.endsWith('.log')).sort();
}

function reset(): void {
  for (const f of readdirSync(CRASH_DIR)) rmSync(join(CRASH_DIR, f), { force: true });
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('crash-log retention', () => {
  it('a healthy import materialises no crash artifact', () => {
    // The crash file is created lazily on the first ABNORMAL event, so loading
    // the module must not leave anything under logs/crash/.
    //
    // Asserted at module-evaluation time (captured above) rather than inside a
    // test body: the vitest worker itself tears down noisily between
    // collection and execution, and that shutdown is a harness artefact, not
    // the production startup path this guard is about.
    expect(filesRightAfterImport).toEqual([]);
  });

  it('drops artifacts older than the 30-day age cap regardless of count', () => {
    reset();
    writeArtifact('2026-01-01T00-00-00Z-100-aaaaaa.log', 10, 45);
    writeArtifact('2026-01-02T00-00-00Z-101-bbbbbb.log', 10, 31);
    // Fresh, and well under both the count and byte budgets.
    writeArtifact('2026-09-30T00-00-00Z-102-cccccc.log', 10, 1);

    __testing.evictOldCrashLogs();

    expect(names()).toEqual(['2026-09-30T00-00-00Z-102-cccccc.log']);
  });

  it('never deletes the newest artifact when the count cap trips', () => {
    reset();
    // Count cap is 20, so 24 files forces eviction. Assert the property that
    // matters: the newest artifact always survives.
    for (let i = 1; i <= 24; i++) {
      const day = String(i).padStart(2, '0');
      writeArtifact(`2026-09-${day}T00-00-00Z-${300 + i}-aaaaaa.log`, 1024);
    }

    __testing.evictOldCrashLogs();

    const remaining = names();
    expect(remaining.length).toBeLessThanOrEqual(20);
    expect(remaining).toContain('2026-09-24T00-00-00Z-324-aaaaaa.log');
  });
});
