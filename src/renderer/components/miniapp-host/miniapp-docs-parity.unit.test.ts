/**
 * Guards the claim at `app-protocol.ts:69` -- that `listAppMethods()` exists
 * "for the doc-sync guard". No such guard existed: every parity test compared
 * the protocol to the runtime, and none read SKILL.md, so the author-facing doc
 * could advertise a method the host always rejects. The failure this prevents is
 * concrete and has happened before: the doc listed `{user-selected}` as a valid
 * `permissions.fs` prefix, the schema accepted it, and every `app.fs.*` call on
 * such an app failed with a path-shaped PERMISSION_DENIED.
 *
 * Scope is deliberately narrow. It reads the REAL SKILL.md and the REAL injected
 * runtime, and checks the one failure mode that matters -- "the doc says X, the
 * host denies X" -- in both directions. It does not attempt to validate prose,
 * examples, or anything outside `app.*` symbol mentions.
 *
 * The "does not exist" section is parsed out of the doc rather than hardcoded, so
 * adding a forbidden namespace to the documentation cannot be mistaken for a new
 * capability, and cannot be forgotten here when it is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { APP_METHODS, isKnownAppMethod, listAppMethods } from '../../../shared/miniapp/app-protocol';
import { KNOWN_TEMPLATES } from '../../../shared/miniapp/path-templates';
import { buildAppRuntimeScript } from './appRuntimeScript';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo root, found rather than counted -- `../../..` is easy to get wrong. */
function repoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('could not locate repo root from ' + HERE);
}

const REPO = repoRoot();
const DOCS = [
  join(REPO, 'bundled-skills', 'miniapp-creator', 'SKILL.md'),
  join(REPO, 'bundled-skills', 'miniapp-creator', 'references', 'design-playbook.md'),
].filter((p) => existsSync(p));

const SKILL_MD = DOCS[0];

/**
 * Group names the docs explicitly present as NOT existing.
 *
 * Read from the "明确不存在的能力" list so it tracks the documentation. A test
 * below asserts that section was actually found, because if the heading is
 * renamed this silently returns empty and every forbidden namespace starts
 * reading as a missing capability.
 */
function forbiddenGroups(markdown: string): Set<string> {
  const forbidden = new Set<string>();
  const section = markdown.match(
    /###\s*明确不存在的能力[^\n]*\n([\s\S]*?)(?=\n##\s|\n###\s|$)/,
  );
  if (!section) return forbidden;
  for (const line of section[1].split('\n')) {
    if (!line.trimStart().startsWith('-')) continue;
    for (const m of line.matchAll(/\bapp\.([a-zA-Z][a-zA-Z0-9_]*)/g)) {
      forbidden.add(m[1]);
    }
  }
  return forbidden;
}

/**
 * Namespace keys the runtime actually exposes: getters, event subscriptions and
 * nested groups that are not dispatch methods. Derived from the built script
 * rather than a hand-kept list, so it cannot drift from the product.
 *
 * Two shapes, because the facade uses both: literal keys (`fs: {...}`,
 * `appId: ...`) and post-assignment (`app.t = function`). Scanning only the
 * object literal missed `app.t`, which is assigned after the literal precisely
 * because it closes over `env`.
 */
function facadeKeys(): Set<string> {
  const src = buildAppRuntimeScript('doc-guard-probe');
  const keys = new Set<string>();
  for (const m of src.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9_]*)\s*:/gm)) {
    keys.add(m[1]);
  }
  for (const m of src.matchAll(/\bapp\.([a-zA-Z][a-zA-Z0-9_]*)\s*=/g)) {
    keys.add(m[1]);
  }
  return keys;
}

describe('miniapp-creator docs match the implemented surface', () => {
  it('locates the docs it is supposed to guard', () => {
    expect(SKILL_MD, 'bundled-skills/miniapp-creator/SKILL.md must exist').toBeTruthy();
    expect(DOCS.length).toBeGreaterThan(0);
    // Vacuous-guard guard: if the doc vanished, every assertion below would pass.
    expect(readFileSync(SKILL_MD, 'utf8').length).toBeGreaterThan(1000);
  });

  it('finds the "does not exist" section the exclusions depend on', () => {
    expect(forbiddenGroups(readFileSync(SKILL_MD, 'utf8')).size).toBeGreaterThan(0);
  });

  it('documents every method the host implements', () => {
    const skillMd = readFileSync(SKILL_MD, 'utf8');
    const dotted = new Set<string>();
    for (const m of skillMd.matchAll(/\bapp\.([a-zA-Z]+)\.([a-zA-Z][a-zA-Z0-9_]*)/g)) {
      dotted.add(`${m[1]}.${m[2]}`);
    }
    // `app.call('method', params)` and `ai.chat` (prose inside the app.ai
    // section) never appear in dotted form, so a bare method name counts when its
    // group is documented. Slightly weaker than a dotted match, but only for
    // groups the doc really covers.
    const groups = new Set<string>();
    for (const m of skillMd.matchAll(/\bapp\.([a-zA-Z]+)\b/g)) groups.add(m[1]);

    const missing = listAppMethods().filter((method) => {
      if (dotted.has(method)) return false;
      const [group, name] = method.split('.');
      return !(groups.has(group) && new RegExp(`\\b${name}\\b`).test(skillMd));
    });

    expect(missing, `implemented but undocumented in SKILL.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents no app.* namespace the host does not provide', () => {
    const facade = facadeKeys();
    const offenders: string[] = [];

    for (const doc of DOCS) {
      const markdown = readFileSync(doc, 'utf8');
      const forbidden = forbiddenGroups(markdown);
      for (const m of markdown.matchAll(/\bapp\.([a-zA-Z][a-zA-Z0-9_]*)/g)) {
        const symbol = m[1];
        if (forbidden.has(symbol)) continue;
        if (facade.has(symbol)) continue;
        if (isKnownAppMethod(symbol)) continue;
        offenders.push(`${doc.split(/[\\/]/).pop()}: app.${symbol}`);
      }
    }

    expect(offenders, `documented but not implemented: ${offenders.join(', ')}`).toEqual([]);
  });

  it('agrees with the path templates the schema actually accepts', () => {
    const skillMd = readFileSync(SKILL_MD, 'utf8');
    for (const t of KNOWN_TEMPLATES) {
      expect(skillMd, `${t} is supported, so the doc must name it`).toContain(t);
    }
    // The doc must not still claim {user-selected} passes validation -- that
    // claim is what made a guaranteed-PERMISSION_DENIED prefix look supported.
    expect(skillMd).not.toMatch(/\{user-selected\}[^\n]{0,40}能过 schema/);
    // Naming it at all is required: it is still worth telling authors it exists
    // and is unsupported, as long as the reason is stated.
    expect(skillMd).toContain('{user-selected}');
  });

  it('is not vacuous: the guarded surface is substantial', () => {
    expect(listAppMethods().length).toBeGreaterThan(20);
    expect(Object.keys(APP_METHODS)).toEqual(
      expect.arrayContaining(['fs', 'ai', 'agent', 'call']),
    );
    expect(facadeKeys().size).toBeGreaterThan(5);
  });
});