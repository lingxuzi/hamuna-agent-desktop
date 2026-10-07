/**
 * shoot-miniapp — render a MiniApp the way the host does, in both appearances,
 * then *operate* it and report what the static audit cannot see.
 *
 * `audit-miniapp-style.mjs` proves a MiniApp *declares* colours correctly. It
 * cannot tell you that the result is unreadable. The failures that survive the
 * audit are all of the same shape: the tokens were used correctly and the page
 * still looks wrong.
 *
 *   - A bespoke palette injected into the light slots that is illegible on the
 *     dark slots (or vice versa). The showcase exemplar had exactly this: it
 *     declared `#5c4a4e` secondary text and reused it on a `#16110f` background,
 *     roughly 2.6:1. Nothing in the repo could see it, because nothing rendered.
 *   - `color-mix` percentages that produce something invisible at one contrast.
 *   - Layout that overflows only at the width the host actually uses.
 *
 * And, newer: it renders and looks fine, then does nothing when you use it.
 *   - `app.fs.readFileSync(...)` — a method the facade does not have. Parses,
 *     renders, clears every colour probe, throws on click.
 *   - A handler bound to an element that was replaced before the binding ran.
 * Both produce an identical first paint, so no amount of looking at the
 * screenshot separates them. Hence the drive step: click everything, then read
 * the page's own error surface and the host's refusals.
 *
 * So: load the real theme CSS, let the browser resolve the real `--hamuna-*`
 * projection (built from the same contract.json the host uses), screenshot both
 * appearances, probe the result, drive the controls, and report. The screenshots
 * are for the eye. Everything else is for the exit code, because an exit code is
 * the only thing that survives.
 *
 * Usage:
 *   node scripts/shoot-miniapp.mjs <miniapp-dir> [--out <dir>] [--theme <id>]
 *   node scripts/shoot-miniapp.mjs ~/.hamuna/miniapps/tarot-divination
 *
 * `ponytail:` host capabilities are answered by a stub — only `storage.get`
 * returns anything real. So an app that depends on data renders its
 * empty/loading state, and the drive step cannot tell "this button is supposed
 * to show a chart" from "this button is broken". What it does prove is that
 * pressing every control neither throws nor asks the host for a method it will
 * refuse. A specification of the app's own behaviour is still its author's job.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = process.cwd();

// Protocol constants and the method list, imported rather than retyped. See `hostShim`.
const { APP_CALL_KIND, APP_RESULT_KIND, APP_ERROR_CODES, listAppMethods } = await import(
  pathToFileURL(join(ROOT, 'src/shared/miniapp/app-protocol.ts')).href
);
const KNOWN_METHODS = listAppMethods();
const PROTOCOL = {
  callKind: APP_CALL_KIND,
  resultKind: APP_RESULT_KIND,
  storage: null,
  knownMethods: KNOWN_METHODS,
  unknownCode: APP_ERROR_CODES.UNKNOWN_METHOD,
};

/** WCAG 2.1 minimum for body text. 3:1 is the large-text threshold. */
const AA_BODY = 4.5;
const AA_LARGE = 3.0;
const LARGE_PX = 18.66;

const args = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags.set(args[i].slice(2), args[i + 1] ?? true);
  else positional.push(args[i]);
}

const target = resolve(
  positional[0] ? positional[0].replace(/^~\//, `${homedir()}/`) : '',
);

if (!positional[0] || !existsSync(target)) {
  console.error(
    'usage: node scripts/shoot-miniapp.mjs <miniapp-dir> [--out <dir>] [--theme <id>]\n' +
      `  e.g. node scripts/shoot-miniapp.mjs ${join(homedir(), '.hamuna/miniapps/tarot-divination')}`,
  );
  process.exit(2);
}

const appId = JSON.parse(readFileSync(join(target, 'meta.json'), 'utf8')).id;
const outDir = resolve(flags.get('out') ?? join(ROOT, '.miniapp-shots', appId));
const themeId = flags.get('theme') ?? 'hamuna-default';

// The same variables the host injects, read from the same contract. Nothing here
// hardcodes a token name — see `projectTokens` in the page.
const CONTRACT = JSON.parse(
  readFileSync(join(ROOT, 'src/shared/miniapp-appearance/contract.json'), 'utf8'),
);

// ---------------------------------------------------------------------------
// Source assembly
// ---------------------------------------------------------------------------

/**
 * Inline the sibling files the way the host's `inline_miniapp_siblings` does.
 *
 * The MiniApp references `ui.js` / `style.css` by relative path, but the iframe
 * is an opaque origin — those requests 404 against the host. The host rewrites
 * them to inline before load; without it every MiniApp renders blank, which
 * would make this harness report "no content" for perfectly good apps.
 */
function inlineSiblings(html) {
  return html
    .replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
      const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) return tag;
      const css = readIfExists(join(target, 'source', href));
      return css === null ? tag : `<style>${css}</style>`;
    })
    .replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, pre, src, post) => {
      const code = readIfExists(join(target, 'source', src));
      if (code === null) return tag;
      // Keep the id/class/data attributes, drop `src` — a classic inline script.
      return `<script${pre.replace(/\s+/g, ' ')}${post.replace(/\s+/g, ' ')}>${code}</script>`;
    });
}

function readIfExists(p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

const sourceHtml = readFileSync(join(target, 'source', 'index.html'), 'utf8');
const meta = JSON.parse(readFileSync(join(target, 'meta.json'), 'utf8'));

/** Theme CSS the host would have loaded, so `--hamuna-*` resolves for real. */
function loadThemeCss() {
  const files = [
    join(ROOT, `src/renderer/theme/themes/${themeId}.css`),
    join(ROOT, 'src/renderer/floating-ball/fb.css'), // --fb-mask-opaque
  ];
  return files
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Page-side helpers, serialized into the browser
// ---------------------------------------------------------------------------

/**
 * Build the `:root{...}` block from the real theme CSS.
 *
 * Runs in the page because resolving `--paper` to a literal requires a CSS
 * engine — that is the entire job `readThemeTokens` does in the renderer, and
 * re-deriving it in Node would be a second implementation that drifts.
 *
 * A variable whose host source resolves empty is **omitted** rather than emitted
 * as an empty string. Emitting `--hamuna-x: ;` makes every `var()` fall back
 * silently, which is precisely the failure this whole tool exists to catch — the
 * harness must not manufacture it.
 */
function projectTokens([contract, overrides]) {
  const cs = getComputedStyle(document.documentElement);
  const out = [];
  for (const v of contract.variables) {
    // A bespoke palette wins, exactly as `buildThemeTokenCss` does. Skipping this
    // is not a simplification: the harness would render the app in the *host's*
    // colors and then report contrast failures for a palette the app never
    // asked for — the tool would be measuring the wrong render.
    const override = overrides && overrides[v.name];
    let value;
    if (override) {
      value = override;
    } else if (v.derived) {
      const base = cs.getPropertyValue(v.derived).trim();
      if (!base) continue;
      value = `color-mix(in srgb, ${base} ${Math.round((v.mix ?? 0.5) * 100)}%, transparent)`;
    } else {
      value = cs.getPropertyValue(v.source).trim();
    }
    if (!value) continue;
    out.push(`  ${v.name}: ${value};`);
  }
  return `:root {\n${out.join('\n')}\n}`;
}

/**
 * Answer every `app.*` call with a benign payload.
 *
 * Without this an app's init awaits a capability that never resolves, so the
 * screenshot catches a spinner instead of the UI. The runtime is the real one
 * (imported from source, not reimplemented), so apps get `app.onAppearanceChange`
 * and friends exactly as they will in production.
 *
 * The message kinds are injected from `app-protocol.ts` rather than typed here.
 * A literal would be one rename away from silently never matching — which is
 * exactly what happened: this shim shipped matching `'miniapp.call'`, so
 * `app.storage.*` never settled and every app that reads storage rendered its
 * empty state in the screenshots while looking perfectly healthy.
 */
function hostShim({ callKind, resultKind, storage, knownMethods, unknownCode }) {
  return `
<script>
(function () {
  var NONCE = 'shoot-miniapp-nonce';
  var STORAGE = ${JSON.stringify(storage ?? {})};
  var KNOWN = new Set(${JSON.stringify(knownMethods)});
  // Every capability call the author made, for the report. Recording them is the
  // only way to tell "the app never touched a capability" from "the app called
  // one and the host refused it" — from the outside those look identical.
  window.__shootCalls = [];
  function send(frame) {
    var el = document.querySelector('iframe');
    if (!el || !el.contentWindow) return;
    el.contentWindow.postMessage(frame, '*');
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.kind === 'host.ready') return;
    if (d.kind !== ${JSON.stringify(callKind)} || d.nonce !== NONCE) return;
    // Only storage gets a real answer, because it is the one thing a MiniApp can
    // legitimately await during first paint. Everything else gets null, which is
    // the honest "nothing here" reply.
    var method = d.payload && d.payload.method ? String(d.payload.method) : '';
    // Answer exactly like the real host: a method outside the implemented list
    // is refused with UNKNOWN_METHOD. The previous version replied ok:true to
    // *everything*, which made this whole channel incapable of reporting the
    // one class of failure a generated app actually produces.
    if (!KNOWN.has(method)) {
      window.__shootCalls.push({ method: method, ok: false });
      send({
        kind: ${JSON.stringify(resultKind)}, nonce: NONCE, id: d.id, ok: false,
        error: { code: ${JSON.stringify(unknownCode)}, message: 'Unknown method ' + method },
      });
      return;
    }
    window.__shootCalls.push({ method: method, ok: true });
    var result = null;
    if (method.indexOf('storage.') === 0) {
      var key = d.payload.params && d.payload.params.key;
      result = method === 'storage.get' ? (key in STORAGE ? STORAGE[key] : null) : null;
    }
    send({ kind: ${JSON.stringify(resultKind)}, nonce: NONCE, id: d.id, ok: true, result: result });
  });
  window.__shootReady = function (mode, locale) {
    send({
      kind: 'host.ready',
      nonce: NONCE,
      env: {
        appearanceMode: mode,
        locale: locale || 'zh-CN',
        platform: 'win32',
        workspaceDir: '',
        appDataDir: '',
      },
    });
  };
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/**
 * Measured defects. Each returns evidence, not a verdict — the exit code is the
 * verdict, but a human (or the agent) reading the output needs to know *what*
 * was measured to trust it.
 */
const PROBE = ({ LARGE_PX, AA_BODY, AA_LARGE }) => {
  const findings = [];

  const parseColor = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    const h = String(c).trim().match(/^#([0-9a-f]{3,8})$/i);
    if (!h) return null;
    let hex = h[1];
    if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: alpha };
  };

  const luminance = ({ r, g, b }) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const ratio = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const effectiveBg = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const c = parseColor(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c;
        if (acc.a >= 0.99) return acc;
      }
      node = node.parentElement;
    }
    const rootBg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
    let base = { r: 255, g: 255, b: 255, a: 1 };
    if (rootBg && rootBg.a > 0) base = rootBg;
    if (bodyBg && bodyBg.a > 0) base = over(bodyBg, base);
    return acc ? over(acc, base) : base;
  };

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 60);
  };

  const hasVisibleText = (el) =>
    [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );

  // 1. Text contrast against the nearest opaque background.
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    if (!hasVisibleText(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    const fg = parseColor(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= LARGE_PX || (size >= 14 && weight >= 700);
    const need = large ? AA_LARGE : AA_BODY;

    const r = ratio(over(fg, effectiveBg(el)), effectiveBg(el));
    const key = `${cs.color}|${Math.round(size)}|${describe(el.parentElement || el)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (r < need) {
      findings.push({
        kind: 'contrast',
        where: describe(el),
        detail: `${cs.color} ${size.toFixed(0)}px on ${JSON.stringify(
          getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)' ? 'inherited' : 'own bg',
        )} → ${r.toFixed(2)}:1, needs ${need}:1`,
        ratio: r,
      });
    }

    // 2. Minimum type size.
    //
    // 11px, not 12: the playbook's own floor is "body ≥ 13px; caption ≥ 11px".
    // A mechanical probe cannot tell a caption from a body paragraph, so it can
    // only enforce the floor that applies to *both* — 11px. Flagging 11px as a
    // violation would mean the harness contradicts the document it enforces, and
    // a rule the repo's own exemplars fail is a rule that gets turned off.
    if (size < 11 && !el.closest('svg, canvas, .sr-only')) {
      findings.push({
        kind: 'type-size',
        where: describe(el),
        detail: `${size.toFixed(1)}px is below the 11px caption floor`,
      });
    }
  }

  // 3. Horizontal overflow — the classic "fine in my editor, broken at 1024".
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
      .slice(0, 3)
      .map(describe);
    findings.push({
      kind: 'overflow',
      where: 'document',
      detail: `scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}${wide.length ? ` (widest: ${wide.join(', ')})` : ''}`,
    });
  }

  // 4. Hit targets. The playbook sets 32px; ignore inline text and links inside
  //    prose, where a 32px box would break the line box.
  const interactive = document.querySelectorAll(
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
  );
  for (const el of interactive) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    if (el.closest('p, li, dd, figcaption, .prose')) continue;

    // A checkbox, radio, or file input is the one control whose box is *meant*
    // to be small — the accessible pattern pairs it with a <label> and makes
    // that the target. Measuring the input alone reports a 1×1 "defect" on
    // correct markup.
    let box = rect;
    if (el.matches('input[type="checkbox"], input[type="radio"], input[type="file"]')) {
      const label =
        el.closest('label') ??
        (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      if (label) {
        const labelRect = label.getBoundingClientRect();
        if (labelRect.width >= 1 && labelRect.height >= 1) box = labelRect;
      }
    }

    if (box.height < 32 || box.width < 24) {
      findings.push({
        kind: 'hit-target',
        where: describe(el),
        detail: `${Math.round(box.width)}×${Math.round(box.height)} is under the 32px / 24px floor`,
      });
    }
  }

  return findings;
};

/**
 * Actually operate the app, then report what broke while it ran.
 *
 * Every probe above is a *static* measurement: it reads geometry and colour
 * from a page that has only ever rendered once. That is enough to catch "the
 * layout is wrong" and not enough to catch "the button does nothing" — the
 * single most common way a generated MiniApp ships broken, because a
 * dead handler and a working one produce the same first paint.
 *
 * So: click everything clickable, fire the events form controls listen for, and
 * let the page tell us what it hit. Findings here come from two places, both of
 * which the old harness ignored:
 *   - `window.onerror` / `unhandledrejection` reaching the page — a TypeError in a
 *     click handler. For this facade that is the signature of a method that does
 *     not exist: `app.fs.readFileSync(...)` throws at property access, before any
 *     dispatch, so it never even becomes a host call.
 *   - a `console.error` the app swallowed and carried on after
 *
 * This is a smoke test, not a specification: it cannot know that "Add" was
 * *supposed* to add. It proves that pressing every control neither throws nor
 * calls something the host will refuse — which is the part that can be wrong
 * without anyone noticing.
 */
const DRIVE = () => {
  const findings = [];
  const describe = (el) => {
    const id = el.id ? `#${CSS.escape(el.id)}` : '';
    const cls = typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    const text = (el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
  };

  // Same surface PROBE measures for hit targets, so "we clicked it" and "we
  // complained about its size" cannot disagree about what counts as a control.
  const controls = [...document.querySelectorAll(
    'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.disabled && el.getClientRects().length > 0);

  let pressed = 0;
  for (const el of controls) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') continue;
    try {
      el.click();
      pressed++;
    } catch (err) {
      findings.push({ kind: 'interaction-threw', where: describe(el), detail: String(err && err.message || err) });
    }
  }
  // Text controls: click() on them does nothing, and a handler bound to
  // `change` (rather than `input`) never fires without a real value transition.
  let edited = 0;
  for (const el of controls) {
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') continue;
    try {
      if ('value' in el && el.tagName !== 'SELECT') {
        el.value = el.tagName === 'INPUT' && el.type === 'number' ? '1' : 'shoot-probe';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      edited++;
    } catch (err) {
      findings.push({ kind: 'interaction-threw', where: describe(el), detail: String(err && err.message || err) });
    }
  }
  return { findings, pressed, edited };
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const themeCss = loadThemeCss();
if (!themeCss) {
  throw new Error(`[shoot-miniapp] theme ${themeId} not found under src/renderer/theme/themes`);
}

const browser = await chromium.launch();
mkdirSync(outDir, { recursive: true });

const report = {};
let failed = false;

/**
 * Which states actually differ.
 *
 * Four combinations (light/dark × zh-CN/en-US) is the full matrix, but only if
 * the app can express both axes. Rendering en-US for an app with no i18n
 * produces a byte-identical screenshot — so it would be a second copy of the
 * first that teaches the reviewer nothing while implying coverage it doesn't have.
 *
 * Locale only counts when the app declares translations *and* actually applies
 * them via `data-i18n`; an `i18n` block in meta.json that nothing reads is
 * exactly the "declared but never exercised" rot the audit hunts elsewhere.
 */
const LOCALES = (() => {
  const declared = meta?.i18n?.locales ?? {};
  const read = (name) => {
    const p = join(target, 'source', name);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };
  const usesI18n = /data-i18n/.test(read('index.html')) || /app\.t\(/.test(read('ui.js'));
  const both = Boolean(declared['zh-CN']) && Boolean(declared['en-US']);
  return both && usesI18n ? ['zh-CN', 'en-US'] : ['zh-CN'];
})();

const STATES = ['light', 'dark'].flatMap((mode) => LOCALES.map((locale) => ({ mode, locale })));

for (const { mode, locale } of STATES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Registered BEFORE any content is set. The first version of the sibling
  // harness registered after `goto`, which is exactly how a parse error came
  // back as "ok" — see scripts/verify-miniapp-error-surface.mts.
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Resolve the real token projection against the real theme CSS.
  await page.setContent(
    `<!doctype html><html data-theme-id="${themeId}" data-color-scheme="${mode}"><head></head><body></html>`,
  );
  await page.addStyleTag({ content: themeCss });

  // Reuse the host's own override function rather than re-deriving "which
  // palette applies in this appearance mode" here — a second implementation
  // would be a second thing to keep in sync with the schema.
  const { bespokeOverrides } = await import(
    pathToFileURL(join(ROOT, 'src/renderer/components/miniapp-host/theme-tokens.ts')).href
  );
  const overrides = bespokeOverrides(meta.appearance, mode) ?? null;
  const tokenCss = await page.evaluate(projectTokens, [CONTRACT, overrides]);

  const { buildAppRuntimeScript } = await import(
    pathToFileURL(join(ROOT, 'src/renderer/components/miniapp-host/appRuntimeScript.ts')).href
  );

  const doc = inlineSiblings(sourceHtml);
  // `<html lang>` matters: it drives font selection and the browser's own
  // hyphenation/line-breaking, so a page whose text is Chinese but whose lang
  // says English renders differently in a way no colour probe would catch.
  const localized = doc.replace(/<html([^>]*)>/i, (m, attrs) =>
    /lang=/i.test(attrs) ? m.replace(/lang="[^"]*"/i, `lang="${locale}"`) : `<html lang="${locale}"${attrs}>`,
  );
  const withTokens = localized.replace(
    /<head([^>]*)>/i,
    `<head$1><style>${themeCss}</style><style>${tokenCss}</style>`,
  );
  // Two passes, exactly as MiniAppRunner does: assemble with a zero offset,
  // measure where the author's script then begins, and rebuild with that offset
  // baked in. Pinned to 0 the runtime's error banner points at a line of the
  // injected runtime rather than of ui.js — tolerable while nothing read it,
  // actively misleading now that a wrong line number becomes a finding.
  const { countAuthorLineOffset } = await import(
    pathToFileURL(join(ROOT, 'src/renderer/components/miniapp-host/appRuntimeScript.ts')).href
  );
  const injectRuntime = (offset) =>
    withTokens.replace(
      /<head([^>]*)>/i,
      `<head$1><script>${buildAppRuntimeScript(meta.id, offset)}</script>`,
    );
  const withRuntime = injectRuntime(countAuthorLineOffset(injectRuntime(0)));

  // Host shim lives in the *parent*, like the real host, so the iframe keeps its
  // sandbox posture instead of being handed a fake `window.app` directly.
  await page.setContent(
    `<!doctype html><html><head></head><body style="margin:0">
       <iframe id="miniapp" style="width:1280px;height:900px;border:0;display:block"
               sandbox="allow-scripts allow-forms"></iframe>
       ${hostShim(PROTOCOL)}
     </body></html>`,
  );

  // srcdoc is assigned through the DOM rather than written into an attribute:
  // an author document with a single quote in it would terminate a quoted
  // attribute and truncate the whole thing.
  await page.evaluate((doc) => {
    document.querySelector('iframe').srcdoc = doc;
  }, withRuntime);

  await page.waitForTimeout(200);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await page.evaluate(([m, l]) => window.__shootReady?.(m, l), [mode, locale]);

  // Wait for the token projection to actually be applied before measuring.
  //
  // A fixed sleep was a real flake: under load (a full sweep runs dozens of
  // browsers back to back) the iframe had not yet applied the injected
  // `--hamuna-*` block when the probe ran, so every var() was still resolving to
  // its fallback. That reported a white-on-accent button at 3.5:1 for an app whose
  // tokens resolve correctly — a false failure that looks exactly like a real one.
  // Poll the precondition the probe depends on instead of guessing a duration.
  await frame
    ?.waitForFunction(
      () => {
        const v = getComputedStyle(document.documentElement)
          .getPropertyValue('--hamuna-bg-primary')
          .trim();
        return v.length > 0 && document.readyState !== 'loading';
      },
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      /* fall through to the timed settle below; the probe will report what's missing */
    });
  await page.waitForTimeout(500); // settle for async init and entrance animations

  const findings = frame
    ? await frame.evaluate(PROBE, { LARGE_PX, AA_BODY, AA_LARGE })
    : [];
  const suffix = LOCALES.length > 1 ? `-${mode}-${locale}` : `-${mode}`;
  const shot = join(outDir, `${appId}${suffix}.png`);

  // 4. Drive it — click every control, edit every field — then read what the
  // page says about the run. Done after the screenshot so the shot still shows
  // the first paint, which is what a reviewer is looking at.
  const driven = frame ? await frame.evaluate(DRIVE) : { findings: [], pressed: 0, edited: 0 };
  findings.push(...driven.findings);
  // Give async handlers a tick to reject before we go looking for the fallout.
  await page.waitForTimeout(250);

  // The runtime's own `#hamuna-app-error` banner is deliberately NOT checked
  // here. It is raised from the same `error`/`unhandledrejection` listeners that
  // fire pageerror, so reporting both would print one bug twice — and
  // scripts/verify-miniapp-error-surface.mts already owns that surface as a
  // first-class assertion, with the author's real line numbers.
  for (const message of pageErrors) {
    findings.push({ kind: 'page-error', where: 'iframe', detail: message });
  }
  for (const text of consoleErrors) {
    // A console error with no matching pageerror means the app logged it and
    // carried on, which is still worth surfacing to a reviewer.
    findings.push({ kind: 'console-error', where: 'iframe', detail: text });
  }

  // What the app asked the host for, and how the host answered.
  const calls = (await page.evaluate(() => window.__shootCalls ?? [])) ?? [];
  for (const call of calls) {
    if (call.ok) continue;
    findings.push({
      kind: 'host-refused-call',
      where: call.method || '(unnamed)',
      detail: `the host does not implement this method, so the call rejected with UNKNOWN_METHOD`,
    });
  }

  // `--viewport` captures one screen instead of the whole document. Full-page
  // shots are right for QA (you want to see everything) but wrong for a
  // *reference image* — a tall scroll makes the app unreadable at a glance, and
  // unreadable reference imagery teaches nothing.
  await page.screenshot({ path: shot, fullPage: !flags.has('viewport') });

  // 5. Accent dominance — measured in PAINTED PIXELS, after the screenshot.
  //
  // The playbook's rule is "accent appears more than 3 times on one screen and the
  // hierarchy is out of control". Two cheaper readings of that are both wrong, and
  // this is the record of why:
  //
  //   - counting ELEMENTS punishes bespoke themes. A tarot app whose identity *is*
  //     its accent paints gold filigree on a dozen elements — a title kicker, a
  //     motif diamond, a selected label, four diagram cells — and reads restrained.
  //     Element count reported it as a violation.
  //   - area-weighting the bounding boxes punished it differently and just as
  //     wrongly: a card with a 1px gold border has its whole box counted, though
  //     a single pixel row of it is gold.
  //
  // What the eye actually judges is how much of the screen is accent. So count the
  // rendered pixels. ~18% is where a mid-tone accent stops being emphasis and
  // becomes the background it was supposed to point at.
  // Read the token from the IFRAME, not the parent: the host injects it inside
  // the sandboxed document, so the parent's :root has no such variable and this
  // silently measured nothing.
  const accentHex =
    (await frame?.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--hamuna-accent').trim(),
    )) || '';
  const accentMatch = /^#([0-9a-f]{3,8})$/i.exec(accentHex);
  if (accentMatch) {
    let hex = accentMatch[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    const [ar, ag, ab] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let hits = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (
        Math.abs(data[i] - ar) + Math.abs(data[i + 1] - ag) + Math.abs(data[i + 2] - ab) <= 26
      ) {
        hits++;
      }
    }
    const share = hits / (info.width * info.height);
    if (share > 0.18) {
      findings.push({
        kind: 'accent-spread',
        where: 'document',
        detail:
          `accent ${accentHex} covers ${(share * 100).toFixed(1)}% of rendered pixels; ` +
          'past ~18% it stops reading as emphasis and becomes the background it was ' +
          'meant to point at',
      });
    }
  }

  report[suffix] = { shot, findings, driven: { pressed: driven.pressed, edited: driven.edited }, calls };
  if (findings.length > 0) failed = true;

  console.log(
    `[shoot-miniapp] ${suffix}: ${findings.length} finding(s), `
    + `${driven.pressed} pressed, ${driven.edited} edited, ${calls.length} host call(s) → ${shot}`,
  );
  for (const f of findings) console.log(`    ${f.kind}  ${f.where}  ${f.detail}`);
  await page.close();
}

await browser.close();

// The `report` object used to be built and never written. A human reads the
// console; the next agent reads this file — and the driven/calls counts are how
// it tells "this app has no controls" from "this app's controls all silently
// did nothing", which look identical on the console alone.
const reportPath = join(outDir, 'report.json');
writeFileSync(
  reportPath,
  `${JSON.stringify({ appId, states: STATES.length, failed, results: report }, null, 2)}\n`,
);

if (failed) {
  console.log(
    `\n[shoot-miniapp] FAIL — see the findings above, the ${STATES.length} screenshots,`
    + ` and ${reportPath}.\n`
    + '  Look at them. A finding you cannot explain is a defect you shipped.',
  );
  process.exit(1);
}
console.log(
  `[shoot-miniapp] ok — ${appId} clean across ${STATES.length} state(s) → ${reportPath}`,
);