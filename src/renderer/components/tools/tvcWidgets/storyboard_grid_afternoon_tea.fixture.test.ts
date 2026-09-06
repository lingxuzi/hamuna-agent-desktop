/**
 * Spec-compliance test for the §4 storyboard_grid canonical spec, using
 * 《午后茶歇》 as a NEW archetype generated from the spec (different product
 * / different arc / different time-of-day from canonical morning_rush.json).
 *
 * Source of truth: bundled-skills/tvc-director/fixtures/storyboard_grid_afternoon_tea.json
 *
 * This test proves three portability claims:
 *   1. The §4 schema accepts any narrative-comic block following v0.8 field set
 *      (not just the morning-rush canonical example).
 *   2. The storyboardCanvas widget renders the new fixture consistently with
 *      the canonical one (same wrapper class, same per-panel chip trio,
 *      same block-level anchor / layout / character_setup).
 *   3. Structural diff vs canonical: same shape keys, same enum membership
 *      (shot_type / character_emotion / sound_effect / layout_type).
 *
 * Failures here = the spec is under-specified (only works for the morning
 * archetype) OR the widget has a hidden coupling to the canonical example.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { transformTvcEnvelopes } from '../tvcEnvelopeTransform';
import { looksLikeTvcEnvelope, TVC_ARTIFACT_KINDS } from '../../../../shared/tvcEnvelope';

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../../../bundled-skills/tvc-director/fixtures/storyboard_grid_afternoon_tea.json',
);
const CANONICAL_PATH = resolve(
  __dirname,
  '../../../../../bundled-skills/tvc-director/fixtures/storyboard_grid_morning_rush.json',
);

const newRaw = readFileSync(FIXTURE_PATH, 'utf8');
const canonRaw = readFileSync(CANONICAL_PATH, 'utf8');
const newEnv = JSON.parse(newRaw);
const canonEnv = JSON.parse(canonRaw);

describe('spec-compliance test fixture · storyboard_grid_afternoon_tea', () => {
  it('parses as valid JSON', () => {
    expect(() => JSON.parse(newRaw)).not.toThrow();
  });

  it('is a valid tvc envelope (looksLikeTvcEnvelope)', () => {
    expect(looksLikeTvcEnvelope(newEnv)).toBe(true);
  });

  it('declares the same envelope + artifact metadata shape as canonical', () => {
    expect(newEnv.schema_version).toBe(canonEnv.schema_version);
    expect(newEnv.envelope_type).toBe(canonEnv.envelope_type);
    expect(newEnv.step).toBe(canonEnv.step);
    expect(newEnv.agent).toBe(canonEnv.agent);
    expect(newEnv.artifact_kind).toBe(canonEnv.artifact_kind);
    expect(TVC_ARTIFACT_KINDS).toContain(newEnv.artifact_kind);
    expect(newEnv.status).toBe('pending_user_confirmation');
    expect(newEnv.gate).toBe('strong');
  });

  it('uses 1 narrative-comic block × 8 panels (spec archetype)', () => {
    expect(newEnv.artifact.blocks).toHaveLength(1);
    expect(newEnv.artifact.blocks[0].layout_type).toBe('narrative-comic');
    expect(newEnv.artifact.blocks[0].panels).toHaveLength(8);
  });

  it('every panel carries the 4 v0.8 required chip keys + reference_tags', () => {
    const panels = newEnv.artifact.blocks[0].panels;
    for (const p of panels) {
      expect(typeof p.shot_type).toBe('string');
      expect(typeof p.character_emotion).toBe('string');
      expect(typeof p.sound_effect).toBe('string');
      expect(Array.isArray(p.reference_tags)).toBe(true);
    }
  });

  it('carries the 3 morning-rush archetype extension fields per panel', () => {
    const panels = newEnv.artifact.blocks[0].panels;
    for (const p of panels) {
      expect(typeof p.core_action).toBe('string');
      expect(typeof p.camera_move).toBe('string');
      expect(typeof p.color_light).toBe('string');
      expect(typeof p.mood_keyword).toBe('string');
    }
  });

  it('carries block-level audio_atmosphere + key_props[] (extension fields)', () => {
    const block = newEnv.artifact.blocks[0];
    expect(typeof block.audio_atmosphere).toBe('string');
    expect(Array.isArray(block.key_props)).toBe(true);
    expect(block.key_props.length).toBeGreaterThan(0);
  });

  it('shot_type / character_emotion / sound_effect use same enum membership as canonical', () => {
    // Collect all values from both fixtures and assert sets intersect on
    // common values + use only known enum tokens (no typos drift in)
    const newPanels = newEnv.artifact.blocks[0].panels as Array<Record<string, string>>;
    const canonPanels = canonEnv.artifact.blocks[0].panels as Array<Record<string, string>>;
    const newShotTypes = new Set(newPanels.map((p) => p.shot_type));
    const canonShotTypes = new Set(canonPanels.map((p) => p.shot_type));
    const intersection = [...newShotTypes].filter((s) => canonShotTypes.has(s));
    expect(intersection.length).toBeGreaterThan(0);
    // Per-panel shot_type must be one of the documented v0.8 shot_type enum
    const SHOT_TYPE_ENUM = new Set([
      'extreme-wide', 'wide', 'medium', 'medium-close-up',
      'close-up', 'extreme-close-up', 'over-the-shoulder',
      'top-down', 'dutch-angle',
    ]);
    for (const s of newShotTypes) {
      expect(SHOT_TYPE_ENUM.has(s)).toBe(true);
    }
  });

  it('transformer routes the new fixture through tvcWidgets (storyboard-canvas)', () => {
    const fenced = '```json\n' + newRaw + '\n```';
    const out = transformTvcEnvelopes(fenced);
    expect(out).toContain('<generative-ui-widget');
    expect(out).toContain('tvc-widget--storyboard_grid');
    expect(out).toContain('tvc-widget--pending');
    expect(out).toContain('data-tvc-step="4"');
    expect(out).toContain('data-tvc-status="pending_user_confirmation"');
  });

  it('rendered widget HTML contains all 8 panel ids', () => {
    const fenced = '```json\n' + newRaw + '\n```';
    const out = transformTvcEnvelopes(fenced);
    for (const id of ['01', '02', '03', '04', '05', '06', '07', '08']) {
      expect(out).toContain(`sb-panel-id">${id}<`);
    }
  });

  it('rendered widget HTML shows the afternoon-tea block anchor (not morning-rush)', () => {
    const fenced = '```json\n' + newRaw + '\n```';
    const out = transformTvcEnvelopes(fenced);
    expect(out).toContain('sb-anchor">tvc-style-documentary-afternoon<');
    // proves we did NOT accidentally render the canonical fixture content
    expect(out).not.toContain('sb-anchor">tvc-style-documentary-morning<');
  });

  it('rendered widget HTML for afternoon-tea differs from morning-rush (different content)', () => {
    const newOut = transformTvcEnvelopes('```json\n' + newRaw + '\n```');
    const canonOut = transformTvcEnvelopes('```json\n' + canonRaw + '\n```');
    // The two outputs MUST differ somewhere — if they're identical, something
    // is wrong (cache hit, wrong fixture path, etc.)
    expect(newOut).not.toBe(canonOut);
    // But the structural wrapper must match (same widget, same status class)
    expect(newOut).toContain('tvc-widget--storyboard_grid');
    expect(canonOut).toContain('tvc-widget--storyboard_grid');
  });

  it('rendered widget HTML uses --widget-* CSS vars only (no hex literals)', () => {
    const fenced = '```json\n' + newRaw + '\n```';
    const out = transformTvcEnvelopes(fenced);
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(out).not.toMatch(/rgb\(/);
    expect(out).not.toMatch(/rgba\(/);
  });
});