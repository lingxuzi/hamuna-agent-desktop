/**
 * Canonical-fixture smoke test for Step 4 · storyboard_grid · 《早高峰冲》 archetype.
 *
 * Source of truth lives in:
 *   bundled-skills/tvc-director/fixtures/storyboard_grid_morning_rush.json
 *
 * This test pins three contracts together:
 *   - §4 step-output-schema (storyboard_grid artifact shape)
 *   - src/renderer/components/tools/tvcWidgets/storyboardCanvas (renderer)
 *   - the canonical fixture (what future agents are expected to emit)
 *
 * Failures here = drift between §4 schema, storyboardCanvas widget, or fixture JSON.
 *
 * Run by:
 *   npx vitest run --project unit -- src/renderer/components/tools/tvcWidgets/storyboard_grid_morning_rush.fixture.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { transformTvcEnvelopes } from '../tvcEnvelopeTransform';
import { looksLikeTvcEnvelope, TVC_ARTIFACT_KINDS } from '../../../../shared/tvcEnvelope';

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../../../bundled-skills/tvc-director/fixtures/storyboard_grid_morning_rush.json',
);
const fixtureRaw = readFileSync(FIXTURE_PATH, 'utf8');

describe('canonical fixture · storyboard_grid_morning_rush', () => {
  it('parses as valid JSON', () => {
    expect(() => JSON.parse(fixtureRaw)).not.toThrow();
  });

  it('is a valid tvc envelope (looksLikeTvcEnvelope)', () => {
    const parsed = JSON.parse(fixtureRaw);
    expect(looksLikeTvcEnvelope(parsed)).toBe(true);
  });

  it('declares the expected envelope + artifact metadata', () => {
    const env = JSON.parse(fixtureRaw);
    expect(env.schema_version).toBe('1');
    expect(env.envelope_type).toBe('storyboard_envelope');
    expect(env.step).toBe(4);
    expect(env.agent).toBe('tvc-agent-asset-storyboard');
    expect(env.artifact_kind).toBe('storyboard_grid');
    expect(TVC_ARTIFACT_KINDS).toContain(env.artifact_kind);
    expect(env.status).toBe('pending_user_confirmation');
    expect(env.gate).toBe('strong');
  });

  it('contains the 8 morning-rush panels in 1 narrative-comic block', () => {
    const env = JSON.parse(fixtureRaw);
    const blocks = env.artifact.blocks;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].layout_type).toBe('narrative-comic');
    expect(blocks[0].panels).toHaveLength(8);
    const expectedPanelIds = ['01', '02', '03', '04', '05', '06', '07', '08'];
    expect(blocks[0].panels.map((p: { panel_id: string }) => p.panel_id)).toEqual(expectedPanelIds);
  });

  it('every panel carries the 4 v0.8 required chip keys + reference_tags', () => {
    const env = JSON.parse(fixtureRaw);
    const panels = env.artifact.blocks[0].panels;
    for (const p of panels) {
      expect(typeof p.shot_type).toBe('string');
      expect(typeof p.character_emotion).toBe('string');
      expect(typeof p.sound_effect).toBe('string');
      expect(Array.isArray(p.reference_tags)).toBe(true);
    }
  });

  it('transformer routes the fixture through tvcWidgets (storyboard-canvas)', () => {
    const fenced = '```json\n' + fixtureRaw + '\n```';
    const out = transformTvcEnvelopes(fenced);
    expect(out).toContain('<generative-ui-widget');
    expect(out).toContain('tvc-widget--storyboard_grid');
    expect(out).toContain('tvc-widget--pending'); // status: pending_user_confirmation
    expect(out).toContain('data-tvc-step="4"');
    expect(out).toContain('data-tvc-artifact="storyboard_grid"');
    expect(out).toContain('data-tvc-status="pending_user_confirmation"');
  });

  it('rendered widget HTML contains all 8 panel ids', () => {
    const fenced = '```json\n' + fixtureRaw + '\n```';
    const out = transformTvcEnvelopes(fenced);
    for (const id of ['01', '02', '03', '04', '05', '06', '07', '08']) {
      expect(out).toContain(`sb-panel-id">${id}<`);
    }
  });

  it('rendered widget HTML shows the block chip + narrative-comic layout label', () => {
    const fenced = '```json\n' + fixtureRaw + '\n```';
    const out = transformTvcEnvelopes(fenced);
    expect(out).toContain('sb-block-id">block_01<');
    expect(out).toContain('sb-layout">narrative<');
    expect(out).toContain('sb-anchor">tvc-style-documentary-morning<');
  });

  it('rendered widget HTML uses --widget-* CSS vars only (no hex literals)', () => {
    const fenced = '```json\n' + fixtureRaw + '\n```';
    const out = transformTvcEnvelopes(fenced);
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(out).not.toMatch(/rgb\(/);
    expect(out).not.toMatch(/rgba\(/);
  });
});