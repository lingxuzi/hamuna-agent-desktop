/**
 * TerminalStrip — Bloomberg-style status strip. Fintech Terminal chrome element.
 *
 * Mirrors the demo `.terminal-strip` block at the bottom of
 * `demo/fintech-terminal-demo.html`:
 *   • 36px high, paper-inset background, hairline bottom border
 *   • Pulsing gold dot at left (fin-pulse animation)
 *   • Status badge (LIVE / IDLE / ERROR)
 *   • `·`-separated mono fields (SESSION / TURNS / CTX / MODEL / RUNTIME / MCP / UPTIME / WORKSPACE / BRANCH)
 *   • All uppercase JetBrains Mono, 11px, 0.06em letter-spacing
 *
 * The chrome-wide styles (`.terminal-strip`, `.dot`, `.pulse`, `.key`, `.val`,
 * `.sep`, `.status`) are scoped to `html[data-theme-id='fintech-terminal']`
 * inside `src/renderer/index.css` so other themes see only an empty <div>.
 */

import { type CSSProperties } from 'react';

export type TerminalStripStatus = 'live' | 'idle' | 'error';

export interface TerminalStripField {
  readonly key: string;
  readonly value: string;
}

export interface TerminalStripProps {
  /** Runtime status. Drives badge text + color (LIVE=gold, IDLE=muted, ERROR=red). */
  status?: TerminalStripStatus;
  /** Right-to-left (or any order) list of mono fields rendered after the status badge. */
  fields?: readonly TerminalStripField[];
  /** Optional override for the live status text. Defaults to "LIVE" / "IDLE" / "ERROR". */
  statusLabel?: string;
  className?: string;
  style?: CSSProperties;
}

const STATUS_LABEL: Record<TerminalStripStatus, string> = {
  live: 'LIVE',
  idle: 'IDLE',
  error: 'ERROR',
};

export default function TerminalStrip({
  status = 'live',
  fields = [],
  statusLabel,
  className = '',
  style,
}: TerminalStripProps) {
  const badgeText = statusLabel ?? STATUS_LABEL[status];

  return (
    <div className={`terminal-strip ${className}`} style={style}>
      <span className="dot" />
      <span className="status" data-status={status}>
        {badgeText}
      </span>
      {fields.map((field, index) => (
        <span key={`${field.key}-${index}`} className="terminal-strip-field">
          <span className="sep">·</span>
          <span className="key">{field.key}</span>
          <span className="val">{field.value}</span>
        </span>
      ))}
    </div>
  );
}