import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  GLOBAL_SIDEBAR_DEFAULT_WIDTH,
  GLOBAL_SIDEBAR_MAX_WIDTH,
  GLOBAL_SIDEBAR_MIN_WIDTH,
  normalizeGlobalSidebarWidth,
} from '@/utils/globalSidebarPreference';

interface SidebarResizeHandleProps {
  expanded: boolean;
  width: number;
  onCommit: (width: number) => void;
}

/** Owns one pointer transaction and its paint projection, never the saved preference. */
export function SidebarResizeHandle({ expanded, width, onCommit }: SidebarResizeHandleProps) {
  const { t } = useTranslation('launcher');
  const handleRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const stopRef = useRef<((commit: boolean, unmount?: boolean) => void) | null>(null);
  const onCommitRef = useRef(onCommit);
  useLayoutEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  const effectiveWidth = preview ?? width;
  const shellAttr = 'data-app-shell';

  // Publish the width to the shell before paint; per-frame React state would
  // re-render the whole App tree on every pointer move.
  useLayoutEffect(() => {
    const shell = handleRef.current?.closest(`[${shellAttr}]`) as HTMLElement | null;
    if (!shell) return;
    const previous = shell.style.getPropertyValue('--global-sidebar-width');
    return () => {
      stopRef.current?.(false, true);
      if (previous) shell.style.setProperty('--global-sidebar-width', previous);
      else shell.style.removeProperty('--global-sidebar-width');
      shell.removeAttribute('data-sidebar-resizing');
    };
  }, []);
  useLayoutEffect(() => {
    const shell = handleRef.current?.closest(`[${shellAttr}]`) as HTMLElement | null;
    shell?.style.setProperty('--global-sidebar-width', `${effectiveWidth}px`);
  }, [effectiveWidth]);
  useLayoutEffect(() => {
    if (!expanded) stopRef.current?.(false);
  }, [expanded]);

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !expanded || stopRef.current) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const shell = handle.closest(`[${shellAttr}]`) as HTMLElement | null;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = width;
    let nextWidth = width;
    let frame: number | null = null;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    shell?.setAttribute('data-sidebar-resizing', 'true');
    setPreview(width);

    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      nextWidth = normalizeGlobalSidebarWidth(startWidth + e.clientX - startX);
      if (frame === null) frame = requestAnimationFrame(() => {
        frame = null;
        setPreview(nextWidth);
      });
    };
    const stop = (commit: boolean, unmount = false) => {
      if (stopRef.current !== stop) return;
      stopRef.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', keydown, true);
      handle.removeEventListener('lostpointercapture', cancel);
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      shell?.removeAttribute('data-sidebar-resizing');
      if (!unmount) {
        if (commit && nextWidth !== startWidth) onCommitRef.current(nextWidth);
        setPreview(null);
      }
    };
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      move(e);
      stop(true);
    };
    const cancel = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointerId) stop(false);
    };
    const blur = () => stop(false);
    const keydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stop(false);
    };
    stopRef.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', keydown, true);
    handle.addEventListener('lostpointercapture', cancel);
    handle.setPointerCapture(pointerId);
  };

  return <>
    <div
      ref={handleRef}
      hidden={!expanded}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('globalSidebar.resize')}
      aria-valuemin={GLOBAL_SIDEBAR_MIN_WIDTH}
      aria-valuemax={GLOBAL_SIDEBAR_MAX_WIDTH}
      aria-valuenow={effectiveWidth}
      tabIndex={expanded ? 0 : -1}
      title={t('globalSidebar.resizeHint')}
      data-no-drag
      className="global-sidebar-resize-handle"
      onPointerDown={beginDrag}
      onDoubleClick={() => { stopRef.current?.(false); onCommitRef.current(GLOBAL_SIDEBAR_DEFAULT_WIDTH); }}
      onKeyDown={(event) => {
        if (stopRef.current || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
        const values: Record<string, number> = {
          ArrowLeft: width - 8, ArrowRight: width + 8,
          Home: GLOBAL_SIDEBAR_MIN_WIDTH, End: GLOBAL_SIDEBAR_MAX_WIDTH,
          Enter: GLOBAL_SIDEBAR_DEFAULT_WIDTH,
        };
        if (!(event.key in values)) return;
        event.preventDefault();
        event.stopPropagation();
        onCommitRef.current(normalizeGlobalSidebarWidth(values[event.key]));
      }}
    />
    {preview !== null && createPortal(
      <div className="fixed inset-0 z-[9999] cursor-col-resize" data-no-drag />,
      document.body,
    )}
  </>;
}
