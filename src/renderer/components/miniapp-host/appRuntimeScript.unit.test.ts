// The runtime script ships into every MiniApp iframe, ahead of the author's
// code, so that it can report on that code. A behaviour layer that does not
// parse is otherwise invisible: the browser discards the whole script and the
// app renders its static markup, looking merely "unfinished".
//
// ## What is NOT tested here, and why
//
// That a broken app actually raises the banner needs a real browser. jsdom does
// not execute scripts inside an `srcdoc` iframe at all, so mounting one and
// waiting cannot produce the failure — the test would pass for the wrong reason
// and be worse than none. `scripts/verify-miniapp-error-surface.mts` covers that
// end of it with Playwright, on the same reasoning as
// `scripts/verify-miniapp-workers.mjs` ("vitest 复现不出来，因为复现它需要先跑
// 真运行时").
//
// What *is* testable here is everything that would silently break the stub
// itself — which matters more than it looks, because a malformed stub takes
// down every MiniApp at once, including the working ones.

import { describe, expect, it } from 'vitest';

import {
  APP_RUNTIME_END_MARKER,
  buildAppRuntimeScript,
  countAuthorLineOffset,
} from './appRuntimeScript';

describe('the MiniApp runtime stub is safe to ship', () => {
  it('is syntactically valid', () => {
    // Compiling is the check: a template-literal mistake in the stub would
    // otherwise only surface as "window.app is undefined" inside every app.
    expect(() => new Function(buildAppRuntimeScript('a'))).not.toThrow();
    expect(() => new Function(buildAppRuntimeScript('a', 1234))).not.toThrow();
  });

  it('emits no sequence that would close the script element', () => {
    // inline_miniapp_siblings inlines this into HTML. A literal closing tag —
    // even inside a comment — truncates the stub, and every app loses
    // window.app entirely.
    expect(/<\s*\/\s*script/i.test(buildAppRuntimeScript('a'))).toBe(false);
    expect(/<\s*\/\s*script/i.test(buildAppRuntimeScript('a', 99))).toBe(false);
  });

  it('keeps the baked line offset on a single line', () => {
    // MiniAppRunner assembles twice: once to measure the offset, once to bake it
    // in. That is only sound if swapping the number cannot change this script's
    // line count. If a future edit made the offset multi-line, the measured
    // value would be wrong for every app — silently, since a wrong offset only
    // degrades the error message.
    const bare = buildAppRuntimeScript('a', 0).split('\n').length;
    expect(buildAppRuntimeScript('a', 987654).split('\n').length).toBe(bare);
  });

  it('exposes the end marker exactly once, so the offset has a unique anchor', () => {
    const src = buildAppRuntimeScript('a', 0);
    expect(src.split(APP_RUNTIME_END_MARKER).length - 1).toBe(1);
  });
});

describe('countAuthorLineOffset', () => {
  it('counts the document lines injected before the author script', () => {
    const doc = [
      '<head>',
      '<script>',
      APP_RUNTIME_END_MARKER,
      '</script>',
      '<script>',
      'X',
      '</script>',
      '</head>',
    ].join('\n');
    // The author's first line ("X") is document line 6, so five lines precede
    // its content and the offset is 5 — which is what lets a browser line
    // number be mapped back onto the author's own file.
    expect(countAuthorLineOffset(doc)).toBe(5);
  });

  it('maps a browser line number back onto the author own file', () => {
    // The invariant that makes the error banner useful: a line reported at
    // document line N is line N - offset in ui.js. Written as an index check so
    // it fails if the anchor drifts by even one line.
    const doc = [
      '<head>',
      '<style>',
      'a',
      'b',
      '</style>',
      '<script>',
      APP_RUNTIME_END_MARKER,
      '</script>',
      '<script>',
      'console.log(1);', // author line 1
      'console.log(2);', // author line 2
      '</script>',
    ].join('\n');
    const lines = doc.split('\n');
    const offset = countAuthorLineOffset(doc);
    expect(lines[offset]).toBe('console.log(1);');
    expect(lines[offset + 1]).toBe('console.log(2);');
  });

  it('does not count the author script tag line', () => {
    // inline_miniapp_siblings emits `<script>\n…content…`. Anchoring on the tag
    // rather than on the content reports every error one line too high, which
    // points the author at the wrong statement — a location they cannot use.
    const doc = [
      '<script>',
      APP_RUNTIME_END_MARKER,
      '</script>',
      '<script>',
      'X',
      '</script>',
    ].join('\n');
    // "X" is document line 5, so four lines precede its content.
    expect(countAuthorLineOffset(doc)).toBe(4);
    expect(doc.split('\n')[countAuthorLineOffset(doc)]).toBe('X');
  });

  it('returns 0 instead of guessing when there is no anchor', () => {
    expect(countAuthorLineOffset('<html><body>no runtime here</body></html>')).toBe(0);
    expect(countAuthorLineOffset(`<script>${APP_RUNTIME_END_MARKER}</script>`)).toBe(0);
    expect(countAuthorLineOffset('')).toBe(0);
  });
});