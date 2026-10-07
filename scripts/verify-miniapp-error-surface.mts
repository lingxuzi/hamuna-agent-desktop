// verify-miniapp-error-surface.mts — prove a dead MiniApp looks dead.
//
// ## What this guards
//
// The runtime script installs a global error handler so that a behaviour layer
// which does not parse becomes visible. A parse error is otherwise invisible by
// construction: the browser discards the entire script, so the app keeps
// whatever static markup its HTML carried and looks merely "unfinished".
//
// That is not hypothetical. A MiniApp generated from the skill's own playbook
// through a live provider had exactly one defect — a single-quoted string
// literal spanning newlines — and produced a plausible todo page whose header,
// three stat tiles and add-form all rendered while not one of its six rows did.
// A screenshot review read it as "a bit plain". `meta.json` parsed, the entry
// resolved, the iframe mounted, and nothing anywhere reported a failure.
//
// ## Why Playwright and not vitest
//
// jsdom does not execute scripts inside an `srcdoc` iframe, so a unit test that
// mounts a broken app can never observe the failure — it would pass for the
// wrong reason. Same reasoning as `verify-miniapp-workers.mjs`: the defect
// needs a real script engine to reproduce, and a test that cannot reproduce it
// is worse than no test because it looks like coverage.
//
// ## What it asserts
//
//   1. a broken behaviour layer raises the banner (the whole point)
//   2. the reported line is the author file's line, not the assembled document's
//   3. a healthy app raises nothing — a banner that always fires is noise
//   4. a runtime throw and an unhandled rejection are reported too
//
// Exits non-zero on any failure.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

import { buildAppRuntimeScript, countAuthorLineOffset } from '../src/renderer/components/miniapp-host/appRuntimeScript';

const failures: string[] = [];

function expectReport(label: string, actual: boolean, detail: string): void {
  if (actual) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label} — ${detail}`);
    failures.push(`${label}: ${detail}`);
  }
}

// Mirrors Rust `inline_miniapp_siblings` closely enough for the two things that
// decide whether an app runs: sibling inlining, and runtime-before-author-code.
function assemble(runtime: string, authorCss: string, authorJs: string): string {
  return `<!doctype html><html><head><style>${authorCss}</style><script>${runtime}</script>`
    + `</head><body><div id="static">static markup</div>`
    + `<script>\n${authorJs}\n</script></body></html>`;
}

const brokenJs = [
  '(function () {',
  "  var d = document.createElement('div');",
  "  d.innerHTML = '",       // <- line 3: single-quoted literal, real newlines
  '    <span>oops</span>',
  "  ';",
  '})();',
].join('\n');

const runtimeFor = (authorCss: string, authorJs: string): string => {
  // Two passes, exactly as MiniAppRunner does: measure, then bake.
  const offset = countAuthorLineOffset(assemble(buildAppRuntimeScript('verify', 0), authorCss, authorJs));
  return buildAppRuntimeScript('verify', offset);
};

const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), 'hamuna-errsurface-'));

async function run(label: string, authorCss: string, authorJs: string) {
  const file = join(dir, `${label}.html`);
  writeFileSync(file, assemble(runtimeFor(authorCss, authorJs), authorCss, authorJs));
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  // Registered BEFORE goto. The first version of this harness registered after,
  // which is exactly how a parse error came back as "ok".
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`file:///${file.replace(/\\/g, '/')}`);
  await page.waitForTimeout(250);
  const banner = await page.evaluate(() => {
    const el = document.getElementById('hamuna-app-error');
    return el ? el.textContent ?? null : null;
  });
  const staticAlive = await page.evaluate(() => !!document.getElementById('static'));
  await page.close();
  return { banner, pageErrors, staticAlive };
}

console.log('MiniApp error surface — real browser\n');

// 1 + 2: broken script -> banner, with the author's real line number.
{
  const css = '\n'.repeat(500); // stand-in for a realistically long style.css
  const { banner, staticAlive } = await run('broken', css, brokenJs);
  expectReport('broken ui.js raises the banner', banner !== null, `banner was ${banner}`);
  expectReport('static markup survives (the silent-failure shape)', staticAlive, 'static markup vanished');
  expectReport(
    'banner points at ui.js line 3, not the assembled document',
    banner !== null && banner.includes('第 3 行'),
    `banner said ${JSON.stringify(banner)}`,
  );
}

// 3: healthy app -> silence. A banner that always fires is noise, not a signal.
{
  const { banner, pageErrors } = await run('healthy', '', 'document.getElementById("static").textContent = "ran";');
  expectReport('healthy ui.js raises nothing', banner === null, `banner was ${banner}`);
  expectReport('healthy ui.js has no page error', pageErrors.length === 0, pageErrors[0] ?? '');
}

// 4: runtime throw and unhandled rejection are reported too.
{
  const { banner } = await run('throwing', '', 'throw new Error("boom from app code");');
  expectReport('runtime throw is reported', banner !== null && banner.includes('boom from app code'),
    `banner was ${banner}`);
}
{
  const { banner } = await run('rejecting', '', 'Promise.reject(new Error("rejected from app code"));');
  expectReport('unhandled rejection is reported',
    banner !== null && banner.includes('rejected from app code'), `banner was ${banner}`);
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nall checks passed');