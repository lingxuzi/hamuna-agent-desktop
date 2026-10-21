// jsdom + RTL regression test for the generative-UI widget sandbox transport.
//
// Red line (desktop-only widget-blank bug): the widget iframe is served via
// `srcDoc` (document URL `about:srcdoc`), which the Rust on_navigation guard
// (src-tauri/src/lib.rs) explicitly allows. It must NOT switch to a `blob:` /
// `data:` `src` — those schemes are blocked by that guard (they're top-frame
// attack vectors) so the iframe would load an empty document and render blank
// in the macOS WKWebView. If the transport changes, the nav guard's allow-list
// (and its cargo test) must change in lockstep.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { ThemeRegistry, ThemeRuntimeProvider } from '@/theme';
import { syntheticTheme } from '@/theme/__tests__/syntheticTheme';
import { myAgentsDefaultTheme } from '@/theme/themes/hamuna-default';

import WidgetRenderer from './WidgetRenderer';

afterEach(() => cleanup());

const CODE = '<style>.x{color:red}</style><div class="x">hi</div>';

describe('WidgetRenderer iframe transport', () => {
  it('serves the sandbox via srcDoc (about:srcdoc), not a blocked blob:/data: src', () => {
    const { container } = render(
      <ThemeRuntimeProvider selection={{ themeId: 'hamuna-default', appearanceMode: 'light' }}>
        <WidgetRenderer widgetCode={CODE} isStreaming={false} title="t" widgetId="m1:0" interactive />
      </ThemeRuntimeProvider>,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    // srcdoc carries the sandbox receiver document …
    const srcdoc = iframe!.getAttribute('srcdoc') || '';
    expect(srcdoc).toContain('widget:ready');
    expect(srcdoc).toContain('id="root"');
    // … and the iframe must NOT use a src= URL (blob:/data: are nav-guard-blocked).
    expect(iframe!.getAttribute('src')).toBeNull();
    // sandbox stays scripts-only (opaque origin, postMessage-only).
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('pushes Theme CSS to the loaded iframe without replacing its document or content', () => {
    const registry = new ThemeRegistry([myAgentsDefaultTheme, syntheticTheme]);
    const view = render(
      <ThemeRuntimeProvider
        registry={registry}
        selection={{ themeId: syntheticTheme.id, appearanceMode: 'light' }}
      >
        <WidgetRenderer widgetCode={CODE} isStreaming title="t" widgetId="m1:0" interactive />
      </ThemeRuntimeProvider>,
    );
    const iframe = view.container.querySelector('iframe')!;
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
    fireEvent.load(iframe);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'widget:theme',
      css: expect.stringContaining('--widget-text: #21002f;'),
    }), '*');

    view.rerender(
      <ThemeRuntimeProvider
        registry={registry}
        selection={{ themeId: syntheticTheme.id, appearanceMode: 'dark' }}
      >
        <WidgetRenderer widgetCode={CODE} isStreaming title="t" widgetId="m1:0" interactive />
      </ThemeRuntimeProvider>,
    );

    expect(view.container.querySelector('iframe')).toBe(iframe);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'widget:theme',
      css: expect.stringContaining('--widget-text: #ffe8ff;'),
    }), '*');

    view.rerender(
      <ThemeRuntimeProvider
        registry={registry}
        selection={{ themeId: 'hamuna-default', appearanceMode: 'light' }}
      >
        <WidgetRenderer widgetCode={CODE} isStreaming title="t" widgetId="m1:0" interactive />
      </ThemeRuntimeProvider>,
    );

    expect(view.container.querySelector('iframe')).toBe(iframe);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'widget:theme',
      css: expect.stringContaining('--widget-text: #1c1612;'),
    }), '*');
    expect(postMessage).not.toHaveBeenLastCalledWith(expect.objectContaining({
      css: expect.stringContaining('synthetic-'),
    }), '*');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'widget:finalize' }), '*');
  });
});

describe('WidgetRenderer widget → agent actions', () => {
  // A widget's only route back into the conversation. Every case here is a
  // boundary: stale widgets must not write, and malformed payloads must fail
  // closed rather than reaching the model's context.
  type Props = {
    widgetId: string;
    interactive: boolean;
    onWidgetAction?: (encoded: string) => void;
  };
  function renderWidget(props: Partial<Props> = {}) {
    const onWidgetAction = vi.fn();
    const view = render(
      <ThemeRuntimeProvider selection={{ themeId: 'hamuna-default', appearanceMode: 'light' }}>
        <WidgetRenderer
          widgetCode={CODE}
          isStreaming={false}
          title="t"
          widgetId="msg-7:1"
          interactive
          onWidgetAction={onWidgetAction}
          {...props}
        />
      </ThemeRuntimeProvider>,
    );
    const iframe = view.container.querySelector('iframe')!;
    fireEvent.load(iframe);
    const emit = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent('message', { data, source: iframe.contentWindow as Window }),
      );
    return { ...view, onWidgetAction, emit };
  }

  it('forwards a valid action as a prefixed, encoded user message', () => {
    const { onWidgetAction, emit } = renderWidget();
    emit({ type: 'widget:action', action: 'select', payload: { optionId: 'b' } });
    expect(onWidgetAction).toHaveBeenCalledTimes(1);
    // The widgetId is inside the envelope, minted by the host (never by the
    // widget), so a widget cannot claim to be another one's click.
    expect(onWidgetAction.mock.calls[0][0]).toBe(
      '[Widget action] {"widgetId":"msg-7:1","action":"select","payload":{"optionId":"b"}}',
    );
  });

  it('ignores actions from a non-interactive (older) widget', () => {
    // The point of the gate: a click on scrollback must never inject state into
    // a turn whose context has already moved past that widget.
    const { onWidgetAction, emit } = renderWidget({ interactive: false });
    emit({ type: 'widget:action', action: 'select', payload: { optionId: 'b' } });
    expect(onWidgetAction).not.toHaveBeenCalled();
  });

  it('rejects an action name outside the whitelist', () => {
    const { onWidgetAction, emit } = renderWidget();
    emit({ type: 'widget:action', action: 'rm_rf', payload: {} });
    expect(onWidgetAction).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload value', () => {
    const { onWidgetAction, emit } = renderWidget();
    emit({ type: 'widget:action', action: 'submit', payload: { note: 'x'.repeat(501) } });
    expect(onWidgetAction).not.toHaveBeenCalled();
  });

  it('rejects an empty widgetId rather than sending a bad envelope', () => {
    const { onWidgetAction, emit } = renderWidget({ widgetId: '' });
    emit({ type: 'widget:action', action: 'select', payload: {} });
    expect(onWidgetAction).not.toHaveBeenCalled();
  });

  it('ignores messages from another window', () => {
    const { onWidgetAction } = renderWidget();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'widget:action', action: 'select', payload: {} },
        source: null,
      }),
    );
    expect(onWidgetAction).not.toHaveBeenCalled();
  });
});
