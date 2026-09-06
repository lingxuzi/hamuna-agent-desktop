/**
 * Renderer snapshot for spec-compliance test fixture · 《午后茶歇》.
 * Mirror of storyboard_grid_morning_rush.render.test.ts — proves the renderer
 * works for any narrative-comic fixture conforming to §4, not just the canonical
 * morning-rush example.
 */

import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { transformTvcEnvelopes } from '../tvcEnvelopeTransform';

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../../../bundled-skills/tvc-director/fixtures/storyboard_grid_afternoon_tea.json',
);
const OUT_PATH = resolve(
  __dirname,
  '../../../../../bundled-skills/tvc-director/fixtures/storyboard_grid_afternoon_tea.rendered.html',
);

describe('spec-compliance test fixture · storyboard_grid_afternoon_tea · rendered HTML snapshot', () => {
  it('writes the rendered widget HTML next to the fixture', () => {
    const fixtureRaw = readFileSync(FIXTURE_PATH, 'utf8');
    const fenced = '```json\n' + fixtureRaw + '\n```';
    const widgetHtml = transformTvcEnvelopes(fenced);
    const envelope = JSON.parse(fixtureRaw);
    const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>tvc-director spec-compliance test · ${envelope.artifact_kind} · step ${envelope.step}</title>
<meta name="generator" content="tvcEnvelopeTransform + storyboardCanvas widget" />
<style>
  body { margin: 0; padding: 24px; background: #15171A; color: #F4F4F1; font-family: ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 14px; font-weight: 500; color: #6B6B68; margin: 0 0 16px; letter-spacing: 0.04em; text-transform: uppercase; }
  .meta { font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11px; color: #6B6B68; margin: 0 0 24px; }
  iframe { width: 100%; min-height: 720px; border: 1px solid #2A2C30; background: #15171A; }
</style>
</head>
<body>
<h1>spec-compliance test · ${envelope.artifact_kind} · step ${envelope.step} · 《午后茶歇》</h1>
<p class="meta">source: bundled-skills/tvc-director/fixtures/storyboard_grid_afternoon_tea.json<br/>renderer: src/renderer/components/tools/tvcWidgets/storyboardCanvas.ts<br/>generated: ${new Date().toISOString()}</p>
<iframe sandbox="allow-scripts" srcdoc="${widgetHtml.replace(/"/g, '&quot;')}"></iframe>
</body>
</html>`;
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, doc, 'utf8');
  });
});