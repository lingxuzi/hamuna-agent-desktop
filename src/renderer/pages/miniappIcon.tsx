import { MINIAPP_FALLBACK_ICON, MINIAPP_ICON_MAP, type MiniAppTint } from './miniappUi';

/**
 * Icon tile for a MiniApp card, tinted by the caller so a catalog spreads its
 * colours evenly (see `miniAppTints`).
 *
 * `meta.json` stores either a lucide icon name or a literal emoji. An
 * unrecognised ASCII value is an icon *name* we cannot resolve — printing it
 * would put a word inside the tile — so it falls back to the neutral box
 * glyph. A non-ASCII value really is an emoji and renders as one.
 */
export default function MiniAppIcon({
  icon,
  tint,
  className,
}: {
  icon?: string;
  tint: MiniAppTint;
  className?: string;
}) {
  const named = icon ? MINIAPP_ICON_MAP[icon] : undefined;
  const emoji = !named && icon && !/^[\x20-\x7e]+$/.test(icon) ? icon : null;
  const Glyph = named ?? (emoji ? null : MINIAPP_FALLBACK_ICON);

  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tint.tile}`}>
      {emoji ? (
        <span className="text-lg" aria-hidden="true">{emoji}</span>
      ) : Glyph ? (
        <Glyph className={`${className ?? ''} ${tint.glyph}`.trim()} aria-hidden="true" />
      ) : null}
    </span>
  );
}
